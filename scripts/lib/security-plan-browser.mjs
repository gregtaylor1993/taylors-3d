// Explicit simulated locks/contacts on an authored two-floor bench. The existing
// renderer supplies every pixel. No clocks, timers, lights or service shortcuts.
import fs from 'node:fs';
import path from 'node:path';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, epsilon = 1e-8) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= epsilon);
const lockId = 'lock.security_plan', contactId = 'binary_sensor.security_plan', otherId = 'lock.security_other';
async function ready(page, { model = true } = {}) {
  await page.waitForFunction((model) => {
    const c = document.querySelector('taylors3d-card'), v = c?._view, now = performance.now();
    if (!v || c._loading || (model ? !v.model?.manifest?.levels.some((level) => level.id === 'fp_upper') : !!v.model) || v.dirty || v._tween || v._modelMotionMoving
      || v._occFull || v._occTimer || now - (v._camMovedAt || 0) < 350) { window.planSecurityReady = null; return false; }
    if (!window.planSecurityReady || window.planSecurityReady.frames !== v.stats.frames) { window.planSecurityReady = { frames: v.stats.frames, at: now }; return false; }
    return now - window.planSecurityReady.at > 350;
  }, { polling: 50, timeout: 15000 }, model);
}
async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, layer = c._planSecurityLayer, f = window.planSecurityFixture;
    const records = c._securityPlanData.records.map((record) => {
      const part = layer?.parts.get(record.id), body = part?.body;
      return { id: record.id, entity: record.entity, status: record.status, active: record.active, open: record.open, locked: record.locked,
        color: record.color, source: record.location, world: part?.group.position.toArray(), shown: record.shown, visible: part?.group.visible,
        label: body?.textContent, body: body?.dataset.securityId, disabled: body?.disabled, planes: part?.ringMaterial.clippingPlanes?.length,
        material: part?.ringMaterial.uuid, version: part?.ringMaterial.version, glyph: part?.glyph.geometry.uuid, ring: part?.ring.geometry.uuid };
    });
    const pool = [...c._objects.pool.points, ...c._objects.pool.spots];
    return { records, bindings: c._layout.security_bindings, miniMap: c._securityPlanData.miniMap, generation: c._securitySessionGeneration,
      sourceFloor: v.floorElevation('upper'), presentation: c.floorPresentationReport(), activeFloor: c._floor,
      modelParts: c._securityLayer.parts.size, diagnostics: [...c._securityPlanData.diagnostics, ...c._securityLayer.diagnostics],
      calls: f.services.length, commits: f.commits.length, moreInfo: f.moreInfo.slice(), popup: c._devicePopup.el?.textContent ?? null,
      popupEntities: [...(c._devicePopup.el?.querySelectorAll('[data-entity]') || [])].map((el) => el.dataset.entity),
      stats: { ...v.stats }, objectStats: { ...c._objects.stats }, memory: { ...v.renderer.info.memory }, programs: v.renderer.info.programs.map((program) => program.id),
      pool: pool.map((light) => light.uuid), castShadow: pool.filter((light) => light.castShadow).length,
      canvas: c.shadowRoot.querySelectorAll('canvas').length, rendererSame: v.renderer === f.renderer,
      motion: v._modelMotionRevision, timer: !!c._trackingTimer, deadline: c._trackingDeadline,
      helperLights: layer ? (() => { let count = 0; layer.group.traverse((node) => { if (node.isLight) count++; }); return count; })() : 0 };
  });
}
async function source(page, id, value, attributes = {}) {
  await page.evaluate(({ id, value, attributes }) => {
    const c = document.querySelector('taylors3d-card'), before = c._hass.states[id];
    c.hass = { ...c._hass, states: { ...c._hass.states, [id]: { ...before, state: value, attributes: { ...before?.attributes, ...attributes } } } };
  }, { id, value, attributes });
}
async function bodyPoint(page, id = 'security_1') {
  return page.evaluate((id) => {
    const c = document.querySelector('taylors3d-card'), body = c._planSecurityLayer?.parts.get(id)?.body, rect = body?.getBoundingClientRect();
    if (!rect || body.disabled || rect.width < 44 || rect.height < 44) throw new Error('No current visible 44px plan label: ' + id);
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    if (c.shadowRoot.elementFromPoint(x, y) !== body) throw new Error('Plan label centre is covered by a different control: ' + id);
    return { x, y, width: rect.width, height: rect.height };
  }, id);
}
async function mapButton(page) {
  return page.evaluateHandle(() => {
    const c = document.querySelector('taylors3d-card'), prefix = 'security:security_1:';
    return [...c._miniMap.el.querySelectorAll('[data-marker]')].find((node) => node.getAttribute('data-marker').startsWith(prefix));
  });
}
async function clickMap(page) {
  const handle = await mapButton(page);
  try {
    const node = handle.asElement();
    if (!node) throw new Error('No exact current lock mini-map button.');
    await node.evaluate((symbol) => {
      const card = document.querySelector('taylors3d-card');
      const expected = `security:security_1:${card._securitySessionGeneration}`;
      if (!(symbol instanceof SVGElement) || !symbol.isConnected || !card._miniMap.el.contains(symbol)
        || symbol.getAttribute('data-marker') !== expected || symbol.getAttribute('role') !== 'button'
        || symbol.getAttribute('tabindex') !== '0') throw new Error('No exact current accessible SVG lock mini-map button.');
      symbol.focus();
      if (card.shadowRoot.activeElement !== symbol) throw new Error('Exact SVG lock mini-map button did not receive native focus.');
    });
    await page.keyboard.press('Enter');
  }
  finally { await handle.dispose(); }
}
async function mapFloor(page, floorId) {
  const handle = await page.evaluateHandle(() => document.querySelector('taylors3d-card')._miniMap.select);
  try { if (!handle.asElement()) throw new Error('No genuine map floor selector.'); await handle.asElement().select(floorId); }
  finally { await handle.dispose(); }
}
async function screenshot(page, root, name, mode, fullPage = false) {
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, `screenshots/${name}${mode === 'bundle' ? '-bundle' : ''}.png`), fullPage });
}

