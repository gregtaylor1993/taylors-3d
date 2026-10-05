// Authored model and simulated HA transport/readings only. Real Root, renderer,
// DevicePopup and RoomActionsEditor run in source/bundle. No household data,
// photographs, actual camera video or real HA permission/persistence claim.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { floorPresentationFixtureGlb, floorFixtureEntities, floorFixtureIds } from './floor-presentation-fixture.mjs';

export const roomActionIds = floorFixtureIds;
export const roomActionEntities = Object.freeze({ ...floorFixtureEntities, media:'media_player.inline_simulated',
  climate:'climate.inline_simulated', cover:'cover.inline_simulated', lock:'lock.inline_simulated', vacuum:'vacuum.inline_simulated',
  scene:'scene.room_simulated', script:'script.room_simulated' });
export const roomActionLayoutKey = 'room-actions-native';
export const roomActionRoomId = 'm:fp_room_upper';

export function roomActionsLayout(bytes = floorPresentationFixtureGlb().length) {
  return {version:1,floors:[{id:'ground',name:'Simulated ground',elevation:0,height:3},{id:'upper',name:'Simulated upper',elevation:4,height:3}],
    rooms:[],pins:{},hidden:[],groups:{},objects:Object.fromEntries(['lamp','switch','camera','door'].map((key)=>[roomActionIds[key],{entity:roomActionEntities[key]}])),
    model:{version:1,name:'Simulated authored two-storey bench.glb',size:bytes,position:[0,0,0],rotation:0,scale:1,opacity:1,
      levels:{[roomActionIds.ground]:{floor:'ground',auto:false},[roomActionIds.upper]:{floor:'upper',auto:false},[roomActionIds.background]:{floor:null,auto:false}},
      rooms:{[roomActionIds.groundRoom]:{area:'simulated-ground',auto:false},[roomActionIds.upperRoom]:{area:'simulated-upper',auto:false}}},
    room_actions:{version:1,rooms:[{room_id:roomActionRoomId,actions:[{id:'scene-shortcut',entity:roomActionEntities.scene,label:'User_<b>Evening_été'},
      {id:'script-shortcut',entity:roomActionEntities.script,label:'User_Script_été'}],extension:{retain:'room extra'}}],extension:{retain:['α',false,null]}},
    ambient_idle:{enabled:false},scene_previews:{enabled:false},weather:{enabled:false},security_bindings:[],presence_bindings:[],vehicle_bindings:[],
    vacuum_bindings:[],room_overlays:{mode:'off'},alert_bindings:[],furniture:{instances:[]},extension:{fixture:'Explicit simulation, never household readings'}};
}

// A bounded saved list, independent of the production limit constant. Only the
// upper room exists in this saved list; obsolete rows are explicit empty imports.
// The real GLB also has a current ground room so capacity recovery is observable.
export function roomActionsCapacityLayout(bytes = floorPresentationFixtureGlb().length) {
  const layout=roomActionsLayout(bytes);
  layout.room_actions.rooms.push(...Array.from({length:127},(_,index)=>({room_id:`simulated-obsolete-${String(index+1).padStart(3,'0')}`,
    actions:[],extension:{retain:`empty-obsolete-row-${index+1}`}})));
  return layout;
}

