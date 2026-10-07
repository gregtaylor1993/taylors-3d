import { revealEditorTab } from './lib/editor-tab-navigation.mjs';
// Actual source/bundle card, EditMode, clients and native file/gesture controls.
// Only official HA WS/HTTP replies are simulated. This does not prove Linux HA
// authentication, ZIP inspection, asset publication, durability or saved config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dashboardBackupFixture, dashboardBackupEnvironmentFixture, serveDashboardBackupFixture, stagedDashboardBackup } from './lib/dashboard-backup-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const checks = [], errors = [], shots = path.join(root, 'screenshots');
let label = '', context = 'initialization';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, pass, detail) => { checks.push(!!pass); console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`); };
const field = (name) => `[data-field="dashboard-backup-${name}"]`;
const action = (name) => `[data-act="dashboard-backup-${name}"]`;
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.backupFixture, e = c?._edit?._dashboardBackupEditor;
    const section = c?.shadowRoot.querySelector('[data-dashboard-backup-editor]');
    return { editing: c?._editing, tab: c?._edit?.tab, busy: e?.busy, canRead: e?.canRead, canRestore: e?.canRestore,
      message: e?.message, file: e?.file?.name, namespace: e?.namespace, reviewed: e?.reviewed, partial: e?.partial,
      collection: e?.collection && { dashboard: e.collection.dashboard, cards: e.collection.cards, layout_keys: e.collection.layout_keys,
        source: e.collection.source, resources: e.collection.resources, ready: e.collection.collectionReady },
      complete: e?.complete, blob: e?.blob?.size, inspectToken: !!e?.inspectToken, stageToken: !!e?.stageToken,
      stage: e?.stage, publication: e?.publication, layout: structuredClone(c?._layout), history: c?._history?.size,
      environment: structuredClone(e?.environmentReport), archiveReport: structuredClone(e?.inspection?.report),
      environmentText: section?.querySelector('[data-dashboard-backup-environment]')?.textContent,
      archiveText: section?.querySelector('[data-dashboard-backup-static]')?.textContent,
      calls: structuredClone(f?.ws ?? []), services: f?.services.length, commits: f?.commits,
      creates: structuredClone(f?.creates ?? []), saves: structuredClone(f?.saves ?? []),
      activeField: c?.shadowRoot.activeElement?.dataset?.field, controls: section ? [...section.querySelectorAll('button')].map((b) => [b.dataset.act, b.disabled]) : [],
      staticText: section?.querySelector('[data-dashboard-backup-config]')?.textContent,
      staticEscaped: !section?.querySelector('script,img,untrusted-backup-native'), injected: window.backupInjected || 0,
      untrustedConstructed: window.backupUntrustedConstructed || 0,
      createdLink: section?.querySelector('[data-dashboard-backup-created]')?.getAttribute('href'),
      sameRenderer: c?._view?.renderer === f?.renderer, webglContexts: window.backupContexts?.size };
  });
}

async function wait(page, predicate, detail = '') {
  try { await page.waitForFunction(predicate, { polling: 50, timeout: 12000 }); }
  catch (error) { error.message += `; ${context}; ${detail}; ${JSON.stringify(await snapshot(page).catch(() => null))}`; throw error; }
}
async function idle(page) {
  await wait(page, () => { const c = document.querySelector('taylors3d-card'); return !!c?._edit?._dashboardBackupEditor && !c._loading && !c._edit._dashboardBackupEditor.busy; });
  await settle(page);
}
async function control(page, selector, callback) {
  await revealEditorTab(page, selector);
  context = `native ${selector}`;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try { const node = handle.asElement(); if (!node) throw new Error('Missing native control ' + selector);
    await node.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await callback(node);
  } finally { await handle.dispose(); } await settle(page);
}
const click = (page, selector) => control(page, selector, (node) => node.click());
const select = (page, name, value) => control(page, field(name), (node) => node.select(value));
async function type(page, name, value) {
  await control(page, field(name), async (node) => { await node.focus(); await page.keyboard.down('Control');
    try { await page.keyboard.press('KeyA'); } finally { await page.keyboard.up('Control'); }
    await page.keyboard.press('Backspace'); await page.keyboard.type(value);
  });
}
async function checked(page, name, value = true) {
  const current = await page.evaluate((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector).checked, field(name));
  if (current !== value) await click(page, field(name));
}
async function upload(page, file) { await control(page, field('file'), (node) => node.uploadFile(file)); }
async function shot(page, filename) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, filename), fullPage: true }); }

async function open(mode, options = {}) {
  const { launch, newPage } = await import('./lib/demo-browser.mjs');
  const transport = await launch(), server = await serveDashboardBackupFixture(root, mode, options); let session;
  const remoteRequests = [];
  try {
    session = await newPage(transport.browser, { width: 1320, height: 1100, isMobile: true, hasTouch: true }); const { page } = session;
    page.on('request', (request) => { const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') remoteRequests.push(request.url());
    });
    await page.evaluateOnNewDocument(() => {
      window.backupContexts = new Set(); const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const result = getContext.call(this, kind, ...args);
        if (result && /^webgl/.test(kind)) window.backupContexts.add(this); return result;
      };
    });
    await page.goto(`${server.base}/demo/dashboard-backup-fixture.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, () => window.backupModuleReady); await page.bringToFront();
    await page.evaluate(async (fixture) => {
      const c = document.querySelector('taylors3d-card'), clone = (v) => structuredClone(v);
      const connection = Object.assign(new EventTarget(), { connected: true, options: { auth: {} } });
      const f = window.backupFixture = { ws: [], services: [], creates: [], saves: [], commits: 0, behavior: 'normal',
        dashboards: [{ id: 'original-dashboard-id', url_path: fixture.sourcePath, mode: 'storage', title: 'Exact simulated source' }],
        configs: { [fixture.sourcePath]: clone(fixture.dashboard) }, original: clone(fixture.dashboard) };
      const hass = { user: { id: 'simulated-backup-user', is_admin: true, is_active: true }, auth: {}, connection,
        locale: { language: 'en', number_format: 'language' }, language: 'en', themes: { darkMode: false },
        config: { location_name: 'Simulated backup bench', time_zone: 'Europe/London', latitude: null, longitude: null },
        states: { 'sensor.actual': { state: '1', attributes: { friendly_name: 'Unrelated simulated reading' } } },
        floors: { ground: { floor_id: 'ground', name: 'Source ground', level: 0 } }, areas: {}, entities: {}, devices: {}, services: {},
        ...clone(fixture.target ?? {}),
        callService: (...args) => { f.services.push(args); return Promise.resolve(); },
        callWS: async (message) => {
          f.ws.push(clone(message));
          if (message.type === 'taylors3d/layout/get') return { layout: clone(fixture.layout) };
          if (message.type === 'frontend/get_user_data') return { value: null };
          if (message.type === 'lovelace/dashboards/list') return clone(f.dashboards);
          if (message.type === 'lovelace/resources') return clone(fixture.resources.items);
          if (message.type === 'lovelace/info') return { resource_mode: 'storage', extension: 'unknown info preserved' };
          if (message.type === 'lovelace/config') {
            if (message.url_path === null) return clone(fixture.dashboard);
            if (Object.hasOwn(f.configs, message.url_path)) return clone(f.configs[message.url_path]);
            throw { code: 'config_not_found', message: 'Simulated fresh dashboard has no configuration yet' };
          }
          if (message.type === 'lovelace/dashboards/create') {
            const row = { ...clone(message), id: `created-${f.creates.length + 1}` }; delete row.type;
            f.creates.push(clone(message)); f.dashboards.push(row);
            if (f.behavior === 'creation-uncertain') throw { code: 'connection_lost', message: 'Simulated acknowledgment lost after creation' };
            return clone(row);
          }
          if (message.type === 'lovelace/config/save') {
            f.saves.push(clone(message)); f.configs[message.url_path] = clone(message.config);
            if (f.behavior === 'save-uncertain') throw { code: 'connection_lost', message: 'Simulated save acknowledgment lost' };
            return null;
          }
          throw { code: 'unknown_command', message: 'Unexpected simulated WS command ' + message.type };
        },
        fetchWithAuth: (url, options = {}) => fetch(url, { ...options,
          headers: { ...options.headers, authorization: 'Bearer simulated-dashboard-backup' } }) };
      c.setConfig({ height: '820px', layout_key: 'home', view: 'top', floor: 'all', control_panel: 'right', mini_map: true,
        layout_style: 'house', house_colour_scheme: 'light', sky_bodies: false, scene_previews: { enabled: false }, ambient_idle: { enabled: false } });
      c.hass = hass; await c._layoutReady;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      f.renderer = c._view.renderer; f.originalLayout = clone(c._layout); f.originalConfig = clone(c._config); f.history = c._history.size;
      const commit = c._commit.bind(c); c._commit = (...args) => { f.commits++; return commit(...args); };
      f.ws.length = 0; f.services.length = 0;
      f.push = (change = {}) => { c.hass = { ...c._hass, ...change, states: { ...c._hass.states,
        'sensor.actual': { state: String(Number(c._hass.states['sensor.actual']?.state || 0) + 1), attributes: { friendly_name: 'Unrelated simulated reading' } } } }; };
      f.pulse = (kind) => {
        if (kind === 'role') { const user = c._hass.user; f.push({ user: { ...user, is_admin: false } }); f.push({ user }); }
        else if (kind === 'connection') { connection.connected = false; f.push(); connection.connected = true; f.push(); }
        else if (kind === 'source') { const config = c._config; c.setConfig({ ...config, backup_fixture_revision: 'changed' }); c.setConfig(config);
          // This probe deliberately changes actual card settings, which have
          // their own history. Backup must not add any history beyond that.
          f.history = c._history.size;
        }
        else throw new Error('Unknown native intent fixture');
      };
    }, { sourcePath: server.fixture.sourcePath, dashboard: server.fixture.dashboard, layout: server.fixture.layout, resources: server.fixture.resources,
      target: server.fixture.target });
    await click(page, '[data-bubble="edit"]'); await click(page, '[data-act="tab"][data-id="data"]'); await idle(page);
    return { ...transport, ...session, server, remoteRequests, close: async () => { await transport.close(); await server.close(); } };
  } catch (error) { errors.push(...(session?.errors || [])); await transport.close(); await server.close(); throw error; }
}

