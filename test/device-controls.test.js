import { describe, expect, it } from 'vitest';
import { readDeviceControls, deviceCommand } from '../src/device-controls.js';
import captions from '../src/translations/device-controls.js';

const fixture = (domain, attributes = {}, value) => ({
  user: { id: 'actual-user', is_active: true }, connection: { connected: true }, callService: () => {},
  config: { unit_system: { temperature: '°C' } }, entities: {},
  states: { [`${domain}.actual`]: { entity_id: `${domain}.actual`, state: value || ({ media_player: 'playing', climate: 'heat', cover: 'open', lock: 'locked', vacuum: 'cleaning' })[domain], attributes } },
  services: { [domain]: Object.fromEntries(({
    media_player: ['media_play','media_pause','media_stop','media_next_track','media_previous_track','volume_set','volume_mute'],
    climate: ['set_temperature','set_hvac_mode'], cover: ['open_cover','close_cover','stop_cover','set_cover_position'],
    lock: ['lock','unlock'], vacuum: ['start','pause','stop','return_to_base','set_fan_speed'],
  })[domain].map((service) => [service, {}])) },
});
const ids = (hass, domain) => readDeviceControls(hass, `${domain}.actual`).controls.map((control) => control.id);

describe('current HA inline device command contracts', () => {
  it('provides matching fixed English/German/French/Spanish caption catalogues with preserved parameter names',()=>{
    const keys=Object.keys(captions.en);
    for(const language of ['en','de','fr','es']){
      expect(Object.keys(captions[language])).toEqual(keys);
      expect(captions[language]['deviceControls.current'].match(/\{[^}]+\}/g)).toEqual(['{value}']);
    }
    expect(captions.de['deviceControls.temperature']).toBe('Zieltemperatur');expect(captions.fr['deviceControls.roomActions']).toBe('Actions de la pièce');expect(captions.es['deviceControls.volume']).toBe('Volumen');
  });
  it('reads official capability flags and emits exact independently specified service payloads', () => {
    const media = fixture('media_player', { supported_features: 1+4+8+16+32+4096+16384, volume_level: .37, is_volume_muted: false });
    expect(ids(media,'media_player')).toEqual(['play','pause','stop','previous','next','mute','volume']);
    expect(deviceCommand(media,'media_player.actual','volume','42')).toEqual({ domain:'media_player',service:'volume_set',data:{entity_id:'media_player.actual',volume_level:.42} });
    expect(deviceCommand(media,'media_player.actual','mute')).toEqual({domain:'media_player',service:'volume_mute',data:{entity_id:'media_player.actual',is_volume_muted:true}});
    const climate = fixture('climate',{supported_features:1,min_temp:7,max_temp:35,target_temp_step:.5,temperature:20,hvac_modes:['off','heat','cool']});
    expect(deviceCommand(climate,'climate.actual','temperature','21.5')).toEqual({domain:'climate',service:'set_temperature',data:{entity_id:'climate.actual',temperature:21.5}});
    expect(deviceCommand(climate,'climate.actual','hvac-mode','cool')).toEqual({domain:'climate',service:'set_hvac_mode',data:{entity_id:'climate.actual',hvac_mode:'cool'}});
    const cover=fixture('cover',{supported_features:15,current_position:0});
    expect(ids(cover,'cover')).toEqual(['open','close','stop','position']);
    expect(deviceCommand(cover,'cover.actual','position','0')).toEqual({domain:'cover',service:'set_cover_position',data:{entity_id:'cover.actual',position:0}});
    const lock=fixture('lock',{supported_features:0});
    expect(ids(lock,'lock')).toEqual(['lock','unlock']);
    expect(deviceCommand(lock,'lock.actual','unlock')).toEqual({domain:'lock',service:'unlock',data:{entity_id:'lock.actual'}});
    const vacuum=fixture('vacuum',{supported_features:8192+4+8+16+32,fan_speed_list:['Quiet_été','Max'],fan_speed:'Quiet_été'});
    expect(ids(vacuum,'vacuum')).toEqual(['start','pause','stop','dock','fan-speed']);
    expect(deviceCommand(vacuum,'vacuum.actual','dock')).toEqual({domain:'vacuum',service:'return_to_base',data:{entity_id:'vacuum.actual'}});
    expect(deviceCommand(vacuum,'vacuum.actual','fan-speed','Quiet_été')).toEqual({domain:'vacuum',service:'set_fan_speed',data:{entity_id:'vacuum.actual',fan_speed:'Quiet_été'}});
  });
  it('never guesses capabilities, scalar bounds, enums or zero readings', () => {
    const media=fixture('media_player',{supported_features:'16384'}); expect(ids(media,'media_player')).toEqual([]);
    const climate=fixture('climate',{supported_features:1,temperature:null,hvac_modes:['invented-mode']});
    expect(ids(climate,'climate')).toEqual([]);
    const cover=fixture('cover',{supported_features:4,current_position:null});
    expect(readDeviceControls(cover,'cover.actual').controls[0].value).toBeNull();
    expect(deviceCommand(cover,'cover.actual','position','')).toBeNull();
    const lock=fixture('lock',{code_format:'^\\d{4}$'}); expect(ids(lock,'lock')).toEqual([]);
    const vacuum=fixture('vacuum',{supported_features:32,fan_speed_list:['Quiet','Quiet']});expect(ids(vacuum,'vacuum')).toEqual([]);
    const malformed=fixture('lock',new Date());expect(deviceCommand(malformed,'lock.actual','unlock')).toBeNull();
    lock.states['lock.actual'].attributes={};lock.services.lock.unlock='unsupported';expect(deviceCommand(lock,'lock.actual','unlock')).toBeNull();
    const range=fixture('climate',{supported_features:3,min_temp:7,max_temp:35,temperature:20},'heat_cool');expect(ids(range,'climate')).toEqual([]);
  });
  it.each(['service','unknown','restored','hidden','diagnostic','disabled','account','connection'])('rejects %s loss using current source context', (reason) => {
    const h=fixture('media_player',{supported_features:16384});
    expect(deviceCommand(h,'media_player.actual','play')).not.toBeNull();
    if(reason==='service')delete h.services.media_player.media_play;
    if(reason==='unknown')h.states['media_player.actual'].state='unknown';
    if(reason==='restored')h.states['media_player.actual'].attributes.restored=true;
    if(reason==='hidden')h.entities['media_player.actual']={hidden_by:'user'};
    if(reason==='diagnostic')h.entities['media_player.actual']={entity_category:'diagnostic'};
    if(reason==='disabled')h.entities['media_player.actual']={disabled_by:'user'};
    if(reason==='account')h.user.is_active=false;
    if(reason==='connection')h.connection.connected=false;
    expect(deviceCommand(h,'media_player.actual','play')).toBeNull();
  });
  it.each([
    ['media_player',{supported_features:4,volume_level:.5},'volume','37','volume_set',{volume_level:.37}],
    ['climate',{hvac_modes:['off','heat','cool']},'hvac-mode','cool','set_hvac_mode',{hvac_mode:'cool'}],
    ['cover',{supported_features:4,current_position:50},'position','0','set_cover_position',{position:0}],
    ['lock',{},'unlock',undefined,'unlock',{}],
    ['vacuum',{supported_features:32,fan_speed_list:['Quiet_été','Turbo'],fan_speed:'Turbo'},'fan-speed','Quiet_été','set_fan_speed',{fan_speed:'Quiet_été'}],
  ])('%s rejects every malformed/restored flag but preserves exact actual commands when absent or false',(domain,attributes,control,value,service,data)=>{
    const h=fixture(domain,attributes),entity=`${domain}.actual`,expected={domain,service,data:{entity_id:entity,...data}};
    expect(deviceCommand(h,entity,control,value)).toEqual(expected);
    attributes.restored=false;expect(deviceCommand(h,entity,control,value)).toEqual(expected);
    for(const restored of ['false',0,null,{},undefined,true]){
      attributes.restored=restored;const reading=readDeviceControls(h,entity);
      expect(reading.available).toBe(false);expect(reading.controls.every((item)=>item.available===false)).toBe(true);
      expect(deviceCommand(h,entity,control,value)).toBeNull();
    }
    delete attributes.restored;expect(deviceCommand(h,entity,control,value)).toEqual(expected);
  });
  it('rejects stale/invalid scalar and enum data against the current advertised bounds/options', () => {
    const climate=fixture('climate',{supported_features:1,min_temp:10,max_temp:25,target_temp_step:.5,temperature:20,hvac_modes:['off','heat']});
    for(const value of ['',null,'26','NaN',Infinity,'20.2'])expect(deviceCommand(climate,'climate.actual','temperature',value)).toBeNull();
    expect(deviceCommand(climate,'climate.actual','hvac-mode','cool')).toBeNull();
    const media=fixture('media_player',{supported_features:4,volume_level:0});
    expect(readDeviceControls(media,'media_player.actual').controls[0].value).toBe(0);
    for(const value of ['-1','101','',null])expect(deviceCommand(media,'media_player.actual','volume',value)).toBeNull();
    const cover=fixture('cover',{supported_features:4});expect(deviceCommand(cover,'cover.actual','position','10.5')).toBeNull();
  });
});
