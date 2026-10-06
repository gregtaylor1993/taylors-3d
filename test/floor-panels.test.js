import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FLOOR_PANEL_LIMITS, floorPanelRects, floorPanelAt, floorPanelNdc,
  renderFloorPanels, FloorPanelsRenderer } from '../src/floor-panels.js';

const box = { left: 100, top: 50, width: 800, height: 400 };
function fixture({ count = 2, width = 800, height = 400, shadows = false, requested = false, auto = false, dpr = 1 } = {}) {
  const size = { width, height }, scene = new THREE.Scene(), floors = [], meshes = [];
  for (let index = 0; index < count; index++) {
    const group = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    group.name = `floor-${index}`; mesh.name = `mesh-${index}`; group.add(mesh); scene.add(group); floors.push(group); meshes.push(mesh);
  }
  const lamp = new THREE.DirectionalLight(); lamp.castShadow = true; lamp.shadow.needsUpdate = requested; scene.add(lamp);
  const cameras = Array.from({ length: count }, (_, index) => {
    const camera = new THREE.PerspectiveCamera(37, 3, .25, 700);
    camera.position.set(index + 2, 8, 15); camera.lookAt(index, 0, 0); return camera;
  });
  const entries = floorPanelRects(size, count).map((rect, index) => ({ floorId: `exact-${index}`, camera: cameras[index], rect,
    visibility: floors.map((node, floorIndex) => ({ node, visible: floorIndex === index })) }));
  const state = { viewport: new THREE.Vector4(9, 12, 73, 91), scissor: new THREE.Vector4(3, 5, 61, 71), scissorTest: false };
  const draws = [];
  const renderer = { autoClear: true, shadowMap: { enabled: shadows, autoUpdate: auto, needsUpdate: requested },
    getPixelRatio: vi.fn(() => dpr), getSize: vi.fn((target) => target.set(width, height)),
    getViewport: vi.fn((target) => target.copy(state.viewport)), getScissor: vi.fn((target) => target.copy(state.scissor)),
    getScissorTest: vi.fn(() => state.scissorTest),
    setViewport: vi.fn((...values) => values.length === 1 ? state.viewport.copy(values[0]) : state.viewport.set(...values)),
    setScissor: vi.fn((...values) => values.length === 1 ? state.scissor.copy(values[0]) : state.scissor.set(...values)),
    setScissorTest: vi.fn((value) => { state.scissorTest = value; }), clear: vi.fn(), clearDepth: vi.fn(),
    render: vi.fn((renderedScene, camera) => {
      const actual = meshes.filter((mesh) => {
        for (let node = mesh; node; node = node.parent) if (!node.visible) return false;
        return true;
      }).map((mesh) => mesh.name);
      draws.push({ scene: renderedScene, camera, visible: actual, viewport: state.viewport.toArray(), scissor: state.scissor.toArray(),
        aspect: camera.aspect, shadowUpdate: renderer.shadowMap.enabled && (renderer.shadowMap.autoUpdate || renderer.shadowMap.needsUpdate),
        lampUpdate: lamp.shadow.needsUpdate });
      if (renderer.shadowMap.enabled && (renderer.shadowMap.autoUpdate || renderer.shadowMap.needsUpdate)) {
        renderer.shadowMap.needsUpdate = false; lamp.shadow.needsUpdate = false;
      }
    }) };
  const original = { viewport: state.viewport.toArray(), scissor: state.scissor.toArray(), scissorTest: state.scissorTest, autoClear: renderer.autoClear };
  return { size, scene, floors, meshes, lamp, entries, cameras, renderer, state, draws, original };
}
function restored(f) {
  expect(f.state.viewport.toArray()).toEqual(f.original.viewport); expect(f.state.scissor.toArray()).toEqual(f.original.scissor);
  expect(f.state.scissorTest).toBe(f.original.scissorTest); expect(f.renderer.autoClear).toBe(f.original.autoClear);
  expect(f.floors.map((node) => node.visible)).toEqual(f.floors.map(() => true));
  expect(f.cameras.map((camera) => camera.aspect)).toEqual(f.cameras.map(() => 3));
}

