// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeatherEditor } from '../src/weather-editor.js';
import { HouseSummaryEditor } from '../src/house-summary-editor.js';
import messages from '../src/translations/editor-environment-house.js';

const fixtures=[];
const weather={enabled:true,entity:'weather.user_exact',effects:['rain','clouds','snow'],intensity:.6,quality:'low',extra:{raw:'User_extra_été'}};
const summary={title:'User_<b>Title_été',weather_entity:'weather.user_exact',person_entities:['person.user_exact'],extra:{raw:'User_extra_été'}};
function fixture(kind,language='en',settings){
  const card={isConnected:true,_editing:true,_edit:{tab:'settings'},_config:{layout_key:'User_layout_ID'},
    _layout:kind==='weather'?{weather:structuredClone(settings||weather)}:{house_summary:structuredClone(settings||summary)},
    _floors:[],_roomList:[],_hass:{locale:{language},user:{id:'User_account',is_admin:true,is_active:true},connection:{connected:true},auth:{},
      entities:{},devices:{},areas:{User_Area_ID:{name:'User_area_été'}},config:{latitude:0,longitude:0,time_zone:'UTC'},
      states:{'weather.user_exact':{state:'rainy',attributes:{friendly_name:'User_<b>Weather_été',cloud_coverage:50}},
        'person.user_exact':{state:'home',attributes:{friendly_name:'User_person_été'}},'sun.sun':{state:'above_horizon',attributes:{elevation:20,azimuth:90}}},
      callService:vi.fn(),callWS:vi.fn()},commitFeatureLayout:vi.fn()};
  const host=document.createElement('div');document.body.append(host);const Type=kind==='weather'?WeatherEditor:HouseSummaryEditor;
  const render=()=>{host.innerHTML=editor.render();editor.updatePreviews(host);};const editor=new Type(card,render);render();
  host.addEventListener('input',event=>editor.onInput(event.target.dataset.field,event.target));
  host.addEventListener('change',event=>editor.onChange(event.target.dataset.field,event.target));
  host.addEventListener('click',event=>{const node=event.target.closest('[data-act]');if(node&&!node.disabled)editor.onClick(node.dataset.act,node);});
  const prefix=kind==='weather'?'env-weather-':'house-summary-',field=name=>host.querySelector(`[data-field="${prefix}${name}"]`),button=name=>host.querySelector(`[data-act="${prefix}${name}"]`);
  const locale=value=>{card._hass.locale.language=value;editor.updatePreviews(host);};fixtures.push({editor,host});return{card,host,editor,field,button,locale,render};
}
afterEach(()=>{for(const{editor,host}of fixtures.splice(0)){editor.dispose();host.remove();}vi.restoreAllMocks();});
const input=(node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));};
const pointer=(node,type)=>node.dispatchEvent(new Event(type,{bubbles:true}));

