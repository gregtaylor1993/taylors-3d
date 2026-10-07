// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { RoomSheet, roomSheetHeights } from '../src/room-sheet.js';
import { DevicePopup } from '../src/device-popup.js';

const pointer = (target,type,y = 100,extra = {}) => {
  const event = new Event(type,{bubbles:true,composed:true});
  for (const [key,value] of Object.entries({button:0,pointerId:1,isPrimary:true,clientY:y,...extra})) Object.defineProperty(event,key,{value});
  target.dispatchEvent(event);
};
const keyboard = (target,type,key,extra = {}) => target.dispatchEvent(new KeyboardEvent(type,{key,bubbles:true,cancelable:true,...extra}));
let popup,sheet,context,onChange;
beforeEach(() => {
  popup = document.createElement('div'); document.body.append(popup);
  context = {ready:true,key:'model-room-session',auth:{},connection:{},callService:vi.fn(),user:'current'};
  onChange = vi.fn(); sheet = new RoomSheet(popup,{getContext:() => context,getHass:() => ({language:'en'}),onChange});
  popup.append(sheet.element); sheet.updateGeometry({width:360,baseHeight:900,availableHeight:600});
});
afterEach(() => { sheet.dispose(); popup.remove(); });

describe('room sheet presentation and native gesture ownership', () => {
  it('uses actual available card space, bounded controls/details, and a separate desktop presentation', () => {
    expect(roomSheetHeights(900,600)).toEqual({summary:200,controls:288,details:552});
    expect(roomSheetHeights(900,200)).toEqual({summary:184,controls:184,details:184});
    expect(roomSheetHeights(900,0)).toEqual({summary:0,controls:0,details:0});
    expect(roomSheetHeights(10000,10000)).toEqual({summary:200,controls:320,details:560});
    expect(popup.dataset.roomSheet).toBe('controls'); expect(popup.style.getPropertyValue('--taylors3d-room-sheet-height')).toBe('288px');
    sheet.buttons.get('summary').click(); expect(popup.dataset.roomSheet).toBe('summary');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('summary');
    sheet.updateGeometry({width:1000,baseHeight:900}); expect(popup.dataset.roomSheet).toBe('desktop');
    expect(sheet.element.hidden).toBe(true); expect(popup.style.getPropertyValue('--taylors3d-room-sheet-height')).toBe('');
    sheet.updateGeometry({width:360,baseHeight:900,availableHeight:600}); expect(popup.dataset.roomSheet).toBe('summary');
  });
  it('snaps a genuine handle drag once, consumes its browser click and never calls services', () => {
    pointer(sheet.handle,'pointerdown',500); pointer(sheet.handle,'pointermove',230); expect(popup.hasAttribute('data-room-sheet-dragging')).toBe(true);
    pointer(sheet.handle,'pointerup',230); sheet.handle.click(); expect(sheet.mode).toBe('details');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('details'); expect(context.callService).not.toHaveBeenCalled();
    pointer(sheet.handle,'pointerdown',230); pointer(sheet.handle,'pointermove',700); pointer(sheet.handle,'pointerup',700); sheet.handle.click();
    expect(sheet.mode).toBe('summary'); expect(onChange).toHaveBeenCalledTimes(2);
  });
  it('caps every mode to short existing scene space without changing its selected content mode', () => {
    sheet.buttons.get('details').click();sheet.updateGeometry({width:320,baseHeight:340,availableHeight:224});
    expect(sheet.heights).toEqual({summary:200,controls:208,details:208});expect(sheet.mode).toBe('details');
    expect(popup.style.getPropertyValue('--taylors3d-room-sheet-height')).toBe('208px');
    expect(popup.hasAttribute('data-room-sheet-short')).toBe(true);expect(sheet.handle.disabled).toBe(false);
    expect(sheet.buttons.get('details').getAttribute('aria-pressed')).toBe('true');expect(context.callService).not.toHaveBeenCalled();
    sheet.updateGeometry({width:320,baseHeight:900,availableHeight:600});
    expect(popup.hasAttribute('data-room-sheet-short')).toBe(false);expect(sheet.mode).toBe('details');
  });
  it('has explicit keyboard size controls and bounded single key presses', () => {
    keyboard(sheet.handle,'keydown','End'); expect(sheet.mode).toBe('details');
    keyboard(sheet.handle,'keydown','ArrowDown'); expect(sheet.mode).toBe('controls');
    keyboard(sheet.handle,'keydown','ArrowDown',{repeat:true}); expect(sheet.mode).toBe('controls');
    keyboard(sheet.handle,'keydown','Home'); expect(sheet.mode).toBe('summary');
    keyboard(sheet.handle,'keydown','ArrowUp'); expect(sheet.mode).toBe('controls');
    expect(sheet.handle.getAttribute('aria-label')).toContain('Home');
    expect(sheet.buttons.get('controls').getAttribute('aria-pressed')).toBe('true');
  });
  it.each(['ready','key','auth','connection','callService','user'])('permanently cancels a held drag after transient %s loss/recovery', (key) => {
    const original = context;
    pointer(sheet.handle,'pointerdown',500); pointer(sheet.handle,'pointermove',250);
    context = {...original,[key]:key === 'ready' ? false : key === 'user' || key === 'key' ? 'changed' : {}}; sheet.observe();
    context = original; sheet.observe(); pointer(sheet.handle,'pointerup',250); sheet.handle.click();
    expect(sheet.mode).toBe('controls'); expect(onChange).not.toHaveBeenCalled();
    expect(popup.hasAttribute('data-room-sheet-dragging')).toBe(false); expect(context.callService).not.toHaveBeenCalled();
    pointer(sheet.handle,'pointerdown',500); pointer(sheet.handle,'pointermove',250); pointer(sheet.handle,'pointerup',250); sheet.handle.click();
    expect(sheet.mode).toBe('details'); expect(onChange).toHaveBeenCalledTimes(1);
  });
  it.each(['pointer','Space','Enter'])('rejects stale %s size button release/repeat and allows a fresh gesture', (kind) => {
    const button = sheet.buttons.get('summary'), original = context;
    if (kind === 'pointer') pointer(button,'pointerdown'); else keyboard(button,'keydown',kind === 'Space' ? ' ' : 'Enter');
    context = {...original,key:'new model'}; sheet.observe(); context = original; sheet.observe();
    if (kind === 'pointer') pointer(button,'pointerup'); else keyboard(button,'keyup',kind === 'Space' ? ' ' : 'Enter');
    button.click(); expect(sheet.mode).toBe('controls'); expect(onChange).not.toHaveBeenCalled();
    pointer(button,'pointerdown'); pointer(button,'pointerup'); button.click(); expect(sheet.mode).toBe('summary');
  });
  it('cancels pointer capture and outside releases without leaving a stuck size button', () => {
    const button = sheet.buttons.get('summary'); pointer(button,'pointerdown'); pointer(document.body,'pointerup'); button.click();
    expect(sheet.mode).toBe('controls'); pointer(button,'pointerdown'); pointer(button,'pointerup'); button.click(); expect(sheet.mode).toBe('summary');
    pointer(sheet.handle,'pointerdown',300); pointer(sheet.handle,'pointermove',100); pointer(sheet.handle,'pointercancel',100); sheet.handle.click();
    expect(sheet.mode).toBe('summary'); expect(sheet.drag).toBe(null);
  });
  it('recognises a real inside pointer release through shadow-root event retargeting', () => {
    const host=document.createElement('div');host.attachShadow({mode:'open'});document.body.append(host);host.shadowRoot.append(popup);
    const button=sheet.buttons.get('summary');pointer(button,'pointerdown');pointer(button,'pointerup');button.click();
    expect(sheet.mode).toBe('summary');expect(onChange).toHaveBeenCalledExactlyOnceWith('summary');host.remove();
  });
  it('disposes a held drag and all listeners without a late callback or popup style residue', () => {
    pointer(sheet.handle,'pointerdown',500); pointer(sheet.handle,'pointermove',200); sheet.dispose();
    pointer(sheet.handle,'pointerup',200); sheet.buttons.get('details').click(); keyboard(sheet.handle,'keydown','End');
    expect(onChange).not.toHaveBeenCalled(); expect(popup.hasAttribute('data-room-sheet')).toBe(false);
    expect(popup.style.getPropertyValue('--taylors3d-room-sheet-height')).toBe(''); expect(sheet.drag).toBe(null);
  });
  it('preserves literal source labels while localising every reachable size button', () => {
    sheet.getHass = () => ({language:'de'}); sheet.observe();
    expect(sheet.buttons.get('summary').textContent).toBe('Übersicht'); expect(sheet.buttons.get('controls').textContent).toBe('Steuerung');
    expect(sheet.buttons.get('details').textContent).toBe('Details'); expect(context.callService).not.toHaveBeenCalled();
  });
});

