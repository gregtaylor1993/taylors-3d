// Native source/bundle proof of the actual Taylor's 3D glass surfaces. All HA
// readings and transport replies are simulated. The authored cutaway below is
// a sample model, not Taylor's house; nothing here operates a real device.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { floorPresentationFixtureGlb } from './lib/floor-presentation-fixture.mjs';
import { prepareRoomActionsFixture, serveRoomActionsFixture, roomActionsHtml, roomActionEntities,
  roomActionLayoutKey, roomActionRoomId, roomActionIds } from './lib/room-actions-fixture.mjs';

const requested = process.env.GLASS_THEME_MODE;
if (requested !== undefined && !['source', 'bundle'].includes(requested)) throw Error('GLASS_THEME_MODE must be source or bundle');
const checks = [], samples = [], screenshots = [], browserErrors = [];
const smoke = process.env.GLASS_THEME_SMOKE === '1';
const mediaSessions = new WeakMap();
let mode = '', context = 'initialization';
const output = path.join(root, 'screenshots');
fs.mkdirSync(output, { recursive: true });
const runtimeFingerprint = () => Object.fromEntries([
  ...fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter((name) => name.endsWith('.js')).map((name) => 'src/' + name.replaceAll('\\', '/')),
  'dist/taylors3d-card.js', 'custom_components/taylors3d/frontend/taylors3d-card.js',
].sort().map((name) => [name, createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')]));
const runtimeBefore = runtimeFingerprint();
const check = (name, pass, detail) => {
  checks.push({ mode, name, pass: !!pass, ...(detail === undefined ? {} : { detail }) });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${mode} ${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`);
};
const settle = async (page) => {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => [...document.querySelector('taylors3d-card').shadowRoot.querySelectorAll('*')]
    .every((node) => node.getAnimations().every((animation) => !(animation instanceof CSSTransition)
      || ['finished', 'idle'].includes(animation.playState))), { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('taylors3d-card')._view?._tween, { timeout: 10000 });
};
const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < .75;
const sameRect = (a, b) => a && b && ['x', 'y', 'width', 'height'].every((key) => near(a[key], b[key]));
// Native OrbitControls recomputes the camera on pointer-down: allow only
// floating-point arithmetic noise (one nanometre), never a visible reframe.
const sameCamera = (a, b) => a && b && ['position', 'target'].every((key) => a[key].length === b[key].length
  && a[key].every((value, index) => Math.abs(value - b[key][index]) <= 1e-9));

// Enrich the independent box fixture only in this test program: neutral floors,
// low cutaway walls and simple furniture. Tagged rooms/levels/object IDs and
// their source outlines remain exact; the normal integration GLTFLoader loads it.
function cutawaySampleGlb() {
  const original = floorPresentationFixtureGlb();
  const jsonLength = original.readUInt32LE(12), document = JSON.parse(original.subarray(20, 20 + jsonLength));
  const binary = original.subarray(28 + jsonLength);
  const colours = [[.49, .51, .54], [.64, .65, .67], [.3, .32, .35], [.38, .4, .43], [.78, .77, .74]];
  document.asset.generator = "Taylor's 3D original simulated cutaway UI sample";
  document.materials.forEach((material, index) => {
    material.pbrMetallicRoughness.baseColorFactor = [...colours[index % colours.length], 1];
  });
  const boxMesh = document.meshes.findIndex((mesh) => mesh.name.startsWith('authored_shared_pbr'));
  const furnitureMaterial = document.materials.push({ name: 'sample-furniture', pbrMetallicRoughness: {
    baseColorFactor: [.68, .66, .62, 1], metallicFactor: 0, roughnessFactor: 1 }, extensions: { KHR_materials_unlit: {} } }) - 1;
  const furnitureMesh = document.meshes.push({ name: 'sample-furniture-box', primitives: document.meshes[boxMesh].primitives.map((p) => ({ ...p, material: furnitureMaterial })) }) - 1;
  const add = (room, name, translation, scale, mesh = boxMesh) => {
    room.children.push(document.nodes.push({ name: 'sample_' + name, translation, scale, mesh }) - 1);
  };
  for (const [id, width, depth] of [[roomActionIds.groundRoom, 6, 4], [roomActionIds.upperRoom, 4, 3]]) {
    const room = document.nodes.find((node) => node.name === id);
    add(room, id + '_north_wall', [0, .65, -depth / 2], [width, 1.3, .12]);
    add(room, id + '_east_wall', [width / 2, .65, 0], [.12, 1.3, depth]);
    add(room, id + '_sofa_base', [-width / 4, .3, depth / 4], [1.65, .6, .65], furnitureMesh);
    add(room, id + '_sofa_back', [-width / 4, .65, depth / 4 + .25], [1.65, .4, .15], furnitureMesh);
    add(room, id + '_table', [width / 5, .35, depth / 4], [.65, .12, .6], furnitureMesh);
  }
  const raw = Buffer.from(JSON.stringify(document)), json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20), tail = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8);
  header.writeUInt32LE(json.length, 12); header.write('JSON', 16); tail.writeUInt32LE(binary.length); tail.write('BIN\0', 4);
  return Buffer.concat([header, json, tail, binary]);
}

function iconHtml(mode) {
  return roomActionsHtml(mode).replace('class FixtureIcon extends HTMLElement{}', `
    import * as mdi from '/node_modules/@mdi/js/mdi.js';
    class FixtureIcon extends HTMLElement {
      static get observedAttributes(){return ['icon'];}
      attributeChangedCallback(){
        const key='mdi'+(this.getAttribute('icon')||'').replace(/^mdi:/,'').split('-').map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join('');
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');
        svg.style.cssText='width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);display:block;fill:currentColor';
        const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',mdi[key]||mdi.mdiHelpCircleOutline);svg.append(path);this.replaceChildren(svg);
      }
    }`);
}

function sampleLayout(original, bytes) {
  const layout = structuredClone(original);
  layout.model.name = 'Original simulated cutaway sample.glb'; layout.model.size = bytes;
  layout.model.known = { levels: [roomActionIds.ground, roomActionIds.upper, roomActionIds.background], rooms: [roomActionIds.groundRoom, roomActionIds.upperRoom] };
  layout.room_actions.rooms[0].actions.forEach((action, index) => { action.label = index ? 'Evening routine' : 'Movie'; });
  layout.custom_controls = { version: 1, bars: [
    { id: 'favourites', label: 'Favourite controls', placement: 'bottom', style: 'pills', dock: { limit: 4 }, buttons: [
      { id: 'lamp', label: 'Lounge light', icon: 'mdi:lightbulb-outline', color: 'theme', pinned: true, action: { type: 'toggle', entity: roomActionEntities.lamp } },
      { id: 'movie', label: 'Movie', icon: 'mdi:movie-outline', color: 'theme', pinned: true, action: { type: 'scene', entity: roomActionEntities.scene } },
      { id: 'view', label: 'Upstairs', icon: 'mdi:layers-outline', color: 'theme', pinned: true, action: { type: 'view', view_id: 'upper' } },
      { id: 'missing', label: 'Unlinked routine', icon: 'mdi:help-circle-outline', color: 'theme', action: { type: 'scene', entity: 'scene.missing' } } ] },
    { id: 'left', label: 'Quick actions', placement: 'left', style: 'pills', buttons: [
      { id: 'left-scene', label: 'Evening', icon: 'mdi:weather-night', color: 'theme', action: { type: 'scene', entity: roomActionEntities.scene } },
      { id: 'left-view', label: 'Upstairs', icon: 'mdi:layers-outline', color: 'theme', action: { type: 'view', view_id: 'upper' } } ] },
    { id: 'room', label: 'Room favourites', placement: 'room', room_id: roomActionRoomId, style: 'pills', buttons: [
      { id: 'room-scene', label: 'Movie', icon: 'mdi:movie-outline', color: 'theme', action: { type: 'scene', entity: roomActionEntities.scene } } ] } ] };
  layout.house_summary = { title: 'Taylor’s 3D · Sample house' };
  return layout;
}

async function configure(page, { scheme, style, width, reduced = false, transparency = false }) {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
  await page.setViewport({ width, height: width < 600 ? 980 : 1120, deviceScaleFactor: 1 });
  // Chrome's supported-media list does not expose prefers-reduced-transparency;
  // CDP is used directly so the browser, rather than a stub, evaluates the CSS.
  let cdp = mediaSessions.get(page);
  if (!cdp) { cdp = await page.createCDPSession(); mediaSessions.set(page, cdp); }
  await cdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
    { name: 'prefers-reduced-transparency', value: transparency ? 'reduce' : 'no-preference' } ] });
  await page.evaluate(({ scheme, style, width }) => {
    const card = document.querySelector('taylors3d-card');
    if (card._editing) card._toggleEdit(); card._devicePopup.close();
    const dark = scheme === 'dark';
    document.body.style.background = dark ? '#09090b' : '#f3f3f5'; document.body.style.color = dark ? '#ceced3' : '#45454c';
    for (const [key, value] of Object.entries(dark
      ? { 'primary-background-color': '#101013', 'card-background-color': '#1d1d21', 'secondary-background-color': '#29292e', 'primary-text-color': '#f7f7fa', 'secondary-text-color': '#c6c6ce' }
      : { 'primary-background-color': '#f4f4f6', 'card-background-color': '#fff', 'secondary-background-color': '#ececf0', 'primary-text-color': '#1c1c21', 'secondary-text-color': '#53535b' })) card.style.setProperty('--' + key, value);
    card.setConfig({ ...card._config, layout_style: style === 'anchored' ? 'original' : style,
      control_panel: style === 'anchored' ? 'popup' : 'right', house_colour_scheme: scheme, height: width < 600 ? '650px' : '900px' });
    card.hass = { ...card._hass, themes: { darkMode: dark } }; card._setView('upper', { instant: true }); card._setMode('3d');
  }, { scheme, style, width });
  await settle(page);
  // Use the existing reset control after the actual layout measurement has
  // settled. The fixture has no authored camera, so reset fits visible geometry.
  await page.locator('taylors3d-card >>> .toolbar button.reset').click(); await settle(page);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), shadow = card.shadowRoot;
    const parent = (node) => node.parentElement || node.getRootNode()?.host;
    const visible = (node) => !!node.getClientRects().length && !node.closest('[hidden]')
      && (!node.closest('details:not([open])') || node.tagName === 'SUMMARY')
      && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden';
    const box = (node) => { const rect = node?.getBoundingClientRect(); return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const painter = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (value) => { painter.clearRect(0, 0, 1, 1); painter.fillStyle = value; painter.fillRect(0, 0, 1, 1); return [...painter.getImageData(0, 0, 1, 1).data]; };
    const blend = (front, back, alpha = front[3] / 255) => [...front.slice(0, 3).map((value, i) => value * alpha + back[i] * (1 - alpha)), 255];
    const background = (node) => node ? blend(rgba(getComputedStyle(node).backgroundColor), background(parent(node))) : [255, 255, 255, 255];
    const luminance = (values) => values.slice(0, 3).map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const id = (node) => node.dataset.act || node.dataset.field || node.dataset.action || node.dataset.roomSheetMode || node.dataset.bubble || node.className || node.tagName;
    const scopes = [...shadow.querySelectorAll('[data-taylors3d-summary],[data-house-navigation],.toolbar,.taylors3d-device-popup,.panel,[data-custom-controls-view],[data-ui-feedback],.fp-room-label,.fp-val')].filter(visible);
    const captions = new Set();
    for (const scope of scopes) for (const node of [scope, ...scope.querySelectorAll('*')]) {
      if (!visible(node) || ['STYLE', 'SCRIPT', 'OPTION', 'HA-ICON', 'SVG', 'PATH'].includes(node.tagName)) continue;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && !['checkbox', 'radio', 'range', 'color', 'file', 'hidden'].includes(node.type)
        || [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) captions.add(node);
    }
    const readings = [...captions].map((node) => {
      const css = getComputedStyle(node); let bg = background(node), fg = blend(rgba(css.color), bg);
      for (let current = node; current; current = parent(current)) if (Number(getComputedStyle(current).opacity) < 1) {
        const below = background(parent(current)), alpha = Number(getComputedStyle(current).opacity); fg = blend(fg, below, alpha); bg = blend(bg, below, alpha);
      }
      const first = luminance(fg), second = luminance(bg);
      const text = node.tagName === 'INPUT' ? node.value || node.placeholder || node.getAttribute('aria-label')
        : node.tagName === 'SELECT' ? node.selectedOptions[0]?.textContent : node.textContent.trim();
      return { id: id(node), text: String(text || '').slice(0, 100), ratio: (Math.max(first, second) + .05) / (Math.min(first, second) + .05),
        foreground: css.color, background: css.backgroundColor, disabled: node.disabled === true };
    }).filter((row) => row.text);
    const controls = [...new Set(scopes.flatMap((scope) => [...scope.querySelectorAll('button,input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]),select,textarea,summary,label.button')]))]
      .filter(visible).map((node) => ({ id: id(node), ...box(node), fits: node.scrollWidth <= node.clientWidth + 1 }));
    const css = getComputedStyle(card);
    const selected = [...shadow.querySelectorAll('.toolbar [aria-pressed="true"],[data-house-navigation] [aria-pressed="true"]')].filter(visible).map((node) => ({
      id: id(node), background: rgba(getComputedStyle(node).backgroundColor).slice(0, 3), colour: getComputedStyle(node).color }));
    const surfaces = [...shadow.querySelectorAll('.toolbar,.taylors3d-device-popup,[data-house-navigation],.custom-controls-toggle,[data-custom-controls-placement="left"] .custom-controls-bars,.panel')]
      .filter(visible).map((node) => ({ id: id(node), background: getComputedStyle(node).backgroundColor,
        alpha: rgba(getComputedStyle(node).backgroundColor)[3], backdrop: getComputedStyle(node).backdropFilter, radius: getComputedStyle(node).borderRadius }));
    const transitions = [...shadow.querySelectorAll('.toolbar *,.panel *,.taylors3d-device-popup *,[data-custom-controls-view] *,.fp-dot')].filter(visible)
      .filter((node) => getComputedStyle(node).transitionDuration.split(',').some((value) => parseFloat(value) > 0)).map((node) => ({ id: id(node), duration: getComputedStyle(node).transitionDuration }));
    return { theme: card.getAttribute('data-taylors3d-theme'), scheme: card.getAttribute('data-taylors3d-scheme'),
      palette: { background: css.getPropertyValue('--taylors3d-ui-background').trim(), text: css.getPropertyValue('--taylors3d-ui-text').trim() },
      scene: box(card._scene), canvas: box(card._view.renderer.domElement), editor: card._editing ? box(shadow.querySelector('.tab-body')) : null,
      popup: card._devicePopup.isOpen ? box(card._devicePopup.el) : null, camera: { position: card._view.camera.position.toArray(), target: card._view.controls.target.toArray() },
      readings: readings.length, minimumContrast: Math.min(...readings.map((row) => row.ratio)), badContrast: readings.filter((row) => row.ratio < 4.5),
      controls: controls.length, badTargets: controls.filter((row) => row.width < 43.9 || row.height < 43.9), badLabels: controls.filter((row) => !row.fits),
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, selected, surfaces, transitions,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
      rendererSame: card._view.renderer === window.roomActionsFixture.renderer,
      calls: window.roomActionsFixture.calls.length, commits: window.roomActionsFixture.commits,
      writes: window.roomActionsFixture.ws.filter((message) => message.type === 'taylors3d/layout/set').length };
  });
}

async function audit(page, name, options = {}) {
  context = name; const data = await snapshot(page); samples.push({ mode, name, ...data });
  check(`${name}: real native captions retain 4.5:1 contrast`, data.readings >= 5 && !data.badContrast.length,
    { count: data.readings, minimum: data.minimumContrast, failed: data.badContrast });
  check(`${name}: native controls remain 44px and labels fit`, data.controls > 0 && !data.badTargets.length && !data.badLabels.length && !data.pageOverflow,
    { count: data.controls, targets: data.badTargets, labels: data.badLabels, overflow: data.pageOverflow });
  check(`${name}: actual renderer and at least 240px house scene survive`, data.rendererSame && data.scene?.height >= 239.9, data.scene);
  check(`${name}: active navigation remains monochrome`, data.selected.length > 0
    && data.selected.every((row) => Math.max(...row.background) - Math.min(...row.background) <= 12), data.selected);
  if (options.editor) check(`${name}: actual settings retain at least 240px usable space`, data.editor?.height >= 239.9, data.editor);
  if (options.reduced) check(`${name}: reduced motion stops decorative transitions`, data.reducedMotion && !data.transitions.length, data.transitions);
  if (options.transparency) check(`${name}: browser reduced transparency produces solid surfaces`, data.reducedTransparency
    && data.surfaces.every((surface) => surface.backdrop === 'none' && surface.alpha === 255), data.surfaces);
  else if (!options.editor) check(`${name}: floating surfaces use actual subtle glass`, data.surfaces.some((surface) => surface.backdrop.includes('blur(') && surface.alpha < 255), data.surfaces);
  return data;
}

async function shot(page, name) {
  const filename = `glass-${mode}-${name}.png`;
  await page.screenshot({ path: path.join(output, filename), fullPage: true }); screenshots.push(filename);
}

// Lovelace's real editor element is exercised through its normal constructor.
// Only ha-form is a labelled boundary stand-in: actual HA shadow controls need
// acceptance inside Home Assistant and are not claimed by these measurements.
async function cardEditorStage(page) {
  await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card');
    if (card._editing) card._toggleEdit(); card._devicePopup.close(); card.style.display = 'none';
    if (!customElements.get('ha-form')) customElements.define('ha-form', class extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: 'open' }); }
      set data(value) { this.currentData = value; this.shadowRoot.innerHTML = '<style>:host{display:block;border:1px dashed var(--divider-color);padding:16px;box-sizing:border-box;border-radius:16px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit}p{margin:0 0 8px}</style><p>SIMULATED Home Assistant form boundary</p><p>Appearance: <span></span></p><p>Native Home Assistant fields are tested in Home Assistant.</p>';
        this.shadowRoot.querySelector('span').textContent = value.house_colour_scheme;
      }
    });
    const editor = card.constructor.getConfigElement(); editor.id = 'glass-card-settings';
    document.querySelector('main').append(editor); window.glassEditorChanges = [];
    editor.addEventListener('config-changed', (event) => window.glassEditorChanges.push(structuredClone(event.detail.config)));
    editor.hass = card._hass;
  });
  for (const width of [1400, 320]) for (const scheme of ['dark', 'light', 'ha']) {
    context = `card-settings-${width}-${scheme}`;
    await page.setViewport({ width, height: width < 600 ? 980 : 1120, deviceScaleFactor: 1 });
    await page.evaluate((scheme) => {
      const editor = document.querySelector('#glass-card-settings');
      const inherited = document.querySelector('main');
      inherited.style.setProperty('--primary-text-color', '#25252a'); inherited.style.setProperty('--secondary-text-color', '#57575f');
      inherited.style.setProperty('--primary-background-color', '#efeff2'); inherited.style.setProperty('--card-background-color', '#fff');
      inherited.style.setProperty('--secondary-background-color', '#e8e8ed'); inherited.style.setProperty('--divider-color', '#d0d0d6');
      editor.setConfig({ type: 'custom:taylors3d-card', house_colour_scheme: scheme, show_bubble_bar: true,
        model: '/local/sample-house.glb', model_floors: { sample: 'ground' }, views: { sample: { label: 'Sample imported view' } } });
    }, scheme); await settle(page);
    const data = await page.evaluate(() => {
      const editor = document.querySelector('#glass-card-settings'), visible = (node) => !!node.getClientRects().length && !node.closest('[hidden]');
      const rgba = (value) => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d'); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
      const blend = (a, b) => a.slice(0, 3).map((value, i) => value * a[3] / 255 + b[i] * (1 - a[3] / 255));
      const bg = (node) => node ? [...blend(rgba(getComputedStyle(node).backgroundColor), bg(node.parentElement)), 255] : [255, 255, 255, 255];
      const lum = (v) => v.slice(0, 3).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const owned = [...editor.querySelectorAll('.bubble-control-order *,.imported-source-controls *,p')].filter(visible);
      const captions = owned.filter((node) => [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim())).map((node) => {
        const background = bg(node), foreground = blend(rgba(getComputedStyle(node).color), background), first = lum(background), second = lum(foreground);
        return { text: node.textContent.trim().slice(0, 100), ratio: (Math.max(first, second) + .05) / (Math.min(first, second) + .05) };
      });
      const buttons = owned.filter((node) => node.tagName === 'BUTTON').map((node) => { const rect = node.getBoundingClientRect(); return { text: node.textContent, width: rect.width, height: rect.height,
        background: rgba(getComputedStyle(node).backgroundColor).slice(0, 3), disabled: node.disabled, fits: node.scrollWidth <= node.clientWidth + 1 }; });
      return { scheme: editor.getAttribute('data-taylors3d-editor-scheme'), formData: editor._form.currentData.house_colour_scheme,
        background: getComputedStyle(editor).backgroundColor, controls: buttons.length, badTargets: buttons.filter((row) => row.width < 43.9 || row.height < 43.9 || !row.fits),
        selectedMonochrome: buttons.filter((row) => !row.disabled).every((row) => Math.max(...row.background) - Math.min(...row.background) < 12),
        captions: captions.length, minimumContrast: Math.min(...captions.map((row) => row.ratio)), badContrast: captions.filter((row) => row.ratio < 4.5),
        overflow: editor.scrollWidth > editor.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
        sourceControls: !!editor.querySelector('.imported-source-controls:not([hidden])'), labels: [...editor.querySelectorAll('[data-control] span')].map((node) => node.textContent) };
    });
    check(`${context}: actual card settings selects saved scheme and keeps its HA form boundary`, data.scheme === scheme && data.formData === scheme, data);
    check(`${context}: actual order and source-recovery buttons are monochrome 44px without overflow`, data.controls >= 12 && !data.badTargets.length && data.selectedMonochrome && !data.overflow && data.sourceControls, data);
    check(`${context}: settings-owned text retains 4.5:1 contrast and friendly labels`, data.captions > 10 && !data.badContrast.length
      && data.labels.every((label) => !/^\d+\. (mode|reset|section|daynight|minimap|edit)$/.test(label)), data);
    await page.focus('#glass-card-settings .bubble-control-order .down:not(:disabled)'); await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => { const node = document.activeElement; return { visible: node?.matches(':focus-visible'), outline: getComputedStyle(node).outlineStyle, width: getComputedStyle(node).outlineWidth }; });
    check(`${context}: card settings keeps visible native keyboard focus`, focus.visible && focus.outline !== 'none' && parseFloat(focus.width) >= 2, focus);
    if (scheme !== 'ha') await shot(page, `card-settings-${width}-${scheme}`);
  }
  await page.evaluate(() => { document.querySelector('#glass-card-settings').remove(); document.querySelector('taylors3d-card').style.display = ''; });
}

// Separate visual-only gallery of the repository's fuller original demo house.
// This uses its existing mock hass, not the room-actions transport above. No
// service button is pressed; only native view/reset controls are used.
async function demoHouseGallery(browser, base) {
  const { page, errors } = await newPage(browser, { width: 1400, height: 1120 });
  try {
    let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8')
      .replace(/<main>[\s\S]*?<\/main>/, '<p style="margin:16px;color:#888;font-size:13px">SIMULATED Home Assistant · original demo house · no real devices connected</p><main><section class="theme dark"><taylors3d-card></taylors3d-card></section></main>');
    if (mode === 'source') {
      html = html.replace('../dist/taylors3d-card.js', '../src/taylors3d-card.js').replace('../dist/demo.js', './demo.js');
      html = html.replace('</head>', '<script type="importmap">' + JSON.stringify({ imports: {
        three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/', '@mdi/js': '/node_modules/@mdi/js/mdi.js' } }) + '</script></head>');
    }
    await page.setRequestInterception(true);
    page.on('request', (request) => new URL(request.url()).pathname === '/demo/index.html'
      ? request.respond({ status: 200, contentType: 'text/html', body: html }) : request.continue());
    await page.goto(`${base}/demo/index.html?model=1&merge=0&height=900px`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('taylors3d-card')?._view?.model, { timeout: 30000 });
    for (const width of [1400, 390]) for (const scheme of ['dark', 'light']) {
      context = `demo-house-${width}-${scheme}`;
      await page.setViewport({ width, height: width < 600 ? 1100 : 1120, deviceScaleFactor: 1 });
      await page.evaluate(({ scheme, width }) => {
        const card = document.querySelector('taylors3d-card'), dark = scheme === 'dark';
        document.querySelector('.theme').className = 'theme ' + scheme;
        document.body.style.background = dark ? '#09090b' : '#f3f3f5';
        card.setConfig({ ...card._config, layout_style: 'house', house_colour_scheme: scheme,
          height: width < 600 ? '760px' : '900px', mini_map: true, sky_bodies: false,
          house_summary: { title: 'Taylor’s 3D · Demo house' } });
        card._setMode('3d'); card._setView('all', { instant: true });
      }, { scheme, width }); await settle(page);
      await page.locator('taylors3d-card >>> .toolbar button.reset').click(); await settle(page);
      const data = await page.evaluate(() => { const card = document.querySelector('taylors3d-card');
        return { model: !!card._view.model, mode: card._mode, style: card.getAttribute('data-taylors3d-theme'),
          sceneHeight: card._scene.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
      check(`${context}: fuller demo model is shown by the actual House 3D renderer`, data.model && data.mode === '3d' && data.style === 'house' && data.sceneHeight >= 239.9 && !data.overflow, data);
      await shot(page, `demo-house-${width}-${scheme}`);
    }
    check('fuller demo gallery has no unexpected browser errors', !errors.length, errors); browserErrors.push(...errors);
  } catch (error) { check(`exception at ${context}`, false, error.stack || String(error)); browserErrors.push(...errors); }
  finally { await page.close(); }
}

const session = await launch();
try {
  for (mode of requested ? [requested] : ['source', 'bundle']) {
    const fixture = await serveRoomActionsFixture(root, mode), { page, errors } = await newPage(session.browser, { width: 1400, height: 1120 });
    try {
      const glb = cutawaySampleGlb(), layout = sampleLayout(fixture.layout, glb.length), readings = structuredClone(fixture.readings);
      const friendly = { lamp: 'Lounge light', switch: 'Reading lamp', media: 'Music player', climate: 'Room heating', cover: 'Blinds', lock: 'Front door', vacuum: 'Robot vacuum', scene: 'Movie', script: 'Evening routine', camera: 'Garden camera' };
      for (const [key, name] of Object.entries(friendly)) readings.states[roomActionEntities[key]].attributes.friendly_name = name;
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (pathname === '/demo/room-actions-fixture.html') return request.respond({ status: 200, contentType: 'text/html', body: iconHtml(mode) });
        if (pathname === `/api/taylors3d/model/${roomActionLayoutKey}`) return request.respond({ status: 200, contentType: 'model/gltf-binary', body: glb });
        return request.continue();
      });
      await page.goto(`${fixture.base}/demo/room-actions-fixture.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.roomActionsModuleReady);
      await page.evaluate(prepareRoomActionsFixture, { layout, readings, entities: roomActionEntities, key: roomActionLayoutKey });
      await page.evaluate(() => {
        const card = document.querySelector('taylors3d-card');
        card.hass = { ...card._hass, areas: { ...card._hass.areas, 'simulated-upper': { ...card._hass.areas['simulated-upper'], name: 'Lounge' } } };
      });
      for (const style of smoke ? ['house'] : ['house', 'original', 'anchored']) for (const width of smoke ? [1400] : [1400, 390, 320]) for (const scheme of smoke ? ['dark'] : ['dark', 'light']) {
        const name = `${style}-${width}-${scheme}`;
        await configure(page, { style, width, scheme }); const initial = await audit(page, `${name} closed`);
        if (style === 'house' && width !== 320) await shot(page, `${name}-house`);
        await page.locator('taylors3d-card >>> [data-custom-controls-placement="left"] [data-custom-controls-toggle]').click(); await settle(page);
        const drawer = await audit(page, `${name} left menu`);
        check(`${name}: custom left menu overlays the same scene and camera`, sameRect(initial.scene, drawer.scene)
          && sameRect(initial.canvas, drawer.canvas) && sameCamera(initial.camera, drawer.camera));
        if (style === 'house' && width !== 320) await shot(page, `${name}-left`);
        await page.keyboard.press('Escape'); await settle(page);
        await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card._setMode('top'); }); await settle(page);
        const beforeRoom = await snapshot(page);
        const point = await page.evaluate(() => window.roomActionsFixture.roomPixel());
        await page.mouse.click(...point); await settle(page);
        const popup = await audit(page, `${name} room popup`);
        check(`${name}: room popup overlays without shrinking or moving the house`, !!popup.popup && sameRect(beforeRoom.scene, popup.scene)
          && sameRect(beforeRoom.canvas, popup.canvas) && sameCamera(beforeRoom.camera, popup.camera),
        { before: beforeRoom.scene, after: popup.scene, popup: popup.popup, cameraBefore: beforeRoom.camera, cameraAfter: popup.camera });
        if (style === 'house' && width !== 320) await shot(page, `${name}-room`);
        if (width < 600 && style !== 'anchored') {
          await page.locator('taylors3d-card >>> [data-room-sheet-mode="details"]').click(); await settle(page);
          const detailsOverflow = await page.evaluate(() => {
            const popup = document.querySelector('taylors3d-card')._devicePopup.el;
            const content = popup.querySelector('.t3d-popup-content');
            return { mode: popup.dataset.roomSheet, width: content.clientWidth, scrollWidth: content.scrollWidth,
              height: content.clientHeight, ranges: [...content.querySelectorAll('input[type="range"]')].length };
          });
          check(`${name}: Details controls scroll vertically without horizontal clipping`, detailsOverflow.mode === 'details'
            && detailsOverflow.width > 0 && detailsOverflow.height > 0 && detailsOverflow.ranges > 0
            && detailsOverflow.scrollWidth <= detailsOverflow.width + 1, detailsOverflow);
        }
        await page.evaluate(() => document.querySelector('taylors3d-card')._devicePopup.close());
        await page.focus('taylors3d-card >>> .toolbar button:not(:disabled)');
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const node = document.querySelector('taylors3d-card').shadowRoot.activeElement;
          return { tag: node?.tagName, visible: node?.matches(':focus-visible'), outline: node && getComputedStyle(node).outlineStyle, width: node && getComputedStyle(node).outlineWidth };
        });
        check(`${name}: keyboard navigation has a visible focus ring`, focus.visible && focus.outline !== 'none' && parseFloat(focus.width) >= 2, focus);
        await page.evaluate(() => document.querySelector('taylors3d-card')._toggleEdit()); await settle(page);
        for (const tab of ['rooms', 'controls', 'model', 'house']) {
          await page.evaluate((tab) => document.querySelector('taylors3d-card')._edit.revealTab(tab), tab); await settle(page);
          await audit(page, `${name} ${tab} editor`, { editor: true });
          if (style === 'house' && width !== 320 && tab === 'controls') await shot(page, `${name}-settings`);
        }
      }
      for (const style of ['house', 'original']) for (const scheme of ['dark', 'light']) {
        await configure(page, { style, scheme, width: 390, reduced: true, transparency: true });
        await audit(page, `${style}-${scheme} accessibility`, { reduced: true, transparency: true });
        await page.evaluate(() => document.querySelector('taylors3d-card')._toggleEdit()); await settle(page);
        await audit(page, `${style}-${scheme} accessibility editor`, { editor: true, reduced: true, transparency: true });
      }
      await cardEditorStage(page);
      const final = await snapshot(page);
      check('appearance audit never operates devices, saves layout or creates a second renderer', !final.calls && !final.commits && !final.writes && final.rendererSame,
        { calls: final.calls, commits: final.commits, writes: final.writes, rendererSame: final.rendererSame });
      check('no browser errors or unregistered fixture routes', !errors.length && !fixture.unexpected.length, { errors, routes: fixture.unexpected });
      browserErrors.push(...errors);
    } catch (error) { check(`exception at ${context}`, false, error.stack || String(error)); browserErrors.push(...errors); }
    finally { await page.close(); await fixture.close(); }
    if (!smoke) await demoHouseGallery(session.browser, session.base);
  }
} finally { await session.close(); }

