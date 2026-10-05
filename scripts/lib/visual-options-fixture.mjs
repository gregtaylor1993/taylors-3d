// Original simulated readings/model and an explicitly simulated HA form host.
// The actual card/editor/renderer run unchanged. This is not HA persistence proof.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { floorPresentationFixtureGlb, floorFixtureEntities, floorFixtureIds } from './floor-presentation-fixture.mjs';

export const visualEntities = Object.freeze({ ...floorFixtureEntities, motion: 'binary_sensor.visual_motion',
  parking: 'binary_sensor.visual_parking', event: 'event.visual_vehicle', vacuum: 'vacuum.visual_cleaner', xy: 'sensor.visual_xy' });
export const visualIds = floorFixtureIds;
export const visualLayoutKey = 'visual-options-native';
export function roomlessVisualGlb() {
  const original = floorPresentationFixtureGlb(), length = original.readUInt32LE(12);
  const document = JSON.parse(original.subarray(20, 20 + length).toString('utf8'));
  // Remove only deliberately authored room tags in the source fixture. Actual
  // GLTFLoader/manifest resolution now sees a genuinely roomless house model.
  for (const node of document.nodes) if (node.extras?.fp?.kind === 'room') delete node.extras.fp;
  const raw = Buffer.from(JSON.stringify(document)), json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
  const tail = original.subarray(20 + length), header = Buffer.from(original.subarray(0, 20));
  header.writeUInt32LE(20 + json.length + tail.length, 8); header.writeUInt32LE(json.length, 12);
  return Buffer.concat([header, json, tail]);
}
export function visualOptionsLayout(bytes = floorPresentationFixtureGlb().length) {
  return { version: 1, floors: [{ id: 'ground', name: 'Simulated ground', elevation: 0, height: 3 },
    { id: 'upper', name: 'Simulated upper', elevation: 4, height: 3 }],
  // Authored model visibility and linked HA floors are independent. This proof
  // deliberately exercises actors on both floors through the same overview.
  views: { all: { floors: ['ground', 'upper'] } },
  rooms: [{ id: 'visual-room', name: 'Simulated source room', floor_id: 'ground', polygon: [[-2, -1], [2, -1], [2, 1], [-2, 1]], doors: [] }],
  pins: {}, hidden: [], objects: Object.fromEntries(['lamp', 'switch', 'camera', 'door'].map((key) => [visualIds[key], { entity: visualEntities[key] }])),
  groups: {}, model: { version: 1, name: 'Simulated uploaded visual bench.glb', size: bytes, position: [0, 0, 0], rotation: 0, scale: 1, opacity: 1,
    levels: { [visualIds.ground]: { floor: 'ground', auto: false }, [visualIds.upper]: { floor: 'upper', auto: false }, [visualIds.background]: { floor: null, auto: false } },
    rooms: { [visualIds.groundRoom]: { area: 'visual-ground', auto: false }, [visualIds.upperRoom]: { area: 'visual-upper', auto: false } } },
  presence_bindings: [{ id: 'activity', entity: visualEntities.motion, kind: 'room_activity', signal: 'motion', roomId: 'visual-room',
    active_states: ['on'], clear_states: ['off'], extension: { unchanged: ['α', null, false] } },
    { id: 'raw-style', entity: visualEntities.motion, kind: 'room_activity', signal: 'motion', roomId: 'visual-room',
      active_states: ['on'], clear_states: ['off'], enabled: false, color: 'imported-malformed-colour', size: 99, heading: 'raw-angle', extension: 'retain me' }],
  vehicle_bindings: [{ id: 'parking', entity: visualEntities.parking, kind: 'occupancy', vehicle_source_confirmed: true,
    active_states: ['on'], clear_states: ['off'], position: { x: 1.4, y: -.6, z: .05, floorId: 'ground' } },
    { id: 'event', entity: visualEntities.event, kind: 'event', vehicle_source_confirmed: true, timestamp_mode: 'state', timestamp_format: 'iso',
      event_types: ['vehicle'], expires_seconds: 300, position: { x: 1.6, y: -.8, z: .05, floorId: 'ground' } }],
  vacuum_bindings: [{ id: 'measured', entity: visualEntities.vacuum, kind: 'xy', position: { x: -1, y: .5, z: .05, floorId: 'ground' },
    position_source: { entity: visualEntities.xy, source: 'xy', x_attr: 'x', y_attr: 'y', units: 'm', plan_meters: true, floorId: 'ground' } }],
  camera_coverage: { [`object:${visualIds.camera}`]: { enabled: true, heading: 90, fov: 70, range: 8, color: '#03a9f4', opacity: .14, show_rays: true, segments: 24, extension: 'retain camera extra' } },
  alert_bindings: [{ id: 'location', entity: visualEntities.leak, type: 'leak', roomId: 'visual-room', x: 1, y: 1, z: .2,
    floorId: 'ground', clear_rule: 'state', extension: { untouched: true } }],
  model_rendering: { shadows: 'realtime', lamps: 'inherit', extension: 'retain rendering extra' },
  ambient_idle: { enabled: false }, scene_previews: { enabled: false }, weather: { enabled: false }, security_bindings: [],
  room_overlays: { mode: 'off' }, furniture: { instances: [] }, extension: { fixture: 'Explicitly simulated, never household data' } };
}

