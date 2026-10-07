// Computed source/bundle visual audit of actual card/editor/popup DOM. HA data,
// model, storage and service replies are explicit simulations, not a household.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { prepareRoomActionsFixture, serveRoomActionsFixture, roomActionEntities, roomActionLayoutKey, roomActionIds } from './lib/room-actions-fixture.mjs';

const requested = process.env.VISUAL_POLISH_MODE;
if (requested !== undefined && !['source', 'bundle'].includes(requested)) throw Error('VISUAL_POLISH_MODE must be source or bundle');
const results = [], samples = [], browserErrors = [];
let mode = '', context = 'initialization';
const check = (name, pass, detail) => { results.push(!!pass); console.log(`${pass ? 'ok  ' : 'FAIL'} ${mode} ${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`); };
const settle = async (page) => { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => [...document.querySelector('taylors3d-card').shadowRoot.querySelectorAll('*')]
    .every((node) => node.getAnimations().every((animation) => !(animation instanceof CSSTransition) || ['finished', 'idle'].includes(animation.playState))), { timeout: 10000 }); };
const saveShot = async (page, name) => { fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'screenshots', name), fullPage: true }); };

async function appearance(page, name, options) {
  context = name;
  const data = await page.evaluate((options) => {
    const card = document.querySelector('taylors3d-card'), shadow = card.shadowRoot, parent = (node) => node.parentElement || node.getRootNode()?.host;
    const visible = (node) => node.getClientRects().length && !node.closest('[hidden]') && (!node.closest('details:not([open])') || node.tagName === 'SUMMARY')
      && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden';
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const painter = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (value) => { painter.clearRect(0, 0, 1, 1); painter.fillStyle = value; painter.fillRect(0, 0, 1, 1); return [...painter.getImageData(0, 0, 1, 1).data]; };
    const blend = (front, back, alpha = front[3] / 255) => [...front.slice(0, 3).map((value, index) => value * alpha + back[index] * (1 - alpha)), 255];
    const background = (node) => node ? blend(rgba(getComputedStyle(node).backgroundColor), background(parent(node))) : [255, 255, 255, 255];
    const luminance = (values) => values.slice(0, 3).map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const id = (node) => node.dataset.act || node.dataset.field || node.dataset.action || node.dataset.roomSheetMode || node.dataset.bubble || node.className || node.tagName;
    const text = (node) => node.tagName === 'INPUT' ? node.value || node.placeholder || node.getAttribute('aria-label') : node.tagName === 'SELECT' ? node.selectedOptions[0]?.textContent : node.textContent.trim();
    const opaquePlate = (node) => { for (let current = node; current && !current.classList?.contains('scene'); current = parent(current)) if (rgba(getComputedStyle(current).backgroundColor)[3] === 255 && Number(getComputedStyle(current).opacity) === 1) return true; return false; };
    const readText = (node) => {
      const css = getComputedStyle(node); let bg = background(node), fg = blend(rgba(css.color), bg);
      for (let current = node; current; current = parent(current)) {
        const opacity = Number(getComputedStyle(current).opacity);
        if (opacity < 1) { const below = background(parent(current)); fg = blend(fg, below, opacity); bg = blend(bg, below, opacity); }
      }
      const first = luminance(fg), second = luminance(bg);
      return { id: id(node), text: String(text(node) ?? '').slice(0, 140), ratio: (Math.max(first, second) + .05) / (Math.min(first, second) + .05),
        foreground: css.color, background: css.backgroundColor, compositedForeground: fg.slice(0, 3), compositedBackground: bg.slice(0, 3), opacity: css.opacity,
        disabled: node.disabled === true || !!node.closest('button:disabled,fieldset:disabled'), unbackedPlanLabel: node.classList?.contains('fp-room-label') && !opaquePlate(node) };
    };
    const scopes = [...shadow.querySelectorAll('[data-taylors3d-summary],[data-house-navigation],.toolbar,.taylors3d-device-popup,.panel,[data-custom-controls-view],[data-ui-feedback],.fp-room-label,.fp-val')].filter(visible);
    const captionNodes = new Set();
    for (const scope of scopes) for (const node of [scope, ...scope.querySelectorAll('*')]) {
      if (!visible(node) || ['STYLE', 'SCRIPT', 'OPTION', 'HA-ICON', 'SVG', 'PATH'].includes(node.tagName)) continue;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && !['checkbox', 'radio', 'range', 'color', 'file', 'hidden'].includes(node.type) || [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) captionNodes.add(node);
    }
    const readings = [...captionNodes].map(readText).filter((row) => row.text);
    const controls = [...new Set(scopes.flatMap((scope) => [...scope.querySelectorAll('button,input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]),select,textarea,summary,label.button')]))]
      .filter(visible).map((node) => { const rect = node.getBoundingClientRect(); return { id: id(node), width: rect.width, height: rect.height, disabled: node.disabled,
        fits: node.scrollWidth <= node.clientWidth + 1, transition: getComputedStyle(node).transitionDuration }; });
    const markers = [...shadow.querySelectorAll('.fp-marker .fp-dot')].filter(visible).map((node) => {
      const rect = node.getBoundingClientRect(), owner = [...card._view.markerObjects.values()].find((entry) => entry.obj.element === node.closest('.fp-marker'));
      const projected = owner && card._view.projectWorld(owner.obj.getWorldPosition(owner.obj.position.clone()), owner.floorId);
      return { width: rect.width, height: rect.height, centreError: projected ? Math.hypot(rect.x + rect.width / 2 - projected[0], rect.y + rect.height / 2 - projected[1]) : null };
    });
    const transitions = [...shadow.querySelectorAll('.toolbar *,.panel *,.taylors3d-device-popup *,[data-custom-controls-view] *,.fp-dot')].filter(visible)
      .filter((node) => getComputedStyle(node).transitionDuration.split(',').some((value) => parseFloat(value) > 0)).map((node) => ({ id: id(node), duration: getComputedStyle(node).transitionDuration }));
    const box = (node) => { const rect = node?.getBoundingClientRect(); return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
    const hostCSS = getComputedStyle(card), selectedNav = shadow.querySelector('[data-house-navigation] [aria-pressed="true"]'), selectedFloor = shadow.querySelector('.toolbar [data-taylors3d-tone="floor"][aria-pressed="true"]');
    const samePaint = (node, variable) => !node || rgba(getComputedStyle(node).backgroundColor).every((channel, index) => channel === rgba(hostCSS.getPropertyValue(variable))[index]);
    return { readings: readings.length, minimum: Math.min(...readings.map((row) => row.ratio)), badContrast: readings.filter((row) => row.ratio < 4.5 || row.unbackedPlanLabel),
      controls: controls.length, badTargets: controls.filter((row) => row.width < 43.9 || row.height < 43.9), badLabels: controls.filter((row) => !row.fits), markers,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, panelOverflow: card._editing && card._edit.panel.scrollWidth > card._edit.panel.clientWidth + 1,
      scene: box(card._scene), body: box(card._editing ? shadow.querySelector('.tab-body') : null), popup: box(card._devicePopup.isOpen ? card._devicePopup.el : null),
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, transitions: options.reduced ? transitions : [],
      brand: { amber: hostCSS.getPropertyValue('--taylors3d-ui-amber').trim(), teal: hostCSS.getPropertyValue('--taylors3d-ui-teal').trim(),
        background: hostCSS.getPropertyValue('--taylors3d-ui-background').trim(), floorUsesAmber: samePaint(selectedFloor, '--taylors3d-ui-amber'), navUsesTeal: samePaint(selectedNav, '--taylors3d-ui-teal') },
      renderer: card._view.renderer === window.roomActionsFixture.renderer, calls: window.roomActionsFixture.calls.length, commits: window.roomActionsFixture.commits,
      feedback: { present: !!shadow.querySelector('[data-ui-feedback]'), snapshot: card._feedback?.snapshot(),
        rows: [...shadow.querySelectorAll('[data-ui-feedback] [data-feedback-kind]')].filter(visible).map((node) => ({ kind: node.dataset.feedbackKind, status: node.dataset.status,
          message: node.querySelector('.ui-feedback-message')?.textContent, detail: node.querySelector('.ui-feedback-detail:not([hidden])')?.textContent,
          dismiss: !node.querySelector('button')?.hidden })) } };
  }, options);
  check(`${name}: actual captions including disabled controls reach4.5:1 text contrast`, data.readings >= 8 && !data.badContrast.length, { count: data.readings, minimum: data.minimum, failed: data.badContrast });
  check(`${name}:44px native controls and unclipped labels fit without horizontal overflow`, data.controls > 0 && !data.badTargets.length && !data.badLabels.length && !data.pageOverflow && !data.panelOverflow,
    { controls: data.controls, targets: data.badTargets, labels: data.badLabels, pageOverflow: data.pageOverflow, panelOverflow: data.panelOverflow });
  check(`${name}: actual source renderer and240px scene remain available`, data.renderer && data.scene?.height >= 239.9, data.scene);
  if (options.editor) check(`${name}: the actual editor retains240px usable form space`, data.body?.height >= 239.9, data.body);
  if (!options.editor) check(`${name}: House marker targets remain44px around their original source centres`, data.markers.length > 0
    && data.markers.every((row) => row.width >= 43.9 && row.height >= 43.9 && row.centreError !== null && row.centreError < .75), data.markers);
  check(`${name}: floor/lighting amber and active navigation teal use the supplied current tokens`, data.brand.floorUsesAmber && data.brand.navUsesTeal, data.brand);
  if (options.reduced) check(`${name}: reduced motion stops decorative UI transitions`, data.reduced && !data.transitions.length, data.transitions);
  if (options.feedback) check(`${name}: the actual feedback strip shows each required current status`, data.feedback.present
    && options.feedback.every((expected) => data.feedback.rows.some((row) => row.kind === expected.kind && row.status === expected.status && row.message
      && (expected.detail !== true || row.detail))), data.feedback);
  samples.push({ mode, name, ...data }); return data;
}

// Read-only visual state simulation through the actual feedback controller.
// No save, action dispatcher or device command is invoked to produce a caption.
const feedbackCases = [
  { id: 'unsaved', rows: [{ kind: 'save', status: 'unsaved' }] },
  { id: 'saving', rows: [{ kind: 'save', status: 'saving' }] },
  { id: 'saved', rows: [{ kind: 'save', status: 'saved' }] },
  { id: 'save-failed', rows: [{ kind: 'save', status: 'failed' }] },
  { id: 'action-pending', rows: [{ kind: 'action', status: 'pending' }] },
  { id: 'action-requested', rows: [{ kind: 'action', status: 'requested' }] },
  { id: 'action-failed', rows: [{ kind: 'action', status: 'failed' }] },
  { id: 'offline', rows: [{ kind: 'connection', status: 'offline' }] },
  { id: 'reconnected', rows: [{ kind: 'connection', status: 'reconnected' }] },
  { id: 'combined', rows: [{ kind: 'connection', status: 'reconnected' }, { kind: 'save', status: 'unsaved', detail: true }, { kind: 'action', status: 'failed' }] },
];
async function feedbackState(page, id) {
  await page.evaluate((id) => {
    const card = document.querySelector('taylors3d-card'), feedback = card._feedback;
    if (!feedback || !card._feedbackView) throw Error('Actual integrated feedback is missing');
    card._hass.connection.connected = true; card.hass = { ...card._hass };
    feedback.setDirty(false); feedback.setSaveState('idle'); feedback.dismiss('action'); feedback.dismiss('connection');
    if (id === 'offline' || id === 'reconnected' || id === 'combined') {
      card._hass.connection.connected = false; card.hass = { ...card._hass };
      if (id !== 'offline') { card._hass.connection.connected = true; card.hass = { ...card._hass }; }
    }
    if (id === 'unsaved') feedback.setDirty(true);
    if (['saving', 'saved', 'save-failed', 'combined'].includes(id)) {
      const token = feedback.setSaveState('saving');
      if (id !== 'saving') feedback.setSaveState(id === 'saved' ? 'saved' : 'failed', token);
      if (id === 'combined') feedback.setDirty(true);
    }
    if (id.startsWith('action-') || id === 'combined') {
      const token = feedback.beginAction({ id: 'visual-fixture', label: 'Simulated action' });
      if (id === 'action-requested') feedback.actionRequested(token);
      if (id === 'action-failed' || id === 'combined') feedback.actionFailed(token);
    }
  }, id); await settle(page);
}

const session = await launch();
try {
  for (mode of requested ? [requested] : ['source', 'bundle']) {
    const fixture = await serveRoomActionsFixture(root, mode), { page, errors } = await newPage(session.browser, { width: 1400, height: 1100 });
    try {
      const layout = structuredClone(fixture.layout);
      layout.model.known = { levels: [roomActionIds.ground, roomActionIds.upper, roomActionIds.background], rooms: [roomActionIds.groundRoom, roomActionIds.upperRoom] };
      layout.custom_controls = { version: 1, bars: [{ id: 'favourites', label: 'Simulated favourites', placement: 'bottom', style: 'pills', dock: { limit: 4 }, buttons: [
        { id: 'lamp', label: 'Simulated lamp', icon: 'mdi:lightbulb', color: 'amber', pinned: true, action: { type: 'toggle', entity: roomActionEntities.lamp } },
        { id: 'scene', label: 'Simulated movie', icon: 'mdi:movie', color: 'teal', pinned: true, action: { type: 'scene', entity: roomActionEntities.scene } },
        { id: 'view', label: 'Simulated view', icon: 'mdi:home', color: 'theme', pinned: true, action: { type: 'view', view_id: 'upper' } },
        { id: 'missing', label: 'Missing source', icon: 'mdi:help-circle', color: 'theme', action: { type: 'scene', entity: 'scene.missing' } } ] }] };
      await page.goto(`${fixture.base}/demo/room-actions-fixture.html`, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.roomActionsModuleReady);
      await page.evaluate(prepareRoomActionsFixture, { layout, readings: fixture.readings, entities: roomActionEntities, key: roomActionLayoutKey }); await settle(page);
      for (const reduced of [false, true]) for (const width of [1400, 320]) for (const scheme of ['dark', 'light', 'ha']) for (const locale of ['en', 'de', 'fr', 'es']) {
        const name = `${width}px ${scheme} ${locale} ${reduced ? 'reduced' : 'normal'}`;
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]); await page.setViewport({ width, height: width === 320 ? 900 : 1100, deviceScaleFactor: 1 });
        await page.evaluate(({ scheme, locale, width }) => {
          const card = document.querySelector('taylors3d-card'); if (card._editing) card._toggleEdit(); card._devicePopup.close();
          const haDark = scheme === 'ha' && width === 320;
          for (const [key, value] of Object.entries(haDark ? { 'primary-background-color': '#131a21', 'card-background-color': '#1d2731', 'secondary-background-color': '#253340', 'primary-text-color': '#f2f5f7', 'secondary-text-color': '#bcc7cf' }
            : { 'primary-background-color': '#eef2f5', 'card-background-color': '#fff', 'secondary-background-color': '#e8eef2', 'primary-text-color': '#1c2a35', 'secondary-text-color': '#4b5e6b' })) card.style.setProperty(`--${key}`, value);
          card.setConfig({ ...card._config, house_colour_scheme: scheme, height: width === 320 ? '520px' : '900px' });
          card.hass = { ...card._hass, language: locale, locale: { ...card._hass.locale, language: locale }, themes: { darkMode: haDark } }; card._setView('upper', { instant: true }); card._setMode('top');
        }, { scheme, locale, width }); await settle(page);
        await appearance(page, `${name} house`, { reduced });
        await page.locator('taylors3d-card >>> [data-custom-controls-more="favourites"]').click(); await settle(page);
        const expanded = await page.evaluate(() => { const more = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-custom-controls-more="favourites"]'); return more?.getAttribute('aria-expanded') === 'true'; });
        check(`${name}: actual compact dock opens its saved overflow without a device action`, expanded);
        await appearance(page, `${name} expanded compact dock`, { reduced });
        await page.locator('taylors3d-card >>> [data-custom-controls-more="favourites"]').click(); await settle(page);
        await page.evaluate(() => { const card = document.querySelector('taylors3d-card'), point = window.roomActionsFixture.roomPixel(); card._openRoomAt(...point); }); await settle(page);
        await appearance(page, `${name} room`, { reduced });
        if (locale === 'en' && !reduced) await saveShot(page, `visual-polish-${mode}-${width}-${scheme}-room.png`);
        await page.evaluate(() => document.querySelector('taylors3d-card')._devicePopup.close());
        for (const state of feedbackCases) {
          await feedbackState(page, state.id);
          await appearance(page, `${name} ${state.id} feedback`, { reduced, feedback: state.rows });
        }
        if (locale === 'en' && !reduced) await saveShot(page, `visual-polish-${mode}-${width}-${scheme}-feedback.png`);
        await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card._hass.connection.connected = true; card.hass = { ...card._hass };
          card._feedback.setDirty(false); card._feedback.setSaveState('idle'); card._feedback.dismiss('action'); card._feedback.dismiss('connection'); });
        await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card._devicePopup.close(); card._toggleEdit(); }); await settle(page);
        for (const tab of ['rooms', 'controls', 'model', 'tracking', 'house']) {
          await page.evaluate((tab) => document.querySelector('taylors3d-card')._edit.revealTab(tab), tab); await settle(page);
          await appearance(page, `${name} ${tab} editor`, { reduced, editor: true });
        }
        if (locale === 'en' && !reduced) await saveShot(page, `visual-polish-${mode}-${width}-${scheme}-editor.png`);
      }
      const counts = await page.evaluate(() => ({ calls: window.roomActionsFixture.calls.length, commits: window.roomActionsFixture.commits,
        writes: window.roomActionsFixture.ws.filter((message) => message.type === 'taylors3d/layout/set').length, renderer: document.querySelector('taylors3d-card')._view.renderer === window.roomActionsFixture.renderer }));
      check('visual audit never operates devices, saves layout or creates a renderer', !counts.calls && !counts.commits && !counts.writes && counts.renderer, counts);
      check('no browser errors or unregistered fixture routes', !errors.length && !fixture.unexpected.length, { errors, routes: fixture.unexpected }); browserErrors.push(...errors);
    } catch (error) { check(`exception at ${context}`, false, error.stack || String(error)); browserErrors.push(...errors); }
    finally { await page.close(); await fixture.close(); }
  }
} finally { await session.close(); }
const proof = { program: 'visual-polish', checks: results.length, passed: results.filter(Boolean).length, failed: results.filter((pass) => !pass).length, browserErrors,
  scenarios: samples.length, minimum: Math.min(...samples.map((sample) => sample.minimum)), samples,
  themeSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'src/taylors3d-theme.js'))).digest('hex'),
  bundleSha256: fs.existsSync(path.join(root, 'dist/taylors3d-card.js')) ? createHash('sha256').update(fs.readFileSync(path.join(root, 'dist/taylors3d-card.js'))).digest('hex') : null };
fs.writeFileSync(path.join(root, 'screenshots', `visual-polish-${requested || 'source-bundle'}-proof.json`), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ ...proof, samples: undefined }));
if (results.some((pass) => !pass) || browserErrors.length) process.exitCode = 1;