export function roomActionsReadings() {
  const e=roomActionEntities;
  const read=(entity_id,state,attributes={})=>({entity_id,state,last_changed:'2026-01-01T00:00:00Z',last_updated:'2026-01-01T00:00:00Z',attributes});
  const states=Object.fromEntries(Object.values(e).map((id)=>[id,read(id,'off',{friendly_name:'Simulated '+id})]));
  Object.assign(states,{
    [e.media]:read(e.media,'playing',{friendly_name:'User_Player_été',supported_features:16384+4096+32+16+8+4+1,
      volume_level:.5,is_volume_muted:false,media_title:'User_Track_<b>été',media_artist:'User_Artist_été'}),
    [e.climate]:read(e.climate,'heat',{friendly_name:'User_Climate_été',supported_features:1,min_temp:10,max_temp:30,target_temp_step:.5,temperature:20,hvac_modes:['off','heat','cool']}),
    [e.cover]:read(e.cover,'open',{friendly_name:'User_Cover_été',supported_features:15,current_position:50}),
    [e.lock]:read(e.lock,'locked',{friendly_name:'User_Lock_été'}),
    [e.vacuum]:read(e.vacuum,'cleaning',{friendly_name:'User_Vacuum_été',supported_features:8192+32+16+8+4,fan_speed:'User_Quiet_été',fan_speed_list:['User_Quiet_été','Turbo']}),
    [e.scene]:read(e.scene,'unknown',{friendly_name:'User_Scene_été'}),[e.script]:read(e.script,'off',{friendly_name:'User_Script_été'}),
    [e.camera]:read(e.camera,'idle',{friendly_name:'Simulated camera boundary'}),[e.switch]:read(e.switch,'on',{friendly_name:'Simulated native switch'}),
    [e.lamp]:read(e.lamp,'on',{friendly_name:'Simulated actual lamp',brightness:180,color_mode:'rgb',supported_color_modes:['rgb'],rgb_color:[255,180,90]}),
    [e.door]:read(e.door,'off',{device_class:'door'}),[e.unrelated]:read(e.unrelated,'1',{}),
    'sun.sun':read('sun.sun','below_horizon',{elevation:-20,azimuth:180})});
  return {states,services:{media_player:{media_play:{},media_pause:{},media_stop:{},media_previous_track:{},media_next_track:{},volume_set:{},volume_mute:{}},
    climate:{set_temperature:{},set_hvac_mode:{}},cover:{open_cover:{},close_cover:{},stop_cover:{},set_cover_position:{}},lock:{lock:{},unlock:{}},
    vacuum:{start:{},pause:{},stop:{},return_to_base:{},set_fan_speed:{}},scene:{turn_on:{}},script:{turn_on:{}},light:{toggle:{},turn_on:{},turn_off:{}},switch:{toggle:{}}}};
}

