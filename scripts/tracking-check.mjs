import { revealEditorTab } from './lib/editor-tab-navigation.mjs';
// Browser checks use explicit simulated observations, not household detections or routes.
import fs from 'node:fs';
import path from 'node:path';
import { openDemo, root } from './lib/demo-browser.mjs';

const checks = [], browserErrors = [];
const check = (name, pass, details) => {
  checks.push(pass);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${details ? ' – ' + JSON.stringify(details) : ''}`);
};
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function control(page, selector, action) {
  await revealEditorTab(page, selector);
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement();
    if (!element) throw new Error('Missing tracking control: ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await action(element);
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector) => control(page, selector, (el) => el.click());
const select = (page, field, value) => control(page, `[data-field="trk-${field}"]`, (el) => el.select(value));
const type = (page, field, value) => control(page, `[data-field="trk-${field}"]`, async (el) => {
  await el.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type(value);
});
async function statePatch(page, changes) {
  await page.evaluate((changes) => {
    const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, states: { ...c._hass.states, ...changes } };
  }, changes);
  await settle(page);
}
async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    return { records: c._trackingData.records.map((r) => ({ id: r.id, entity: r.entity, active: r.active, shown: r.shown,
      status: r.status, measured: r.measured, location: r.location, label: r.label })),
    parts: [...c._trackingLayer.parts].map(([id, p]) => ({ id, position: p.group.position.toArray(),
      label: p.label?.element.textContent, connected: !!p.label?.element.isConnected })),
    map: c._miniMap.scene.markers.map((m) => ({ id: m.id, entity: m.entityId, tracked: m.tracked, x: m.x, y: m.y })),
    deadline: c._trackingDeadline, timer: !!c._trackingTimer, calls: window.trackingFixture.services.length,
    visible: c._trackingLayer.group.visible, selection: c._devicePopup._selection?.marker?.entityId,
    savedVehicles: c._layout.vehicle_bindings || [] };
  });
}
async function prepare(page) {
  await page.evaluate(() => {
    window.__demoMowerPaused = true;
    document.querySelectorAll('section.theme')[1]?.remove(); document.querySelector('main').style.display = 'block';
    const c = document.querySelector('taylors3d-card');
    window.trackingFixture = { services: [] };
    c.setConfig({ ...c._config, height: '700px', control_panel: 'right', view: 'top' });
    c.hass = { ...c._hass, callService: (...args) => { window.trackingFixture.services.push(args); return Promise.resolve(); },
      states: { ...c._hass.states,
        'binary_sensor.tracking_motion': { state: 'on', attributes: { friendly_name: 'Lounge motion', device_class: 'motion' } },
        'sensor.tracking_room': { state: 'Lounge', attributes: { friendly_name: 'Reported room' } },
        'person.tracking_taylor': { state: 'home', attributes: { friendly_name: 'Taylor' } },
        'binary_sensor.tracking_drive': { state: 'on', last_changed: '2026-01-01T00:00:00Z', attributes: { friendly_name: 'Driveway vehicles' } },
        'event.tracking_vehicle': { state: 'unknown', attributes: { friendly_name: 'Driveway sighting', event_type: 'vehicle' } },
        'vacuum.tracking_one': { state: 'cleaning', attributes: { friendly_name: 'Downstairs vacuum' } },
        'vacuum.tracking_two': { state: 'cleaning', attributes: { friendly_name: 'Upstairs vacuum' } },
        'sensor.tracking_xy': { state: 'ready', attributes: { friendly_name: 'Vacuum coordinates', x: 1.2, y: 3.4 } } } };
    c._commit({ ...c._layout,
      presence_bindings: [
        { id: 'motion', entity: 'binary_sensor.tracking_motion', kind: 'room_activity', signal: 'motion', roomId: 'r-living', active_states: ['on'], clear_states: ['off'] },
        { id: 'taylor', entity: 'sensor.tracking_room', identity_entity: 'person.tracking_taylor', kind: 'room_location', room_source: { entity: 'sensor.tracking_room', room_map: { Lounge: 'r-living', Kitchen: 'r-kitchen' } } } ],
      vehicle_bindings: [{ id: 'parked', entity: 'binary_sensor.tracking_drive', kind: 'occupancy', vehicle_source_confirmed: true,
        active_states: ['on'], clear_states: ['off'], label: 'Driveway', position: { x: 17, y: -2, z: .05, floorId: 'ground' } }],
      vacuum_bindings: [
        { id: 'one', entity: 'vacuum.tracking_one', kind: 'xy', position: { x: 6, y: 2, z: .05, floorId: 'ground' },
          position_source: { entity: 'sensor.tracking_xy', source: 'xy', units: 'm', plan_meters: true, x_attr: 'x', y_attr: 'y', floorId: 'ground' } },
        { id: 'two', entity: 'vacuum.tracking_two', kind: 'static', roomId: 'r-kids' } ] });
    c._view.stopCameraMotion();
  });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._trackingData?.records.length === 5);
  await settle(page);
}

let session;
try {
  session = await openDemo({ view: 'top', floor: 'ground' }, { width: 1280, height: 1000 });
  const { page } = session; await prepare(page);
  let s = await snapshot(page);
  check('motion stays anonymous while a separately observed room identifies Taylor', s.records.find((r) => r.id === 'activity:motion')?.label.includes('Room activity')
    && !s.records.find((r) => r.id === 'activity:motion')?.label.includes('Taylor')
    && s.records.find((r) => r.id === 'presence:taylor')?.label.includes('Taylor: Living room'), s.records);
  check('a car parked since January stays displayed from its current occupancy state', s.records.find((r) => r.id === 'vehicle:parked')?.active
    && s.parts.some((p) => p.id === 'vehicle:parked') && s.deadline === null && !s.timer);
  check('measured vacuum coordinates map into the existing scene and upstairs status stays on its floor', s.parts.some((p) => p.id === 'vacuum:one' && p.position.join(',') === '1.2,0.05,-3.4')
    && !s.parts.some((p) => p.id === 'vacuum:two') && s.records.find((r) => r.id === 'vacuum:two')?.label.includes('status at chosen anchor'));
  check('mini-map includes evidence-based tracking symbols and makes no device action', s.map.some((m) => m.id === 'vehicle:parked' && m.tracked)
    && s.map.some((m) => m.id === 'vacuum:one' && m.x === 1.2 && m.y === 3.4) && s.calls === 0);
  const shared = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), a = c._trackingLayer.parts.get('activity:motion'), b = c._trackingLayer.parts.get('presence:taylor');
    const ar = a.label.element.getBoundingClientRect(), br = b.label.element.getBoundingClientRect();
    return { samePosition: a.group.position.equals(b.group.position), separated: ar.bottom <= br.top || br.bottom <= ar.top,
      sizes: ar.height >= 44 && br.height >= 44 && ar.width <= 200 && br.width <= 200,
      descriptions: a.label.element.title.includes('Room activity') && b.label.element.getAttribute('aria-label').includes('Taylor') };
  });
  check('shared room observations retain the true marker position with separate readable touch labels', shared.samePosition && shared.separated && shared.sizes && shared.descriptions, shared);
  const targets = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), labels = [...c._trackingLayer.parts.values()]
      .map((p) => p.label?.element).filter((el) => el && !el.hidden && el.style.display !== 'none');
    return labels.map((el) => {
      const r = el.getBoundingClientRect(), hit = c.shadowRoot.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { id: el.dataset.trackingId, ownTarget: hit === el || el.contains(hit), height: r.height,
        overlap: labels.some((other) => {
          if (other === el) return false;
          const o = other.getBoundingClientRect();
          return r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top;
        }) };
    });
  });
  check('nearby tracking controls have separate 44px targets that hit their own actor', targets.length >= 4
    && targets.every((t) => t.ownTarget && !t.overlap && t.height >= 44), targets);
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'screenshots/tracking-active-overview.png') });
  const contrast = async () => page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    const luminance = (colour) => {
      const channels = colour.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) return NaN;
      return channels.map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    };
    return [...c.shadowRoot.querySelectorAll('.taylors3d-tracked-label')].filter((el) => !el.hidden).map((el) => {
      const style = getComputedStyle(el), a = luminance(style.color), b = luminance(style.backgroundColor);
      return { id: el.dataset.trackingId, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
  const lightContrast = await contrast();
  await page.evaluate(() => { const section = document.querySelector('section.theme'); section.classList.replace('light', 'dark'); section.querySelector('h2').textContent = 'Dark theme'; });
  const darkContrast = await contrast();
  check('tracking descriptions remain readable in light and dark themes', [lightContrast, darkContrast]
    .every((theme) => theme.length >= 4 && theme.every((label) => label.ratio >= 4.5)), { lightContrast, darkContrast });
  await page.screenshot({ path: path.join(root, 'screenshots/tracking-dark-controls.png') });
  await page.evaluate(() => { const section = document.querySelector('section.theme'); section.classList.replace('dark', 'light'); section.querySelector('h2').textContent = 'Light theme'; });
  await click(page, '[data-marker="vehicle:parked"]'); s = await snapshot(page);
  check('a real mini-map vehicle click opens the correct right-hand source controls without service calls', s.selection === 'binary_sensor.tracking_drive' && s.calls === 0, s.selection);
  await page.keyboard.press('Escape'); await settle(page);
  await control(page, '.taylors3d-tracked-label[data-tracking-id="vacuum:one"]', (el) => el.click()); s = await snapshot(page);
  check('a real 3D vacuum label click opens its vacuum controls without starting it', s.selection === 'vacuum.tracking_one' && s.calls === 0, s.selection);
  await page.screenshot({ path: path.join(root, 'screenshots/tracking-vacuum-panel.png') });
  await page.keyboard.press('Escape'); await settle(page);
  await statePatch(page, { 'sensor.tracking_xy': { state: 'ready', attributes: { x: 2.3, y: 4.1 } } }); s = await snapshot(page);
  check('new coordinate evidence moves only the measured vacuum', s.parts.some((p) => p.id === 'vacuum:one' && p.position.join(',') === '2.3,0.05,-4.1')
    && s.parts.some((p) => p.id === 'vehicle:parked' && p.position.join(',') === '17,0.05,2'));
  await statePatch(page, { 'sensor.tracking_xy': { state: 'unavailable', attributes: { x: 88, y: 99 } } }); s = await snapshot(page);
  check('unavailable coordinates use the labelled chosen fallback, never stale position attributes', s.records.find((r) => r.id === 'vacuum:one')?.measured === false
    && s.parts.some((p) => p.id === 'vacuum:one' && p.position.join(',') === '6,0.05,-2') && s.records.find((r) => r.id === 'vacuum:one')?.label.includes('position unavailable'));
  await statePatch(page, { 'person.tracking_taylor': { state: 'not_home', attributes: { friendly_name: 'Taylor' } } }); s = await snapshot(page);
  check('away identity conflicting with a room reading hides its person symbol', s.records.find((r) => r.id === 'presence:taylor')?.status === 'ambiguous' && !s.parts.some((p) => p.id === 'presence:taylor'));
  await statePatch(page, { 'binary_sensor.tracking_drive': { state: 'off', attributes: { friendly_name: 'Driveway vehicles' } } }); s = await snapshot(page);
  check('confirmed departure clears the parked car and its mini-map symbol', !s.parts.some((p) => p.id === 'vehicle:parked') && !s.map.some((m) => m.id === 'vehicle:parked'));
  await page.evaluate(() => document.querySelector('taylors3d-card')._setFloor('first')); await settle(page); s = await snapshot(page);
  check('upstairs vacuum appears at its actual floor height without moving the downstairs one upstairs', s.parts.some((p) => p.id === 'vacuum:two' && p.position[1] > 3)
    && !s.parts.some((p) => p.id === 'vacuum:one'));
  await page.evaluate(() => document.querySelector('taylors3d-card')._setFloor('ground')); await settle(page);

  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="tracking"]');
  s = await snapshot(page); check('Tracking tab retains configured location previews while editing', s.visible);
  await click(page, '[data-act="trk-section"][data-section="vehicles"]'); await click(page, '[data-act="trk-add"]');
  await select(page, 'entity', 'binary_sensor.tracking_drive'); await select(page, 'location-mode', 'position');
  await type(page, 'x', '16'); await type(page, 'y', '-1'); await select(page, 'floor', 'ground');
  await click(page, '[data-field="trk-vehicle-confirmed"]'); await type(page, 'label', 'Parking bay');
  const focused = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.trackingDraftInput = c.shadowRoot.activeElement; return !!window.trackingDraftInput; });
  await statePatch(page, { 'sensor.tracking_unrelated': { state: '42', attributes: {} } });
  const retained = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return c.shadowRoot.activeElement === window.trackingDraftInput && window.trackingDraftInput.value === 'Parking bay'; });
  check('an unrelated HA update keeps the exact focused draft input and typed text', focused && retained);
  await click(page, '[data-act="trk-save"]'); s = await snapshot(page);
  check('real visual Save records one new explicit vehicle binding', s.savedVehicles.length === 2 && s.savedVehicles[1]?.label === 'Parking bay'
    && s.savedVehicles[1]?.position?.x === 16 && s.savedVehicles[1]?.vehicle_source_confirmed === true && s.calls === 0, s.savedVehicles);
  await click(page, '[data-act="history-undo"]'); s = await snapshot(page); check('Undo removes that binding while keeping the earlier car', s.savedVehicles.length === 1 && s.savedVehicles[0]?.id === 'parked');
  await click(page, '[data-act="history-redo"]'); s = await snapshot(page); check('Redo restores the exact saved source and position', s.savedVehicles.length === 2 && s.savedVehicles[1]?.position?.y === -1);
  await click(page, '[data-act="trk-edit"][data-index="1"]'); await type(page, 'label', 'Unsaved change');
  await click(page, '[data-act="tab"][data-id="cameras"]'); await click(page, '[data-act="tab"][data-id="tracking"]');
  const discarded = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return c._edit._trackingEditor.draft === null && c._layout.vehicle_bindings[1].label === 'Parking bay'; });
  check('leaving Tracking discards its unsaved draft without changing the saved binding', discarded);
  await page.setViewport({ width: 320, height: 1000, deviceScaleFactor: 1 }); await settle(page);
  await click(page, '[data-act="trk-add"]');
  const narrow = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), form = c.shadowRoot.querySelector('[data-trk-editor]');
    return { overflow: document.documentElement.scrollWidth > innerWidth,
      targets: [...form.querySelectorAll('button,input,select')].filter((el) => el.getClientRects().length).every((el) => el.getBoundingClientRect().height >= 44),
      source: !!form.querySelector('[data-field="trk-entity"]'),
      tabs: [...c._edit.panel.querySelectorAll('.tabs button')].filter((button) => button.getClientRects().length && !button.closest('[hidden],details:not([open])')).every((button) => {
        const rect = button.getBoundingClientRect(), parent = button.parentElement.getBoundingClientRect();
        return rect.height >= 44 && rect.left >= parent.left - 1 && rect.right <= parent.right + 1;
      }) }; });
  check('320px Tracking form and every editor tab fit the screen with 44px touch controls', !narrow.overflow && narrow.targets && narrow.source && narrow.tabs, narrow);
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'screenshots/tracking-editor-narrow.png'), fullPage: true });
  await click(page, '[data-act="trk-cancel"]'); await click(page, 'button.edit');
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 }); await settle(page);

  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); window.trackingEventTime = new Date().toISOString();
    c.hass = { ...c._hass, states: { ...c._hass.states, 'event.tracking_vehicle': { state: window.trackingEventTime, attributes: { event_type: 'vehicle' } } } };
    c._commit({ ...c._layout, vehicle_bindings: [{ id: 'sighting', entity: 'event.tracking_vehicle', kind: 'event', vehicle_source_confirmed: true,
      timestamp_mode: 'state', timestamp_format: 'iso', event_types: ['vehicle'], expires_seconds: 4,
      position: { x: 17, y: -2, z: .05, floorId: 'ground' } }] });
  }); await settle(page); s = await snapshot(page); const originalDeadline = s.deadline;
  check('a timestamped sighting is labelled recent and schedules one absolute expiry', s.records.find((r) => r.id === 'vehicle:sighting')?.label.includes('seen recently') && s.timer && Number.isFinite(originalDeadline), s.deadline);
  await statePatch(page, { 'sensor.tracking_unrelated': { state: '43', attributes: {} } }); s = await snapshot(page);
  check('unrelated readings preserve the original sighting deadline', s.deadline === originalDeadline);
  await page.waitForFunction(() => !document.querySelector('taylors3d-card')._trackingLayer.parts.has('vehicle:sighting'), { timeout: 6500 }); s = await snapshot(page);
  check('the sighting expires without another HA update and cancels its timer', !s.records.find((r) => r.id === 'vehicle:sighting')?.active && !s.timer);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, states: { ...c._hass.states,
    'event.tracking_vehicle': { state: window.trackingEventTime, attributes: { event_type: 'vehicle' } } } }; }); await settle(page); s = await snapshot(page);
  check('replaying the same expired sighting never renews it', !s.records.find((r) => r.id === 'vehicle:sighting')?.active && !s.parts.some((p) => p.id === 'vehicle:sighting'));
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, states: { ...c._hass.states,
    'event.tracking_vehicle': { state: new Date().toISOString(), attributes: { event_type: 'vehicle' } } } }; }); await settle(page); s = await snapshot(page);
  check('a genuinely newer vehicle observation starts a new sighting', s.records.find((r) => r.id === 'vehicle:sighting')?.active && s.deadline > originalDeadline);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.trackingDetached = c; c.remove(); }); await settle(page);
  const stopped = await page.evaluate(() => !window.trackingDetached._trackingTimer && !window.trackingDetached._view._raf);
  check('detaching the card clears its expiry timer and render loop', stopped);
  await page.evaluate(async () => { await new Promise((resolve) => setTimeout(resolve, 4300)); document.querySelector('section.theme').append(window.trackingDetached); });
  await page.waitForFunction(() => !document.querySelector('taylors3d-card')._trackingLayer.parts.has('vehicle:sighting')); s = await snapshot(page);
  check('reconnect reevaluates the absolute timestamp instead of replaying an expired sighting', !s.records.find((r) => r.id === 'vehicle:sighting')?.active && !s.timer && s.calls === 0);
  await page.screenshot({ path: path.join(root, 'screenshots/tracking-overview.png') });
} catch (error) { check('tracking UI and observation scenario completes', false, error.message); }
finally { if (session) { browserErrors.push(...session.errors); await session.close(); } }

session = null;
try {
  session = await openDemo({ model: '1', view: 'top', floor: 'ground' }, { width: 1280, height: 920 });
  const { page } = session;
  await page.waitForFunction(() => !!document.querySelector('taylors3d-card')._view.model, { timeout: 30000 });
  await page.evaluate(() => {
    window.__demoMowerPaused = true; window.trackingFixture = { services: [] };
    const c = document.querySelector('taylors3d-card'), room = c._roomList.find((entry) => entry.room.area_id === 'living_room');
    if (!room) throw new Error('Missing tagged model lounge.');
    c.hass = { ...c._hass, callService: (...args) => window.trackingFixture.services.push(args), states: { ...c._hass.states,
      'binary_sensor.tracking_drive': { state: 'on', attributes: { friendly_name: 'Driveway vehicles' } } } };
    c._commit({ ...c._layout, vehicle_bindings: [{ id: 'parked', entity: 'binary_sensor.tracking_drive', kind: 'occupancy', vehicle_source_confirmed: true,
      active_states: ['on'], clear_states: ['off'], roomId: room.room.id }] });
    c._view.stopCameraMotion();
  });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._trackingLayer.parts.has('vehicle:parked'));
  await page.waitForFunction(() => {
    const v = document.querySelector('taylors3d-card')._view, now = performance.now();
    if (v.dirty || v._tween || now - (v._camMovedAt || 0) < 350) { window.trackingIdle = null; return false; }
    if (!window.trackingIdle || window.trackingIdle.frames !== v.stats.frames || window.trackingIdle.shadow !== v.stats.shadow) {
      window.trackingIdle = { ...v.stats, at: now }; return false;
    } return now - window.trackingIdle.at >= 350;
  }, { timeout: 10000 });
  const idle = await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card'), stats = () => ({ ...c._view.stats }), part = c._trackingLayer.parts.get('vehicle:parked'), before = stats();
    for (let i = 0; i < 10; i++) { c.hass = { ...c._hass, states: { ...c._hass.states, 'sensor.tracking_unrelated': { state: String(i), attributes: {} } } };
      await new Promise((resolve) => setTimeout(resolve, 40)); }
    await new Promise((resolve) => setTimeout(resolve, 350));
    const after = stats(); return { before, after, same: part === c._trackingLayer.parts.get('vehicle:parked'), timer: !!c._trackingTimer, services: window.trackingFixture.services.length };
  });
  check('ten unrelated GLB updates keep parked geometry and cause zero frames/shadow work/timers/services', idle.same && !idle.timer && idle.services === 0
    && ['frames', 'shadow', 'shadowLights'].every((key) => idle.before[key] === idle.after[key]), idle);
  await page.screenshot({ path: path.join(root, 'screenshots/tracking-model.png') });
} catch (error) { check('tagged-model tracking performance scenario completes', false, error.message); }
finally { if (session) { browserErrors.push(...session.errors); await session.close(); } }
check('no browser errors', browserErrors.length === 0, browserErrors);
if (checks.some((pass) => !pass)) process.exitCode = 1;