describe('bounded floor-pane CSS layout', () => {
  it.each([1, 2, 3, 4])('fills a wide view with %i ordered columns and exact gaps', (count) => {
    const rects = floorPanelRects({ width: 805.5, height: 401.25 }, count);
    expect(rects).toHaveLength(count); expect(rects[0].x).toBe(0);
    expect(rects.at(-1).x + rects.at(-1).width).toBe(805.5);
    rects.forEach((rect, index) => { expect(rect.index).toBe(index); expect(rect.y).toBe(0); expect(rect.height).toBe(401.25);
      expect(rect.width).toBeGreaterThanOrEqual(44); if (index) expect(rect.x - rects[index - 1].x - rects[index - 1].width).toBeCloseTo(8, 9); });
  });
  it('switches at the actual card-width breakpoint and stacks four usable narrow panes', () => {
    const narrow = floorPanelRects({ width: 320, height: 500 }, 4), wide = floorPanelRects({ width: 640, height: 500 }, 4);
    expect(narrow.map((rect) => rect.x)).toEqual([0, 0, 0, 0]); expect(narrow.map((rect) => rect.width)).toEqual([320, 320, 320, 320]);
    expect(narrow.at(-1).y + narrow.at(-1).height).toBe(500); expect(wide.map((rect) => rect.y)).toEqual([0, 0, 0, 0]);
    expect(floorPanelRects({ width: 639, height: 500 }, 2)[1].y).toBeGreaterThan(0);
  });
  it('does not silently reduce the requested floor count when controls would be too small', () => {
    expect(floorPanelRects({ width: 320, height: 199 }, 4)).toEqual([]);
    expect(floorPanelRects({ width: 320, height: 200 }, 4).map((rect) => rect.height)).toEqual([44, 44, 44, 44]);
    expect(floorPanelRects({ width: 43, height: 800 }, 1)).toEqual([]);
  });
  it.each([0, 5, -1, 1.5, NaN, '2'])('rejects invalid pane count %s', (count) => {
    expect(floorPanelRects({ width: 800, height: 400 }, count)).toEqual([]);
  });
  it.each([{ width: 0, height: 400 }, { width: 800, height: Infinity }, { width: '800', height: 400 }, null])('rejects invalid size %j', (size) => {
    expect(floorPanelRects(size, 2)).toEqual([]);
  });
  it('rejects invalid spacing options and supports a deliberate zero gap', () => {
    expect(floorPanelRects({ width: 800, height: 400 }, 2, { gap: -1 })).toEqual([]);
    expect(floorPanelRects({ width: 800, height: 400 }, 2, { breakpoint: 0 })).toEqual([]);
    expect(floorPanelRects({ width: 800, height: 400 }, 2, { minPane: NaN })).toEqual([]);
    expect(floorPanelRects({ width: 800, height: 400 }, 2, { gap: 0 }).map((rect) => rect.width)).toEqual([400, 400]);
  });
});

describe('pane-specific client coordinates and rays', () => {
  it('returns the exact supplied pane and rejects the separating gap', () => {
    const f = fixture();
    expect(floorPanelAt(100, 50, box, f.entries)).toBe(f.entries[0]);
    expect(floorPanelAt(100 + 395.99, 50 + 200, box, f.entries)).toBe(f.entries[0]);
    expect(floorPanelAt(100 + 396, 250, box, f.entries)).toBeNull();
    expect(floorPanelAt(100 + 403.999, 250, box, f.entries)).toBeNull();
    expect(floorPanelAt(100 + 404, 250, box, f.entries)).toBe(f.entries[1]);
    expect(floorPanelAt(900, 250, box, f.entries)).toBeNull(); expect(floorPanelAt(500, 450, box, f.entries)).toBeNull();
  });
  it('produces a separate ray origin at each pane centre', () => {
    const f = fixture();
    for (const pane of f.entries) {
      const { rect } = pane;
      expect(floorPanelNdc(100 + rect.x + rect.width / 2, 50 + rect.height / 2, box, pane, f.size)).toEqual({ x: 0, y: 0 });
      expect(floorPanelNdc(100 + rect.x, 50, box, pane, f.size)).toEqual({ x: -1, y: 1 });
    }
    expect(floorPanelNdc(500, 250, box, f.entries[0], f.size)).toBeNull();
  });
  it('accounts for a CSS-scaled canvas without multiplying device pixel ratio', () => {
    const f = fixture(), scaled = { left: 12, top: 20, width: 400, height: 200 };
    expect(floorPanelAt(12 + 202, 20 + 100, scaled, f.entries, f.size)).toBe(f.entries[1]);
    expect(floorPanelNdc(12 + (404 + 198) / 2, 120, scaled, f.entries[1], f.size)).toEqual({ x: 0, y: 0 });
    expect(floorPanelAt(12 + 200, 120, scaled, f.entries, f.size)).toBeNull();
  });
  it('uses stacked-pane local height on a narrow card', () => {
    const f = fixture({ width: 320, height: 500, count: 4 }), bounds = { left: 0, top: 0, width: 320, height: 500 };
    for (const pane of f.entries) {
      const cy = pane.rect.y + pane.rect.height / 2;
      expect(floorPanelAt(160, cy, bounds, f.entries)).toBe(pane);
      expect(floorPanelNdc(160, cy, bounds, pane, f.size)).toEqual({ x: 0, y: 0 });
    }
  });
  it('does not select ambiguous overlaps, malformed coordinates or out-of-canvas points', () => {
    const rect = { x: 0, y: 0, width: 400, height: 400 };
    expect(floorPanelAt(200, 100, box, [rect, { ...rect }])).toBeNull();
    expect(floorPanelAt(NaN, 100, box, [rect])).toBeNull();
    expect(floorPanelAt(99, 100, box, [rect])).toBeNull();
    expect(floorPanelAt(200, 100, { ...box, width: 0 }, [rect])).toBeNull();
    expect(floorPanelNdc(100, 100, box, { ...rect, width: 0 })).toBeNull();
  });
});