async function collectAndExport(session) {
  const { page, server } = session;
  let data = await snapshot(page);
  check('entering Data preserves legacy Single-layout JSON beside full-dashboard controls', await page.evaluate(() => {
    const panel = document.querySelector('taylors3d-card')._edit.panel;
    return !!panel.querySelector('[data-act="export"]') && !!panel.querySelector('[data-field="import"]')
      && panel.textContent.includes('Single-layout JSON') && panel.textContent.includes('Full dashboard backup');
  }));
  check('entry makes no backup/network/service/layout write', data.calls.length === 0 && server.state.exports.length === 0
    && server.state.inspections.length === 0 && data.services === 0 && data.commits === 0, data.calls);
  await click(page, action('list')); await idle(page);
  await select(page, 'dashboard', 'path:' + server.fixture.sourcePath); await click(page, action('read')); await idle(page);
  data = await snapshot(page);
  check('explicit selected dashboard reads force:true at its exact path', data.calls.some((m) => m.type === 'lovelace/config' && m.force === true && m.url_path === server.fixture.sourcePath));
  check('collection preserves whole nested other cards, raw IDs and unknown fields', equal(data.collection?.dashboard, server.fixture.dashboard));
  check('nested Taylor pointers and shared layout key are exact/deduplicated', equal(data.collection?.cards, server.fixture.pointers.map((pointer) => ({ pointer, layout_key: 'home' }))) && equal(data.collection?.layout_keys, ['home']), data.collection?.cards);
  check('preview is escaped static text; hostile raw card is never instantiated or fetched', data.staticEscaped && data.injected === 0
    && data.untrustedConstructed === 0 && data.staticText?.includes('<img') && server.state.unexpected.length === 0);
  await click(page, action('export')); await idle(page); data = await snapshot(page);
  const payload = server.state.exports.at(-1);
  check('export sends full exact raw dashboard/resources plus only referenced shared key', equal(payload?.dashboard, server.fixture.dashboard)
    && equal(payload.resources, server.fixture.resources) && equal(payload.shared_keys, ['home']) && equal(payload.layouts, {})
    && payload.source.url_path === server.fixture.sourcePath && payload.source.mode === 'storage');
  check('admin export inspection receives exact ZIP bytes/hash and does not prepare/create automatically', server.state.inspections.at(-1)?.exact
    && server.state.inspections.at(-1)?.sha256 === server.fixture.archiveSha256 && data.inspectToken && !data.stageToken && data.creates.length === 0 && server.state.stages.length === 0);
  check('external dependency remains declared/unfetched and incomplete download needs acknowledgment', data.complete === false
    && data.controls.find(([id]) => id === 'dashboard-backup-download')?.[1] === true && server.state.unexpected.length === 0);
  const blobSize = await page.evaluate(() => document.querySelector('taylors3d-card')._edit._dashboardBackupEditor.blob.size);
  const digest = await page.evaluate(async () => { const bytes = await document.querySelector('taylors3d-card')._edit._dashboardBackupEditor.blob.arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => b.toString(16).padStart(2, '0')).join(''); });
  check('actual downloaded Blob has exact fixture bytes', blobSize === server.fixture.archive.length && digest === server.fixture.archiveSha256);
  await checked(page, 'partial');
  check('deliberate incomplete acknowledgment unlocks download without device or publication calls', !(await snapshot(page)).controls.find(([id]) => id === 'dashboard-backup-download')?.[1]
    && data.services === 0 && data.creates.length === 0);
  const mode = label.startsWith('source') ? 'source' : 'bundle', directory = path.join(shots, `dashboard-backup-download-${mode}`);
  fs.mkdirSync(directory, { recursive: true }); const filename = path.join(directory, 'taylors3d-dashboard-backup.zip');
  if (fs.existsSync(filename)) fs.unlinkSync(filename);
  const cdp = await page.createCDPSession();
  try {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
    await click(page, action('download'));
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(filename) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    const bytes = fs.existsSync(filename) ? fs.readFileSync(filename) : null;
    check('deliberate native Download writes exactly the original binary ZIP/hash', !!bytes && bytes.equals(server.fixture.archive)
      && createHash('sha256').update(bytes).digest('hex') === server.fixture.archiveSha256, { bytes: bytes?.length });
  } finally { await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {}); await cdp.detach(); }
}