export async function planSecurityScenario(page, { mode, root, check, click, select, type, settle }) {
  await page.evaluate(async (mode) => {
    const c = document.querySelector('taylors3d-card');
    c.hass = { ...c._hass, callWS: undefined };
    c.setConfig({ ...c._config, model: '/demo/security-plan-fixture.glb', merge: false, layout_key: `security-plan-${mode}`, height: '740px',
      view: '3d', sky_bodies: false, model_opacity: 1, mini_map: true, device_tap_action: 'popup', control_panel: 'right' });
    await c._layoutReady;
    window.planSecurityFixture = { services: [], commits: [], moreInfo: [], renderer: c._view.renderer };
    const f = window.planSecurityFixture;
    const state = (value, attributes) => ({ state: value, last_updated: new Date().toISOString(), attributes });
    const registry = (entity_id, area_id) => ({ entity_id, area_id, hidden: false, disabled_by: null, entity_category: null, device_id: null });
    c.hass = { ...c._hass, callWS: undefined, callService: (...args) => { f.services.push(args); return Promise.resolve(); },
      user: { id: 'simulated-security-admin', is_admin: true, is_active: true },
      floors: { ground: { floor_id: 'ground', name: 'Simulated ground', level: 0 }, upper: { floor_id: 'upper', name: 'Simulated upper', level: 1 } },
      areas: { floor_ground_area: { area_id: 'floor_ground_area', name: 'Simulated ground room', floor_id: 'ground' },
        floor_upper_area: { area_id: 'floor_upper_area', name: 'Simulated upper room', floor_id: 'upper' },
        security_plan_area: { area_id: 'security_plan_area', name: 'Simulated chosen plan room', floor_id: 'upper' } }, devices: {},
      entities: { 'lock.security_plan': registry('lock.security_plan', 'security_plan_area'), 'lock.security_other': registry('lock.security_other', null),
        'binary_sensor.security_plan': registry('binary_sensor.security_plan', 'security_plan_area'), 'sensor.security_unrelated': registry('sensor.security_unrelated', null) },
      states: { 'lock.security_plan': state('unlocked', { friendly_name: 'Simulated entrance lock' }),
        'lock.security_other': state('locked', { friendly_name: 'Different simulated lock' }),
        'binary_sensor.security_plan': state('on', { friendly_name: 'Simulated plan contact', device_class: 'door' }),
        // Membership is already known before the strict idle baseline.
        'sensor.security_unrelated': state('0', { friendly_name: 'Known unrelated sensor' }),
        'sun.sun': state('above_horizon', { elevation: 35, azimuth: 180 }) } };
    c._commit({ ...c._layout, floors: [{ id: 'ground', name: 'Simulated ground', elevation: 0, height: 3 }, { id: 'upper', name: 'Simulated upper', elevation: 4, height: 3 }],
      rooms: [{ id: 'security-plan-room', area_id: 'security_plan_area', floor_id: 'upper', name: 'Simulated chosen plan room',
        polygon: [[-1.8, -.8], [-1.1, -.8], [-1.1, -1.4], [-1.8, -1.4]], doors: [] }],
      pins: { 'entity:sensor.security_unrelated': { x: 1.4, y: -1, z: .2, floor_id: 'upper', auto: false } },
      objects: {}, groups: {}, hidden: [], mower: {}, security_bindings: [], presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [],
      room_overlays: { mode: 'off' }, alert_bindings: [], camera_coverage: {}, weather: { enabled: false }, scene_previews: { enabled: false }, ambient_idle: { enabled: false },
      floor_presentation: { mode: 'assembled' }, wall_presentation: { enabled: false },
      model: { levels: { fp_ground: { floor: 'ground' }, fp_upper: { floor: 'upper' }, fp_site: { floor: null } },
        rooms: { fp_room_ground: { area: 'floor_ground_area' }, fp_room_upper: { area: 'floor_upper_area' } } } });
    const commit = c.commitFeatureLayout.bind(c); c.commitFeatureLayout = (patch) => { f.commits.push(JSON.parse(JSON.stringify(patch))); return commit(patch); };
    c.addEventListener('hass-more-info', (event) => f.moreInfo.push(event.detail.entityId));
    document.querySelector('section.theme h2').textContent = `Simulated plan security and locks · ${mode}`;
  }, mode);
  await ready(page);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._setView('all', { instant: true }); c.resetHistory(); });
  await ready(page);
  let s = await snapshot(page); const initialMotion = s.motion;
  check('plan fixture has explicit source floors and preserves its distinct drawn room', s.sourceFloor === 4 && s.records.length === 0
    && s.canvas === 1 && s.rendererSame && s.calls === 0 && await page.evaluate(() => document.querySelector('taylors3d-card')._roomList.some((entry) => entry.room.id === 'security-plan-room')), s.sourceFloor);

  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="security"]'); await click(page, '[data-act="sec-add"]');
  await select(page, 'kind', 'lock'); await select(page, 'picker-area', 'area:security_plan_area'); await select(page, 'entity', lockId); await select(page, 'target-type', 'plan');
  await select(page, 'plan-source', 'position');
  const blank = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), fields = ['plan-floor', 'plan-x', 'plan-y', 'plan-z'];
    return { values: fields.map((field) => c.shadowRoot.querySelector(`[data-field="sec-${field}"]`).value),
      hinge: !!c.shadowRoot.querySelector('[data-field="sec-motion"]'), choices: [...c.shadowRoot.querySelector('[data-field="sec-entity"]').options].map((option) => option.value) };
  });
  check('native plan lock draft has no guessed floor, metres, hinge or out-of-area substitute', blank.values.every((value) => value === '') && !blank.hinge
    && blank.choices.includes(lockId) && !blank.choices.includes(otherId), blank);
  await select(page, 'plan-floor', 'upper'); await type(page, 'plan-x', '0'); await type(page, 'plan-y', '0.9'); await type(page, 'plan-z', '0.2');
  await type(page, 'label', 'Simulated entrance lock');
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.planSecurityFixture.focused = c.shadowRoot.activeElement; });
  await source(page, lockId, 'unlocked'); await settle(page);
  const focus = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return c.shadowRoot.activeElement === window.planSecurityFixture.focused
    && c.shadowRoot.activeElement.value === 'Simulated entrance lock' && !c._layout.security_bindings.length; });
  check('actual HA updates retain the focused lock draft without saving or moving any hinge', focus);
  await click(page, '[data-act="sec-save"]'); s = await snapshot(page);
  check('native Save stores one canonical plan lock and never a contact-open or motion rule', s.commits === 1 && s.bindings[0]?.kind === 'lock'
    && equal(s.bindings[0].target, { type: 'plan', position: { x: 0, y: .9, z: .2, floorId: 'upper' } })
    && s.bindings[0].motion === undefined && s.bindings[0].open_states === undefined && s.bindings[0].object_id === undefined && s.calls === 0, s.bindings);
  await click(page, '[data-act="history-undo"]'); check('plan Undo removes the actual helper records', (await snapshot(page)).records.length === 0);
  await click(page, '[data-act="history-redo"]'); check('plan Redo restores the same exact source once', (await snapshot(page)).records.length === 1 && (await snapshot(page)).commits === 1);
  await click(page, '[data-act="sec-edit"][data-index="0"]'); await type(page, 'plan-x', '99'); await click(page, '[data-act="sec-cancel"]');
  check('Cancel leaves the saved source coordinate unchanged', (await snapshot(page)).bindings[0].target.position.x === 0);
  await click(page, 'button.edit');
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._view.setCamera({ position: [4.5, 9, 9], target: [0, 4.1, 0] }, { instant: true }); }); await ready(page);
  s = await snapshot(page); const lock = s.records[0];
  check('unlocked evidence paints its actual existing-renderer glyph red at source north-up metres', lock.status === 'unlocked' && lock.open === null
    && lock.active === true && lock.locked === false && lock.color === '#ef5350' && lock.visible && near(lock.world, [0, 4.2, -.9])
    && s.modelParts === 0 && s.helperLights === 0 && s.pool.length === 12 && s.castShadow === 4 && s.canvas === 1 && s.rendererSame, lock);

  // Observe genuine GPU output during normal draws. Capture the projected ring
  // footprint, then sample those exact pixels when the current lock becomes clear.
  try {
    await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), v = c._view, f = window.planSecurityFixture;
      f.previousRender = v.onRender; f.captures = [];
      f.renderObserver = function (...args) {
        f.previousRender?.apply(this, args); const part = c._planSecurityLayer?.parts.get('security_1'); if (!part) return;
        const gl = v.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
        const center = part.group.position.clone(), projected = [];
        for (let i = 0; i < 32; i++) { const angle = i * Math.PI / 16, point = center.clone().add(center.clone().set(Math.cos(angle) * .29, 0, Math.sin(angle) * .29)).project(v.camera);
          projected.push([(point.x + 1) * width / 2, (point.y + 1) * height / 2]); }
        const x = Math.max(0, Math.floor(Math.min(...projected.map((point) => point[0])) - 2)), y = Math.max(0, Math.floor(Math.min(...projected.map((point) => point[1])) - 2));
        const w = Math.min(256, width - x, Math.ceil(Math.max(...projected.map((point) => point[0])) + 2 - x)), h = Math.min(256, height - y, Math.ceil(Math.max(...projected.map((point) => point[1])) + 2 - y));
        if (w <= 0 || h <= 0) return;
        const rgba = new Uint8Array(w * h * 4); gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        f.captures.push({ status: part.record.status, pixels: Array.from(rgba), box: [x, y, w, h], frame: v.stats.frames });
      }; v.onRender = f.renderObserver;
      v.setCamera({ position: [4.5, 9, 9.01], target: [0, 4.1, 0] }, { instant: true });
    }); await ready(page);
    await source(page, lockId, 'locked'); await ready(page);
    const pixels = await page.evaluate(() => {
      const captures = window.planSecurityFixture.captures, open = captures.findLast((sample) => sample.status === 'unlocked'), closed = captures.findLast((sample) => sample.status === 'locked');
      let changed = 0, red = 0;
      if (open && closed && JSON.stringify(open.box) === JSON.stringify(closed.box)) for (let i = 0; i < open.pixels.length; i += 4) {
        const a = open.pixels.slice(i, i + 3), b = closed.pixels.slice(i, i + 3);
        if (Math.max(...a.map((value, channel) => Math.abs(value - b[channel]))) > 15) { changed++; if (a[0] > a[1] * 1.15 && a[0] > a[2] * 1.15) red++; }
      }
      return { open: open && { box: open.box, frame: open.frame }, closed: closed && { box: closed.box, frame: closed.frame }, changed, red };
    });
    check('real GPU ring pixels change from active red to the exposed authored floor when locked', pixels.changed >= 3 && pixels.red >= 3 && pixels.closed.frame > pixels.open.frame, pixels);
  } finally {
    const restored = await page.evaluate(() => { const f = window.planSecurityFixture, v = document.querySelector('taylors3d-card')._view;
      if (v.onRender !== f.renderObserver) return false; v.onRender = f.previousRender; return v.onRender === f.previousRender; });
    check('pixel observer restores the exact original renderer callback', restored);
  }
  s = await snapshot(page);
  check('locked is confirmed clear with no door-open inference or model transform changes', s.records[0].status === 'locked' && s.records[0].locked === true
    && s.records[0].active === false && s.records[0].open === null && !s.records[0].visible && s.motion === initialMotion, s.records[0]);
  const clearMotion = s.motion;
  for (const [value, extra, expected] of [['locking', {}, 'locking'], ['unlocking', {}, 'unlocking'], ['jammed', {}, 'jammed'],
    ['unknown', {}, 'unknown'], ['unavailable', {}, 'unavailable'], ['unlocked', { restored: true }, 'unavailable']]) {
    await source(page, lockId, value, extra); await ready(page); s = await snapshot(page);
    check(`${value}${extra.restored ? ' restored' : ''} remains a labelled neutral uncertain lock without moving a door`, s.records[0].status === expected
      && s.records[0].active === null && s.records[0].locked === null && s.records[0].open === null && s.records[0].color === '#8d9199'
      && s.records[0].label.length > 0 && s.motion === clearMotion && s.calls === 0, s.records[0]);
  }
  await source(page, lockId, 'unlocked', { restored: false }); await ready(page);
  const point = await bodyPoint(page); await page.mouse.click(point.x, point.y); await settle(page); s = await snapshot(page);
  check('native 44px lock label opens only that current real entity and sends no command', s.popupEntities.includes(lockId) && !s.popupEntities.includes(otherId)
    && s.popup?.includes('Simulated entrance lock') && s.calls === 0, { point, popup: s.popup });
  await click(page, `[data-entity="${lockId}"] button[data-action="more-info"]`); s = await snapshot(page);
  check('deliberate All controls uses Home Assistant more-info for the exact lock without issuing a lock service', equal(s.moreInfo, [lockId]) && s.calls === 0, s.moreInfo);

  // Keep the same binding/button while changing its actual entity twice during a
  // held press. Recovery must not reinterpret the first intent as the second lock.
  const held = await bodyPoint(page); await page.mouse.move(held.x, held.y); await page.mouse.down();
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), original = c._layout.security_bindings;
    c.commitFeatureLayout({ security_bindings: original.map((binding) => ({ ...binding, entity: 'lock.security_other' })) });
    c.commitFeatureLayout({ security_bindings: original }); });
  await page.mouse.up(); await settle(page); s = await snapshot(page);
  check('held native label intent stays cancelled after same-ID source replacement and recovery', s.popup === null && s.calls === 0, s.popup);
  const fresh = await bodyPoint(page); await page.mouse.click(fresh.x, fresh.y); await settle(page);
  check('a fresh deliberate label press opens the recovered original lock', (await snapshot(page)).popupEntities.includes(lockId));
  await click(page, '.t3d-popup-close'); await ready(page);

  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ floor_presentation: {
    mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2, axis: 'east', base_elevation_m: 0 } }); }); await ready(page);
  s = await snapshot(page);
  const row = s.presentation.rows.find((floor) => floor.floor_id === 'upper'), offset = row?.offset;
  check('saved horizontal floor presentation maps plan security SOURCE to DISPLAY exactly once', s.presentation.valid && s.presentation.mode === 'horizontal'
    && Array.isArray(offset) && near(s.records[0].world, [offset[0], offset[1] + 4.2, offset[2] - .9])
    && near([s.miniMap[0].position.x, s.miniMap[0].position.y, s.miniMap[0].position.z], [0, .9, .2]) && s.miniMap[0].position.floorId === 'upper', { row, record: s.records[0], map: s.miniMap });
  await mapFloor(page, 'upper');
  await source(page, lockId, 'locked'); await ready(page); await clickMap(page); await settle(page); s = await snapshot(page);
  check('north-up map lock symbol remains an exact accessible entry even when its clear 3D glyph is hidden', s.popupEntities.includes(lockId) && s.records[0].active === false && s.calls === 0, s.popup);
  await click(page, '.t3d-popup-close'); await ready(page); await source(page, lockId, 'unlocked'); await ready(page);
  await click(page, '[data-mode="top"]'); await ready(page);
  const top = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return { mode: c._mode, orthographic: c._view.camera.isOrthographicCamera,
    world: c._planSecurityLayer.parts.get('security_1').group.position.toArray(), source: c._securityPlanData.records[0].location }; });
  check('Top mode uses the actual orthographic camera without shifting the chosen source indicator again', top.mode === 'top' && top.orthographic === true
    && near(top.world, [offset[0], offset[1] + 4.2, offset[2] - .9]) && top.source.x === 0 && top.source.y === .9, top);
  const topPoint = await bodyPoint(page); await page.mouse.click(topPoint.x, topPoint.y); await settle(page);
  check('native Top label still opens only the exact lock with no service action', (await snapshot(page)).popupEntities.includes(lockId) && (await snapshot(page)).calls === 0, topPoint);
  await click(page, '.t3d-popup-close'); await click(page, '[data-mode="3d"]'); await ready(page);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._setView('ground', { instant: true }); }); await ready(page); s = await snapshot(page);
  check('choosing the lower genuine floor hides the upper security indicator rather than relocating it', s.records[0].shown === false && !s.records[0].visible && s.miniMap.length === 0, s.records[0]);
  await page.evaluate(() => document.querySelector('taylors3d-card')._setView('all', { instant: true })); await ready(page);
  await click(page, 'button.section'); await ready(page);
  const section = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), part = c._planSecurityLayer.parts.get('security_1'), planes = [c._view.modelClip, c._view.sectionClip].filter(Boolean);
    return { count: part.ringMaterial.clippingPlanes.length, expected: planes.length, clipped: planes.some((plane) => plane.distanceToPoint(part.group.position) < 0), visible: part.group.visible, shown: part.shown }; });
  check('plan helpers compose actual floor and Section clipping with matching label visibility', section.count === section.expected && section.count >= 2
    && section.visible === (section.shown && !section.clipped), section);
  await click(page, 'button.section'); await ready(page);
  await mapFloor(page, 'upper'); await ready(page);

  // Same connection object loss/recovery is observed synchronously by the card.
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.planSecurityFixture.beforeLoss = c._securitySessionGeneration;
    c._hass.connection.connected = false; c.hass = { ...c._hass }; });
  s = await snapshot(page); check('observed session loss removes indicators and all security map entry points', s.records.length === 0 && s.miniMap.length === 0
    && s.popup === null && !s.timer, s.records);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._hass.connection.connected = true; c.hass = { ...c._hass }; }); await ready(page);
  const recovery = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return { generation: c._securitySessionGeneration,
    old: window.planSecurityFixture.beforeLoss, entries: [...c._miniMap.el.querySelectorAll('[data-marker]')].map((node) => node.getAttribute('data-marker')) }; });
  check('recovery makes a new current map generation instead of reviving old source intent', recovery.generation > recovery.old
    && recovery.entries.some((id) => id === `security:security_1:${recovery.generation}`) && !recovery.entries.includes(`security:security_1:${recovery.old}`), recovery);

  await ready(page); const before = await snapshot(page);
  await page.evaluate(async () => { const c = document.querySelector('taylors3d-card'), part = c._planSecurityLayer.parts.get('security_1'); window.planSecurityFixture.idlePart = part;
    for (let i = 0; i < 10; i++) { c.hass = { ...c._hass, states: { ...c._hass.states, 'sensor.security_unrelated': { ...c._hass.states['sensor.security_unrelated'], state: String(i) } } };
      await new Promise((resolve) => setTimeout(resolve, 40)); }
    await new Promise((resolve) => setTimeout(resolve, 350)); });
  s = await snapshot(page);
  check('ten unrelated known HA readings keep static plan frames, shadows, materials, programs, pools and resources unchanged', ['frames', 'shadow', 'shadowLights'].every((key) => before.stats[key] === s.stats[key])
    && equal(before.memory, s.memory) && equal(before.programs, s.programs) && equal(before.pool, s.pool)
    // `updates` counts state visits; only actual evaluation/assignment/shadow work must stay idle.
    && ['evaluated', 'budget', 'shadowRequests'].every((key) => before.objectStats[key] === s.objectStats[key])
    && before.records[0].material === s.records[0].material && before.records[0].version === s.records[0].version && !s.timer && s.calls === 0
    && await page.evaluate(() => document.querySelector('taylors3d-card')._planSecurityLayer.parts.get('security_1') === window.planSecurityFixture.idlePart),
    { before: { stats: before.stats, objectStats: before.objectStats, memory: before.memory, programs: before.programs, pool: before.pool,
      material: before.records[0].material, version: before.records[0].version, timer: before.timer, calls: before.calls },
    after: { stats: s.stats, objectStats: s.objectStats, memory: s.memory, programs: s.programs, pool: s.pool,
      material: s.records[0].material, version: s.records[0].version, timer: s.timer, calls: s.calls } });
  await screenshot(page, root, 'security-plan-lock', mode);

  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="security"]'); await click(page, '[data-act="sec-add"]');
  await select(page, 'entity', contactId); await click(page, '[data-act="sec-contact-preset"]'); await select(page, 'target-type', 'plan'); await select(page, 'plan-source', 'room');
  await select(page, 'plan-room', 'security-plan-room'); await type(page, 'label', 'Simulated room contact');
  await select(page, 'freshness-mode', 'timestamp'); await select(page, 'freshness-timestamp-mode', 'last_updated');
  await select(page, 'freshness-format', 'iso'); await type(page, 'freshness-age', '2'); await click(page, '[data-act="sec-save"]');
  s = await snapshot(page);
  check('native exact room contact saves its genuine outline and keeps the existing plan lock', s.bindings.length === 2 && s.bindings[1].target.roomId === 'security-plan-room'
    && s.records.find((record) => record.id === 'security_2')?.source.floorId === 'upper' && s.calls === 0
    && equal(s.bindings[1].freshness, { timestamp_mode: 'last_updated', timestamp_format: 'iso', max_age_seconds: 2 }), s.bindings[1]);
  await click(page, 'button.edit'); await ready(page);
  let age, ageCleanup;
  try {
    await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), f = window.planSecurityFixture, source = { state: 'on', last_updated: new Date().toISOString(),
        attributes: { friendly_name: 'Simulated plan contact', device_class: 'door' } };
      const original = c._syncMiniMap, trace = { observedAt: Date.parse(source.last_updated) };
      const sample = () => { const record = c._securityPlanData.records.find((record) => record.id === 'security_2'); return {
        status: record?.status, active: record?.active, color: record?.color, deadline: c._trackingDeadline, timer: !!c._trackingTimer,
        map: c._securityPlanData.miniMap.find((marker) => marker.id === 'security:security_2')?.status,
        sameEvidence: c._hass.states['binary_sensor.security_plan'] === source, elapsed: Date.now() - trace.observedAt }; };
      const observer = function (...args) { const value = original.apply(this, args); if (!trace.stale && sample().status === 'stale') trace.stale = sample(); return value; };
      f.ageObserver = { original, observer, trace }; c._syncMiniMap = observer;
      c.hass = { ...c._hass, states: { ...c._hass.states, 'binary_sensor.security_plan': source } };
      // Observe the actual synchronous source update before software-rendering
      // latency can consume its real two-second deadline. No application clock changes.
      trace.initial = sample();
    });
    await page.waitForFunction(() => !!window.planSecurityFixture.ageObserver.trace.stale, { timeout: 6500 });
    age = await page.evaluate(() => window.planSecurityFixture.ageObserver.trace);
  } finally {
    ageCleanup = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), f = window.planSecurityFixture, observation = f.ageObserver;
      if (!observation) return false; const attached = c._syncMiniMap === observation.observer;
      if (attached) c._syncMiniMap = observation.original; const restored = c._syncMiniMap === observation.original; delete f.ageObserver; return attached && restored; });
  }
  check('native plan reading-age settings use the existing exact absolute expiry timer', age.initial.status === 'open' && age.initial.active === true
    && age.initial.timer && age.initial.deadline === age.observedAt + 2000 && age.initial.sameEvidence, age.initial);
  check('without HA updates the actual plan contact and map turn neutral stale and release the shared timer', age.stale.status === 'stale' && age.stale.active === null
    && age.stale.color === '#8d9199' && age.stale.map === 'stale' && age.stale.sameEvidence && !age.stale.timer && age.stale.deadline === null && age.stale.elapsed >= 2000, age.stale);
  check('reading-age observer restores the exact original method', ageCleanup);
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="security"]');
  await click(page, '[data-act="sec-edit"][data-index="1"]'); await select(page, 'plan-source', 'anchor');
  await select(page, 'plan-anchor', 'entity:sensor.security_unrelated'); await select(page, 'freshness-mode', 'current'); await click(page, '[data-act="sec-save"]');
  check('native marker target keeps its exact chosen source anchor with no room fallback', (await snapshot(page)).bindings[1].target.position_key === 'entity:sensor.security_unrelated');
  await click(page, '[data-act="sec-edit"][data-index="0"]'); await type(page, 'label', 'Unsaved stale gesture');
  const saveHandle = await page.evaluateHandle(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-act="sec-save"]'));
  let saveCount;
  try {
    await saveHandle.asElement().focus(); await page.keyboard.down('Space'); saveCount = (await snapshot(page)).commits;
    await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._hass.connection.connected = false; c.hass = { ...c._hass };
      c._hass.connection.connected = true; c.hass = { ...c._hass }; });
    await page.keyboard.up('Space'); await settle(page);
  } finally { await saveHandle.dispose(); }
  const stale = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), editor = c._edit._securityEditor; return {
    stale: editor.stale, draft: editor.draft?.label, status: c.shadowRoot.querySelector('[data-security-preview]')?.textContent,
    field: c.shadowRoot.querySelector('[data-field="sec-label"]')?.value, count: window.planSecurityFixture.commits.length }; });
  check('held native Save remains cancelled after session recovery and preserves the stale draft for deliberate Cancel', stale.stale && stale.count === saveCount
    && stale.draft === 'Unsaved stale gesture' && stale.field === 'Unsaved stale gesture', stale);
  await click(page, '[data-act="sec-cancel"]'); await click(page, '[data-act="sec-edit"][data-index="0"]');
  await type(page, 'label', 'Simulated entrance lock'); await click(page, '[data-act="sec-cancel"]');

  await page.setViewport({ width: 320, height: 1000, deviceScaleFactor: 1 }); await settle(page); await click(page, '[data-act="sec-edit"][data-index="0"]');
  const narrow = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), form = c.shadowRoot.querySelector('[data-security-editor]');
    return { overflow: document.documentElement.scrollWidth > innerWidth, targets: [...form.querySelectorAll('button,input,select')]
      .filter((el) => el.getClientRects().length).every((el) => el.getBoundingClientRect().height >= 44),
    fields: ['kind', 'entity', 'target-type', 'plan-floor', 'plan-x', 'plan-y', 'plan-z'].every((field) => !!form.querySelector(`[data-field="sec-${field}"]`)),
    hinge: !!form.querySelector('[data-field="sec-motion"]') }; });
  check('320px lock/plan form retains all deliberate source controls and 44px targets with no hinge or horizontal overflow', narrow.targets && narrow.fields && !narrow.hinge && !narrow.overflow, narrow);
  for (const dark of [false, true]) {
    await page.evaluate((dark) => { const c = document.querySelector('taylors3d-card');
      for (const [key, value] of Object.entries(dark ? { '--card-background-color': '#1c1c1c', '--primary-text-color': '#e1e1e1', '--secondary-text-color': '#9b9b9b' }
        : { '--card-background-color': '#ffffff', '--primary-text-color': '#212121', '--secondary-text-color': '#727272' })) c.style.setProperty(key, value); }, dark);
    const contrast = await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), controls = [...c.shadowRoot.querySelector('[data-security-editor]').querySelectorAll('button,input,select')].filter((el) => el.getClientRects().length && !el.disabled);
      const rgb = (text) => text.match(/[\d.]+/g)?.slice(0, 3).map(Number), luminance = (value) => value.map((channel) => { channel /= 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
      const rows = controls.map((el) => { const css = getComputedStyle(el), fore = rgb(css.color), back = rgb(css.backgroundColor);
        if (!fore || !back) return { field: el.dataset.field, action: el.dataset.act, ratio: 0 };
        const a = luminance(fore), b = luminance(back); return { field: el.dataset.field, action: el.dataset.act, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }; });
      return { count: rows.length, bad: rows.filter((row) => row.ratio < 4.5) };
    });
    check(`${dark ? 'dark' : 'light'} theme actual plan controls retain readable AA text contrast`, contrast.count >= 12 && contrast.bad.length === 0, contrast);
  }
  await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="sec-plan-floor"]').scrollIntoView({ block: 'center' }));
  await screenshot(page, root, 'security-plan-editor-narrow', mode, true);
  await click(page, '[data-act="sec-cancel"]'); await click(page, 'button.edit'); await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 }); await ready(page);
  s = await snapshot(page);
  check('leaving edit restores saved split positions once and introduces no extra renderer, lights or services', s.presentation.valid && s.presentation.mode === 'horizontal'
    && s.canvas === 1 && s.rendererSame && s.helperLights === 0 && s.pool.length === 12 && s.castShadow === 4 && s.calls === 0, s.presentation);

  // Missing an explicitly saved room/floor/marker never changes to a nearby source.
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.planSecurityFixture.savedBindings = structuredClone(c._layout.security_bindings);
    c.commitFeatureLayout({ security_bindings: c._layout.security_bindings.map((binding, index) => index === 0
    ? { ...binding, target: { type: 'plan', position: { ...binding.target.position, floorId: 'missing-exact-floor' } } } : { ...binding, target: { type: 'plan', position_key: 'missing-exact-marker' } }) }); }); await ready(page); s = await snapshot(page);
  check('missing exact saved floor and marker produce unplaced diagnostics and zero substituted indicators', s.records.every((record) => record.source === null)
    && s.miniMap.length === 0 && s.diagnostics.some((issue) => issue.code === 'missing_floor') && s.diagnostics.some((issue) => issue.code === 'missing_anchor') && s.calls === 0, s.diagnostics);
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="security"]'); await click(page, '[data-act="sec-edit"][data-index="0"]');
  const missing = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), field = c.shadowRoot.querySelector('[data-field="sec-plan-floor"]');
    return { value: field.value, warning: field.selectedOptions[0]?.textContent, disabled: field.selectedOptions[0]?.disabled, raw: c._layout.security_bindings[0].target.position.floorId }; });
  check('missing saved source stays selected as a read-only warning instead of silently picking another floor', missing.value === 'missing-exact-floor'
    && missing.raw === missing.value && missing.disabled && missing.warning.includes('Missing'), missing);
  await click(page, '[data-act="sec-cancel"]'); await click(page, 'button.edit');

  // The same current plan bindings also work without a model. Use the real card
  // lifecycle; retain chosen source floors and the genuine drawn room outline.
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, model: undefined });
    c.commitFeatureLayout({ security_bindings: window.planSecurityFixture.savedBindings, floor_presentation: { mode: 'assembled' }, model: {} }); });
  await ready(page, { model: false });
  await page.evaluate(() => document.querySelector('taylors3d-card')._setFloor('upper')); await ready(page, { model: false });
  s = await snapshot(page);
  check('actual model removal retains the exact lock indicator on the drawn plan with the same single renderer', s.canvas === 1 && s.rendererSame && s.records[0].shown
    && s.records[0].status === 'unlocked' && near(s.records[0].world, [0, 4.2, -.9]) && s.modelParts === 0 && s.calls === 0, s.records[0]);
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="security"]'); await click(page, '[data-act="sec-add"]');
  await select(page, 'kind', 'lock'); await select(page, 'entity', otherId); await select(page, 'target-type', 'plan'); await select(page, 'plan-source', 'room');
  await select(page, 'plan-room', 'security-plan-room'); await click(page, '[data-act="sec-save"]');
  s = await snapshot(page);
  check('native visual setup can add a lock to an exact drawn room without any GLB or YAML', s.bindings.length === 3 && s.bindings[2].entity === otherId
    && s.bindings[2].target.roomId === 'security-plan-room' && s.records[2].status === 'locked' && s.records[2].source.floorId === 'upper' && s.calls === 0, s.bindings[2]);
  await click(page, 'button.edit'); await ready(page, { model: false });
  await screenshot(page, root, 'security-plan-no-model', mode);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.planSecurityFixture.detached = c; c.remove(); }); await settle(page);
  const detached = await page.evaluate(() => { const c = window.planSecurityFixture.detached; return { raf: !!c._view._raf, timer: !!c._trackingTimer,
    visible: c._planSecurityLayer.group.visible, enabledButtons: [...c._planSecurityLayer.parts.values()].filter((part) => !part.body.disabled).length }; });
  check('disconnect stops plan rendering/expiry work and disables all deliberate label buttons', !detached.raf && !detached.timer && !detached.visible && detached.enabledButtons === 0, detached);
  await page.evaluate(() => document.querySelector('section.theme').append(window.planSecurityFixture.detached)); await ready(page, { model: false });
  s = await snapshot(page);
  check('reconnect keeps one owned current plan set and still sends zero device commands', s.records.length === 3 && s.calls === 0 && s.canvas === 1 && s.helperLights === 0
    && await page.evaluate(() => document.querySelector('taylors3d-card')._planSecurityLayer.parts.size === 3), s.records.map((record) => record.status));
}
