// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FloorplanView } from '../src/view.js';
import { floorPanelParticipants } from '../src/floor-panel-membership.js';

const make = () => {
  const view = Object.assign(Object.create(FloorplanView.prototype), { floors: [{id:'ground',elevation:0},{id:'upper',elevation:3}],
    markerGroup:new THREE.Group(), staticGroup:new THREE.Group(), overlayGroup:new THREE.Group(),
    markerObjects:new Map(), glows:new Map(), stems:new Map(), cssObjects:[], visibleFloor:'all', mode:'3d',
    _cutAway:vi.fn(() => false), _scheduleOcclusion:vi.fn(), _modelSig:() => 'same', _shownMarkersSig:() => 'same', dirty:false });
  return view;
};
const snapshot = (overrides = {}) => ({ mode:'rooms',editing:false,selectedRoomId:null,
  markers:new Map([['lamp',{keep:false}]]),rooms:[{roomId:'lounge',floorId:'ground',x:2,y:3,name:'Lounge',summary:'1 light entities on',detail:'Actual state',selected:false}], ...overrides });
const c = (kind, id, floorId = 'ground') => ({ kind,id,floorId,obj:{position:new THREE.Vector3(),element:document.createElement('div')} });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('overview narrows the existing visibility gate', () => {
  it('leaves all original marker visibility unchanged until explicitly enabled', () => {
    const view = make(), marker = c('marker','lamp'); expect(view._markerVisible(marker)).toBe(true);
    view._markerStates = new Map([['lamp',{shown:false}]]); expect(view._markerVisible(marker)).toBe(false);
  });
  it('keeps the original mode idle when unrelated unplaced markers appear', () => {
    const view = make();expect(view.setMarkerDisplay(snapshot({mode:'all',rooms:[]}))).toBe(false);expect(view.dirty).toBe(false);
    expect(view.setMarkerDisplay(snapshot({mode:'all',rooms:[],markers:new Map([['unplaced',{keep:true}]])}))).toBe(false);
    expect(view.dirty).toBe(false);expect(view._scheduleOcclusion).not.toHaveBeenCalled();
  });
  it('does not reveal a marker hidden by the current named view, floor or section', () => {
    const view = make(); view.setMarkerDisplay(snapshot({markers:new Map([['lamp',{keep:true}]])}));
    view._markerStates = new Map([['lamp',{shown:false}]]); expect(view._markerVisible(c('marker','lamp'))).toBe(false);
    view._markerStates = null; view.visibleFloor = 'upper'; expect(view._markerVisible(c('marker','lamp'))).toBe(false);
    view.visibleFloor = 'all'; view._cutAway.mockReturnValue(true); expect(view._markerVisible(c('marker','lamp'))).toBe(false);
  });
  it('preserves edit handles, active lighting glows and unknown external marker IDs', () => {
    const view = make(); view.setMarkerDisplay(snapshot());
    expect(view._markerVisible(c('marker','lamp'))).toBe(false); expect(view._markerVisible(c('marker','external'))).toBe(true);
    expect(view._markerVisible(c('handle','drag'))).toBe(true);
    expect(view._glowVisible('lamp',{floorId:'ground',mesh:{position:new THREE.Vector3()}})).toBe(true);
  });
  it('hides duplicate room labels only while the matching overview chip is active', () => {
    const view = make(), label = {...c('label',''),roomId:'lounge'}; view.setMarkerDisplay(snapshot());
    expect(view._markerVisible(label)).toBe(false); expect(view._markerVisible({...label,roomId:'other'})).toBe(true);
    view.setMarkerDisplay(snapshot({mode:'all',rooms:[]})); expect(view._markerVisible(label)).toBe(true);
  });
  it('editing reveals the original markers while respecting existing view rules', () => {
    const view = make(); view.setMarkerDisplay(snapshot({editing:true,rooms:[]}));
    expect(view._markerVisible(c('marker','lamp'))).toBe(true);
    view._markerStates = new Map([['lamp',{shown:false}]]); expect(view._markerVisible(c('marker','lamp'))).toBe(false);
  });
});