function html(mode) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Simulated advanced visual settings browser proof</title><link rel="icon" href="data:,">
  <script type="importmap">${JSON.stringify({ imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } })}</script>
  <style>body{margin:0;padding:12px;font:14px system-ui;background:#e9eef2;color:#172833}main{width:100%;max-width:1200px}
  taylors3d-card{display:block;width:100%;--card-background-color:#fff;--secondary-background-color:#f4f4f4;--primary-text-color:#212121;
  --secondary-text-color:#595959;--primary-color:#007c70;--divider-color:#777;--text-primary-color:#fff}
  #form-host{margin-top:20px;padding:12px;background:#fff}ha-form{display:block}ha-form label{display:block;margin:10px 0}
  ha-form input{min-height:44px;max-width:100%;box-sizing:border-box;font:inherit}ha-form button{min-height:44px;font:inherit}</style></head>
  <body><p>SIMULATED HA readings/model storage/form host · actual Taylor's 3D card/editors · no actual dashboard or server persistence proof</p>
  <main><taylors3d-card></taylors3d-card><section id="form-host" hidden><h2>Simulated Home Assistant visual form host</h2></section></main>
  <script type="module">
  class FixtureIcon extends HTMLElement {} if(!customElements.get('ha-icon'))customElements.define('ha-icon',FixtureIcon);
  // This host renders only selected real-schema controls and emits HA's actual
  // value-changed contract. It does not imitate HA authorization/persistence.
  class FixtureForm extends HTMLElement {
    set schema(value){this._schema=value;this.render();}get schema(){return this._schema;}
    set data(value){this._data=value;this.render();}get data(){return this._data;}
    render(){if(!this._data||!this._schema)return; const fields=this._schema.flatMap(s=>s.schema||[s]).flatMap(s=>s.schema||[s]);
      for(const name of ['model','model_position_x','model_position_y','model_position_z','model_opacity']){
        const schema=fields.find(s=>s.name===name);if(!schema)continue;let label=this.querySelector('[data-form-label="'+name+'"]');
        if(!label){label=document.createElement('label');label.dataset.formLabel=name;const caption=document.createElement('span');
          caption.textContent=this.computeLabel?.(schema)||name;const input=document.createElement('input');input.dataset.haField=name;
          input.type=name==='model'?'text':'number';input.step='any';input.addEventListener('change',()=>{const reported=input.type==='number'&&input.value!==''?input.valueAsNumber:input.value;
            const value={...this._data,[name]:reported};
            this.dispatchEvent(new CustomEvent('value-changed',{detail:{value},bubbles:true,composed:true}));});label.append(caption,input);this.append(label);}
        const input=label.querySelector('input');if(document.activeElement!==input)input.value=String(this._data[name]??'');}
    }
  }if(!customElements.get('ha-form'))customElements.define('ha-form',FixtureForm);
  await import('/${mode === 'source' ? 'src' : 'dist'}/taylors3d-card.js');window.visualModuleReady=true;
  </script></body></html>`;
}

export async function serveVisualOptionsFixture(root, mode) {
  if (!['source', 'bundle'].includes(mode)) throw new Error('Unknown visual fixture mode');
  const model = floorPresentationFixtureGlb(), roomlessModel = roomlessVisualGlb(), layout = visualOptionsLayout(model.length), requests = [], unexpected = [];
  const types = { '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture'); requests.push({ path: url.pathname, method: request.method });
    const send = (status, type, bytes) => { response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); response.end(bytes); };
    if (url.pathname === '/demo/visual-options-fixture.html') return send(200, 'text/html', html(mode));
    if (url.pathname === '/demo/visual-options-url.glb') return send(200, 'model/gltf-binary', model);
    if (url.pathname === `/api/taylors3d/model/${visualLayoutKey}` && request.method === 'GET') {
      if (request.headers.authorization !== 'Bearer simulated-visual-options') return send(401, 'application/json', '{}');
      return send(200, 'model/gltf-binary', url.searchParams.get('v') === '2' ? roomlessModel : model);
    }
    if (url.pathname === '/api/taylors3d/furniture' && request.method === 'GET') return send(200, 'application/json', JSON.stringify({ version: 1, packs: [] }));
    const filename = path.resolve(root, '.' + url.pathname);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      unexpected.push(url.pathname); return send(404, 'text/plain', 'Unregistered fixture route');
    }
    response.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' }); fs.createReadStream(filename).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { layout, model, requests, unexpected, base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }) };
}
