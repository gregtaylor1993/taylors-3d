// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearch, globalSearchText } from '../src/global-search.js';
import captions from '../src/translations/global-search.js';

const fixtures = [];
const item = (id, kind = 'device', patch = {}) => ({ id, kind, label: id, target: `${kind}:${id}`, ...patch });
const defaults = () => [item('lounge', 'room', { label: 'Lounge', subtitle: 'Ground floor' }),
  item('lamp', 'device', { label: 'Reading lamp', target: 'light.reading_lamp', keywords: ['Lounge', 'lighting'] }),
  item('front', 'view', { label: 'Front door' }), item('bedtime', 'scene', { label: 'Bedtime', target: 'scene.bedtime' }),
  item('appearance', 'setting', { label: 'Appearance', keywords: ['theme', 'colour'] })];
function fixture(items = defaults(), { shadow = false, onSelect = vi.fn(), onOpenChange = vi.fn() } = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const root = shadow ? host.attachShadow({ mode: 'open' }) : host;
  const opener = document.createElement('button'), stage = document.createElement('div'); root.append(opener, stage); stage.style.height = '520px';
  const context = { contextKey: 'account/layout/model/session', hass: { language: 'en' }, suspended: false, items };
  const getContext = vi.fn(() => context), view = new GlobalSearch(stage, { getContext, onSelect, onOpenChange });
  const result = (id) => [...(view.el?.querySelectorAll('[data-search-id]') || [])].find((node) => node.dataset.searchId === id);
  const f = { host, root, stage, opener, context, getContext, view, onSelect, onOpenChange, result };
  fixtures.push(f); return f;
}
function query(f, value) { f.view.input.value = value; f.view.input.dispatchEvent(new Event('input', { bubbles: true })); }
function key(target, value, patch = {}) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, composed: true, ...patch }); target.dispatchEvent(event); return event;
}
function pointer(target, type, patch = {}) {
  const event = Object.assign(new Event(type, { bubbles: true, cancelable: true, composed: true }), { button: 0, pointerId: 1, clientX: 20, clientY: 20, isPrimary: true, ...patch }); target.dispatchEvent(event); return event;
}
function click(target, detail = 0) { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, detail })); }
function press(target) { pointer(target, 'pointerdown'); pointer(target, 'pointerup'); click(target, 1); }
afterEach(() => { for (const f of fixtures.splice(0)) { f.view.dispose(); f.host.remove(); } vi.restoreAllMocks(); });

