// @vitest-environment jsdom
// These checks exercise the real Root commit and coalesced-update boundaries.
// They are intentionally separate from the PlanSecurityLayer-only tests: a
// replace/recover sequence must be observed before a scheduled update runs.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const cards = [];
const originalEntity = 'lock.commit_original';
const replacementEntity = 'lock.commit_replacement';
const gestures = ['pointer', 'Space', 'Enter'];
const plainCopy = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function fixture() {
  const card = document.createElement('taylors3d-card');
  Object.defineProperty(card, 'isConnected', { value: true });
  const source = freeze({ security_bindings: [{ id: 'entry', entity: originalEntity, kind: 'lock', enabled: true,
    target: { type: 'plan', position: { x: 1, y: 2, z: .4, floorId: 'upper' } } }],
  rooms: {}, floors: {} });
  card._config = freeze({ layout_key: 'security-commit-test', view: '3d' });
  card._layout = source;
  card._hass = { connection: { connected: true }, user: { id: 'simulated-commit-admin', is_admin: true, is_active: true },
    states: { [originalEntity]: { state: 'unlocked', attributes: { friendly_name: 'Original simulated lock' } },
      [replacementEntity]: { state: 'unlocked', attributes: { friendly_name: 'Replacement simulated lock' } } },
    entities: {}, devices: {}, callService: vi.fn() };
  card._floors = [{ id: 'ground', elevation: 0 }, { id: 'upper', elevation: 3 }];
  card._roomList = []; card._positions = new Map(); card._markers = [];
  card._view = { model: null, scene: new THREE.Scene(), dirty: false, modelClip: null, sectionClip: null,
    modelMotionChanged: vi.fn(() => ({ changed: false, objectIds: new Set() })),
    floorElevation: (id) => card._floors.find((floor) => floor.id === id)?.elevation ?? 0,
    screenPoint: vi.fn(() => [50, 60]) };
  card._objects = { parts: new Map(), objectAt: () => null, anchors: () => [] };
  card._popup = { close: vi.fn() };
  card._devicePopup = { close: vi.fn(), update: vi.fn(), showMarker: vi.fn() };
  card._edit = { setSaveState: vi.fn(), updateHistoryState: vi.fn() };
  const persisted = [];
  card._store = { save: vi.fn((_hass, layout) => {
    persisted.push(plainCopy(layout));
    return Promise.resolve(true);
  }) };
  const queued = [];
  vi.stubGlobal('queueMicrotask', (callback) => queued.push(callback));
  card.resetHistory(); card._syncSecurity();
  const sourceJson = JSON.stringify(source), statesJson = JSON.stringify(card._hass.states);
  cards.push(card);
  return { card, source, persisted, queued, sourceJson, statesJson };
}
function press(button, gesture) {
  if (gesture === 'pointer') button.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }));
  else button.dispatchEvent(new KeyboardEvent('keydown', { key: gesture === 'Space' ? ' ' : 'Enter' }));
}
function release(button, gesture) {
  if (gesture === 'pointer') button.dispatchEvent(new MouseEvent('pointerup', { button: 0 }));
  else button.dispatchEvent(new KeyboardEvent('keyup', { key: gesture === 'Space' ? ' ' : 'Enter' }));
  // jsdom does not synthesize the browser's button activation after release.
  button.click();
}
function confirmNoAutomaticAction(ctx) {
  expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  expect(JSON.stringify(ctx.source)).toBe(ctx.sourceJson);
  expect(JSON.stringify(ctx.card._hass.states)).toBe(ctx.statesJson);
}
beforeAll(async () => { await import('../src/taylors3d-card.js'); });
afterEach(() => {
  for (const card of cards.splice(0)) {
    card._clearTrackingTimer(); card._securityLayer?.dispose(); card._planSecurityLayer?.dispose();
  }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

describe('security intents at the actual Root layout commit boundary', () => {
  it.each(gestures)('cancels an old held %s press through same-tick source replacement and recovery', (gesture) => {
    const ctx = fixture(), { card, source, queued, persisted } = ctx;
    const old = card._planSecurityLayer.parts.get('entry').body;
    press(old, gesture);
    const replacement = freeze(source.security_bindings.map((binding) => ({ ...binding, entity: replacementEntity })));
    card.commitFeatureLayout({ security_bindings: replacement });
    card.commitFeatureLayout({ security_bindings: source.security_bindings });
    // Exercise the actual scheduler; neither update has run before release.
    expect(queued).toHaveLength(1); expect(card._pending).toBe(true);
    expect(persisted).toEqual([{ ...source, security_bindings: replacement }, source]);
    expect(card._history.size).toBe(2); expect(card._history.current.layout).toEqual(source);
    expect(card._history.undo().layout.security_bindings).toEqual(replacement);
    expect(card._history.undo().layout).toEqual(source);
    expect(card._history.redo().layout.security_bindings).toEqual(replacement);
    expect(card._history.redo().layout).toEqual(source);
    confirmNoAutomaticAction(ctx);
    release(old, gesture);
    expect(card._devicePopup.showMarker).not.toHaveBeenCalled();
    const fresh = card._planSecurityLayer.parts.get('entry').body;
    press(fresh, gesture); release(fresh, gesture);
    expect(card._devicePopup.showMarker).toHaveBeenCalledOnce();
    expect(card._devicePopup.showMarker).toHaveBeenLastCalledWith(
      expect.objectContaining({ entityId: originalEntity }), [50, 60]);
    confirmNoAutomaticAction(ctx);
  });

  it.each(gestures)('gives a fresh %s press the currently shown replacement before the coalesced update', (gesture) => {
    const ctx = fixture(), { card, source, queued, persisted } = ctx;
    const replacement = freeze(source.security_bindings.map((binding) => ({ ...binding, entity: replacementEntity })));
    card.commitFeatureLayout({ security_bindings: replacement });
    expect(queued).toHaveLength(1); expect(card._pending).toBe(true);
    expect(persisted).toEqual([{ ...source, security_bindings: replacement }]);
    expect(card._history.size).toBe(1);
    expect(card._devicePopup.showMarker).not.toHaveBeenCalled();
    confirmNoAutomaticAction(ctx);
    const current = card._planSecurityLayer.parts.get('entry');
    // Opening the current entity alone is insufficient: the visible label must
    // describe that entity before a user starts a deliberate fresh press.
    expect(current.record.entity).toBe(replacementEntity);
    expect(current.body.textContent).toContain('Replacement simulated lock');
    press(current.body, gesture); release(current.body, gesture);
    expect(card._devicePopup.showMarker).toHaveBeenCalledOnce();
    expect(card._devicePopup.showMarker).toHaveBeenLastCalledWith(
      expect.objectContaining({ entityId: replacementEntity }), [50, 60]);
    confirmNoAutomaticAction(ctx);
  });

  for (const change of ['equal security clone', 'unrelated layout setting']) {
    it.each(gestures)(`preserves an eligible held %s press for ${change}`, (gesture) => {
      const ctx = fixture(), { card, source, queued, persisted } = ctx;
      const part = card._planSecurityLayer.parts.get('entry'), old = part.body;
      const generation = card._securitySessionGeneration;
      const resources = [part.group, part.glyph.geometry, part.ring.geometry, part.lineMaterial, part.ringMaterial];
      card._view.dirty = false;
      press(old, gesture);
      const patch = change === 'equal security clone'
        ? { security_bindings: freeze(plainCopy(source.security_bindings)) }
        : { room_overlays: freeze({ mode: 'temperature', minimum: 5, maximum: 30 }) };
      card.commitFeatureLayout(patch);
      expect(queued).toHaveLength(1); expect(persisted).toEqual([{ ...source, ...patch }]);
      expect(card._history.size).toBe(change === 'equal security clone' ? 0 : 1);
      expect(card._securitySessionGeneration).toBe(generation);
      expect(card._planSecurityLayer.parts.get('entry')).toBe(part);
      expect(part.body).toBe(old);
      expect([part.group, part.glyph.geometry, part.ring.geometry, part.lineMaterial, part.ringMaterial]).toEqual(resources);
      expect(card._view.dirty).toBe(false);
      expect(card._devicePopup.showMarker).not.toHaveBeenCalled();
      confirmNoAutomaticAction(ctx);
      release(old, gesture);
      expect(card._devicePopup.showMarker).toHaveBeenCalledOnce();
      expect(card._devicePopup.showMarker).toHaveBeenLastCalledWith(
        expect.objectContaining({ entityId: originalEntity }), [50, 60]);
      confirmNoAutomaticAction(ctx);
    });
  }
});
