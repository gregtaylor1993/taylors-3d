// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevicePopup, entityControl, markerEntityIds, roomEntityIds } from '../src/device-popup.js';
import { buildMarkers } from '../src/registry.js';

const state = (value, attributes = {}) => ({ state: value, attributes });
const light = { id: 'device:lamp', name: 'Desk lamp', areaId: 'office', entityId: 'light.desk',
  entities: [{ eid: 'light.desk' }, { eid: 'sensor.power' }], secondaryId: 'sensor.power' };
const climate = { id: 'entity:climate.heating', name: 'Heating', areaId: 'office', entityId: 'climate.heating', entities: [] };
const frontCamera = { id: 'entity:camera.front', name: 'Front camera', areaId: 'office', entityId: 'camera.front',
  entities: [{ eid: 'camera.front' }, { eid: 'binary_sensor.motion' }] };
const hass = () => ({
  areas: { office: { name: 'Office' }, lounge: { name: 'Lounge' } },
  entities: {},
  states: {
    'light.desk': state('on', { friendly_name: 'Desk lamp', brightness: 128, supported_color_modes: ['brightness'] }),
    'sensor.power': state('32.1', { friendly_name: 'Lamp power', unit_of_measurement: 'W' }),
    'climate.heating': state('heat', { friendly_name: 'Heating' }),
    'switch.tv': state('off', { friendly_name: 'TV socket' }),
  },
});

class PopupCameraCard extends HTMLElement {
  constructor() { super(); this.connections = 0; this.disconnections = 0; }
  connectedCallback() { this.connections++; }
  disconnectedCallback() { this.disconnections++; }
}
customElements.define('test-t3d-popup-camera', PopupCameraCard);

describe('room and marker entity membership', () => {
  it('keeps every grouped device entity once, including secondary sensors', () => {
    expect(markerEntityIds(light)).toEqual(['light.desk', 'sensor.power']);
    expect(markerEntityIds({ entityId: 'lawn_mower.live', entities: [] })).toEqual(['lawn_mower.live']);
  });

  it('selects a room by HA area and removes entities duplicated across markers', () => {
    const elsewhere = { entityId: 'switch.tv', areaId: 'lounge' };
    const repeated = { entityId: 'sensor.power', areaId: 'office' };
    expect(roomEntityIds({ area_id: 'office' }, [light, climate, elsewhere, repeated]))
      .toEqual(['light.desk', 'sensor.power', 'climate.heating']);
    expect(roomEntityIds({ id: 'unmapped' }, [light])).toEqual([]);
  });
});