async function nativeFileAndPrepare(session, file, namespace) {
  const { page, server } = session;
  const before = await snapshot(page), inspectionsBefore = server.state.inspections.length, stagesBefore = server.state.stages.length;
  await click(page, action('cancel')); await upload(page, file);
  let data = await snapshot(page);
  check('native ZIP selection itself sends no inspect/stage/create', data.file === path.basename(file) && !data.inspectToken && !data.stageToken
    && data.creates.length === before.creates.length && server.state.inspections.length === inspectionsBefore && server.state.stages.length === stagesBefore);
  await click(page, action('inspect')); await idle(page);
  await type(page, 'namespace', namespace);
  const retained = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), root = c.shadowRoot;
    window.backupRetained = { file: root.querySelector('[data-field="dashboard-backup-file"]'), input: root.querySelector('[data-field="dashboard-backup-namespace"]'),
      summary: root.querySelector('[data-dashboard-backup-static] summary'), section: root.querySelector('[data-dashboard-backup-editor]') };
    return window.backupRetained.file.files[0]?.name;
  });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.backupFixture.push(); c._edit.afterUpdate(); c._edit.render(); });
  check('unchanged actual HA setter/redraw retains file selection, typed text and native focused node', await page.evaluate((namespace) => {
    const c = document.querySelector('taylors3d-card'), r = window.backupRetained;
    return c.shadowRoot.querySelector('[data-field="dashboard-backup-file"]') === r.file && r.file.files[0]?.name
      && c.shadowRoot.querySelector('[data-field="dashboard-backup-namespace"]') === r.input && r.input.value === namespace
      && c.shadowRoot.activeElement === r.input && c.shadowRoot.querySelector('[data-dashboard-backup-editor]') === r.section;
  }, namespace), retained);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.backupRetained.summary.focus(); window.backupFixture.push(); c._edit.afterUpdate(); });
  check('unchanged HA update retains focused static summary rather than reconstructing preview', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); return c.shadowRoot.activeElement === window.backupRetained.summary
      && c.shadowRoot.querySelector('[data-dashboard-backup-static] summary') === window.backupRetained.summary;
  }));
  data = await snapshot(page);
  check('incomplete archive cannot prepare before explicit review/acknowledgment', data.controls.find(([id]) => id === 'dashboard-backup-prepare')?.[1] === true);
  await checked(page, 'reviewed'); await checked(page, 'partial'); await click(page, action('prepare')); await idle(page);
  data = await snapshot(page);
  check('Prepare uploads same selected ZIP under exact new namespace and explicit incomplete query', server.state.stages.at(-1)?.namespace === namespace
    && server.state.stages.at(-1)?.allow === '1' && server.state.stages.at(-1)?.exact && server.state.stages.at(-1)?.sha256 === server.fixture.archiveSha256);
  check('Prepare returns fresh shared key but creates no dashboard or resources', data.stageToken && data.stage.target_dashboard.url_path === 'taylors3d-restore-' + namespace
    && data.stage.report.collision_targets.layout_keys.every((key) => key.startsWith('restore_' + namespace + '_') && key.length <= 64)
    && data.stage.staging.dashboard_created === false && data.stage.staging.layouts_persistence === 'scheduled_not_durable'
    && data.creates.length === before.creates.length && data.saves.length === before.saves.length
    && !data.calls.some((m) => m.type === 'lovelace/resources/create'), data.stage?.report);
  return data;
}

async function publish(session, file) {
  const { page, server } = session, before = await snapshot(page);
  await nativeFileAndPrepare(session, file, 'nativecopy');
  const prepared = await snapshot(page), createsBefore = prepared.creates.length, savesBefore = prepared.saves.length;
  await click(page, action('create')); await idle(page); const data = await snapshot(page), target = 'taylors3d-restore-nativecopy';
  check('separate deliberate Create makes one NEW exact storage dashboard and one save', data.creates.length === createsBefore + 1
    && data.saves.length === savesBefore + 1 && data.creates.at(-1).url_path === target && data.creates.at(-1).mode === 'storage'
    && equal(data.saves.at(-1), { type: 'lovelace/config/save', url_path: target, config: prepared.stage.save_message.config }));
  const sequence = data.calls.slice(prepared.calls.length).map((m) => [m.type, m.url_path ?? null]);
  check('publication performs fresh list, create, ownership re-list, config_not_found preflight, then save', equal(sequence,
    [['lovelace/dashboards/list', null], ['lovelace/dashboards/create', target], ['lovelace/dashboards/list', null], ['lovelace/config', target], ['lovelace/config/save', target]]), sequence);
  check('publication preserves other raw cards/entity IDs; only exact Taylor layout keys change', equal(data.saves.at(-1)?.config.views[0].cards.slice(1), server.fixture.dashboard.views[0].cards.slice(1))
    && data.saves.at(-1)?.config.views[1].sections[0].cards[0].card.original_entity === undefined
    && equal(data.saves.at(-1)?.config.extension, server.fixture.dashboard.extension));
  check('created-dashboard link is exact and current card layout/history/services remain unchanged', data.createdLink === '/' + target
    && equal(data.layout, before.layout) && data.history === before.history && data.commits === 0 && data.services === 0
    && data.sameRenderer && data.webglContexts === 1, { link: data.createdLink, commits: data.commits, services: data.services, contexts: data.webglContexts });
  check('old selected dashboard remains byte-equivalent in simulated official store', await page.evaluate((original) => JSON.stringify(window.backupFixture.configs['dashboard-native-source']) === JSON.stringify(original), server.fixture.dashboard));
  await shot(page, `dashboard-backup-${label.startsWith('source') ? 'source' : 'bundle'}-new-dashboard.png`);
}

