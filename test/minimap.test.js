// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MiniMap, miniMapCamera, miniMapScene, miniMapTransform } from '../src/minimap.js';

const room = (id = 'kitchen', floorId = 'ground', polygon = [[0, 0], [4, 0], [4, 3], [0, 3]]) => ({
  room: { id, area_id: id, polygon }, floorId, name: id === 'kitchen' ? 'Kitchen' : id,
});
const base = () => ({ rooms: [room()], floors: [{ id: 'ground', name: 'Ground floor', elevation: 0 }], visibleFloors: ['ground'] });
const maps = [];
function mount(options = {}) {
  const stage = document.createElement('div'); document.body.append(stage);
  const map = new MiniMap(stage, options); maps.push(map); return { stage, map };
}
afterEach(() => { for (const map of maps.splice(0)) map.dispose(); document.body.replaceChildren(); });

describe('mini-map geometry', () => {
  it('puts east to the right and north up, with equal metre scales and reversible picks', () => {
    const t = miniMapTransform([[0, 0], [4, 3]]);
    expect(t.toSvg([1, 0])[0]).toBeGreaterThan(t.toSvg([0, 0])[0]);
    expect(t.toSvg([0, 1])[1]).toBeLessThan(t.toSvg([0, 0])[1]);
    expect(t.toSvg([1, 0])[0] - t.toSvg([0, 0])[0]).toBeCloseTo(t.toSvg([0, 0])[1] - t.toSvg([0, 1])[1]);
    const original = [2.25, 1.125];
    const picked = t.toPlan(t.toSvg(original));
    expect(picked[0]).toBeCloseTo(original[0]); expect(picked[1]).toBeCloseTo(original[1]);
    for (const p of [[0, 0], [4, 3]]) {
      const [x, y] = t.toSvg(p); expect(x).toBeGreaterThanOrEqual(14); expect(x).toBeLessThanOrEqual(186);
      expect(y).toBeGreaterThanOrEqual(14); expect(y).toBeLessThanOrEqual(136);
    }
  });

  it('handles an empty or collapsed extent without NaN or division by zero', () => {
    expect(miniMapTransform([])).toBeNull();
    expect(miniMapTransform(null)).toBeNull();
    expect(miniMapTransform({})).toBeNull();
    expect(miniMapTransform([[NaN, 1], [0, Infinity], null])).toBeNull();
    const t = miniMapTransform([[3, 7], [3, 7]], { width: -10, height: NaN, padding: 500 });
    expect(t.toSvg([3, 7])).toEqual([100, 75]);
    expect(t.scale).toBeGreaterThan(0); expect(t.toPlan([100, 75])).toEqual([3, 7]);
  });

  it('discards invalid rooms and respects resolved floor visibility before fitting', () => {
    const data = { rooms: [room(), room('bedroom', 'first', [[100, 100], [105, 100], [105, 105], [100, 105]]),
      room('broken', 'ground', [[0, 0], [NaN, 1], [0, 1]]), room('flat', 'ground', [[0, 0], [1, 0], [2, 0]])], visibleFloors: ['ground'] };
    const scene = miniMapScene(data);
    expect(scene.rooms.map((r) => r.id)).toEqual(['kitchen']);
    expect(scene.transform.bounds.maxX).toBe(4);
    expect(miniMapScene({ ...data, visibleFloors: [] }).transform).toBeNull();
    expect(miniMapScene({ ...data, visibleFloors: 'first' }).rooms.map((r) => r.id)).toEqual(['bedroom']);
  });

  it('presents one floor at a time, defaulting to the lowest visible floor', () => {
    const data = { rooms: [room('upstairs', 'first'), room()], floors: [
      { id: 'first', name: 'First floor', elevation: 3 }, { id: 'ground', name: 'Ground floor', elevation: 0 }], visibleFloors: 'all' };
    const scene = miniMapScene(data);
    expect(scene.floors.map((f) => f.id)).toEqual(['ground', 'first']);
    expect(scene.floorId).toBe('ground'); expect(scene.rooms.map((r) => r.id)).toEqual(['kitchen']);
    expect(miniMapScene(data, { floorId: 'first' }).rooms.map((r) => r.id)).toEqual(['upstairs']);
    expect(miniMapScene({ ...data, visibleFloors: ['ground'] }, { floorId: 'first' }).floorId).toBe('ground');
  });

  it('uses live marker positions, hides filtered markers and shows active/unavailable state', () => {
    const data = { ...base(), positions: new Map([
      ['lamp', { x: 2, y: 1, floorId: 'ground' }], ['hidden', { x: 80, y: 80, floorId: 'ground' }],
      ['other-floor', { x: 80, y: 80, floorId: 'first' }], ['bad', { x: NaN, y: 1, floorId: 'ground' }],
      ['sensor', { x: 3, y: 2, floorId: 'ground' }],
    ]), markers: [{ id: 'lamp', name: 'Pendant', entityId: 'light.pendant' }, { id: 'sensor', name: 'Temperature', entityId: 'sensor.temp' }],
    markerStates: new Map([['hidden', { shown: false }], ['sensor', { shown: true, faded: true }]]),
    states: { 'light.pendant': { state: 'on' }, 'sensor.temp': { state: 'unavailable' } } };
    const scene = miniMapScene(data);
    expect(scene.markers.map((m) => m.id)).toEqual(['lamp', 'sensor']);
    expect(scene.markers[0]).toMatchObject({ active: true, name: 'Pendant', x: 2, y: 1 });
    expect(scene.markers[1]).toMatchObject({ active: false, unavailable: true, faded: true });
    expect(scene.transform.bounds.maxX).toBe(4);
  });

  it('turns the 3D camera into plan focus and heading, and uses the actual top camera in Top mode', () => {
    expect(miniMapCamera({ camera: { position: [2, 9, 6], target: [2, 0, -4] } })).toEqual({ focus: [2, 4], direction: [0, 1] });
    expect(miniMapCamera({ camera: { position: [12, 9, -4], target: [2, 0, -4] } }).direction).toEqual([-1, 0]);
    expect(miniMapCamera({ mode: 'top', topCamera: { center: [7, 8], zoom: 2 }, camera: { target: [100, 0, 100] } })).toEqual({ focus: [7, 8], direction: null });
    expect(miniMapCamera({ mode: 'top', camera: { position: [1, 2, 3], target: [1, 0, 3] } })).toBeNull();
    expect(miniMapCamera({ camera: { position: [1, 2, NaN], target: [1, 0, 3] } })).toBeNull();
  });
});