const hash = (filename) => createHash('sha256').update(fs.readFileSync(path.join(root, filename))).digest('hex');
const runtimeAfter = runtimeFingerprint();
check('all runtime source and both frontend copies remain unchanged during this exact audit',
  JSON.stringify(runtimeBefore) === JSON.stringify(runtimeAfter), { inputs: Object.keys(runtimeBefore).length,
    changed: Object.keys(runtimeBefore).filter((name) => runtimeBefore[name] !== runtimeAfter[name]) });
const proof = { program: 'glass-theme', smoke, checks: checks.length, passed: checks.filter((row) => row.pass).length,
  failed: checks.filter((row) => !row.pass).length, browserErrors, scenarios: samples.length,
  minimumContrast: Math.min(...samples.map((sample) => sample.minimumContrast)), screenshots, samples, assertions: checks,
  themeSha256: hash('src/taylors3d-theme.js'), bundleSha256: hash('dist/taylors3d-card.js'), runtimeInputs: runtimeAfter,
  qualification: 'Actual source/bundle DOM and renderer; original simulated cutaway model, HA readings and transport. No real Home Assistant or physical device test.' };
fs.writeFileSync(path.join(output, `glass-theme-${requested || 'source-bundle'}-proof.json`), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ ...proof, samples: undefined, assertions: undefined, runtimeInputs: undefined }));
if (proof.failed || browserErrors.length) process.exitCode = 1;
