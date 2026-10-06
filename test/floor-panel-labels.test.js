// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { FloorPanelLabels } from '../src/floor-panel-labels.js';

const fixtures = [];
const projectedPixels = (element) => [...element.style.transform.matchAll(/translate\(([-\d.e+]+)px,([-\d.e+]+)px\)/g)]
  .map((match) => [Number(match[1]), Number(match[2])]).at(-1);
function setup(count = 2) {
  const renderer = new CSS2DRenderer(); renderer.setSize(640, 480); document.body.append(renderer.domElement);
  const scene = new THREE.Scene(), onSelect = vi.fn(), helper = new FloorPanelLabels(renderer, { onSelect });
  const groups = [], objects = [], entries = [];
  for (let index = 0; index < count; index++) {
    const group = new THREE.Group(), element = document.createElement('button'); element.textContent = `Device ${index}`;
    const object = new CSS2DObject(element); object.position.set(index, 0, 0); group.add(object); scene.add(group);
    const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 100); camera.position.set(0, 10, 0);
    camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    groups.push(group); objects.push(object);
    entries.push({ floorId: `floor-${index}`, name: `Floor ${index}`, rect: { x: index * 160, y: 20, width: 160, height: 180 }, camera });
  }
  const draw = (selected = entries) => {
    helper.begin(selected);
    for (const entry of selected) {
      const index = entries.findIndex((row) => row.floorId === entry.floorId);
      const baseline = groups.map((group) => group.visible);
      groups.forEach((group, other) => { group.visible = baseline[other] && other === index; });
      try { helper.render(scene, entry); }
      finally { groups.forEach((group, other) => { group.visible = baseline[other]; }); }
    }
    helper.finish({ w: 640, h: 480 });
  };
  const result = { renderer, scene, onSelect, helper, groups, objects, entries, draw };
  fixtures.push(result); return result;
}
afterEach(() => { for (const fixture of fixtures.splice(0)) { fixture.helper.clear(); fixture.renderer.domElement.remove(); } });

