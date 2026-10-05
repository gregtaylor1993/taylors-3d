// Demo page wiring: a stand-in <ha-icon>, a mock hass shared by all cards on the page.
import * as mdi from '@mdi/js';
import { createMockHass, demoScenePreviews } from './mock-hass.js';

class DemoIcon extends HTMLElement {
  static get observedAttributes() { return ['icon']; }
  attributeChangedCallback() {
    const name = (this.getAttribute('icon') || '').replace(/^mdi:/, '');
    const key = 'mdi' + name.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
    const path = mdi[key] || mdi.mdiHelpCircleOutline;
    this.innerHTML = `<svg viewBox="0 0 24 24" style="width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);display:block;fill:currentColor"><path d="${path}"/></svg>`;
  }
}
if (!customElements.get('ha-icon')) customElements.define('ha-icon', DemoIcon);

const cards = [...document.querySelectorAll('taylors3d-card')];
const themes = new Map(cards.map((c) => [c, { darkMode: !!c.closest('.dark') }]));
const push = (hass) => { for (const c of cards) c.hass = { ...hass, themes: themes.get(c) }; };
const params = new URLSearchParams(location.search);
const scenes = params.get('scenes') === '1';
if (scenes) {
  const notice = document.createElement('p');
  notice.dataset.sceneSimulation = '';
  notice.textContent = 'Simulated Home Assistant scenes. Preview changes only the picture. Activate updates fake light readings; no real devices are connected.';
  notice.style.cssText = 'margin:12px 16px;padding:12px;border:1px solid #777;border-radius:8px;font-size:14px';
  document.querySelector('main')?.before(notice);
}
for (const c of cards) {
  const model = params.get('model');
  c.setConfig({
    height: params.get('height') || '460px', view: params.get('view') || c.dataset.view || '3d', floor: params.get('floor') || undefined,
    // ?model=1 loads the generated demo house, any other value is used as the model url
    ...(model ? { model: model === '1' ? '/demo/house.glb' : model, model_opacity: 0.95 } : {}),
    ...(params.get('merge') === '0' ? { merge: false } : {}), // ?merge=0: every model part its own mesh
    ...(scenes ? { scene_previews: demoScenePreviews() } : {}), // explicit opt-in: ?scenes=1
  });
}

// log what the card asks for, so the page works without a real HA frontend
window.addEventListener('hass-more-info', (e) => {
  document.querySelector('#log').textContent = 'more-info: ' + e.detail.entityId;
});

push(createMockHass({ onChange: push, scenes }));
