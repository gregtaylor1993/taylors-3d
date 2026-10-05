// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevicePopup } from '../src/device-popup.js';

const read = (entity_id,state,attributes) => ({entity_id,state,attributes});
const marker = {entityId:'media_player.real',name:'User_Player_été',areaId:'room'};
const room = {id:'exact_room',area_id:'room'};
const fixture = () => ({user:{id:'current-user',is_active:true,permissions:{control:true}},connection:{connected:true},auth:{},callService:vi.fn(),
  areas:{room:{name:'User_Room_été'}},entities:{},
  services:{media_player:{media_play:{},media_pause:{},volume_set:{},volume_mute:{}},scene:{turn_on:{}}},
  states:{'media_player.real':read('media_player.real','playing',{friendly_name:'User_Player_été',supported_features:16384+1+4+8,volume_level:.5,is_volume_muted:false,media_title:'User_Music_été'}),
    'scene.evening':read('scene.evening','2026-01-01T12:00:00Z',{friendly_name:'User_Evening_été'})}});
const pointer = (node,type) => { const event=new Event(type,{bubbles:true});Object.assign(event,{button:0,isPrimary:true,pointerId:1});node.dispatchEvent(event); };
const key = (node,type,value) => node.dispatchEvent(new KeyboardEvent(type,{bubbles:true,key:value}));
const flush = async () => {await Promise.resolve();await Promise.resolve();};

