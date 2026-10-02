// Headless check of the GLB underlay and the export snippet:
// - demo with ?model=1: model loads, level groups follow the floor chips, roof is cut away
// - a missing model shows a notice instead of breaking the card
// - tools/export-glb.js exports a named scene to a valid .glb without lights/helpers
import fs from 'node:fs';
import path from 'node:path';
import { openDemo, newPage, root } from './lib/demo-browser.mjs';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' – ' + detail : ''}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const card = 'document.querySelector("floorplan3d-card")';
let allErrors = [];

function rewriteGlbJson(buf, edit) {
  const jsonLen = buf.readUInt32LE(12);
  const json = edit(JSON.parse(buf.toString('utf8', 20, 20 + jsonLen)));
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const rest = buf.subarray(20 + jsonLen); // BIN chunk unchanged
  const head = Buffer.alloc(20);
  head.write('glTF', 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + j.length + rest.length, 8);
  head.writeUInt32LE(j.length, 12); head.write('JSON', 16, 'latin1');
  return Buffer.concat([head, j, rest]);
}

// 1. model in the demo
let s = await openDemo({ model: '1', view: '3d' }, { width: 1400, height: 560 });
try {
  const { page } = s;
  await page.waitForFunction(`!!${card}._view.model`, { timeout: 10000 });
  await sleep(300);
  const st = () => page.evaluate(`(() => { const v = ${card}._view; const vis = (id) => v.modelManifest().levels.find((l) => l.id === id)?.node.visible; return {
    level0: vis('level0'), level1: vis('level1'), exterior: vis('exterior'), roof: vis('roof'),
    cut: v.modelClip.constant, floors: v.modelManifest().levels.map((l) => l.id) }; })()`);
  const sh = (name) => page.screenshot({ path: path.join(root, 'screenshots', name) });
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
  let v = await st();
  check('model loaded with level groups', JSON.stringify(v.floors) === '["level0","level1","exterior","roof"]', JSON.stringify(v.floors));
  const chips = await page.evaluate(`[...${card}.shadowRoot.querySelectorAll('.chip')].map((b) => b.dataset.view + (b.classList.contains('on') ? '*' : ''))`);
  check('chips are the model\'s generated views', JSON.stringify(chips) === '["level0*","level1","all"]', JSON.stringify(chips));
  check('ground: level0 + exterior shown, level1 + roof hidden, tagged model not cut',
    v.level0 === true && v.level1 === false && v.exterior === true && v.roof === false && v.cut > 1000, JSON.stringify(v));
  await sleep(500);
  await sh('look-day.png');
  await sh('model-ground.png');
  await page.evaluate(`${card}._setFloor('first')`);
  await sleep(300);
  v = await st();
  check('first: both storeys stack, exterior shown, roof hidden', v.level0 && v.level1 && v.exterior && !v.roof, JSON.stringify(v));
  const shownMarkers = () => page.evaluate(`[...${card}._view.markerObjects.values()].filter((m) => m.obj.visible).length`);
  const allMarkers = await page.evaluate(`${card}._view.markerObjects.size`);
  const firstShown = await shownMarkers();
  check('first: devices of the storey below are hidden, not faded', firstShown > 0 && firstShown < allMarkers
    && (await page.evaluate(`${card}.shadowRoot.querySelectorAll('.fp-marker.fp-faded').length`)) === 0, `${firstShown}/${allMarkers}`);
  await sh('model-first.png');
  await page.evaluate(`${card}._setFloor('all')`);
  await sleep(300);
  v = await st();
  check('"All" shows everything uncut', v.level0 && v.level1 && v.exterior && v.roof && v.cut > 1000, JSON.stringify(v));
  const faded = () => page.evaluate(`${card}.shadowRoot.querySelectorAll('.fp-marker.fp-faded').length`);
  check('"All" (overview): every device shown, none faded', (await faded()) === 0 && (await shownMarkers()) === allMarkers);
  check('"All" (overview): no room labels', (await page.evaluate(`${card}.shadowRoot.querySelectorAll('.fp-room-label').length`)) === 0);
  await page.evaluate(`${card}._setFloor('ground')`);
  await sleep(300);
  check('single floor: no faded markers', (await faded()) === 0);
  check('no notice', await page.evaluate(`${card}.shadowRoot.querySelector('.notice').hidden`));

  const look = await page.evaluate(`(() => { const v = ${card}._view; return { tm: v.renderer.toneMapping, sm: v.renderer.shadowMap.enabled,
    sr: v.sun.shadow.camera.right, pr: v.renderer.getPixelRatio(),
    fills: (() => { let n = 0; v.staticGroup.traverse((o) => { if (o.isMesh && o.userData.roomId) n++; }); return n; })(),
    labels: ${card}.shadowRoot.querySelectorAll('.fp-room-label').length, tagged: v.isTagged(),
    hasModel: ${card}._stage.classList.contains('has-model'), dayHidden: ${card}.shadowRoot.querySelector('button.daynight').hidden }; })()`);
  check('ACES tone mapping with a model', look.tm === 4, String(look.tm));
  check('shadows on, shadow camera fitted to the model', look.sm === true && look.sr < 200 && look.sr < 40, `${look.sm} ${look.sr}`);
  check('pixel ratio capped', look.pr <= 1.5, String(look.pr));
  check('no room fills; ground view labels its own rooms with sizes', look.fills === 0 && look.labels > 0
    && (await page.evaluate(`${card}.shadowRoot.querySelector('.fp-room-label').textContent`)).includes(' m'), JSON.stringify(look));
  check('stage has has-model, day/night button shown', look.hasModel && !look.dayHidden);
  await page.evaluate(`${card}.shadowRoot.querySelector('button.edit').click()`);
  await sleep(400);
  check('edit mode shows room labels', (await page.evaluate(`${card}.shadowRoot.querySelectorAll('.fp-room-label').length`)) > 0);
  await page.evaluate(`${card}.shadowRoot.querySelector('button.edit').click()`);
  await sleep(400);
  check('leaving edit mode restores the view\'s labels', (await page.evaluate(`${card}.shadowRoot.querySelectorAll('.fp-room-label').length`)) === look.labels);
  // framing uses the room polygons even though no fills/outlines/walls are rendered with a model
  await page.evaluate(`${card}._setFloor('ground'); ${card}._view.setMode('3d'); ${card}._view.fit({ instant: true })`);
  await sleep(200);
  const dist = () => page.evaluate(`(() => { const v = ${card}._view; return v.persp.position.distanceTo(v.controls.target); })()`);
  const ext = await page.evaluate(`(() => { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (const { room } of ${card}._view._rooms) for (const [x, y] of room.polygon) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); } return Math.max(b - a, d - c); })()`);
  const d0 = await dist();
  check('model + rooms: camera frames the rooms', ext > 0 && d0 < 2.5 * ext, `dist ${d0.toFixed(1)} ext ${ext.toFixed(1)}`);
  await page.evaluate(`${card}.shadowRoot.querySelector('button.edit').click()`);
  await sleep(600);
  await page.evaluate(`${card}.shadowRoot.querySelector('button.edit').click()`);
  await sleep(900);
  const d1 = await dist();
  check('edit mode on/off keeps the camera distance within 5 %', Math.abs(d1 - d0) / d0 < 0.05, `${d0.toFixed(2)} -> ${d1.toFixed(2)}`);
  // chip switch keeps the camera; Reset view frames again
  const camAt = () => page.evaluate(`${card}._view.persp.position.toArray().map((x) => x.toFixed(2)).join()`);
  await page.evaluate(`${card}._view.setCamera({ position: [30, 30, 30], target: [0, 0, 0] }, { instant: true })`);
  const c0 = await camAt();
  await page.evaluate(`${card}.shadowRoot.querySelector('.chip[data-view=level1]').click()`);
  await sleep(600);
  check('chip switch keeps the camera', (await camAt()) === c0, `${c0} -> ${await camAt()}`);
  await page.evaluate(`${card}.shadowRoot.querySelector('button.reset').click()`);
  await sleep(700);
  check('Reset view moves the camera', (await camAt()) !== c0);
  await page.evaluate(`${card}.saveViewPatch('level1', { camera: { position: [20, 25, 20], target: [5, 0, -4] } })`);
  await sleep(200);
  await page.evaluate(`${card}.shadowRoot.querySelector('.chip[data-view=level0]').click()`);
  await page.evaluate(`${card}.shadowRoot.querySelector('.chip[data-view=level1]').click()`);
  await sleep(700);
  check('saved view camera restored on chip switch', (await camAt()) === '20.00,25.00,20.00', await camAt());
  await page.evaluate(`${card}.saveViewPatch('level1', { camera: null })`);
  await sleep(200);
  await page.evaluate(`${card}._setFloor('ground')`);
  await sleep(600);

  const lights = () => page.evaluate(`({ sun: ${card}._view.sun.intensity, hemi: ${card}._view.hemi.intensity, cast: ${card}._view.sun.castShadow })`);
  const day = await lights();
  await page.evaluate(`${card}.shadowRoot.querySelector('button.daynight').click()`);
  await sleep(300);
  const night = await lights();
  check('night: moonlight only, no shadows, hemisphere <= 1.4', night.sun < 1 && night.cast === false && night.hemi <= 1.4, JSON.stringify(night));
  check('button shows the moon at night', (await page.evaluate(`${card}.shadowRoot.querySelector('button.daynight').textContent`)) === '☾');
  await sh('look-night.png');
  await page.evaluate(`${card}.shadowRoot.querySelector('button.daynight').click()`);
  await sleep(300);
  check('day again restores the light', JSON.stringify(await lights()) === JSON.stringify(day) && day.sun > 0, JSON.stringify(day));
  allErrors.push(...s.errors);
} finally {
  await s.close();
}

