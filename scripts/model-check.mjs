// Headless check of the GLB underlay and the export snippet:
// - demo with ?model=1: model loads, floor:<id> groups follow the floor chips, roof is cut away
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

// 1. model in the demo
let s = await openDemo({ model: '1', view: '3d' }, { width: 1400, height: 560 });
try {
  const { page } = s;
  await page.waitForFunction(`!!${card}._view.model`, { timeout: 10000 });
  await sleep(300);
  const st = () => page.evaluate(`(() => { const v = ${card}._view; return {
    ground: v.model.floorNodes.get('ground')?.visible, first: v.model.floorNodes.get('first')?.visible,
    cut: v.modelClip.constant, floors: [...v.model.floorNodes.keys()] }; })()`);
  let v = await st();
  check('model loaded with floor groups', JSON.stringify(v.floors) === '["ground","first"]', JSON.stringify(v.floors));
  check('ground floor shown, first hidden, cut at wall height', v.ground === true && v.first === false && Math.abs(v.cut - 1) < 1e-6, JSON.stringify(v));
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'screenshots/model-ground.png') });
  await page.evaluate(`${card}._setFloor('first')`);
  await sleep(300);
  v = await st();
  check('first floor chip shows first floor group, cut above it', v.first === true && v.ground === false && Math.abs(v.cut - 4) < 1e-6, JSON.stringify(v));
  await page.screenshot({ path: path.join(root, 'screenshots/model-first.png') });
  await page.evaluate(`${card}._setFloor('all')`);
  await sleep(300);
  v = await st();
  check('"All" shows everything uncut', v.first && v.ground && v.cut > 1000);
  check('no notice', await page.evaluate(`${card}.shadowRoot.querySelector('.notice').hidden`));
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
  check('model loaded with floor groups', JSON.stringify(await page.evaluate(`${card}._view.modelFloors()`)) === '["ground","first"]');
  check('matching groups map to their floors', JSON.stringify(await page.evaluate(`${card}.modelFloorAssignment()`)) === '{"ground":"ground","first":"first"}');
  await page.evaluate(`(() => { const s = ${panel('[data-field=md-rotation]')}; s.value = "90"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page.evaluate(`(() => { const s = ${panel('[data-field=md-opacity]')}; s.value = "0.5"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(150);
  check('rotation slider turns the model', Math.round(await page.evaluate(`${card}._view.modelGroup.rotation.y * 180 / Math.PI`)) === 90);
  check('opacity applied', await page.evaluate(`(() => { let o; ${card}._view.model.root.traverse((m) => { if (m.isMesh && o === undefined) o = m.material.opacity; }); return o === 0.5; })()`));
  check('slider kept (no re-render)', await page.evaluate(`${panel('[data-field=md-rotation]')}.value === "90"`));
  await page.evaluate(`(() => { const s = ${panel('[data-field=md-rotation]')}; s.value = "0"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(200);
  await page.screenshot({ path: path.join(root, 'screenshots/model-upload.png') });
  // a model whose storey names don't match HA floors (like "ground" / "attic" vs "floor1")
  const renamed = path.join(root, 'screenshots', 'renamed.glb');
  const buf = fs.readFileSync(path.join(root, 'demo', 'house.glb'));
  fs.writeFileSync(renamed, Buffer.from(buf.toString('latin1').replace('floor:ground', 'floor:level0').replace('floor:first', 'floor:attic'), 'latin1'));
  await upload(renamed);
  await page.waitForFunction(`JSON.stringify(${card}._view.modelFloors()) === '["level0","attic"]'`, { timeout: 10000 });
  await sleep(300);
  fs.unlinkSync(renamed);
  check('unmatched groups map bottom-up', JSON.stringify(await page.evaluate(`${card}.modelFloorAssignment()`)) === '{"level0":"ground","attic":"first"}');
  const vis = () => page.evaluate(`(() => { const n = ${card}._view.model.floorNodes; return [n.get('level0').visible, n.get('attic').visible]; })()`);
  check('mapped group visible on its floor', JSON.stringify(await vis()) === '[true,false]');
  check('mapping rows marked auto', (await page.evaluate(`${panel('table.floors')}.textContent`)).includes('auto'));
  check('HA floor ids listed for the design', (await page.evaluate(`${card}.shadowRoot.querySelector('.panel .tab-body').textContent`)).includes('Your floor ids: ground'));
  await page.evaluate(`(() => { const s = ${card}.shadowRoot.querySelector('[data-field=md-floor][data-id=attic]'); s.value = 'always'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(200);
  check('choose "always shown"', JSON.stringify(await page.evaluate(`${card}._layout.model.floor_map`)) === '{"attic":"always"}' && JSON.stringify(await vis()) === '[true,true]');
  await page.evaluate(`(() => { const s = ${card}.shadowRoot.querySelector('[data-field=md-floor][data-id=level0]'); s.value = 'hidden'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(200);
  check('choose "hidden"', JSON.stringify(await vis()) === '[false,true]');
  const cam0 = await page.evaluate(`${card}._view.camera.position.toArray().join()`);
  await clickText('Frame model');
  await sleep(200);
  check('frame model moves the camera', (await page.evaluate(`${card}._view.camera.position.toArray().join()`)) !== cam0);

  await clickText('Remove model');
  await clickText('Really remove?');
  await sleep(300);
  check('remove clears model', (await page.evaluate(`${card}._layout.model`)) === null && !(await page.evaluate(`${card}._view.model`)));
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

if (allErrors.length) console.error('page errors:\n' + allErrors.join('\n'));
if (failures.length || allErrors.length) process.exit(1);
console.log('all model checks passed');