describe('DevicePopup room sheet integration', () => {
  const hass = () => ({user:{id:'current',is_active:true,is_admin:true},connection:{connected:true},callService:vi.fn(),
    states:{'media_player.room':{entity_id:'media_player.room',state:'playing',attributes:{friendly_name:'Actual media',supported_features:4,volume_level:.4}},
      'sensor.temperature':{entity_id:'sensor.temperature',state:'19.5',attributes:{friendly_name:'Actual room sensor',device_class:'temperature',unit_of_measurement:'°C'}},
      'switch.room':{entity_id:'switch.room',state:'off',attributes:{friendly_name:'Actual switch'}}},
    entities:{},devices:{},areas:{room:{name:'Actual room'}},services:{media_player:{volume_set:{}},switch:{toggle:{}}}});
  const room = {id:'room1',area_id:'room',floor_id:'ground'}, markers = [{entityId:'media_player.room',areaId:'room'},
    {entityId:'sensor.temperature',areaId:'room'},{entityId:'switch.room',areaId:'room'}];
  it('keeps real source readings, all detail controls, and never sends a command on size changes', () => {
    const h = hass(), controls = new DevicePopup(popup,{placement:'right'}); controls.update(h); controls.showRoom(room,markers);
    controls.updateRoomSheetGeometry({width:360,baseHeight:900,availableHeight:600});
    expect(controls.el.querySelector('.t3d-room-glance').textContent).toContain('Actual room sensor: 19.5 °C');
    expect(controls.el.querySelector('.t3d-room-glance').textContent).toContain('Actual media: Playing');
    expect(controls.el.querySelector('[data-entity="switch.room"]').hasAttribute('data-room-secondary')).toBe(true);
    const row = controls.el.querySelector('[data-entity="media_player.room"]');
    controls._roomSheet.buttons.get('details').click(); expect(controls.el.dataset.roomSheet).toBe('details');
    controls._roomSheet.buttons.get('summary').click(); expect(controls.el.dataset.roomSheet).toBe('summary');
    expect(controls.el.querySelector('[data-entity="media_player.room"]')).toBe(row); expect(h.callService).not.toHaveBeenCalled(); controls.dispose();
  });
  it('poisons an unfinished native scalar before sheet movement can blur and submit it', () => {
    const h = hass(), controls = new DevicePopup(popup,{placement:'right'}); controls.update(h); controls.showRoom(room,markers);
    controls.updateRoomSheetGeometry({width:360,baseHeight:900,availableHeight:600});
    const input = controls.el.querySelector('[data-device-control="volume"]'); input.focus(); input.value = '27';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    const summary = controls._roomSheet.buttons.get('summary'); pointer(summary,'pointerdown');
    input.dispatchEvent(new Event('change',{bubbles:true})); pointer(summary,'pointerup'); summary.click();
    expect(h.callService).not.toHaveBeenCalled(); expect(controls.el.dataset.roomSheet).toBe('summary'); controls.dispose();
  });
  it('rejects a old model sheet gesture and disposes a replaced room panel', () => {
    let model = 'model1'; const h = hass(), controls = new DevicePopup(popup,{placement:'right',getRoomSheetContext:() => ({contextKey:model,suspended:false})});
    controls.update(h); controls.showRoom(room,markers); controls.updateRoomSheetGeometry({width:360,baseHeight:900});
    const old = controls._roomSheet; pointer(old.handle,'pointerdown',500); pointer(old.handle,'pointermove',250);
    model = 'replacement'; controls.observeContexts(h); model = 'model1'; controls.observeContexts(h); pointer(old.handle,'pointerup',250); old.handle.click();
    expect(old.mode).toBe('controls');
    controls.showRoom({...room,id:'room2'},markers); pointer(old.handle,'pointerup',250); old.buttons.get('details').click();
    expect(old.disposed).toBe(true); expect(controls._roomSheet.mode).toBe('controls'); expect(h.callService).not.toHaveBeenCalled(); controls.dispose();
  });
});
