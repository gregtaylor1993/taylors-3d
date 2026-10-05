// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';

const prototype = customElements.get('taylors3d-card').prototype;

describe('real marker metadata refresh', () => {
  it('uses the current registry name in the marker tooltip instead of an older friendly name', () => {
    const element = document.createElement('button');
    element.innerHTML = '<ha-icon></ha-icon><span class="fp-val"></span>';
    const card = Object.assign(Object.create(prototype), {
      _hass: { entities: { 'sensor.test_temperature': { name: 'Current HA temperature', display_precision: 1 } },
        states: { 'sensor.test_temperature': { state: '20.87654', attributes: { friendly_name: 'Old temperature', unit_of_measurement: '°C' } } } },
      _markers: [{ id: 'device:test', entityId: 'sensor.test_temperature', domain: 'sensor', name: 'Current HA device' }],
      _markerEls: new Map([['device:test', element]]), _positions: new Map(), _view: { setGlows: vi.fn() },
    });
    card._refreshStates();
    expect(element.title).toBe('Current HA device – Current HA temperature');
    expect(element.getAttribute('aria-label')).toBe('Open Current HA device controls');
    expect(element.querySelector('.fp-val').textContent).toBe('20.9 °C');
  });
});
