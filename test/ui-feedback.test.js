// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackController, FeedbackView } from '../src/ui-feedback.js';
import captions from '../src/translations/ui-feedback.js';

const mounted = [];
const session = (extra = {}) => ({ contextKey: 'account-layout-source-one', connected: true, loading: false, ...extra });
const action = (extra = {}) => ({ id: 'light.lounge', label: 'Lounge light', sourceKey: 'exact-source-one', ...extra });
const click = (node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
const pointer = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
const key = (node, type, value, extra = {}) => node.dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true, composed: true, ...extra }));
function fixture() {
  const parent = document.createElement('div'); document.body.append(parent);
  let view;
  const changed = vi.fn((snapshot) => view?.update(snapshot, { language: 'en' }));
  const controller = new FeedbackController({ onChange: changed });
  const dismissed = vi.fn((kind) => controller.dismiss(kind));
  view = new FeedbackView(parent, { onDismiss: dismissed });
  controller.setContext(session()); view.update(controller.snapshot(), { language: 'en' });
  mounted.push(controller, view, { dispose: () => parent.remove() });
  return { parent, controller, view, changed, dismissed,
    row: (kind) => view.rows.get(kind), update: (hass = { language: 'en' }) => view.update(controller.snapshot(), hass) };
}
afterEach(() => { for (const item of mounted.splice(0)) item.dispose(); vi.restoreAllMocks(); });

describe('owned save results and independent drafts', () => {
  it('starts idle and cannot save or execute an action before a current context', () => {
    const controller = new FeedbackController();
    expect(controller.snapshot().save.status).toBe('idle');
    expect(controller.setSaveState('saving')).toBeNull();
    expect(controller.beginAction(action())).toBeNull();
    expect(controller.setSaveState('saved')).toBe(false);
  });
  it.each(['saved', 'failed'])('rejects un-tokened or forged terminal save %s', (status) => {
    const f = fixture(), owned = f.controller.setSaveState('saving');
    expect(f.controller.setSaveState(status)).toBe(false);
    expect(f.controller.setSaveState(status, { ...owned })).toBe(false);
    expect(f.controller.snapshot().save.persistedStatus).toBe('saving');
    expect(f.controller.setSaveState(status, owned)).toBe(true);
    expect(f.controller.snapshot().save.persistedStatus).toBe(status);
    expect(f.controller.setSaveState(status, owned)).toBe(false);
  });
  it('keeps a newer dirty draft unsaved when an earlier save succeeds', () => {
    const f = fixture(), token = f.controller.setSaveState('saving');
    f.controller.setDirty(true);
    expect(f.controller.snapshot().save.status).toBe('unsaved');
    expect(f.controller.snapshot().save.persistedStatus).toBe('saving');
    expect(f.row('save').detail.textContent).toContain('last requested changes');
    f.controller.setSaveState('saved', token);
    expect(f.controller.snapshot().save).toMatchObject({ status: 'unsaved', persistedStatus: 'saved', dirty: true, dismissible: false });
    expect(f.row('save').message.textContent).toBe('Unsaved changes');
    expect(f.controller.dismiss('save')).toBe(false);
    f.controller.setDirty(false);
    expect(f.row('save').message.textContent).toBe('Layout saved');
  });
  it('preserves dirty draft and useful failed-save information', () => {
    const f = fixture(), token = f.controller.setSaveState('saving');
    f.controller.setDirty(true); f.controller.setSaveState('failed', token);
    expect(f.row('save').message.textContent).toBe('Unsaved changes');
    expect(f.row('save').detail.textContent).toContain('last save failed');
    f.controller.setDirty(false);
    expect(f.row('save').message.textContent).toContain('Could not save');
    expect(f.row('save').dismiss.hidden).toBe(false);
  });
  it('supports unsaved compatibility without pretending to have saved', () => {
    const f = fixture(); f.controller.setSaveState('unsaved');
    expect(f.controller.snapshot().save).toMatchObject({ status: 'unsaved', persistedStatus: 'idle' });
    f.controller.setSaveState('idle');
    expect(f.controller.snapshot().save.status).toBe('unsaved');
    f.controller.setDirty(false); expect(f.controller.snapshot().save.status).toBe('idle');
  });
  it('keeps only the newest explicit save token', () => {
    const f = fixture(), old = f.controller.setSaveState('saving'), current = f.controller.setSaveState('saving');
    expect(f.controller.setSaveState('saved', old)).toBe(false);
    expect(f.controller.setSaveState('failed', old)).toBe(false);
    expect(f.controller.setSaveState('saved', current)).toBe(true);
  });
  it('revokes pending save through explicit idle', () => {
    const f = fixture(), old = f.controller.setSaveState('saving'); f.controller.setSaveState('idle');
    expect(f.controller.setSaveState('saved', old)).toBe(false);
    expect(f.view.el.hidden).toBe(true);
  });
  it('can report an owned local storage save while disconnected', () => {
    const f = fixture(); f.controller.setContext(session({ connected: false }));
    const token = f.controller.setSaveState('saving'); expect(token).toBeTruthy();
    expect(f.controller.setSaveState('saved', token)).toBe(true);
    expect(f.row('connection').message.textContent).toContain('disconnected');
    expect(f.row('save').message.textContent).toBe('Layout saved');
    expect(f.controller.beginAction(action())).toBeNull();
  });
  it.each([null, 1, 'true', undefined])('rejects nonboolean dirty state %s', (raw) => {
    const f = fixture(); expect(f.controller.setDirty(raw)).toBe(false);
    expect(f.controller.snapshot().save.dirty).toBe(false);
  });
});

