// F18/F20: real source/bundle Root, room selection, DevicePopup/editor and native
// Chrome input. HA readings/services/camera/player/storage are explicit fixtures.
// Suggest package script: "test:room-actions": "node scripts/room-actions-check.mjs"
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { roomActionEntities as entities, roomActionIds as ids, roomActionLayoutKey as key, roomActionRoomId as roomId,
  roomActionsLayout, roomActionsCapacityLayout, roomActionsReadings, roomActionsHtml, prepareRoomActionsFixture, serveRoomActionsFixture } from './lib/room-actions-fixture.mjs';

const checks=[],browserErrors=[];
let mode='',context='setup';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const check=(name,pass,detail)=>{checks.push(!!pass);console.log(`${pass?'ok  ':'FAIL'} ${mode} ${name}${detail===undefined?'':' – '+JSON.stringify(detail)}`);};
const inline=(entity,name)=>`[data-device-control="${name}"][data-entity="${entity}"]`;
const shortcut=(id)=>`[data-room-action="${id}"]`;
const settle=(page)=>page.evaluate(()=>new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function control(page,selector,callback){
  context='actual native control '+selector;
  const handle=await page.evaluateHandle((selector)=>document.querySelector('taylors3d-card').shadowRoot.querySelector(selector),selector);
  try{const element=handle.asElement();if(!element)throw new Error('Missing native control '+selector);
    await element.evaluate((node)=>node.scrollIntoView({block:'center',inline:'nearest'}));
    const hit=await page.waitForFunction((node,selector)=>{
      const shadow=document.querySelector('taylors3d-card').shadowRoot;
      if(!node.isConnected||shadow.querySelector(selector)!==node)return false;
      const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,target=shadow.elementFromPoint(x,y);
      return r.width>0&&r.height>0&&(target===node||node.contains(target))?[x,y]:false;
    },{timeout:page.getDefaultTimeout()},element,selector);
    try{await callback(element,await hit.jsonValue());}finally{await hit.dispose();}
  }finally{await handle.dispose();}await settle(page);
}
const click=(page,selector)=>control(page,selector,(_node,point)=>page.mouse.click(...point));
async function scalar(page,selector,value,blur=true){
  await control(page,selector,async(node)=>{await node.focus();await page.keyboard.down('Control');await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.keyboard.type(String(value));
    if(blur)await page.keyboard.press('Tab');});
}
async function enumLast(page,selector){await control(page,selector,async(node)=>{await node.focus();await page.keyboard.press('End');await page.keyboard.press('Tab');});}
const snapshot=(page)=>page.evaluate(()=>{
  const c=document.querySelector('taylors3d-card'),f=window.roomActionsFixture,p=c._devicePopup;
  let lights=0;c._view.scene.traverse((node)=>{if(node.isLight)lights++;});
  return{calls:structuredClone(f.calls),commits:f.commits,writes:f.ws.filter((m)=>m.type==='taylors3d/layout/set').length,
    layout:structuredClone(c._layout),readings:structuredClone(c._hass.states),history:c._history.size,
    popup:p.isOpen,selection:p._selection?.kind,room:p._selection?.room?.id,placement:p.el?.dataset.placement,text:p.el?.textContent,
    shortcuts:[...(p.el?.querySelectorAll('[data-room-action]')||[])].map((n)=>({id:n.dataset.roomAction,text:n.textContent,disabled:n.disabled,html:n.innerHTML})),
    controls:[...(p.el?.querySelectorAll('[data-device-control]')||[])].map((n)=>({entity:n.dataset.entity,id:n.dataset.deviceControl,value:n.value,disabled:n.disabled})),
    contexts:window.roomActionsContexts.size,sameRenderer:f.renderer===c._view.renderer,lights,pool:c._objects._slots.size,
    infos:[...f.infos],cameraActive:f.cameraActive.size,cameraCards:f.cameraCards.map((card)=>({config:card.config,connected:card.isConnected})),
    cameraStatus:p.cameraFeed.status,editing:c._editing,tab:c._edit?.tab};
});
async function openRoom(page){
  context='actual model-room native tap';
  if(await page.evaluate(()=>document.querySelector('taylors3d-card')._devicePopup.isOpen))await click(page,'.t3d-popup-close');
  const pixel=await page.evaluate(()=>window.roomActionsFixture.roomPixel());await page.mouse.click(...pixel);await settle(page);
  const state=await snapshot(page);if(state.room!==roomId)throw new Error('Native authored room tap did not select exact current room: '+JSON.stringify({pixel,room:state.room,text:state.text}));
}
async function exactCall(page,name,operation,expected){
  const before=await snapshot(page);await operation();const after=await snapshot(page);
  check(name,after.calls.length===before.calls.length+1&&same(after.calls.at(-1),expected)&&same(after.readings,before.readings)
    &&after.writes===before.writes&&after.commits===before.commits,{last:after.calls.at(-1),added:after.calls.length-before.calls.length});
}
async function screenshot(page,name){fs.mkdirSync(path.join(root,'screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'screenshots',`room-actions-${mode}-${name}.png`),fullPage:true});}

async function baseline(page){
  await openRoom(page);const state=await snapshot(page);
  check('actual authored room opens photo-style House right controls with literal saved labels and actual inline media',state.placement==='right'&&state.room===roomId
    &&state.shortcuts.length===2&&state.shortcuts[0].text==='User_<b>Evening_été'&&state.shortcuts[0].html==='User_&lt;b&gt;Evening_été'
    &&state.text.includes('User_Track_<b>été')&&state.text.includes('User_Player_été')&&state.text.includes('User_Room_été')
    &&state.calls.length===0&&state.writes===0&&state.commits===0,state.shortcuts);
  check('unknown scene activation timestamp remains available; no inferred scene device state',state.shortcuts.every((n)=>!n.disabled)&&state.readings[entities.scene].state==='unknown');
  await geometry(page,'desktop');await screenshot(page,'desktop-right');
  await exactCall(page,'native saved scene shortcut sends exactly current scene.turn_on',()=>click(page,shortcut('scene-shortcut')),['scene','turn_on',{entity_id:entities.scene}]);
  await exactCall(page,'native saved script shortcut sends exactly current script.turn_on',()=>click(page,shortcut('script-shortcut')),['script','turn_on',{entity_id:entities.script}]);
}
async function devices(page){
  // Fixed independently specified HA service/payload examples, not generated
  // from readDeviceControls or copied from currently rendered definitions.
  for(const [entity,id,domain,service] of [
    [entities.media,'play','media_player','media_play'],[entities.media,'pause','media_player','media_pause'],[entities.media,'stop','media_player','media_stop'],
    [entities.media,'previous','media_player','media_previous_track'],[entities.media,'next','media_player','media_next_track'],
    [entities.cover,'open','cover','open_cover'],[entities.cover,'close','cover','close_cover'],[entities.cover,'stop','cover','stop_cover'],
    [entities.lock,'unlock','lock','unlock'],[entities.lock,'lock','lock','lock'],[entities.vacuum,'start','vacuum','start'],
    [entities.vacuum,'pause','vacuum','pause'],[entities.vacuum,'stop','vacuum','stop'],[entities.vacuum,'dock','vacuum','return_to_base']]){
    await exactCall(page,`${domain} ${id} native button sends one supported current command`,()=>click(page,inline(entity,id)),[domain,service,{entity_id:entity}]);}
  await exactCall(page,'native media mute uses current boolean payload',()=>click(page,inline(entities.media,'mute')),['media_player','volume_mute',{entity_id:entities.media,is_volume_muted:true}]);
  await exactCall(page,'native media volume percent uses exact HA fractional payload',()=>scalar(page,inline(entities.media,'volume'),'37'),['media_player','volume_set',{entity_id:entities.media,volume_level:.37}]);
  await exactCall(page,'native current climate target uses advertised bounds, unit and step',()=>scalar(page,inline(entities.climate,'temperature'),'21.5'),['climate','set_temperature',{entity_id:entities.climate,temperature:21.5}]);
  await exactCall(page,'native climate enum retains raw HA mode',()=>enumLast(page,inline(entities.climate,'hvac-mode')),['climate','set_hvac_mode',{entity_id:entities.climate,hvac_mode:'cool'}]);
  await exactCall(page,'native cover position accepts exact zero',()=>scalar(page,inline(entities.cover,'position'),'0'),['cover','set_cover_position',{entity_id:entities.cover,position:0}]);
  await exactCall(page,'native vacuum fan enum retains raw source option',()=>enumLast(page,inline(entities.vacuum,'fan-speed')),['vacuum','set_fan_speed',{entity_id:entities.vacuum,fan_speed:'Turbo'}]);
}
async function geometry(page,label){
  const reading=await page.evaluate(()=>{const c=document.querySelector('taylors3d-card'),p=c._devicePopup.el,r=p.getBoundingClientRect();
    const controls=[...p.querySelectorAll('button,input,select')].filter((n)=>!n.closest('[hidden]'));
    return{viewport:innerWidth,document:document.documentElement.scrollWidth,stage:c._stage.getBoundingClientRect().width,popup:{x:r.x,right:r.right,width:r.width,scroll:p.scrollWidth,client:p.clientWidth},
      tiny:controls.filter((n)=>{const r=n.getBoundingClientRect();return r.width<43.9||r.height<43.9;}).map((n)=>({control:n.dataset.deviceControl||n.dataset.action||n.dataset.roomAction,w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})),count:controls.length};});
  check(`${label} room controls have no horizontal overflow and every shown input/button is at least44px`,reading.document<=reading.viewport+1
    &&reading.popup.x>=-1&&reading.popup.right<=reading.viewport+1&&reading.popup.scroll<=reading.popup.client+1&&reading.count>20&&reading.tiny.length===0,reading);
}
async function focusAndLocale(page){
  const before=await snapshot(page);await scalar(page,inline(entities.media,'volume'),'31',false);
  await page.evaluate((selector)=>{const c=document.querySelector('taylors3d-card');window.roomActionsFocused=c.shadowRoot.querySelector(selector);},inline(entities.media,'volume'));
  const expected={de:['Lautstärke','Wiedergabe','Raumaktionen'],fr:['Volume','Lire','Actions de la pièce'],es:['Volumen','Reproducir','Acciones de la habitación']};
  for(const [language,words] of Object.entries(expected)){
    await page.evaluate(({language,entity})=>{window.roomActionsFixture.patch(entity,'playing',{volume_level:.2});window.roomActionsFixture.locale(language);},{language,entity:entities.media});await settle(page);
    const result=await page.evaluate(({selector,words})=>{const c=document.querySelector('taylors3d-card'),node=c.shadowRoot.querySelector(selector),p=c._devicePopup;
      return{same:node===window.roomActionsFocused,focused:c.shadowRoot.activeElement===node,value:node.value,caption:node.parentElement.firstChild.textContent,
        play:p.el.querySelector('[data-device-control="play"]').textContent,title:p.el.querySelector('.t3d-room-actions h4').textContent,hint:node.parentElement.lastChild.textContent,
        literal:p.el.textContent.includes('User_Track_<b>été'),words};},{selector:inline(entities.media,'volume'),words});
    const now=await snapshot(page);check(`${language} language-only/readings updates preserve the exact unfinished native input and literal source values`,result.same&&result.focused&&result.value==='31'
      &&result.caption.startsWith(words[0])&&result.play===words[1]&&result.title===words[2]&&result.hint.includes('20 %')&&result.literal
      &&now.calls.length===before.calls.length&&now.writes===before.writes&&now.commits===before.commits,result);
  }
  // Discard the unfinished draft by closing the real panel; opening is read-only.
  await click(page,'.t3d-popup-close');await page.evaluate(()=>window.roomActionsFixture.locale('en'));await settle(page);await openRoom(page);
  const state=await snapshot(page);check('close/reopen follows latest actual reported volume without sending the abandoned draft',state.calls.length===before.calls.length
    &&state.controls.find((n)=>n.entity===entities.media&&n.id==='volume').value==='20');
}
async function held(page){
  for(const target of ['device','room'])for(const kind of ['source','account','connection'])for(const gesture of ['pointer','Space','Enter']){
    await openRoom(page);const selector=target==='device'?inline(entities.media,'play'):shortcut('scene-shortcut'),entity=target==='device'?entities.media:entities.scene;
    const before=await snapshot(page);let point;
    await control(page,selector,async(node)=>{await node.focus();const r=await node.boundingBox();point=[r.x+r.width/2,r.y+r.height/2];
      if(gesture==='pointer'){await page.mouse.move(...point);await page.mouse.down();}else await page.keyboard.down(gesture);});
    const pressed=await snapshot(page);await page.evaluate(({kind,entity})=>window.roomActionsFixture.pulse(kind,entity),{kind,entity});
    if(gesture==='pointer')await page.mouse.up();else{if(gesture==='Enter')await page.keyboard.down('Enter');await page.keyboard.up(gesture);}await settle(page);
    const after=await snapshot(page),initial=gesture==='Enter'?1:0;
    check(`held native ${target} ${gesture} survives ${kind} loss/recovery without a stale release/repeat command`,pressed.calls.length===before.calls.length+initial
      &&after.calls.length===before.calls.length+initial&&after.writes===before.writes,{before:before.calls.length,pressed:pressed.calls.length,after:after.calls.length});
    await openRoom(page);await exactCall(page,`fresh ${target} gesture after ${kind}/${gesture} recovery works once`,()=>click(page,selector),
      target==='device'?['media_player','media_play',{entity_id:entities.media}]:['scene','turn_on',{entity_id:entities.scene}]);
  }
}
async function scalarLoss(page){
  for(const kind of ['source','account','connection','service','permission']){
    await openRoom(page);const before=await snapshot(page);await scalar(page,inline(entities.media,'volume'),'27',false);
    await page.evaluate((kind)=>window.roomActionsFixture.pulse(kind),kind);await page.keyboard.press('Tab');await settle(page);
    const after=await snapshot(page);check(`focused unfinished scalar rejects ${kind} loss/recovery with no incidental command`,after.calls.length===before.calls.length&&after.writes===before.writes);
  }
  await openRoom(page);
  const before=await snapshot(page);await scalar(page,inline(entities.climate,'temperature'),'31');await scalar(page,inline(entities.cover,'position'),'50.5');
  const after=await snapshot(page);check('native fields reject outside advertised temperature and noninteger cover position',after.calls.length===before.calls.length);
}
async function pending(page){
  for(const target of ['device','room']){
    await openRoom(page);const selector=target==='device'?inline(entities.media,'play'):shortcut('scene-shortcut'),before=await snapshot(page);
    await page.evaluate(()=>window.roomActionsFixture.queue.push('deferred'));await click(page,selector);await click(page,selector);
    let state=await snapshot(page);const busy=await page.evaluate((selector)=>document.querySelector('taylors3d-card').shadowRoot.querySelector(selector).disabled,selector);
    check(`${target} native pending state blocks repeat clicks and leaves current HA readings untouched`,busy&&state.calls.length===before.calls.length+1&&same(state.readings,before.readings));
    await page.evaluate(()=>window.roomActionsFixture.finish('Simulated <b>User_Rejection_été'));await settle(page);state=await snapshot(page);
    const plain=await page.evaluate(()=>!document.querySelector('taylors3d-card')._devicePopup.el.querySelector('b'));
    check(`${target} current server rejection is literal text, restores controls and invents no success`,plain&&state.text.includes('User_Rejection_été')&&same(state.readings,before.readings));
    await openRoom(page);await page.evaluate(()=>window.roomActionsFixture.queue.push('deferred'));await click(page,selector);
    await page.evaluate(()=>{window.roomActionsFixture.pulse('account');window.roomActionsFixture.finish('OLD_SIMULATED_ACCOUNT_ERROR');});await settle(page);await openRoom(page);state=await snapshot(page);
    check(`${target} old pending result cannot attach an error to a recovered account panel`,!state.text.includes('OLD_SIMULATED_ACCOUNT_ERROR'));
  }
}
async function unavailable(page){
  await openRoom(page);let before=await snapshot(page);
  await page.evaluate((entity)=>{const c=document.querySelector('taylors3d-card'),old=c._hass.states[entity],attributes={...old.attributes};delete attributes.volume_level;
    c.hass={...c._hass,states:{...c._hass.states,[entity]:{...old,attributes}}};},entities.media);await settle(page);
  let state=await snapshot(page);check('missing native scalar reading remains empty with an honest unknown caption',state.controls.find((n)=>n.entity===entities.media&&n.id==='volume').value===''
    &&state.text.includes('Current value not reported')&&state.calls.length===before.calls.length);
  await page.evaluate((entity)=>window.roomActionsFixture.patch(entity,'playing',{restored:'false'}),entities.media);await settle(page);
  await click(page,inline(entities.media,'play'));state=await snapshot(page);
  check('malformed restored source disables current native controls without trusting a string false',state.controls.filter((n)=>n.entity===entities.media).every((n)=>n.disabled)
    &&!state.text.includes('User_Track_<b>été')&&state.calls.length===before.calls.length);
  await page.evaluate((entity)=>window.roomActionsFixture.patch(entity,'playing',{restored:true}),entities.media);await settle(page);state=await snapshot(page);
  check('restored media is not presented as a fresh title or actionable reading',state.controls.filter((n)=>n.entity===entities.media).every((n)=>n.disabled)
    &&!state.text.includes('User_Track_<b>été')&&state.text.includes('Waiting for a current device reading'));
  await page.evaluate((entity)=>{const c=document.querySelector('taylors3d-card');c.hass={...c._hass,entities:{...c._hass.entities,[entity]:{...c._hass.entities[entity],hidden_by:'user'}}};},entities.media);await settle(page);state=await snapshot(page);
  check('hidden media source is removed without a command',!state.controls.some((n)=>n.entity===entities.media)&&state.calls.length===before.calls.length);
  await page.evaluate((entity)=>{const c=document.querySelector('taylors3d-card');c.hass={...c._hass,entities:{...c._hass.entities,[entity]:{...c._hass.entities[entity],hidden_by:null}}};},entities.media);await settle(page);
  await page.evaluate((entity)=>{const c=document.querySelector('taylors3d-card');c.hass={...c._hass,entities:{...c._hass.entities,[entity]:{...c._hass.entities[entity],entity_category:'diagnostic'}}};},entities.media);await settle(page);state=await snapshot(page);
  check('diagnostic media source is removed rather than offered for action',!state.controls.some((n)=>n.entity===entities.media)&&state.calls.length===before.calls.length);
  await page.evaluate(({entity,reading})=>{const c=document.querySelector('taylors3d-card');c.hass={...c._hass,states:{...c._hass.states,[entity]:reading},
    entities:{...c._hass.entities,[entity]:{...c._hass.entities[entity],entity_category:null}}};},{entity:entities.media,reading:roomActionsReadings().states[entities.media]});await settle(page);
  // Absent capability/service definitions are not inferred from a friendly name.
  before=await snapshot(page);await page.evaluate(({climate,lock})=>{window.roomActionsFixture.patch(climate,'heat_cool',{});window.roomActionsFixture.patch(lock,'locked',{code_format:'^\\d{4}$'});},{climate:entities.climate,lock:entities.lock});await settle(page);state=await snapshot(page);
  check('range thermostat and PIN lock retain All controls without invented single target/PIN command',!state.controls.some((n)=>n.entity===entities.climate&&n.id==='temperature')
    &&!state.controls.some((n)=>n.entity===entities.lock)&&state.calls.length===before.calls.length);
  await page.evaluate(({climate,lock})=>{window.roomActionsFixture.patch(climate,'heat',{});window.roomActionsFixture.patch(lock,'locked',{code_format:null});},{climate:entities.climate,lock:entities.lock});await settle(page);
}
async function fallback(page){
  await openRoom(page);let before=await snapshot(page);
  await click(page,`[data-action="more-info"][data-entity="${entities.climate}"]`);let state=await snapshot(page);
  check('All controls delegates exact entity to native HA fallback without calling a service',same(state.infos,[entities.climate])&&state.calls.length===before.calls.length);
  await openRoom(page);await exactCall(page,'existing native switch quick toggle remains usable',()=>click(page,`[data-action="toggle"][data-entity="${entities.switch}"]`),['switch','toggle',{entity_id:entities.switch}]);
  const lightControls=await page.evaluate((entity)=>{const c=document.querySelector('taylors3d-card'),p=c._devicePopup.el;
    return{brightness:!!p.querySelector(`[data-light-control="brightness"][data-entity="${entity}"]`),colour:!!p.querySelector(`[data-light-control="color"][data-entity="${entity}"]`)};},entities.lamp);
  check('existing actual supported light brightness/colour controls remain available inline',lightControls.brightness&&lightControls.colour,lightControls);
  await exactCall(page,'existing native light quick toggle remains usable',()=>click(page,`[data-action="toggle"][data-entity="${entities.lamp}"]`),['light','toggle',{entity_id:entities.lamp}]);
  before=await snapshot(page);await click(page,`[data-action="camera-view"][data-entity="${entities.camera}"]`);
  await page.waitForFunction(()=>document.querySelector('taylors3d-card')._devicePopup.cameraFeed.status==='ready');state=await snapshot(page);
  check('existing camera controls mount one explicitly simulated native picture-entity boundary with no service',state.cameraActive===1&&state.calls.length===before.calls.length
    &&state.cameraCards.at(-1).config.type==='picture-entity'&&state.cameraCards.at(-1).config.entity===entities.camera&&state.cameraCards.at(-1).config.tap_action.action==='none');
  await click(page,'[data-action="close-camera"]');state=await snapshot(page);check('camera close removes its actual simulated player element',state.cameraActive===0&&state.cameraStatus==='closed');
}
async function narrow(page){
  await page.evaluate(()=>{const card=document.querySelector('taylors3d-card');window.roomActionsViewportIdentity={card,renderer:card._view.renderer,fixture:window.roomActionsFixture};});
  await page.setViewport({width:320,height:1050,deviceScaleFactor:1,isMobile:true,hasTouch:true});await settle(page);
  check('width-only touch resize retains the configured card, renderer and current fixture',await page.evaluate(()=>{
    const previous=window.roomActionsViewportIdentity,card=document.querySelector('taylors3d-card');
    return !!previous?.fixture&&card===previous.card&&card._view.renderer===previous.renderer&&window.roomActionsFixture===previous.fixture;
  }));
  await openRoom(page);
  await page.evaluate(()=>window.roomActionsFixture.locale('de'));await settle(page);await geometry(page,'320px phone');
  const before=await snapshot(page);
  for(const selector of [shortcut('scene-shortcut'),inline(entities.media,'volume'),inline(entities.climate,'temperature'),inline(entities.cover,'position'),inline(entities.vacuum,'fan-speed')]){
    await control(page,selector,async(node)=>{await node.focus();await page.keyboard.press('Shift');});
    const geometry=await page.evaluate((selector)=>{const c=document.querySelector('taylors3d-card'),n=c.shadowRoot.querySelector(selector),p=c._devicePopup.el,r=n.getBoundingClientRect(),b=p.getBoundingClientRect(),style=getComputedStyle(n);
      return{focused:c.shadowRoot.activeElement===n,left:r.left,right:r.right,top:r.top,bottom:r.bottom,popupTop:b.top,popupBottom:b.bottom,outline:style.outlineStyle,width:style.outlineWidth,label:n.getAttribute('aria-label')||n.textContent};},selector);
    check(`320px ${selector} scrolls into view with readable label and visible native focus`,geometry.focused&&geometry.left>=-1&&geometry.right<=321
      &&geometry.top>=geometry.popupTop-1&&geometry.bottom<=geometry.popupBottom+1&&geometry.label.length>0&&geometry.outline!=='none'&&parseFloat(geometry.width)>=2,geometry);
  }
  await screenshot(page,'phone-320-focused');const after=await snapshot(page);check('phone focus and locale cause no service/layout/history writes',after.calls.length===before.calls.length&&after.writes===before.writes&&after.commits===before.commits);
  await page.evaluate(()=>window.roomActionsFixture.locale('en'));await settle(page);
}

const editorField=(name,index)=>`[data-field="room-actions-${name}"]${index===undefined?'':`[data-ra-index="${index}"]`}`;
const editorAction=(name,index)=>`[data-act="room-actions-${name}"]${index===undefined?'':`[data-ra-index="${index}"]`}`;
const editorSnapshot=(page)=>page.evaluate(()=>{const c=document.querySelector('taylors3d-card'),ed=c._edit._roomActionsEditor,section=c.shadowRoot.querySelector('[data-room-actions-editor]');
  return{draft:structuredClone(ed.draft),selected:ed.roomId,text:section.textContent,chooser:section.querySelector('[data-field="room-actions-room"]').value,
    disabled:[...section.querySelectorAll('input,select,button')].map((node)=>({field:node.dataset.field,action:node.dataset.act,disabled:node.disabled})),
    options:[...section.querySelector('[data-field="room-actions-room"]').options].map((node)=>({value:node.value,text:node.textContent,disabled:node.disabled,selected:node.selected}))};});
async function chooseRoom(page,id){
  // One explicit selection on the real native chooser, by its exact option ID.
  // Do not set controller state or substitute a friendly room name.
  await control(page,editorField('room'),async(node)=>{
    const available=await node.evaluate((select,id)=>[...select.options].some((option)=>option.value===id&&!option.disabled),id);
    if(!available)throw new Error('Exact review/edit room option is unavailable: '+id);await node.focus();await node.select(id);
  });
  const current=await editorSnapshot(page);if(current.chooser!==id||current.selected!==id)throw new Error('Exact room chooser did not select '+id);
}
async function removalHistory(page,before,target,name){
  await click(page,editorAction('save'));await page.waitForFunction((expected)=>window.roomActionsFixture.ws.filter((m)=>m.type==='taylors3d/layout/set').length===expected,{},before.writes+1);await settle(page);
  const saved=await snapshot(page),expected={...before.layout.room_actions,rooms:before.layout.room_actions.rooms.filter((row)=>row.room_id!==target)};
  check(`${name} explicit Save removes only exact saved row in one layout/history/storage step`,same(saved.layout.room_actions,expected)&&saved.commits===before.commits+1
    &&saved.writes===before.writes+1&&saved.history===before.history+1&&saved.calls.length===before.calls.length&&same(saved.readings,before.readings),
    {target,rooms:[before.layout.room_actions.rooms.length,saved.layout.room_actions.rooms.length],history:[before.history,saved.history],writes:[before.writes,saved.writes]});
  await click(page,'[data-act="history-undo"]');await page.waitForFunction((expected)=>window.roomActionsFixture.ws.filter((m)=>m.type==='taylors3d/layout/set').length===expected,{},before.writes+2);await settle(page);
  const undone=await snapshot(page);check(`${name} real Undo restores exact row, action order and imported extras without a device command`,same(undone.layout.room_actions,before.layout.room_actions)
    &&undone.calls.length===before.calls.length&&same(undone.readings,before.readings));
  await click(page,'[data-act="history-redo"]');await page.waitForFunction((expected)=>window.roomActionsFixture.ws.filter((m)=>m.type==='taylors3d/layout/set').length===expected,{},before.writes+3);await settle(page);
  const redone=await snapshot(page);check(`${name} real Redo reapplies the exact bounded removal`,same(redone.layout.room_actions,expected)&&redone.calls.length===before.calls.length
    &&redone.commits===before.commits+3&&redone.writes===before.writes+3&&redone.history===saved.history);
  return redone;
}
async function roomRemoval(page){
  context='Original native exact saved-room removal';const before=await snapshot(page);
  await click(page,'[data-bubble="edit"]');await click(page,'[data-act="tab"][data-id="rooms"]');
  for(const[kind,gesture]of [['source','Space'],['account','pointer'],['connection','Enter']]){
    await chooseRoom(page,roomId);
    await control(page,editorAction('remove-room'),async(node)=>{await node.focus();if(gesture==='pointer'){const r=await node.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();}else await page.keyboard.down(gesture);});
    await page.evaluate(({kind,entity})=>window.roomActionsFixture.pulse(kind,entity),{kind,entity:entities.scene});
    if(gesture==='pointer')await page.mouse.up();else await page.keyboard.up(gesture);await settle(page);
    const held=await snapshot(page),draft=await editorSnapshot(page);
    check(`held exact Remove saved room ${gesture} cannot revive across ${kind} loss/recovery`,same(draft.draft,before.layout.room_actions)&&same(held.layout,before.layout)
      &&held.commits===before.commits&&held.writes===before.writes&&held.calls.length===before.calls.length);
    await click(page,editorAction('cancel'));
  }
  await chooseRoom(page,roomId);await click(page,editorAction('remove',0));await click(page,editorAction('remove',0));
  let draft=await editorSnapshot(page),current=await snapshot(page);const empty=draft.draft.rooms.find((row)=>row.room_id===roomId),original=before.layout.room_actions.rooms.find((row)=>row.room_id===roomId);
  check('removing the last individual shortcut retains its exact empty room row and imported extras until room deletion',empty?.actions.length===0&&same(empty.extension,original.extension)
    &&same(current.layout,before.layout)&&current.commits===before.commits&&current.calls.length===before.calls.length);
  await click(page,editorAction('remove-room'));draft=await editorSnapshot(page);current=await snapshot(page);
  check('native exact saved-room deletion is a draft only',!draft.draft.rooms.some((row)=>row.room_id===roomId)&&same(current.layout,before.layout)&&current.commits===before.commits
    &&current.writes===before.writes&&current.calls.length===before.calls.length);
  await click(page,editorAction('cancel'));await chooseRoom(page,roomId);draft=await editorSnapshot(page);current=await snapshot(page);
  check('native Cancel restores exact saved actions/row extras without a write',same(draft.draft,before.layout.room_actions)&&same(current.layout,before.layout)&&current.history===before.history
    &&current.commits===before.commits&&current.writes===before.writes&&current.calls.length===before.calls.length);
  await click(page,editorAction('remove-room'));await removalHistory(page,before,roomId,'Original current room');
  await click(page,'[data-bubble="edit"]');await openRoom(page);current=await snapshot(page);
  check('removing saved shortcuts leaves the current model room/devices usable and offers no deleted shortcut',current.room===roomId&&current.shortcuts.length===0
    &&current.controls.some((control)=>control.entity===entities.media&&control.id==='play')&&current.calls.length===before.calls.length
    &&current.sameRenderer&&current.contexts===1&&current.lights===before.lights&&current.pool===before.pool);
}
async function editorHeld(page){
  for(const kind of ['source','account','connection'])for(const gesture of ['pointer','Space','Enter']){
    await enumLast(page,editorField('room'));await scalar(page,editorField('label',0),'User_Held_Draft_été');
    const before=await snapshot(page);
    await control(page,editorAction('save'),async(node)=>{await node.focus();if(gesture==='pointer'){const r=await node.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();}
      else await page.keyboard.down(gesture);});
    await page.evaluate(({kind,entity})=>window.roomActionsFixture.pulse(kind,entity),{kind,entity:entities.scene});
    if(gesture==='pointer')await page.mouse.up();else await page.keyboard.up(gesture);await settle(page);
    const after=await snapshot(page);check(`held actual editor Save ${gesture} cannot revive across ${kind} loss/recovery`,after.commits===before.commits&&after.writes===before.writes
      &&after.history===before.history&&after.calls.length===before.calls.length&&same(after.layout,before.layout));
    await click(page,editorAction('cancel'));
  }
}
async function editor(page,phone=false){
  context='real Rooms-tab RoomActionsEditor';const before=await snapshot(page);
  await click(page,'[data-bubble="edit"]');await click(page,'[data-act="tab"][data-id="rooms"]');
  const chooser=await page.evaluate((selector)=>{const c=document.querySelector('taylors3d-card'),select=c.shadowRoot.querySelector(selector);
    return{value:select.value,options:[...select.options].map((n)=>({value:n.value,label:n.textContent,disabled:n.disabled}))};},editorField('room'));
  check(`${phone?'320px':'desktop'} editor starts with a deliberate exact drawn/model room chooser`,chooser.value===''&&chooser.options.some((n)=>n.value===roomId&&!n.disabled&&n.label.includes(roomId)),chooser);
  if(!phone)await editorHeld(page);
  // The fixture has ground then upper canonical model rooms; native End chooses
  // the exact upper-room option rather than deriving it from a friendly name.
  await enumLast(page,editorField('room'));
  const selected=await page.evaluate((selector)=>document.querySelector('taylors3d-card').shadowRoot.querySelector(selector).value,editorField('room'));
  check('native room chooser selects exact current model-room ID',selected===roomId,selected);
  const label=phone?'User_Phone_Draft_été':'User_Saved_New_<b>été';
  if(!phone){await enumLast(page,editorField('new-source'));await click(page,editorAction('add'));}
  const index=phone?0:2,selector=editorField('label',index);await scalar(page,selector,label,false);
  await page.evaluate((selector)=>{window.roomActionsEditorFocused=document.querySelector('taylors3d-card').shadowRoot.querySelector(selector);},selector);
  await page.evaluate((entity)=>{window.roomActionsFixture.patch(entity,'playing',{media_title:'User_Track_<b>été'});window.roomActionsFixture.locale('fr');},entities.media);await settle(page);
  const stable=await page.evaluate((selector)=>{const c=document.querySelector('taylors3d-card'),node=c.shadowRoot.querySelector(selector),section=node.closest('[data-room-actions-editor]'),r=node.getBoundingClientRect();
    return{same:node===window.roomActionsEditorFocused,focus:c.shadowRoot.activeElement===node,value:node.value,heading:section.querySelector('h3').textContent,
      overflow:section.scrollWidth>section.clientWidth+1,width:r.width,height:r.height,left:r.left,right:r.right,tiny:[...section.querySelectorAll('input,select,button')].filter((n)=>!n.hidden&&getComputedStyle(n).display!=='none'&&(n.getBoundingClientRect().height<43.9||n.getBoundingClientRect().width<43.9)).map((n)=>n.dataset.act||n.dataset.field)};},selector);
  const draft=await snapshot(page);check(`${phone?'320px':'desktop'} actual editor retains exact focused literal draft through readings/locale with no Save or device call`,stable.same&&stable.focus&&stable.value===label
    &&!stable.overflow&&stable.width>=44&&stable.height>=44&&stable.tiny.length===0&&draft.calls.length===before.calls.length&&draft.commits===before.commits
    &&draft.writes===before.writes&&same(draft.layout.room_actions,before.layout.room_actions),stable);
  await page.keyboard.press('Tab');await settle(page);
  if(phone){
    await screenshot(page,'phone-320-editor');await click(page,editorAction('cancel'));const canceled=await snapshot(page);
    check('320px editor Cancel discards the unfinished draft without layout/history/service changes',same(canceled.layout,before.layout)&&canceled.commits===before.commits
      &&canceled.writes===before.writes&&canceled.history===before.history&&canceled.calls.length===before.calls.length);
  }else{
    await click(page,editorAction('save'));await page.waitForFunction((expected)=>window.roomActionsFixture.ws.filter((m)=>m.type==='taylors3d/layout/set').length===expected,{},before.writes+1);await settle(page);
    const saved=await snapshot(page),actions=saved.layout.room_actions.rooms.find((n)=>n.room_id==='m:fp_room_upper').actions;
    check('one real editor Save commits exactly one history step and one simulated storage write with exact scene/script IDs',saved.commits===before.commits+1&&saved.writes===before.writes+1&&saved.history===before.history+1
      &&actions.length===3&&actions[0].entity===entities.scene&&actions[1].entity===entities.script&&actions[2].entity===entities.script&&actions[2].label===label
      &&same(saved.layout.room_actions.extension,before.layout.room_actions.extension)&&same(saved.layout.room_actions.rooms[0].extension,before.layout.room_actions.rooms[0].extension)
      &&saved.calls.length===before.calls.length,{actions,history:[before.history,saved.history],writes:[before.writes,saved.writes],commits:[before.commits,saved.commits]});
    await click(page,'[data-act="history-undo"]');await page.waitForFunction((expected)=>window.roomActionsFixture.ws.filter((m)=>m.type==='taylors3d/layout/set').length===expected,{},before.writes+2);await settle(page);
    const undone=await snapshot(page);check('real history Undo restores exact prior saved room shortcuts with no device command',same(undone.layout.room_actions,before.layout.room_actions)&&undone.calls.length===before.calls.length);
    await click(page,'[data-act="history-redo"]');await page.waitForFunction((expected)=>window.roomActionsFixture.ws.filter((m)=>m.type==='taylors3d/layout/set').length===expected,{},before.writes+3);await settle(page);
    const redone=await snapshot(page);check('real history Redo restores exact new shortcut once',same(redone.layout.room_actions,saved.layout.room_actions)&&redone.calls.length===before.calls.length);
    // Native Cancel after a separate draft leaves the committed data intact.
    await enumLast(page,editorField('room'));await scalar(page,editorField('label',0),'User_Discarded_été');await click(page,editorAction('cancel'));const canceled=await snapshot(page);
    check('actual editor Cancel preserves committed shortcuts/history and creates no extra write',same(canceled.layout.room_actions,saved.layout.room_actions)&&canceled.commits===redone.commits
      &&canceled.writes===redone.writes&&canceled.history===redone.history&&canceled.calls.length===before.calls.length);
  }
  await page.evaluate(()=>window.roomActionsFixture.locale('en'));await settle(page);await click(page,'[data-bubble="edit"]');await openRoom(page);
  const end=await snapshot(page);check(`${phone?'320px':'desktop'} editor returns to exact current room controls without a device action`,end.room===roomId&&end.calls.length===before.calls.length);
  if(!phone)check('saved added action appears as a literal current room shortcut',end.shortcuts.length===3&&end.shortcuts.some((n)=>n.text==='User_Saved_New_<b>été'&&!n.disabled));
}

async function preflight(){
  const {transform}=await import('esbuild'),{JSDOM}=await import('jsdom'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const fixture=await serveRoomActionsFixture(root,'source');
  try{
    for(const kind of ['source','bundle']){const html=roomActionsHtml(kind),document=new JSDOM(html).window.document;
      const script=document.querySelector('script[type="module"]').textContent;await transform(script,{loader:'js'});
      check(`${kind} generated module parses and explicitly labels simulated transport`,html.includes(`/${kind==='source'?'src':'dist'}/taylors3d-card.js`)&&document.body.textContent.includes('SIMULATED Home Assistant'));}
    await transform(`(${prepareRoomActionsFixture.toString()})`,{loader:'js'});
    const bytes=fixture.model,model=await new Promise((resolve,reject)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'',resolve,reject));
    check('authored GLB loads its exact tagged upper room/camera/light without photo assets',!!model.scene.getObjectByName(ids.upperRoom)&&!!model.scene.getObjectByName(ids.camera)&&!!model.scene.getObjectByName(ids.lamp));
    const html=await fetch(fixture.base+'/demo/room-actions-fixture.html'),denied=await fetch(fixture.base+`/api/taylors3d/model/${key}`),allowed=await fetch(fixture.base+`/api/taylors3d/model/${key}`,{headers:{authorization:'Bearer simulated-room-actions'}});
    check('fixture serves real module HTML and requires its explicitly simulated model authorization',html.status===200&&denied.status===401&&allowed.status===200&&(await allowed.arrayBuffer()).byteLength===bytes.length);
    const dom=new JSDOM('<!doctype html><div id="host"></div>',{url:'http://fixture/'});
    for(const name of ['window','document','HTMLElement','Element','MutationObserver','CustomEvent','Event'])globalThis[name]=name==='window'?dom.window:dom.window[name];
    const {DevicePopup}=await import('../src/device-popup.js'),{roomActionsFor}=await import('../src/room-actions.js');
    const data=roomActionsReadings(),hass={...data,user:{id:'simulated-preflight',is_active:true,is_admin:true},connection:{connected:true},callService(){},entities:{},areas:{},config:{unit_system:{temperature:'°C'}}};
    let serviceCalls=0;const popup=new DevicePopup(document.querySelector('#host'),{onAction(){serviceCalls++;},getRoomActions:(room)=>roomActionsFor({hass,settings:roomActionsLayout().room_actions,roomId:room.id,rooms:[room]}),onRoomAction(){serviceCalls++;}});
    popup.update(hass);popup.showRoom({id:roomId,area_id:'upper'},[entities.media,entities.climate,entities.cover,entities.lock,entities.vacuum].map((entityId)=>({entityId,areaId:'upper'})));
    check('actual popup DOM preflight exposes literal saved shortcuts and all five native domain controls read-only',popup.el.querySelectorAll('[data-room-action]').length===2
      &&!popup.el.querySelector('b')&&popup.el.querySelector(inline(entities.media,'volume'))&&popup.el.querySelector(inline(entities.climate,'temperature'))
      &&popup.el.querySelector(inline(entities.cover,'position'))&&popup.el.querySelector(inline(entities.lock,'unlock'))&&popup.el.querySelector(inline(entities.vacuum,'fan-speed'))&&serviceCalls===0);
    popup.dispose();
    const{RoomActionsEditor}=await import('../src/room-actions-editor.js'),card={_hass:hass,_layout:roomActionsLayout(),_config:{},isConnected:true,_editing:true,_loading:false,
      _edit:{tab:'rooms'},_view:{model:{root:{}}},_floors:[{id:'upper',name:'Simulated upper',elevation:4}],_roomList:[{room:{id:roomId,floor_id:'upper'},floorId:'upper',name:'User_Room_été'}]};
    const editor=new RoomActionsEditor(card),host=document.querySelector('#host');host.innerHTML=editor.render();editor.updatePreviews(host);
    check('actual editor fragment starts with an exact room chooser and native Save/Cancel, with no service',host.querySelector(editorField('room')).value===''
      &&[...host.querySelector(editorField('room')).options].some((n)=>n.value===roomId)&&host.querySelector(editorAction('save')).disabled&&host.querySelector(editorAction('cancel'))&&serviceCalls===0);
    editor.dispose();
    // This early check uses the actual editor in a tiny explicitly simulated
    // parent host. Real Root Save/history/native keyboard geometry are browser-only.
    let draftCommits=0,capacityEditor;
    const capacityCard={...card,_layout:roomActionsCapacityLayout(),_edit:{tab:'rooms',panel:host,commit(layout){draftCommits++;capacityCard._layout=structuredClone(layout);}}};
    const renderCapacity=()=>{host.innerHTML=capacityEditor.render();capacityEditor.updatePreviews(host);};
    capacityEditor=new RoomActionsEditor(capacityCard,renderCapacity);renderCapacity();
    host.addEventListener('change',(event)=>capacityEditor.onChange(event.target.dataset.field,event.target));
    host.addEventListener('click',(event)=>{const node=event.target.closest('button[data-act]');if(node)capacityEditor.onClick(node.dataset.act,node);});
    const selectMissing=()=>{const node=host.querySelector(editorField('room'));node.value='simulated-obsolete-127';node.dispatchEvent(new Event('change',{bubbles:true}));};
    selectMissing();
    check('actual capacity editor fragment offers exact missing empty row for deletion while editing remains blocked',capacityEditor.roomId==='simulated-obsolete-127'
      &&capacityEditor.draft.rooms.length===128&&!host.querySelector(editorAction('remove-room')).disabled&&host.querySelector(editorField('new-source')).disabled);
    host.querySelector(editorAction('remove-room')).click();
    check('actual editor fragment deletion is a bounded127-row draft with pending removal Save and no commit',capacityEditor.draft.rooms.length===127
      &&host.querySelector(editorField('room')).value==='simulated-obsolete-127'&&!host.querySelector(editorAction('save')).disabled
      &&capacityCard._layout.room_actions.rooms.length===128&&draftCommits===0&&serviceCalls===0);
    host.querySelector(editorAction('cancel')).click();
    check('actual editor fragment Cancel restores exact128-row imported data',same(capacityEditor.draft,capacityCard._layout.room_actions)&&capacityEditor.draft.rooms.length===128&&draftCommits===0);
    selectMissing();host.querySelector(editorAction('remove-room')).click();host.querySelector(editorAction('save')).click();
    check('actual editor fragment missing-row Save delegates only one exact bounded layout proposal',capacityCard._layout.room_actions.rooms.length===127
      &&!capacityCard._layout.room_actions.rooms.some((row)=>row.room_id==='simulated-obsolete-127')&&draftCommits===1&&serviceCalls===0);
    capacityEditor.dispose();dom.window.close();console.log('Preflight covers parsing, GLB/routes and real popup/editor DOM only; Chrome/native geometry/Root history/service behavior remains for root.');
  }finally{await fixture.close();}
}

async function originalContexts(browser,fixture){
  // A fresh actual Root in Original style proves the synchronous observer before
  // its usual deferred DOM update. House itself refreshes its panel immediately.
  const ownerMode=mode;mode+=' / Original';
  const{page,errors}=await newPage(browser,{width:1440,height:1150});
  await page.evaluateOnNewDocument(()=>{window.roomActionsContexts=new Set();const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){const result=original.call(this,kind,...args);if(result&&/^webgl/.test(kind))window.roomActionsContexts.add(this);return result;};});
  const external=[];page.on('request',(request)=>{const url=new URL(request.url());if(/^https?:$/.test(url.protocol)&&url.hostname!=='127.0.0.1')external.push(url.href);});
  try{
    await page.goto(fixture.base+'/demo/room-actions-fixture.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.roomActionsModuleReady);
    await page.bringToFront();await page.evaluate(prepareRoomActionsFixture,{layout:fixture.layout,readings:fixture.readings,entities,key,style:'original'});
    await page.waitForFunction(()=>{const c=document.querySelector('taylors3d-card');return c._view?.model&&!c._loading&&c._roomList?.some((r)=>r.room.id==='m:fp_room_upper');},{timeout:30000});await settle(page);
    const before=await snapshot(page);await held(page);await scalarLoss(page);const after=await snapshot(page);
    check('Original deferred updates preserve synchronous held/scalar context fences without passive writes or another renderer/light',after.commits===0&&after.writes===0&&after.history===0
      &&after.contexts===1&&after.sameRenderer&&after.lights===before.lights&&after.pool===before.pool);
    check('Original context proof has no external requests/browser errors',external.length===0&&errors.length===0,{external,errors});browserErrors.push(...errors);
    await roomRemoval(page);
  }finally{await page.close();mode=ownerMode;}
}

async function capacityRemoval(browser,fixture){
  const ownerMode=mode;mode+=' /128 saved rooms';context='Original capacity/missing-empty saved-room deletion';
  const{page,errors}=await newPage(browser,{width:1440,height:1150});
  await page.evaluateOnNewDocument(()=>{window.roomActionsContexts=new Set();const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){const result=original.call(this,kind,...args);if(result&&/^webgl/.test(kind))window.roomActionsContexts.add(this);return result;};});
  const external=[];page.on('request',(request)=>{const url=new URL(request.url());if(/^https?:$/.test(url.protocol)&&url.hostname!=='127.0.0.1')external.push(url.href);});
  try{
    const capacity=roomActionsCapacityLayout(fixture.model.length),missing='simulated-obsolete-127',ground='m:fp_room_ground';
    await page.goto(fixture.base+'/demo/room-actions-fixture.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.roomActionsModuleReady);
    await page.bringToFront();await page.evaluate(prepareRoomActionsFixture,{layout:capacity,readings:fixture.readings,entities,key,style:'original'});
    await page.waitForFunction(()=>{const c=document.querySelector('taylors3d-card');return c._view?.model&&!c._loading&&c._roomList?.some((r)=>r.room.id==='m:fp_room_ground');},{timeout:30000});await settle(page);
    const before=await snapshot(page);check('capacity fixture has exactly128 saved rows with an explicit obsolete empty row and a current absent ground room',before.layout.room_actions.rooms.length===128
      &&before.layout.room_actions.rooms.find((row)=>row.room_id===missing)?.actions.length===0&&!before.layout.room_actions.rooms.some((row)=>row.room_id===ground)&&before.calls.length===0);
    await click(page,'[data-bubble="edit"]');await click(page,'[data-act="tab"][data-id="rooms"]');
    await chooseRoom(page,ground);await enumLast(page,editorField('new-source'));
    let draft=await editorSnapshot(page),current=await snapshot(page);
    check('at128 saved rows the current missing ground-room shortcut cannot be added beyond capacity',draft.draft.rooms.length===128&&draft.disabled.find((node)=>node.action==='room-actions-add')?.disabled===true
      &&same(current.layout,before.layout)&&current.commits===0&&current.writes===0&&current.calls.length===0);
    await chooseRoom(page,missing);draft=await editorSnapshot(page);
    check('saved missing empty room is selectable for exact review/deletion while source editing stays disabled',draft.selected===missing&&draft.options.some((node)=>node.value===missing&&!node.disabled&&node.selected)
      &&draft.disabled.find((node)=>node.field==='room-actions-new-source')?.disabled===true&&draft.disabled.find((node)=>node.action==='room-actions-add')?.disabled===true
      &&draft.disabled.find((node)=>node.action==='room-actions-remove-room')?.disabled===false);
    await click(page,editorAction('remove-room'));draft=await editorSnapshot(page);current=await snapshot(page);
    check('removing one exact obsolete empty row releases draft capacity and retains its pending removal chooser',draft.draft.rooms.length===127&&!draft.draft.rooms.some((row)=>row.room_id===missing)
      &&draft.chooser===missing&&draft.options.some((node)=>node.value===missing&&node.selected)&&draft.disabled.find((node)=>node.action==='room-actions-save')?.disabled===false
      &&same(current.layout,before.layout)&&current.commits===0&&current.writes===0&&current.calls.length===0);
    await click(page,editorAction('cancel'));draft=await editorSnapshot(page);current=await snapshot(page);
    check('Cancel restores all128 saved rows and obsolete-row imported extras without a write/device action',same(draft.draft,before.layout.room_actions)&&same(current.layout,before.layout)
      &&current.history===before.history&&current.commits===0&&current.writes===0&&current.calls.length===0);
    await chooseRoom(page,missing);await click(page,editorAction('remove-room'));const redone=await removalHistory(page,before,missing,'Missing empty room at capacity');
    await chooseRoom(page,ground);await enumLast(page,editorField('new-source'));draft=await editorSnapshot(page);
    check('saved removal at127 rows admits an explicit current ground-room shortcut within the bound',redone.layout.room_actions.rooms.length===127&&draft.disabled.find((node)=>node.action==='room-actions-add')?.disabled===false);
    await click(page,editorAction('add'));draft=await editorSnapshot(page);current=await snapshot(page);const added=draft.draft.rooms.find((row)=>row.room_id===ground);
    check('native Add after capacity recovery creates only a current exact ground-room draft with raw script source',draft.draft.rooms.length===128&&added?.actions.length===1&&added.actions[0].entity===entities.script
      &&same(current.layout,redone.layout)&&current.commits===redone.commits&&current.writes===redone.writes&&current.calls.length===0);
    await click(page,editorAction('cancel'));current=await snapshot(page);check('Cancel of the recovered-capacity new row keeps only the saved removal',same(current.layout,redone.layout)
      &&current.history===redone.history&&current.commits===redone.commits&&current.writes===redone.writes&&current.calls.length===0);
    check('missing/empty capacity proof retains one renderer/light pool with no service or external/browser errors',current.contexts===1&&current.sameRenderer&&current.lights===before.lights&&current.pool===before.pool
      &&current.calls.length===0&&external.length===0&&errors.length===0,{external,errors});browserErrors.push(...errors);
  }finally{await page.close();mode=ownerMode;}
}

async function browserProof(){
  console.log('Scope: actual Root/card/renderer/native controls; anonymous simulated HA WS/services/camera/storage. No real HA durability, physical device result or photograph claim.');
  if(fs.existsSync(path.join(root,'dist/taylors3d-card.js')))console.log('Bundle SHA256: '+createHash('sha256').update(fs.readFileSync(path.join(root,'dist/taylors3d-card.js'))).digest('hex'));
  const modes=process.argv.includes('--source-only')?['source']:process.argv.includes('--bundle-only')?['bundle']:['source','bundle'];
  let running,fixture;
  try{for(mode of modes){
    fixture=await serveRoomActionsFixture(root,mode);running=await launch();const{page,errors}=await newPage(running.browser,{width:1440,height:1150,isMobile:true,hasTouch:true});
    await page.evaluateOnNewDocument(()=>{window.roomActionsContexts=new Set();const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){const result=original.call(this,kind,...args);if(result&&/^webgl/.test(kind))window.roomActionsContexts.add(this);return result;};});
    const external=[];page.on('request',(request)=>{const url=new URL(request.url());if(/^https?:$/.test(url.protocol)&&url.hostname!=='127.0.0.1')external.push(url.href);});
    await page.goto(fixture.base+'/demo/room-actions-fixture.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.roomActionsModuleReady);
    await page.bringToFront();await page.evaluate(prepareRoomActionsFixture,{layout:fixture.layout,readings:fixture.readings,entities,key});
    await page.waitForFunction(()=>{const c=document.querySelector('taylors3d-card');return c._view?.model&&!c._loading&&c._roomList?.some((r)=>r.room.id==='m:fp_room_upper');},{timeout:30000});await settle(page);
    const initial=await snapshot(page);check('baseline owns one actual renderer and authenticated uploaded model without device action',initial.contexts===1&&initial.sameRenderer&&initial.calls.length===0
      &&fixture.requests.some((r)=>r.path===`/api/taylors3d/model/${key}`));
    await baseline(page);await devices(page);await focusAndLocale(page);await held(page);await scalarLoss(page);await pending(page);await unavailable(page);await fallback(page);
    const controlled=await snapshot(page);check('all room/device controls save no passive layout/history',controlled.commits===0&&controlled.writes===0&&controlled.history===0);
    await editor(page);await narrow(page);await editor(page,true);
    const end=await snapshot(page);check('control/editor proof retains existing renderer/light pool; only explicit Save and history restoration write',end.sameRenderer&&end.contexts===1&&end.lights===initial.lights&&end.pool===initial.pool
      &&end.commits===3&&end.writes===3,{contexts:end.contexts,lights:[initial.lights,end.lights],pool:[initial.pool,end.pool],writes:end.writes,commits:end.commits});
    check('no external/private assets or unexpected fixture routes',external.length===0&&fixture.unexpected.length===0,{external,unexpected:fixture.unexpected});
    check('no unexpected browser errors',errors.length===0,errors);browserErrors.push(...errors);
    await page.close();await originalContexts(running.browser,fixture);await capacityRemoval(running.browser,fixture);
    await running.close();running=null;await fixture.close();fixture=null;
  }}catch(error){console.error('Native room-actions proof stopped at '+context+': '+error.stack);checks.push(false);}
  finally{if(running)await running.close();if(fixture)await fixture.close();}
}

if(process.argv.includes('--preflight'))await preflight();else await browserProof();
console.log(`${checks.filter(Boolean).length}/${checks.length} room-actions checks passed; ${browserErrors.length} browser errors.`);
if(checks.some((pass)=>!pass)||browserErrors.length)process.exitCode=1;