// Standalone page.evaluate function: its only inputs are serialized fixture data.
// Queued results imitate server completion/rejection, never physical state changes.
export async function prepareRoomActionsFixture({layout,readings,entities,key,style='house'}) {
  const c=document.querySelector('taylors3d-card'),connection=new EventTarget();connection.connected=true;connection.options={auth:{}};
  const user={id:'simulated-room-user',name:'Simulated administrator',is_admin:true,is_active:true,permissions:{fixture_control:true}},auth={};
  const f=window.roomActionsFixture={calls:[],ws:[],commits:0,infos:[],saved:structuredClone(layout),queue:[],pending:[],cameraCards:[],cameraActive:new Set(),entities,user,auth,connection};
  class SimulatedCameraBoundary extends HTMLElement {
    constructor(){super();this.attachShadow({mode:'open'}).innerHTML='<div style="height:120px;display:grid;place-items:center;background:#123346;color:white">SIMULATED camera boundary · no video</div>';}
    connectedCallback(){f.cameraActive.add(this);}disconnectedCallback(){f.cameraActive.delete(this);}
  }
  if(!customElements.get('room-actions-camera-boundary'))customElements.define('room-actions-camera-boundary',SimulatedCameraBoundary);
  window.loadCardHelpers=async()=>({createCardElement(config){const card=document.createElement('room-actions-camera-boundary');card.config=config;f.cameraCards.push(card);return card;}});
  window.addEventListener('hass-more-info',(event)=>f.infos.push(event.detail.entityId));
  const callWS=async(message)=>{f.ws.push(structuredClone(message));
    if(message.type==='taylors3d/layout/get')return{layout:structuredClone(f.saved)};
    if(message.type==='taylors3d/layout/set'){f.saved=structuredClone(message.layout);return{success:true};}
    if(message.type==='frontend/get_user_data')return{value:null};
    if(message.type==='config/entity_registry/list')return Object.values(c._hass.entities);
    if(message.type==='config/device_registry/list')return[];
    if(message.type==='config/area_registry/list')return Object.values(c._hass.areas);
    if(message.type==='config/floor_registry/list')return Object.values(c._hass.floors);
    if(message.type==='camera/capabilities')return{frontend_stream_types:[]};
    throw new Error('Explicitly unimplemented simulated WS: '+message.type);};
  const callService=(...args)=>{f.calls.push(structuredClone(args));const reply=f.queue.shift();
    if(reply==='deferred')return new Promise((resolve,reject)=>f.pending.push({resolve,reject}));
    if(reply==='reject')return Promise.reject(new Error('Simulated server rejected <b>User_Error_été'));
    return Promise.resolve();};
  const upper=[entities.media,entities.climate,entities.cover,entities.lock,entities.vacuum,entities.scene,entities.script,entities.camera,entities.lamp,entities.switch];
  c.setConfig({type:'custom:taylors3d-card',layout_key:key,height:'900px',merge:false,view:'3d',sky_bodies:false,mini_map:false,show_bubble_bar:true,
    control_panel:'right',layout_style:style,house_colour_scheme:'dark',lights:'auto',ambient_idle:{enabled:false}});
  c.hass={user,auth,connection,language:'en',locale:{language:'en',number_format:'language',time_format:'24',first_weekday:'monday'},callService,callWS,
    config:{location_name:'Simulated bench',time_zone:'Europe/London',latitude:null,longitude:null,unit_system:{temperature:'°C'}},
    fetchWithAuth:(url,options)=>fetch(url,{...options,headers:{...options?.headers,authorization:'Bearer simulated-room-actions'}}),
    states:structuredClone(readings.states),services:structuredClone(readings.services),devices:{},
    floors:{ground:{floor_id:'ground',name:'Simulated ground',level:0},upper:{floor_id:'upper',name:'Simulated upper',level:1}},
    areas:{'simulated-ground':{area_id:'simulated-ground',name:'Simulated ground room',floor_id:'ground'},'simulated-upper':{area_id:'simulated-upper',name:'User_Room_été',floor_id:'upper'}},
    entities:Object.fromEntries(Object.values(entities).map((id)=>[id,{entity_id:id,device_id:null,area_id:upper.includes(id)?'simulated-upper':'simulated-ground',hidden:false,disabled_by:null,entity_category:null}]))};
  await c._layoutReady;await c._loadModel();c._setView('upper',{instant:true});c._setMode('top');c.resetHistory();
  f.renderer=c._view.renderer;f.original=structuredClone(c._layout);
  const commit=c._commit.bind(c);c._commit=(...args)=>{f.commits++;return commit(...args);};
  f.patch=(entity,state,attributes={})=>{const old=c._hass.states[entity];c.hass={...c._hass,states:{...c._hass.states,[entity]:{...old,state,attributes:{...old.attributes,...attributes}}}};};
  f.locale=(language)=>{c.hass={...c._hass,language,locale:{...c._hass.locale,language}};};
  f.pulse=(kind,entity=entities.media)=>{
    const old=c._hass;
    if(kind==='connection'){connection.connected=false;c.hass={...old};connection.connected=true;c.hass={...old};}
    if(kind==='account'){c.hass={...old,user:{...old.user,id:'simulated-other-user'}};c.hass={...old};}
    if(kind==='permission'){c.hass={...old,user:{...old.user,permissions:{fixture_control:false}}};c.hass={...old};}
    if(kind==='source'){c.hass={...old,states:{...old.states,[entity]:{...old.states[entity],state:'unavailable'}}};c.hass={...old};}
    if(kind==='service'){const domain=entity.split('.')[0];c.hass={...old,services:{...old.services,[domain]:{}}};c.hass={...old};}
  };
  f.finish=(error)=>{const run=f.pending.shift();if(!run)throw new Error('No deferred fixture action');if(error)run.reject(new Error(error));else run.resolve();};
  f.roomPixel=()=>{
    const room=c._navigationRooms().find((entry)=>entry.room.id==='m:fp_room_upper');
    const polygon=room?.room?.polygon;
    if(!Array.isArray(polygon)||polygon.length<3)throw new Error('The current authored upper room has no exact footprint.');
    const xs=polygon.map((point)=>point[0]),ys=polygon.map((point)=>point[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    for(let row=1;row<8;row++)for(let column=1;column<8;column++){
      const x=minX+(maxX-minX)*column/8,y=minY+(maxY-minY)*row/8;
      const pixel=c._view.screenPoint(x,y,.02,'upper');if(!pixel)continue;
      // A room tap must land on exposed authored floor geometry. The old
      // centre point landed on the legitimate vacuum device marker instead.
      if(c.shadowRoot.elementFromPoint(...pixel)!==c._view.renderer.domElement||c._objectHit(...pixel,52,false))continue;
      const hit=c._view.pickModel(...pixel);
      if(hit?.kind!=='room'||hit.id!==room.room.modelId||!hit.hit?.up)continue;
      f.lastRoomPick={pixel:[...pixel],source:{x,y,floorId:'upper'},roomId:room.room.id,modelId:hit.id};
      return pixel;
    }
    throw new Error('No exposed native canvas point selects the exact authored upper room without a device target.');
  };
}

export function roomActionsHtml(mode) {
  if(!['source','bundle'].includes(mode))throw new Error('Unknown room-actions fixture mode');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Simulated room shortcuts and inline device browser proof</title><link rel="icon" href="data:,">
  <script type="importmap">${JSON.stringify({imports:{three:'/node_modules/three/build/three.module.js','three/addons/':'/node_modules/three/examples/jsm/'}})}</script>
  <style>body{margin:0;padding:8px;font:14px system-ui;background:#dde5ec;color:#162833}main{width:100%;max-width:1400px}p{overflow-wrap:anywhere}
  taylors3d-card{display:block;width:100%;--card-background-color:#fff;--secondary-background-color:#f4f4f4;--primary-text-color:#212121;
  --secondary-text-color:#595959;--primary-color:#007c70;--divider-color:#777;--text-primary-color:#fff}</style></head>
  <body><p>SIMULATED Home Assistant readings, services, camera boundary and model storage · actual card/editor/renderer · no real HA persistence or device result proof</p>
  <main><taylors3d-card></taylors3d-card></main><script type="module">
  class FixtureIcon extends HTMLElement{}if(!customElements.get('ha-icon'))customElements.define('ha-icon',FixtureIcon);
  await import('/${mode==='source'?'src':'dist'}/taylors3d-card.js');window.roomActionsModuleReady=true;
  </script></body></html>`;
}

export async function serveRoomActionsFixture(root,mode) {
  const model=floorPresentationFixtureGlb(),layout=roomActionsLayout(model.length),readings=roomActionsReadings(),requests=[],unexpected=[];
  const types={'.js':'text/javascript','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
  const server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://fixture');requests.push({path:url.pathname,method:request.method});
    const send=(status,type,bytes)=>{response.writeHead(status,{'content-type':type,'cache-control':'no-store'});response.end(bytes);};
    if(url.pathname==='/demo/room-actions-fixture.html')return send(200,'text/html',roomActionsHtml(mode));
    if(url.pathname===`/api/taylors3d/model/${roomActionLayoutKey}`&&request.method==='GET'){
      if(request.headers.authorization!=='Bearer simulated-room-actions')return send(401,'application/json','{}');
      return send(200,'model/gltf-binary',model);}
    if(url.pathname==='/api/taylors3d/furniture'&&request.method==='GET')return send(200,'application/json',JSON.stringify({version:1,packs:[]}));
    const filename=path.resolve(root,'.'+url.pathname);
    if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){
      unexpected.push(url.pathname);return send(404,'text/plain','Unregistered fixture route');}
    response.writeHead(200,{'content-type':types[path.extname(filename)]||'application/octet-stream'});fs.createReadStream(filename).pipe(response);});
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
  return{model,layout,readings,requests,unexpected,base:`http://127.0.0.1:${server.address().port}`,
    close:()=>new Promise((resolve)=>{server.close(resolve);server.closeAllConnections?.();})};
}
