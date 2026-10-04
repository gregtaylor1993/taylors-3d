// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevicePopup, entityControl, markerEntityIds, roomEntityIds } from '../src/device-popup.js';

const state = (value, attributes = {}) => ({ state: value, attributes });
const light = { id: 'device:lamp', name: 'Desk lamp', areaId: 'office', entityId: 'light.desk',
  entities: [{ eid: 'light.desk' }, { eid: 'sensor.power' }], secondaryId: 'sensor.power' };
const climate = { id: 'entity:climate.heating', name: 'Heating', areaId: 'office', entityId: 'climate.heating', entities: [] };
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
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

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
});