describe('native Weather and House summary editor locale updates',()=>{
  it('ships complete four-language owned captions/help/diagnostics with matching primitive placeholders and readable English fallback',()=>{
    const keys=Object.keys(messages.en),parameters=value=>[...value.matchAll(/\{([A-Za-z_]+)\}/g)].map(match=>match[1]).sort();
    expect(keys.length).toBeGreaterThan(120);
    for(const language of ['de','fr','es']){expect(Object.keys(messages[language])).toEqual(keys);for(const key of keys){expect(messages[language][key].trim()).not.toBe('');expect(parameters(messages[language][key])).toEqual(parameters(messages.en[key]));}}
    const w=fixture('weather','ja'),h=fixture('house','not a locale');expect(w.host.querySelector('h3').textContent).toBe('Weather and sun');expect(h.host.querySelector('h3').textContent).toBe('House summary');
    expect(w.host.textContent).toContain('not a measured rain or snow rate');expect(h.host.textContent).toContain('Motion sensors do not name a person');
  });
  it.each([['de','Wetter und Sonne','Hausübersicht','Niedrig — Wandpanel'],['fr','Météo et soleil','Résumé de la maison','Faible — panneau mural'],
    ['es','Tiempo y sol','Resumen de la casa','Baja — panel de pared']])('renders %s owned captions/help while retaining literal settings, HA names and enum option values',(language,weatherTitle,houseTitle,quality)=>{
    const w=fixture('weather',language),h=fixture('house',language);
    expect(w.host.querySelector('h3').textContent).toBe(weatherTitle);expect(h.host.querySelector('h3').textContent).toBe(houseTitle);
    expect(w.field('quality').selectedOptions[0].textContent).toBe(quality);expect(w.field('quality').value).toBe('low');
    expect(w.field('entity').selectedOptions[0].textContent).toBe('User_<b>Weather_été');expect(h.field('title').value).toBe(summary.title);
    expect(w.host.querySelector('b')).toBeNull();expect(h.host.querySelector('b')).toBeNull();
    expect(w.editor.draft).toEqual(weather);expect(h.editor.draft).toEqual(summary);
    for(const ctx of [w,h]){expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();expect(ctx.card._hass.callService).not.toHaveBeenCalled();expect(ctx.card._hass.callWS).not.toHaveBeenCalled();}
  });
  it('changes weather captions, quality and selected-source options in place while retaining focused decimal draft, raw source and area filter',()=>{
    const{card,editor,host,field,locale}=fixture('weather'),number=field('intensity'),select=field('quality'),option=select.selectedOptions[0],source=field('entity'),sourceOption=source.selectedOptions[0],area=field('area-filter'),saved=structuredClone(card._layout);
    number.focus();input(number,'0.37');const draft=structuredClone(editor.draft);locale('de');
    expect(field('intensity')).toBe(number);expect(document.activeElement).toBe(number);expect(number.value).toBe('0.37');expect(editor.draft).toEqual(draft);
    expect(field('quality')).toBe(select);expect(select.selectedOptions[0]).toBe(option);expect(option.textContent).toBe('Niedrig — Wandpanel');
    expect(field('entity')).toBe(source);expect(source.selectedOptions[0]).toBe(sourceOption);expect(field('area-filter')).toBe(area);
    expect(host.querySelector('h3').textContent).toBe('Wetter und Sonne');expect(card._layout).toEqual(saved);expect(card.commitFeatureLayout).not.toHaveBeenCalled();expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps title/selection focus, person action tokens and native epochs through locale-only updates; a deliberate held Save still commits once',()=>{
    const{card,editor,host,field,button,locale}=fixture('house'),title=field('title');title.focus();input(title,'User_unfinished_été');
    const epoch=editor._epoch,person=field('person'),token=person.dataset.houseSummaryToken,source=field('weather_entity'),option=source.selectedOptions[0],save=button('save');
    pointer(save,'pointerdown');locale('fr');expect(field('title')).toBe(title);expect(document.activeElement).toBe(title);expect(title.value).toBe('User_unfinished_été');
    expect(field('person')).toBe(person);expect(person.dataset.houseSummaryToken).toBe(token);expect(editor._epoch).toBe(epoch);expect(source.selectedOptions[0]).toBe(option);
    expect(host.querySelector('h3').textContent).toBe('Résumé de la maison');expect(save.textContent).toBe('Enregistrer le résumé de la maison');
    pointer(save,'pointerup');save.click();expect(card.commitFeatureLayout).toHaveBeenCalledExactlyOnceWith({house_summary:{...summary,title:'User_unfinished_été'}},'House summary');expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('localizes known weather draft/parser/current-source warnings and keeps malformed saved values literal',()=>{
    const ctx=fixture('weather','es',{...weather,quality:'User_quality_été',intensity:'0.6'}),before=structuredClone(ctx.card._layout);
    expect(ctx.field('quality').selectedOptions[0].textContent).toBe('Calidad guardada no compatible: User_quality_été');
    expect(ctx.host.textContent).toContain('Elija calidad Desactivada, Estática, Baja o Media, una intensidad de 0 a 1 y efectos de lluvia/nubes/nieve.');
    expect(ctx.editor.draft.intensity).toBe('0.6');expect(ctx.card._layout).toEqual(before);
    ctx.card._hass.states['weather.user_exact'].attributes.restored=true;ctx.editor.updatePreviews(ctx.host);
    const current=fixture('weather','fr');current.card._hass.states['weather.user_exact'].attributes.restored=true;current.editor.updatePreviews(current.host);
    expect(current.host.textContent).toContain('Il s’agit d’un instantané restauré. Attendez une valeur actuelle.');expect(current.card._hass.callService).not.toHaveBeenCalled();
  });
  it('refreshes already visible weather errors in the new language and preserves the exact unknown diagnostic fallback without invoking accessors',()=>{
    const{editor,host,field,button,locale,card}=fixture('weather');input(field('intensity'),'');button('save').click();
    expect(host.textContent).toContain('nothing has been saved');locale('fr');expect(host.textContent).toContain('rien n’a été enregistré');
    const getter=vi.fn(()=>{throw Error('must stay unread');}),diagnostic={};Object.defineProperty(diagnostic,'message',{get:getter});
    expect(editor._diagnostic(diagnostic)).toBe('');expect(editor._diagnostic({code:'future',message:'User_future_detail_été: 12 raw_units'})).toBe('User_future_detail_été: 12 raw_units');
    expect(getter).not.toHaveBeenCalled();expect(card.commitFeatureLayout).not.toHaveBeenCalled();expect(card._hass.callService).not.toHaveBeenCalled();
    const house=fixture('house');expect(house.editor._diagnostic(diagnostic)).toBe('');expect(house.editor._diagnostic({message:'Unknown future house diagnostic'})).toBe('Unknown future house diagnostic');
  });
  it('keeps an unknown external status message literal and escaped through language updates without applying the draft',()=>{
    for(const kind of ['weather','house']){
      const{card,editor,host,locale}=fixture(kind),saved=structuredClone(card._layout);
      editor.message='User_future_<i>message_été: 12 raw_units';editor.updatePreviews(host);locale('de');locale('fr');locale('es');
      expect(host.querySelector('[role="status"]').textContent).toBe(editor.message);expect(host.querySelector('i')).toBeNull();
      expect(card._layout).toEqual(saved);expect(editor.dirty).toBe(false);expect(card.commitFeatureLayout).not.toHaveBeenCalled();
      expect(card._hass.callService).not.toHaveBeenCalled();expect(card._hass.callWS).not.toHaveBeenCalled();
    }
  });
  it('translates a deliberate Weather relink instruction while retaining the missing source and its editable replacement selector',()=>{
    const{card,editor,host,field,button,locale}=fixture('weather','en',{...weather,entity:'weather.user_saved_missing'}),saved=structuredClone(card._layout);
    button('relink').click();const source=field('entity'),option=source.selectedOptions[0];source.focus();locale('fr');
    expect(host.textContent).toContain('Choisissez délibérément la source de remplacement. La source enregistrée n’a pas été modifiée.');
    expect(field('entity')).toBe(source);expect(source.selectedOptions[0]).toBe(option);expect(document.activeElement).toBe(source);
    expect(source.value).toBe('weather.user_saved_missing');expect(source.disabled).toBe(false);expect(editor.relinking).toBe(true);
    expect(card._layout).toEqual(saved);expect(editor.draft.entity).toBe('weather.user_saved_missing');expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled();expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('keeps focused source/selected options and raw enum state through current reading/name and language changes',()=>{
    for(const[kind,name]of[['weather','entity'],['house','weather_entity']]){
      const{card,editor,host,field,locale}=fixture(kind),source=field(name),option=source.selectedOptions[0];source.focus();
      card._hass.states['weather.user_exact'].state='snowy';card._hass.states['weather.user_exact'].attributes.friendly_name='User_changed_<i>Name_été';locale('es');
      expect(field(name)).toBe(source);expect(document.activeElement).toBe(source);expect(source.selectedOptions[0]).toBe(option);expect(option.textContent).toBe('User_changed_<i>Name_été');
      expect(source.value).toBe('weather.user_exact');expect(card._hass.states['weather.user_exact'].state).toBe('snowy');expect(host.querySelector('i')).toBeNull();
      if(kind==='weather')expect(host.textContent).toContain('Nevado · 50% de cobertura nubosa');
      expect(editor.dirty).toBe(false);expect(card.commitFeatureLayout).not.toHaveBeenCalled();expect(card._hass.callService).not.toHaveBeenCalled();
    }
  });
  it('translates current Weather permission/context warnings while keeping its unsaved draft and refusing Save',()=>{
    const{card,editor,host,field,button,locale}=fixture('weather');input(field('intensity'),'0.37');card._hass.user.is_admin=false;locale('de');
    expect(host.textContent).toContain('Nur ein Administrator kann Layouteinstellungen speichern.');expect(button('save').disabled).toBe(true);button('save').click();expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    card._hass.user.is_admin=true;card._layout.weather={...weather,intensity:.8};locale('fr');
    expect(host.textContent).toContain('Les paramètres météo enregistrés ont changé pendant la modification. Vos valeurs inachevées sont conservées.');
    expect(editor.draft.intensity).toBe('0.37');expect(button('save').disabled).toBe(true);expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('localizes malformed House summary diagnostics and source warnings without repairing imports or translating raw references',()=>{
    const ctx=fixture('house','de',{...summary,title:22,person_entities:['person.user_exact','person.user_exact']}),before=structuredClone(ctx.card._layout);
    expect(ctx.host.textContent).toContain('Importierter Titel muss ausdrücklich korrigiert werden: 22.');expect(ctx.host.textContent).toContain('Jede Person darf nur einmal vorkommen.');
    ctx.card._hass.states['person.user_exact'].attributes.restored='false';ctx.editor.updatePreviews(ctx.host);
    expect(ctx.host.textContent).toContain('Warten auf einen aktuellen Messwert; eine Kennzeichnung für gespeichert/wiederhergestellt ist vorhanden.');
    expect(ctx.card._layout).toEqual(before);expect(ctx.editor.draft.title).toBe(22);expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['connection','account','permission'])('retains the translated draft but rejects a held House Save across current %s loss and recovery',kind=>{
    const{card,editor,host,field,button,locale}=fixture('house'),title=field('title');input(title,'User_draft_été');const save=button('save');pointer(save,'pointerdown');
    if(kind==='connection')card._hass.connection.connected=false;if(kind==='account')card._hass.user.id='User_other';if(kind==='permission')card._hass.user.is_admin=false;
    locale('es');if(kind==='connection')card._hass.connection.connected=true;if(kind==='account')card._hass.user.id='User_account';if(kind==='permission')card._hass.user.is_admin=true;
    editor.updatePreviews(host);pointer(save,'pointerup');save.click();expect(card.commitFeatureLayout).not.toHaveBeenCalled();expect(editor.draft.title).toBe('User_draft_été');expect(editor.stale).toBe(true);
    expect(host.textContent).toContain('Han cambiado los ajustes guardados, el modelo, el diseño, la alineación o la sesión. Su borrador se conserva. Cancele antes de guardar.');expect(card._hass.callService).not.toHaveBeenCalled();
  });
});
