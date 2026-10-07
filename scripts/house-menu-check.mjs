// Native source-component proof: responsive House menu and HA card-editor ordering.
// The scene rectangle and HA form boundary are deliberate inert test stand-ins.
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, root } from './lib/demo-browser.mjs';

const checks = [], errors = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ' ' + JSON.stringify(detail)}`);
};
const html = `<!doctype html><style>body{margin:0;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#host{display:block}taylors3d-card-editor{width:100%}</style><div id="host"></div><script type="module">
import {HouseNavigation,resolveHouseNavigationItems} from '/src/house-navigation.js';
import {TAYLORS3D_THEME_CSS} from '/src/taylors3d-theme.js';
customElements.define('ha-form',class extends HTMLElement{});
await import('/src/card-editor.js');
window.calls=[];window.updates=[];
const host=document.querySelector('#host'),shadow=host.attachShadow({mode:'open'});host.dataset.taylors3dTheme='house';
const style=document.createElement('style');style.textContent=TAYLORS3D_THEME_CSS;shadow.append(style);
const stage=document.createElement('div');stage.className='stage';stage.dataset.taylors3dShell='adaptive';stage.dataset.taylors3dShellMode='bottom';stage.style.cssText='position:relative;height:600px;background:var(--taylors3d-ui-background)';shadow.append(stage);
const scene=document.createElement('button');scene.className='scene';scene.textContent='Inert scene test surface';scene.style.cssText='position:absolute;top:20px;bottom:110px;left:20px;right:20px';scene.onclick=()=>window.calls.push('scene');stage.append(scene);
const popup=document.createElement('div');popup.className='taylors3d-device-popup';popup.textContent='Inert overlapping room panel';popup.style.cssText='position:absolute;z-index:30;bottom:100px;left:8px;right:8px;height:260px;background:var(--taylors3d-ui-raised)';stage.append(popup);
window.menu=new HouseNavigation(stage,{onSelect:(action)=>window.calls.push(action)});
const editor=document.createElement('taylors3d-card-editor');editor.addEventListener('config-changed',event=>window.updates.push(event.detail.config));document.body.append(editor);
window.configure=(width,language,scheme)=>{host.dataset.taylors3dScheme=scheme;const hass={language,states:{}};window.menu.update({items:resolveHouseNavigationItems(undefined,hass),hass});window.menu.setLayout('bottom',width);editor.hass=hass;editor.setConfig({type:'custom:taylors3d-card',layout_style:'house',house_colour_scheme:scheme});};
window.ready=true;
</script>`;
const transport = await launch();
try {
  const { page, errors: pageErrors } = await newPage(transport.browser, { width: 390, height: 980 });
  await page.setRequestInterception(true);
  page.on('request', (request) => new URL(request.url()).pathname === '/house-menu-fixture.html'
    ? request.respond({ status: 200, contentType: 'text/html', body: html }) : request.continue());
  await page.goto(`${transport.base}/house-menu-fixture.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ready);
  const click = async (selector) => {
    const handle = await page.evaluateHandle((selector) => document.querySelector('#host').shadowRoot.querySelector(selector), selector);
    try { await handle.asElement().click(); } finally { await handle.dispose(); }
  };
  for (const width of [320, 390]) for (const language of ['en', 'de', 'fr', 'es']) for (const scheme of ['dark', 'light']) {
    const label = `${width}px ${language} ${scheme}`;
    await page.setViewport({ width, height: 980, deviceScaleFactor: 1 });
    await page.evaluate((values) => { window.scrollTo(0, 0); window.configure(...values); }, [width, language, scheme]);
    const initial = await page.evaluate(() => {
      const nav = window.menu, scene = document.querySelector('#host').shadowRoot.querySelector('.scene');
      const r = nav.element.getBoundingClientRect();
      const controls = [...nav.items.children].filter((button) => !button.hidden).map((button) => {
        const b = button.getBoundingClientRect(); return { width: b.width, height: b.height, left: b.left, right: b.right, overflow: button.scrollWidth > button.clientWidth + 1 };
      });
      return { scene: scene.getBoundingClientRect().toJSON(), nav: r.toJSON(), controls, calls: window.calls.length };
    });
    check(`${label}: labelled favourites and More fit at44px`, initial.controls.length === (width === 320 ? 4 : 5)
      && initial.controls.every((b) => b.width >= 44 && b.height >= 44 && b.left >= initial.nav.left && b.right <= initial.nav.right + 1 && !b.overflow), initial);
    await click('[data-house-navigation-more]');
    const opened = await page.evaluate(() => {
      const nav = window.menu, shadow = document.querySelector('#host').shadowRoot;
      return { scene: shadow.querySelector('.scene').getBoundingClientRect().toJSON(), active: shadow.activeElement?.dataset.houseNavigationId,
        more: nav.more.getAttribute('aria-expanded'), controls: [...nav.overflow.children].map((button) => {
          const b = button.getBoundingClientRect(); return { width: b.width, height: b.height, left: b.left, right: b.right,
            reachable: shadow.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('button') === button };
        }) };
    });
    check(`${label}: More overlays the existing panel and preserves the scene`, opened.more === 'true' && !!opened.active
      && JSON.stringify(initial.scene) === JSON.stringify(opened.scene) && opened.controls.every((b) => b.width >= 44 && b.height >= 44 && b.left >= 0 && b.right <= width && b.reachable), opened);
    await page.keyboard.press('Escape');
    check(`${label}: Escape restores native More focus`, await page.evaluate(() => !window.menu._open
      && document.querySelector('#host').shadowRoot.activeElement === window.menu.more));
    await click('[data-house-navigation-more]'); await click('[data-house-navigation-id="settings"]');
    check(`${label}: Settings stays reachable and opening/dismissing sends no device action`, await page.evaluate((count) => window.calls.length === count + 1
      && window.calls.at(-1).id === 'settings', initial.calls));
    const editor = await page.$('taylors3d-card-editor'); await editor.scrollIntoView();
    const editorGeometry = await page.evaluate(() => {
      const editor = document.querySelector('taylors3d-card-editor'), rect = editor.getBoundingClientRect();
      return { width: rect.width, scroll: editor.scrollWidth, controls: [...editor.querySelectorAll('.house-navigation-order button')].map((button) => {
        const r = button.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right };
      }) };
    });
    check(`${label}: menu editor stays within narrow card with44px targets`, editorGeometry.width <= width && editorGeometry.scroll <= width
      && editorGeometry.controls.every((b) => b.width >= 44 && b.height >= 44 && b.left >= 0 && b.right <= width), editorGeometry);
    await editor.dispose();
  }
  errors.push(...pageErrors);
  check('no browser errors', errors.length === 0, errors);
} finally { await transport.close(); }
const output = path.join(root, 'screenshots', 'house-menu-source-proof.json'); fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ qualification: 'Native source components with inert scene/HA form stand-ins; no real Home Assistant or device test.', checks, errors }, null, 2));
console.log(`${checks.filter((check) => check.pass).length}/${checks.length} checks passed`);
if (checks.some((check) => !check.pass)) process.exitCode = 1;
