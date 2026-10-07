// Native real-card source/bundle coverage for customised House navigation.
// HA observations and the ha-form boundary are simulated; services are recorded.
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { houseFixtureHtml } from './lib/house-fixture.mjs';

const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
const checks = [], errors = [];
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ' ' + JSON.stringify(detail)}`); };
for (const mode of modes) {
  const transport = await launch();
  try {
    const { page, errors: pageErrors } = await newPage(transport.browser, { width: 440, height: 1080 });
    await page.setRequestInterception(true);
    page.on('request', (request) => new URL(request.url()).pathname === '/house-menu-card.html'
      ? request.respond({ status: 200, contentType: 'text/html', body: houseFixtureHtml(mode) }) : request.continue());
    await page.goto(`${transport.base}/house-menu-card.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.houseModuleReady);
    await page.evaluate(async () => {
      const c = document.querySelector('taylors3d-card'); window.services = []; window.savedMenuConfigs = [];
      const connection = new EventTarget(); connection.connected = true;
      c.setConfig({ type: 'custom:taylors3d-card', layout_style: 'house', house_colour_scheme: 'dark', height: '760px',
        view: 'top', mini_map: false, marker_display: 'all', layout_key: 'house-menu-native-check' });
      c.hass = { connection, user: { id: 'menu-test-user', is_admin: true, is_active: true }, locale: { language: 'en' }, language: 'en',
        config: { time_zone: 'Europe/London' }, services: { light: { turn_on: {}, turn_off: {} } },
        callService: (...args) => { window.services.push(args); return Promise.resolve(); },
        states: { 'light.menu_test': { entity_id: 'light.menu_test', state: 'on', attributes: { friendly_name: 'Simulated lamp', brightness: 120, supported_color_modes: ['brightness'] } } },
        entities: { 'light.menu_test': { entity_id: 'light.menu_test', area_id: 'menu_room', device_id: null } }, devices: {},
        areas: { menu_room: { area_id: 'menu_room', name: 'Simulated room', floor_id: 'ground' } },
        floors: { ground: { floor_id: 'ground', name: 'Ground', level: 0 } } };
      await c._layoutReady;
      c._commit({ ...c._layout, rooms: [{ id: 'menu_room', area_id: 'menu_room', floor_id: 'ground', polygon: [[-3, -3], [3, -3], [3, 3], [-3, 3]], doors: [] }],
        floors: [{ id: 'ground', elevation: 0, height: 3 }], ambient_idle: { enabled: false }, weather: { enabled: false } });
      if (!customElements.get('ha-form')) customElements.define('ha-form', class extends HTMLElement {});
      const editor = c.constructor.getConfigElement(); editor.id = 'menu-test-editor'; document.querySelector('main').append(editor);
      editor.hass = c._hass; editor.setConfig(c._config); editor.addEventListener('config-changed', (event) => window.savedMenuConfigs.push(event.detail.config));
    });
    const settle = async () => {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return c._houseShell?.navigation && !c._loading && !c._view?._tween; });
    };
    const click = async (selector) => {
      const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
      try { await handle.asElement().click(); } finally { await handle.dispose(); } await settle();
    };
    await settle();
    for (const width of [320, 390]) for (const scheme of ['dark', 'light']) {
      const label = `${mode} ${width}px ${scheme}`;
      await page.evaluate(({ width, scheme }) => {
        const c = document.querySelector('taylors3d-card'); c.style.width = `${width + c.getBoundingClientRect().width - c._stage.getBoundingClientRect().width}px`;
        c.setConfig({ ...c._config, house_colour_scheme: scheme }); window.scrollTo(0, 0);
      }, { width, scheme }); await settle();
      await click('[data-house-navigation-id="lights"]');
      const before = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return { popup: c._devicePopup.isOpen, scene: c._scene.getBoundingClientRect().toJSON(), camera: c._view.camera.position.toArray(), target: c._view.controls.target.toArray() }; });
      await click('[data-house-navigation-more]');
      const opened = await page.evaluate(() => {
        const c = document.querySelector('taylors3d-card'), nav = c._houseShell.navigation;
        return { scene: c._scene.getBoundingClientRect().toJSON(), camera: c._view.camera.position.toArray(), target: c._view.controls.target.toArray(),
          controls: [...nav.overflow.children].map((button) => { const r = button.getBoundingClientRect(); return { width: r.width, height: r.height,
            reachable: c.shadowRoot.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === button }; }) };
      });
      check(`${label}: real More remains reachable after room controls and preserves house/camera`, before.popup && JSON.stringify(before.scene) === JSON.stringify(opened.scene)
        && ['camera', 'target'].every((key) => before[key].every((n, i) => Math.abs(n - opened[key][i]) < 1e-9))
        && opened.controls.every((b) => b.width >= 44 && b.height >= 44 && b.reachable), opened);
      fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
      const cardShot = await page.$('taylors3d-card');
      try { await cardShot.screenshot({ path: path.join(root, 'screenshots', `house-menu-${mode}-${width}-${scheme}-more.png`) }); }
      finally { await cardShot.dispose(); }
      await page.keyboard.press('Escape');
      check(`${label}: Escape returns focus to More`, await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return c.shadowRoot.activeElement === c._houseShell.navigation.more && !c._houseShell.navigation._open; }));
      await click('[data-house-navigation-more]'); await click('[data-house-navigation-id="climate"]');
      check(`${label}: deliberate overflow navigation never calls a device`, await page.evaluate(() => window.services.length === 0));
    }
    for (const value of ['rooms', 'important', 'all']) {
      const selector = await page.evaluateHandle(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('.marker-display'));
      try { await selector.asElement().select(value); } finally { await selector.dispose(); } await settle();
      check(`${mode}: native house display selector chooses ${value} without a device call`, await page.evaluate((value) => {
        const c = document.querySelector('taylors3d-card'); return c.shadowRoot.querySelector('.marker-display').value === value
          && c._markerDisplayChoice === value && window.services.length === 0;
      }, value));
    }
    const hiddenConfig = await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), editor = document.querySelector('#menu-test-editor');
      editor.setConfig({ ...c._config, house_navigation: { order: ['cars', 'future-entry'], hidden: [], future_field: 'keep' } });
      return editor.querySelector('[data-house-nav-option="cars"] [data-nav-edit-action="show"]').getBoundingClientRect().toJSON();
    });
    check(`${mode}: visual House menu is created by the actual card factory`, hiddenConfig.width >= 44 && hiddenConfig.height >= 44, hiddenConfig);
    await page.click('#menu-test-editor [data-house-nav-option="cars"] [data-nav-edit-action="show"]');
    await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setConfig(window.savedMenuConfigs.at(-1)); }); await settle();
    check(`${mode}: visual hide saves known choice and keeps imported extras`, await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), nav = c._houseShell.navigation;
      return nav.element.querySelector('[data-house-navigation-id="cars"]').hidden && c._config.house_navigation.future_field === 'keep' && c._config.house_navigation.order.includes('future-entry'); }));
    await page.click('#menu-test-editor [data-nav-reset]');
    check(`${mode}: visual reset preserves unknown options`, await page.evaluate(() => { const saved = window.savedMenuConfigs.at(-1); return saved.house_navigation.future_field === 'keep' && saved.house_navigation.order[0] === 'future-entry' && !saved.house_navigation.hidden; }));
    await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, user: { ...c._hass.user, is_admin: false } }; window.scrollTo(0, 0); }); await settle();
    check(`${mode}: non-admin Settings remains visible and disabled`, await page.evaluate(() => { const b = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-house-navigation-id="settings"]'); return !b.hidden && b.disabled; }));
    errors.push(...pageErrors); await page.close();
  } finally { await transport.close(); }
}
check('no native browser errors', errors.length === 0, errors);
const output = path.join(root, 'screenshots', `house-menu-${modes.join('-')}-integration-proof.json`); fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ qualification: 'Actual source/bundle card and renderer with simulated HA observations/form; no physical device test.', checks, errors }, null, 2));
console.log(`${checks.filter((check) => check.pass).length}/${checks.length} checks passed`);
if (checks.some((check) => !check.pass)) process.exitCode = 1;