// 2. missing model
s = await openDemo({ model: '/demo/missing.glb' });
try {
  await s.page.waitForFunction(`!${card}.shadowRoot.querySelector('.notice').hidden`, { timeout: 10000 });
  const text = await s.page.evaluate(`${card}.shadowRoot.querySelector('.notice').textContent`);
  check('missing model shows a notice', text.includes('missing.glb'), text);
  check('card still renders markers', (await s.page.evaluate(`${card}.shadowRoot.querySelectorAll('.fp-marker').length`)) > 0);
  allErrors.push(...s.errors.filter((e) => !e.includes('missing.glb') && !e.includes('404')));
} finally {
  await s.close();
}

// 2b. upload a model in edit mode (Model tab), align it, remove it
s = await openDemo({ view: '3d', height: '560px' }, { width: 1500, height: 680 });
try {
  const { page } = s;
  const panel = (sel) => `${card}.shadowRoot.querySelector(".panel ${sel}")`;
  const clickText = (t) => page.evaluate((t) => {
    const b = [...document.querySelector('floorplan3d-card').shadowRoot.querySelectorAll('.panel button')].find((x) => x.textContent.trim() === t);
    if (b) b.click();
    return !!b;
  }, t);
  await page.evaluate(`${card}.shadowRoot.querySelector("button.edit").click()`);
  await sleep(200);
  await clickText('Model');
  await sleep(150);
  check('model tab offers upload', (await page.evaluate(`${panel('label.button')}?.textContent || ''`)).includes('Upload .glb'));
  const upload = async (file) => {
    const input = await page.evaluateHandle(panel('[data-field=model-file]'));
    await input.uploadFile(file);
  };
  const bad = path.join(root, 'screenshots', 'not-a-model.glb');
  fs.writeFileSync(bad, 'hello');
  await upload(bad);
  await page.waitForFunction(`!!${panel('.msg.error')}`, { timeout: 5000 });
  check('non-glb rejected with message', (await page.evaluate(`${panel('.msg.error')}.textContent`)).includes('glTF'));
  fs.unlinkSync(bad);

  await upload(path.join(root, 'demo', 'house.glb'));
  await page.waitForFunction(`!!${card}._view.model`, { timeout: 10000 });
  await sleep(300);
  const lm = await page.evaluate(`${card}._layout.model`);
  check('upload stored in layout', lm && lm.name === 'house.glb' && lm.version && lm.size > 1000, JSON.stringify(lm));
  check('model loaded with level groups', JSON.stringify(await page.evaluate(`${card}._view.modelManifest().levels.map((l) => l.id)`)) === '["level0","level1","exterior","roof"]');
  const lv = () => page.evaluate(`JSON.stringify(Object.fromEntries(Object.entries(${card}.modelBindings().levels).map(([k, v]) => [k, v.show + ':' + v.floor])))`);
  check('levels map by order, exterior with ground, roof all-only',
    (await lv()) === JSON.stringify({ level0: 'with:ground', level1: 'with:first', exterior: 'always:ground', roof: 'all-only:null' }), await lv());
  check('rooms come from the model', await page.evaluate(`${card}._modelRooms.some((r) => r.id === 'm:kitchen' && r.floor_id === 'ground')`));
  check('model room replaces the drawn kitchen', await page.evaluate(`${card}._allRooms().filter((r) => r.area_id === 'kitchen').length === 1`));
  await page.evaluate(`(() => { const s = ${panel('[data-field=md-rotation]')}; s.value = "90"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page.evaluate(`(() => { const s = ${panel('[data-field=md-opacity]')}; s.value = "0.5"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(150);
  check('rotation slider turns the model', Math.round(await page.evaluate(`${card}._view.modelGroup.rotation.y * 180 / Math.PI`)) === 90);
  check('opacity applied', await page.evaluate(`(() => { let o; ${card}._view.model.root.traverse((m) => { if (m.isMesh && o === undefined) o = m.material.opacity; }); return o === 0.5; })()`));
  check('slider kept (no re-render)', await page.evaluate(`${panel('[data-field=md-rotation]')}.value === "90"`));
  await page.evaluate(`(() => { const s = ${panel('[data-field=md-rotation]')}; s.value = "0"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(200);
  await page.screenshot({ path: path.join(root, 'screenshots/model-upload.png') });
  // rotation moves the rooms with the model
  const k0 = await page.evaluate(`JSON.stringify(${card}._modelRooms.find((r) => r.id === 'm:kitchen').polygon[1])`);
  await page.evaluate(`(() => { const s = ${panel('[data-field=md-rotation]')}; s.value = '90'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  check('rotation moves rooms', (await page.evaluate(`JSON.stringify(${card}._modelRooms.find((r) => r.id === 'm:kitchen').polygon[1])`)) !== k0);
  await page.evaluate(`(() => { const s = ${panel('[data-field=md-rotation]')}; s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  // assign a room to no area
  await page.evaluate(`(() => { const s = ${card}.shadowRoot.querySelector('[data-field=md-room][data-id=kitchen]'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(200);
  check('room binding saved', JSON.stringify(await page.evaluate(`${card}._layout.model.rooms`)) === '{"kitchen":{"area":null}}', JSON.stringify(await page.evaluate(`${card}._layout.model.rooms`)));
  // click to pick: the kitchen floor in top view
  await page.evaluate(`${card}._setMode('top')`);
  await page.evaluate(`${card}._view.fit({ model: true })`);
  await sleep(300);
  const pt = await page.evaluate(`${card}._view.screenPoint(9.5, 2, 0, 'ground')`);
  await page.mouse.click(pt[0], pt[1]);
  await sleep(200);
  check('click picks the room', JSON.stringify(await page.evaluate(`${card}._edit.modelPick`)) === '{"kind":"room","id":"kitchen"}'
    && await page.evaluate(`!!${card}.shadowRoot.querySelector('tr.sel[data-pick="room:kitchen"]')`), JSON.stringify(await page.evaluate(`${card}._edit.modelPick`)));
  await page.evaluate(`${card}._setMode('3d')`);
  await sleep(200);
  // a model whose level ids differ again: the ids keep their order mapping
  const renamed = path.join(root, 'screenshots', 'renamed.glb');
  const buf = fs.readFileSync(path.join(root, 'demo', 'house.glb'));
  fs.writeFileSync(renamed, Buffer.from(buf.toString('latin1').replace('"id":"level0"', '"id":"lvl_a0"').replace('"id":"level1"', '"id":"lvl_a1"'), 'latin1'));
  await upload(renamed);
  await page.waitForFunction(`${card}._view.modelManifest()?.levels.some((l) => l.id === 'lvl_a0')`, { timeout: 10000 });
  await sleep(300);
  fs.unlinkSync(renamed);
  check('renamed levels still map by order', (await lv()) === JSON.stringify({ lvl_a0: 'with:ground', lvl_a1: 'with:first', exterior: 'always:ground', roof: 'all-only:null' }), await lv());
  const vis = () => page.evaluate(`(() => { const l = ${card}._view.modelManifest().levels; return [l[0].node.visible, l[1].node.visible]; })()`);
  check('ground shows its own storey only', JSON.stringify(await vis()) === '[true,false]');
  // legacy show modes (written before levels became "belongs to HA floor") stay readable
  const setLevel = (id, b) => page.evaluate(`${card}._edit.setModelProps({ levels: { ...(${card}._layout.model.levels || {}), ${JSON.stringify(id)}: ${JSON.stringify(b)} } })`);
  const selectLevel = (id, value) => page.evaluate(`(() => { const s = ${card}.shadowRoot.querySelector('[data-field=md-level][data-id=${id}]'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await setLevel('exterior', { show: 'always', floor: 'ground' });
  await sleep(300);
  check('exterior "always" keeps its zones', await page.evaluate(`${card}._modelRooms.some((r) => r.id === 'm:garden')`)
    && JSON.stringify(await page.evaluate(`${card}._layout.model.levels.exterior`)) === '{"show":"always","floor":"ground"}', JSON.stringify(await page.evaluate(`${card}._layout.model.levels.exterior`)));
  check('exterior "always" does not remap storeys', (await lv()) === JSON.stringify({ exterior: 'always:ground', lvl_a0: 'with:ground', lvl_a1: 'with:first', roof: 'all-only:null' }), await lv());
  check('legacy show mode reads as its floor in the dropdown', await page.evaluate(`${card}.shadowRoot.querySelector('[data-field=md-level][data-id=exterior]').value === 'floor:ground'`));
  await setLevel('exterior', { show: 'hidden', floor: 'ground' });
  await sleep(300);
  check('exterior "hidden" does not remap storeys', (await lv()) === JSON.stringify({ exterior: 'hidden:ground', lvl_a0: 'with:ground', lvl_a1: 'with:first', roof: 'all-only:null' }), await lv());
  await selectLevel('exterior', 'auto');
  await sleep(200);
  check('mapped level visible on its floor', JSON.stringify(await vis()) === '[true,false]');
  check('level rows marked auto', (await page.evaluate(`${panel('table.floors')}.textContent`)).includes('auto'));
  check('level dropdown: auto, HA floors, no floor', (await page.evaluate(`[...${card}.shadowRoot.querySelectorAll('[data-field=md-level][data-id=exterior] option')].map((o) => o.value).join()`)) === 'auto,floor:ground,floor:first,none',
    await page.evaluate(`[...${card}.shadowRoot.querySelectorAll('[data-field=md-level][data-id=exterior] option')].map((o) => o.value).join()`));
  await selectLevel('exterior', 'none');
  await sleep(200);
  check('"no floor" writes { floor: null }', JSON.stringify(await page.evaluate(`${card}._layout.model.levels.exterior`)) === '{"floor":null}'
    && JSON.parse(await lv()).exterior === 'always:null' && await page.evaluate(`${card}.shadowRoot.querySelector('[data-field=md-level][data-id=exterior]').value === 'none'`), await lv());
  await selectLevel('exterior', 'floor:first');
  await sleep(200);
  check('choosing a floor writes { floor }', JSON.stringify(await page.evaluate(`${card}._layout.model.levels.exterior`)) === '{"floor":"first"}');
  await selectLevel('exterior', 'auto');
  await setLevel('lvl_a1', { show: 'always', floor: 'first' });
  await sleep(200);
  check('legacy "always shown"', JSON.stringify(await page.evaluate(`${card}._layout.model.levels.lvl_a1`)).includes('"always"') && JSON.stringify(await vis()) === '[true,true]', JSON.stringify(await page.evaluate(`${card}._layout.model.levels`)));
  await setLevel('lvl_a0', { show: 'hidden', floor: 'ground' });
  await sleep(200);
  check('legacy "hidden"', JSON.stringify(await vis()) === '[false,true]');
  await selectLevel('lvl_a0', 'auto');
  await sleep(200);
  check('choose "auto" removes the saved binding', !('lvl_a0' in (await page.evaluate(`${card}._layout.model.levels`))) && JSON.stringify(await vis()) === '[true,true]'
    && await page.evaluate(`${card}.shadowRoot.querySelector('[data-field=md-level][data-id=lvl_a0]').value === 'auto'`));

  // untagged model: loads whole, no rooms
  const untagged = path.join(root, 'screenshots', 'untagged.glb');
  fs.writeFileSync(untagged, rewriteGlbJson(fs.readFileSync(path.join(root, 'demo', 'house.glb')), (json) => {
    for (const n of json.nodes || []) { delete n.extras; if (n.name === 'roof') n.name = 'top'; } // legacy name "roof" would still tag a level
    return json;
  }));
  await upload(untagged);
  await page.waitForFunction(`${card}._view.model && ${card}._view.modelManifest().levels.length === 0`, { timeout: 10000 });
  fs.unlinkSync(untagged);
  check('untagged model loads whole', await page.evaluate(`${card}._view.model.root.visible && ${card}._modelRooms.length === 0`));
  await sleep(200);
  check('stale bindings offered for forgetting', await page.evaluate(`!!${card}.shadowRoot.querySelector('[data-act=md-forget]')`));
  await page.evaluate(`${card}.shadowRoot.querySelector('[data-act=md-forget]').click()`);
  await sleep(200);
  await upload(path.join(root, 'demo', 'house.glb'));
  await page.waitForFunction(`${card}._view.modelManifest()?.levels.length === 4`, { timeout: 10000 });
  await sleep(300);
  const cam0 = await page.evaluate(`${card}._view.camera.position.toArray().join()`);
  await clickText('Frame model');
  await sleep(200);
  check('frame model moves the camera', (await page.evaluate(`${card}._view.camera.position.toArray().join()`)) !== cam0);
  // day/night survives a model reload
  const dn = `${card}.shadowRoot.querySelector('button.daynight')`;
  await page.evaluate(`${dn}.click()`);
  await upload(path.join(root, 'demo', 'house.glb'));
  await sleep(1500);
  check('night kept after re-upload', (await page.evaluate(`${dn}.textContent`)) === '\u263e' && (await page.evaluate(`${card}._view.sun.intensity`)) < 1 && (await page.evaluate(`${card}._view.sun.castShadow`)) === false);
  await page.evaluate(`${dn}.click()`);
  await sleep(200);
  check('back to day', (await page.evaluate(`${dn}.textContent`)) === '\u2600' && (await page.evaluate(`${card}._view.sun.intensity`)) > 1 && (await page.evaluate(`${card}._view.sun.castShadow`)) === true);

  // legacy model (no fp tags, floor:<id> / site / roof names): auto mapping, per-chip visibility, no regeneration notice
  const legacy = path.join(root, 'screenshots', 'legacy.glb');
  const legacyNames = { level0: 'floor:ground', level1: 'floor:first', exterior: 'site' };
  fs.writeFileSync(legacy, rewriteGlbJson(fs.readFileSync(path.join(root, 'demo', 'house.glb')), (json) => {
    for (const n of json.nodes || []) { delete n.extras; if (legacyNames[n.name]) n.name = legacyNames[n.name]; }
    return json;
  }));
  await upload(legacy);
  await page.waitForFunction(`${card}._view.modelManifest()?.levels.some((l) => l.id === 'site')`, { timeout: 10000 });
  await sleep(400);
  fs.unlinkSync(legacy);
  check('legacy names read as levels', (await page.evaluate(`${card}._view.modelManifest().levels.map((l) => l.id).join()`)) === 'ground,first,site,roof',
    await page.evaluate(`${card}._view.modelManifest().levels.map((l) => l.id).join()`));
  check('legacy levels map automatically', (await lv()) === JSON.stringify({ ground: 'with:ground', first: 'with:first', site: 'always:ground', roof: 'all-only:null' }), await lv());
  const legacyVis = () => page.evaluate(`(() => { const l = ${card}._view.modelManifest().levels; return [l[0].node.visible, l[1].node.visible]; })()`);
  await page.evaluate(`${card}._setFloor('ground')`);
  await sleep(300);
  check('legacy: ground chip shows ground only', JSON.stringify(await legacyVis()) === '[true,false]');
  check('legacy: cut at ground elevation + wall height', Math.abs((await page.evaluate(`${card}._view.modelClip.constant`)) - 1) < 1e-6, String(await page.evaluate(`${card}._view.modelClip.constant`)));
  await page.evaluate(`${card}._setFloor('first')`);
  await sleep(300);
  check('legacy: first chip stacks the storeys', JSON.stringify(await legacyVis()) === '[true,true]');
  await clickText('Data');
  await clickText('Model');
  await sleep(200);
  check('no "Since the last setup" notice after upload', !(await page.evaluate(`${panel('')}.textContent`)).includes('Since the last setup'));

  // importing a plan export keeps the uploaded model and maps foreign floor ids onto HA floors
  await clickText('Data');
  const plan = path.join(root, 'screenshots', 'plan-export.json');
  fs.writeFileSync(plan, JSON.stringify({ version: 1, floors: [{ id: 'level0', elevation: 0, height: 2.8 }],
    rooms: [{ id: 'x', area_id: 'kitchen', floor_id: 'level0', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }] }));
  const imp = await page.evaluateHandle(panel('[data-field=import]'));
  await imp.uploadFile(plan);
  await sleep(600);
  fs.unlinkSync(plan);
  check('import keeps the uploaded model', await page.evaluate(`!!(${card}._layout.model && ${card}._view.model)`));
  check('import maps floor ids onto HA floors', (await page.evaluate(`${card}._layout.rooms[0].floor_id`)) === 'ground'
    && (await page.evaluate(`${panel('.msg')}.textContent`)).includes('level0 → Ground floor'));
  await page.evaluate(`${card}.shadowRoot.querySelector('button.daynight').click()`); // night, then remove the model
  await sleep(150);
  await clickText('Model');
  await sleep(150);
  await clickText('Remove model');
  await clickText('Really remove?');
  await sleep(300);
  check('remove clears model', (await page.evaluate(`${card}._layout.model`)) === null && !(await page.evaluate(`${card}._view.model`)));
  check('removal resets the look', await page.evaluate(`(() => { const c = ${card}; return !c._stage.classList.contains('has-model')
    && c.shadowRoot.querySelector('button.daynight').hidden && c._view.renderer.toneMapping === 0 && c._view.renderer.shadowMap.enabled === false; })()`));
  const dayLook = await page.evaluate(`(() => { const v = ${card}._view; return { hemi: v.hemi.intensity, sun: v.sun.intensity, tm: v.renderer.toneMapping, glyph: ${card}.shadowRoot.querySelector('button.daynight').textContent }; })()`);
  check('removing the model at night restores the day look', dayLook.hemi === 2.2 && dayLook.sun === 1.4 && dayLook.tm === 0 && dayLook.glyph === '\u2600', JSON.stringify(dayLook));
  allErrors.push(...s.errors);
} finally {
  await s.close();
}

// 2c. no model: today's look
s = await openDemo({ view: '3d' });
try {
  const { page } = s;
  const r = await page.evaluate(`(() => { const v = ${card}._view; return { tm: v.renderer.toneMapping, sm: v.renderer.shadowMap.enabled, pr: v.renderer.getPixelRatio(),
    labels: ${card}.shadowRoot.querySelectorAll('.fp-room-label').length, dayHidden: ${card}.shadowRoot.querySelector('button.daynight').hidden }; })()`);
  check('no model: NoToneMapping, no shadows', r.tm === 0 && r.sm === false, JSON.stringify(r));
  check('no model: room labels present, day/night hidden, pixel ratio capped', r.labels > 0 && r.dayHidden && r.pr <= 1.5, JSON.stringify(r));
  await page.evaluate(`${card}._setFloor('all')`);
  await sleep(300);
  check('no model: "All" does not fade markers', (await page.evaluate(`${card}.shadowRoot.querySelectorAll('.fp-marker.fp-faded').length`)) === 0);
  allErrors.push(...s.errors);
} finally {
  await s.close();
}

// 2e. edit panel keeps its scroll position and the slider being dragged
s = await openDemo({ view: '3d', height: '560px' }, { width: 1500, height: 680 });
try {
  const { page } = s;
  await page.evaluate(`${card}.shadowRoot.querySelector("button.edit").click()`);
  await sleep(300);
  await page.evaluate(`[...${card}.shadowRoot.querySelectorAll(".panel button")].find((b) => b.textContent.trim() === "Model").click()`);
  const inp = await page.evaluateHandle(`${card}.shadowRoot.querySelector("[data-field=model-file]")`);
  await inp.uploadFile(path.join(root, 'demo/house.glb'));
  await page.waitForFunction(`!!${card}._view.model`, { timeout: 20000 });
  await sleep(800);
  const body = `${card}.shadowRoot.querySelector(".panel .tab-body")`;
  const keeps = async (label, act) => {
    await page.evaluate(`(() => { const b = ${body}; b.scrollTop = b.scrollHeight; })()`);
    const before = await page.evaluate(`${body}.scrollTop`);
    await page.evaluate(act);
    await sleep(500);
    const after = await page.evaluate(`${body}.scrollTop`);
    check(`panel scroll kept after ${label}`, before > 100 && Math.abs(after - before) < 2, `${before} -> ${after}`);
  };
  await keeps('rotation slider', `(() => { const s = ${card}.shadowRoot.querySelector('[data-field=md-rotation]'); s.value = '10'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await keeps('opacity slider', `(() => { const s = ${card}.shadowRoot.querySelector('[data-field=md-opacity]'); s.value = '0.8'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await keeps('room select', `(() => { const s = ${card}.shadowRoot.querySelector('[data-field=md-room]'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  // a slider being dragged must stay the same element (pointer down, several input ticks)
  const same = await page.evaluate(`(async () => {
    const root = ${card}.shadowRoot; const s = root.querySelector('[data-field=md-rotation]');
    s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    for (const v of ['20', '30', '40']) { s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 150)); }
    const stillThere = root.querySelector('[data-field=md-rotation]') === s;
    s.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return stillThere;
  })()`);
  check('dragged slider is not replaced while dragging', same);
  allErrors.push(...s.errors);
} finally {
  await s.close();
}

// 3. export snippet round trip
s = await openDemo({});
try {
  const { page, errors } = await newPage(s.browser);
  await page.goto(`${s.base}/scripts/fixtures/export-test.html`);
  await page.waitForFunction('window.ready === true');
  // a real download would leave headless Chrome hanging on close
  await page.evaluate('HTMLAnchorElement.prototype.click = function () { window.__downloaded = this.download; }');
  await page.evaluate(fs.readFileSync(path.join(root, 'tools/export-glb.js'), 'utf8'));
  await page.waitForFunction('!!window.__floorplan3dGlb', { timeout: 10000 });
  const glb = Buffer.from(await page.evaluate('Array.from(new Uint8Array(window.__floorplan3dGlb))'));
  check('export is a binary glTF', glb.toString('ascii', 0, 4) === 'glTF');
  check('download offered as house.glb', (await page.evaluate('window.__downloaded')) === 'house.glb');
  const jsonLen = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.toString('utf8', 20, 20 + jsonLen));
  const names = gltf.nodes.map((n) => n.name);
  check('floor groups exported', names.includes('floor:ground') && names.includes('floor:first'), names.join(', '));
  check('lights, cameras and helpers dropped', !gltf.extensions?.KHR_lights_punctual && !gltf.cameras && gltf.nodes.length === 4, `${gltf.nodes.length} nodes`);
  allErrors.push(...errors.filter((e) => !e.includes('GPU stall')));
} finally {
  await s.close();
}

// 4. optional: a real model, screenshots only (REAL_MODEL=/path/to/house.glb)
if (process.env.REAL_MODEL) {
  s = await openDemo({ view: '3d', height: '700px' }, { width: 1500, height: 820 });
  try {
    const { page } = s;
    await page.evaluate(`${card}.shadowRoot.querySelector('button.edit').click()`);
    await sleep(200);
    await page.evaluate(() => {
      const b = [...document.querySelector('floorplan3d-card').shadowRoot.querySelectorAll('.panel button')].find((x) => x.textContent.trim() === 'Model');
      if (b) b.click();
    });
    await sleep(150);
    const input = await page.evaluateHandle(`${card}.shadowRoot.querySelector('.panel [data-field=model-file]')`);
    await input.uploadFile(process.env.REAL_MODEL);
    await page.waitForFunction(`!!${card}._view.model`, { timeout: 60000 });
    await sleep(500);
    await page.evaluate(`${card}.shadowRoot.querySelector('button.edit').click()`); // leave edit mode
    await sleep(800);
    const ids = await page.evaluate(`${card}._floors.map((f) => f.id).concat('all')`);
    for (const id of ids) {
      await page.evaluate(`${card}._setFloor(${JSON.stringify(id)})`);
      await sleep(1200);
      await page.screenshot({ path: path.join(root, 'screenshots', `real-${id}-day.png`) });
      console.log('screenshot', `screenshots/real-${id}-day.png`);
    }
    await page.evaluate(`${card}.shadowRoot.querySelector('button.daynight').click()`);
    await sleep(800);
    await page.screenshot({ path: path.join(root, 'screenshots', `real-${ids[ids.length - 1]}-night.png`) });
    console.log('screenshot', `screenshots/real-${ids[ids.length - 1]}-night.png`);
    allErrors.push(...s.errors);
  } finally {
    await s.close();
  }
}

if (allErrors.length) console.error('page errors:\n' + allErrors.join('\n'));
if (failures.length || allErrors.length) process.exit(1);
console.log('all model checks passed');