async function gestureWithLoss(page, selector, gesture, loss) {
  context = `native ${gesture} ${selector} with observed ${loss} loss/recovery`;
  await control(page, selector, async (node) => {
    await node.focus();
    if (gesture === 'Enter') {
      // Chrome activates Enter on keydown. A target listener runs after the
      // editor capture has recorded intent and before native default click.
      await node.evaluate((button, loss) => button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') window.backupFixture.pulse(loss);
      }, { once: true }), loss);
      await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
    } else if (gesture === 'Space') {
      await page.keyboard.down('Space'); await page.evaluate((loss) => window.backupFixture.pulse(loss), loss); await page.keyboard.up('Space');
    } else {
      const box = await node.boundingBox(); if (!box) throw new Error('Held action has no actual native box');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.evaluate((loss) => window.backupFixture.pulse(loss), loss); await page.mouse.up();
    }
  }); await idle(page);
}

async function heldIntent(session, gesture, loss) {
  const { page, server } = session; await click(page, action('cancel'));
  const before = server.state.exports.length;
  await gestureWithLoss(page, action('export'), gesture, loss);
  check(`${gesture} observed ${loss} loss/recovery sends zero from stale native intent`, server.state.exports.length === before, await snapshot(page));
  await click(page, action('export')); await idle(page);
  check(`${gesture} after ${loss} recovery requires one fresh deliberate action`, server.state.exports.length === before + 1);
}

async function heldPublication(session, file, gesture, loss) {
  const { page } = session, suffix = gesture.toLowerCase();
  await nativeFileAndPrepare(session, file, `guard-${suffix}`);
  const before = await snapshot(page);
  await gestureWithLoss(page, action('create'), gesture, loss); const data = await snapshot(page);
  check(`held ${gesture} Create with ${loss} loss/recovery cannot publish the old prepared copy`, data.creates.length === before.creates.length
    && data.saves.length === before.saves.length && !data.stageToken && data.controls.find(([id]) => id === 'dashboard-backup-create')?.[1] === true);
  // Prepared files may remain. Reinspection deliberately chooses a fresh
  // namespace rather than retrying/overwriting the old uncertain staging key.
  await nativeFileAndPrepare(session, file, `fresh-${suffix}`); await click(page, action('create')); await idle(page);
  const fresh = await snapshot(page);
  check(`held ${gesture} after ${loss} requires fresh review/preparation and one deliberate new publication`, fresh.creates.length === before.creates.length + 1
    && fresh.saves.length === before.saves.length + 1 && fresh.creates.at(-1).url_path === `taylors3d-restore-fresh-${suffix}`);
}

async function permissionsAndLimits(session, file, largeFile) {
  const { page, server } = session;
  await click(page, action('cancel')); const before = server.state.exports.length, inspections = server.state.inspections.length;
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.backupFixture.push({ user: { ...c._hass.user, is_admin: false } }); });
  const reader = await snapshot(page);
  check('reader can export permitted dashboard while native restore/file fields are admin-disabled', reader.canRead && !reader.canRestore
    && reader.controls.find(([id]) => id === 'dashboard-backup-export')?.[1] === false && reader.controls.find(([id]) => id === 'dashboard-backup-inspect')?.[1] === true);
  await click(page, action('export')); await idle(page);
  check('reader export sends no admin inspect/prepare/create', server.state.exports.length === before + 1 && server.state.inspections.length === inspections && !(await snapshot(page)).stageToken);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.backupFixture.push({ user: { ...c._hass.user, is_admin: true } }); });
  await click(page, action('cancel')); await upload(page, largeFile); const inspectCount = server.state.inspections.length;
  await click(page, action('inspect')); await idle(page);
  check('native file beyond512MiB is rejected before upload/preview/publication', server.state.inspections.length === inspectCount
    && !(await snapshot(page)).inspectToken && !(await snapshot(page)).stageToken);
  await click(page, action('cancel')); server.state.headerLimit = true; const count = server.state.exports.length;
  await click(page, action('export')); await idle(page); server.state.headerLimit = false;
  check('oversize declared export body refuses Blob/download without allocating that body', server.state.exports.length === count + 1
    && !(await snapshot(page)).blob && !(await snapshot(page)).inspectToken);
  await click(page, action('cancel')); server.state.malformedInspection = true; await upload(page, file); await click(page, action('inspect')); await idle(page); server.state.malformedInspection = false;
  check('malformed simulated inspection response does not become review/prepare authority', !(await snapshot(page)).inspectToken && !(await snapshot(page)).stageToken);
}

async function uncertainty(session, file, behavior, namespace) {
  const { page } = session; await nativeFileAndPrepare(session, file, namespace);
  const before = await snapshot(page); await page.evaluate((value) => { window.backupFixture.behavior = value; }, behavior);
  await click(page, action('create')); await idle(page); await settle(page); const data = await snapshot(page);
  check(`${behavior} exposes uncertainty/partial work and consumes publication token`, data.publication?.ok === false && !data.stageToken
    && data.publication.retry_available === false && data.publication.orphans?.length > 0 && data.message.includes('does not delete or automatically retry'), data.publication);
  const creates = data.creates.length, saves = data.saves.length; await page.evaluate(() => { window.backupFixture.behavior = 'normal'; window.backupFixture.push(); }); await idle(page);
  check(`${behavior} recovery never automatically retries or deletes`, (await snapshot(page)).creates.length === creates && (await snapshot(page)).saves.length === saves
    && !data.calls.some((m) => m.type.includes('/delete')) && data.creates.length === before.creates.length + 1
    && data.saves.length === before.saves.length + (behavior === 'save-uncertain' ? 1 : 0));
}

