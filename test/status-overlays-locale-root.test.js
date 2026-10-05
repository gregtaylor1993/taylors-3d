// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';
import { StatusOverlays } from '../src/status-overlays.js';

// Actual Root status/map producers and native MiniMap/Three helpers. The view and
// unrelated feature owners are bounded stubs; this fixture creates no WebGL renderer.
const floor={id:'User_Floor_été',name:'User floor',elevation:3};
const room={id:'User_Room_ID',floor_id:floor.id,polygon:[[0,0],[4,0],[4,3],[0,3]]};
const binding={id:'User_Alert_ID',entity:'binary_sensor.user_leak',label:'User_<b>Alert_été',type:'leak',clear_rule:'latched',
  location_mode:'coordinates',floor_id:floor.id,x:1.25,y:2.75,z:.12};
const fixtures=[];
function fixture(){
  const card=document.createElement('taylors3d-card'),stage=document.createElement('div');document.body.append(stage);
  Object.defineProperty(card,'isConnected',{value:true,configurable:true});
  card._stage=stage;card._config={layout_key:'locale-status-source',mini_map_size:180};
  card._layout={alert_bindings:[structuredClone(binding)],room_overlays:{mode:'temperature',bindings:{User_Room_ID:{entities:['sensor.user_absent']}}},
    room_actions:{version:1,rooms:[{room_id:room.id,actions:[{id:'User_Action_ID',entity:'script.user_exact',label:'User_<b>Shortcut_été'}]}]}};
  card._roomList=[{floorId:floor.id,name:'User_<b>Room_été',room:structuredClone(room)}];card._floors=[structuredClone(floor)];
  card._positions=new Map();card._objects=null;card._editing=false;card._loading=false;card._miniMapVisible=true;
  card._hass={locale:{language:'en'},states:{[binding.entity]:{state:'on',attributes:{}},'script.user_exact':{state:'unavailable',attributes:{}}},
    entities:{},user:{id:'User_Account',is_active:true,is_admin:false},connection:{connected:true},auth:{},
    services:{script:{turn_on:{}}},callService:vi.fn(),callWS:vi.fn()};
  card._view={floorElevation:()=>3,getCamera:()=>null,getTopCamera:()=>null};
  card._navigationRooms=()=>card._roomList;card._navigationFloors=()=> 'all';card.trackingAnchors=()=>[];
  const invalidated=vi.fn(),layer=new StatusOverlays(new THREE.Group(),{onInvalidate:invalidated});card._statusOverlays=layer;
  card._statusLegend=document.createElement('div');card._statusLegend.innerHTML='<strong></strong><div class="scale"></div><span></span>';stage.append(card._statusLegend);
  card._popup={close:vi.fn()};card._devicePopup={close:vi.fn()};
  for(const name of ['_syncToolbarLabels','_syncToolbar','_syncFloorPresentation','_syncSecurity','_syncTracking','_syncWeather',
    '_syncCameraCoverage','_syncFurniture','_syncHouseShell','_syncScenePreviews','_syncAmbient','_suspendAmbient','_stopScenePreview','_schedule'])card[name]=vi.fn();
  card._presetEvents.setHass=vi.fn();card._focusPlan=vi.fn();card._miniMapSourceCamera=(snapshot)=>snapshot;
  const info=vi.fn();card.addEventListener('hass-more-info',info);card._configureMiniMap();
  const marker=()=>card._miniMap.el.querySelector('.map-marker.alert');
  const locale=(language)=>{card._hass.locale.language=language;card.hass=card._hass;card._syncMiniMap();};
  fixtures.push({card,stage,layer});return{card,layer,marker,locale,invalidated,info};
}
afterEach(()=>{for(const{card,stage,layer}of fixtures.splice(0)){
  card._miniMap?.dispose();layer.dispose();card._ambientController.dispose();card._scenePreviewController.dispose();card._presetEvents.disconnect();stage.remove();
}vi.restoreAllMocks();});
const pointer=(node,type)=>node.dispatchEvent(new Event(type,{bubbles:true}));
const click=(node)=>node.dispatchEvent(new MouseEvent('click',{bubbles:true}));