describe('MiniMap controls', () => {
  it('is hidden until a valid room exists and hides automatically during editing', () => {
    const { map } = mount(); expect(map.el.hidden).toBe(true);
    map.update(base()); expect(map.el.hidden).toBe(false);
    map.update({ ...base(), editing: true }); expect(map.el.hidden).toBe(true);
    map.update(base()); expect(map.el.hidden).toBe(false);
    map.update({ ...base(), rooms: [] }); expect(map.el.hidden).toBe(true);
  });

  it('provides theme-scoped SVG, exact corner placement and safe size limits', () => {
    const { map } = mount({ corner: 'top-left', size: 50 }); map.update(base());
    expect(map.el.dataset.taylors3dUi).toBe('minimap');
    expect(map.el.style.top).toBe('12px'); expect(map.el.style.left).toBe('12px');
    expect(map.el.style.getPropertyValue('--taylors3d-minimap-size')).toBe('120px');
    expect(map.svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(map.el.querySelector('canvas')).toBeNull();
    expect(map.el.querySelector('style').textContent).toContain('var(--primary-color');
  });

  it('focuses the room centre on click and through Enter/Space with accessible labels', () => {
    const onFocus = vi.fn(), onRoom = vi.fn(); const { map } = mount({ onFocus, onRoom }); map.update(base());
    const polygon = map.el.querySelector('[data-room="kitchen"]');
    expect(polygon.getAttribute('role')).toBe('button'); expect(polygon.getAttribute('tabindex')).toBe('0');
    expect(polygon.getAttribute('aria-label')).toBe('Focus Kitchen');
    polygon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    polygon.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    polygon.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onFocus).toHaveBeenCalledTimes(3);
    expect(onFocus).toHaveBeenLastCalledWith({ x: 2, y: 1.5, floorId: 'ground', roomId: 'kitchen' });
    expect(onRoom).toHaveBeenLastCalledWith('kitchen', expect.objectContaining({ floorId: 'ground' }));
  });

  it('focuses an exact live device position without toggling a real device', () => {
    const onFocus = vi.fn(), onMarker = vi.fn(); const { map } = mount({ onFocus, onMarker });
    map.update({ ...base(), positions: new Map([['lamp', { x: 1.2, y: 2.4, floorId: 'ground' }]]), markers: [{ id: 'lamp', name: 'Lamp', entityId: 'light.lamp' }], states: { 'light.lamp': { state: 'on' } } });
    const dot = map.el.querySelector('[data-marker="lamp"] .dot'); dot.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onFocus).toHaveBeenCalledWith({ x: 1.2, y: 2.4, floorId: 'ground', markerId: 'lamp' });
    expect(onMarker).toHaveBeenCalledWith('lamp', expect.objectContaining({ x: 1.2 }));
    expect(dot.parentNode.classList.contains('active')).toBe(true);
  });

  it('converts a background tap from actual SVG size into plan metres', () => {
    const onFocus = vi.fn(); const { map } = mount({ onFocus }); map.update(base());
    const p = map.scene.transform.toSvg([1.25, 2.5]);
    map.svg.getBoundingClientRect = () => ({ left: 20, top: 30, width: 400, height: 300 });
    map.ground.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20 + p[0] * 2, clientY: 30 + p[1] * 2 }));
    expect(onFocus.mock.calls[0][0].x).toBeCloseTo(1.25);
    expect(onFocus.mock.calls[0][0].y).toBeCloseTo(2.5);
    expect(onFocus.mock.calls[0][0].floorId).toBe('ground');
  });

  it('keeps overlapping floors separate and preserves the chosen floor across updates', () => {
    const onFocus = vi.fn(); const { map } = mount({ onFocus });
    const data = { rooms: [room(), room('bedroom', 'first')], floors: [
      { id: 'ground', name: 'Ground floor', elevation: 0 }, { id: 'first', name: 'First floor', elevation: 3 }], visibleFloors: 'all' };
    map.update(data); expect(map.select.hidden).toBe(false);
    map.select.value = 'first'; map.select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(map.el.querySelector('[data-room="kitchen"]')).toBeNull();
    map.el.querySelector('[data-room="bedroom"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onFocus).toHaveBeenCalledWith(expect.objectContaining({ floorId: 'first', roomId: 'bedroom' }));
    map.update({ ...data }); expect(map.scene.floorId).toBe('first');
    map.update({ ...data, visibleFloors: ['ground'] }); expect(map.scene.floorId).toBe('ground'); expect(map.select.hidden).toBe(true);
  });

  it('updates only the focus indicator while orbiting and uses a heading arrow only in 3D', () => {
    const { map } = mount(); map.update(base());
    const polygon = map.roomLayer.firstChild;
    map.updateCamera({ camera: { position: [2, 5, 5], target: [2, 0, -1] }, mode: '3d' });
    const old = map.cameraLayer.getAttribute('transform');
    map.updateCamera({ camera: { position: [1, 5, 4], target: [1, 0, -2] }, mode: '3d' });
    expect(map.cameraLayer.getAttribute('transform')).not.toBe(old); expect(map.roomLayer.firstChild).toBe(polygon);
    expect(map.focusArrow.getAttribute('visibility')).toBe('visible');
    map.updateCamera({ topCamera: { center: [3, 1], zoom: 1 }, mode: 'top' });
    expect(map.focusArrow.getAttribute('visibility')).toBe('hidden');
    expect(map.cameraLayer.getAttribute('visibility')).toBe('visible');
    map.updateCamera({}); expect(map.cameraLayer.getAttribute('visibility')).toBe('hidden');
  });

  it('stops pointer and wheel events reaching the main scene, and publishes explicit hide/show changes', () => {
    const onVisibilityChange = vi.fn(); const { stage, map } = mount({ onVisibilityChange }); map.update(base());
    const pointer = vi.fn(), wheel = vi.fn(); stage.addEventListener('pointerdown', pointer); stage.addEventListener('wheel', wheel);
    map.svg.dispatchEvent(new Event('pointerdown', { bubbles: true })); map.svg.dispatchEvent(new Event('wheel', { bubbles: true }));
    expect(pointer).not.toHaveBeenCalled(); expect(wheel).not.toHaveBeenCalled();
    map.el.querySelector('[data-map-close]').click(); expect(map.el.hidden).toBe(true); expect(onVisibilityChange).toHaveBeenCalledWith(false);
    map.setVisible(true); expect(map.el.hidden).toBe(false); expect(onVisibilityChange).toHaveBeenCalledWith(true);
    map.setVisible(true); expect(onVisibilityChange).toHaveBeenCalledTimes(2);
  });

  it('preserves keyboard targets when geometry has not changed and renders names as text', () => {
    const { map } = mount(); const data = base(); data.rooms[0].name = '<script>bad()</script>'; map.update(data);
    const polygon = map.roomLayer.firstChild; polygon.focus(); map.update({ ...data });
    expect(map.roomLayer.firstChild).toBe(polygon); expect(document.activeElement).toBe(polygon);
    expect(map.el.querySelector('script')).toBeNull(); expect(polygon.getAttribute('aria-label')).toContain('<script>');
  });

  it('keeps a focused marker through live state and position updates, using the new coordinates on Enter', () => {
    const onFocus = vi.fn(); const { map } = mount({ onFocus });
    const data = { ...base(), positions: new Map([['lamp', { x: 1, y: 1, floorId: 'ground' }]]),
      markers: [{ id: 'lamp', name: 'Lamp', entityId: 'light.lamp' }], states: { 'light.lamp': { state: 'off' } } };
    map.update(data);
    const marker = map.el.querySelector('[data-marker="lamp"]'); marker.focus();
    map.update({ ...data, states: { 'light.lamp': { state: 'on' } } });
    expect(document.activeElement).toBe(marker); expect(map.el.querySelector('[data-marker="lamp"]')).toBe(marker);
    expect(marker.classList.contains('active')).toBe(true); expect(marker.getAttribute('aria-label')).toBe('Focus Lamp, on');
    map.update({ ...data, positions: new Map([['lamp', { x: 2.5, y: 2, floorId: 'ground' }]]) });
    expect(document.activeElement).toBe(marker); expect(map.el.querySelector('[data-marker="lamp"]')).toBe(marker);
    marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onFocus).toHaveBeenLastCalledWith({ x: 2.5, y: 2, floorId: 'ground', markerId: 'lamp' });
  });

  it('keeps the focused room through selection, geometry, label and order updates inside a card shadow root', () => {
    const host = document.createElement('div'); document.body.append(host);
    const stage = document.createElement('div'); host.attachShadow({ mode: 'open' }).append(stage);
    const map = new MiniMap(stage); maps.push(map);
    const data = { ...base(), rooms: [room(), room('hall')] }; map.update(data);
    const polygon = map.el.querySelector('[data-room="kitchen"]'); polygon.focus();
    map.update({ ...data, selectedRoomId: 'kitchen' });
    expect(host.shadowRoot.activeElement).toBe(polygon); expect(polygon.getAttribute('aria-pressed')).toBe('true');
    map.update({ ...data, rooms: [room('hall'), { ...room('kitchen', 'ground', [[0, 0], [5, 0], [5, 3], [0, 3]]), name: 'New kitchen' }] });
    expect(map.el.querySelector('[data-room="kitchen"]')).toBe(polygon); expect(host.shadowRoot.activeElement).toBe(polygon);
    expect(polygon.getAttribute('aria-label')).toBe('Focus New kitchen'); expect(polygon.getAttribute('aria-pressed')).toBe('false');
  });

  it('moves focus to the floor background when the focused device or room disappears', () => {
    const { map } = mount(); const data = { ...base(), positions: new Map([['lamp', { x: 1, y: 1, floorId: 'ground' }]]) };
    map.update(data); map.el.querySelector('[data-marker="lamp"]').focus();
    map.update(base()); expect(document.activeElement).toBe(map.ground);
    map.el.querySelector('[data-room="kitchen"]').focus();
    map.update({ ...base(), rooms: [room('hall')] }); expect(document.activeElement).toBe(map.ground);
  });

  it('returns keyboard focus to the opener when hidden, empty or disposed, without stealing outside focus', () => {
    const opener = document.createElement('button'); document.body.append(opener);
    const { map } = mount({ returnFocus: () => opener }); map.update(base());
    map.roomLayer.firstChild.focus(); map.setVisible(false); expect(document.activeElement).toBe(opener);
    map.setVisible(true); map.roomLayer.firstChild.focus(); map.update({ ...base(), rooms: [] }); expect(document.activeElement).toBe(opener);
    map.update(base()); map.roomLayer.firstChild.focus(); map.dispose(); expect(document.activeElement).toBe(opener);
    const { map: outside } = mount({ returnFocus: opener }); outside.update(base());
    const other = document.createElement('button'); document.body.append(other); other.focus();
    outside.setVisible(false); outside.dispose(); expect(document.activeElement).toBe(other);
  });

  it('keeps a programmatically focusable stage fallback and preserves any existing tabindex', () => {
    const { map, stage } = mount(); map.update(base()); map.roomLayer.firstChild.focus();
    map.setVisible(false); expect(document.activeElement).toBe(stage); expect(stage.getAttribute('tabindex')).toBe('-1');
    stage.setAttribute('tabindex', '0'); map.setVisible(true); map.roomLayer.firstChild.focus(); map.dispose();
    expect(document.activeElement).toBe(stage); expect(stage.getAttribute('tabindex')).toBe('0');
  });

  it('removes listeners and DOM on disposal and ignores later updates', () => {
    const onFocus = vi.fn(); const { stage, map } = mount({ onFocus }); map.update(base());
    const polygon = map.roomLayer.firstChild; const old = map.el;
    map.dispose(); map.dispose();
    expect(stage.contains(old)).toBe(false); expect(map._listeners).toHaveLength(0);
    polygon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    map.update(base()); map.updateCamera({}); map.setVisible(true);
    expect(onFocus).not.toHaveBeenCalled(); expect(stage.children).toHaveLength(0);
  });
});