async function leavingPendingStage(session, file) {
  const { page, server } = session;
  await click(page, action('cancel')); await upload(page, file); await click(page, action('inspect')); await idle(page);
  await type(page, 'namespace', 'pending-copy'); await checked(page, 'reviewed'); await checked(page, 'partial');
  const before = await snapshot(page), stages = server.state.stages.length; server.state.holdStage = true;
  try {
    await click(page, action('prepare')); await wait(page, () => document.querySelector('taylors3d-card')._edit._dashboardBackupEditor.busy);
    const deadline = Date.now() + 2000;
    while (server.state.stages.length === stages && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    check('simulated stage request actually reached transport before context cancellation', server.state.stages.length === stages + 1);
    await click(page, '[data-act="tab"][data-id="rooms"]'); server.release();
    await click(page, '[data-act="tab"][data-id="data"]'); await idle(page); const data = await snapshot(page);
    check('leaving Data rejects late staging ownership and requires a fresh inspection', !data.stageToken && !data.inspectToken && !data.file
      && data.creates.length === before.creates.length && data.saves.length === before.saves.length
      && data.controls.find(([id]) => id === 'dashboard-backup-create')?.[1] === true && data.message.includes('may remain'), data.message);
  } finally { server.release(); }
}

async function narrowTouch(session, file) {
  const { page } = session;
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); window.backupViewportIdentity = { card, renderer: card._view.renderer, fixture: window.backupFixture }; });
  await page.setViewport({ width: 320, height: 900, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  check('width-only touch resize keeps the original configured card and renderer', await page.evaluate(() => {
    const previous = window.backupViewportIdentity, card = document.querySelector('taylors3d-card');
    return !!previous?.fixture && card === previous.card && card._view.renderer === previous.renderer && window.backupFixture === previous.fixture;
  }));
  await click(page, action('cancel')); await upload(page, file); await click(page, action('inspect')); await idle(page); await type(page, 'namespace', 'narrow-copy');
  await control(page, field('reviewed'), async (node) => { const box = await node.boundingBox(); if (!box) throw new Error('Touch checkbox has no box'); await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); });
  const boxes = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), section = c.shadowRoot.querySelector('[data-dashboard-backup-editor]');
    return { width: innerWidth, document: document.documentElement.scrollWidth, card: c.getBoundingClientRect().toJSON(),
      controls: [...section.querySelectorAll('button,input,select')].filter((el) => el.getBoundingClientRect().height > 0).map((el) => ({ name: el.dataset.act || el.dataset.field,
        box: el.getBoundingClientRect().toJSON() })), reviewed: c._edit._dashboardBackupEditor.reviewed };
  });
  check('320px viewport remains horizontally usable with native44px backup controls', boxes.document <= boxes.width + 2
    && boxes.controls.every((el) => el.box.height >= 43.9 && el.box.width >= 43.9 && el.box.left >= -1 && el.box.right <= boxes.width + 1), boxes);
  check('real touch review changes only consent; it does not prepare/create or send device actions', boxes.reviewed === true && !(await snapshot(page)).stageToken && (await snapshot(page)).services === 0);
  await shot(page, `dashboard-backup-${label.startsWith('source') ? 'source' : 'bundle'}-320px.png`);
  await page.setViewport({ width: 1320, height: 1100, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); await settle(page);
  check('returning to desktop width keeps the same configured card and renderer', await page.evaluate(() => {
    const previous = window.backupViewportIdentity, card = document.querySelector('taylors3d-card');
    return !!previous?.fixture && card === previous.card && card._view.renderer === previous.renderer && window.backupFixture === previous.fixture;
  }));
}

const referencesAre = (data, kind, id, status, reading) => {
  const rows = data.environment?.references.filter((row) => row.kind === kind && row.id === id) ?? [];
  return rows.length > 0 && rows.every((row) => row.status === status && (reading === undefined || row.reading === reading));
};

async function rememberEnvironment(page) {
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), e = c._edit._dashboardBackupEditor, r = c.shadowRoot;
    window.backupEnvironmentRetained = { section: r.querySelector('[data-dashboard-backup-editor]'),
      report: r.querySelector('[data-dashboard-backup-environment]'), static: r.querySelector('[data-dashboard-backup-static]'),
      summary: r.querySelector('[data-dashboard-backup-environment] [data-reference-caption="knownPaths"]'),
      namespace: r.querySelector('[data-field="dashboard-backup-namespace"]'), review: r.querySelector('[data-field="dashboard-backup-reviewed"]'),
      file: r.querySelector('[data-field="dashboard-backup-file"]'), fileObject: e.file, inspection: e.inspection,
      token: e.inspectToken, stageToken: e.stageToken, graph: e._referenceGraph, version: e._version, generation: e.restorer.generation,
      draft: [e.namespace, e.reviewed, e.partial], raw: JSON.stringify(e.inspection),
      registries: { states: c._hass.states, entities: c._hass.entities, areas: c._hass.areas, floors: c._hass.floors } };
  });
}

async function stableEnvironment(page, focused) {
  return page.evaluate((focused) => {
    const c = document.querySelector('taylors3d-card'), e = c._edit._dashboardBackupEditor, r = c.shadowRoot, saved = window.backupEnvironmentRetained;
    return r.querySelector('[data-dashboard-backup-editor]') === saved.section && r.querySelector('[data-dashboard-backup-environment]') === saved.report
      && r.querySelector('[data-dashboard-backup-static]') === saved.static
      && r.querySelector('[data-dashboard-backup-environment] [data-reference-caption="knownPaths"]') === saved.summary
      && r.querySelector('[data-field="dashboard-backup-namespace"]') === saved.namespace
      && r.querySelector('[data-field="dashboard-backup-reviewed"]') === saved.review && r.querySelector('[data-field="dashboard-backup-file"]') === saved.file
      && e.file === saved.fileObject && saved.file.files[0]?.name === saved.fileObject.name && e.inspection === saved.inspection
      && e.inspectToken === saved.token && e.stageToken === saved.stageToken && e._referenceGraph === saved.graph
      && e._version === saved.version && e.restorer.generation === saved.generation && JSON.stringify(e.inspection) === saved.raw
      && JSON.stringify([e.namespace, e.reviewed, e.partial]) === JSON.stringify(saved.draft)
      && saved.namespace.value === e.namespace && saved.review.checked === e.reviewed && r.activeElement === saved[focused];
  }, focused);
}

