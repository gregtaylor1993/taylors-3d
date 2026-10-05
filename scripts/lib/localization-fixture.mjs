// Distinct simulated observations. No household/reference-photo data and no
// live Home Assistant connection. The real card owns DOM, rendering and actions.
export const localizationEntities = Object.freeze({
  lamp: 'light.locale_work_lamp', temperature: 'sensor.locale_work_temperature',
  player: 'media_player.locale_work_player', weather: 'weather.locale_example',
  person: 'person.locale_example', alarm: 'alarm_control_panel.locale_example',
  camera: 'camera.locale_upper_camera', contact: 'binary_sensor.locale_upper_contact',
  scene: 'scene.locale_saved_scene',
});
export const localizationNames = Object.freeze({
  title: 'User_House_été', room: 'User_Room_été', device: 'User_Device_été', lamp: 'User_Lamp_été',
  temperature: 'User_Temperature_été', person: 'User_Person_été',
  ground: 'User_Ground_été', upper: 'User_Upper_été', view: 'User_View_été',
  camera: 'User_Camera_été', contact: 'User_Contact_été', importedView: 'User_Imported_View_été',
  scene: 'User_<i>Scene_été',
});

export function localizationFixtureHtml(mode) {
  if (!['source', 'bundle'].includes(mode)) throw new Error('Choose source or bundle.');
  const imports = { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Simulated language-control check</title><link rel="icon" href="data:,">
  ${mode === 'source' ? `<script type="importmap">${JSON.stringify({ imports })}</script>` : ''}
  <style>body{margin:0;padding:12px;font:14px system-ui;background:#e6edf1;color:#172833}
  main{width:max-content}.notice{max-width:1180px}taylors3d-card{display:block;width:1180px;
  --card-background-color:#fff;--primary-text-color:#212121;--secondary-text-color:#595959;
  --primary-color:#007c70;--divider-color:#777;--text-primary-color:#fff;--state-light-active-color:#ff9800}
  #locale-form-host{box-sizing:border-box;width:700px;margin-top:24px;padding:12px;background:#fff;color:#212121;
  --card-background-color:#fff;--secondary-background-color:#f4f4f4;--primary-text-color:#212121;--secondary-text-color:#595959;--primary-color:#007c70;--divider-color:#777}
  #locale-form-host[hidden]{display:none}#locale-form-host h2,#locale-form-host p{overflow-wrap:anywhere}
  #locale-form-host ha-form{display:block}#locale-form-host ha-form label{display:flex;flex-direction:column;gap:5px;margin:12px 0;min-width:0;overflow-wrap:anywhere}
  #locale-form-host ha-form :is(input,select){box-sizing:border-box;min-height:44px;width:100%;max-width:100%;font:inherit;color:#212121;background:#fff}
  #locale-form-host ha-form .simulated-helper{font-size:13px;margin:0;color:#595959}</style>
  </head><body><p class="notice">SIMULATED language and keyboard test · no real home or devices connected</p>
  <main><taylors3d-card></taylors3d-card><section id="locale-form-host" hidden><h2>SIMULATED Home Assistant form host</h2>
  <p>Actual Taylor's 3D config-changed events only; no Home Assistant dashboard save is performed.</p></section></main><script type="module">
  import * as mdi from '/node_modules/@mdi/js/mdi.js';
  import '/${mode === 'source' ? 'src' : 'dist'}/taylors3d-card.js';
  class FixtureIcon extends HTMLElement {
    static get observedAttributes(){return ['icon'];}
    attributeChangedCallback(){const name=(this.getAttribute('icon')||'').replace(/^mdi:/,'');
      const key='mdi'+name.split('-').map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join('');
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');
      svg.style.cssText='width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);display:block;fill:currentColor';
      const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',mdi[key]||mdi.mdiHelpCircleOutline);
      svg.append(path);this.replaceChildren(svg);}
  }
  if(!customElements.get('ha-icon'))customElements.define('ha-icon',FixtureIcon);
  // Stable minimal host for actual card-editor schema/computeLabel/computeHelper.
  // It never simulates a HA dashboard save or emits changes from a repaint.
  class LocaleFormHost extends HTMLElement {
    set hass(value){this._hass=value;this.render();}get hass(){return this._hass;}
    set schema(value){this._schema=value;this.render();}get schema(){return this._schema;}
    set data(value){this._data=value;this.render();}get data(){return this._data;}
    render(){if(!this._data||!this._schema)return;
      const flatten=fields=>fields.flatMap(field=>field.schema?flatten(field.schema):[field]);
      for(const [index,section] of this._schema.entries()){if(!section.title)continue;
        let heading=this.querySelector('[data-native-section="'+index+'"]');if(!heading){heading=document.createElement('h3');heading.dataset.nativeSection=index;this.append(heading);}
        if(heading.textContent!==section.title)heading.textContent=section.title;}
      const fields=flatten(this._schema),selected=['height','view_id','device_tap_action','model','model_position_x','model_position_y','model_position_z','model_opacity'];
      for(const name of selected){const schema=fields.find(field=>field.name===name);if(!schema)continue;
        let label=this.querySelector('[data-native-label="'+name+'"]');
        if(!label){label=document.createElement('label');label.dataset.nativeLabel=name;const caption=document.createElement('span');caption.dataset.nativeCaption=name;
          const control=document.createElement(schema.selector?.select?'select':'input');control.dataset.nativeField=name;
          if(control.tagName==='INPUT'){control.type=schema.selector?.number?'number':'text';if(control.type==='number')control.step='any';}
          control.addEventListener('change',()=>{const value=control.type==='number'&&control.value!==''?control.valueAsNumber:control.value;
            this.dispatchEvent(new CustomEvent('value-changed',{detail:{value:{...this._data,[name]:value}},bubbles:true,composed:true}));});
          const helper=document.createElement('p');helper.dataset.nativeHelper=name;helper.className='simulated-helper';label.append(caption,control,helper);this.append(label);}
        const caption=label.querySelector('[data-native-caption]'),helper=label.querySelector('[data-native-helper]'),control=label.querySelector('[data-native-field]');
        const title=this.computeLabel?.(schema)||name,help=this.computeHelper?.(schema)||'';
        if(caption.textContent!==title)caption.textContent=title;if(helper.textContent!==help)helper.textContent=help;
        if(control.tagName==='SELECT'){const existing=new Map([...control.options].map(option=>[option.value,option]));
          const options=schema.selector.select.options.map(item=>{const option=existing.get(item.value)||document.createElement('option');
            option.value=item.value;if(option.textContent!==item.label)option.textContent=item.label;return option;});
          if(options.length!==control.options.length||options.some((option,index)=>option!==control.options[index]))control.replaceChildren(...options);}
        if(document.activeElement!==control&&control.value!==String(this._data[name]??''))control.value=String(this._data[name]??'');
      }
    }
  }
  if(!customElements.get('ha-form'))customElements.define('ha-form',LocaleFormHost);
  window.localizationModuleReady=true;
  </script></body></html>`;
}

// Puppeteer evaluates this function in the page. All external facts are explicit
// arguments; source and bundle fixtures never import a second app module.
export async function installLocalizationFixture({ mode, entities, names }) {
  const card = document.querySelector('taylors3d-card');
  const f = window.localizationFixture = { services: [], websocket: [], info: [], navigation: [], commits: 0,
    resizeCalls: 0, sizeWrites: 0, saveCalls: 0, configEvents: [], pending: null, deferNext: false,
    cameraConfigs: [], cameraStarts: 0, cameraStops: 0, deferNextCamera: false, pendingCamera: null };
  // An explicitly simulated HA-native picture card tests player ownership and
  // cleanup. It neither requests a stream nor impersonates a real camera image.
  if (!customElements.get('fixture-localization-camera-card')) {
    customElements.define('fixture-localization-camera-card', class extends HTMLElement {
      constructor() { super(); const root = this.attachShadow({ mode: 'open' });
        const text = document.createElement('p'); text.textContent = 'SIMULATED native camera player';
        const video = document.createElement('video'); video.muted = true; video.controls = true;
        video.style.cssText = 'display:block;max-width:100%;width:100%;height:100px'; root.append(text, video); }
      connectedCallback() { this.style.cssText = 'box-sizing:border-box;min-height:160px;background:#243742;color:#fff;padding:12px';
        window.localizationFixture.cameraStarts++; }
      disconnectedCallback() { window.localizationFixture.cameraStops++; }
      set hass(value) { this.currentHass = value; }
    });
  }
  window.loadCardHelpers = async () => ({ createCardElement: (config) => {
    f.cameraConfigs.push(config); return document.createElement('fixture-localization-camera-card');
  } });
  const connection = new EventTarget(); connection.connected = true;
  const state = (entity_id, value, attributes) => ({ entity_id, state: value, attributes });
  const states = {
    [entities.lamp]: state(entities.lamp, 'on', { friendly_name: names.lamp, brightness: 128,
      color_mode: 'rgb', rgb_color: [12, 34, 56], supported_color_modes: ['rgb', 'color_temp'],
      min_color_temp_kelvin: 2100, max_color_temp_kelvin: 6400 }),
    [entities.temperature]: state(entities.temperature, '12.345', { friendly_name: names.temperature,
      device_class: 'temperature', unit_of_measurement: '°C' }),
    [entities.player]: state(entities.player, 'playing', { friendly_name: 'User_Player_été' }),
    [entities.weather]: state(entities.weather, 'cloudy', { friendly_name: 'User_Weather_été', temperature: 12.25, temperature_unit: '°C' }),
    [entities.person]: state(entities.person, 'home', { friendly_name: names.person }),
    [entities.alarm]: state(entities.alarm, 'disarmed', { friendly_name: 'User_Alarm_été' }),
    [entities.camera]: state(entities.camera, 'idle', { friendly_name: names.camera }),
    [entities.contact]: state(entities.contact, 'off', { friendly_name: names.contact, device_class: 'door' }),
    [entities.scene]: state(entities.scene, 'unknown', { friendly_name: names.scene }),
    'sun.sun': state('sun.sun', 'above_horizon', { elevation: 30, azimuth: 180 }),
  };
  const registry = (entity_id, device_id = null, area_id = null) => ({ entity_id, device_id, area_id,
    hidden_by: null, disabled_by: null, entity_category: null });
  const entitiesRegistry = Object.fromEntries(Object.keys(states).map((id) => [id, registry(id)]));
  entitiesRegistry[entities.lamp] = registry(entities.lamp, 'locale_device');
  entitiesRegistry[entities.temperature] = registry(entities.temperature, 'locale_device');
  entitiesRegistry[entities.player] = registry(entities.player, null, 'locale_room');
  entitiesRegistry[entities.camera] = registry(entities.camera, null, 'locale_upper_room');
  entitiesRegistry[entities.contact] = registry(entities.contact, null, 'locale_upper_room');
  const hass = { user: { id: 'locale-simulated-admin', is_admin: true, is_active: true }, connection,
    locale: { language: 'en', number_format: 'language' }, language: 'en', themes: { darkMode: true },
    config: { location_name: 'User_HA_Location_été', time_zone: 'Europe/London', latitude: null, longitude: null },
    states, entities: entitiesRegistry, devices: { locale_device: { id: 'locale_device', name: names.device, area_id: 'locale_room' } },
    areas: { locale_room: { area_id: 'locale_room', name: names.room, floor_id: 'locale_ground' },
      locale_upper_room: { area_id: 'locale_upper_room', name: 'User_Upper_Room_été', floor_id: 'locale_upper' } },
    floors: { locale_ground: { floor_id: 'locale_ground', name: names.ground, level: 0 },
      locale_upper: { floor_id: 'locale_upper', name: names.upper, level: 1 } },
    services: { light: { turn_on: {}, turn_off: {}, toggle: {} }, scene: { turn_on: {} }, homeassistant: { toggle: {} } },
    // These are explicit native-formatter stand-ins, not translations invented
    // by the card. Their exact returned strings must survive every locale.
    formatEntityName: (source) => source.attributes.friendly_name,
    formatEntityState: (source) => `HA_STATE:${source.state}`,
    formatEntityAttributeValue: (source, attribute) => `HA_ATTR:${attribute}:${source.attributes[attribute]}`,
    callService: (...args) => {
      f.services.push(args);
      if (!f.deferNext) return Promise.resolve();
      f.deferNext = false;
      return new Promise((resolve, reject) => { f.pending = { resolve, reject }; });
    },
    callWS: async (message) => {
      f.websocket.push(message);
      if (message.type === 'camera/capabilities') {
        if (!f.deferNextCamera) return { frontend_stream_types: ['hls'] };
        f.deferNextCamera = false;
        return new Promise((resolve, reject) => { f.pendingCamera = { resolve, reject }; });
      }
      if (message.type === 'taylors3d/layout/get') return { layout: null };
      if (message.type === 'frontend/get_user_data') return { value: null };
      if (message.type === 'taylors3d/layout/set') return {};
      throw new Error(`Unsupported simulated websocket: ${message.type}`);
    },
  };
  card.setConfig({ height: '680px', layout_key: `locale-browser-${mode}`, layout_style: 'house', house_colour_scheme: 'dark',
    view: 'top', floor: 'locale_ground', control_panel: 'popup', device_tap_action: 'popup', mini_map: true });
  card.hass = hass; await card._layoutReady;
  card._commit({ ...card._layout,
    floors: [{ id: 'locale_ground', elevation: 0, height: 3 }, { id: 'locale_upper', elevation: 3, height: 3 }],
    rooms: [{ id: 'locale_room', area_id: 'locale_room', floor_id: 'locale_ground',
      polygon: [[-4, -3], [4, -3], [4, 3], [-4, 3]], doors: [] },
    { id: 'locale_upper_room', area_id: 'locale_upper_room', floor_id: 'locale_upper',
      polygon: [[-3, -2], [3, -2], [3, 2], [-3, 2]], doors: [] }],
    pins: { 'device:locale_device': { x: -2, y: 0, z: 0, floor_id: 'locale_ground' },
      [`entity:${entities.player}`]: { x: 2, y: 0, z: 0, floor_id: 'locale_ground' } },
    hidden: [], mower: {}, model: {}, objects: {}, groups: {},
    views: { locale_ground: { label: names.view } },
    room_overlays: { mode: 'off' }, alert_bindings: [], security_bindings: [], camera_coverage: {},
    presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [],
    ambient_idle: { enabled: false }, weather: { enabled: false }, scene_previews: { enabled: false },
    house_summary: { title: names.title, weather_entity: entities.weather, person_entities: [entities.person], alarm_entity: entities.alarm },
  });
  await Promise.resolve();
  card.resetHistory();
  const commit = card.commitFeatureLayout.bind(card);
  card.commitFeatureLayout = (...args) => { f.commits++; return commit(...args); };
  const resize = card._view.resize, setSize = card._view.renderer.setSize, save = card._store.save;
  card._view.resize = function (...args) { f.resizeCalls++; return resize.apply(this, args); };
  card._view.renderer.setSize = function (...args) { f.sizeWrites++; return setSize.apply(this, args); };
  card._store.save = function (...args) { f.saveCalls++; return save.apply(this, args); };
  window.addEventListener('hass-more-info', (event) => f.info.push(event.detail.entityId));
  const onSelect = card._houseShell.onSelect;
  card._houseShell.onSelect = (...args) => { f.navigation.push(args[0]); return onSelect(...args); };
  f.renderer = card._view.renderer; f.scene = card._scene;
  f.initialStates = JSON.stringify(card._hass.states);
  f.services.length = 0;
}

// Narrow read-only catalogue fixture for the five additional native editors.
// Actual FurnitureLibraryClient validates this response; no product callback,
// importer, placement reader, renderer or editor is replaced. The saved row has
// an explicitly missing floor, so no asset/ZIP bytes or successful placement are
// claimed. Unexpected requests are recorded and rejected, including all writes.
export async function installExtraEditorFixture({ entities, names }) {
  const card = document.querySelector('taylors3d-card'), f = window.localizationFixture;
  const packId = 'a'.repeat(64), assetHash = 'b'.repeat(64), licenseText = 'MIT anonymous localization metadata fixture.\n';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(licenseText));
  const license = { id: 'MIT', file: 'LICENSE.txt', text: licenseText,
    sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') };
  const item = { id: 'user_chair', name: 'User_<b>Chair_été', file: 'chair.glb', unit: 'm', anchor: [0, 0, 0] };
  const manifest = { version: 1, id: 'anonymous-locale-fixture', name: 'User_<b>Pack_été', author: 'Anonymous simulated fixture',
    license: { id: 'MIT', file: 'LICENSE.txt' }, items: [item], extra: 'User_Manifest_été' };
  const catalogue = { version: 1, packs: [{ pack_id: packId, logical_sha256: 'c'.repeat(64), archive_bytes: 100,
    manifest, license, licenses: { 'LICENSE.txt': license }, download_url: `/api/taylors3d/furniture/packs/${packId}.zip`,
    items: [{ ...item, pack_id: packId, sha256: assetHash, asset_url: `/api/taylors3d/furniture/assets/${assetHash}.glb`,
      metadata: item, license, stats: { nodes: 1, meshes: 1, mesh_uses: 1, primitives: 1, triangles: 1, source_triangles: 1,
        materials: 0, textures: 0, images: [], texture_pixels: 0 } }],
    stats: { archive_bytes: 100, expanded_bytes: 200, members: 3, items: 1, unique_assets: 1, asset_bytes: 20,
      triangles: 1, texture_pixels: 0 }, extra: 'User_Pack_été' }] };
  f.extraLibraryReads = [];
  card.hass = { ...card._hass, fetchWithAuth: async (url, options = {}) => {
    f.extraLibraryReads.push({ url, method: options.method || 'GET' });
    if (url !== '/api/taylors3d/furniture' || options.method && options.method !== 'GET')
      throw new Error('Unsupported anonymous localization metadata request');
    return new Response(JSON.stringify(catalogue), { headers: { 'content-type': 'application/json' } });
  } };
  // Like the original simulated-layout seed, this describes fixture data before
  // the passive/action baseline. It is not a user Save or an import operation.
  card._layout = { ...card._layout,
    scene_previews: { enabled: true, items: [{ id: 'user_editor_preview', label: 'User_<b>Preview_été', scene_entity: entities.scene,
      lights: [{ entity: entities.lamp, state: 'on', brightness: 128, color: { mode: 'rgb', rgb: [12, 34, 56] }, extra: 'User_Light_été' }] }], extra: 'User_Scene_été' },
    floor_presentation: { mode: 'horizontal', axis: 'east', gap_m: 2, floors: ['locale_ground', 'locale_upper'], extra: 'User_Floor_été' },
    wall_presentation: { enabled: false, mode: 'fade', scope: 'all_selected', opacity: .25, walls: [], extra: 'User_Wall_été' },
    furniture: { version: 1, instances: [{ id: 'user_instance', pack_id: packId, item_id: item.id, asset_sha256: assetHash,
      floor_id: 'user_missing_floor', x: 2, y: -3, z: .5, rotation_degrees: 90, scale: 1, extra: 'User_Instance_été' }], extra: 'User_Furniture_été' },
  };
  card.resetHistory(); card._syncScenePreviews(); card._syncFurniture(); card._syncWallPresentation();
  f.extraLiteralData = { packId, assetHash, packName: manifest.name, itemName: item.name, sceneName: names.scene };
}