describe('tracked observation symbols', () => {
  const tracked = (id = 'vacuum:robot', extra = {}) => ({ id, entityId: 'vacuum.robot', name: 'Robot: Cleaning · reported position',
    icon: 'mdi:robot-vacuum', color: '#57b990', active: true, status: 'ready', positionStatus: 'ready',
    position: { x: 1, y: 2, z: .05, floorId: 'ground' }, ...extra });

  it('renders explicit observation icons and their evidence labels without interpreting HA state', () => {
    const { map } = mount();
    map.update({ ...base(), states: { 'sensor.last_vehicle': { state: '2026-10-05T12:00:00Z' } }, trackedMarkers: [
      tracked(), tracked('vehicle:drive', { entityId: 'sensor.last_vehicle', name: 'Vehicle seen recently', icon: 'mdi:car' }),
      tracked('presence:person', { entityId: 'person.taylor', name: 'Taylor: Kitchen (room observation)', icon: 'mdi:account' }),
      tracked('activity:motion', { entityId: 'binary_sensor.motion', name: 'Kitchen: Room activity', icon: 'mdi:motion-sensor' }),
    ] });
    expect(map.scene.markers).toHaveLength(4);
    expect(map.el.querySelectorAll('.map-marker.tracked')).toHaveLength(4);
    for (const marker of map.markerLayer.children) {
      expect(marker.querySelector('.symbol').getAttribute('d')).toBeTruthy();
      expect(marker.querySelector('.dot').getAttribute('r')).toBe('7');
      expect(marker.getAttribute('tabindex')).toBe('0');
    }
    const car = map.el.querySelector('[data-marker="vehicle:drive"]');
    expect(car.getAttribute('aria-label')).toContain('Vehicle seen recently');
    expect(car.getAttribute('aria-label')).not.toContain('2026-10-05');
    expect(car.getAttribute('aria-label')).not.toContain('parked');
    expect(map.el.querySelector('canvas')).toBeNull();
  });

  it('replaces exact ordinary source dots while preserving grouped controls and deliberate separate observations', () => {
    const data = { ...base(), trackedMarkers: [tracked(), tracked('vacuum:other', { position: { x: 3, y: 1, floorId: 'ground' } })],
      positions: new Map([
        ['entity:vacuum.robot', { x: 0, y: 0, floorId: 'ground' }], ['object:robot', { x: 0, y: 0, floorId: 'ground' }],
        ['device:robot', { x: 2, y: 2, floorId: 'ground' }], ['lamp', { x: 3, y: 1, floorId: 'ground' }],
      ]), markers: [
        { id: 'entity:vacuum.robot', entityId: 'vacuum.robot', entities: [{ eid: 'vacuum.robot' }] },
        { id: 'object:robot', entityId: 'vacuum.robot' },
        { id: 'device:robot', entityId: 'vacuum.robot', entities: [{ eid: 'vacuum.robot' }, { eid: 'sensor.robot_battery' }] },
        { id: 'lamp', entityId: 'light.lamp' },
      ] };
    const scene = miniMapScene(data);
    expect(scene.markers.map((m) => m.id)).toEqual(['device:robot', 'lamp', 'vacuum:robot', 'vacuum:other']);
    expect(data.positions.size).toBe(4); expect(data.markers).toHaveLength(4);
    // Once an observation disappears, the original marker reappears without any input mutation.
    expect(miniMapScene({ ...data, trackedMarkers: [] }).markers).toHaveLength(4);
  });

  it('discards unplaced, hidden, off-floor, invalid and ambiguous-ID observations before fitting', () => {
    const scene = miniMapScene({ ...base(), visibleFloors: new Set(['ground']), trackedMarkers: [tracked(),
      tracked('missing', { position: null }), tracked('hidden', { shown: false }),
      tracked('hidden-position', { position: { x: 80, y: 80, floorId: 'ground', shown: false } }),
      tracked('other-floor', { position: { x: 80, y: 80, floorId: 'first' } }),
      tracked('bad', { position: { x: NaN, y: 2, floorId: 'ground' } }),
      tracked('huge', { position: { x: 1e7, y: 2, floorId: 'ground' } }),
      tracked('duplicate'), tracked('duplicate'), tracked('no-source', { entityId: null }),
    ] });
    expect(scene.markers.map((m) => m.id)).toEqual(['vacuum:robot']);
    expect(scene.transform.bounds).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 3 });
    expect(miniMapScene({ ...base(), rooms: [{ ...room(), shown: false }], trackedMarkers: [tracked()] }).markers).toEqual([]);
  });

  it('keeps actual source/floor selection in tap and keyboard callbacks without sending any service', () => {
    const order = [], onFocus = vi.fn(() => order.push('focus')), onMarker = vi.fn(() => order.push('marker')), callService = vi.fn();
    const { map } = mount({ onFocus, onMarker });
    map.update({ ...base(), rooms: [room(), room('bedroom', 'first')], floors: [
      { id: 'ground', name: 'Ground floor', elevation: 0 }, { id: 'first', name: 'First floor', elevation: 3 }], visibleFloors: 'all', callService,
      trackedMarkers: [tracked(), tracked('vacuum:upstairs', { entityId: 'vacuum.upstairs', position: { x: 2.3, y: 1.7, floorId: 'first' } })] });
    map.select.value = 'first'; map.select.dispatchEvent(new Event('change', { bubbles: true }));
    const symbol = map.el.querySelector('[data-marker="vacuum:upstairs"]');
    expect(map.el.querySelector('[data-marker="vacuum:robot"]')).toBeNull();
    symbol.querySelector('.symbol').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    symbol.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onFocus).toHaveBeenLastCalledWith({ x: 2.3, y: 1.7, floorId: 'first', markerId: 'vacuum:upstairs' });
    expect(onMarker).toHaveBeenLastCalledWith('vacuum:upstairs', expect.objectContaining({ entityId: 'vacuum.upstairs', tracked: true, floorId: 'first' }));
    expect(order).toEqual(['focus', 'marker', 'focus', 'marker']); expect(callService).not.toHaveBeenCalled();
  });

  it('preserves a tracked keyboard target across real position/status updates and clears invalid styles safely', () => {
    const { map } = mount(); map.update({ ...base(), trackedMarkers: [tracked()] });
    const marker = map.el.querySelector('[data-marker="vacuum:robot"]'); marker.focus();
    const originalPath = marker.querySelector('.symbol');
    map.update({ ...base(), trackedMarkers: [tracked(undefined, { name: '<script>Robot</script>: Cleaning; position stale', positionStatus: 'stale', color: 'url(javascript:bad)', position: { x: 2.5, y: 1, floorId: 'ground' } })] });
    expect(document.activeElement).toBe(marker); expect(marker.querySelector('.symbol')).toBe(originalPath);
    expect(marker.classList.contains('unavailable')).toBe(true);
    expect(marker.getAttribute('aria-label')).toContain('position stale');
    expect(marker.style.getPropertyValue('--taylors3d-map-marker-color')).toBe('');
    expect(marker.getAttribute('transform')).not.toContain('NaN'); expect(map.el.querySelector('script')).toBeNull();
    map.update({ ...base(), trackedMarkers: [] }); expect(document.activeElement).toBe(map.ground);
  });
});
