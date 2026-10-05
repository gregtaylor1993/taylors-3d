// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseHeader } from '../src/house-header.js';
import { buildHouseSummary } from '../src/house-summary.js';

const mounted = [];
function fixture() {
  const root = document.createElement('div'); document.body.append(root);
  const header = new HouseHeader(root); mounted.push(header, { dispose: () => root.remove() });
  return { root, header };
}
const current = () => ({ user: { id: 'current-user', is_active: true }, connection: { connected: true },
  config: { location_name: 'Simulated home' }, states: {
    'light.one': { state: 'on', attributes: {} },
    'weather.selected': { state: 'cloudy', attributes: { temperature: 12, temperature_unit: '°C' } },
    'person.selected': { state: 'home', attributes: { friendly_name: 'Simulated person' } },
    'alarm_control_panel.selected': { state: 'disarmed', attributes: {} },
  }, entities: {}, devices: {}, callService: vi.fn() });
const settings = { weather_entity: 'weather.selected', person_entities: ['person.selected'], alarm_entity: 'alarm_control_panel.selected' };
afterEach(() => { for (const item of mounted.splice(0)) item.dispose(); });

describe('future house header uses actual summary readings', () => {
  it('starts with a waiting label and no example address, devices or counts', () => {
    const { header } = fixture();
    expect(header.title.textContent).toBe("Taylor's 3D");
    expect(header.meta.textContent).toBe('Waiting for Home Assistant');
    expect([...header.rows].filter(([, row]) => !row.hidden).map(([key]) => key)).toEqual(['lights']);
    expect(header.rows.get('lights').textContent).toBe('Light status unavailable');
  });
  it('renders current configured weather, selected people, alarm and actual light entity count', () => {
    const { header } = fixture(), hass = current(); header.update(buildHouseSummary(hass, settings));
    expect(header.title.textContent).toBe('Simulated home');
    expect(header.rows.get('weather').textContent).toBe('Cloudy · 12 °C');
    expect(header.rows.get('people').textContent).toBe('1 of 1 selected people home');
    expect(header.rows.get('alarm').textContent).toBe('Disarmed');
    expect(header.rows.get('lights').textContent).toBe('1 light on');
    expect(hass.callService).not.toHaveBeenCalled();
  });
  it('leaves optional sources hidden until they are explicitly configured', () => {
    const { header } = fixture(); header.update(buildHouseSummary(current()));
    for (const key of ['weather', 'people', 'alarm']) expect(header.rows.get(key).hidden).toBe(true);
  });
  it.each(['weather', 'people', 'alarm'])('preserves an unavailable saved %s source as a visible honest label', (key) => {
    const { header } = fixture(), hass = current(); header.update(buildHouseSummary(hass, settings));
    delete hass.states[{ weather: 'weather.selected', people: 'person.selected', alarm: 'alarm_control_panel.selected' }[key]];
    header.update(buildHouseSummary(hass, settings));
    expect(header.rows.get(key).hidden).toBe(false);
    expect(header.rows.get(key).dataset.status).not.toBe('ready');
    expect(header.rows.get(key).textContent).not.toBe({ weather: 'Cloudy · 12 °C', people: '1 of 1 selected people home', alarm: 'Disarmed' }[key]);
  });
  it('revokes current readings on disconnect and preserves only an explicit title', () => {
    const { header } = fixture(), hass = current(); header.update(buildHouseSummary(hass, { ...settings, title: 'My house' }));
    hass.connection.connected = false; header.update(buildHouseSummary(hass, { ...settings, title: 'My house' }));
    expect(header.title.textContent).toBe('My house');
    for (const row of header.rows.values()) expect(row.dataset.status).toBe('unavailable');
    expect(header.rows.get('lights').textContent).toBe('Light status unavailable');
  });
  it('keeps the same nodes when fresh Home Assistant readings arrive', () => {
    const { header } = fixture(), hass = current(), nodes = [...header.rows.values()];
    header.update(buildHouseSummary(hass, settings)); hass.states['light.one'].state = 'off';
    header.update(buildHouseSummary(hass, settings));
    expect([...header.rows.values()]).toEqual(nodes); expect(header.rows.get('lights').textContent).toBe('0 lights on');
  });
  it('labels selected people and entity counts precisely for screen readers', () => {
    const { header } = fixture(); header.update(buildHouseSummary(current(), settings));
    expect(header.rows.get('people').getAttribute('aria-label')).toBe('Selected people: 1 of 1 selected people home');
    expect(header.rows.get('lights').getAttribute('aria-label')).toBe('Light entities: 1 light on');
    expect(header.rows.get('lights').title).toContain('not a count of physical bulbs');
    for (const row of header.rows.values()) expect(row.getAttribute('aria-atomic')).toBe('true');
  });
  it('treats a configured title and source labels as literal text', () => {
    const { header } = fixture(); const label = '<img src=x onerror=alert(1)>';
    header.update({ title: { text: label, source: 'configured' }, session: { label }, weather: { status: 'ready', label, name: label } });
    expect(header.title.textContent).toBe(label); expect(header.rows.get('weather').textContent).toBe(label);
    expect(header.element.querySelector('img')).toBeNull();
  });
  it('does not create links, buttons or inferred routes from a summary', () => {
    const { header } = fixture(); header.update(buildHouseSummary(current(), settings));
    expect(header.element.querySelectorAll('a,button,input').length).toBe(0);
  });
  it('needs no clock and does not invent a time from the reference photo', () => {
    const { header } = fixture(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('No clock'); });
    try { expect(header.update(buildHouseSummary(current(), settings))).toBe(true); } finally { clock.mockRestore(); }
    expect(header.element.textContent).not.toContain('19:58');
  });
  it.each([undefined, null, {}, { title: { text: '' } }, { session: { status: 'invented', label: '' } }])('handles an incomplete summary %j honestly', (summary) => {
    const { header } = fixture(); expect(header.update(summary)).toBe(true);
    expect(header.title.textContent).toBe("Taylor's 3D"); expect(header.meta.textContent).toBe('Waiting for Home Assistant');
    expect(header.rows.get('lights').dataset.status).toBe('unavailable');
  });
  it('stops updating and removes its DOM on disposal', () => {
    const { root, header } = fixture(); header.dispose(); header.dispose();
    expect(header.update(buildHouseSummary(current()))).toBe(false); expect(root.childElementCount).toBe(0);
  });
});