async function changeTarget(session, change, focused) {
  const { page, server } = session, before = await snapshot(page), requests = server.requests.length;
  await page.evaluate((change) => {
    const c = document.querySelector('taylors3d-card'), f = window.backupFixture, h = c._hass, next = { ...h };
    if (change === 'remove') { delete h.entities['novel_native.current']; delete h.states['novel_native.current']; }
    else if (change === 'recover') {
      h.entities['novel_native.current'] = { entity_id: 'novel_native.current' };
      h.states['novel_native.current'] = { state: 'ready', attributes: { friendly_name: 'Actual simulated new domain' } };
    } else if (change === 'registries-not-loaded') {
      f.environmentLoaded = { entities: h.entities, areas: h.areas, floors: h.floors };
      delete next.entities; delete next.areas; delete next.floors;
    } else if (change === 'registries-loaded') Object.assign(next, f.environmentLoaded);
    else if (change === 'unavailable') h.states['novel_native.current'].state = 'unavailable';
    else if (change === 'reading-recovered') h.states['novel_native.current'].state = 'ready';
    else if (change.startsWith('locale:')) { const language = change.slice(7); next.language = language; next.locale = { ...h.locale, language }; }
    else throw new Error('Unknown target-environment fixture change');
    // Actual Root setter observes an update. Dictionary removals/recovery above
    // deliberately happen in place, rather than replacing cached collections.
    c.hass = next;
  }, change);
  await settle(page); const after = await snapshot(page);
  check(`${change} keeps native ${focused} focus, file/draft/preview and operation authority`, await stableEnvironment(page, focused));
  check(`${change} report update sends no HTTP/WS/service/write and keeps archive complete`, server.requests.length === requests
    && equal(after.calls, before.calls) && after.services === before.services && after.commits === before.commits
    && after.creates.length === before.creates.length && after.saves.length === before.saves.length && after.history === before.history
    && after.complete === true && after.archiveReport.complete === true && after.partial === false && after.sameRenderer && after.webglContexts === 1);
  return after;
}

async function currentEnvironment(session, file, mode) {
  const { page, server } = session;
  await upload(page, file); await click(page, action('inspect')); await idle(page);
  let data = await snapshot(page);
  check('complete archive assets and missing target entity/area/floor warnings remain separate', data.complete === true && data.archiveReport.complete === true
    && data.archiveReport.diagnostics.length === 0 && data.archiveText.includes('Archive references are complete.')
    && data.archiveText.includes('No missing archive assets reported.') && referencesAre(data, 'entity', 'scene.environment_missing', 'missing')
    && referencesAre(data, 'area', 'area_environment_missing', 'missing') && referencesAre(data, 'floor', 'floor_environment_missing', 'missing')
    && data.environmentText.includes('scene.environment_missing') && data.partial === false, data.environment?.counts);
  check('unavailable/hidden readings and never-activated scenes differ from missing IDs', referencesAre(data, 'entity', 'sensor.environment_unavailable', 'present', 'unavailable')
    && data.environment.references.some((row) => row.id === 'sensor.environment_unavailable' && row.hidden)
    && referencesAre(data, 'entity', 'scene.environment_existing', 'present', 'unknown') && data.environment.counts.unavailable === 1);
  check('unfamiliar explicit domain is checked while opaque custom-card strings stay uninspected', referencesAre(data, 'entity', 'novel_native.current', 'present', 'reported')
    && !data.environment.references.some((row) => row.id === 'sensor.opaque_not_inferred') && data.environment.coverage === 'partial'
    && data.environment.uninspected.some((row) => row.path.includes('/views/0/cards/3')));
  const stages = server.state.stages.length;
  await type(page, 'namespace', 'environment-copy'); await click(page, action('prepare'));
  check('complete archive still requires deliberate review of current-environment warnings', !data.reviewed && server.state.stages.length === stages
    && await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-dashboard-backup-reference-review]').textContent.includes('current Home Assistant reference warnings')));
  await type(page, 'namespace', 'environment-copy'); await rememberEnvironment(page);
  data = await changeTarget(session, 'remove', 'namespace');
  check('same dictionary removal updates exact new-domain ID to missing', referencesAre(data, 'entity', 'novel_native.current', 'missing')
    && await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), r = window.backupEnvironmentRetained;
      return c._hass.entities === r.registries.entities && c._hass.states === r.registries.states; }));
  await control(page, field('file'), (node) => node.focus());
  data = await changeTarget(session, 'recover', 'file');
  check('same dictionary exact-ID recovery removes missing warning without selecting a new file', referencesAre(data, 'entity', 'novel_native.current', 'present', 'reported'));
  await checked(page, 'reviewed'); await rememberEnvironment(page);
  data = await changeTarget(session, 'registries-not-loaded', 'review');
  check('absent registries mean pending data rather than a deleted scene/area/floor', referencesAre(data, 'entity', 'scene.environment_missing', 'waiting')
    && referencesAre(data, 'area', 'area_environment_missing', 'waiting') && referencesAre(data, 'floor', 'floor_environment_missing', 'waiting')
    && data.environment.counts.missing === 0 && ['entities', 'areas', 'floors'].every((key) => data.environment.registry[key] === 'not_loaded')
    && data.environment.uninspected.some((row) => row.code === 'registry_not_loaded'));
  data = await changeTarget(session, 'registries-loaded', 'review');
  check('loaded empty target registries restore exact missing warnings without resetting review', referencesAre(data, 'entity', 'scene.environment_missing', 'missing')
    && referencesAre(data, 'area', 'area_environment_missing', 'missing') && referencesAre(data, 'floor', 'floor_environment_missing', 'missing') && data.reviewed);
  await control(page, field('namespace'), (node) => node.focus());
  data = await changeTarget(session, 'unavailable', 'namespace');
  check('in-place unavailable reading remains an existing ID', referencesAre(data, 'entity', 'novel_native.current', 'present', 'unavailable') && data.environment.counts.unavailable === 2);
  data = await changeTarget(session, 'reading-recovered', 'namespace');
  check('in-place usable reading recovery clears only its reading warning', referencesAre(data, 'entity', 'novel_native.current', 'present', 'reported') && data.environment.counts.unavailable === 1);
  const { default: captions } = await import('../src/translations/dashboard-backup-references.js');
  await control(page, '[data-dashboard-backup-environment] [data-reference-caption="knownPaths"]', (node) => node.focus());
  for (const language of ['de', 'fr', 'es', 'en']) {
    await changeTarget(session, 'locale:' + language, 'summary');
    check(`${language} current-environment labels update in the same focused native report`, await page.evaluate((expected) => {
      const r = document.querySelector('taylors3d-card').shadowRoot; return r.querySelector('[data-reference-caption="title"]').textContent === expected.title
        && r.querySelector('[data-dashboard-backup-reference-review]').textContent === expected.review;
    }, { title: captions[language]['edit.data.references.title'], review: captions[language]['edit.data.references.review'] }));
  }
  await click(page, action('prepare')); await idle(page); data = await snapshot(page);
  check('one deliberate reviewed Prepare sends complete archive with allow_incomplete=0', server.state.stages.length === stages + 1
    && server.state.stages.at(-1).allow === '0' && server.state.stages.at(-1).exact && server.state.stages.at(-1).sha256 === server.fixture.archiveSha256
    && data.stageToken && data.stage.report.complete === true && data.stage.report.archive_complete === true && data.stage.report.allow_incomplete === false);
  const expected = stagedDashboardBackup(server.fixture, 'environment-copy', false);
  check('environment warnings do not remap HA IDs/raw cards/resources or alter the prepare contract', equal(data.stage, expected)
    && equal(data.stage.save_message.config, expected.save_message.config) && data.stage.save_message.config.views[0].cards[2].entity === 'scene.environment_missing'
    && data.stage.save_message.config.views[0].cards[3].unknown.entity === 'sensor.opaque_not_inferred'
    && data.calls.length === 0 && data.creates.length === 0 && data.saves.length === 0 && data.services === 0 && data.commits === 0);
  await control(page, field('namespace'), (node) => node.focus()); await rememberEnvironment(page);
  await changeTarget(session, 'remove', 'namespace'); await changeTarget(session, 'recover', 'namespace');
  check('registry changes retain prepared authority without automatically creating a dashboard', (await snapshot(page)).stageToken
    && server.state.stages.length === stages + 1 && (await snapshot(page)).creates.length === 0);
  check('complete environment scenario preserves original live layout/history and never fetches opaque resources', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.backupFixture;
    return JSON.stringify(c._layout) === JSON.stringify(f.originalLayout) && c._history.size === f.history
      && JSON.stringify(f.configs[Object.keys(f.configs)[0]]) === JSON.stringify(f.original);
  }) && server.state.unexpected.length === 0 && session.remoteRequests.length === 0 && (await snapshot(page)).sameRenderer && (await snapshot(page)).webglContexts === 1);
  await shot(page, `dashboard-backup-environment-${mode}.png`);
}

