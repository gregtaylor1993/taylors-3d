// Headless end-to-end check of edit mode on the demo page (first card, light theme).
// Draws a room, reshapes it, adds a door, pins/unpins/hides a marker, imports a layout.
// Writes screenshots/edit-*.png and exits non-zero on any failed step or page error.
import fs from 'node:fs';
import path from 'node:path';
import { openDemo, root } from './lib/demo-browser.mjs';

const shots = path.join(root, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const { page, errors, close } = await openDemo({ height: '560px' }, { width: 1500, height: 680 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' – ' + detail : ''}`);
  if (!ok) failures.push(name);
};
const card = 'document.querySelector("floorplan3d-card")';
const ev = (fn, ...args) => page.evaluate(fn, ...args);
const layout = () => ev(`${card}._layout`);
const saved = () => ev('window.__savedLayout || null');
const panelClick = async (text) => {
  const ok = await ev((t) => {
    const b = [...document.querySelector('floorplan3d-card').shadowRoot.querySelectorAll('.panel button')]
      .find((x) => x.textContent.trim() === t);
    if (b) b.click();
    return !!b;
  }, text);
  await sleep(150);
  return ok;
};
const rowButton = async (name, text) => {
  const ok = await ev((n, t) => {
    const li = [...document.querySelector('floorplan3d-card').shadowRoot.querySelectorAll('.panel li')]
      .find((x) => x.querySelector('.name') && x.querySelector('.name').textContent.trim().startsWith(n));
    const b = li && [...li.querySelectorAll('button')].find((x) => x.textContent.trim() === t);
    if (b) b.click();
    return !!b;
  }, name, text);
  await sleep(200);
  return ok;
};
// client px of a plan point on the active floor
const at = (x, y, z = 0) => ev((x, y, z) => {
  const c = document.querySelector('floorplan3d-card');
  return c._view.screenPoint(x, y, z, c._floor);
}, x, y, z);
const click = async (x, y) => {
  const [cx, cy] = await at(x, y);
  await page.mouse.click(cx, cy);
  await sleep(120);
};
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up();
  await sleep(250);
};

try {
  await ev(`window.__demoMower = ${card}._layout.mower`);
  // enter edit mode
  await ev(`${card}.shadowRoot.querySelector("button.edit").click()`);
  await sleep(300);
  check('panel shown', await ev(`getComputedStyle(${card}.shadowRoot.querySelector(".panel")).display !== "none"`));
  check('"All" chip hidden while editing', !(await ev(`[...${card}.shadowRoot.querySelectorAll(".chip")].some(b => b.textContent === "All")`)));
  check('garage listed as missing', await ev(`[...${card}.shadowRoot.querySelectorAll(".panel li")].some(li => li.textContent.includes("Garage") && li.textContent.includes("missing"))`));

  // draw the garage west of the bedroom, sharing its wall (x = 0)
  check('start drawing', await rowButton('Garage', 'Draw'));
  await ev(`(() => { const v = ${card}._view; v.ortho.zoom = 0.75; v.ortho.updateProjectionMatrix(); v.dirty = true; })()`);
  await sleep(200);
  check('switched to top view', (await ev(`${card}._mode`)) === 'top');
  await click(-4.02, 5.03);
  await click(0.08, 5.06); // within 25 cm of the bedroom corner (0, 5): snaps onto it
  await click(0.05, 9.1); // snaps to (0, 9)
  await page.mouse.move(...(await at(-3.0, 8.0)));
  await click(-3.98, 8.97);
  await page.screenshot({ path: path.join(shots, 'edit-drawing.png') });
  await click(-4.0, 5.02); // first point closes the room
  await sleep(200);
  let l = await layout();
  const garage = l.rooms.find((r) => r.area_id === 'garage');
  check('garage room created', !!garage, garage && JSON.stringify(garage.polygon));
  check('corners snapped to shared wall', garage && JSON.stringify(garage.polygon) === JSON.stringify([[-4, 5], [0, 5], [0, 9], [-4, 9]]));
  check('garage stored without floor_id (area floor)', garage && garage.floor_id === undefined);
  check('room selected after drawing', (await ev(`${card}._edit.selectedRoom`)) === garage?.id);
  await sleep(800);
  check('layout saved through storage', JSON.stringify((await saved())?.rooms) === JSON.stringify(l.rooms));

  // drag the north-west corner 1 m further west
  const handle = await ev(`(() => { const h = [...${card}.shadowRoot.querySelectorAll(".fp-handle.vertex")][3]; const r = h.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await drag(handle, await at(-5.0, 9.0));
  l = await layout();
  check('corner moved and snapped', JSON.stringify(l.rooms.find((r) => r.area_id === 'garage').polygon[3]) === '[-5,9]', JSON.stringify(l.rooms.find((r) => r.area_id === 'garage').polygon));

  // drag the middle of the south edge to add a corner
  const mid = await ev(`(() => { const h = ${card}.shadowRoot.querySelectorAll(".fp-handle.mid")[0]; const r = h.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await drag(mid, await at(-2.0, 4.5));
  l = await layout();
  check('midpoint drag inserts a corner', l.rooms.find((r) => r.area_id === 'garage').polygon.length === 5);

  // add a door on the shared wall
  check('door mode', await panelClick('Add door'));
  await click(0.2, 7.0);
  l = await layout();
  check('door added on the wall', JSON.stringify(l.rooms.find((r) => r.area_id === 'garage').doors) === '[[0,7]]');
  await page.screenshot({ path: path.join(shots, 'edit-room.png') });

  // outdoor toggle
  await ev(`(() => { const i = ${card}.shadowRoot.querySelector("[data-field=room-outdoor]"); i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await sleep(150);
  check('outdoor toggle', (await layout()).rooms.find((r) => r.area_id === 'garage').outdoor === true);

  // Esc while drawing cancels
  await rowButton('Garden', 'Select');
  check('select room from list', (await ev(`${card}._edit.selectedRoom`)) === 'r-garden');
  await panelClick('Done');

  // marker drag pins it
  const kettle = await ev(`(() => { const m = [...${card}.shadowRoot.querySelectorAll(".fp-marker")].find(x => x.title.startsWith("Kettle plug")); const r = m.querySelector(".fp-dot").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  const target = await at(10.5, 1.0, 1.1);
  await drag(kettle, target);
  l = await layout();
  const pin = l.pins['device:kettle_plug'];
  check('marker drag creates pin', !!pin && Math.abs(pin.x - 10.5) < 0.2 && Math.abs(pin.y - 1.0) < 0.2, JSON.stringify(pin));
  check('devices tab shows selection', (await ev(`${card}._edit.tab`)) === 'devices' && (await ev(`${card}._edit.selectedMarker`)) === 'device:kettle_plug');
  check('kettle switch not toggled by drag', (await ev(`${card}.hass.states["switch.kettle"].state`)) === 'off');

  await ev(`(() => { const i = ${card}.shadowRoot.querySelector("[data-field=marker-z]"); i.value = "0.4"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await sleep(150);
  check('height input updates pin', (await layout()).pins['device:kettle_plug'].z === 0.4);
  await page.screenshot({ path: path.join(shots, 'edit-devices.png') });
  check('return to auto placement', await panelClick('Return to auto placement'));
  check('pin removed', !(await layout()).pins['device:kettle_plug']);

  // hide / unhide
  await ev(`${card}._edit.selectMarker("device:kettle_plug")`);
  await panelClick('Hide');
  check('hidden', (await layout()).hidden.includes('device:kettle_plug'));
  check('hidden marker gone from plan', !(await ev(`[...${card}.shadowRoot.querySelectorAll(".fp-marker")].some(x => x.title.startsWith("Kettle plug"))`)));
  await rowButton('Kettle plug', 'Unhide');
  check('unhidden', !(await layout()).hidden.includes('device:kettle_plug'));

  // import a layout through the file input
  await panelClick('Data');
  const tmp = path.join(root, 'screenshots', 'import-test.json');
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, rooms: [{ id: 'x', area_id: 'kitchen', polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] }] }));
  const input = await page.evaluateHandle(`${card}.shadowRoot.querySelector("[data-field=import]")`);
  await input.uploadFile(tmp);
  await sleep(400);
  l = await layout();
  check('import replaces layout', l.rooms.length === 1 && l.rooms[0].area_id === 'kitchen');
  check('import message', (await ev(`${card}.shadowRoot.querySelector(".panel .msg")?.textContent || ""`)).includes('Imported 1 rooms'));
  fs.writeFileSync(tmp, '{"rooms": [{"id": "bad", "polygon": [[0,0]]}]}');
  const input2 = await page.evaluateHandle(`${card}.shadowRoot.querySelector("[data-field=import]")`);
  await input2.uploadFile(tmp);
  await sleep(400);
  check('bad import rejected', (await layout()).rooms[0].id === 'x' && (await ev(`${card}.shadowRoot.querySelector(".panel .msg.error")?.textContent || ""`)).includes('Room bad'));
  fs.unlinkSync(tmp);

  // drawing: Esc cancels
  await panelClick('Rooms');
  await rowButton('Hall', 'Draw');
  await click(5.5, 0.5);
  await page.keyboard.press('Escape');
  await sleep(100);
  check('Esc cancels drawing', (await ev(`${card}._edit.drawing`)) === null && (await layout()).rooms.length === 1);

  // mower: start from the demo layout again (the import above replaced it)
  await ev(`${card}._edit.commit(${card}._edit.layout.mower ? ${card}._edit.layout : { ...${card}._layout, mower: window.__demoMower })`);
  await panelClick('Mower');
  await sleep(1200);
  const live = await ev(`${card}.shadowRoot.querySelector(".mower-live").textContent`);
  check('mower tab shows live reading on plan', /Reading 45\.\d+, 10\.\d+/.test(live) && live.includes('on plan'), live.trim());
  check('mower marker follows live position', await ev(`(() => { const c = ${card}; const p = c._positions.get(c._mowerMarkerId); return !!p && p.live && Math.hypot(p.x - 16.5, p.y - 1.5) < 4.5; })()`));
  check('trail drawn', await ev(`!!${card}._view.trail && ${card}._trail.length > 1`));
  check('map overlay loaded', await ev(`!!${card}._view.mapPlane && !!${card}._view.mapPlane.material.map`));
  const cal0 = (await layout()).mower.calibration.length;
  check('add calibration point', await panelClick('Add point'));
  check('calibrating', !!(await ev(`${card}._edit.calibrating`)));
  await click(17.0, 2.0);
  l = await layout();
  check('calibration point stored', l.mower.calibration.length === cal0 + 1 && JSON.stringify(l.mower.calibration[cal0].plan) === '[17,2]', JSON.stringify(l.mower.calibration[cal0]));
  await ev(`(() => { const s = ${card}.shadowRoot.querySelector("[data-field=ov-rotation]"); s.value = "30"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(150);
  check('overlay slider updates live', (await layout()).mower.overlay.rotation === 30 && (await ev(`Math.round(${card}._view.mapPlane.rotation.y * 180 / Math.PI)`)) === 30);
  check('slider kept in DOM (no re-render)', await ev(`${card}.shadowRoot.querySelector("[data-field=ov-rotation]").value === "30"`));
  await panelClick('Move with mouse');
  const ov0 = (await layout()).mower.overlay;
  await drag(await at(16.5, 1.5), await at(18.5, 0.5));
  const ov1 = (await layout()).mower.overlay;
  check('overlay drag moves map', Math.abs(ov1.x - ov0.x - 2) < 0.15 && Math.abs(ov1.y - ov0.y + 1) < 0.15, `${ov0.x},${ov0.y} -> ${ov1.x},${ov1.y}`);
  await panelClick('Drag the map on the plan…');
  await page.screenshot({ path: path.join(shots, 'edit-mower.png') });

  // leave edit mode: markers behave as in view mode again
  await ev(`${card}.shadowRoot.querySelector("button.edit").click()`);
  await sleep(200);
  check('panel hidden after Done', await ev(`getComputedStyle(${card}.shadowRoot.querySelector(".panel")).display === "none"`));
  check('no handles left', (await ev(`${card}.shadowRoot.querySelectorAll(".fp-handle").length`)) === 0);
} catch (e) {
  failures.push(String(e && e.stack || e));
  console.error(e);
} finally {
  await close();
}
// narrow card (a sections-view column): plan on top, panel below, nothing covering the buttons
const narrow = await openDemo({ height: '520px' }, { width: 520, height: 1300 });
try {
  const p = narrow.page;
  await p.evaluate(`${card}.shadowRoot.querySelector("button.edit").click()`);
  await sleep(400);
  const box = await p.evaluate(`(() => { const s = ${card}.shadowRoot; const r = (q) => s.querySelector(q).getBoundingClientRect();
    return { card: r('ha-card').width, stage: [r('.stage').width, r('.stage').height], panel: r('.panel').width, panelTop: r('.panel').top, stageBottom: r('.stage').bottom }; })()`);
  check('narrow: plan keeps full width and height', Math.abs(box.stage[0] - box.card) < 1 && box.stage[1] === 520, JSON.stringify(box));
  check('narrow: panel below the plan, within the card', box.panelTop >= box.stageBottom - 1 && box.panel <= box.card + 1);
  const hit = await p.evaluate(`(() => { const s = ${card}.shadowRoot;
    const b = [...s.querySelectorAll('.panel button')].find((x) => x.textContent.trim() === 'Draw');
    const r = b.getBoundingClientRect(); return s.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b; })()`);
  check('narrow: Draw button is clickable (not covered)', hit);
  errors.push(...narrow.errors);
} finally {
  await narrow.close();
}

if (errors.length) console.error('page errors:\n' + errors.join('\n'));
if (failures.length || errors.length) process.exit(1);
console.log('all edit checks passed');