describe('one-renderer pane passes and temporary ownership', () => {
  it('renders all four exact floors with one scene and restores original WebGL/camera/object state', () => {
    const f = fixture({ count: 4 }), projection = f.cameras.map((camera) => camera.projectionMatrix.toArray());
    const result = renderFloorPanels(f.renderer, f.scene, f.entries);
    expect(result).toEqual({ rendered: 4, panes: ['exact-0', 'exact-1', 'exact-2', 'exact-3'] });
    expect(f.draws.map((draw) => draw.visible)).toEqual([['mesh-0'], ['mesh-1'], ['mesh-2'], ['mesh-3']]);
    f.draws.forEach((draw, index) => { expect(draw.scene).toBe(f.scene); expect(draw.camera).toBe(f.cameras[index]);
      expect(draw.viewport).toEqual([f.entries[index].rect.x, 0, f.entries[index].rect.width, 400]);
      expect(draw.scissor).toEqual(draw.viewport); expect(draw.aspect).toBeCloseTo(f.entries[index].rect.width / 400, 12); });
    expect(f.renderer.clear).toHaveBeenCalledExactlyOnceWith(true, true, true); expect(f.renderer.clearDepth).toHaveBeenCalledTimes(4);
    expect(f.cameras.map((camera) => camera.projectionMatrix.toArray())).toEqual(projection); restored(f);
  });
  it('converts top-left narrow rectangles into bottom-left WebGL viewports exactly', () => {
    const f = fixture({ width: 320, height: 500, count: 4 }); renderFloorPanels(f.renderer, f.scene, f.entries);
    f.draws.forEach((draw, index) => { const rect = f.entries[index].rect;
      expect(draw.viewport).toEqual([0, 500 - rect.y - rect.height, 320, rect.height]); }); restored(f);
  });
  it.each([1, 1.5, 2, 3])('passes CSS logical dimensions unchanged at pixel ratio %s', (dpr) => {
    const f = fixture({ dpr }); renderFloorPanels(f.renderer, f.scene, f.entries);
    expect(f.draws.map((draw) => draw.viewport)).toEqual([[0, 0, 396, 400], [404, 0, 396, 400]]);
    expect(f.renderer.getPixelRatio).not.toHaveBeenCalled(); restored(f);
  });
  it('restores an orthographic camera custom projection and original off-centre frustum', () => {
    const f = fixture(), camera = new THREE.OrthographicCamera(-3, 9, 7, -5, .1, 600);
    camera.zoom = 1.75; camera.updateProjectionMatrix(); camera.projectionMatrix.elements[8] += .125;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); f.entries[0].camera = camera;
    const before = { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom, zoom: camera.zoom,
      matrix: camera.projectionMatrix.toArray(), inverse: camera.projectionMatrixInverse.toArray() };
    const onPaneRendered = vi.fn((entry) => { if (entry.camera === camera) {
      expect(camera.right - camera.left).toBeCloseTo(12 * 396 / 400, 12); expect((camera.left + camera.right) / 2).toBeCloseTo(3, 12);
      expect(camera.zoom).toBe(1.75); } });
    renderFloorPanels(f.renderer, f.scene, f.entries, { onPaneRendered });
    expect({ left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom, zoom: camera.zoom,
      matrix: camera.projectionMatrix.toArray(), inverse: camera.projectionMatrixInverse.toArray() }).toEqual(before); restored(f);
  });
  it('runs label callbacks while the right camera and visibility are current, then runs cleanup', () => {
    const f = fixture(), cleanup = vi.fn(), seen = [];
    renderFloorPanels(f.renderer, f.scene, f.entries, { enterPane: (entry, index) => {
      expect(entry.camera.aspect).toBeCloseTo(entry.rect.width / entry.rect.height, 12); f.meshes[0].visible = index === 0; return cleanup;
    }, onPaneRendered: (entry, index) => {
      seen.push(entry.floorId); expect(f.floors[index].visible).toBe(true); expect(f.floors[1 - index].visible).toBe(false);
    } });
    expect(seen).toEqual(['exact-0', 'exact-1']); expect(cleanup).toHaveBeenCalledTimes(2); expect(f.meshes[0].visible).toBe(true); restored(f);
  });
  it.each(['enter', 'render', 'labels', 'cleanup'])('restores every owned state if %s throws', (phase) => {
    const f = fixture(), failure = new Error(`failed-${phase}`), options = {};
    if (phase === 'enter') options.enterPane = () => { f.meshes[0].visible = false; throw failure; };
    if (phase === 'render') f.renderer.render.mockImplementationOnce(() => { throw failure; });
    if (phase === 'labels') options.onPaneRendered = () => { throw failure; };
    if (phase === 'cleanup') options.enterPane = () => () => { throw failure; };
    expect(() => renderFloorPanels(f.renderer, f.scene, f.entries, options)).toThrow(failure);
    expect(f.renderer.render).toHaveBeenCalledTimes(phase === 'enter' ? 0 : 1); expect(f.meshes[0].visible).toBe(true); restored(f);
  });
  it('retains the render failure when visibility cleanup also fails', () => {
    const f = fixture(), failure = new Error('render-first'); f.renderer.render.mockImplementationOnce(() => { throw failure; });
    expect(() => renderFloorPanels(f.renderer, f.scene, f.entries, { enterPane: () => () => { throw new Error('cleanup-second'); } })).toThrow(failure); restored(f);
  });
  it('restores the exact originally hidden scene nodes rather than showing everything', () => {
    const f = fixture(); f.floors[1].visible = false; f.meshes[0].visible = false;
    renderFloorPanels(f.renderer, f.scene, f.entries); expect(f.floors[1].visible).toBe(false); expect(f.meshes[0].visible).toBe(false);
    expect(f.draws[0].visible).toEqual([]); expect(f.draws[1].visible).toEqual(['mesh-1']);
  });
  it('rejects invalid entry sets before renderer state or visibility changes', () => {
    const changes = [[], (f) => [...f.entries, ...f.entries, ...f.entries],
      (f) => [{ ...f.entries[0], floorId: ' invalid ' }, f.entries[1]],
      (f) => [f.entries[0], { ...f.entries[1], floorId: f.entries[0].floorId }],
      (f) => [f.entries[0], { ...f.entries[1], camera: f.entries[0].camera }],
      (f) => [f.entries[0], { ...f.entries[1], rect: { ...f.entries[0].rect } }],
      (f) => [{ ...f.entries[0], rect: { x: 0, y: 0, width: 801, height: 400 } }],
      (f) => [{ ...f.entries[0], visibility: [{ node: new THREE.Group(), visible: false }] }]];
    for (const changed of changes) {
      const f = fixture(), entries = typeof changed === 'function' ? changed(f) : changed;
      expect(renderFloorPanels(f.renderer, f.scene, entries)).toMatchObject({ rendered: 0, reason: 'invalid_entries' });
      expect(f.renderer.setViewport).not.toHaveBeenCalled(); expect(f.renderer.render).not.toHaveBeenCalled(); restored(f);
    }
  });
  it('does not clear another owner when an explicit clear=false is used', () => {
    const f = fixture(); renderFloorPanels(f.renderer, f.scene, f.entries, { clear: false });
    expect(f.renderer.clear).not.toHaveBeenCalled(); expect(f.renderer.clearDepth).toHaveBeenCalledTimes(2); restored(f);
  });
});