describe('room summary lifetime and exact source/display positioning', () => {
  it('keeps unchanged elements and the idle renderer stable across repeated HA updates', () => {
    const view = make(); expect(view.setMarkerDisplay(snapshot())).toBe(true);
    const element = view._roomOverviewObjects.get('lounge').obj.element; document.body.append(element); element.focus(); view.dirty = false;
    expect(view.setMarkerDisplay(snapshot())).toBe(false); expect(view.dirty).toBe(false);
    expect(view._roomOverviewObjects.get('lounge').obj.element).toBe(element); expect(document.activeElement).toBe(element);
    expect(element.getAttribute('aria-label')).toBe('Lounge: 1 light entities on'); expect(element.type).toBe('button');
  });
  it('updates readings in place and never injects room source text as HTML', () => {
    const view = make(); view.setMarkerDisplay(snapshot()); const entry = view._roomOverviewObjects.get('lounge');
    const data = snapshot(); data.rooms[0].name = '<img src=x>'; data.rooms[0].summary = '0 light entities on'; data.rooms[0].selected = true;
    view.setMarkerDisplay(data); expect(view._roomOverviewObjects.get('lounge')).toBe(entry);
    expect(entry.obj.element.querySelector('img')).toBeNull(); expect(entry.name.textContent).toBe('<img src=x>');
    expect(entry.obj.element.getAttribute('aria-pressed')).toBe('true');
  });
  it('uses plan source position plus exact floor display transform without moving marker coordinates', () => {
    const view = make(); view._floorCompiled = { valid:true,mode:'horizontal' };
    view._displayWorld = (source,floorId) => source.clone().add(floorId === 'ground' ? new THREE.Vector3(10,4,-8) : new THREE.Vector3());
    view.setMarkerDisplay(snapshot()); const entry = view._roomOverviewObjects.get('lounge');
    expect(entry.obj.userData.floorSourcePosition.toArray()).toEqual([2,0.16,-3]);
    expect(entry.obj.position.toArray()).toEqual([12,4.16,-11]);
    expect(entry.floorId).toBe('ground'); expect(view.cssObjects[0].floorId).toBe('ground');
    expect(floorPanelParticipants(view).get(entry.obj)).toBe('ground');
    view._displayWorld = (source) => source.clone(); view._refreshFloorParticipants();
    expect(entry.obj.position.toArray()).toEqual([2,0.16,-3]);
  });
  it('refreshes chip elevation when a floor is deliberately relinked at a new height', () => {
    const view = make(); view.setMarkerDisplay(snapshot()); view.floors[0].elevation = 7;
    expect(view.setMarkerDisplay(snapshot())).toBe(true);
    expect(view._roomOverviewObjects.get('lounge').obj.position.y).toBe(7.16);
  });
  it('uses a native room callback only for the current connected chip, never a stale old one', () => {
    const view = make(); view.onRoomOverview = vi.fn(); view.setMarkerDisplay(snapshot());
    const entry = view._roomOverviewObjects.get('lounge'), element = entry.obj.element; document.body.append(element);
    element.click(); expect(view.onRoomOverview).toHaveBeenCalledWith('lounge',[0,0]);
    view.onRoomOverview.mockClear(); view.setMarkerDisplay(snapshot({mode:'all',rooms:[]}));
    expect(element.isConnected).toBe(false); document.body.append(element); element.click(); expect(view.onRoomOverview).not.toHaveBeenCalled();
    expect(view.cssObjects.some((row) => row.kind === 'room-overview')).toBe(false);
  });
  it('drops room chips when their current room is removed', () => {
    const view = make(); view.setMarkerDisplay(snapshot()); const element = view._roomOverviewObjects.get('lounge').obj.element;
    document.body.append(element); view.setMarkerDisplay(snapshot({rooms:[]}));
    expect(view._roomOverviewObjects.size).toBe(0); expect(view.markerGroup.children).toHaveLength(0); expect(element.isConnected).toBe(false);
  });
});
