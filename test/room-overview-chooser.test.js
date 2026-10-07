// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomOverviewChooser, overviewLabelsOverlap } from '../src/room-overview-chooser.js';
const rows = [{roomId:'one',name:'Lounge',summary:'Lights on: 1',detail:'Current light entities'}, {roomId:'two',name:'Kitchen',summary:'Open room'}];
const fixture = () => { const host = document.createElement('div'); document.body.append(host); const onSelect = vi.fn(), onInvalidate = vi.fn();
  const chooser = new RoomOverviewChooser(host,{onSelect,onInvalidate});chooser.update(rows,{label:'Rooms',title:'Choose a room',height:240,width:320},true); return {host,chooser,onSelect,onInvalidate}; };
afterEach(() => { document.body.innerHTML=''; });
describe('readable room disclosure when labels overlap', () => {
  it('detects overlapping labels without changing physical source coordinates', () => {
    expect(overviewLabelsOverlap([[0,0],[40,20]])).toBe(true);expect(overviewLabelsOverlap([[0,0],[170,0]])).toBe(false);
    expect(overviewLabelsOverlap([[0,0],[0,70]])).toBe(false);expect(overviewLabelsOverlap([])).toBe(false);
  });
  it('keeps every current room reachable through native keyboard buttons', () => {
    const {chooser,onSelect}=fixture();expect(chooser.toggle.textContent).toBe('Rooms · 2');expect(chooser.list.hidden).toBe(true);
    chooser.toggle.click();expect(document.activeElement).toBe(chooser.rows.get('one').button);
    expect(chooser.toggle.getAttribute('aria-expanded')).toBe('true');chooser.rows.get('two').button.click();
    expect(onSelect).toHaveBeenCalledWith('two',[0,0]);expect(chooser.open).toBe(false);
  });
  it('Escape closes only this list and returns focus to its disclosure', () => {
    const {chooser}=fixture();chooser.toggle.click();chooser.rows.get('one').button.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    expect(chooser.open).toBe(false);expect(document.activeElement).toBe(chooser.toggle);
  });
  it('the first outside pointer dismisses rather than activating the scene', () => {
    const {chooser,host}=fixture(), canvas=document.createElement('canvas'), action=vi.fn();host.append(canvas);canvas.addEventListener('pointerdown',action);
    chooser.toggle.click();canvas.dispatchEvent(new Event('pointerdown',{bubbles:true,cancelable:true,composed:true}));
    expect(chooser.open).toBe(false);expect(action).not.toHaveBeenCalled();
    canvas.dispatchEvent(new Event('pointerdown',{bubbles:true,cancelable:true,composed:true}));expect(action).toHaveBeenCalledTimes(1);
  });
  it('keeps list buttons stable for actual reading updates and never injects names', () => {
    const {chooser}=fixture();chooser.toggle.click();const button=chooser.rows.get('one').button;
    chooser.update([{...rows[0],name:'<img src=x>',summary:'Lights on: 0'},rows[1]],{},true);
    expect(chooser.rows.get('one').button).toBe(button);expect(document.activeElement).toBe(button);expect(button.querySelector('img')).toBeNull();
  });
  it('removed rooms and old retained buttons cannot select a new context', () => {
    const {chooser,onSelect}=fixture();chooser.toggle.click();const old=chooser.rows.get('one').button;
    chooser.update([rows[1]],{},true);document.body.append(old);old.click();expect(onSelect).not.toHaveBeenCalled();
    expect(chooser.rows.has('one')).toBe(false);chooser.update([],{},false);expect(chooser.el.hidden).toBe(true);expect(chooser.open).toBe(false);
  });
  it('fits the actual narrow scene and removes its outside listener on disposal', () => {
    const {chooser,host}=fixture(), action=vi.fn();expect(chooser.list.style.maxHeight).toBe('160px');expect(chooser.list.style.maxWidth).toBe('300px');
    chooser.toggle.click();chooser.dispose();host.addEventListener('pointerdown',action);host.dispatchEvent(new Event('pointerdown',{bubbles:true}));
    expect(action).toHaveBeenCalledOnce();expect(chooser.el.isConnected).toBe(false);
  });
});