describe('local grouped house search', () => {
  it('opens a labelled overlay within the stage without resizing it or running any action', () => {
    const f = fixture(); f.opener.focus(); expect(f.view.open(f.opener)).toBe(true);
    expect(f.view.el.parentNode).toBe(f.stage); expect(f.stage.style.height).toBe('520px');
    expect(f.view.el.querySelector('[role=dialog]').getAttribute('aria-labelledby')).toBe(f.view.title.id);
    expect(f.view.el.querySelectorAll('[role=group]')).toHaveLength(5); expect(f.view.el.querySelectorAll('[role=option]')).toHaveLength(5);
    expect(document.activeElement).toBe(f.view.input); expect(f.onSelect).not.toHaveBeenCalled(); expect(f.onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.view.hint.textContent).toContain('never switches');
  });
  it.each([['lounge', ['lounge', 'lamp']], ['READING LAMP', ['lamp']], ['light.reading', ['lamp']], ['colour', ['appearance']], ['front door', ['front']]])('finds %s through friendly labels, details, IDs and supplied keywords', (search, ids) => {
    const f = fixture(); f.view.open(); query(f, search);
    expect([...f.view.el.querySelectorAll('[data-search-id]')].map((node) => node.dataset.searchId)).toEqual(ids); expect(f.onSelect).not.toHaveBeenCalled();
  });
  it('matches accents and multiple words without interpreting user text as HTML', () => {
    const f = fixture([item('room', 'room', { label: 'Chambre à coucher', subtitle: '<img src=x onerror=alert(1)>' })]); f.view.open(); query(f, 'chambre coucher');
    expect(f.result('room')).toBeTruthy(); expect(f.view.el.querySelector('img')).toBeNull(); expect(f.result('room').textContent).toContain('<img');
  });
  it('explains both an empty house and a query with no matches while leaving search open', () => {
    const f = fixture([]); f.view.open(); expect(f.view.status.textContent).toContain('Nothing to search');
    f.context.items = defaults(); f.view.update(); query(f, 'no such device'); expect(f.view.status.textContent).toContain('No matches');
    expect(f.view.isOpen).toBe(true); expect(f.view.input.hasAttribute('aria-activedescendant')).toBe(false);
  });
  it('bounds each group without allowing many devices to hide views and settings', () => {
    const f = fixture([...Array.from({ length: 35 }, (_, index) => item(`device-${index}`)), item('settings', 'setting'), item('garden', 'view')]);
    f.view.open(); expect(f.view.el.querySelectorAll('[data-search-id]')).toHaveLength(14);
    expect(f.result('settings')).toBeTruthy(); expect(f.result('garden')).toBeTruthy(); expect(f.view.status.textContent).toContain('Showing 14');
    query(f, 'device-34'); expect(f.result('device-34')).toBeTruthy(); expect(f.view.status.textContent).toBe('1 result');
  });
  it('omits duplicate destinations and malformed rows without hiding unrelated valid results', () => {
    const f = fixture([item('duplicate'), item('duplicate', 'room'), item('bad', 'automation'), item('empty', 'room', { label: '' }), item('fine')]);
    f.view.open(); expect([...f.view.el.querySelectorAll('[data-search-id]')].map((node) => node.dataset.searchId)).toEqual(['fine']);
  });
  it('does not execute imported item or keyword getters', () => {
    const getter = vi.fn(() => 'bad'), bad = item('getter'), keywords = [];
    Object.defineProperty(bad, 'label', { get: getter }); Object.defineProperty(keywords, '0', { get: getter });
    const f = fixture([bad, item('keyword', 'device', { keywords }), item('fine')]); f.view.open();
    expect(getter).not.toHaveBeenCalled(); expect(f.result('getter')).toBeUndefined(); expect(f.result('keyword')).toBeUndefined(); expect(f.result('fine')).toBeTruthy();
  });
  it.each(['en', 'de', 'fr', 'es'])('provides complete %s captions without modifying HA text', (language) => {
    expect(Object.keys(captions[language]).sort()).toEqual(Object.keys(captions.en).sort());
    const f = fixture(); f.context.hass = { locale: { language } }; f.view.open();
    expect(f.view.title.textContent).toBe(globalSearchText(f.context.hass, 'title')); expect(f.view.closeButton.getAttribute('aria-label')).toBe(captions[language].close);
    expect(globalSearchText(f.context.hass, 'trigger')).toBe(captions[language].trigger);
  });
});

