import { describe, expect, it, vi } from 'vitest';
import { buildRoomOverview } from '../src/room-summary.js';

const fixture = () => ({user:{id:'user',is_active:true},connection:{connected:true},states:{},entities:{},devices:{},
  config:{unit_system:{temperature:'°C'}},callService:vi.fn()});
const add = (hass,id,state,attributes) => hass.states[id] = {entity_id:id,state,attributes};
const read = (hass,entityIds = Object.keys(hass.states)) => buildRoomOverview({hass,entityIds});
describe('actual room glance readings', () => {
  it('shows linked temperature sources separately with exact units and registry precision', () => {
    const h = fixture(); add(h,'sensor.one','19.56',{device_class:'temperature',unit_of_measurement:'°C',friendly_name:'Actual_<b>sensor'});
    add(h,'sensor.two','68.1',{device_class:'temperature',unit_of_measurement:'°F',friendly_name:'Other sensor'});
    add(h,'sensor.unlinked','99',{device_class:'temperature',unit_of_measurement:'°C'}); h.entities['sensor.one'] = {display_precision:1};
    expect(read(h,['sensor.one','sensor.two','sensor.one']).temperatures).toEqual([
      {entityId:'sensor.one',name:'Actual_<b>sensor',value:'19.6 °C'},{entityId:'sensor.two',name:'Other sensor',value:'68.1 °F'}]);
    expect(h.callService).not.toHaveBeenCalled();
  });
  it('shows measured climate temperature, never its target or heating state', () => {
    const h = fixture(); add(h,'climate.room','heat',{current_temperature:18.5,temperature:22,friendly_name:'Actual thermostat'});
    expect(read(h).temperatures).toEqual([{entityId:'climate.room',name:'Actual thermostat',value:'18.5 °C'}]);
    delete h.states['climate.room'].attributes.current_temperature; expect(read(h).temperatures).toEqual([]);
  });
  it.each(['unknown','unavailable'])('does not revive retained climate temperature attributes while its current source is %s', (state) => {
    const h=fixture(); add(h,'climate.room',state,{current_temperature:18.5,temperature:22}); expect(read(h).temperatures).toEqual([]);
  });
  it.each(['unknown','unavailable','','true',' 19 ',Infinity,NaN])('does not fabricate temperature for %s', (value) => {
    const h = fixture(); add(h,'sensor.room',value,{device_class:'temperature',unit_of_measurement:'°C'}); expect(read(h).temperatures).toEqual([]);
  });
  it('does not guess a missing unit or reinterpret weather, set points, brightness or power as temperature', () => {
    const h = fixture(); add(h,'sensor.no_unit','19',{device_class:'temperature'}); add(h,'sensor.power','190',{device_class:'power',unit_of_measurement:'W'});
    add(h,'weather.home','rainy',{temperature:19}); add(h,'light.room','on',{brightness:19}); add(h,'climate.room','heat',{temperature:22});
    expect(read(h).temperatures).toEqual([]); expect(read(h).media).toEqual([]);
  });
  it('retains literal media name/title and actual playing/paused state without scene inference', () => {
    const h = fixture(); add(h,'media_player.room','playing',{friendly_name:'Player_<b>',media_title:'Track_<b>'});
    expect(read(h).media).toEqual([{entityId:'media_player.room',name:'Player_<b>',value:'Playing · Track_<b>'}]);
    h.states['media_player.room'].state = 'paused'; expect(read(h).media[0].value).toBe('Paused · Track_<b>');
  });
  it.each(['hidden_by','disabled_by','entity_category'])('rechecks current %s and restored/disconnected sources', (key) => {
    const h = fixture(); add(h,'sensor.room','19',{device_class:'temperature',unit_of_measurement:'°C'}); h.entities['sensor.room'] = {[key]:'user'};
    expect(read(h).temperatures).toEqual([]); h.entities = {}; h.states['sensor.room'].attributes.restored = true;
    expect(read(h).temperatures).toEqual([]); h.states['sensor.room'].attributes.restored = false; h.connection.connected = false;
    expect(read(h)).toEqual({available:false,temperatures:[],media:[]});
  });
  it('does not invoke temperature/name getters, mutate source values, or use callbacks for appearance', () => {
    const h = fixture(), getter = vi.fn(() => {throw new Error('no getter');}); add(h,'sensor.room','19',{device_class:'temperature',unit_of_measurement:'°C'});
    Object.defineProperty(h.states['sensor.room'].attributes,'friendly_name',{get:getter});
    h.formatEntityState = getter; h.formatEntityName = getter;
    expect(read(h).temperatures[0]).toEqual({entityId:'sensor.room',name:'sensor.room',value:'19 °C'});
    Object.defineProperty(h.states['sensor.room'].attributes,'unit_of_measurement',{get:getter}); expect(read(h).temperatures).toEqual([]);
    expect(getter).not.toHaveBeenCalled(); expect(h.states['sensor.room'].state).toBe('19');
  });
  it('uses reported climate unit, preserves thermometer trailing precision and localises media state', () => {
    const h=fixture(); h.locale={language:'de',number_format:'decimal_comma'};
    add(h,'climate.room','heat',{current_temperature:68.1,temperature_unit:'°F'});
    add(h,'sensor.room','19.50',{device_class:'temperature',unit_of_measurement:'°C'}); add(h,'media_player.room','playing',{media_title:'Literal_<b>'});
    expect(read(h).temperatures.map((item) => item.value)).toEqual(['68,1 °F','19,50 °C']);
    expect(read(h).media[0].value).toBe('Wiedergabe · Literal_<b>');
  });
});