describe('DevicePopup', () => {
  let stage, popup, onAction, onMoreInfo;
  beforeEach(() => {
    stage = document.createElement('div');
    stage.getBoundingClientRect = () => ({ left: 100, top: 50, width: 600, height: 450 });
    document.body.append(stage);
    onAction = vi.fn().mockResolvedValue(undefined);
    onMoreInfo = vi.fn();
    popup = new DevicePopup(stage, { onAction, onMoreInfo });
    popup.update(hass());
  });
  afterEach(() => {
    popup.dispose();
    stage.remove();
    vi.restoreAllMocks();
  });

  const rowFor = (popup, id) => [...popup.el.querySelectorAll('.t3d-entity')].find((el) => el.dataset.entity === id);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

  it('opening reads live values and never changes a device', () => {
    popup.showMarker(light, [180, 120]);
    expect(popup.isOpen).toBe(true);
    expect(popup.el.getAttribute('aria-label')).toBe('Desk lamp');
    expect(rowFor(popup, 'sensor.power').querySelector('.t3d-entity-value').textContent).toBe('32.1 W');
    expect(onAction).not.toHaveBeenCalled();
    expect(onMoreInfo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(popup.el.querySelector('[data-action="close"]'));
  });

  it('room controls include the grouped device sensors and exclude other rooms and registry-hidden entities', () => {
    const h = hass();
    h.entities['sensor.diagnostic'] = { entity_category: 'diagnostic' };
    h.entities['sensor.hidden'] = { hidden: true };
    h.states['sensor.diagnostic'] = state('1');
    h.states['sensor.hidden'] = state('1');
    popup.update(h);
    popup.showRoom({ id: 'office-room', area_id: 'office' }, [light, climate,
      { areaId: 'lounge', entityId: 'switch.tv' },
      { areaId: 'office', entityId: 'sensor.diagnostic' },
      { areaId: 'office', entityId: 'sensor.hidden' }]);
    expect(popup.el.getAttribute('aria-label')).toBe('Office');
    expect([...popup.el.querySelectorAll('.t3d-entity')].map((el) => el.dataset.entity))
      .toEqual(['light.desk', 'sensor.power', 'climate.heating']);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('reports an unmapped room without displaying unrelated devices', () => {
    popup.showRoom({ id: 'garden', name: 'Garden' }, [light, climate]);
    expect(popup.el.textContent).toContain('No devices are assigned to this room.');
    expect(popup.el.querySelectorAll('.t3d-entity')).toHaveLength(0);
  });

  it('sends an explicit toggle only when clicked and blocks duplicate pending clicks', async () => {
    let resolve;
    onAction.mockReturnValue(new Promise((r) => { resolve = r; }));
    popup.showMarker(light);
    const toggle = rowFor(popup, 'light.desk').querySelector('[data-action="toggle"]');
    toggle.click();
    toggle.click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'toggle', { entity_id: 'light.desk' });
    expect(toggle.disabled).toBe(true);
    expect(rowFor(popup, 'light.desk').textContent).toContain('Sending command…');
    resolve();
    await flush();
    expect(toggle.disabled).toBe(false);
    // Still on until a new HA state arrives; a resolved request is not a device state.
    expect(toggle.textContent).toBe('Turn off');
  });

  it('sends brightness once on release and turns the light off at zero', async () => {
    popup.showMarker(light);
    const slider = rowFor(popup, 'light.desk').querySelector('input');
    slider.value = '40';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onAction).not.toHaveBeenCalled();
    expect(rowFor(popup, 'light.desk').textContent).toContain('Brightness: 40%');
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onAction).toHaveBeenNthCalledWith(1, 'light', 'turn_on', { entity_id: 'light.desk', brightness: 102 });
    await flush();
    slider.value = '0';
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onAction).toHaveBeenNthCalledWith(2, 'light', 'turn_off', { entity_id: 'light.desk' });
  });

  it('does not offer brightness for on/off lights or unknown unsupported domains', () => {
    const h = hass();
    h.states['light.desk'] = state('on', { supported_color_modes: ['onoff'], brightness: 255 });
    popup.update(h);
    popup.showMarker(light);
    expect(rowFor(popup, 'light.desk').querySelector('input')).toBeNull();
    popup.showMarker(climate);
    expect(popup.el.querySelector('[data-action="toggle"]')).toBeNull();
    expect(popup.el.querySelector('[data-action="more-info"]')).not.toBeNull();
  });

  it('gates quick controls on registered HA services when the service registry is present', () => {
    const h = hass();
    h.services = { light: { turn_on: {}, turn_off: {} } };
    expect(entityControl(h, 'light.desk')).toMatchObject({ toggle: false, dimmable: true });
    h.services = {};
    expect(entityControl(h, 'light.desk')).toMatchObject({ toggle: false, dimmable: false });
  });

  it('uses HA display names and formatted readings without adding a second unit', () => {
    const h = hass();
    h.formatEntityName = (st) => `Translated ${st.attributes.friendly_name}`;
    h.formatEntityState = (st) => st.attributes.unit_of_measurement ? '32,10 Watts' : 'Allumé';
    popup.update(h);
    popup.showMarker(light);
    const power = rowFor(popup, 'sensor.power');
    expect(power.querySelector('.t3d-entity-name').textContent).toBe('Translated Lamp power');
    expect(power.querySelector('.t3d-entity-value').textContent).toBe('32,10 Watts');
    expect(rowFor(popup, 'light.desk').querySelector('[data-action="toggle"]').getAttribute('aria-label'))
      .toBe('Translated Desk lamp: turn off');
    expect(rowFor(popup, 'light.desk').querySelector('input').getAttribute('aria-label'))
      .toBe('Translated Desk lamp: brightness');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('fallback readings respect registry display precision and locale', () => {
    const h = hass();
    h.locale = { language: 'en', number_format: 'decimal_comma' };
    h.entities['sensor.power'] = { name: 'Measured power', display_precision: 2 };
    popup.update(h);
    popup.showMarker(light);
    const power = rowFor(popup, 'sensor.power');
    expect(power.querySelector('.t3d-entity-name').textContent).toBe('Measured power');
    expect(power.querySelector('.t3d-entity-value').textContent).toBe('32,10 W');
  });

  it.each(['entity', 'device', 'connection'])('disables quick controls when %s is disabled or disconnected despite a retained state', (reason) => {
    const h = hass();
    if (reason === 'entity') h.entities['light.desk'] = { disabled_by: 'user' };
    else if (reason === 'device') {
      h.entities['light.desk'] = { device_id: 'lamp' };
      h.devices = { lamp: { disabled_by: 'user' } };
    } else h.connected = false;
    popup.update(h);
    popup.showMarker(light);
    const row = rowFor(popup, 'light.desk');
    expect(row.querySelector('[data-action="toggle"]').disabled).toBe(true);
    expect(row.querySelector('input').disabled).toBe(true);
    expect(row.querySelector('[data-action="more-info"]').disabled).toBe(false);
    row.querySelector('[data-action="toggle"]').click();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('All controls opens HA more-info for the chosen grouped entity', () => {
    popup.showMarker(light);
    rowFor(popup, 'sensor.power').querySelector('[data-action="more-info"]').click();
    expect(onMoreInfo).toHaveBeenCalledExactlyOnceWith('sensor.power');
    expect(onAction).not.toHaveBeenCalled();
    expect(popup.isOpen).toBe(false);
  });

  it('disables quick actions for unavailable, unknown and missing states while retaining All controls', () => {
    for (const value of ['unavailable', 'unknown', null]) {
      const h = hass();
      if (value) h.states['light.desk'] = state(value, { supported_color_modes: ['brightness'] });
      else delete h.states['light.desk'];
      popup.update(h);
      popup.showMarker(light);
      const row = rowFor(popup, 'light.desk');
      expect(row.querySelector('[data-action="toggle"]').disabled).toBe(true);
      expect(row.querySelector('[data-action="more-info"]').disabled).toBe(false);
      row.querySelector('[data-action="toggle"]').click();
      const slider = row.querySelector('input');
      if (slider) { slider.value = '50'; slider.dispatchEvent(new Event('change', { bubbles: true })); }
      expect(row.querySelector('.t3d-entity-value').textContent).toBe(value === 'unknown' ? 'Unknown' : 'Unavailable');
    }
    expect(onAction).not.toHaveBeenCalled();
  });

  it('updates live states and values without replacing focused controls or sending requests', () => {
    popup.showMarker(light);
    const row = rowFor(popup, 'light.desk');
    const slider = row.querySelector('input');
    slider.focus();
    slider.value = '70';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    const h = hass();
    h.states['light.desk'] = state('off', { brightness: 128, supported_color_modes: ['brightness'] });
    h.states['sensor.power'] = state('0', { friendly_name: 'Lamp power', unit_of_measurement: 'W' });
    popup.update(h);
    expect(rowFor(popup, 'light.desk').querySelector('input')).toBe(slider);
    expect(document.activeElement).toBe(slider);
    expect(slider.value).toBe('70');
    expect(row.querySelector('[data-action="toggle"]').textContent).toBe('Turn on');
    expect(rowFor(popup, 'sensor.power').querySelector('.t3d-entity-value').textContent).toBe('0 W');
    slider.blur();
    expect(slider.value).toBe('0');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('shows asynchronous HA errors safely and permits a retry', async () => {
    onAction.mockRejectedValueOnce(new Error('<img src=x onerror=alert(1)> denied')).mockResolvedValueOnce(undefined);
    popup.showMarker(light);
    const toggle = rowFor(popup, 'light.desk').querySelector('[data-action="toggle"]');
    toggle.click();
    await flush();
    expect(toggle.disabled).toBe(false);
    const error = rowFor(popup, 'light.desk').querySelector('[role="alert"]');
    expect(error.textContent).toContain('Command failed: <img src=x onerror=alert(1)> denied');
    expect(error.querySelector('img')).toBeNull();
    popup.update(hass());
    expect(error.hidden).toBe(false);
    toggle.click();
    await flush();
    expect(error.hidden).toBe(true);
  });

  it('does not attach an old command error to a newly opened room or marker', async () => {
    let reject;
    onAction.mockReturnValue(new Promise((_resolve, r) => { reject = r; }));
    popup.showMarker(light);
    rowFor(popup, 'light.desk').querySelector('[data-action="toggle"]').click();
    popup.showMarker(climate);
    reject(new Error('Old command failed'));
    await flush();
    expect(popup.el.textContent).not.toContain('Old command failed');
    expect(popup.el.getAttribute('aria-label')).toBe('Heating');
  });

  it('renders model names and HA values as text instead of executable markup', () => {
    const h = hass();
    h.states['sensor.power'] = state('<img src=x>', { friendly_name: '<script>unsafe</script>' });
    popup.update(h);
    popup.showMarker({ ...light, name: '<svg onload=alert(1)>' });
    expect(popup.el.querySelector('svg, script, img')).toBeNull();
    expect(popup.el.querySelector('h3').textContent).toBe('<svg onload=alert(1)>');
    expect(rowFor(popup, 'sensor.power').textContent).toContain('<script>unsafe</script>');
  });

  it('stops popup gestures from selecting the room behind it', () => {
    const behind = vi.fn();
    stage.addEventListener('pointerdown', behind);
    stage.addEventListener('click', behind);
    popup.showMarker(light);
    const info = rowFor(popup, 'sensor.power').querySelector('[data-action="more-info"]');
    info.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    info.click();
    expect(behind).not.toHaveBeenCalled();
  });

  it('Escape closes and restores keyboard focus to the opener', () => {
    const opener = document.createElement('button');
    stage.append(opener);
    opener.focus();
    popup.showMarker(light);
    popup.el.querySelector('[data-action="close"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popup.isOpen).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('outside pointer closes and records the exact event so the card can suppress another action', () => {
    popup.showMarker(light);
    const outside = new Event('pointerdown', { bubbles: true, composed: true });
    stage.dispatchEvent(outside);
    expect(popup.isOpen).toBe(false);
    expect(popup.closedBy).toBe(outside);
  });

  it('clamps the popup inside the stage when the tap is near an edge', () => {
    popup.showMarker(light, [695, 490]);
    expect(popup.el.style.left).toBe('292px');
    expect(popup.el.style.top).toBe('142px');
    popup.reposition([0, 0]);
    expect(popup.el.style.left).toBe('8px');
    expect(popup.el.style.top).toBe('8px');
  });

  it('can dock on the right, change placement while open and release reserved space on close', () => {
    const changed = vi.fn();
    popup.onVisibilityChange = changed;
    popup.setPlacement('right');
    popup.showRoom({ id: 'office', area_id: 'office' }, [light]);
    expect(popup.el.dataset.placement).toBe('right');
    expect(popup.el.dataset.taylors3dUi).toBe('');
    expect(popup.el.style.left).toBe('');
    expect(popup.el.style.top).toBe('');
    expect(changed).toHaveBeenLastCalledWith(true, 'right');
    popup.setPlacement('popup');
    expect(popup.el.style.left).not.toBe('');
    expect(changed).toHaveBeenLastCalledWith(true, 'popup');
    popup.close();
    expect(changed).toHaveBeenLastCalledWith(false, 'popup');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('dispose removes UI and global listeners, even after an in-flight action', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    let resolve;
    onAction.mockReturnValue(new Promise((r) => { resolve = r; }));
    popup.showMarker(light);
    rowFor(popup, 'light.desk').querySelector('[data-action="toggle"]').click();
    popup.dispose();
    expect(stage.querySelector('.taylors3d-device-popup')).toBeNull();
    expect(remove).toHaveBeenCalledWith('pointerdown', popup._onOutside, true);
    expect(remove).toHaveBeenCalledWith('keydown', popup._onKey);
    resolve();
    await flush();
    popup.update(hass());
    expect(popup.isOpen).toBe(false);
    expect(stage.children).toHaveLength(0);
  });

  describe('supported light colour controls', () => {
    const colourHass = (attributes = {}) => {
      const h = hass();
      h.states['light.desk'] = state('on', { friendly_name: 'Desk lamp', brightness: 128,
        supported_color_modes: ['rgb', 'color_temp'], color_mode: 'rgb', rgb_color: [255, 59, 48],
        min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, ...attributes });
      return h;
    };
    const inputFor = (kind) => rowFor(popup, 'light.desk').querySelector(`[data-light-control="${kind}"]`);
    const swatch = (name = 'Blue') => rowFor(popup, 'light.desk').querySelector(`[data-color-name="${name}"]`);

    it.each(['marker', 'room', 'model'])('opens supported %s colour controls without requesting or changing a light', (kind) => {
      const h = colourHass(); h.callService = vi.fn(); h.callWS = vi.fn(); popup.update(h);
      if (kind === 'room') popup.showRoom({ area_id: 'office' }, [light]);
      else popup.showMarker(kind === 'model' ? { entityId: 'light.desk', name: 'Bound ceiling fixture', entities: ['light.desk'] } : light);
      expect(inputFor('color').type).toBe('color'); expect(inputFor('kelvin').min).toBe('2200'); expect(inputFor('kelvin').max).toBe('6500');
      expect(rowFor(popup, 'light.desk').querySelectorAll('[data-action="color-swatch"]')).toHaveLength(8);
      expect(swatch('Red').getAttribute('aria-pressed')).toBe('true'); expect(inputFor('color').value).toBe('#ff3b30');
      expect(rowFor(popup, 'light.desk').querySelector('[data-action="more-info"]')).not.toBeNull();
      if (kind !== 'model') expect(rowFor(popup, 'sensor.power')).toBeTruthy();
      expect(onAction).not.toHaveBeenCalled(); expect(h.callService).not.toHaveBeenCalled(); expect(h.callWS).not.toHaveBeenCalled();
    });

    it.each(['rgb', 'hs', 'xy', 'rgbw', 'rgbww'])('offers deliberate RGB actions for declared %s support', (mode) => {
      popup.update(colourHass({ supported_color_modes: [mode], color_mode: mode })); popup.showMarker(light);
      expect(inputFor('color')).not.toBeNull(); expect(inputFor('kelvin')).toBeNull();
      swatch().click(); expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.desk', rgb_color: [10, 132, 255] });
    });

    it.each([['onoff'], ['brightness'], ['color_temp'], ['future_mode'], [], null, 'rgb'].map((modes) => ({ modes })))('does not invent RGB support from an old RGB attribute: $modes', ({ modes }) => {
      const h = colourHass({ supported_color_modes: modes, color_mode: Array.isArray(modes) ? modes[0] : 'rgb' });
      popup.update(h); popup.showMarker(light);
      expect(inputFor('color')).toBeNull(); expect(swatch()).toBeNull();
      expect(rowFor(popup, 'light.desk').querySelector('[data-action="more-info"]')).not.toBeNull(); expect(onAction).not.toHaveBeenCalled();
    });

    it.each([
      { min_color_temp_kelvin: null }, { max_color_temp_kelvin: null }, { min_color_temp_kelvin: 0 },
      { max_color_temp_kelvin: Infinity }, { min_color_temp_kelvin: '2200' }, { min_color_temp_kelvin: 7000 },
    ])('omits Kelvin commands when actual bounds are missing or invalid: %j', (bounds) => {
      popup.update(colourHass(bounds)); popup.showMarker(light); expect(inputFor('kelvin')).toBeNull();
      expect(rowFor(popup, 'light.desk').querySelector('[data-action="more-info"]')).not.toBeNull(); expect(onAction).not.toHaveBeenCalled();
    });

    it('reports missing current temperature honestly while letting an online capable light accept a deliberate value', () => {
      popup.update(colourHass({ color_mode: 'color_temp', color_temp_kelvin: null, rgb_color: null })); popup.showMarker(light);
      const slider = inputFor('kelvin'); expect(slider).not.toBeNull();
      expect(rowFor(popup, 'light.desk').textContent).toContain('Colour temperature: not reported');
      expect(rowFor(popup, 'light.desk').textContent).not.toContain('2700 K'); expect(slider.getAttribute('aria-valuetext')).toContain('not reported');
      slider.value = '4100'; slider.dispatchEvent(new Event('input', { bubbles: true })); expect(onAction).not.toHaveBeenCalled();
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.desk', color_temp_kelvin: 4100 });
    });

    it('does not invent a reported brightness, but accepts an explicit supported brightness setting', () => {
      popup.update(colourHass({ brightness: null })); popup.showMarker(light);
      const slider = inputFor('brightness');
      expect(rowFor(popup, 'light.desk').textContent).toContain('Brightness: not reported');
      expect(slider.disabled).toBe(false);
      slider.value = '60'; slider.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onAction).not.toHaveBeenCalled();
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.desk', brightness: 153 });
    });

    it('marks unknown XY appearance as not reported without selecting a fake white swatch', () => {
      popup.update(colourHass({ supported_color_modes: ['xy'], color_mode: 'xy', rgb_color: null, xy_color: [.3, .4] })); popup.showMarker(light);
      expect(rowFor(popup, 'light.desk').textContent).toContain('Current colour: not reported');
      expect(inputFor('color').value).toBe('#ffffff');
      expect(rowFor(popup, 'light.desk').querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
      expect(onAction).not.toHaveBeenCalled();
      swatch().click(); expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.desk', rgb_color: [10, 132, 255] });
    });

    it.each(['attributes', 'domain', 'state'])('blocks all inline commands from a malformed basic %s source', (kind) => {
      const h = colourHass();
      if (kind === 'attributes') h.states['light.desk'].attributes = [];
      else if (kind === 'domain') h.states['light.desk'].entity_id = 'switch.desk';
      else h.states['light.desk'].state = 1;
      popup.update(h); popup.showMarker(light);
      const toggle = rowFor(popup, 'light.desk').querySelector('[data-action="toggle"]');
      expect(toggle.disabled).toBe(true); toggle.click(); expect(onAction).not.toHaveBeenCalled();
      expect(rowFor(popup, 'light.desk').querySelector('[data-action="more-info"]').disabled).toBe(false);
    });

    it('retains a physical toggle when only current appearance is malformed', () => {
      popup.update(colourHass({ rgb_color: ['red', 2, 3] })); popup.showMarker(light);
      const toggle = rowFor(popup, 'light.desk').querySelector('[data-action="toggle"]');
      expect(toggle.disabled).toBe(false); expect(rowFor(popup, 'light.desk').textContent).toContain('Current colour: not reported');
      toggle.click(); expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'toggle', { entity_id: 'light.desk' });
    });

    it('labels a restored on reading as waiting rather than presenting it as current', () => {
      popup.update(colourHass({ restored: true })); popup.showMarker(light); const row = rowFor(popup, 'light.desk');
      expect(row.querySelector('.t3d-entity-value').textContent).toBe('Waiting for a current light reading');
      expect(row.querySelector('[data-action="toggle"]').disabled).toBe(true); expect(inputFor('color')).toBeNull();
      popup.update(colourHass({ restored: 'false' }));
      expect(row.querySelector('.t3d-entity-value').textContent).toBe('Invalid light reading'); expect(onAction).not.toHaveBeenCalled();
    });

    it('rechecks a swatch source immediately even if no state refresh has yet rebuilt its row', () => {
      const h = colourHass(); popup.update(h); popup.showMarker(light);
      h.connection = { connected: false }; swatch().click(); expect(onAction).not.toHaveBeenCalled();
      delete h.connection; h.states['light.desk'].attributes.restored = true; swatch().click(); expect(onAction).not.toHaveBeenCalled();
    });

    it('does not replace a focused row twice when Chrome synchronously blurs it during capability removal', () => {
      const h = colourHass(); popup.update(h); popup.showMarker(light); const picker = inputFor('color');
      picker.focus(); picker.value = '#123456'; picker.dispatchEvent(new Event('input', { bubbles: true }));
      const oldRow = rowFor(popup, 'light.desk'), parent = oldRow.parentNode;
      const replace = oldRow.replaceWith.bind(oldRow); let emitted = false;
      // jsdom does not emit the removal blur Chrome produces. Reproduce that real
      // synchronous event ordering and Chrome's original-parent removal requirement.
      oldRow.replaceWith = vi.fn((...nodes) => {
        if (!emitted) { emitted = true; picker.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }
        if (oldRow.parentNode !== parent) throw new DOMException('Row already replaced during blur', 'NotFoundError');
        replace(...nodes);
      });
      h.states['light.desk'].attributes.supported_color_modes = ['brightness'];
      h.states['light.desk'].attributes.color_mode = 'brightness';
      expect(() => popup.update(h)).not.toThrow();
      expect(oldRow.replaceWith).toHaveBeenCalledTimes(1); expect(inputFor('color')).toBeNull();
      expect(inputFor('brightness')).not.toBeNull();
      expect(popup.el.querySelectorAll('[data-entity="light.desk"].t3d-entity')).toHaveLength(1);
      picker.dispatchEvent(new Event('change', { bubbles: true })); expect(onAction).not.toHaveBeenCalled();
      popup.update(colourHass()); const next = inputFor('color'); expect(next).not.toBeNull();
      next.value = '#123456'; next.dispatchEvent(new Event('input', { bubbles: true })); next.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.desk', rgb_color: [18, 52, 86] });
    });

    it('native colour input previews locally and sends one payload on change, with actual state still authoritative', async () => {
      const h = colourHass(); popup.update(h); popup.showMarker(light);
      const picker = inputFor('color'); picker.focus(); picker.value = '#010203';
      picker.dispatchEvent(new Event('input', { bubbles: true }));
      expect(rowFor(popup, 'light.desk').textContent).toContain('Choice: #010203');
      expect(rowFor(popup, 'light.desk').textContent).toContain('Current colour: #ff3b30'); expect(onAction).not.toHaveBeenCalled();
      picker.dispatchEvent(new Event('change', { bubbles: true })); await flush();
      expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.desk', rgb_color: [1, 2, 3] });
      expect(inputFor('color')).toBe(picker); expect(document.activeElement).toBe(picker); expect(picker.value).toBe('#ff3b30');
      expect(swatch('Red').getAttribute('aria-pressed')).toBe('true'); expect(swatch('Blue').getAttribute('aria-pressed')).toBe('false');
      popup.update(colourHass({ rgb_color: [1, 2, 3] }));
      expect(picker.value).toBe('#010203'); expect(rowFor(popup, 'light.desk').textContent).toContain('Current colour: #010203');
    });

    it('Kelvin input previews without action, sends once on release, then waits for the actual reported temperature', async () => {
      popup.update(colourHass({ color_mode: 'color_temp', color_temp_kelvin: 3000 })); popup.showMarker(light);
      const slider = inputFor('kelvin'); slider.value = '4800'; slider.dispatchEvent(new Event('input', { bubbles: true }));
      expect(rowFor(popup, 'light.desk').textContent).toContain('Choose temperature: 4800 K'); expect(onAction).not.toHaveBeenCalled();
      slider.dispatchEvent(new Event('change', { bubbles: true })); await flush();
      expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.desk', color_temp_kelvin: 4800 });
      expect(rowFor(popup, 'light.desk').textContent).toContain('Colour temperature: 3000 K'); expect(slider.value).toBe('3000');
      popup.update(colourHass({ color_mode: 'color_temp', color_temp_kelvin: 4800 })); expect(slider.value).toBe('4800');
    });

    it('keeps a focused colour or Kelvin draft mounted through unrelated live updates and refreshes on blur', () => {
      popup.update(colourHass({ color_mode: 'color_temp', color_temp_kelvin: 3000 })); popup.showMarker(light);
      for (const [kind, value] of [['color', '#123456'], ['kelvin', '4700']]) {
        const input = inputFor(kind); input.focus(); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
        const next = colourHass({ color_mode: 'color_temp', color_temp_kelvin: 3100 }); next.states['sensor.power'] = state('1.2'); popup.update(next);
        expect(inputFor(kind)).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe(value);
        input.blur(); expect(input.value).toBe(kind === 'color' ? '#ff3b30' : '3100');
      }
      expect(onAction).not.toHaveBeenCalled();
    });

    it('blocks every light command while pending, displays errors safely, and permits a deliberate retry', async () => {
      let reject; onAction.mockReturnValueOnce(new Promise((_resolve, r) => { reject = r; }));
      popup.update(colourHass()); popup.showMarker(light); const blue = swatch(); blue.click(); blue.click();
      expect(onAction).toHaveBeenCalledTimes(1); expect(blue.disabled).toBe(true);
      for (const input of rowFor(popup, 'light.desk').querySelectorAll('input')) expect(input.disabled).toBe(true);
      expect(rowFor(popup, 'light.desk').textContent).toContain('Sending command…');
      reject(new Error('<img src=x> no permission')); await flush();
      expect(rowFor(popup, 'light.desk').querySelector('[role="alert"]').textContent).toContain('<img src=x> no permission');
      expect(rowFor(popup, 'light.desk').querySelector('img')).toBeNull(); expect(blue.disabled).toBe(false);
      blue.click(); await flush(); expect(onAction).toHaveBeenCalledTimes(2); expect(rowFor(popup, 'light.desk').querySelector('[role="alert"]').hidden).toBe(true);
    });

    it.each(['unavailable', 'unknown', 'missing', 'restored', 'malformed restored', 'hidden', 'diagnostic', 'disabled', 'connection', 'service', 'capability'])('rejects a queued colour change after %s revokes the source or capability', (reason) => {
      const h = colourHass(); popup.update(h); popup.showMarker(light); const picker = inputFor('color'); picker.value = '#010203'; picker.dispatchEvent(new Event('input', { bubbles: true }));
      if (reason === 'unavailable' || reason === 'unknown') h.states['light.desk'].state = reason;
      else if (reason === 'missing') delete h.states['light.desk'];
      else if (reason === 'restored') h.states['light.desk'].attributes.restored = true;
      else if (reason === 'malformed restored') h.states['light.desk'].attributes.restored = 'false';
      else if (reason === 'hidden') h.entities['light.desk'] = { hidden_by: 'user' };
      else if (reason === 'diagnostic') h.entities['light.desk'] = { entity_category: 'diagnostic' };
      else if (reason === 'disabled') h.entities['light.desk'] = { disabled_by: 'user' };
      else if (reason === 'connection') h.connection = { connected: false };
      else if (reason === 'service') h.services = { light: { toggle: {} } };
      else h.states['light.desk'].attributes.supported_color_modes = ['brightness'];
      // No refresh first: the release itself must consult the current source.
      picker.dispatchEvent(new Event('change', { bubbles: true })); expect(onAction).not.toHaveBeenCalled();
      if (!['hidden', 'diagnostic'].includes(reason)) expect(rowFor(popup, 'light.desk').querySelector('[data-action="more-info"]')).not.toBeNull();
    });

    it('cancels a temperature draft when bounds change, including a formerly valid value inside the new range', () => {
      const h = colourHass({ color_mode: 'color_temp', color_temp_kelvin: 3000 }); popup.update(h); popup.showMarker(light);
      const slider = inputFor('kelvin'); slider.value = '4500'; slider.dispatchEvent(new Event('input', { bubbles: true }));
      h.states['light.desk'].attributes.min_color_temp_kelvin = 4000;
      slider.dispatchEvent(new Event('change', { bubbles: true })); expect(onAction).not.toHaveBeenCalled();
      expect(slider.min).toBe('4000'); expect(slider.dataset.editing).toBe('');
      slider.value = '4500'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.desk', color_temp_kelvin: 4500 });
    });

    it.each(['connection', 'service', 'bounds'])('never sends an interrupted old native release after %s recovers', (reason) => {
      const h = colourHass({ color_mode: 'color_temp', color_temp_kelvin: 3000 }); popup.update(h); popup.showMarker(light);
      const old = inputFor(reason === 'bounds' ? 'kelvin' : 'color');
      old.value = reason === 'bounds' ? '4500' : '#123456'; old.dispatchEvent(new Event('input', { bubbles: true }));
      if (reason === 'connection') h.connected = false;
      else if (reason === 'service') h.services = { light: { toggle: {}, turn_off: {} } };
      else h.states['light.desk'].attributes.min_color_temp_kelvin = 4000;
      popup.update(h);
      if (reason === 'connection') h.connected = true;
      else if (reason === 'service') delete h.services;
      else h.states['light.desk'].attributes.min_color_temp_kelvin = 2200;
      popup.update(h);
      old.value = reason === 'bounds' ? '4500' : '#123456'; old.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onAction).not.toHaveBeenCalled();
      const current = inputFor(reason === 'bounds' ? 'kelvin' : 'color');
      current.value = reason === 'bounds' ? '4500' : '#123456'; current.dispatchEvent(new Event('input', { bubbles: true }));
      current.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', reason === 'bounds'
        ? { entity_id: 'light.desk', color_temp_kelvin: 4500 } : { entity_id: 'light.desk', rgb_color: [18, 52, 86] });
    });

    it('cancels an actual pointer-cancelled slider draft, then accepts a fresh keyboard/native input', () => {
      popup.update(colourHass()); popup.showMarker(light); const slider = inputFor('kelvin');
      slider.value = '4500'; slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('pointercancel', { bubbles: true }));
      slider.value = '4500'; slider.dispatchEvent(new Event('change', { bubbles: true })); expect(onAction).not.toHaveBeenCalled();
      slider.value = '4500'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.desk', color_temp_kelvin: 4500 });
    });

    it('does not cancel a valid native colour-dialog change just because the input lost focus', () => {
      popup.update(colourHass()); popup.showMarker(light); const picker = inputFor('color');
      picker.focus(); picker.value = '#123456'; picker.dispatchEvent(new Event('input', { bubbles: true })); picker.blur();
      // A native colour dialog reports its final value with change after returning focus.
      picker.value = '#123456'; picker.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.desk', rgb_color: [18, 52, 86] });
    });

    it('still revokes an unfinished native colour-dialog gesture after blur and connection recovery', () => {
      const h = colourHass(); popup.update(h); popup.showMarker(light); const picker = inputFor('color');
      picker.focus(); picker.value = '#123456'; picker.dispatchEvent(new Event('input', { bubbles: true })); picker.blur();
      h.connected = false; popup.update(h); h.connected = true; popup.update(h);
      picker.value = '#123456'; picker.dispatchEvent(new Event('change', { bubbles: true })); expect(onAction).not.toHaveBeenCalled();
      picker.value = '#123456'; picker.dispatchEvent(new Event('input', { bubbles: true })); picker.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.desk', rgb_color: [18, 52, 86] });
    });

    it.each(['2100', '6600', 'NaN', '4500.5', ''])('rejects a forged out-of-range or malformed Kelvin value %s', (value) => {
      popup.update(colourHass()); popup.showMarker(light); const slider = inputFor('kelvin');
      Object.defineProperty(slider, 'value', { configurable: true, value }); slider.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onAction).not.toHaveBeenCalled();
    });

    it.each(['close', 'replacement', 'removed row', 'capability replacement'])('rejects controls retained from a previous %s', (kind) => {
      popup.update(colourHass()); popup.showMarker(light); const picker = inputFor('color'), blue = swatch(); picker.value = '#010203';
      if (kind === 'close') popup.close();
      else if (kind === 'replacement') popup.showMarker(light);
      else if (kind === 'removed row') popup.showMarker(climate);
      else popup.update(colourHass({ supported_color_modes: ['brightness'], color_mode: 'brightness' }));
      picker.dispatchEvent(new Event('change', { bubbles: true })); blue.click(); expect(onAction).not.toHaveBeenCalled();
    });

    it('keeps theme backgrounds, non-text swatches, keyboard names and 44px controls inside a wrapping layout', () => {
      popup.update(colourHass()); popup.showMarker(light); const style = popup.el.querySelector('style').textContent;
      expect(style).toContain('min-height: 44px'); expect(style).toContain('minmax(44px, 1fr)');
      expect(style).toContain('var(--secondary-background-color, var(--ha-card-background, var(--card-background-color, #f5f5f5)))');
      expect(style).toContain(':focus-visible'); expect(inputFor('color').getAttribute('aria-label')).toBe('Desk lamp: choose colour');
      expect(inputFor('kelvin').getAttribute('aria-label')).toContain('kelvin'); expect(swatch().getAttribute('aria-label')).toBe('Desk lamp: set blue');
      expect(swatch().querySelector('span').getAttribute('aria-hidden')).toBe('true'); swatch().focus(); expect(document.activeElement).toBe(swatch());
      expect(onAction).not.toHaveBeenCalled();
    });
  });

  describe('camera views', () => {
    let h, helpers, cards, loader;
    const cameraButton = (id) => rowFor(popup, id).querySelector('[data-action="camera-view"]');
    beforeEach(() => {
      h = hass();
      h.connected = true;
      h.connection = { connected: true };
      h.states['camera.front'] = state('idle', { friendly_name: 'Front camera' });
      h.states['camera.garden'] = state('recording', { friendly_name: 'Garden recording' });
      h.states['binary_sensor.motion'] = state('off', { friendly_name: 'Front motion' });
      h.callWS = vi.fn().mockResolvedValue({ frontend_stream_types: ['hls'] });
      h.callService = vi.fn();
      cards = [];
      helpers = { createCardElement: vi.fn((config) => {
        const card = document.createElement('test-t3d-popup-camera');
        card.entity = config.entity;
        cards.push(card);
        return card;
      }) };
      loader = vi.fn().mockResolvedValue(helpers);
      window.loadCardHelpers = loader;
      popup.update(h);
    });
    afterEach(() => { delete window.loadCardHelpers; });

    it('a primary camera marker auto-opens its native view without any HA device action', async () => {
      popup.showMarker(frontCamera);
      await flush();
      expect(popup.cameraFeed.entityId).toBe('camera.front');
      expect(popup.cameraFeed.nativeCard.entity).toBe('camera.front');
      expect(popup.cameraFeed.nativeCard.hass).toBe(h);
      expect(popup.el.querySelector('.t3d-popup-camera').contains(popup.cameraFeed.el)).toBe(true);
      expect(popup.cameraFeed.el.isConnected).toBe(true);
      expect(cameraButton('camera.front').textContent).toBe('Camera view');
      expect(cameraButton('camera.front').getAttribute('aria-label')).toBe('Front camera: camera view');
      expect(onAction).not.toHaveBeenCalled();
      expect(h.callService).not.toHaveBeenCalled();
      expect(onMoreInfo).not.toHaveBeenCalled();
    });

    it('a real grouped Ring device with a light primary retains a deliberate camera button', async () => {
      h.entities = { 'light.desk': { device_id: 'ring' }, 'camera.front': { device_id: 'ring' },
        'binary_sensor.motion': { device_id: 'ring' } };
      h.devices = { ring: { name: 'Ring front door', area_id: 'office' } };
      const [ring] = buildMarkers(h, {}, { group_by: 'device' });
      expect(ring.entityId).toBe('light.desk');
      popup.update(h);
      popup.showMarker(ring);
      expect(cameraButton('camera.front')).not.toBeNull();
      expect(loader).not.toHaveBeenCalled();
      expect(h.callWS).not.toHaveBeenCalled();
      popup.el.scrollTop = 240;
      cameraButton('camera.front').click();
      await flush();
      expect(popup.cameraFeed.nativeCard.entity).toBe('camera.front');
      expect(popup.el.scrollTop).toBe(0);
      expect(onAction).not.toHaveBeenCalled();
      expect(h.callService).not.toHaveBeenCalled();
      expect(rowFor(popup, 'light.desk').querySelector('[data-action="toggle"]').textContent).toBe('Turn off');
    });

    it('room controls list grouped cameras but start no feed until Camera view is selected', async () => {
      const group = { ...light, entities: [...light.entities, { eid: 'camera.front' }, { eid: 'camera.garden' }] };
      popup.showRoom({ id: 'office', area_id: 'office' }, [group]);
      expect(popup.el.querySelectorAll('[data-action="camera-view"]')).toHaveLength(2);
      expect(loader).not.toHaveBeenCalled();
      expect(h.callWS).not.toHaveBeenCalled();
      expect(popup.cameraFeed.isOpen).toBe(false);
      cameraButton('camera.garden').click();
      await flush();
      expect(popup.cameraFeed.nativeCard.entity).toBe('camera.garden');
      expect(popup.cameraFeed.el.textContent).not.toContain('Live view');
      expect(onAction).not.toHaveBeenCalled();
      expect(h.callService).not.toHaveBeenCalled();
    });

    it('uses one feed controller when switching a room camera and replaces the actual native card', async () => {
      const feed = popup.cameraFeed;
      popup.showRoom({ area_id: 'office' }, [{ ...frontCamera, entities: ['camera.front', 'camera.garden'] }]);
      cameraButton('camera.front').click();
      await flush();
      const first = feed.nativeCard;
      cameraButton('camera.garden').click();
      expect(first.isConnected).toBe(false);
      expect(first.disconnections).toBe(1);
      await flush();
      expect(popup.cameraFeed).toBe(feed);
      expect(feed.nativeCard.entity).toBe('camera.garden');
      expect(feed.nativeCard).not.toBe(first);
      expect(stage.querySelectorAll('test-t3d-popup-camera')).toHaveLength(1);
    });

    it('state updates and another row changing its capabilities do not rebuild camera playback', async () => {
      const group = { ...light, entities: [...light.entities, { eid: 'camera.front' }] };
      popup.showMarker(group);
      cameraButton('camera.front').click();
      await flush();
      const feed = popup.cameraFeed.nativeCard;
      const next = { ...h, states: { ...h.states, 'light.desk': state('on', { supported_color_modes: ['onoff'] }),
        'camera.front': state('recording', { friendly_name: 'New camera name' }) } };
      popup.update(next);
      expect(popup.cameraFeed.nativeCard).toBe(feed);
      expect(feed.hass).toBe(next);
      expect(feed.connections).toBe(1);
      expect(feed.disconnections).toBe(0);
      expect(helpers.createCardElement).toHaveBeenCalledTimes(1);
      expect(cameraButton('camera.front').getAttribute('aria-label')).toBe('New camera name: camera view');
      expect(rowFor(popup, 'light.desk').querySelector('input')).toBeNull();
      expect(onAction).not.toHaveBeenCalled();
    });

    it.each(['marker', 'room'])('%s replacement stops playback and room/light selection does not reopen it', async (kind) => {
      const feed = popup.cameraFeed;
      popup.showMarker(frontCamera);
      await flush();
      const native = feed.nativeCard;
      if (kind === 'marker') popup.showMarker(light);
      else popup.showRoom({ area_id: 'office' }, [frontCamera]);
      await flush();
      expect(native.isConnected).toBe(false);
      expect(native.disconnections).toBe(1);
      expect(popup.cameraFeed).toBe(feed);
      expect(feed.isOpen).toBe(false);
      expect(helpers.createCardElement).toHaveBeenCalledTimes(1);
    });

    it.each(['close', 'escape', 'outside', 'dispose'])('%s releases the native card and preserves parent dismiss behavior', async (method) => {
      const opener = document.createElement('button');
      stage.append(opener);
      opener.focus();
      popup.showMarker(frontCamera);
      await flush();
      const native = popup.cameraFeed.nativeCard;
      if (method === 'close') popup.el.querySelector('[data-action="close"]').click();
      else if (method === 'escape') popup.cameraFeed.el.querySelector('[data-action="close-camera"]')
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (method === 'outside') stage.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
      else popup.dispose();
      expect(popup.isOpen).toBe(false);
      expect(popup.cameraFeed.isOpen).toBe(false);
      expect(native.disconnections).toBe(1);
      expect(stage.querySelector('test-t3d-popup-camera')).toBeNull();
      if (method === 'escape' || method === 'close') expect(document.activeElement).toBe(opener);
      if (method === 'outside') expect(popup.closedBy.type).toBe('pointerdown');
    });

    it.each(['missing', 'unavailable', 'disconnected', 'disabled'])('%s primary camera retains controls but cannot start native playback', async (reason) => {
      if (reason === 'missing') delete h.states['camera.front'];
      else if (reason === 'unavailable') h.states['camera.front'].state = 'unavailable';
      else if (reason === 'disconnected') h.connected = false;
      else h.entities['camera.front'] = { disabled_by: 'user' };
      popup.update(h);
      popup.showMarker(frontCamera);
      await flush();
      expect(cameraButton('camera.front').disabled).toBe(true);
      expect(rowFor(popup, 'camera.front').querySelector('[data-action="more-info"]').disabled).toBe(false);
      expect(popup.cameraFeed.nativeCard).toBeNull();
      expect(helpers.createCardElement).not.toHaveBeenCalled();
      expect(h.callWS).not.toHaveBeenCalled();
      expect(popup.cameraFeed.el.textContent).toMatch(/not found|unavailable|disconnected|disabled/);
    });

    it('denied camera access shows feedback and native All controls closes before its callback', async () => {
      h.callWS.mockRejectedValue({ code: 'unauthorized' });
      popup.showMarker(frontCamera);
      await flush();
      expect(popup.cameraFeed.nativeCard).toBeNull();
      expect(popup.cameraFeed.el.textContent).toContain('did not allow access');
      onMoreInfo.mockImplementation((id) => {
        expect(id).toBe('camera.front');
        expect(popup.isOpen).toBe(false);
        expect(popup.cameraFeed.isOpen).toBe(false);
      });
      popup.cameraFeed.el.querySelector('[data-action="camera-more-info"]').click();
      await flush();
      expect(onMoreInfo).toHaveBeenCalledExactlyOnceWith('camera.front');
      expect(onAction).not.toHaveBeenCalled();
    });

    it('a camera becoming unavailable releases playback and only the deliberate row button reopens after recovery', async () => {
      popup.showMarker(frontCamera);
      await flush();
      const native = popup.cameraFeed.nativeCard;
      popup.update({ ...h, states: { ...h.states, 'camera.front': state('unavailable') } });
      expect(native.disconnections).toBe(1);
      expect(popup.cameraFeed.nativeCard).toBeNull();
      expect(cameraButton('camera.front').disabled).toBe(true);
      popup.update(h);
      expect(helpers.createCardElement).toHaveBeenCalledTimes(1);
      expect(cameraButton('camera.front').disabled).toBe(false);
      cameraButton('camera.front').click();
      await flush();
      expect(popup.cameraFeed.nativeCard).not.toBe(native);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('a camera hidden by the registry is removed from rows and its feed is released', async () => {
      popup.showMarker(frontCamera);
      await flush();
      const native = popup.cameraFeed.nativeCard;
      h.entities['camera.front'] = { hidden_by: 'user' };
      popup.update(h);
      expect(rowFor(popup, 'camera.front')).toBeUndefined();
      expect(popup.cameraFeed.isOpen).toBe(false);
      expect(native.disconnections).toBe(1);
    });

    it('keeps old-HA/demo behavior readable when native camera helpers are unavailable', async () => {
      delete window.loadCardHelpers;
      popup.showMarker(frontCamera);
      await flush();
      expect(popup.cameraFeed.nativeCard).toBeNull();
      expect(popup.cameraFeed.el.textContent).toContain('camera controls are not available here');
      const info = popup.cameraFeed.el.querySelector('[data-action="camera-more-info"]');
      expect(info.disabled).toBe(false);
      info.click();
      await flush();
      expect(onMoreInfo).toHaveBeenCalledExactlyOnceWith('camera.front');
      expect(popup.isOpen).toBe(false);
    });

    it('row All controls releases an active feed before handing the grouped entity to HA', async () => {
      popup.showMarker(frontCamera);
      await flush();
      const native = popup.cameraFeed.nativeCard;
      onMoreInfo.mockImplementation((id) => {
        expect(id).toBe('binary_sensor.motion');
        expect(native.disconnections).toBe(1);
        expect(native.isConnected).toBe(false);
      });
      rowFor(popup, 'binary_sensor.motion').querySelector('[data-action="more-info"]').click();
      expect(onMoreInfo).toHaveBeenCalledExactlyOnceWith('binary_sensor.motion');
      expect(popup.isOpen).toBe(false);
    });

    it('camera controls are isolated from canvas capture picking and in-plane gestures, including close', async () => {
      const group = { ...light, entities: [...light.entities, { eid: 'camera.front' }] };
      const captured = vi.fn(), behind = vi.fn();
      stage.addEventListener('pointerdown', (event) => {
        if (!event.composedPath().some((node) => node.hasAttribute?.('data-taylors3d-ui'))) captured();
      }, true);
      stage.addEventListener('pointerdown', behind);
      stage.addEventListener('click', behind);
      stage.addEventListener('wheel', behind);
      popup.showMarker(group);
      const button = cameraButton('camera.front');
      button.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
      button.click();
      await flush();
      popup.cameraFeed.nativeCard.dispatchEvent(new Event('wheel', { bubbles: true, composed: true }));
      popup.cameraFeed.el.querySelector('[data-action="close-camera"]').click();
      expect(popup.cameraFeed.isOpen).toBe(false);
      expect(popup.isOpen).toBe(true);
      popup.el.querySelector('[data-action="close"]').click();
      expect(captured).not.toHaveBeenCalled();
      expect(behind).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    });

    it('camera controller results cannot revive a replaced marker or panel', async () => {
      let resolve;
      loader.mockReturnValue(new Promise((yes) => { resolve = yes; }));
      popup.showMarker(frontCamera);
      popup.showMarker(light);
      resolve(helpers);
      await flush();
      expect(popup.el.getAttribute('aria-label')).toBe('Desk lamp');
      expect(popup.cameraFeed.isOpen).toBe(false);
      expect(helpers.createCardElement).not.toHaveBeenCalled();
    });

    it('openCamera requires a camera row actually belonging to the current panel', async () => {
      popup.showMarker(light);
      expect(await popup.openCamera('camera.garden')).toBe(false);
      expect(await popup.openCamera('light.desk')).toBe(false);
      expect(loader).not.toHaveBeenCalled();
      expect(h.callWS).not.toHaveBeenCalled();
    });
  });
});