describe('bounded shared shadow preparation', () => {
  it('updates all floor casters once before isolation and consumes the dirty request', () => {
    const f = fixture({ shadows: true, requested: true, count: 4 }); renderFloorPanels(f.renderer, f.scene, f.entries);
    expect(f.draws).toHaveLength(5); expect(f.draws[0].visible).toEqual(['mesh-0', 'mesh-1', 'mesh-2', 'mesh-3']);
    expect(f.draws[0].viewport).toEqual([0, 0, 0, 0]); expect(f.draws[0].scissor).toEqual([0, 0, 0, 0]);
    expect(f.draws.map((draw) => draw.shadowUpdate)).toEqual([true, false, false, false, false]);
    expect(f.renderer.shadowMap).toMatchObject({ autoUpdate: false, needsUpdate: false }); expect(f.lamp.shadow.needsUpdate).toBe(false); restored(f);
  });
  it('restores autoUpdate but does not let it update separately for each pane', () => {
    const f = fixture({ shadows: true, auto: true }); renderFloorPanels(f.renderer, f.scene, f.entries);
    expect(f.draws.map((draw) => draw.shadowUpdate)).toEqual([true, false, false]);
    expect(f.renderer.shadowMap.autoUpdate).toBe(true); expect(f.renderer.shadowMap.needsUpdate).toBe(false); restored(f);
  });
  it('has no preparation draw for unchanged shadows or disabled shadow maps', () => {
    for (const settings of [{ shadows: true }, { shadows: false, requested: true }]) {
      const f = fixture(settings); renderFloorPanels(f.renderer, f.scene, f.entries);
      expect(f.draws).toHaveLength(2); expect(f.draws.map((draw) => draw.shadowUpdate)).toEqual([false, false]);
      expect(f.renderer.shadowMap.needsUpdate).toBe(settings.requested === true); restored(f);
    }
  });
  it('allows View to prepare its existing fixed light pool once before node isolation', () => {
    const f = fixture({ shadows: true, requested: true }), prepareShadows = vi.fn((renderer, scene, entries) => {
      expect(f.floors.every((node) => node.visible)).toBe(true); expect(entries).toBe(f.entries); renderer.render(scene, entries[0].camera);
    });
    renderFloorPanels(f.renderer, f.scene, f.entries, { prepareShadows });
    expect(prepareShadows).toHaveBeenCalledExactlyOnceWith(f.renderer, f.scene, f.entries);
    expect(f.draws.map((draw) => draw.shadowUpdate)).toEqual([true, false, false]); restored(f);
  });
  it.each(['prepare', 'pane'])('keeps the original pending shadow/light request after a %s failure', (phase) => {
    const f = fixture({ shadows: true, requested: true }), failure = new Error(`failed-${phase}`);
    if (phase === 'prepare') f.renderer.render.mockImplementationOnce(() => { throw failure; });
    else f.renderer.render.mockImplementationOnce((scene, camera) => {
      f.draws.push({ scene, camera }); f.renderer.shadowMap.needsUpdate = false; f.lamp.shadow.needsUpdate = false;
    }).mockImplementationOnce(() => { throw failure; });
    expect(() => renderFloorPanels(f.renderer, f.scene, f.entries)).toThrow(failure);
    expect(f.renderer.shadowMap).toMatchObject({ autoUpdate: false, needsUpdate: true }); expect(f.lamp.shadow.needsUpdate).toBe(true); restored(f);
  });
});