function zipMembers(archive) {
  const members = new Map(); let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18), names = archive.readUInt16LE(offset + 26), extra = archive.readUInt16LE(offset + 28);
    const start = offset + 30 + names + extra, end = start + size;
    if (archive.readUInt16LE(offset + 8) !== 0 || end > archive.length || members.size >= 16) throw new Error('Malformed small stored ZIP fixture');
    members.set(archive.subarray(offset + 30, offset + 30 + names).toString(), archive.subarray(start, end)); offset = end;
  }
  return members;
}

async function preflight() {
  const { collectDashboardReferences, resolveDashboardReferences } = await import('../src/dashboard-backup-references.js');
  const { DashboardRestoreClient } = await import('../src/dashboard-restore-client.js');
  const legacy = dashboardBackupFixture(), fixture = dashboardBackupEnvironmentFixture(), original = JSON.stringify(fixture.inspection);
  check('original incomplete fixture and external dependency approval remain unchanged', legacy.inspection.report.complete === false
    && legacy.inspection.manifest.complete === false && legacy.inspection.report.diagnostics[0].code === 'external_dependency'
    && stagedDashboardBackup(legacy, 'legacy-preflight', true).report.allow_incomplete === true);
  check('complete environment fixture is deterministic independently of target registries', fixture.archive.equals(dashboardBackupEnvironmentFixture().archive)
    && fixture.archiveSha256 === createHash('sha256').update(fixture.archive).digest('hex') && fixture.inspection.report.complete === true);
  const members = zipMembers(fixture.archive), manifest = JSON.parse(members.get('manifest.json'));
  check('real small ZIP manifest/dashboard/shared member agree with simulated inspection', members.size === 3 && manifest.complete === true
    && equal(JSON.parse(members.get('dashboard.json')), fixture.dashboard)
    && equal(JSON.parse(members.get(manifest.layouts[0].member)).layout, fixture.layout)
    && createHash('sha256').update(members.get(manifest.layouts[0].member)).digest('hex') === manifest.layouts[0].sha256);
  const graph = collectDashboardReferences(fixture.inspection.preview), target = structuredClone(fixture.target);
  const report = () => ({ environment: resolveDashboardReferences(graph, target) });
  let data = report();
  check('actual reference checker reports missing scene/area/floor separately from complete archive', referencesAre(data, 'entity', 'scene.environment_missing', 'missing')
    && referencesAre(data, 'area', 'area_environment_missing', 'missing') && referencesAre(data, 'floor', 'floor_environment_missing', 'missing')
    && fixture.inspection.report.complete === true && fixture.inspection.report.diagnostics.length === 0);
  check('current unavailable/hidden and unknown scene states keep existing IDs', referencesAre(data, 'entity', 'sensor.environment_unavailable', 'present', 'unavailable')
    && referencesAre(data, 'entity', 'scene.environment_existing', 'present', 'unknown') && data.environment.counts.unavailable === 1 && data.environment.counts.eligibility === 1);
  check('known new-domain fields checked and opaque strings disclosed instead of guessed', referencesAre(data, 'entity', 'novel_native.current', 'present', 'reported')
    && !graph.references.some((row) => row.id === 'sensor.opaque_not_inferred') && data.environment.coverage === 'partial');
  const dictionaries = { entities: target.entities, states: target.states }, entity = target.entities['novel_native.current'], state = target.states['novel_native.current'];
  delete target.entities['novel_native.current']; delete target.states['novel_native.current']; data = report();
  check('in-place entity/state removal reaches missing with the same extracted graph', referencesAre(data, 'entity', 'novel_native.current', 'missing')
    && target.entities === dictionaries.entities && target.states === dictionaries.states);
  target.entities['novel_native.current'] = entity; target.states['novel_native.current'] = state;
  check('same-ID in-place recovery reaches present', referencesAre(report(), 'entity', 'novel_native.current', 'present', 'reported'));
  const unloaded = structuredClone(target); delete unloaded.entities; delete unloaded.areas; delete unloaded.floors;
  data = { environment: resolveDashboardReferences(graph, unloaded) };
  check('absent target registries yield pending rather than missing IDs', referencesAre(data, 'entity', 'scene.environment_missing', 'waiting')
    && referencesAre(data, 'area', 'area_environment_missing', 'waiting') && referencesAre(data, 'floor', 'floor_environment_missing', 'waiting')
    && data.environment.counts.missing === 0 && data.environment.uninspected.some((row) => row.code === 'registry_not_loaded'));
  check('reference comparisons never mutate raw inspection/dashboard/layout or archive flags', JSON.stringify(fixture.inspection) === original);
  for (const mode of ['source', 'bundle']) {
    label = `${mode} preflight · `; const server = await serveDashboardBackupFixture(root, mode, { environment: true });
    let client;
    try {
      const denied = await fetch(server.base + '/api/taylors3d/dashboard_backup/inspect', { method: 'POST', body: fixture.archive });
      check('transport still requires simulated authenticated requests', denied.status === 401 && server.state.inspections.length === 0);
      const hass = { user: { id: 'preflight-admin', is_admin: true, is_active: true }, auth: {},
        connection: Object.assign(new EventTarget(), { connected: true, options: { auth: {} } }),
        callWS: () => { throw new Error('Preflight must never publish'); },
        fetchWithAuth: (url, options) => fetch(server.base + url, { ...options, headers: { ...options.headers, authorization: 'Bearer simulated-dashboard-backup' } }) };
      client = new DashboardRestoreClient({ getHass: () => hass });
      const inspected = await client.inspect(new Blob([fixture.archive], { type: 'application/zip' }));
      check('actual restore client validates unchanged complete inspection contract', inspected.ok && inspected.inspection.report.complete === true
        && equal(inspected.inspection, fixture.inspection) && server.state.inspections.at(-1)?.exact && server.state.inspections.at(-1)?.sha256 === fixture.archiveSha256, inspected.diagnostics);
      const prepared = await client.stage(inspected.token, { namespace: 'environment-preflight', previewApproved: true, allowIncomplete: false });
      check('actual restore client accepts complete stage without incomplete approval', prepared.ok && prepared.stage.report.complete === true
        && prepared.stage.report.archive_complete === true && prepared.stage.report.allow_incomplete === false
        && server.state.stages.length === 1 && server.state.stages[0].allow === '0' && server.state.stages[0].exact, prepared.diagnostics);
      check('staged raw config/resources and known IDs match existing prepare contract', equal(prepared.stage, stagedDashboardBackup(fixture, 'environment-preflight', false))
        && prepared.stage.save_message.config.views[0].cards[2].entity === 'scene.environment_missing'
        && prepared.stage.save_message.config.views[0].cards[3].unknown.entity === 'sensor.opaque_not_inferred' && server.state.exports.length === 0);
      const response = await fetch(server.base + '/demo/dashboard-backup-fixture.html'), html = await response.text();
      check('source/bundle fixture HTML selects actual card without running a browser', response.ok && html.includes(`import '/${mode === 'source' ? 'src' : 'dist'}/taylors3d-card.js'`)
        && html.includes('SIMULATED Home Assistant') && !html.includes('dashboard-backup-editor.js'));
      const card = await fetch(server.base + `/${mode === 'source' ? 'src' : 'dist'}/taylors3d-card.js`);
      check('chosen actual card module is served by bounded local fixture routing', card.ok && card.headers.get('content-type') === 'text/javascript' && (await card.text()).length > 0);
      const exported = await fetch(server.base + '/api/taylors3d/dashboard_backup/export', { method: 'POST',
        headers: { authorization: 'Bearer simulated-dashboard-backup', 'content-type': 'application/json' }, body: JSON.stringify({ fixture: true }) });
      const bytes = Buffer.from(await exported.arrayBuffer());
      check('complete export header and exact ZIP bytes retain existing transport contract', exported.ok && exported.headers.get('x-taylors3d-complete') === 'true'
        && bytes.equals(fixture.archive) && server.state.unexpected.length === 0);
    } finally { client?.dispose(); await server.close(); }
  }
  console.log('Preflight exercised pure reference comparisons, actual restore client and local simulated transport. Native focus/Chrome/bundle freshness/real HA remain unverified.');
}

