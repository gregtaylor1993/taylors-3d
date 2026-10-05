// Real browser checks for the bottom navigation, room/device controls and mini-map.
// Run after npm run build: node scripts/navigation-check.mjs (CHROME_PATH may be needed).
// Reads scene positions to choose taps, but exercises navigation with real mouse gestures.
import fs from 'node:fs';
import path from 'node:path';
import { openDemo, root } from './lib/demo-browser.mjs';

const shots = path.join(root, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const failures = [];
const allErrors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' – ' + detail : ''}`);
  if (!ok) failures.push(name);
};

async function settle(page, index = 0) {
  await page.evaluate((i) => {
    window.__navigationSettleProbes ||= {};
    window.__navigationSettleProbes[i] = { startedAt: performance.now(), polls: 0, rafs: 0, stage: 'starting', samples: [] };
  }, index);
  await page.waitForFunction(async (i) => {
    const c = document.querySelectorAll('taylors3d-card')[i];
    const v = c?._view;
    const probe = window.__navigationSettleProbes[i];
    probe.polls++;
    if (!v || v._tween) { probe.stage = !v ? 'waiting-view' : 'waiting-tween'; return false; }
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => { probe.rafs++; probe.lastRafAt = performance.now(); resolve(); }));
    const snapshot = () => [...v.camera.position.toArray(), ...v.controls.target.toArray(), v.camera.zoom || 1];
    const still = (a, b) => a.every((value, j) => Math.abs(value - b[j]) < 1e-5);
    const sample = (stage, values) => {
      const now = performance.now();
      probe.stage = stage;
      probe.samples.push({ stage, elapsedMs: Math.round(now - probe.startedAt), values,
        finite: values.every(Number.isFinite), renderedFrames: v.stats.frames, tween: !!v._tween });
      // Keep only the latest eight snapshots; diagnostics never grow with the polling loop.
      if (probe.samples.length > 8) probe.samples.shift();
    };
    // OrbitControls damping can keep panning after a camera tween finishes. Wait for
    // actual camera/target stability across rendered frames, not a fixed wall-clock sleep.
    const before = snapshot();
    sample('waiting-frame-1', before);
    await frame();
    if (v._tween) { probe.stage = 'waiting-tween-after-frame'; return false; }
    const next = snapshot();
    sample('waiting-frame-2', next);
    await frame();
    const after = snapshot();
    sample('checking-stability', after);
    probe.maxChange = Math.max(...before.map((value, j) => Math.abs(value - next[j])), ...next.map((value, j) => Math.abs(value - after[j])));
    return !v._tween && still(before, next) && still(next, after);
  }, { timeout: 7000, polling: 'raf' }, index).catch(async (error) => {
    const diagnostic = await page.evaluate((i) => {
      const c = document.querySelectorAll('taylors3d-card')[i], v = c?._view;
      return { mode: c?._mode, viewMode: v?.mode, raf: v?._raf, dirty: v?.dirty,
        tween: !!v?._tween, tweenAge: v?._tween ? performance.now() - v._tween.t0 : null,
        hidden: document.hidden, frame: v?.stats?.frames, size: v?.size,
        dampingPan: v?.controls?._panOffset?.toArray(), camera: v?.camera.position.toArray(), target: v?.controls.target.toArray(),
        zoom: v?.camera.zoom, programs: v?.renderer.info.programs.length,
        elapsedMs: Math.round(performance.now() - window.__navigationSettleProbes[i].startedAt),
        probe: window.__navigationSettleProbes[i] };
    }, index);
    throw new Error(`${error.message}; camera diagnostics: ${JSON.stringify(diagnostic)}`, { cause: error });
  });
  await page.evaluate((i) => { delete window.__navigationSettleProbes[i]; }, index);
}

async function clickElement(page, selector, index = 0) {
  const point = await page.evaluate((sel, i) => {
    const c = document.querySelectorAll('taylors3d-card')[i];
    const el = c.shadowRoot.querySelector(sel);
    if (!el || el.hidden || getComputedStyle(el).display === 'none') return null;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const box = el.getBoundingClientRect();
    return box.width && box.height ? [box.left + box.width / 2, box.top + box.height / 2] : null;
  }, selector, index);
  if (!point) throw new Error(`Visible control missing: ${selector}`);
  await page.mouse.click(...point);
  await sleep(80);
}

async function markerPoint(page, name, index = 0) {
  return page.evaluate((name, i) => {
    const c = document.querySelectorAll('taylors3d-card')[i];
    const el = [...c.shadowRoot.querySelectorAll('.fp-marker')].find((m) => m.title.startsWith(name));
    if (!el || getComputedStyle(el).display === 'none') return null;
    const box = el.querySelector('.fp-dot').getBoundingClientRect();
    const scene = c.shadowRoot.querySelector('.scene').getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    return box.width && x > scene.left && x < scene.right && y > scene.top && y < scene.bottom ? [x, y] : null;
  }, name, index);
}

async function clickMarker(page, name, index = 0) {
  const point = await markerPoint(page, name, index);
  if (!point) throw new Error(`Marker is not on screen: ${name}`);
  await page.mouse.click(...point);
  await sleep(100);
}

async function popupState(page, index = 0) {
  return page.evaluate((i) => {
    const c = document.querySelectorAll('taylors3d-card')[i];
    const el = c.shadowRoot.querySelector('.taylors3d-device-popup');
    return {
      open: !!el,
      title: el?.querySelector('h3')?.textContent || '',
      entities: [...(el?.querySelectorAll('.t3d-entity') || [])].map((r) => r.dataset.entity),
      values: Object.fromEntries([...(el?.querySelectorAll('.t3d-entity') || [])].map((r) => [r.dataset.entity, r.querySelector('.t3d-entity-value').textContent])),
      calls: window.__serviceCalls || [],
      moreInfo: window.__navigationMoreInfo || [],
    };
  }, index);
}

// Pick an interior floor point actually reachable by a real pointer, away from markers/overlays.
async function roomPoint(page, areaId, index = 0, model = false) {
  return page.evaluate((areaId, i, model) => {
    const c = document.querySelectorAll('taylors3d-card')[i];
    const entry = c._roomList.find((r) => r.room.area_id === areaId);
    if (!entry) return null;
    const polygon = entry.room.polygon;
    if (!polygon || polygon.length < 3) return null;
    const inside = ([x, y]) => {
      let yes = false;
      for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
        const [ax, ay] = polygon[a], [bx, by] = polygon[b];
        if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) yes = !yes;
      }
      return yes;
    };
    const xs = polygon.map((p) => p[0]), ys = polygon.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const rect = c._view.renderer.domElement.getBoundingClientRect();
    const mouseObjectPickRadius = 30; // Match OBJECT_HIT_PX.mouse in taylors3d-card.js.
    for (const fy of [.5, .3, .7, .15, .85]) for (const fx of [.5, .3, .7, .15, .85]) {
      const plan = [minX + fx * (maxX - minX), minY + fy * (maxY - minY)];
      if (!inside(plan)) continue;
      const p = c._view.screenPoint(plan[0], plan[1], .02, entry.floorId);
      if (!p || p[0] < rect.left + 12 || p[0] > rect.right - 12 || p[1] < rect.top + 12 || p[1] > rect.bottom - 12) continue;
      if (c.shadowRoot.elementFromPoint(...p) !== c._view.renderer.domElement) continue;
      if (model) {
        const hit = c._view.pickModel(...p);
        // An upward-facing lamp/table is not the room floor. Also stay outside the
        // nearby object's screen hit radius, which intentionally wins over room taps.
        if (!hit || !hit.hit.up || !['room', 'zone'].includes(hit.kind) || hit.id !== entry.room.modelId
          || c._objectHit(...p, mouseObjectPickRadius, false)) continue;
      }
      return { point: p, roomId: entry.room.id, floorId: entry.floorId, name: entry.name };
    }
    return null;
  }, areaId, index, model);
}

async function clickView(page, floorId, index = 0) {
  await clickElement(page, `.chip[data-view="${floorId}"]`, index);
  await settle(page, index);
}

async function panOrigin(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), canvas = c._view.renderer.domElement;
    const box = canvas.getBoundingClientRect();
    for (const fy of [.15, .3, .6]) for (const fx of [.05, .15, .3]) {
      const point = [box.left + fx * box.width, box.top + fy * box.height];
      if (point[0] + 130 >= box.right - 12 || point[1] + 70 >= box.bottom - 12) continue;
      if (c.shadowRoot.elementFromPoint(...point) === canvas) return point;
    }
    return null;
  });
}

async function screenshotTheme(page, theme, name) {
  const section = await page.$(`section.${theme}`);
  await section.screenshot({ path: path.join(shots, `navigation-${theme}-${name}.png`) });
}

async function popupButtonContrast(page, index) {
  return page.evaluate((i) => {
    const popup = document.querySelectorAll('taylors3d-card')[i].shadowRoot.querySelector('.taylors3d-device-popup');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (color) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((v) => v / 255);
    };
    const blend = (front, back) => front.slice(0, 3).map((channel, j) => channel * front[3] + back[j] * (1 - front[3]));
    const luminance = (color) => {
      const linear = color.map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    };
    return [...popup.querySelectorAll('button')].filter((button) => !button.disabled && button.offsetWidth > 0 && button.offsetHeight > 0).map((button) => {
      // Composite transparent backgrounds through the shadow host to the actual theme.
      const ancestors = [];
      for (let node = button; node; node = node.parentElement || node.getRootNode().host) ancestors.push(node);
      let background = [1, 1, 1];
      for (const node of ancestors.reverse()) background = blend(rgba(getComputedStyle(node).backgroundColor), background);
      const style = getComputedStyle(button), foreground = blend(rgba(style.color), background);
      const a = luminance(foreground), b = luminance(background);
      return { action: button.dataset.action, label: button.getAttribute('aria-label') || button.textContent,
        opacity: Number(style.opacity), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  }, index);
}

async function installObservers(page) {
  await page.evaluate(() => {
    window.__demoMowerPaused = true;
    window.__serviceCalls = [];
    window.__navigationMoreInfo = [];
    window.addEventListener('hass-more-info', (e) => window.__navigationMoreInfo.push(e.detail.entityId));
  });
}

let session;
if (!process.argv.includes('--model-only')) {
session = await openDemo({ height: '600px', view: 'top', floor: 'ground' }, { width: 1440, height: 900 });
try {
  const { page } = session;
  await installObservers(page);
  await settle(page);
  const initial = await page.evaluate(() => [...document.querySelectorAll('taylors3d-card')].map((c) => {
    const s = c.shadowRoot, stage = s.querySelector('.stage').getBoundingClientRect();
    const canvas = s.querySelector('canvas').getBoundingClientRect(), bar = s.querySelector('.toolbar').getBoundingClientRect();
    return { stage: stage.height, canvas: canvas.height, bar: bar.height,
      reserved: canvas.bottom <= bar.top + 1, bottom: stage.bottom - bar.bottom,
      map: !s.querySelector('.taylors3d-minimap').hidden,
      readable: getComputedStyle(s.querySelector('.toolbar')).color !== getComputedStyle(s.querySelector('.toolbar')).backgroundColor };
  }));
  check('bottom bar reserves canvas space in both themes', initial.every((r) => r.reserved && r.canvas < r.stage && r.bar > 40 && r.bottom >= 7 && r.bottom <= 9), JSON.stringify(initial));
  check('mini-map and readable themed navigation appear by default', initial.every((r) => r.map && r.readable));
  await screenshotTheme(page, 'light', 'initial');
  await screenshotTheme(page, 'dark', 'initial');

  await clickMarker(page, 'Kettle plug');
  let state = await popupState(page);
  check('marker tap opens grouped-device controls without a service call', state.open && state.entities.includes('switch.kettle') && state.entities.includes('sensor.kettle_power') && state.calls.length === 0, JSON.stringify(state));
  await clickElement(page, '.taylors3d-device-popup .t3d-entity[data-entity="switch.kettle"] button[data-action="toggle"]');
  await page.waitForFunction(() => document.querySelector('taylors3d-card').hass.states['switch.kettle'].state === 'on');
  state = await popupState(page);
  check('explicit toggle uses the correct service and popup follows the live state', state.calls.length === 1 && JSON.stringify(state.calls[0]) === JSON.stringify(['switch', 'toggle', { entity_id: 'switch.kettle' }]) && state.values['switch.kettle'] === 'on', JSON.stringify(state));
  await clickElement(page, '.taylors3d-device-popup .t3d-entity[data-entity="sensor.kettle_power"] button[data-action="more-info"]');
  state = await popupState(page);
  check('All controls opens HA more-info for the selected secondary entity', !state.open && state.moreInfo.at(-1) === 'sensor.kettle_power' && state.calls.length === 1);

  // Dismissing with Escape allows the next floor tap to select a room normally.
  for (const [index, theme] of [[0, 'light'], [1, 'dark']]) {
    const tap = await roomPoint(page, 'kitchen', index);
    if (!tap) throw new Error(`No reachable kitchen floor in ${theme} theme`);
    const callsBefore = (await popupState(page, index)).calls.length;
    await page.mouse.click(...tap.point);
    await sleep(100);
    state = await popupState(page, index);
    check(`${theme}: a stationary room-floor tap opens the correct grouped controls`, state.open && state.title === 'Kitchen' && state.entities.includes('switch.kettle') && state.entities.includes('sensor.kettle_power') && state.entities.includes('sensor.kitchen_humidity') && state.calls.length === callsBefore, JSON.stringify(state));
    const contrast = await popupButtonContrast(page, index);
    check(`${theme}: enabled popup controls meet 4.5:1 text contrast`, contrast.some((b) => b.action === 'close')
      && contrast.some((b) => b.action === 'more-info') && contrast.every((b) => b.opacity === 1 && b.ratio >= 4.5),
    JSON.stringify({ buttons: contrast.length, minimum: Math.min(...contrast.map((b) => b.ratio)),
      failing: contrast.filter((b) => b.opacity !== 1 || b.ratio < 4.5) }));
    await screenshotTheme(page, theme, 'room-popup');
    const stacking = await page.evaluate((i) => {
      const s = document.querySelectorAll('taylors3d-card')[i].shadowRoot;
      return { popup: Number(getComputedStyle(s.querySelector('.taylors3d-device-popup')).zIndex),
        map: Number(getComputedStyle(s.querySelector('.taylors3d-minimap')).zIndex) };
    }, index);
    check(`${theme}: popup stacks above the mini-map`, stacking.popup > stacking.map, JSON.stringify(stacking));
    await page.keyboard.press('Escape');
  }

  const drag = await roomPoint(page, 'kitchen');
  await page.mouse.move(...drag.point);
  await page.mouse.down();
  await page.mouse.move(drag.point[0] - 70, drag.point[1] + 35, { steps: 8 });
  await page.mouse.up();
  await sleep(200);
  state = await popupState(page);
  check('an orbit/pan drag does not open a room or operate a device', !state.open && state.calls.length === 1);
  await clickElement(page, 'button.reset');
  await settle(page);

  // All shows both storeys; the mini-map's floor selector can independently choose the first floor.
  await clickView(page, 'all');
  const select = await page.evaluate(() => {
    const s = document.querySelector('taylors3d-card').shadowRoot.querySelector('.map-floor');
    s.focus();
    return { shown: !s.hidden, options: [...s.options].map((o) => o.value) };
  });
  check('All view exposes both floors in the mini-map', select.shown && select.options.includes('ground') && select.options.includes('first'), JSON.stringify(select));
  // Native select keyboard input exercises its actual change event rather than calling card internals.
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await sleep(120);
  const mapFocus = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), map = c.shadowRoot.querySelector('.taylors3d-minimap');
    const polygon = map.querySelector('[data-room="r-office"]');
    if (!polygon) return null;
    const points = polygon.getAttribute('points').split(' ').map((p) => p.split(',').map(Number));
    const svg = map.querySelector('svg'), box = svg.getBoundingClientRect(), view = svg.viewBox.baseVal;
    const x = points.reduce((n, p) => n + p[0], 0) / points.length;
    const y = points.reduce((n, p) => n + p[1], 0) / points.length;
    // A ceiling light can cover the room's centre. Hit-test to choose the room polygon itself.
    for (const [dx, dy] of [[0, 0], [6, 6], [-6, -6], [8, -6], [-8, 6]]) {
      const point = [box.left + (x + dx) / view.width * box.width, box.top + (y + dy) / view.height * box.height];
      const hit = c.shadowRoot.elementFromPoint(...point);
      if (hit?.closest('[data-room]') === polygon) return { point,
        before: c._view.getTopCamera().center, floor: map.querySelector('.map-floor').value };
    }
    return null;
  });
  if (!mapFocus) throw new Error('First-floor Office is missing from the mini-map');
  await page.mouse.click(...mapFocus.point);
  await settle(page);
  const focused = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    return { camera: c._view.getTopCamera(), floor: c._floor, popup: !!c.shadowRoot.querySelector('.taylors3d-device-popup'),
      selected: c._selectedRoomId, calls: window.__serviceCalls.length };
  });
  check('mini-map room tap focuses its centre on the correct floor', mapFocus.floor === 'first' && focused.floor === 'first' && focused.selected === 'r-office' && Math.abs(focused.camera.center[0] - 9.75) < .05 && Math.abs(focused.camera.center[1] - 2.5) < .05 && !focused.popup && focused.calls === 1, JSON.stringify(focused));

  // A rapid pan -> focus must reach the same room centre even while mouse-motion damping
  // remains active. Do not settle between these two real gestures: that would hide drift.
  const panStart = await panOrigin(page);
  if (!panStart) throw new Error('No clear canvas point for the active-pan focus regression');
  await page.mouse.move(...panStart);
  await page.mouse.down();
  await page.mouse.move(panStart[0] + 130, panStart[1] + 70, { steps: 3 });
  await page.mouse.up();
  const activePan = await page.evaluate(() => {
    const v = document.querySelector('taylors3d-card')._view;
    return { offset: v.controls._panOffset.toArray(), length: v.controls._panOffset.length(), tween: !!v._tween };
  });
  check('pan-to-focus regression starts with real camera damping still active', activePan.length > .01 && !activePan.tween, JSON.stringify(activePan));
  await page.mouse.click(...mapFocus.point);
  await settle(page);
  const afterPanFocus = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    return { camera: c._view.getTopCamera(), floor: c._floor, selected: c._selectedRoomId,
      tween: !!c._view._tween, popup: !!c.shadowRoot.querySelector('.taylors3d-device-popup'), calls: window.__serviceCalls.length };
  });
  check('mini-map focus reaches the room centre during active pan damping', afterPanFocus.floor === 'first'
    && afterPanFocus.selected === 'r-office' && Math.abs(afterPanFocus.camera.center[0] - 9.75) < .05
    && Math.abs(afterPanFocus.camera.center[1] - 2.5) < .05 && !afterPanFocus.tween && !afterPanFocus.popup
    && afterPanFocus.calls === 1, JSON.stringify(afterPanFocus));

  // Right-drag is the 3D camera's pan gesture. Check the same interaction with perspective.
  await clickElement(page, '.seg button[data-mode="3d"]');
  await settle(page);
  const perspective = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), camera = c._view.getCamera();
    return { mode: c._mode, distance: Math.hypot(...camera.position.map((value, i) => value - camera.target[i])) };
  });
  check('3D focus regression starts with a valid framed perspective camera', perspective.mode === '3d' && perspective.distance > .1, JSON.stringify(perspective));
  const pan3dStart = await panOrigin(page);
  if (!pan3dStart) throw new Error('No clear canvas point for the 3D active-pan focus regression');
  await page.mouse.move(...pan3dStart);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(pan3dStart[0] + 130, pan3dStart[1] + 70, { steps: 3 });
  await page.mouse.up({ button: 'right' });
  const active3dPan = await page.evaluate(() => {
    const v = document.querySelector('taylors3d-card')._view;
    return { offset: v.controls._panOffset.toArray(), length: v.controls._panOffset.length(), tween: !!v._tween };
  });
  check('3D pan-to-focus starts with real camera damping still active', active3dPan.length > .01 && !active3dPan.tween, JSON.stringify(active3dPan));
  await page.mouse.click(...mapFocus.point);
  await settle(page);
  const after3dFocus = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    return { camera: c._view.getCamera(), floor: c._floor, mode: c._mode,
      selected: c._selectedRoomId, popup: !!c.shadowRoot.querySelector('.taylors3d-device-popup'), calls: window.__serviceCalls.length };
  });
  check('3D mini-map focus reaches the room centre during active pan damping', after3dFocus.mode === '3d'
    && after3dFocus.floor === 'first' && after3dFocus.selected === 'r-office'
    && after3dFocus.camera.target.every((value, i) => Math.abs(value - [9.75, 3, -2.5][i]) < .05)
    && !after3dFocus.popup && after3dFocus.calls === 1, JSON.stringify(after3dFocus));
  await clickElement(page, '.seg button[data-mode="top"]');
  await settle(page);
  await clickElement(page, '.map-close');
  check('mini-map X hides the map', await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('.taylors3d-minimap').hidden));
  await clickElement(page, 'button.minimap-toggle');
  check('map bubble restores the mini-map', await page.evaluate(() => !document.querySelector('taylors3d-card').shadowRoot.querySelector('.taylors3d-minimap').hidden));
  await clickElement(page, 'button.edit');
  check('edit mode hides the mini-map', await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('.taylors3d-minimap').hidden));
  await clickElement(page, 'button.edit');
  check('leaving edit restores the mini-map', await page.evaluate(() => !document.querySelector('taylors3d-card').shadowRoot.querySelector('.taylors3d-minimap').hidden));

  // Demo's own 420px grid minimum is removed so this tests a card hosted on a narrow panel.
  await page.addStyleTag({ content: 'main { grid-template-columns: minmax(0, 1fr); } .theme { box-sizing: border-box; } .theme.dark { display: none; }' });
  for (const width of [320, 360, 480]) {
    await page.setViewport({ width, height: 820, deviceScaleFactor: 1 });
    await sleep(180);
    const narrow = await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), s = c.shadowRoot;
      const stage = s.querySelector('.stage').getBoundingClientRect(), bar = s.querySelector('.toolbar').getBoundingClientRect();
      const canvas = s.querySelector('canvas').getBoundingClientRect();
      const buttons = [...s.querySelectorAll('.toolbar button')].filter((b) => b.offsetWidth > 0);
      return { pageOverflow: document.documentElement.scrollWidth > innerWidth,
        barFits: bar.left >= stage.left && bar.right <= stage.right && bar.bottom <= stage.bottom,
        reserved: canvas.bottom <= bar.top + 1, canvasHeight: canvas.height,
        touchTargets: buttons.every((b) => b.getBoundingClientRect().height >= 43),
        rowScrolls: ['auto', 'scroll'].includes(getComputedStyle(s.querySelector('.bubble-actions')).overflowX) };
    });
    check(`${width}px wall panel: navigation fits, scrolls and reserves space`, !narrow.pageOverflow && narrow.barFits && narrow.reserved && narrow.canvasHeight > 300 && narrow.touchTargets && narrow.rowScrolls, JSON.stringify(narrow));
  }
  await page.screenshot({ path: path.join(shots, 'navigation-narrow-480.png') });

  // Public configuration opt-outs plus the user's existing quick-toggle behaviour.
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    c.setConfig({ type: 'custom:taylors3d-card', height: '600px', view: 'top', floor: 'ground',
      show_bubble_bar: false, mini_map: false, device_tap_action: 'toggle' });
  });
  await sleep(250);
  const disabled = await page.evaluate(() => {
    const s = document.querySelector('taylors3d-card').shadowRoot;
    const stage = s.querySelector('.stage').getBoundingClientRect(), canvas = s.querySelector('canvas').getBoundingClientRect();
    return { bar: s.querySelector('.toolbar').hidden, map: s.querySelector('.taylors3d-minimap').hidden,
      fullHeight: Math.abs(stage.height - canvas.height) <= 1 };
  });
  check('configuration hides both navigation overlays and restores full canvas height', disabled.bar && disabled.map && disabled.fullHeight, JSON.stringify(disabled));
  // Re-enable the bar solely to choose ground/reset through visible UI, then hide it again.
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    c.setConfig({ ...c._config, show_bubble_bar: true });
  });
  await clickView(page, 'ground');
  await clickElement(page, 'button.reset');
  await settle(page);
  const beforeLegacy = await popupState(page);
  const priorState = await page.evaluate(() => document.querySelector('taylors3d-card').hass.states['switch.kettle'].state);
  await clickMarker(page, 'Kettle plug');
  state = await popupState(page);
  const afterLegacy = await page.evaluate(() => document.querySelector('taylors3d-card').hass.states['switch.kettle'].state);
  check('legacy toggle tap remains available without a device popup', !state.open && state.calls.length === beforeLegacy.calls.length + 1 && state.calls.at(-1)[0] === 'switch' && state.calls.at(-1)[1] === 'toggle' && priorState !== afterLegacy);
} catch (error) {
  check('navigation scenario completes', false, error.stack || error.message);
} finally {
  allErrors.push(...session.errors);
  await session.close();
}
}

// A GLB can have clickable lamps under overlay coordinates; those gestures must be isolated.
session = await openDemo({ height: '600px', view: 'top', floor: 'ground' }, { width: 1440, height: 900 });
try {
  const { page } = session;
  let state;
  await installObservers(page);
  // Public card configuration loads the model after openDemo's marker-ready handshake.
  // Model-bound markers may disappear, so they are not a model readiness condition.
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('taylors3d-card')];
    // The plain scene already exercises both themes. This GLB fixture needs one renderer;
    // removing the second card stops its RAF loop before the shared software GPU loads a model.
    cards.slice(1).forEach((c) => c.remove());
    const c = cards[0];
    window.__navigationModelFrameBefore = c._view.stats.frames;
    c.setConfig({ ...c._config, model: '/demo/house.glb', model_opacity: .95 });
  });
  await page.waitForFunction(() => !!document.querySelector('taylors3d-card')._view.model, { timeout: 12000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('taylors3d-card')._view;
    return v.stats.frames > window.__navigationModelFrameBefore && v.renderer.info.render.calls > 0;
  }, { timeout: 12000 });
  const warmup = await page.evaluate(() => {
    const v = document.querySelector('taylors3d-card')._view;
    return { frame: v.stats.frames, calls: v.renderer.info.render.calls, triangles: v.renderer.info.render.triangles,
      programs: v.renderer.info.programs.length, model: !!v.model };
  });
  check('single-card GLB fixture has rendered model geometry before interaction', warmup.model && warmup.calls > 0 && warmup.triangles > 0, JSON.stringify(warmup));
  await clickView(page, 'ground');
  await settle(page);
  const anchor = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), stage = c.shadowRoot.querySelector('.stage').getBoundingClientRect();
    for (const a of c._objects.anchors()) {
      const o = c._objects.objectAt(a.id), p = c._view.projectWorld(a.world);
      if (!o?.binding?.entity?.startsWith('light.') || !p || p[0] < stage.left + 100 || p[0] > stage.right - 100 || p[1] < stage.top + 100 || p[1] > stage.bottom - 190) continue;
      return { id: a.id, point: p, entity: o.binding.entity };
    }
    return null;
  });
  if (!anchor) throw new Error('No model light anchor is reachable for overlay gesture checks');
  const boundMapMarkers = await page.evaluate((id) => {
    const map = document.querySelector('taylors3d-card').shadowRoot.querySelector('.taylors3d-minimap');
    const ids = [...map.querySelectorAll('[data-marker]')].map((m) => m.getAttribute('data-marker'));
    return { floor: map.querySelector('.map-floor').value,
      hasAnchor: ids.includes(`object:${id}`), boundObjects: ids.filter((id) => id.startsWith('object:')).length };
  }, anchor.id);
  check('ground-floor mini-map includes its bound GLB lamp as a device dot', boundMapMarkers.floor === 'ground' && boundMapMarkers.hasAnchor && boundMapMarkers.boundObjects > 0, JSON.stringify(boundMapMarkers));
  await page.evaluate((point) => {
    const c = document.querySelector('taylors3d-card'), stage = c.shadowRoot.querySelector('.stage').getBoundingClientRect();
    const map = c.shadowRoot.querySelector('.taylors3d-minimap');
    // An overlap fixture puts a known clickable model object under the map's floor surface.
    map.style.left = `${point[0] - stage.left - 90}px`;
    map.style.top = `${point[1] - stage.top - 85}px`;
    map.style.right = 'auto';
  }, anchor.point);
  await page.mouse.click(...anchor.point);
  await settle(page);
  state = await popupState(page);
  check('mini-map pointer over a model lamp never triggers its object action', !state.open && state.calls.length === 0);

  // The model lamp itself follows the new default: open controls before making any changes.
  await clickElement(page, '.map-close');
  await clickElement(page, 'button.reset');
  await settle(page);
  const tappableLamp = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), canvas = c._view.renderer.domElement;
    const box = canvas.getBoundingClientRect();
    for (const a of c._objects.anchors()) {
      const o = c._objects.objectAt(a.id), point = c._view.projectWorld(a.world);
      if (!o?.binding?.entity?.startsWith('light.') || !point || point[0] < box.left + 12 || point[0] > box.right - 12
        || point[1] < box.top + 12 || point[1] > box.bottom - 12) continue;
      if (c.shadowRoot.elementFromPoint(...point) !== canvas || c._objectHit(...point, 30) !== a.id) continue;
      return { id: a.id, point, entity: o.binding.entity };
    }
    return null;
  });
  if (!tappableLamp) throw new Error('No visible model lamp passes the actual object hit-test');
  await page.mouse.click(...tappableLamp.point);
  await sleep(100);
  state = await popupState(page);
  check('real bound GLB lamp tap opens its controls with zero HA service calls', state.open && state.entities.includes(tappableLamp.entity) && state.calls.length === 0, JSON.stringify({ lamp: tappableLamp.id, entity: tappableLamp.entity, ...state }));
  await screenshotTheme(page, 'light', 'model-device-popup');
  await page.keyboard.press('Escape');

  // A real floor tap opens a room, then the popup is positioned over the map to verify stacking.
  const roomTap = await roomPoint(page, 'kitchen', 0, true);
  if (!roomTap) throw new Error('No reachable model kitchen floor');
  await page.mouse.click(...roomTap.point);
  await sleep(120);
  state = await popupState(page);
  check('model room floor opens its mapped HA devices without device actions', state.open && state.title === 'Kitchen' && state.entities.includes('sensor.kettle_power') && state.calls.length === 0, JSON.stringify(state));
  // Restore map without clicking outside (a bar click legitimately dismisses the popup).
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), map = c.shadowRoot.querySelector('.taylors3d-minimap');
    map.hidden = false;
    map.style.left = 'auto'; map.style.right = '12px'; map.style.top = '12px';
    const pop = c.shadowRoot.querySelector('.taylors3d-device-popup');
    pop.style.left = 'auto'; pop.style.right = '12px'; pop.style.top = '12px';
  });
  const overlap = await page.evaluate(() => {
    const s = document.querySelector('taylors3d-card').shadowRoot;
    const pop = s.querySelector('.taylors3d-device-popup'), map = s.querySelector('.taylors3d-minimap');
    const p = pop.getBoundingClientRect(), m = map.getBoundingClientRect();
    const close = pop.querySelector('[data-action="close"]'), b = close.getBoundingClientRect();
    return { overlap: p.left < m.right && p.right > m.left && p.top < m.bottom && p.bottom > m.top,
      above: Number(getComputedStyle(pop).zIndex) > Number(getComputedStyle(map).zIndex),
      closeClickable: s.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === close };
  });
  check('overlapping room popup sits above the map and its close button is reachable', overlap.overlap && overlap.above && overlap.closeClickable, JSON.stringify(overlap));
  await screenshotTheme(page, 'light', 'popup-map-overlap');
  await clickElement(page, '.taylors3d-device-popup button[data-action="close"]');
  state = await popupState(page);
  check('popup controls over GLB geometry close cleanly without a model action', !state.open && state.calls.length === 0);
} catch (error) {
  check('GLB overlay scenario completes', false, error.stack || error.message);
} finally {
  allErrors.push(...session.errors);
  await session.close();
}

check('no browser errors', allErrors.length === 0, allErrors.join('\n'));
console.log(`Screenshots saved to ${shots}`);
if (failures.length) {
  console.error(`${failures.length} navigation check(s) failed: ${failures.join('; ')}`);
  process.exitCode = 1;
}
