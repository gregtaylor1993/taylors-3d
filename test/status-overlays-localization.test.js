// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { readMeasurement, buildRoomOverlays, alertState, buildAlerts, resolveAlertLocation, StatusOverlays } from '../src/status-overlays.js';
import { readRoomActions, roomActionAvailability, roomActionsFor } from '../src/room-actions.js';
import messages from '../src/translations/status-overlays.js';

const hass=(language)=>({language,locale:{language},user:{id:'User_Account',is_active:true},connection:{connected:true},entities:{},states:{},services:{script:{turn_on:{}},scene:{turn_on:{}}},callService:vi.fn()});
const floors=[{id:'User_Floor_été',elevation:3}],rooms=[{room:{id:'User_Room_ID',floor_id:'User_Floor_été',polygon:[[0,0],[4,0],[4,3],[0,3]]},floorId:'User_Floor_été',name:'User_<b>Room_été'}];
const binding={id:'User_Action_ID',entity:'binary_sensor.user_leak',type:'leak',clear_rule:'latched',label:'User_<b>Alert_été',location_mode:'coordinates',floor_id:'User_Floor_été',x:1,y:2,z:.12};
const reading=(state,attributes={})=>({state,attributes});
const withoutText=(value)=>JSON.parse(JSON.stringify(value,(_key,item)=>{
  if(!item||typeof item!=='object'||Array.isArray(item))return item;
  return Object.fromEntries(Object.entries(item).filter(([key])=>!['label','message','title','totalReason'].includes(key)));
}));