describe('current connection and generation ownership', () => {
  it('does not claim reconnected on initial healthy connection', () => {
    const f = fixture(); expect(f.row('connection').row.hidden).toBe(true);
  });
  it('shows loading, offline and an explicit dismissible reconnect', () => {
    const f = fixture(); f.controller.setContext(session({ loading: true }));
    expect(f.row('connection').message.textContent).toBe('Loading your layout…');
    expect(f.controller.dismiss('connection')).toBe(false);
    f.controller.setContext(session({ loading: true, connected: false }));
    expect(f.row('connection').message.textContent).toContain('disconnected');
    f.controller.setContext(session());
    expect(f.row('connection').message.textContent).toBe('Connected to Home Assistant again.');
    click(f.row('connection').dismiss); expect(f.row('connection').row.hidden).toBe(true);
  });
  it.each([
    ['account', session({ contextKey: 'another-account' })],
    ['layout', session({ contextKey: 'another-layout' })],
    ['source metadata', session({ contextKey: 'another-source' })],
    ['connection identity', session({ contextKey: 'another-connection' })],
    ['offline', session({ connected: false })],
    ['loading', session({ loading: true })],
  ])('rejects both late action and save results after %s change', (_name, next) => {
    const f = fixture(), saved = f.controller.setSaveState('saving'), requested = f.controller.beginAction(action());
    f.controller.setContext(next);
    expect(f.controller.setSaveState('saved', saved)).toBe(false);
    expect(f.controller.setSaveState('failed', saved)).toBe(false);
    expect(f.controller.actionRequested(requested)).toBe(false);
    expect(f.controller.actionFailed(requested)).toBe(false);
    expect(f.controller.snapshot().action).toBeNull();
  });
  it('restoring an old context key never restores its old tokens', () => {
    const f = fixture(), requested = f.controller.beginAction(action()), saved = f.controller.setSaveState('saving');
    f.controller.setContext(session({ contextKey: 'temporary' })); f.controller.setContext(session());
    expect(f.controller.actionRequested(requested)).toBe(false);
    expect(f.controller.setSaveState('saved', saved)).toBe(false);
    expect(f.controller.actionRequested(f.controller.beginAction(action()))).toBe(true);
  });
  it('keeps dirty state on connection loss but clears it for another layout/account', () => {
    const f = fixture(); f.controller.setDirty(true); f.controller.setContext(session({ connected: false }));
    expect(f.controller.snapshot().save.status).toBe('unsaved');
    f.controller.setContext(session({ contextKey: 'another-layout' }));
    expect(f.controller.snapshot().save.status).toBe('idle');
  });
  it('keeps tokens through unrelated readings and in-place locale changes', () => {
    const f = fixture(), requested = f.controller.beginAction(action()), saved = f.controller.setSaveState('saving');
    expect(f.controller.setContext(session({ temperature: 12, language: 'fr' }))).toBe(false);
    expect(f.controller.actionRequested(requested)).toBe(true);
    expect(f.controller.setSaveState('saved', saved)).toBe(true);
  });
  it.each([undefined, null])('requires an actual context key, not %s', (contextKey) => {
    const f = fixture(); f.controller.setContext(session({ contextKey }));
    expect(f.controller.beginAction(action())).toBeNull(); expect(f.controller.setSaveState('saving')).toBeNull();
  });
  it('never evaluates provided context or label getters', () => {
    const f = fixture(), getter = vi.fn(() => 'should-not-run');
    f.controller.setContext({ get contextKey() { return getter(); }, connected: true });
    expect(f.controller.beginAction({ id: 'a', get label() { return getter(); } })).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('truthful action request feedback', () => {
  it('revokes only the exact pending owner while retaining independent save/draft state', () => {
    const f = fixture(), token = f.controller.beginAction(action()); f.controller.setDirty(true);
    expect(f.controller.cancelAction({ ...token })).toBe(false);
    expect(f.controller.snapshot().action.status).toBe('pending');
    expect(f.controller.cancelAction(token)).toBe(true);
    expect(f.controller.snapshot().action).toBeNull(); expect(f.controller.snapshot().save.status).toBe('unsaved');
    expect(f.controller.actionRequested(token)).toBe(false);
  });
  it('cannot revoke a newer action or a terminal requested notice with an obsolete token', () => {
    const f = fixture(), old = f.controller.beginAction(action()), current = f.controller.beginAction(action({ id: 'scene.movie' }));
    expect(f.controller.cancelAction(old)).toBe(false); expect(f.controller.snapshot().action.id).toBe('scene.movie');
    expect(f.controller.actionRequested(current)).toBe(true);
    expect(f.controller.cancelAction(current)).toBe(false); expect(f.controller.snapshot().action.status).toBe('requested');
  });
  it('rejects pending cancellation from a revoked context or disposed controller', () => {
    const f = fixture(), old = f.controller.beginAction(action()); f.controller.setContext(session({ contextKey: 'other' }));
    expect(f.controller.cancelAction(old)).toBe(false);
    const current = f.controller.beginAction(action()); f.controller.dispose(); expect(f.controller.cancelAction(current)).toBe(false);
  });
  it('reports only requested after owned service completion, with no device-confirmed state', () => {
    const f = fixture(), token = f.controller.beginAction(action());
    expect(f.row('action').message.textContent).toBe('Requesting Lounge light…');
    expect(f.row('action').dismiss.hidden).toBe(true);
    expect(f.controller.dismiss('action')).toBe(false);
    f.controller.actionRequested(token);
    expect(f.row('action').message.textContent).toBe('Action requested for Lounge light. Check its current reading.');
    expect(f.controller.snapshot().action.status).toBe('requested');
    expect(f.view.el.textContent).not.toMatch(/completed|turned on|confirmed/i);
    click(f.row('action').dismiss); expect(f.view.el.hidden).toBe(true);
  });
  it('reports failures without displaying backend strings or a false device state', () => {
    const f = fixture(), token = f.controller.beginAction(action());
    f.controller.actionFailed(token, new Error('<img src=secret>'));
    expect(f.row('action').message.textContent).toBe('Could not request Lounge light.');
    expect(f.view.el.querySelector('img')).toBeNull();
  });
  it('does not let a late older action attach to the same ID with a different command', () => {
    const f = fixture(), old = f.controller.beginAction(action());
    const current = f.controller.beginAction(action({ label: 'Return vacuum', sourceKey: 'new-command' }));
    expect(f.controller.actionFailed(old)).toBe(false); expect(f.controller.actionRequested(old)).toBe(false);
    expect(f.controller.snapshot().action.label).toBe('Return vacuum');
    expect(f.controller.actionRequested(current)).toBe(true);
  });
  it('rejects forged or already consumed action ownership', () => {
    const f = fixture(), token = f.controller.beginAction(action());
    expect(f.controller.actionRequested({ ...token })).toBe(false);
    expect(f.controller.actionRequested(token)).toBe(true);
    expect(f.controller.actionFailed(token)).toBe(false);
  });
  it.each([
    { id: '', label: 'Missing' }, { id: 1, label: 'Wrong' }, { id: 'valid', label: '' },
    { id: 'valid', label: ' ' }, { id: 'x'.repeat(257), label: 'Long ID' },
    { id: 'valid', label: 'x'.repeat(161) }, { id: 'valid', label: { toString: () => 'unsafe' } },
  ])('rejects malformed action %j without creating a message', (raw) => {
    const f = fixture(); expect(f.controller.beginAction(raw)).toBeNull(); expect(f.controller.snapshot().action).toBeNull();
  });
  it('does not create any device callback, timer, interval, or animation loop', () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout'), interval = vi.spyOn(globalThis, 'setInterval');
    const controller = new FeedbackController(); controller.setContext(session()); controller.setDirty(true);
    const token = controller.beginAction(action()); controller.actionRequested(token); controller.dismiss('action');
    expect(timeout).not.toHaveBeenCalled(); expect(interval).not.toHaveBeenCalled();
    expect(controller.callService).toBeUndefined(); expect(controller.requestAnimationFrame).toBeUndefined();
  });
  it('exposes immutable snapshots and frozen ownership tokens', () => {
    const f = fixture(), token = f.controller.beginAction(action()), snapshot = f.controller.snapshot();
    expect(Object.isFrozen(token)).toBe(true); expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.save)).toBe(true); expect(Object.isFrozen(snapshot.action)).toBe(true);
  });
});

describe('stable accessible feedback view', () => {
  it('owns an ignored native UI surface, no visible empty rows and polite live-status nodes', () => {
    const f = fixture(); expect(f.view.el.hidden).toBe(true); expect(f.view.el.dataset.taylors3dUi).toBe('feedback');
    expect(f.view.el.getAttribute('aria-label')).toBe('Layout and connection status');
    for (const refs of f.view.rows.values()) {
      expect(refs.row.hidden).toBe(true);
      expect(refs.message.parentElement.getAttribute('role')).toBe('status');
      expect(refs.message.parentElement.getAttribute('aria-live')).toBe('polite');
      expect(refs.message.parentElement.getAttribute('aria-atomic')).toBe('true');
      expect(refs.dismiss.type).toBe('button');
    }
  });
  it('renders saved names literally and does not create HTML or custom styles from them', () => {
    const f = fixture(), label = '<img src=x onerror="alert(1)">{label}\n<style>body{display:none}</style>';
    const token = f.controller.beginAction(action({ label })); f.controller.actionRequested(token);
    expect(f.row('action').message.textContent).toContain(label);
    expect(f.row('action').dismiss.getAttribute('aria-label')).toContain(label);
    expect(f.view.el.querySelector('img')).toBeNull(); expect(f.view.el.querySelectorAll('style')).toHaveLength(1);
    expect(f.row('action').row.getAttribute('style')).toBeNull();
  });
  it('keeps focused controls and writes no DOM when the data and locale are equal', () => {
    const f = fixture(), token = f.controller.setSaveState('saving'); f.controller.setSaveState('saved', token);
    const button = f.row('save').dismiss, message = f.row('save').message; button.focus();
    const observer = new MutationObserver(() => {}); observer.observe(f.view.el, { subtree: true, attributes: true, childList: true, characterData: true });
    f.update(); f.update();
    expect(f.row('save').dismiss).toBe(button); expect(f.row('save').message).toBe(message);
    expect(document.activeElement).toBe(button); expect(observer.takeRecords()).toHaveLength(0); observer.disconnect();
  });
  it.each(['en', 'de', 'fr', 'es'])('uses authored %s labels while saved device names remain literal', (language) => {
    const f = fixture(), token = f.controller.beginAction(action({ label: 'My Lounge' })); f.controller.actionRequested(token); f.update({ language });
    expect(f.row('action').message.textContent).toBe(captions[language]['feedback.action.requested'].replace('{label}', 'My Lounge'));
    expect(f.view.el.getAttribute('aria-label')).toBe(captions[language]['feedback.aria']);
  });
  it('refreshes in-place locale changes without executing anything or replacing focused nodes', () => {
    const f = fixture(), token = f.controller.setSaveState('saving'); f.controller.setSaveState('saved', token);
    const hass = { locale: { language: 'en-GB' } }, button = f.row('save').dismiss; f.update(hass); button.focus();
    hass.locale.language = 'fr-FR'; f.update(hass);
    expect(f.row('save').message.textContent).toBe('Disposition enregistrée');
    expect(document.activeElement).toBe(button); expect(f.dismissed).not.toHaveBeenCalled();
  });
  it('falls back to English for unsupported or malformed locales', () => {
    const f = fixture(); f.controller.setDirty(true); f.update({ language: 'xx-YY' });
    expect(f.row('save').message.textContent).toBe('Unsaved changes');
    f.update({ language: '<img>' }); expect(f.row('save').message.textContent).toBe('Unsaved changes');
  });
  it('dismisses one completed channel without discarding another unsaved or offline status', () => {
    const f = fixture(); f.controller.setDirty(true); f.controller.setContext(session({ connected: false }));
    const token = f.controller.setSaveState('saving'); f.controller.setDirty(false); f.controller.setSaveState('saved', token);
    click(f.row('save').dismiss); expect(f.row('save').row.hidden).toBe(true); expect(f.row('connection').row.hidden).toBe(false);
    click(f.row('connection').dismiss); expect(f.dismissed).toHaveBeenCalledTimes(1);
  });
  it.each(['pointer', 'Enter', ' '])('rejects a held %s dismissal after a different current context or result', (kind) => {
    const f = fixture(), saved = f.controller.setSaveState('saving'); f.controller.setSaveState('saved', saved);
    const button = f.row('save').dismiss;
    if (kind === 'pointer') pointer(button, 'pointerdown'); else key(button, 'keydown', kind);
    f.controller.setContext(session({ contextKey: 'another-account' }));
    const replacement = f.controller.setSaveState('saving'); f.controller.setSaveState('failed', replacement);
    if (kind === 'pointer') pointer(button, 'pointerup'); else key(button, 'keyup', kind);
    click(button); expect(f.dismissed).not.toHaveBeenCalled(); expect(f.row('save').row.hidden).toBe(false);
    if (kind === 'pointer') { pointer(button, 'pointerdown'); pointer(button, 'pointerup'); }
    else { key(button, 'keydown', kind); key(button, 'keyup', kind); }
    click(button); expect(f.dismissed).toHaveBeenCalledExactlyOnceWith('save');
  });
  it('revokes pointer cancellation and never dismisses a non-dismissible in-progress row', () => {
    const f = fixture(), token = f.controller.setSaveState('saving'); click(f.row('save').dismiss); expect(f.dismissed).not.toHaveBeenCalled();
    f.controller.setSaveState('saved', token); pointer(f.row('save').dismiss, 'pointerdown'); pointer(f.row('save').dismiss, 'pointercancel'); click(f.row('save').dismiss);
    expect(f.dismissed).not.toHaveBeenCalled();
  });
  it('does not let keyboard auto-repeat rearm an old held dismissal after newer results', () => {
    const f = fixture(), saved = f.controller.setSaveState('saving'); f.controller.setSaveState('saved', saved);
    const button = f.row('save').dismiss; key(button, 'keydown', ' ');
    const replacement = f.controller.setSaveState('saving'); f.controller.setSaveState('failed', replacement);
    key(button, 'keydown', ' ', { repeat: true }); key(button, 'keyup', ' '); click(button);
    expect(f.dismissed).not.toHaveBeenCalled(); expect(f.row('save').row.hidden).toBe(false);
  });
  it('does not treat foreign, removed or malformed rows as a dismissal', () => {
    const f = fixture(), foreign = document.createElement('button'); foreign.dataset.feedbackDismiss = 'save'; f.parent.append(foreign); click(foreign);
    f.view.update({ save: { status: '<img>', dismissible: true }, action: { status: 'confirmed', label: 'Fake' } });
    expect(f.view.el.hidden).toBe(true); expect(f.dismissed).not.toHaveBeenCalled();
  });
  it('has reachable 44px dismissals, wrapped text, paired palette and forced-colour fallback', () => {
    const f = fixture(), css = f.view.el.querySelector('style').textContent;
    expect(css).toContain('min-width: 44px'); expect(css).toContain('min-height: 44px');
    expect(css).toContain('overflow-wrap: anywhere'); expect(css).toContain('--taylors3d-ui-surface');
    expect(css).toContain('--taylors3d-ui-text'); expect(css).toContain('forced-colors: active');
  });
  it('has an authored matching catalogue in all four locales with equal placeholders', () => {
    expect(Object.keys(captions)).toEqual(['en', 'de', 'fr', 'es']);
    const keys = Object.keys(captions.en).sort();
    for (const catalogue of Object.values(captions)) {
      expect(Object.keys(catalogue).sort()).toEqual(keys);
      for (const name of keys) {
        expect(typeof catalogue[name]).toBe('string'); expect(catalogue[name].length).toBeGreaterThan(0);
        expect(catalogue[name].match(/\{[a-z]+\}/g) || []).toEqual(captions.en[name].match(/\{[a-z]+\}/g) || []);
      }
    }
  });
  it('cleans up listeners, DOM and owned results exactly once', () => {
    const f = fixture(), saved = f.controller.setSaveState('saving'), actionToken = f.controller.beginAction(action());
    const el = f.view.el, button = f.row('action').dismiss;
    f.controller.dispose(); f.controller.dispose(); f.view.dispose(); f.view.dispose(); click(button);
    expect(el.isConnected).toBe(false); expect(f.view.rows.size).toBe(0); expect(f.dismissed).not.toHaveBeenCalled();
    expect(f.controller.setSaveState('saved', saved)).toBe(false); expect(f.controller.actionRequested(actionToken)).toBe(false);
    expect(f.controller.setDirty(true)).toBe(false); expect(f.controller.setContext(session())).toBe(false);
    expect(f.view.update({}, { language: 'en' })).toBe(false);
  });
});