async function nativeProof() {
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'taylors3d-backup-native-')), files = [];
console.log('SIMULATED official HA WS/HTTP responses. Native UI/clients only; no Linux server/ZIP validation/persistence proof.');
try {
  for (const mode of ['source', 'bundle']) {
    label = `${mode} · `; context = 'open simulated backup fixture'; const session = await open(mode);
    const file = path.join(temp, `${mode}-original-dashboard.zip`), largeFile = path.join(temp, `${mode}-oversize.zip`);
    try {
      fs.writeFileSync(file, session.server.fixture.archive); files.push(file);
      const descriptor = fs.openSync(largeFile, 'wx'); files.push(largeFile);
      try { fs.ftruncateSync(descriptor, 512 * 1024 * 1024 + 1); } finally { fs.closeSync(descriptor); }
      check('fixture original ZIP/hash is deterministic', createHash('sha256').update(fs.readFileSync(file)).digest('hex') === session.server.fixture.archiveSha256);
      await collectAndExport(session); await publish(session, file);
      for (const gesture of ['pointer', 'Space', 'Enter']) for (const loss of ['role', 'source', 'connection']) await heldIntent(session, gesture, loss);
      for (const [gesture, loss] of [['pointer', 'role'], ['Space', 'connection'], ['Enter', 'source']]) await heldPublication(session, file, gesture, loss);
      await permissionsAndLimits(session, file, largeFile);
      await leavingPendingStage(session, file);
      await uncertainty(session, file, 'creation-uncertain', 'create-uncertain');
      await uncertainty(session, file, 'save-uncertain', 'save-uncertain');
      await narrowTouch(session, file);
      const data = await snapshot(session.page);
      check('all backup actions leave live Taylor layout/history/services/resources untouched', await session.page.evaluate(() => {
        const c = document.querySelector('taylors3d-card'), f = window.backupFixture;
        return JSON.stringify(c._layout) === JSON.stringify(f.originalLayout) && c._history.size === f.history;
      })
        && data.commits === 0 && data.services === 0 && data.sameRenderer && data.webglContexts === 1
        && !data.calls.some((m) => ['taylors3d/layout/set', 'frontend/set_user_data', 'lovelace/resources/create', 'lovelace/resources/update', 'lovelace/resources/delete'].includes(m.type)), data.calls.map((m) => m.type));
      check('no arbitrary resource/image URLs were fetched by collection or static inspection', session.server.state.unexpected.length === 0
        && !session.server.requests.some((r) => r.pathname === '/fixture-unexpected-fetch') && session.remoteRequests.length === 0, session.remoteRequests);
      errors.push(...session.errors);
    } finally { await session.close(); }
    label = `${mode} environment · `; context = 'open complete archive/current-environment fixture';
    const environmentSession = await open(mode, { environment: true }), environmentFile = path.join(temp, `${mode}-complete-environment.zip`);
    try {
      fs.writeFileSync(environmentFile, environmentSession.server.fixture.archive); files.push(environmentFile);
      await currentEnvironment(environmentSession, environmentFile, mode); errors.push(...environmentSession.errors);
    } finally { await environmentSession.close(); }
  }
} catch (error) { console.error('FAIL', context, error.stack || error); checks.push(false); }
finally { for (const file of files) if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(temp); }
}
if (process.argv.includes('--preflight')) {
  try { await preflight(); } catch (error) { console.error('FAIL preflight', error.stack || error); checks.push(false); }
} else await nativeProof();
check('no unexpected page errors/console warnings', errors.length === 0, errors);
console.log(`\n${checks.filter(Boolean).length}/${checks.length} dashboard backup ${process.argv.includes('--preflight') ? 'preflight' : 'native'} checks passed.`);
if (checks.some((result) => !result)) process.exitCode = 1;