describe('owned status and room-action text across actual HA locales',()=>{
  it('provides the same complete owned-message/primitive-placeholder set in all four languages',()=>{
    const keys=Object.keys(messages.en),parameters=(value)=>[...value.matchAll(/\{([^}]+)\}/g)].map((match)=>match[1]).sort();
    expect(keys.length).toBeGreaterThan(70);
    for(const language of ['de','fr','es']){
      expect(Object.keys(messages[language])).toEqual(keys);
      for(const key of keys){expect(messages[language][key].trim()).not.toBe('');expect(parameters(messages[language][key])).toEqual(parameters(messages.en[key]));}
    }
    expect(messages.en['statusOverlays.alert.latchedRestored']).toBe('Alert latched; stored reading — waiting for a current reading');
    expect(messages.fr['statusOverlays.metric.power']).toBe('Puissance actuelle');expect(messages.es['statusOverlays.alert.missing']).toBe('Falta el sensor');
  });
  it.each([['de','Keine Messung','Temperatur'],['fr','Aucune mesure','Température'],['es','Sin lectura','Temperatura']])('translates %s visible missing-room/legend text while keeping raw room IDs/units/values', (language,missing,title)=>{
    const config={mode:'temperature',bindings:{User_Room_ID:{entities:['sensor.user_raw']}}},input={rooms,floors,states:{},config},before=structuredClone(input);
    const english=buildRoomOverlays(input),localized=buildRoomOverlays({...input,hass:hass(language)});
    expect(localized.rooms[0].label).toBe(`User_<b>Room_été: ${missing}`);expect(localized.legend.title).toBe(title);
    expect(localized.legend.unit).toBe('°C');expect(withoutText(localized)).toEqual(withoutText(english));expect(input).toEqual(before);
  });
  it('localizes partial labels and period diagnostics without translating raw states, period names, source IDs or saved settings',()=>{
    const h=hass('de'),input={rooms,floors,states:{'sensor.user_raw':reading('20',{unit_of_measurement:'°C'})},config:{mode:'temperature',bindings:{User_Room_ID:{entities:['sensor.user_raw','sensor.absent']}}}};
    const partial=buildRoomOverlays({...input,hass:h});expect(partial.rooms[0].label).toBe('User_<b>Room_été: 20 °C (teilweise: 1/2 Messwerte)');
    const missing=readMeasurement({'sensor.user_raw':reading('unknown')},'sensor.user_raw','temperature',{},h);
    expect(missing.diagnostics[0]).toMatchObject({code:'unavailable',entity:'sensor.user_raw',message:'Messwert ist unknown.'});
    const periods=readMeasurement({'sensor.user_raw':reading('4',{unit_of_measurement:'kWh',meter_period:'User_period_été'})},'sensor.user_raw','energy',{period:'day'},h);
    expect(periods.diagnostics[0].message).toBe('Sensorzeitraum user_period_été stimmt nicht mit day überein.');expect(periods.period).toBe('day');
    expect(h.callService).not.toHaveBeenCalled();
  });
  it.each([['de','Leck erkannt','Alarm gespeichert; zum Löschen bestätigen','Gespeicherter Messwert — warten auf einen aktuellen Messwert'],
    ['fr','Fuite détectée','Alerte mémorisée ; confirmer pour effacer','Valeur stockée — en attente d’une valeur actuelle'],
    ['es','Fuga detectada','Alerta retenida; confirmar para borrar','Lectura guardada — esperando una lectura actual']])('translates %s alert labels but keeps real latch/ack/restored state semantics', (language,active,latched,restored)=>{
    const h=hass(language),on=alertState(binding,reading('on'),{},h),hold=alertState(binding,reading('off'),{latched:true},h),old=alertState(binding,reading('off',{restored:true}),{},h);
    expect(on.message).toBe(active);expect(hold.message).toBe(latched);expect(old.message).toBe(restored);
    for(const[state,options]of[[reading('on'),{}],[reading('off'),{latched:true}],[reading('off'),{latched:true,acknowledged:true}],[reading('unknown'),{latched:true}],[reading('off',{restored:true}),{latched:true}]]){
      expect(withoutText(alertState(binding,state,options,h))).toEqual(withoutText(alertState(binding,state,options)));
    }
    const input={bindings:[binding],states:{[binding.entity]:reading('unknown')},rooms,floors,previousLatches:{[binding.id]:true}},before=structuredClone(input);
    const data=buildAlerts({...input,hass:h});expect(data.alerts[0].label.startsWith('User_<b>Alert_été: ')).toBe(true);expect(data.nextLatches[binding.id]).toBe(true);
    expect(withoutText(data)).toEqual(withoutText(buildAlerts(input)));expect(input).toEqual(before);expect(h.callService).not.toHaveBeenCalled();
  });
  it('localizes exact-source location failures without replacing raw missing floor/marker references',()=>{
    const input={...binding,floor_id:'User_missing_floor',extension:{raw:'User_extra_été'}},before=structuredClone(input),h=hass('fr');
    const result=resolveAlertLocation(input,{floors,rooms},h);expect(result.diagnostics[0].message).toBe('Choisissez un étage actuel unique avec une hauteur finie. Les étages manquants ne sont pas remplacés.');
    expect(result.location).toBeNull();expect(result.diagnostics[0].entity).toBe(binding.entity);expect(input).toEqual(before);expect(h.callService).not.toHaveBeenCalled();
  });
  it('translates room-action validation/runtime diagnostics without changing sources, action IDs, context or eligibility',()=>{
    const h=hass('es'),settings={version:1,rooms:[{room_id:'User_Room_ID',actions:[{id:'User_Action_ID',entity:'script.user_exact',label:'User_<b>Action_été'}],extension:{raw:'User_Extra'}}]},before=structuredClone(settings);
    h.states['script.user_exact']=reading('unavailable');
    const localized=roomActionsFor({hass:h,settings,roomId:'User_Room_ID',rooms:[rooms[0].room]}),english=roomActionsFor({hass:{...h,language:'en',locale:{language:'en'}},settings,roomId:'User_Room_ID',rooms:[rooms[0].room]});
    expect(localized.actions[0]).toMatchObject({label:'User_<b>Action_été',id:'User_Action_ID',entityId:'script.user_exact',available:false,
      issue:'Espere un script actual apto, una conexión autenticada y la acción turn_on anunciada.'});expect(localized.contextKey).toBe(english.contextKey);
    expect(readRoomActions(null,h).diagnostics[0].message).toBe('Los accesos de habitación necesitan la versión 1 compatible y una lista de habitaciones. Los datos importados se conservan sin cambios.');
    const de=hass('de');de.connection.connected=false;de.states['scene.user_exact']=reading('unknown');
    expect(roomActionAvailability(de,'scene.user_exact').issue).toBe('Warten Sie auf eine hergestellte Verbindung zu Home Assistant.');
    expect(settings).toEqual(before);expect(h.callService).not.toHaveBeenCalled();
  });
  it('does not evaluate imported accessors or locale getters while translating diagnostics',()=>{
    const getter=vi.fn(()=>{throw new Error('getter must remain unread');}),raw={version:1};Object.defineProperty(raw,'rooms',{get:getter,enumerable:true});
    const h=hass('fr');Object.defineProperty(h,'locale',{get:getter,enumerable:true});
    expect(readRoomActions(raw,h)).toMatchObject({valid:false,diagnostics:[{message:'Les raccourcis de pièce nécessitent les paramètres de version 1 pris en charge et une liste de pièces. Les données importées restent inchangées.'}]});
    expect(getter).not.toHaveBeenCalled();expect(h.callService).not.toHaveBeenCalled();
  });
  it('uses regional HA locales and readable English for unsupported or malformed languages without changing alert eligibility',()=>{
    const state=reading('unknown'),english=alertState(binding,state);
    expect(alertState(binding,state,{},hass('de-CH')).message).toBe('Sensor nicht verfügbar');
    for(const language of ['ja','not a locale'])expect(alertState(binding,state,{},hass(language))).toEqual(english);
  });
  it('changes only retained Three label text and leaves geometry/material UUIDs, pulse/native focus and services intact',()=>{
    const h=hass('en'),states={[binding.entity]:reading('unknown')},input={bindings:[binding],states,rooms,floors,previousLatches:{[binding.id]:true}},parent=new THREE.Group(),invalidate=vi.fn(),layer=new StatusOverlays(parent,{onInvalidate:invalidate});
    const build=(language)=>({...buildRoomOverlays({rooms,floors,config:{mode:'temperature',bindings:{User_Room_ID:{entities:['sensor.absent']}}},hass:hass(language)}),alerts:buildAlerts({...input,hass:hass(language)}).alerts});
    layer.setData(build('en'));const room=layer.rooms.get('User_Floor_été:User_Room_ID'),alert=layer.alerts.get(binding.id),mesh=alert.mesh,label=alert.label,span=label.element.querySelector('span');
    const inputNode=document.createElement('input');document.body.append(inputNode);inputNode.focus();inputNode.value='User_unfinished_été';
    layer.update(500);const pulse=[mesh.scale.x,mesh.material.opacity],ids=[room.mesh.uuid,room.mesh.geometry.uuid,room.mesh.material.uuid,mesh.uuid,mesh.geometry.uuid,mesh.material.uuid,label.uuid];
    invalidate.mockClear();expect(layer.setData(build('de'))).toBe(true);expect(layer.rooms.get('User_Floor_été:User_Room_ID')).toBe(room);expect(layer.alerts.get(binding.id)).toBe(alert);
    expect([room.mesh.uuid,room.mesh.geometry.uuid,room.mesh.material.uuid,mesh.uuid,mesh.geometry.uuid,mesh.material.uuid,label.uuid]).toEqual(ids);
    expect(label.element.querySelector('span')).toBe(span);expect(span.textContent).toBe('User_<b>Alert_été: Alarm gespeichert; Sensor nicht verfügbar');expect(label.element.querySelector('b')).toBeNull();
    expect([mesh.scale.x,mesh.material.opacity]).toEqual(pulse);expect(document.activeElement).toBe(inputNode);expect(inputNode.value).toBe('User_unfinished_été');expect(invalidate).toHaveBeenCalledOnce();
    expect(layer.setData(build('de'))).toBe(false);expect(h.callService).not.toHaveBeenCalled();inputNode.remove();layer.dispose();
  });
});
