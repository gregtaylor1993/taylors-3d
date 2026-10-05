// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';

const prototype = customElements.get('taylors3d-card').prototype;
function fixture() {
  const object = { id: 'lamp', type: 'light', suggest: { entity: 'light.lamp' } };
  const card = Object.assign(Object.create(prototype), {
    _hass: { connection: { connected: true }, states: { 'light.lamp': { state: 'on', attributes: {} } },
      entities: {}, devices: {}, services: { light: { toggle: {} } }, callService: vi.fn() },
    _layout: { objects: {}, groups: {} }, _loading: false, _groups: {}, _boundEntities: new Set(),
    _objects: { objectAt: () => ({ obj: object, binding: { entity: 'light.lamp', auto: true } }),
      model: { manifest: { objects: [object] } }, setBindings: vi.fn(), mowerBound: () => false },
  });
  Object.defineProperty(card, 'isConnected', { value: true, writable: true }); return card;
}

describe('model object actions use current registry eligibility', () => {
  it('keeps a valid ordinary light Test action working', () => {
    const card = fixture(); expect(card.testObject('lamp')).toBe(true);
    expect(card._hass.callService).toHaveBeenCalledWith('light', 'toggle', { entity_id: 'light.lamp' });
  });
  it.each([
    ['hidden', { hidden_by: 'user' }], ['disabled', { disabled_by: 'user' }],
    ['diagnostic', { entity_category: 'diagnostic' }], ['device-disabled', { device_id: 'disabled' }],
  ])('rejects a stale Test target that has become %s', (_name, metadata) => {
    const card = fixture(); card._hass.entities['light.lamp'] = metadata;
    card._hass.devices.disabled = { disabled_by: 'user' };
    expect(card.testObject('lamp')).toBe(false); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['disconnected', 'detached', 'loading', 'missing-service'])('rejects a %s Test without throwing', (mode) => {
    const card = fixture();
    if (mode === 'disconnected') card._hass.connection.connected = false;
    if (mode === 'detached') card.isConnected = false;
    if (mode === 'loading') card._loading = true;
    if (mode === 'missing-service') card._hass.services = {};
    expect(card.testObject('lamp')).toBe(false); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('recomputes binding eligibility when registry metadata changes with identical model, layout and states', () => {
    const card = fixture(); card._syncBindings(); expect(card._bindings.get('lamp').entity).toBe('light.lamp');
    card._hass.entities['light.lamp'] = { hidden_by: 'user' };
    card._syncBindings();
    expect(card._bindings.get('lamp')).toMatchObject({ entity: null, requestedEntity: 'light.lamp', filtered: true });
    expect(card._boundEntities.has('light.lamp')).toBe(false);
  });
});
