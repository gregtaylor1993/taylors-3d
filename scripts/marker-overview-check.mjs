// Native marker overview checks against the generated demonstration house.
// Simulated HA readings only; no live household or device response claim.
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, root } from './lib/demo-browser.mjs';

const mode = process.argv.includes('--bundle') ? 'bundle' : process.env.MARKER_OVERVIEW_MODE || 'source';
if (!['source', 'bundle'].includes(mode)) throw Error('MARKER_OVERVIEW_MODE must be source or bundle');
const checks = [], errors = [], screenshots = [], session = await launch();
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'ok' : 'FAIL'} ${name}${detail === undefined ? '' : ' '+JSON.stringify(detail)}`); };
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<script type="importmap">${JSON.stringify({imports:{three:'/node_modules/three/build/three.module.js','three/addons/':'/node_modules/three/examples/jsm/','@mdi/js':'/node_modules/@mdi/js/mdi.js'}})}</script>
<style>body{margin:0;padding:12px;background:#101012;color:#f5f5f7;font:14px system-ui}main{max-width:1400px;margin:auto}.dark{--card-background-color:#1c1c1e;--primary-text-color:#f5f5f7;--secondary-text-color:#b8b8be;--divider-color:#414146;--primary-color:#f5f5f7;--text-primary-color:#101012}p{color:#b8b8be}#log{font-size:12px}</style></head>
<body><main><p>Simulated example house and devices · marker overview browser test</p><section class="theme dark"><taylors3d-card></taylors3d-card></section><div id="log"></div></main>
<script type="module">await import('/${mode === 'source' ? 'src' : 'dist'}/taylors3d-card.js');await import('/${mode === 'source' ? 'demo/demo' : 'dist/demo'}.js');
const card=document.querySelector('taylors3d-card');card.setConfig({height:innerWidth<600?'640px':'760px',model:'/demo/house.glb',model_opacity:.95,floor:'all',view:'3d',mini_map:false,layout_style:'house',house_colour_scheme:'dark',marker_display:'all'});
window.markerOverviewCalls=[];const call=card._hass.callService;card._hass.callService=(...args)=>{window.markerOverviewCalls.push(args);return call(...args);};
</script></body></html>`;
const settle = async (page) => {
  await page.waitForFunction(() => { const v=document.querySelector('taylors3d-card')?._view; return v&&!v._tween; }, {timeout:15000});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
const select = async (page, value) => { const input = await page.evaluateHandle(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('.marker-display')); await input.asElement().select(value); await input.dispose(); await settle(page); };
const snapshot = (page) => page.evaluate(() => {
  const c=document.querySelector('taylors3d-card'),v=c._view,rect=c._scene.getBoundingClientRect();
  const chips=[...v._roomOverviewObjects.values()].filter(x=>x.obj.visible&&x.obj.element.getBoundingClientRect().width&&getComputedStyle(x.obj.element).visibility!=='hidden').map(x=>({id:x.row.roomId,name:x.row.name,rect:x.obj.element.getBoundingClientRect().toJSON()}));
  const chooser=v._roomOverviewChooser, chooserVisible=!!chooser&&!chooser.el.hidden;
  let overlaps=0;for(let i=0;i<chips.length;i++)for(let j=i+1;j<chips.length;j++){const a=chips[i].rect,b=chips[j].rect;if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)overlaps++;}
  return { markers:[...v.markerObjects].filter(([,x])=>x.obj.visible).map(([id])=>id),chips,overlaps,selected:c._selectedRoomId,
    chooser:chooserVisible,roomCount:chooserVisible?chooser.rows.size:chips.length,
    camera:[...v.camera.position.toArray(),...v.controls.target.toArray()],rect:rect.toJSON(),calls:window.markerOverviewCalls.length,
    mode:v._markerDisplay?.mode,rooms:c._navigationRooms().map(x=>x.room.id),allMarkerIds:[...v.markerObjects.keys()] };
});
try {
  for (const width of [1400,390]) {
    const opened = await newPage(session.browser,{width,height:1000}), page=opened.page;
    try {
      await page.setRequestInterception(true); page.on('request',request=>new URL(request.url()).pathname==='/marker-overview-native.html'
        ? request.respond({status:200,contentType:'text/html',body:html}) : request.continue());
      await page.goto(session.base+'/marker-overview-native.html',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>{const c=document.querySelector('taylors3d-card');return c?._view?.model&&!c._loading&&c._view.markerObjects.size>0;},{timeout:30000});
      const exterior=await page.evaluateHandle(()=>document.querySelector('taylors3d-card').shadowRoot.querySelector('button.chip[data-view="exterior"]'));
      await exterior.asElement().click(); await exterior.dispose(); await settle(page);
      const all=await snapshot(page);check(`${width}: original markers visible`,all.markers.length>20,all.markers.length);
      await select(page,'rooms');const rooms=await snapshot(page);
      check(`${width}: room summaries replace ordinary devices`,rooms.roomCount>0&&rooms.markers.length<all.markers.length,{devices:rooms.markers.length,rooms:rooms.roomCount,chooser:rooms.chooser,overlaps:rooms.overlaps});
      check(`${width}: visible room summaries never overlap`,rooms.overlaps===0);
      check(`${width}: room mode keeps scene dimensions`,rooms.rect.width===all.rect.width&&rooms.rect.height===all.rect.height);
      check(`${width}: room mode keeps camera`,rooms.camera.every((x,i)=>Math.abs(x-all.camera[i])<1e-8));
      check(`${width}: every chip has current exact room`,rooms.chips.every(x=>rooms.rooms.includes(x.id)));
      fs.mkdirSync(path.join(root,'screenshots'),{recursive:true});const filename=`marker-overview-${mode}-${width}.png`;
      await page.screenshot({path:path.join(root,'screenshots',filename),fullPage:true});screenshots.push(filename);
      if(rooms.chooser){
        const toggle=await page.evaluateHandle(()=>document.querySelector('taylors3d-card')._view._roomOverviewChooser.toggle);
        await toggle.asElement().click();
        const chooserShot=`marker-overview-${mode}-${width}-chooser.png`;
        await page.screenshot({path:path.join(root,'screenshots',chooserShot),fullPage:true});screenshots.push(chooserShot);
        check(`${width}: grouped chooser keeps every current room accessible`,await page.evaluate(()=>{
          const c=document.querySelector('taylors3d-card'),chooser=c._view._roomOverviewChooser;
          return chooser.open&&chooser.rows.size===c._view._markerDisplay.rooms.length&&[...chooser.rows.values()].every(row=>row.button.getBoundingClientRect().height>=44);
        }));
        await page.keyboard.press('Escape');
        check(`${width}: Escape returns focus to room disclosure`,await page.evaluate(()=>{
          const c=document.querySelector('taylors3d-card'),chooser=c._view._roomOverviewChooser;
          return !chooser.open&&c.shadowRoot.activeElement===chooser.toggle;
        }));
        await toggle.asElement().click();await toggle.dispose();
      }
      const target=await page.evaluateHandle(()=>{const c=document.querySelector('taylors3d-card');return c._view._roomOverviewChooser?.open?c._view._roomOverviewChooser.rows.values().next().value.button:[...c._view._roomOverviewObjects.values()].find(x=>x.obj.visible)?.obj.element;});
      await target.asElement().focus();await page.keyboard.press('Enter');await target.dispose();await settle(page);
      const selected=await snapshot(page);check(`${width}: native keyboard room selection opens current room`,!!selected.selected&&selected.rooms.includes(selected.selected),selected.selected);
      check(`${width}: room selection keeps scene dimensions`,selected.rect.width===rooms.rect.width&&selected.rect.height===rooms.rect.height);
      await page.keyboard.press('Escape');await select(page,'important');const important=await snapshot(page);
      check(`${width}: important filters markers without room chips`,important.mode==='important'&&important.chips.length===0&&important.markers.length<all.markers.length,important.markers.length);
      await select(page,'all');const restored=await snapshot(page);
      check(`${width}: all restores exact original device markers`,JSON.stringify(restored.markers)===JSON.stringify(all.markers));
      check(`${width}: display choices issue zero device services`,restored.calls===0,restored.calls);
      errors.push(...opened.errors.map(error=>({width,error})));
    } finally { await page.close(); }
  }
  check('no browser errors',errors.length===0,errors);
} finally {
  await session.close();fs.mkdirSync(path.join(root,'screenshots'),{recursive:true});
  fs.writeFileSync(path.join(root,`screenshots/marker-overview-${mode}-proof.json`),JSON.stringify({mode,checks,errors,screenshots},null,2));
}
if(checks.some(check=>!check.pass)||errors.length)process.exitCode=1;