describe('one real CSS2D renderer across simultaneous floor panes', () => {
  it.each([2, 4])('retains every floor label after %i native renderer passes', (count) => {
    const f = setup(count); f.draw();
    for (let index = 0; index < count; index++) {
      const element = f.objects[index].element, pane = f.helper.panes.get(f.entries[index].floorId);
      expect(element.parentNode).toBe(pane.clip); expect(element.style.display).toBe('');
      const projected = projectedPixels(element); expect(projected[0]).toBeCloseTo(80 + index * 16); expect(projected[1]).toBeCloseTo(90);
      expect(element.style.zIndex).not.toBe(''); expect(pane.clip.style.left).toBe(`${index * 160}px`);
    }
    expect(f.renderer.getSize()).toEqual({ width: 640, height: 480 });
    expect(f.renderer.domElement.style.width).toBe('640px');
  });

  it('uses the same label and header elements with their actual listeners on repeated frames', () => {
    const f = setup(), label = f.objects[0].element, click = vi.fn(); label.addEventListener('click', click);
    f.draw(); const header = f.helper.panes.get('floor-0').button;
    f.draw(); f.draw();
    expect(f.objects[0].element).toBe(label); expect(f.helper.panes.get('floor-0').button).toBe(header);
    label.click(); header.click(); expect(click).toHaveBeenCalledTimes(1); expect(f.onSelect).toHaveBeenCalledExactlyOnceWith('floor-0');
    expect(header.type).toBe('button'); expect(header.hasAttribute('data-taylors3d-ui')).toBe(true);
    expect(header.style.minWidth).toBe('44px'); expect(header.style.minHeight).toBe('44px'); expect(header.style.pointerEvents).toBe('auto');
  });

  it('does not resurrect a label below an invisible ancestor in the following frame', () => {
    const f = setup(); f.draw(); f.groups[0].visible = false; f.draw();
    expect(f.objects[0].visible).toBe(true); expect(f.objects[0].element.style.display).toBe('none');
    expect(f.objects[1].element.style.display).toBe(''); expect(f.helper.frame.has(f.objects[0].element)).toBe(false);
  });

  it('does not resurrect an individually hidden or HTML-hidden label', () => {
    const f = setup(4); f.draw(); f.objects[0].visible = false; f.objects[1].element.hidden = true; f.draw();
    expect(f.objects[0].element.style.display).toBe('none'); expect(f.objects[1].element.hidden).toBe(true);
    expect(f.helper.frame.has(f.objects[0].element)).toBe(false); expect(f.helper.frame.has(f.objects[1].element)).toBe(false);
    expect(f.objects[2].element.style.display).toBe(''); expect(f.objects[3].element.style.display).toBe('');
  });

  it('keeps an out-of-range label hidden instead of saving a false visible snapshot', () => {
    const f = setup(); f.objects[0].position.y = 200; f.draw();
    expect(f.objects[0].element.style.display).toBe('none'); expect(f.helper.frame.has(f.objects[0].element)).toBe(false);
    expect(f.objects[1].element.style.display).toBe('');
  });

  it('leaves an unselected floor hidden and removes only its owned pane', () => {
    const f = setup(); f.draw(); const removedHeader = f.helper.panes.get('floor-1').button;
    f.draw([f.entries[0]]);
    expect(f.helper.panes.has('floor-1')).toBe(false); expect(removedHeader.isConnected).toBe(false);
    expect(f.objects[1].element.parentNode).toBe(f.renderer.domElement); expect(f.objects[1].element.style.display).toBe('none');
    removedHeader.click(); expect(f.onSelect).not.toHaveBeenCalled();
  });

  it('resizes stable pane elements and projects into the new actual pane dimensions', () => {
    const f = setup(); f.draw(); const pane = f.helper.panes.get('floor-0'), label = f.objects[0].element;
    f.entries[0] = { ...f.entries[0], name: '<First & floor>', active: true, rect: { x: 8, y: 9, width: 220, height: 200 } };
    f.draw();
    expect(f.helper.panes.get('floor-0')).toBe(pane); expect(label.parentNode).toBe(pane.clip);
    expect(pane.clip.style.width).toBe('220px'); expect(pane.clip.style.top).toBe('9px');
    const projected = projectedPixels(label); expect(projected[0]).toBeCloseTo(110); expect(projected[1]).toBeCloseTo(100);
    expect(pane.button.textContent).toBe('<First & floor>');
    expect(pane.button.querySelector('*')).toBeNull(); expect(pane.button.getAttribute('aria-pressed')).toBe('true');
  });

  it('releases only owned panes and preserves actual labels and foreign root children', () => {
    const f = setup(), foreign = document.createElement('aside'); f.renderer.domElement.append(foreign); f.draw();
    const headers = [...f.helper.panes.values()].map((pane) => pane.button); f.helper.clear(); f.helper.clear();
    expect(foreign.parentNode).toBe(f.renderer.domElement); expect(f.helper.panes.size).toBe(0);
    for (const object of f.objects) expect(object.element.parentNode).toBe(f.renderer.domElement);
    for (const header of headers) header.click(); expect(f.onSelect).not.toHaveBeenCalled();
    f.renderer.render(f.scene, f.entries[0].camera); expect(f.objects.every((object) => object.element.style.display === '')).toBe(true);
  });

  it('keeps the same floor header through a real CSS2DObject source replacement', () => {
    const f = setup(); f.draw(); const old = f.objects[0], header = f.helper.panes.get('floor-0').button;
    old.removeFromParent(); expect(old.element.parentNode).toBeNull();
    const next = new CSS2DObject(document.createElement('button')); next.element.textContent = 'New current source';
    f.groups[0].add(next); f.objects[0] = next; f.draw();
    expect(f.helper.panes.get('floor-0').button).toBe(header); expect(next.element.parentNode).toBe(f.helper.panes.get('floor-0').clip);
    expect(old.element.parentNode).toBeNull(); expect(f.helper.labels.has(old.element)).toBe(false);
  });

  it('does not reattach a source label removed after its first pane pass', () => {
    const f = setup(); f.helper.begin(f.entries); f.groups[1].visible = false; f.helper.render(f.scene, f.entries[0]);
    f.objects[0].removeFromParent(); f.groups[0].visible = false; f.groups[1].visible = true;
    f.helper.render(f.scene, f.entries[1]); f.helper.finish({ width: 640, height: 480 });
    expect(f.objects[0].element.parentNode).toBeNull(); expect(f.objects[1].element.style.display).toBe('');
  });

  it.each([0, 1])('retains native focus on the actual tracking label in pane %i through steady two-pane frames', (index) => {
    const f = setup(); f.draw(); const label = f.objects[index].element;
    label.focus(); expect(document.activeElement).toBe(label);
    f.draw(); f.draw();
    expect(document.activeElement).toBe(label); expect(label.parentNode).toBe(f.helper.panes.get(`floor-${index}`).clip);
    expect(Object.hasOwn(f.renderer.domElement, 'appendChild')).toBe(false);
  });

  it('retains native focus on the stable floor heading during repeated frames', () => {
    const f = setup(); f.draw(); const header = f.helper.panes.get('floor-0').button;
    header.focus(); f.draw(); f.draw(); expect(document.activeElement).toBe(header);
  });

  it('restores an exact foreign own appendChild descriptor after success and exception', () => {
    const f = setup(), append = f.renderer.domElement.appendChild, foreign = vi.fn(function (element) { return append.call(this, element); });
    Object.defineProperty(f.renderer.domElement, 'appendChild', { value: foreign, configurable: true, enumerable: true, writable: false });
    const descriptor = Object.getOwnPropertyDescriptor(f.renderer.domElement, 'appendChild'); f.draw();
    expect(Object.getOwnPropertyDescriptor(f.renderer.domElement, 'appendChild')).toEqual(descriptor);
    expect(foreign).toHaveBeenCalled();
    f.objects[0].onBeforeRender = () => { throw new Error('current source callback failed'); };
    f.helper.begin(f.entries); f.groups[1].visible = false;
    expect(() => f.helper.render(f.scene, f.entries[0])).toThrow('current source callback failed');
    expect(Object.getOwnPropertyDescriptor(f.renderer.domElement, 'appendChild')).toEqual(descriptor);
    expect(f.helper.panes.size).toBe(0); expect(f.renderer.getSize()).toEqual({ width: 640, height: 480 });
  });

  it('does not steal a label deliberately moved by its source owner before finish', () => {
    const f = setup(), foreign = document.createElement('aside'); document.body.append(foreign);
    try {
      f.helper.begin(f.entries); f.groups[1].visible = false; f.helper.render(f.scene, f.entries[0]);
      foreign.append(f.objects[0].element); f.helper.finish({ width: 640, height: 480 }); f.helper.clear();
      expect(f.objects[0].element.parentNode).toBe(foreign);
    } finally { foreign.remove(); }
  });

  it('cleans owned DOM and full size if the real renderer throws mid-frame', () => {
    const f = setup(); f.draw(); const headers = [...f.helper.panes.values()].map((pane) => pane.button);
    f.helper.begin(f.entries); const original = f.renderer.render;
    f.renderer.render = () => { throw new Error('source callback failed'); };
    expect(() => f.helper.render(f.scene, f.entries[0])).toThrow('source callback failed');
    f.renderer.render = original;
    expect(f.helper.panes.size).toBe(0); expect(f.renderer.getSize()).toEqual({ width: 640, height: 480 });
    expect(f.objects.every((object) => object.element.parentNode === f.renderer.domElement)).toBe(true);
    for (const header of headers) header.click(); expect(f.onSelect).not.toHaveBeenCalled();
  });

  it('accepts only current usable entries and does not render a missing floor or camera', () => {
    const f = setup(); f.helper.begin([f.entries[0], f.entries[0], { floorId: 'bad', rect: { x: 0, y: 0, width: NaN, height: 20 } }]);
    expect(f.helper.panes.size).toBe(1); expect(f.helper.render(f.scene, f.entries[1])).toBe(false);
    expect(f.helper.render(f.scene, { ...f.entries[0], camera: null })).toBe(false); f.helper.finish({ w: 640, h: 480 });
    expect(f.helper.panes.get('floor-0').button.textContent).toBe('Floor 0');
  });
});