describe('pane renderer coordination', () => {
  it('rereads entries and callbacks from its current owner without allocating runtime resources', () => {
    const f = fixture(), getPaneEntries = vi.fn(() => f.entries), enterPane = vi.fn(), onPaneRendered = vi.fn();
    const coordinator = new FloorPanelsRenderer({ getPaneEntries, enterPane, onPaneRendered });
    expect(coordinator.render(f.renderer, f.scene)).toMatchObject({ rendered: 2 });
    getPaneEntries.mockReturnValue([]); expect(coordinator.render(f.renderer, f.scene)).toMatchObject({ rendered: 0 });
    expect(getPaneEntries).toHaveBeenCalledTimes(2); expect(enterPane).toHaveBeenCalledTimes(2); expect(onPaneRendered).toHaveBeenCalledTimes(2);
    expect(Object.values(coordinator).some((value) => value?.isCamera || value?.isWebGLRenderer)).toBe(false); restored(f);
  });
  it('uses explicit current entries instead of invoking a stale entry callback', () => {
    const f = fixture(), getPaneEntries = vi.fn(() => { throw new Error('stale'); }), coordinator = new FloorPanelsRenderer({ getPaneEntries });
    expect(coordinator.render(f.renderer, f.scene, { entries: f.entries })).toMatchObject({ rendered: 2 });
    expect(getPaneEntries).not.toHaveBeenCalled(); expect(FLOOR_PANEL_LIMITS.maxPanes).toBe(4); restored(f);
  });
});
