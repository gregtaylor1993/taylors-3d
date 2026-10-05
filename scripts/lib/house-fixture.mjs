// Original simulated observations for the house-layout browser proof. No real
// address, household, vehicle identity or image from the design references.
import { floorPresentationFixtureGlb, floorFixtureIds } from './floor-presentation-fixture.mjs';

// Node-only byte generator: the browser loads this original embedded GLB through
// the actual card GLTFLoader. It never imports a second Three/Exporter runtime.
export const houseModelIds = floorFixtureIds;
export const houseModelGlb = () => floorPresentationFixtureGlb();

export const houseEntities = Object.freeze({ lamp: 'light.house_lamp', temperature: 'sensor.house_temperature',
  camera: 'camera.house_camera', door: 'binary_sensor.house_door', player: 'media_player.house_player',
  climate: 'climate.house_climate', parked: 'binary_sensor.house_parked', motion: 'binary_sensor.house_motion',
  weather: 'weather.house_weather', person: 'person.house_person', alarm: 'alarm_control_panel.house_alarm' });

export function houseFixtureHtml(mode) {
  const imports = { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Simulated Taylor's 3D layout check</title><link rel="icon" href="data:,">
    ${mode === 'source' ? `<script type="importmap">${JSON.stringify({ imports })}</script>` : ''}
    <style>body{margin:0;padding:12px;font:14px system-ui;background:#e9eef2;color:#172833}main{width:max-content;max-width:none}
    .notice{max-width:1280px;margin:0 0 12px}taylors3d-card{display:block;width:1280px;
    --card-background-color:#fff;--primary-text-color:#212121;--secondary-text-color:#595959;--primary-color:#007c70;
    --divider-color:#777;--text-primary-color:#fff;--state-light-active-color:#ff9800}</style>
    </head><body><p class="notice">SIMULATED Home Assistant observations · local test house · no real home or devices connected</p>
    <main><taylors3d-card></taylors3d-card></main><script type="module">
    import * as mdi from '/node_modules/@mdi/js/mdi.js';
    import '/${mode === 'source' ? 'src' : 'dist'}/taylors3d-card.js';
    class TestIcon extends HTMLElement { static get observedAttributes(){return ['icon'];} attributeChangedCallback(){
      const name=(this.getAttribute('icon')||'').replace(/^mdi:/,'');
      const key='mdi'+name.split('-').map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join('');
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');
      svg.style.cssText='width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);display:block;fill:currentColor';
      const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',mdi[key]||mdi.mdiHelpCircleOutline);
      svg.append(path);this.replaceChildren(svg);
    }}
    if(!customElements.get('ha-icon'))customElements.define('ha-icon',TestIcon);
    window.houseModuleReady=true;
    </script></body></html>`;
}