describe('keyboard, pointer and focus ownership', () => {
  it.each([false, true])('uses arrows and Enter to open current controls without focus leaving the input (shadow=%s)', (shadow) => {
    const f = fixture(undefined, { shadow }); f.view.open(); const input = f.view.input;
    key(input, 'ArrowDown'); expect(f.root.getRootNode().activeElement).toBe(input);
    expect(f.result('lamp').getAttribute('aria-selected')).toBe('true'); expect(input.getAttribute('aria-activedescendant')).toBe(f.result('lamp').id);
    key(input, 'Enter'); expect(f.onSelect).toHaveBeenCalledOnce(); expect(f.onSelect.mock.calls[0][0].target).toBe('light.reading_lamp'); expect(f.view.isOpen).toBe(false);
  });
  it('handles result-button Home/End and Space while retaining ordinary input editing keys', () => {
    const f = fixture(); f.view.open(); f.result('lamp').focus(); key(f.result('lamp'), 'End');
    expect(document.activeElement).toBe(f.result('appearance')); key(f.result('appearance'), 'Home'); expect(document.activeElement).toBe(f.result('lounge'));
    expect(key(f.view.input, 'Home').defaultPrevented).toBe(false); expect(key(f.view.input, ' ').defaultPrevented).toBe(false);
    key(f.result('lounge'), ' '); expect(f.onSelect.mock.calls[0][0].id).toBe('lounge');
  });
  it('does not activate repeated Enter or an IME composition', () => {
    const f = fixture(); f.view.open(); key(f.view.input, 'Enter', { repeat: true }); key(f.view.input, 'Enter', { isComposing: true });
    expect(f.onSelect).not.toHaveBeenCalled(); expect(f.view.isOpen).toBe(true);
  });
  it.each([false, true])('closes on local Escape and returns focus to its opener (shadow=%s)', (shadow) => {
    const f = fixture(undefined, { shadow }), escaped = vi.fn(); f.stage.addEventListener('keydown', escaped); f.opener.focus(); f.view.open(f.opener);
    key(f.view.input, 'Escape'); expect(f.view.isOpen).toBe(false); expect(f.root.getRootNode().activeElement).toBe(f.opener);
    expect(escaped).not.toHaveBeenCalled(); expect(f.onSelect).not.toHaveBeenCalled(); expect(f.onOpenChange.mock.calls.map(([value]) => value)).toEqual([true, false]);
  });
  it('closes through a clear close button or first backdrop click without an underlying action', () => {
    const f = fixture(), underlying = vi.fn(); f.stage.addEventListener('click', underlying); f.view.open(); click(f.view.closeButton);
    expect(f.view.isOpen).toBe(false); f.view.open(); click(f.view.el); expect(f.view.isOpen).toBe(false);
    expect(underlying).not.toHaveBeenCalled(); expect(f.onSelect).not.toHaveBeenCalled();
  });
  it('cycles Tab at overlay ends without installing a document shortcut', () => {
    const f = fixture(); f.view.open(); const first = f.view.closeButton, last = f.result('appearance');
    last.focus(); expect(key(last, 'Tab').defaultPrevented).toBe(true); expect(document.activeElement).toBe(first);
    expect(key(first, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true); expect(document.activeElement).toBe(last);
    f.opener.focus(); expect(key(f.opener, 'k', { ctrlKey: true }).defaultPrevented).toBe(false); expect(f.view.isOpen).toBe(true);
  });
  it('keeps the highlighted result aligned with native keyboard focus', () => {
    const f = fixture(); f.view.open(); f.result('appearance').focus();
    expect(f.result('appearance').getAttribute('aria-selected')).toBe('true');
    expect(f.result('lounge').getAttribute('aria-selected')).toBe('false'); expect(f.onSelect).not.toHaveBeenCalled();
  });
  it('selects a deliberate pointer click or native assistive click once', () => {
    const f = fixture(); f.view.open(); press(f.result('lounge')); expect(f.onSelect).toHaveBeenCalledOnce();
    f.view.open(); f.result('front').click(); expect(f.onSelect).toHaveBeenCalledTimes(2); expect(f.onSelect.mock.calls[1][0].kind).toBe('view');
  });
  it.each(['drag', 'cancel', 'wrong pointer', 'orphan', 'other result'])('rejects %s pointer activation', (action) => {
    const f = fixture(); f.view.open(); const result = f.result('lamp');
    if (action !== 'orphan') pointer(result, 'pointerdown');
    if (action === 'drag') pointer(result, 'pointermove', { clientX: 45 });
    if (action === 'cancel') pointer(result, 'pointercancel');
    pointer(action === 'other result' ? f.result('lounge') : result, 'pointerup', { pointerId: action === 'wrong pointer' ? 2 : 1 }); click(result, 1);
    expect(f.onSelect).not.toHaveBeenCalled(); expect(f.view.isOpen).toBe(true);
  });
  it('preserves a focused result through changed captions and ordinary readings', () => {
    const f = fixture(); f.view.open(); f.result('lamp').focus(); f.context.items[1].label = 'Current reading lamp'; f.view.update();
    expect(document.activeElement).toBe(f.result('lamp')); expect(f.result('lamp').textContent).toContain('Current reading lamp'); expect(f.onSelect).not.toHaveBeenCalled();
  });
  it('does not steal external focus on close or refresh', () => {
    const f = fixture(); f.view.open(); f.opener.focus(); f.context.items[1].label = 'New name'; f.view.update();
    expect(document.activeElement).toBe(f.opener); f.view.close(); expect(document.activeElement).toBe(f.opener);
  });
  it('ignores events retained from a closed overlay after a new opening', () => {
    const f = fixture(); f.view.open(); const old = f.result('lamp'); f.view.close(); f.view.open();
    key(old, 'Enter'); press(old); expect(f.onSelect).not.toHaveBeenCalled(); expect(f.view.isOpen).toBe(true);
  });
});

describe('fresh destinations and lifecycle safety', () => {
  it('re-resolves the source immediately before activation instead of passing a stale label', () => {
    const f = fixture(); f.view.open(); f.context.items[1] = item('lamp', 'device', { label: 'Renamed live lamp', target: 'light.reading_lamp' });
    click(f.result('lamp')); expect(f.onSelect.mock.calls[0][0].label).toBe('Renamed live lamp');
  });
  it.each(['removed', 'retargeted', 'kind changed'])('rejects a %s saved result even without a prior update', (change) => {
    const f = fixture(); f.view.open(); const result = f.result('lamp');
    if (change === 'removed') f.context.items.splice(1, 1);
    if (change === 'retargeted') f.context.items[1].target = 'light.different';
    if (change === 'kind changed') f.context.items[1].kind = 'scene';
    click(result); expect(f.onSelect).not.toHaveBeenCalled(); expect(f.view.isOpen).toBe(true); expect(f.view.status.textContent).toContain('no longer available');
  });
  it.each(['context', 'suspended', 'missing hass', 'throwing provider', 'disconnected'])('closes safely after %s changes without restoring old focus', (change) => {
    const f = fixture(); f.view.open(f.opener); const restore = vi.spyOn(f.opener, 'focus');
    if (change === 'context') f.context.contextKey = 'different-account';
    if (change === 'suspended') f.context.suspended = true;
    if (change === 'missing hass') f.context.hass = null;
    if (change === 'throwing provider') f.getContext.mockImplementation(() => { throw new Error('disconnected'); });
    if (change === 'disconnected') f.host.remove();
    f.view.update(); expect(f.view.isOpen).toBe(false); expect(restore).not.toHaveBeenCalled(); expect(f.onSelect).not.toHaveBeenCalled();
  });
  it('rejects a held gesture when its account changes between press and click', () => {
    const f = fixture(); f.view.open(); const result = f.result('lamp'); pointer(result, 'pointerdown');
    f.context.contextKey = 'another-account'; pointer(result, 'pointerup'); click(result, 1);
    expect(f.view.isOpen).toBe(false); expect(f.onSelect).not.toHaveBeenCalled();
  });
  it('checks the root context again after overlay-close callbacks before routing', () => {
    const f = fixture(); f.onOpenChange.mockImplementation((open) => { if (!open) f.context.contextKey = 'changed-during-close'; });
    f.view.open(); click(f.result('lamp')); expect(f.onSelect).not.toHaveBeenCalled();
  });
  it.each(['suspended', 'no hass', 'no callback', 'disposed'])('refuses to open with %s', (state) => {
    const f = fixture(); if (state === 'suspended') f.context.suspended = true;
    if (state === 'no hass') f.context.hass = null; if (state === 'no callback') f.view.onSelect = null; if (state === 'disposed') f.view.dispose();
    expect(f.view.open()).toBe(false); expect(f.view.isOpen).toBe(false); expect(f.onSelect).not.toHaveBeenCalled();
  });
  it('reports a route failure without dispatching another selection', async () => {
    const f = fixture(undefined, { onSelect: vi.fn(() => Promise.reject(new Error('could not open'))) }); f.view.open(); click(f.result('lamp'));
    await Promise.resolve(); await Promise.resolve(); expect(f.view.isOpen).toBe(true); expect(f.view.status.textContent).toContain('Could not open'); expect(f.onSelect).toHaveBeenCalledOnce();
  });
  it('does not reopen an old failed route after a context switch or a newer search', async () => {
    let reject; const promise = new Promise((_, fail) => { reject = fail; });
    const f = fixture(undefined, { onSelect: vi.fn(() => promise) }); f.view.open(); click(f.result('lamp')); f.context.contextKey = 'next-account';
    reject(new Error('late failure')); await Promise.resolve(); await Promise.resolve(); expect(f.view.isOpen).toBe(false);
  });
});
