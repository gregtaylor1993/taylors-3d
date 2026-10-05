// Real card/Three.js interaction with a fake authenticated HA subscription. No live HA calls.
// Run after npm run build: CHROME_PATH=... node scripts/presets-check.mjs
import { openDemo } from './lib/demo-browser.mjs';

const failures = [];
const check = (name, ok, details) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${details ? ' – ' + JSON.stringify(details) : ''}`);
  if (!ok) failures.push(name);
};
const closeEnough = (actual, expected, tolerance = 0.03) => actual?.length === expected.length && actual.every((value, i) => Math.abs(value - expected[i]) < tolerance);

async function settle(page, index = 0) {
  await page.waitForFunction((i) => {
    const card = document.querySelectorAll('taylors3d-card')[i];
    return card?._view && !card._view._tween;
  }, { timeout: 7000, polling: 'raf' }, index);
}

async function snapshot(page, index = 0) {
  return page.evaluate((i) => {
    const c = document.querySelectorAll('taylors3d-card')[i];
    return { id: c._viewId, mode: c._mode, viewMode: c._view.mode, floor: c._floor,
      camera: c._view.getCamera(), top: c._view.getTopCamera(), tween: !!c._view._tween,
      subscriptions: window.__presetSubscriptions.size, error: c._presetError };
  }, index);
}

async function send(page, data) {
  const requestId = await page.evaluate((data) => window.__sendPreset(data), data);
  await page.waitForFunction((id) => window.__presetReplies.some((reply) => reply.request_id === id), {}, requestId);
  return page.evaluate((id) => window.__presetReplies.find((reply) => reply.request_id === id), requestId);
}

const demo = await openDemo({ model: '1', height: '460px' }, { width: 1500, height: 620 });
try {
  const { page, errors } = demo;
  await page.waitForFunction(() => [...document.querySelectorAll('taylors3d-card')].every((c) => c._view.model && c._views.length && !c._loading));
  await page.evaluate(() => {
    window.__demoMowerPaused = true;
    window.__presetReplies = [];
    window.__presetSubscriptions = new Map();
    let sequence = 0;
    const connection = {
      subscribeMessage: async (callback, address) => {
        if (address.type !== 'taylors3d/preset/subscribe') throw new Error('Unexpected subscription');
        const targetId = 'target-' + ++sequence;
        window.__presetSubscriptions.set(targetId, { callback, address });
        return async () => window.__presetSubscriptions.delete(targetId);
      },
      addEventListener: () => {}, removeEventListener: () => {},
    };
    window.__presetConnection = connection;
    window.__sendPreset = (data) => {
      const matches = [...window.__presetSubscriptions].filter(([, subscription]) =>
        ['layout_key', 'panel', 'card_id'].every((key) => !data[key] || data[key] === subscription.address[key]));
      if (matches.length !== 1) throw new Error('Expected a unique registered card, got ' + matches.length);
      const [targetId, subscription] = matches[0];
      const requestId = 'request-' + ++sequence;
      subscription.callback({ event_type: 'taylors3d_select_view', data: { ...data, request_id: requestId, target_id: targetId } });
      return requestId;
    };
    for (const [i, card] of [...document.querySelectorAll('taylors3d-card')].entries()) {
      card.setConfig({ ...card._config, automation_panel: i ? 'bedroom' : 'hallway', automation_card_id: i ? 'bedroom-card' : 'hall-card' });
      card.hass = { ...card.hass, connection, callWS: async (message) => {
        if (message.type === 'taylors3d/preset/result') { window.__presetReplies.push(message); return {}; }
        return card._store.backend === 'shared' && message.type === 'taylors3d/layout/get' ? { layout: card._layout } : {};
      } };
      const ground = card._views.find((view) => view.id === 'ground') || card.currentView();
      const first = card._views.find((view) => view.id === 'first') || ground;
      card._layout = { ...card._layout, views: { ...card._layout.views,
        door: { added: true, label: 'Front door', camera_mode: '3d', floors: ['ground'], rules: ground.rules,
          camera: { position: [18, 15, 16], target: [4, 1, -3] }, camera_top: { center: [4, 3], zoom: 1.4 } },
        upstairs: { added: true, label: 'Upstairs top', camera_mode: 'top', floors: ['first'], rules: first.rules,
          camera_top: { center: [6, 4], zoom: 1.7 } },
      } };
      card._built.viewInputs = null;
      card._schedule();
    }
  });
  await page.waitForFunction(() => [...document.querySelectorAll('taylors3d-card')].every((c) => c._views.some((view) => view.id === 'door' && view.camera_mode === '3d')));
  await settle(page); await settle(page, 1);
  check('both addressed cards register one live subscription', (await snapshot(page)).subscriptions === 2);
  const target = { layout_key: 'default', panel: 'hallway', card_id: 'hall-card' };
  const beforeOther = await snapshot(page, 1);
  const reply = await send(page, { ...target, preset: 'Front door' });
  await settle(page);
  let state = await snapshot(page);
  check('automation selects exact named 3D camera on its addressed card', reply.status === 'selected' && state.id === 'door' && state.mode === '3d'
    && closeEnough(state.camera.position, [18, 15, 16]) && closeEnough(state.camera.target, [4, 1, -3]), state);
  const afterOther = await snapshot(page, 1);
  check('another panel keeps its view and camera', beforeOther.id === afterOther.id && beforeOther.mode === afterOther.mode
    && closeEnough(beforeOther.camera.position, afterOther.camera.position), afterOther);

  await send(page, { ...target, preset: 'upstairs' }); await settle(page);
  state = await snapshot(page);
  check('saved Top mode selects correct floor and stored top camera', state.id === 'upstairs' && state.mode === 'top' && state.viewMode === 'top'
    && state.floor === 'first' && closeEnough(state.top.center, [6, 4]) && Math.abs(state.top.zoom - 1.7) < 0.01, state);

  await send(page, { ...target, preset: 'door', mode: 'top' }); await settle(page);
  state = await snapshot(page);
  check('explicit automation mode overrides saved mode', state.id === 'door' && state.mode === 'top'
    && closeEnough(state.top.center, [4, 3]) && Math.abs(state.top.zoom - 1.4) < 0.01, state);

  const missing = await send(page, { ...target, preset: 'Missing camera' });
  check('unknown preset produces acknowledgement error and leaves the view', missing.status === 'invalid_preset' && (await snapshot(page)).id === 'door', missing);

  const restoreBefore = await snapshot(page);
  await send(page, { ...target, preset: 'door', mode: '3d', return_after: 0.8 });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._mode === 'top', { timeout: 4000 });
  await settle(page);
  state = await snapshot(page);
  check('optional return restores previous mode and actual pre-alert camera', state.id === restoreBefore.id && state.mode === restoreBefore.mode
    && closeEnough(state.top.center, restoreBefore.top.center) && Math.abs(state.top.zoom - restoreBefore.top.zoom) < 0.01, state);

  // Genuine pointer touch during the 400 ms camera flight, including capture-phase handlers.
  // Hold the render loop for this one gesture so slow browser roundtrips cannot finish the
  // actual pending tween before the real mouse press reaches it. Restart immediately after.
  await page.evaluate(() => document.querySelector('taylors3d-card')._view.stop());
  await send(page, { ...target, preset: 'door', mode: '3d', return_after: 0.8 });
  const flightAndPoint = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    const box = c._view.renderer.domElement.getBoundingClientRect();
    return { flight: !!c._view._tween, point: [box.left + 15, box.top + 15] };
  });
  await page.mouse.move(...flightAndPoint.point); await page.mouse.down();
  const stopped = await snapshot(page);
  await page.mouse.up();
  await page.evaluate(() => document.querySelector('taylors3d-card')._view.start());
  await new Promise((resolve) => setTimeout(resolve, 1100));
  state = await snapshot(page);
  check('real scene touch immediately stops flight and cancels optional return', flightAndPoint.flight && !stopped.tween && state.mode === '3d', { flightAndPoint, stopped, state });

  await page.evaluate(() => document.querySelector('taylors3d-card')._toggleEdit());
  const editing = await send(page, { ...target, preset: 'upstairs' });
  check('editing refuses automation with a clear result', editing.status === 'not_ready', editing);
  await page.evaluate(() => document.querySelector('taylors3d-card')._toggleEdit());

  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    c.setConfig({ ...c._config, automation_panel: 'new-hallway', automation_card_id: 'renamed-card' });
  });
  await page.waitForFunction(() => [...window.__presetSubscriptions.values()].some(({ address }) => address.card_id === 'renamed-card'));
  check('changing card address releases its previous registration', await page.evaluate(() => window.__presetSubscriptions.size === 2
    && ![...window.__presetSubscriptions.values()].some(({ address }) => address.card_id === 'hall-card')));
  await send(page, { layout_key: 'default', panel: 'new-hallway', card_id: 'renamed-card', preset: 'upstairs' });
  await settle(page);
  check('renamed target still selects its preset', (await snapshot(page)).id === 'upstairs');

  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    window.__detachedPresetCard = { card: c, parent: c.parentElement };
    c.remove();
  });
  await page.waitForFunction(() => window.__presetSubscriptions.size === 1);
  check('detached card removes its registered target', await page.evaluate(() => window.__presetSubscriptions.size === 1));
  await page.evaluate(() => window.__detachedPresetCard.parent.append(window.__detachedPresetCard.card));
  await page.waitForFunction(() => window.__presetSubscriptions.size === 2);
  check('reattached card re-registers exactly once', await page.evaluate(() => window.__presetSubscriptions.size === 2));

  await page.evaluate(() => document.querySelector('taylors3d-card').setPanelName('local-wall-screen'));
  await page.waitForFunction(() => [...window.__presetSubscriptions.values()].some(({ address }) => address.panel === 'local-wall-screen'));
  check('browser panel name overrides shared card settings and persists locally', await page.evaluate(() => {
    const cards = [...document.querySelectorAll('taylors3d-card')];
    return localStorage.getItem('taylors3d.panel') === 'local-wall-screen'
      && cards.every((card) => card._panelName === 'local-wall-screen')
      && [...window.__presetSubscriptions.values()].every(({ address }) => address.panel === 'local-wall-screen');
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => [...document.querySelectorAll('taylors3d-card')].every((c) => c._view?.model && c._layout && c._markers.length));
  check('browser panel identity survives an actual page reload', await page.evaluate(() =>
    [...document.querySelectorAll('taylors3d-card')].every((card) => card._panelName === 'local-wall-screen')));
  check('browser produced no errors', errors.length === 0, errors);
} finally {
  await demo.close();
}
if (failures.length) {
  console.error(`${failures.length} preset browser checks failed`);
  process.exitCode = 1;
}
