// Actual source/bundled Root, authored room geometry and native Chrome mouse,
// touch and keyboard. All HA readings/services/storage below are simulation.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { prepareRoomActionsFixture, serveRoomActionsFixture, roomActionEntities as entities, roomActionLayoutKey as key,
  roomActionRoomId as roomId } from './lib/room-actions-fixture.mjs';
import { roomSheetHeights } from '../src/room-sheet.js';

const results = [], errors = []; let mode = '', stage = 'setup', overlayBaseline;
const check = (name, passed, detail) => {results.push(!!passed);console.log(`${passed ? 'ok  ' : 'FAIL'} ${mode} ${name}${detail === undefined ? '' : ' – '+JSON.stringify(detail)}`);};
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function target(page, selector, action) {
  stage = selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector),selector);
  try {
    const element = handle.asElement(); if (!element) throw new Error('Missing native target '+selector);
    await element.evaluate((node) => node.scrollIntoView({block:'center',inline:'nearest'}));
    const rect = await element.boundingBox(); if (!rect) throw new Error('Hidden native target '+selector);
    const point = [rect.x+rect.width/2,rect.y+rect.height/2];
    const hit = await element.evaluate((node,{x,y}) => {const hit=node.getRootNode().elementFromPoint(x,y);return hit===node||node.contains(hit);},{x:point[0],y:point[1]});
    if (!hit) throw new Error('Covered native target '+selector);
    await action(element,point);
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector) => target(page,selector,(_node,point) => page.mouse.click(...point));
const snapshot = (page) => page.evaluate(() => {
  const c = document.querySelector('taylors3d-card'), p = c._devicePopup, popup = p.el, f = window.roomActionsFixture;
  const rect = (node) => {const r=node?.getBoundingClientRect();return r&&{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  return { room:p._selection?.room?.id,sheet:popup?.dataset.roomSheet,height:rect(popup)?.height,heights:p._roomSheet?.heights,
    controls:[...popup?.querySelectorAll('button,input,select')||[]].filter((n) => n.getClientRects().length>0&&getComputedStyle(n).display!=='none')
      .map((n) => ({action:n.dataset.deviceControl||n.dataset.action||n.dataset.roomSheetMode||'handle',...rect(n)})),
    rows:[...popup?.querySelectorAll('.t3d-entity')||[]].map((n) => ({entity:n.dataset.entity,visible:n.getClientRects().length>0})),
    popup:rect(popup),scene:rect(c._scene),canvas:rect(c._view.renderer.domElement),stage:rect(c._stage),
    camera:{position:c._view.camera.position.toArray(),target:c._view.controls.target.toArray(),zoom:c._view.camera.zoom},
    scroll:popup&&{width:popup.scrollWidth,client:popup.clientWidth},doc:document.documentElement.scrollWidth,viewport:innerWidth,
    text:popup?.textContent,summary:popup?.querySelector('.t3d-room-summary')?.textContent,glance:popup?.querySelector('.t3d-room-glance')?.textContent,
    calls:structuredClone(f.calls),writes:f.ws.filter((m) => m.type==='taylors3d/layout/set').length,commits:f.commits,history:c._history.size,
    sameRenderer:c._view.renderer===f.renderer,contexts:window.roomActionsContexts.size,drag:!!p._roomSheet?.drag,
    dragging:popup?.hasAttribute('data-room-sheet-dragging'),cameraMode:c._mode };
});
async function openRoom(page) {
  if (await page.evaluate(() => document.querySelector('taylors3d-card')._devicePopup.isOpen)) await click(page,'.t3d-popup-close');
  overlayBaseline = await snapshot(page);
  const point = await page.evaluate(() => window.roomActionsFixture.roomPixel()); await page.mouse.click(...point); await settle(page);
  const s = await snapshot(page); if (s.room!==roomId) throw new Error('Native tap failed to select authored room '+JSON.stringify(s));
}
async function geometry(page, name) {
  const s = await snapshot(page), tiny = s.controls.filter((r) => r.width<43.9||r.height<43.9);
  check(name+' every reachable target is44px and no horizontal overflow',s.controls.length>4&&tiny.length===0&&s.doc<=s.viewport+1
    &&s.popup.x>=-1&&s.popup.right<=s.viewport+1&&s.scroll.width<=s.scroll.client+1,{tiny,popup:s.popup,scene:s.scene,doc:s.doc,viewport:s.viewport});
  const shape = (reading,node) => {const r=reading[node],p=reading.stage;return[r.x-p.x,r.y-p.y,r.width,r.height];};
  check(name+' room panel overlays the unchanged scene/canvas/stage and camera',
    ['scene','canvas','stage'].every((node) => shape(s,node).every((value,index) => Math.abs(value-shape(overlayBaseline,node)[index])<.1))
    &&s.camera.zoom===overlayBaseline.camera.zoom&&['position','target'].every((key) => s.camera[key].every((value,index) => Math.abs(value-overlayBaseline.camera[key][index])<1e-9)),
    {before:overlayBaseline.scene,after:s.scene,popup:s.popup});
  check(name+' popup remains inside the existing scene with reachable close/size controls',s.popup.y>=s.scene.y-.1&&s.popup.bottom<=s.scene.bottom+.1
    &&s.popup.x>=s.stage.x-.1&&s.popup.right<=s.stage.right+.1,{scene:s.scene,popup:s.popup});
}
async function drag(page, gesture, delta) {
  await target(page,'[data-room-sheet-handle]',async(_node,point) => {
    if (gesture==='touch') await page.touchscreen.touchStart(...point); else {await page.mouse.move(...point);await page.mouse.down();}
    if (gesture==='touch') await page.touchscreen.touchMove(point[0],Math.max(4,point[1]+delta));
    else await page.mouse.move(point[0],Math.max(4,point[1]+delta),{steps:8});
    if (gesture==='touch') await page.touchscreen.touchEnd(); else await page.mouse.up();
  });
}
async function keyboard(page,keyName) {
  await target(page,'[data-room-sheet-handle]',async(node) => {await node.focus();await page.keyboard.press(keyName);});
}
async function screenshot(page,name) {
  fs.mkdirSync(path.join(root,'screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'screenshots',`room-sheet-${mode}-${name}.png`),fullPage:true});
}
async function proof() {
  console.log('Scope: simulated HA readings/commands/storage; actual card, renderer, authored model and native input. No real HA or physical device confirmation claim.');
  const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source','bundle'];
  if (fs.existsSync(path.join(root,'dist/taylors3d-card.js')))
    console.log('Bundle SHA256: '+createHash('sha256').update(fs.readFileSync(path.join(root,'dist/taylors3d-card.js'))).digest('hex'));
  let runtime,fixture,page;
  try { for (mode of modes) {
    fixture = await serveRoomActionsFixture(root,mode); runtime = await launch(); const created = await newPage(runtime.browser,{width:1440,height:1100,isMobile:true,hasTouch:true});
    page = created.page;
    await page.evaluateOnNewDocument(() => {window.roomActionsContexts=new Set();const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){const result=original.call(this,kind,...args);if(result&&/^webgl/.test(kind))window.roomActionsContexts.add(this);return result;};});
    const external = []; page.on('request',(request) => {const url=new URL(request.url());if(/^https?:$/.test(url.protocol)&&url.hostname!=='127.0.0.1')external.push(url.href);});
    await page.goto(fixture.base+'/demo/room-actions-fixture.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(() => window.roomActionsModuleReady);
    await page.evaluate(prepareRoomActionsFixture,{layout:fixture.layout,readings:fixture.readings,entities,key});
    await page.evaluate(() => {const c=document.querySelector('taylors3d-card'),h=c._hass,id='sensor.sheet_temperature_simulated';
      c.hass={...h,states:{...h.states,[id]:{entity_id:id,state:'19.5',attributes:{friendly_name:'Explicit temperature fixture',device_class:'temperature',unit_of_measurement:'°C'}}},
        entities:{...h.entities,[id]:{entity_id:id,area_id:'simulated-upper',hidden:false,disabled_by:null,entity_category:null}}};});
    await settle(page); await openRoom(page); let s = await snapshot(page);
    check('desktop shows all actual room devices and literal saved favourites without invented readings',s.sheet==='desktop'&&s.rows.every((row) => row.visible)
      &&s.text.includes('User_<b>Evening_été')&&s.glance.includes('Explicit temperature fixture: 19.5 °C')&&s.glance.includes('User_Player_été: Playing')
      &&s.calls.length===0&&s.writes===0&&s.commits===0,s.glance);
    await geometry(page,'desktop'); await screenshot(page,'wide');
    await click(page,'.t3d-popup-close');await page.setViewport({width:360,height:1100,isMobile:true,hasTouch:true,deviceScaleFactor:1});await settle(page);await openRoom(page);s=await snapshot(page);
    check('phone opens Controls with only actual light/temperature/media/climate primary rows',s.sheet==='controls'&&s.rows.some((row) => row.entity===entities.media&&row.visible)
      &&s.rows.some((row) => row.entity===entities.cover&&!row.visible)&&s.glance.includes('19.5 °C'),s.rows);
    await geometry(page,'phone Controls');await screenshot(page,'phone-controls');
    for (const [name,selector] of [['favourite scene','[data-room-action="scene-shortcut"]'],['light toggle',`[data-action="toggle"][data-entity="${entities.lamp}"]`],
      ['media play',`[data-device-control="play"][data-entity="${entities.media}"]`]])
      await target(page,selector,async(node) => {const reading=await node.evaluate((node) => {const r=node.getBoundingClientRect(),clip=node.closest('.t3d-popup-content').getBoundingClientRect();
        return{height:Math.min(r.bottom,clip.bottom)-Math.max(r.top,clip.top),width:Math.min(r.right,clip.right)-Math.max(r.left,clip.left),clipHeight:clip.height};});
        check('Controls '+name+' is reachable with a fully visible44px touch target',reading.height>=43.9&&reading.width>=43.9,reading);});
    await click(page,'[data-room-sheet-mode="summary"]');s=await snapshot(page);check('explicit Summary keeps live counts/readings and hides actions',s.sheet==='summary'&&s.rows.every((row) => !row.visible)
      &&s.summary.includes('1 light entity on')&&s.glance.includes('19.5 °C'));
    await geometry(page,'phone Summary');await screenshot(page,'phone-summary');
    await click(page,'[data-room-sheet-mode="details"]');s=await snapshot(page);check('explicit Details exposes every existing row in a taller scrollable sheet',s.sheet==='details'
      &&s.rows.every((row) => row.visible)&&Math.abs(s.height-s.heights.details)<.1&&s.height>=s.heights.controls,s.height);
    await geometry(page,'phone Details');await screenshot(page,'phone-details');
    await page.evaluate(() => window.roomActionsFixture.patch('sensor.sheet_temperature_simulated','18.2'));await settle(page);s=await snapshot(page);
    check('HA update follows actual measured temperature and preserves current sheet size',s.sheet==='details'&&s.glance.includes('18.2 °C')&&!s.glance.includes('19.5 °C'));
    await page.evaluate(() => window.roomActionsFixture.patch('sensor.sheet_temperature_simulated','unavailable'));await settle(page);s=await snapshot(page);
    check('unavailable temperature does not leave a stale or fabricated glance reading',!s.glance.includes('18.2 °C'));
    await page.evaluate(() => window.roomActionsFixture.patch('sensor.sheet_temperature_simulated','19.5'));await settle(page);
    await keyboard(page,'Home');check('native keyboard Home selects Summary',(await snapshot(page)).sheet==='summary');
    await keyboard(page,'ArrowUp');check('native keyboard Up selects Controls',(await snapshot(page)).sheet==='controls');
    await keyboard(page,'End');check('native keyboard End selects Details',(await snapshot(page)).sheet==='details');
    await keyboard(page,'ArrowDown');check('native keyboard Down selects Controls',(await snapshot(page)).sheet==='controls');
    await drag(page,'mouse',-500);check('actual mouse handle drag expands Details once',(await snapshot(page)).sheet==='details');
    await drag(page,'touch',500);check('actual touch handle drag collapses Summary once',(await snapshot(page)).sheet==='summary');
    await click(page,'[data-room-sheet-mode="details"]');
    const volume='[data-device-control="volume"]';await target(page,volume,async(node) => {await node.focus();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.type('27');});
    const before = await snapshot(page);await click(page,'[data-room-sheet-mode="summary"]');s=await snapshot(page);
    check('sheet movement discards unfinished scalar without blur sending a device action',s.calls.length===before.calls.length&&s.writes===before.writes&&s.sheet==='summary');
    for (const kind of ['connection','account','permission']) {
      await openRoom(page);const initial=await snapshot(page);
      await target(page,'[data-room-sheet-handle]',async(_node,point) => {await page.mouse.move(...point);await page.mouse.down();await page.mouse.move(point[0],Math.max(4,point[1]-150),{steps:5});
        await page.evaluate((kind) => window.roomActionsFixture.pulse(kind),kind);await page.mouse.up();});
      s=await snapshot(page);check('held native drag rejects '+kind+' loss/recovery without action',s.calls.length===initial.calls.length&&s.writes===initial.writes&&!s.drag
        &&(!s.room||s.sheet==='controls'),{sheet:s.sheet,room:s.room});
    }
    await openRoom(page);
    await target(page,'[data-room-sheet-handle]',async(_node,point) => {await page.mouse.move(...point);await page.mouse.down();await page.mouse.move(point[0],Math.max(4,point[1]-150),{steps:5});
      await page.evaluate(() => {const c=document.querySelector('taylors3d-card');c._customControlsModelLoad={view:c._view,promise:{}};
        c._devicePopup.observeContexts(c._hass);c._customControlsModelLoad=null;c._devicePopup.observeContexts(c._hass);});await page.mouse.up();});s=await snapshot(page);
    check('actual Root loading context cancels a held sheet gesture through recovery',s.sheet==='controls'&&!s.drag&&!s.dragging
      &&await page.evaluate(() => typeof document.querySelector('taylors3d-card')._devicePopup.getRoomSheetContext==='function'));
    await openRoom(page);await page.evaluate(() => {const c=document.querySelector('taylors3d-card');window.sheetSavedContextHook=c._devicePopup.getRoomSheetContext;
      let value='initial';c._devicePopup.getRoomSheetContext=() => ({contextKey:value,suspended:false});window.sheetPulse=() => {value='model replacement';c._devicePopup.observeContexts(c._hass);value='initial';c._devicePopup.observeContexts(c._hass);};});
    await target(page,'[data-room-sheet-handle]',async(_node,point) => {await page.mouse.move(...point);await page.mouse.down();await page.mouse.move(point[0],Math.max(4,point[1]-150),{steps:5});
      await page.evaluate(() => window.sheetPulse());await page.mouse.up();});s=await snapshot(page);
    check('held native room/model context drag is permanently cancelled',s.sheet==='controls'&&!s.drag&&!s.dragging);
    await page.evaluate(() => {document.querySelector('taylors3d-card')._devicePopup.getRoomSheetContext=window.sheetSavedContextHook;});
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await click(page,'[data-room-sheet-mode="details"]');
    const transition = await page.evaluate(() => getComputedStyle(document.querySelector('taylors3d-card')._devicePopup.el).transitionDuration);
    check('reduced motion disables sheet animation without disabling explicit controls',transition.split(',').every((part) => parseFloat(part)===0),transition);
    await click(page,'.t3d-popup-close');await page.setViewport({width:320,height:1100,isMobile:true,hasTouch:true,deviceScaleFactor:1});await settle(page);await openRoom(page);await geometry(page,'320px phone');
    for (const language of ['en','de','fr','es']) {
      await page.evaluate((language) => window.roomActionsFixture.locale(language),language);await settle(page);
      const reading=await page.evaluate(() => {const p=document.querySelector('taylors3d-card')._devicePopup.el;
        const buttons=[...p.querySelectorAll('[data-room-sheet-mode]')].map((button) => {const r=button.getBoundingClientRect();
          const range=document.createRange();range.selectNodeContents(button);const text=range.getBoundingClientRect(),style=getComputedStyle(button);
          return{label:button.textContent,width:r.width,height:r.height,font:style.fontSize,textWidth:text.width,available:r.width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-2};});
        const foreground=getComputedStyle(p.querySelector('.t3d-room-glance')).color,background=getComputedStyle(p).backgroundColor;
        const channels=(value) => value.match(/[\d.]+/g)?.slice(0,3).map(Number),luminance=(rgb) => rgb.map((v) => {const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;})
          .reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
        const fg=channels(foreground),bg=channels(background),a=fg&&luminance(fg),b=bg&&luminance(bg),contrast=a===undefined||b===undefined?0:(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        return{buttons,foreground,background,contrast};});
      check(language+'320px size labels fit their44px targets without wrapping or clipping',reading.buttons.every((button) => button.width>=43.9&&button.height>=43.9&&button.textWidth<=button.available+.5),reading.buttons);
      check(language+' actual temperature/media glance has readable dark House contrast',reading.contrast>=4.5,reading);
    }
    await page.evaluate(() => window.roomActionsFixture.locale('en'));await settle(page);await screenshot(page,'320px-final');
    s=await snapshot(page);check('all size/drag gestures retain one renderer and leave layout/history/services unchanged',s.sameRenderer&&s.contexts===1&&s.calls.length===0&&s.writes===0&&s.commits===0&&s.history===0,
      {sameRenderer:s.sameRenderer,contexts:s.contexts,calls:s.calls.length,writes:s.writes,commits:s.commits,history:s.history});
    for (const scheme of ['light','dark']) {
      await page.evaluate((scheme) => {
        const c=document.querySelector('taylors3d-card');c._devicePopup.close();
        c.setConfig({...c._config,layout_style:'standard'});
        c.style.setProperty('--primary-text-color',scheme==='dark'?'#f2f5f7':'#212121');
        c.style.setProperty('--card-background-color',scheme==='dark'?'#1d2731':'#fff');
        // The fixture intentionally leaves a light secondary background in a
        // dark card. Selected text must use the card's actual paired surface.
        c.style.setProperty('--secondary-background-color','#f5f5f5');
      },scheme);await settle(page);await openRoom(page);
      const reading=await page.evaluate(() => {
        const c=document.querySelector('taylors3d-card'),button=c._devicePopup.el.querySelector('[data-room-sheet-mode][aria-pressed="true"]'),style=getComputedStyle(button);
        const luminance=(value) => value.match(/[\d.]+/g).slice(0,3).map(Number).map((v) => {const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;})
          .reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
        const foreground=style.color,background=style.backgroundColor,a=luminance(foreground),b=luminance(background);
        return{house:c.hasAttribute('data-taylors3d-theme'),label:button.textContent,foreground,background,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      });
      check('standard '+scheme+' selected room-sheet control retains its actual paired text/card surface',!reading.house&&reading.contrast>=4.5,reading);
    }
    // A focused geometry regression: exact breakpoint widths and one short card,
    // with native room/device opening. This is not the locale/theme matrix.
    for (const style of ['house','standard']) for (const width of [739,740,959,960,320]) {
      await click(page,'.t3d-popup-close');
      // Body padding is16px; House's real card border adds another2px.
      await page.setViewport({width:width+(style==='house'?18:16),height:1100,isMobile:true,hasTouch:true,deviceScaleFactor:1});
      await page.evaluate(({style,width}) => {const c=document.querySelector('taylors3d-card');
        for(const [key,value] of Object.entries({'primary-text-color':'#f2f5f7','secondary-text-color':'#c6d4df','card-background-color':'#1d2731','secondary-background-color':'#253340','divider-color':'#81909c'}))c.style.setProperty('--'+key,value);
        c.setConfig({...c._config,layout_style:style,height:width===320?'340px':'600px'});},{style,width});
      await settle(page);const measured=await snapshot(page);
      check(style+' actual stage reaches exact '+width+'px breakpoint',Math.abs(measured.stage.width-width)<.1,measured.stage);
      await openRoom(page);await geometry(page,style+' '+width+'px room');
      if (width===320) {
        await click(page,'[data-room-sheet-mode="details"]');await geometry(page,style+' short Details');
        const short=await snapshot(page);check(style+' short Details is the actual selected mode and bounded to drawing space',short.sheet==='details'&&short.popup.height<=short.scene.height-15.9,
          {mode:short.sheet,heights:short.heights,popup:short.popup,scene:short.scene});
        await target(page,`[data-action="toggle"][data-entity="${entities.lamp}"]`,async(node) => {
          const visible=await node.evaluate((node) => {const r=node.getBoundingClientRect(),clip=node.closest('.t3d-popup-content').getBoundingClientRect();
            return{width:Math.min(r.right,clip.right)-Math.max(r.left,clip.left),height:Math.min(r.bottom,clip.bottom)-Math.max(r.top,clip.top),clipHeight:clip.height};});
          check(style+' short Details scroll exposes a fully visible44px actual lamp control',visible.width>=43.9&&visible.height>=43.9,visible);
        });
        await screenshot(page,style+'-short-overlay');
      }
      await click(page,'.t3d-popup-close');const closed=await snapshot(page);
      const marker=await page.evaluateHandle((id) => {const c=document.querySelector('taylors3d-card'),m=c._markers.find((m) => m.entities.some((e) => e.eid===id));
        return m&&c._markerEls.get(m.id);},entities.media);
      try {const node=marker.asElement();if(!node)throw new Error('Missing current native media marker');
        const reachable=await node.evaluate((node) => node.tabIndex===0&&node.getClientRects().length>0&&!node.classList.contains('fp-occluded'));
        check(style+' '+width+'px actual device marker is keyboard reachable',reachable);if(!reachable)throw new Error('Device marker is not reachable');
        await node.focus();await page.keyboard.press('Enter');await settle(page);overlayBaseline=closed;const device=await snapshot(page);
        check(style+' '+width+'px native Enter opens exact device controls without a command',device.text?.includes('User_Player_été')&&device.calls.length===closed.calls.length);
        await geometry(page,style+' '+width+'px device');
      }finally{await marker.dispose();}
    }
    check('fixture has no external/private assets, unexpected routes or browser errors',external.length===0&&fixture.unexpected.length===0&&created.errors.length===0,{external,routes:fixture.unexpected,errors:created.errors});
    errors.push(...created.errors);await page.close();page=null;await runtime.close();runtime=null;await fixture.close();fixture=null;
  }} catch (error) {console.error('Room-sheet proof stopped at '+stage+': '+error.stack);results.push(false);}
  finally {if(page)await page.close();if(runtime)await runtime.close();if(fixture)await fixture.close();}
}
if (process.argv.includes('--preflight')) {
  for (const [base,available,expected] of [[900,600,[200,288,552]],[520,200,[184,184,184]],[10000,10000,[200,320,560]]])
    check('bounded current container sheet heights',JSON.stringify(Object.values(roomSheetHeights(base,available)))===JSON.stringify(expected));
} else await proof();
console.log(`${results.filter(Boolean).length}/${results.length} room-sheet checks passed; ${errors.length} browser errors.`);
if (results.some((passed) => !passed)||errors.length) process.exitCode=1;