describe('actual popup extra controls and room shortcuts',()=>{
  let host,popup,h,onAction;
  beforeEach(()=>{host=document.createElement('div');document.body.append(host);h=fixture();onAction=vi.fn().mockResolvedValue(undefined);
    popup=new DevicePopup(host,{onAction});popup.update(h);});
  afterEach(()=>{popup.dispose();host.remove();});
  const control=(popup,id)=>popup.el.querySelector(`[data-device-control="${id}"]`);
  it('shows actual room media inline, preserves HA readings, sends only deliberate exact operations',async()=>{
    popup.showRoom(room,[marker]);expect(popup.el.textContent).toContain('User_Music_été');expect(onAction).not.toHaveBeenCalled();
    control(popup,'play').click();await flush();expect(onAction).toHaveBeenCalledExactlyOnceWith('media_player','media_play',{entity_id:'media_player.real'});
    const volume=control(popup,'volume');volume.focus();volume.value='37';volume.dispatchEvent(new Event('input',{bubbles:true}));
    expect(onAction).toHaveBeenCalledTimes(1);volume.dispatchEvent(new Event('change',{bubbles:true}));
    expect(onAction).toHaveBeenLastCalledWith('media_player','volume_set',{entity_id:'media_player.real',volume_level:.37});
    expect(h.states['media_player.real'].attributes.volume_level).toBe(.5);
  });
  it.each(['pointer','Space','Enter'])('blocks held %s across synchronous permission loss/recovery before a redraw',async(gesture)=>{
    popup.showMarker(marker);const play=control(popup,'play');
    if(gesture==='pointer')pointer(play,'pointerdown');else key(play,'keydown',gesture==='Space'?' ':'Enter');
    h.user.permissions={control:false};popup.observeContexts(h);h.user.permissions={control:true};popup.observeContexts(h);
    if(gesture==='pointer')pointer(play,'pointerup');else key(play,'keyup',gesture==='Space'?' ':'Enter');play.click();
    expect(onAction).not.toHaveBeenCalled();
    pointer(play,'pointerdown');pointer(play,'pointerup');play.click();await flush();expect(onAction).toHaveBeenCalledTimes(1);
  });
  it.each(['connection','account','source','service'])('poisons a focused scalar draft after %s loss and recovery',(reason)=>{
    popup.showMarker(marker);const volume=control(popup,'volume');volume.focus();volume.value='27';volume.dispatchEvent(new Event('input',{bubbles:true}));
    const original=h.states['media_player.real'];
    reasonChange('loss');popup.observeContexts(h);reasonChange('restore');popup.observeContexts(h);
    volume.dispatchEvent(new Event('change',{bubbles:true}));expect(onAction).not.toHaveBeenCalled();
    function reasonChange(direction){
      const lost=direction==='loss';
      if(reason==='connection')h.connection.connected=!lost;
      if(reason==='account')h.user.is_active=!lost;
      if(reason==='source')h.states['media_player.real']=lost?{...original,state:'unavailable'}:original;
      if(reason==='service'){if(lost)delete h.services.media_player.volume_set;else h.services.media_player.volume_set={};}
    }
  });
  it('retains the exact focused unfinished scalar for a pure language/current reading update with no call',()=>{
    popup.showMarker(marker);const volume=control(popup,'volume');volume.focus();volume.value='31';volume.dispatchEvent(new Event('input',{bubbles:true}));
    popup.update({...h,language:'de',locale:{language:'de'},states:{...h.states,'media_player.real':{...h.states['media_player.real'],attributes:{...h.states['media_player.real'].attributes,volume_level:.2}}}});
    expect(control(popup,'volume')).toBe(volume);expect(document.activeElement).toBe(volume);expect(volume.value).toBe('31');expect(onAction).not.toHaveBeenCalled();
    expect(popup.el.textContent).toContain('20 %');
  });
  it('keeps pending/errors separate from actual media state and blocks repeat actions',async()=>{
    let reject;onAction.mockReturnValue(new Promise((_resolve,r)=>{reject=r;}));popup.showMarker(marker);const play=control(popup,'play');play.click();play.click();
    expect(onAction).toHaveBeenCalledTimes(1);expect(play.disabled).toBe(true);expect(h.states['media_player.real'].state).toBe('playing');
    reject(new Error('<img src=x> User_Error_été'));await flush();expect(popup.el.querySelector('img')).toBeNull();expect(popup.el.textContent).toContain('User_Error_été');expect(play.disabled).toBe(false);
  });
  it('renders only explicitly supplied current room actions, keeps literal labels, and delegates exact room/action IDs',async()=>{
    const onRoomAction=vi.fn().mockResolvedValue(true);const getRoomActions=()=>({contextKey:'stable-context',actions:[{id:'evening',label:'User_<b>Evening_été',entityId:'scene.evening',domain:'scene',service:'turn_on',available:true}]});
    popup.dispose();popup=new DevicePopup(host,{onAction,getRoomActions,onRoomAction});popup.update(h);popup.showRoom(room,[marker]);
    const button=popup.el.querySelector('[data-room-action="evening"]');expect(button.textContent).toBe('User_<b>Evening_été');expect(button.querySelector('b')).toBeNull();expect(onRoomAction).not.toHaveBeenCalled();
    pointer(button,'pointerdown');pointer(button,'pointerup');button.click();await flush();expect(onRoomAction).toHaveBeenCalledExactlyOnceWith('exact_room','evening');
    popup.showMarker(marker);expect(popup.el.querySelector('[data-room-action]')).toBeNull();
  });
  it('allows a root-validated scene with an unknown activation timestamp and preserves a long valid action ID',async()=>{
    h.states['scene.evening'].state='unknown';const id='a'.repeat(128),onRoomAction=vi.fn().mockResolvedValue(true);
    popup.dispose();popup=new DevicePopup(host,{getRoomActions:()=>({contextKey:'current',actions:[{id,label:'Simulated scene',entityId:'scene.evening',domain:'scene',service:'turn_on',available:true}]}),onRoomAction});
    popup.update(h);popup.showRoom(room,[marker]);const node=popup.el.querySelector('[data-room-action]');expect(node.disabled).toBe(false);node.click();await flush();
    expect(onRoomAction).toHaveBeenCalledExactlyOnceWith('exact_room',id);
  });
  it('poisons held room shortcuts when root context transiently changes and rejects stale async errors',async()=>{
    let contextKey='first',reject;const onRoomAction=vi.fn().mockReturnValue(new Promise((_resolve,r)=>{reject=r;}));
    const getRoomActions=()=>({contextKey,actions:[{id:'evening',label:'User_Label_été',entityId:'scene.evening',domain:'scene',service:'turn_on',available:true}]});
    popup.dispose();popup=new DevicePopup(host,{onAction,getRoomActions,onRoomAction});popup.update(h);popup.showRoom(room,[marker]);
    const button=popup.el.querySelector('[data-room-action]');key(button,'keydown',' ');contextKey='changed';popup.observeContexts(h);contextKey='first';popup.observeContexts(h);key(button,'keyup',' ');button.click();expect(onRoomAction).not.toHaveBeenCalled();
    pointer(button,'pointerdown');pointer(button,'pointerup');button.click();expect(onRoomAction).toHaveBeenCalledTimes(1);popup.showMarker(marker);reject(new Error('old shortcut error'));await flush();expect(popup.el.textContent).not.toContain('old shortcut error');
  });
  it.each([
    ['climate','heat',{supported_features:1,min_temp:10,max_temp:30,target_temp_step:.5,temperature:20,hvac_modes:['off','heat','cool']},'temperature','21.5','set_temperature',{temperature:21.5}],
    ['climate','heat',{supported_features:1,min_temp:10,max_temp:30,temperature:20,hvac_modes:['off','heat','cool']},'hvac-mode','cool','set_hvac_mode',{hvac_mode:'cool'}],
    ['cover','open',{supported_features:15,current_position:50},'position','0','set_cover_position',{position:0}],
    ['vacuum','cleaning',{supported_features:8192+32,fan_speed_list:['User_Quiet_été','Turbo'],fan_speed:'Turbo'},'fan-speed','User_Quiet_été','set_fan_speed',{fan_speed:'User_Quiet_été'}],
  ])('uses actual %s native %s values in the service payload without changing source readings',async(domain,value,attributes,id,choice,service,payload)=>{
    const entity=`${domain}.actual`;h.states[entity]=read(entity,value,attributes);h.config={unit_system:{temperature:'°C'}};h.services[domain]={[service]:{}};
    popup.update(h);popup.showMarker({entityId:entity});const node=control(popup,id);node.focus();node.value=choice;node.dispatchEvent(new Event('input',{bubbles:true}));
    expect(onAction).not.toHaveBeenCalled();node.dispatchEvent(new Event('change',{bubbles:true}));await flush();
    expect(onAction).toHaveBeenCalledExactlyOnceWith(domain,service,{entity_id:entity,...payload});expect(h.states[entity].attributes).toBe(attributes);
    expect(popup.el.querySelector('[data-action="more-info"]')).not.toBeNull();
  });
  it('blocks a focused native enum across advertised option loss/recovery and accepts only a fresh gesture',async()=>{
    h.states['vacuum.real']=read('vacuum.real','cleaning',{supported_features:32,fan_speed_list:['Quiet','Turbo'],fan_speed:'Quiet'});h.services.vacuum={set_fan_speed:{}};
    popup.update(h);popup.showMarker({entityId:'vacuum.real'});const node=control(popup,'fan-speed');node.focus();node.value='Turbo';node.dispatchEvent(new Event('input',{bubbles:true}));
    h.states['vacuum.real'].attributes.fan_speed_list=['Quiet'];popup.observeContexts(h);h.states['vacuum.real'].attributes.fan_speed_list=['Quiet','Turbo'];popup.observeContexts(h);
    node.dispatchEvent(new Event('change',{bubbles:true}));expect(onAction).not.toHaveBeenCalled();
    key(node,'keydown','ArrowDown');key(node,'keyup','ArrowDown');node.value='Turbo';node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));await flush();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('vacuum','set_fan_speed',{entity_id:'vacuum.real',fan_speed:'Turbo'});
  });
  it('suppresses old extra-control errors after a coalesced account loss/recovery',async()=>{
    let reject;onAction.mockReturnValue(new Promise((_resolve,r)=>{reject=r;}));popup.showMarker(marker);control(popup,'play').click();
    h.user.is_active=false;popup.observeContexts(h);h.user.is_active=true;popup.observeContexts(h);reject(new Error('Old account error'));await flush();
    expect(popup.el.textContent).not.toContain('Old account error');expect(control(popup,'play').disabled).toBe(false);
  });
  it('reads the latest hass after observation even when no deferred repaint has occurred',()=>{
    popup.showMarker(marker);const node=control(popup,'play');
    const next={...h,services:{...h.services,media_player:{volume_set:{}}}};popup.observeContexts(next);
    expect(node.isConnected).toBe(true);node.click();expect(onAction).not.toHaveBeenCalled();
  });
  it('keeps unknown scalar readings empty and restored/hidden/diagnostic sources non-actionable',()=>{
    delete h.states['media_player.real'].attributes.volume_level;popup.update(h);popup.showMarker(marker);
    expect(control(popup,'volume').value).toBe('');expect(popup.el.textContent).toContain('Current value not reported');
    h.states['media_player.real'].attributes.restored=true;popup.update(h);expect(control(popup,'play').disabled).toBe(true);
    expect(popup.el.textContent).not.toContain('User_Music_été');expect(popup.el.querySelector('.t3d-entity-value').textContent).toContain('Waiting');
    h.entities['media_player.real']={entity_category:'diagnostic'};popup.update(h);expect(popup.el.querySelector('.t3d-entity')).toBeNull();expect(onAction).not.toHaveBeenCalled();
  });
  it.each(['duplicate','domain','too-many','source'])('does not offer invalid %s room shortcuts', (reason)=>{
    const item={id:'action',label:'User_Label_été',entityId:'scene.evening',domain:'scene',service:'turn_on',available:true};let actions=[item];
    if(reason==='duplicate')actions=[item,{...item}];if(reason==='domain')actions=[{...item,domain:'light',entityId:'light.real'}];if(reason==='too-many')actions=Array.from({length:13},(_,index)=>({...item,id:`action${index}`}));
    if(reason==='source')delete h.states['scene.evening'];
    popup.dispose();popup=new DevicePopup(host,{getRoomActions:()=>({actions,contextKey:'current'}),onRoomAction:vi.fn()});popup.update(h);popup.showRoom(room,[marker]);
    const buttons=[...popup.el.querySelectorAll('[data-room-action]')];expect(buttons.filter((button)=>!button.disabled)).toHaveLength(0);
  });
  it('preserves a focused room shortcut on locale-only updates and exposes current rejection safely',async()=>{
    const onRoomAction=vi.fn().mockRejectedValue(new Error('<b>User_Rejection_été'));
    const getRoomActions=()=>({contextKey:'current',actions:[{id:'action',label:'User_Label_été',entityId:'scene.evening',domain:'scene',service:'turn_on',available:true}]});
    popup.dispose();popup=new DevicePopup(host,{getRoomActions,onRoomAction});popup.update(h);popup.showRoom(room,[marker]);
    const node=popup.el.querySelector('[data-room-action]');node.focus();key(node,'keydown',' ');popup.update({...h,locale:{language:'fr'}});
    expect(popup.el.querySelector('[data-room-action]')).toBe(node);expect(document.activeElement).toBe(node);expect(node.textContent).toBe('User_Label_été');key(node,'keyup',' ');node.click();await flush();
    expect(onRoomAction).toHaveBeenCalledExactlyOnceWith('exact_room','action');expect(popup.el.querySelector('.t3d-room-actions [role="alert"]').textContent).toContain('User_Rejection_été');expect(popup.el.querySelector('b')).toBeNull();
  });
  it('removes completed extra-control errors when the authenticated owner changes',async()=>{
    onAction.mockRejectedValueOnce(new Error('User_A_error'));popup.showMarker(marker);control(popup,'play').click();await flush();expect(popup.el.textContent).toContain('User_A_error');
    popup.update({...h,user:{...h.user,id:'other-user'}});expect(popup.el.textContent).not.toContain('User_A_error');
  });
  it('does not reuse old room errors/busy state after a saved room action context changes',async()=>{
    let contextKey='first',reject;const onRoomAction=vi.fn().mockRejectedValueOnce(new Error('First context error')).mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;}));
    const getRoomActions=()=>({contextKey,actions:[{id:'action',label:'User_Label_été',entityId:'scene.evening',domain:'scene',service:'turn_on',available:true}]});
    popup.dispose();popup=new DevicePopup(host,{getRoomActions,onRoomAction});popup.update(h);popup.showRoom(room,[marker]);
    const node=popup.el.querySelector('[data-room-action]');node.click();await flush();expect(popup.el.textContent).toContain('First context error');
    contextKey='second';popup.update(h);expect(popup.el.textContent).not.toContain('First context error');node.click();expect(node.disabled).toBe(true);
    contextKey='third';popup.update(h);expect(node.disabled).toBe(false);reject(new Error('Second context error'));await flush();expect(popup.el.textContent).not.toContain('Second context error');
  });
  it('an old settled request cannot clear the pending flag of a fresh authenticated command',async()=>{
    let resolveOld,resolveNew;onAction.mockReturnValueOnce(new Promise((resolve)=>{resolveOld=resolve;})).mockReturnValueOnce(new Promise((resolve)=>{resolveNew=resolve;}));
    popup.showMarker(marker);const node=control(popup,'play');node.click();h.user.is_active=false;popup.observeContexts(h);h.user.is_active=true;popup.update(h);
    pointer(node,'pointerdown');pointer(node,'pointerup');node.click();expect(onAction).toHaveBeenCalledTimes(2);resolveOld();await flush();expect(node.disabled).toBe(true);resolveNew();await flush();expect(node.disabled).toBe(false);
  });
});