describe('actual Root locale-only room overlays and alerts',()=>{
  it('observes an in-place HA locale change with identical source references and retains focused native markers/Three UUIDs/pulse',()=>{
    const{card,layer,marker,locale,invalidated}=fixture(),original=marker();expect(original).toBeTruthy();original.focus();
    const sourceRefs=[card._layout,card._hass.states,card._hass.entities,card._roomList,card._floors,card._positions],saved=structuredClone(card._layout);
    const part=layer.alerts.get(binding.id),roomPart=layer.rooms.get(`${floor.id}:${room.id}`),span=part.label.element.querySelector('span');
    const uuids=[part.mesh.uuid,part.mesh.geometry.uuid,part.mesh.material.uuid,part.label.uuid,roomPart.mesh.uuid,roomPart.mesh.geometry.uuid,roomPart.mesh.material.uuid];
    layer.update(500);const pulse=[part.mesh.scale.x,part.mesh.material.opacity],generation=card._alertMapGeneration;
    const setData=vi.spyOn(layer,'setData');invalidated.mockClear();card._syncMiniMap();expect(setData).not.toHaveBeenCalled();
    locale('de');expect(marker()).toBe(original);expect(document.activeElement).toBe(original);expect(card._alertMapGeneration).toBe(generation);
    expect(original.getAttribute('aria-label')).toContain('User_<b>Alert_été: Leck erkannt');
    expect(card._statusLegend.querySelector('strong').textContent).toBe('Temperatur');expect(card._statusLegend.querySelector('span').textContent).toContain('Grau bedeutet keinen gültigen Messwert');
    expect(roomPart.label.element.textContent).toBe('User_<b>Room_été: Keine Messung');expect(part.label.element.querySelector('span')).toBe(span);expect(span.textContent).toBe('User_<b>Alert_été: Leck erkannt');
    expect(part.label.element.querySelector('b')).toBeNull();expect(original.querySelector('b')).toBeNull();
    expect([part.mesh.uuid,part.mesh.geometry.uuid,part.mesh.material.uuid,part.label.uuid,roomPart.mesh.uuid,roomPart.mesh.geometry.uuid,roomPart.mesh.material.uuid]).toEqual(uuids);
    expect([part.mesh.scale.x,part.mesh.material.opacity]).toEqual(pulse);expect(setData).toHaveBeenCalledOnce();expect(invalidated).toHaveBeenCalledOnce();
    [card._layout,card._hass.states,card._hass.entities,card._roomList,card._floors,card._positions].forEach((value,index)=>expect(value).toBe(sourceRefs[index]));expect(card._layout).toEqual(saved);
    expect(card._alertLatches[binding.id]).toBe(true);expect(card._alertData.alerts[0].location).toEqual({x:1.25,y:2.75,z:.12,floorId:floor.id,elevation:3});
    card._syncMiniMap();expect(setData).toHaveBeenCalledOnce();expect(card._hass.callService).not.toHaveBeenCalled();expect(card._hass.callWS).not.toHaveBeenCalled();expect(card._trackingTimer).toBeNull();
  });
  it('keeps a deliberate held alert gesture valid across language alone, and opens only its exact native info',()=>{
    const{card,marker,locale,info}=fixture(),original=marker(),generation=card._alertMapGeneration;pointer(original,'pointerdown');
    locale('fr');expect(marker()).toBe(original);expect(card._alertMapGeneration).toBe(generation);
    expect(original.getAttribute('aria-label')).toContain('User_<b>Alert_été: Fuite détectée');pointer(original,'pointerup');click(original);
    expect(info).toHaveBeenCalledOnce();expect(info.mock.lastCall[0].detail.entityId).toBe(binding.entity);expect(card._focusPlan).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled();expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('updates current unknown/restored captions while keeping raw readings, an unrelated focused draft and explicit acknowledgment semantics',()=>{
    const{card,marker,locale}=fixture(),draft=document.createElement('input');card._stage.append(draft);draft.value='User_unfinished_été';draft.focus();
    const original=marker();card._hass.states[binding.entity].state='unknown';locale('es');
    expect(marker()).toBe(original);expect(original.getAttribute('aria-label')).toContain('Alerta retenida; sensor no disponible');
    expect(card._hass.states[binding.entity].state).toBe('unknown');expect(document.activeElement).toBe(draft);expect(draft.value).toBe('User_unfinished_été');
    card._hass.states[binding.entity]={state:'off',attributes:{restored:true}};card.hass=card._hass;card._syncMiniMap();
    expect(marker()).toBe(original);expect(original.getAttribute('aria-label')).toContain('Alerta retenida; lectura guardada — esperando una lectura actual');
    expect(card._alertLatches[binding.id]).toBe(true);expect(card._hass.states[binding.entity]).toEqual({state:'off',attributes:{restored:true}});
    card._hass.states[binding.entity]={state:'off',attributes:{}};card._acknowledgedAlerts=[binding.id];card._statusRefs=null;card._syncMiniMap();
    expect(marker()).toBeNull();expect(card._alertLatches[binding.id]).toBe(false);expect(document.activeElement).toBe(draft);
    expect(card._hass.callService).not.toHaveBeenCalled();expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('returns localized current room-shortcut diagnostics through the actual Root callback without changing raw saved data/context or sending a command',()=>{
    const{card,locale}=fixture(),saved=structuredClone(card._layout),english=card._roomShortcutData(room.id);locale('fr');
    const french=card._roomShortcutData(room.id);expect(french.contextKey).toBe(english.contextKey);expect(french.actions[0]).toMatchObject({
      id:'User_Action_ID',entityId:'script.user_exact',label:'User_<b>Shortcut_été',available:false,
      issue:'Attendez un script actuel admissible, une connexion authentifiée et l’action turn_on annoncée.'});
    expect(card._layout).toEqual(saved);expect(card._hass.callService).not.toHaveBeenCalled();expect(card._hass.callWS).not.toHaveBeenCalled();
  });
});
