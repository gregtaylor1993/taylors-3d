import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { normaliseCoverage, coverageSector, CameraCoverageLayer, COVERAGE_LIMITS } from '../src/camera-coverage.js';

const config = { enabled: true, heading: 0, fov: 90, range: 8 };
const position = { x: 10, y: 20, z: 2.5, elevation: 3, floorId: 'first' };
const anchor = () => ({ id: 'camera-marker', entity: 'camera.front', position: { ...position } });
const data = (settings = config) => ({ anchors: [anchor()], bindings: { 'camera-marker': settings }, visibleFloors: ['first'] });

describe('explicit camera coverage settings', () => {
  it('is opt-in and supplies no guessed lens, range or heading', () => {
    expect(normaliseCoverage()).toMatchObject({ enabled: false, valid: true, approximate: true, heading: null, fov: null, range: null });
    expect(normaliseCoverage(normaliseCoverage()).valid).toBe(true);
    expect(coverageSector(position, {})).toBeNull();
    const missing = normaliseCoverage({ enabled: true });
    expect(missing.valid).toBe(false); expect(missing.diagnostics.map((d) => d.code)).toEqual(['heading', 'fov', 'range']);
  });

  it('uses only explicit plan headings and normalizes clockwise bearings', () => {
    expect(normaliseCoverage({ ...config, heading: undefined }, { heading: 45 }).heading).toBe(45);
    expect(normaliseCoverage(config, { heading: 45 }).heading).toBe(0);
    expect(normaliseCoverage({ ...config, heading: -450 }).heading).toBe(270);
    expect(normaliseCoverage({ ...config, heading: 810 }).heading).toBe(90);
    expect(normaliseCoverage({ ...config, heading: undefined }).valid).toBe(false);
  });

  it.each([
    ['heading', NaN], ['heading', Infinity], ['heading', '90'], ['fov', 0], ['fov', 180], ['fov', null],
    ['range', 0], ['range', -1], ['range', COVERAGE_LIMITS.maxRange + 1], ['range', Infinity],
    ['segments', 1], ['segments', 65], ['segments', 3.5], ['opacity', -.1], ['opacity', 1.1], ['opacity', NaN],
    ['color', 'red'], ['color', '#fff'], ['show_rays', 'false'], ['unit', 'ft'], ['enabled', 'true'],
  ])('rejects invalid %s %s', (field, value) => {
    expect(normaliseCoverage({ ...config, [field]: value }).valid).toBe(false);
    expect(coverageSector(position, { ...config, [field]: value })).toBeNull();
  });

  it('accepts range/FOV limits and safe style options without changing the inputs', () => {
    const source = { ...config, range: .1, fov: 1, color: '#ABCDEF', opacity: 0, show_rays: false, segments: 2 };
    expect(normaliseCoverage(source)).toMatchObject({ valid: true, color: '#abcdef', opacity: 0, show_rays: false });
    expect(source.color).toBe('#ABCDEF');
    expect(normaliseCoverage({ ...config, range: 100, fov: 175, segments: 64 }).valid).toBe(true);
    expect(normaliseCoverage(null).valid).toBe(false); expect(normaliseCoverage(new Date()).valid).toBe(false);
    const invalidUnit = normaliseCoverage({ ...config, unit: 'ft' });
    expect(coverageSector(position, invalidUnit)).toBeNull();
  });
});

describe('north-up horizontal coverage sectors', () => {
  it.each([[0, 10, 28], [90, 18, 20], [180, 10, 12], [270, 2, 20]])('heading %s has the expected centre ray', (heading, x, y) => {
    const sector = coverageSector(position, { ...config, heading });
    expect(sector.arc[12][0]).toBeCloseTo(x); expect(sector.arc[12][1]).toBeCloseTo(y);
    expect(sector.origin).toEqual(position); expect(sector.approximate).toBe(true);
  });

  it('keeps the configured radius/FOV, with bounded tessellation and no vertical-FOV claims', () => {
    const sector = coverageSector(position, config), side = 8 / Math.sqrt(2);
    expect(sector.arc[0][0]).toBeCloseTo(10 - side); expect(sector.arc.at(-1)[0]).toBeCloseTo(10 + side);
    expect(sector.arc[0][1]).toBeCloseTo(20 + side); expect(sector.polygon[0]).toEqual([10, 20]);
    expect(sector.arc).toHaveLength(25); expect(sector.polygon).toHaveLength(26);
    for (const p of sector.arc) expect(Math.hypot(p[0] - 10, p[1] - 20)).toBeCloseTo(8);
    expect(coverageSector({ ...position, z: 5 }, config).polygon).toEqual(sector.polygon);
  });

  it.each([null, {}, { ...position, x: '10' }, { ...position, x: Infinity }, { ...position, y: 1e308 },
    { ...position, z: NaN }, { ...position, z: 1001 }, { ...position, elevation: Infinity }, { ...position, floorId: '' }])('rejects invalid or implausible positions', (p) => {
    expect(coverageSector(p, config)).toBeNull();
  });

  it('can use a floor anchor without a supplied mounting height or elevation', () => {
    expect(coverageSector({ x: 1, y: 2, floor_id: 'ground' }, config).origin).toEqual({ x: 1, y: 2, z: 0, elevation: 0, floorId: 'ground' });
  });
});

describe('static CameraCoverageLayer', () => {
  it.each([0, 90, 180, 270])('projects heading %s into the existing north=-Z world at the supplied floor elevation', (heading) => {
    const scene = new THREE.Scene(), layer = new CameraCoverageLayer(scene);
    expect(layer.setData(data({ ...config, heading }))).toBe(true);
    const part = layer.sectors.get('camera-marker'); scene.updateMatrixWorld(true);
    const point = new THREE.Vector3().fromBufferAttribute(part.fill.geometry.attributes.position, 13).applyMatrix4(part.group.matrixWorld);
    const sector = coverageSector(position, { ...config, heading });
    expect(point.x).toBeCloseTo(sector.arc[12][0]); expect(point.z).toBeCloseTo(-sector.arc[12][1]); expect(point.y).toBeCloseTo(3.035);
    const apex = new THREE.Vector3().fromBufferAttribute(part.rays.geometry.attributes.position, 0).applyMatrix4(part.group.matrixWorld);
    expect(apex.x).toBeCloseTo(10); expect(apex.y).toBeCloseTo(5.5); expect(apex.z).toBeCloseTo(-20);
    expect(part.fill.geometry.index.count).toBe(72); layer.dispose();
  });

  it('filters the supplied floor and object visibility without guessing level visibility', () => {
    const layer = new CameraCoverageLayer(new THREE.Scene());
    expect(layer.setData({ ...data(), visibleFloors: ['ground'] })).toBe(false); expect(layer.sectors.size).toBe(0);
    expect(layer.setData(data())).toBe(true);
    expect(layer.setData({ ...data(), anchors: [{ ...anchor(), shown: false }] })).toBe(true); expect(layer.sectors.size).toBe(0);
    expect(layer.setData({ ...data(), anchors: [{ ...anchor(), visible: false }] })).toBe(false);
    expect(layer.setData({ ...data(), visibleFloors: new Set(['first']) })).toBe(true);
    expect(layer.setData({ ...data(), visibleFloors: [] })).toBe(true); expect(layer.sectors.size).toBe(0); layer.dispose();
  });

  it('resolves entity bindings and honors an explicit disabled anchor binding', () => {
    const layer = new CameraCoverageLayer(new THREE.Scene());
    expect(layer.setData({ anchors: [anchor()], bindings: new Map([['camera.front', config]]) })).toBe(true);
    expect(layer.setData({ anchors: [anchor()], bindings: { 'camera.front': config, 'camera-marker': { enabled: false } } })).toBe(true);
    expect(layer.sectors.size).toBe(0);
    expect(layer.setData({ anchors: [{ entity: 'camera.front', position }], bindings: { 'camera.front': config } })).toBe(true);
    expect(layer.sectors.has('camera.front')).toBe(true); layer.dispose();
  });

  it('requires an exact anchor choice for duplicate entities and rejects duplicate IDs', () => {
    const layer = new CameraCoverageLayer(new THREE.Scene()); const anchors = [anchor(), { ...anchor(), id: 'model-camera' }];
    expect(layer.setData({ anchors, bindings: { 'camera.front': config } })).toBe(false);
    expect(layer.sectors.size).toBe(0); expect(layer.diagnostics.every((d) => d.code === 'ambiguous_anchor')).toBe(true);
    expect(layer.setData({ anchors, bindings: { 'camera.front': config, 'model-camera': config } })).toBe(true);
    expect([...layer.sectors.keys()]).toEqual(['model-camera']);
    expect(layer.setData({ anchors: [anchor(), anchor()], bindings: data().bindings })).toBe(true);
    expect(layer.sectors.size).toBe(0); expect(layer.diagnostics.every((d) => d.code === 'duplicate_anchor')).toBe(true); layer.dispose();
  });

  it('reports invalid settings/positions and accepts a root-supplied explicit plan heading', () => {
    const layer = new CameraCoverageLayer(new THREE.Scene());
    expect(layer.setData(data({ ...config, heading: undefined }))).toBe(false); expect(layer.diagnostics[0].code).toBe('heading');
    expect(layer.setData({ ...data(), anchors: [{ ...anchor(), position: { ...position, x: null } }] })).toBe(false);
    expect(layer.diagnostics[0].code).toBe('position');
    expect(layer.setData({ ...data({ ...config, heading: undefined }), anchors: [{ ...anchor(), heading: 90 }] })).toBe(true);
    expect(layer.sectors.get('camera-marker').group.rotation.y).toBeCloseTo(-Math.PI / 2); layer.dispose();
  });

  it('leaves empty, disabled, transparent and semantically unchanged data idle', () => {
    const invalidate = vi.fn(), layer = new CameraCoverageLayer(new THREE.Scene(), { onInvalidate: invalidate });
    expect(layer.setData({})).toBe(false); expect(layer.setData(data({ ...config, enabled: false }))).toBe(false);
    expect(layer.setData(data({ ...config, opacity: 0 }))).toBe(false); expect(invalidate).not.toHaveBeenCalled();
    expect(layer.setData(data())).toBe(true);
    const part = layer.sectors.get('camera-marker'), geometry = part.fill.geometry, material = part.fillMaterial;
    const color = vi.spyOn(material.color, 'set'), remove = vi.spyOn(geometry, 'dispose'); invalidate.mockClear();
    for (let i = 0; i < 10; i++) {
      const same = structuredClone(data()); same.anchors[0].label = String(i); same.anchors[0].diagnostics = ['unrelated'];
      expect(layer.setData(same)).toBe(false);
    }
    expect(invalidate).not.toHaveBeenCalled(); expect(color).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    expect(layer.sectors.get('camera-marker')).toBe(part); expect(part.fill.geometry).toBe(geometry); expect(part.fillMaterial).toBe(material); layer.dispose();
  });

  it('reuses geometry/materials for movement, heading and style, and replaces only changed shape geometry', () => {
    const layer = new CameraCoverageLayer(new THREE.Scene()), source = data(); layer.setData(source);
    const part = layer.sectors.get('camera-marker'), fill = part.fill.geometry, outline = part.outline.geometry, rays = part.rays.geometry, material = part.fillMaterial;
    const oldFill = vi.spyOn(fill, 'dispose'), oldOutline = vi.spyOn(outline, 'dispose');
    source.anchors[0].position.x = 12; source.anchors[0].position.z = 4;
    expect(layer.setData(source)).toBe(true); expect(part.fill.geometry).toBe(fill); expect(part.rays.geometry).toBe(rays);
    source.bindings['camera-marker'] = { ...config, heading: 90, color: '#abcdef', opacity: .25, show_rays: false };
    expect(layer.setData(source)).toBe(true); expect(part.fill.geometry).toBe(fill); expect(part.fillMaterial).toBe(material);
    expect(part.fillMaterial.color.getHexString()).toBe('abcdef'); expect(part.rays.visible).toBe(false); expect(oldFill).not.toHaveBeenCalled();
    source.bindings['camera-marker'].range = 12;
    expect(layer.setData(source)).toBe(true); expect(part.fill.geometry).not.toBe(fill); expect(oldFill).toHaveBeenCalledOnce();
    expect(oldOutline).toHaveBeenCalledOnce(); expect(part.fillMaterial).toBe(material); expect(part.rays.geometry).toBe(rays); layer.dispose();
  });

  it('marks all helpers non-pickable and adds no real lights', () => {
    const scene = new THREE.Scene(), layer = new CameraCoverageLayer(scene); layer.setData(data()); scene.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(10, 20, -25), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(layer.group, true)).toEqual([]);
    layer.group.traverse((object) => { expect(object.userData.helper).toBe(true); expect(object.isLight).not.toBe(true); }); layer.dispose();
  });

  it('supports hiding without rebuilding and suppresses invalidation while its group is hidden', () => {
    const invalidate = vi.fn(), layer = new CameraCoverageLayer(new THREE.Scene(), { onInvalidate: invalidate });
    expect(layer.setVisible(false)).toBe(false); expect(layer.setData(data())).toBe(true); expect(invalidate).not.toHaveBeenCalled();
    const part = layer.sectors.get('camera-marker'); expect(layer.setVisible(true)).toBe(true); expect(layer.setVisible(true)).toBe(false);
    expect(invalidate).toHaveBeenCalledOnce(); expect(layer.setData(data())).toBe(false); expect(layer.sectors.get('camera-marker')).toBe(part);
    expect(layer.setVisible(false)).toBe(true); expect(invalidate).toHaveBeenCalledTimes(2); layer.dispose();
  });

  it('disposes all owned resources exactly once on removal/disposal and leaves the parent intact', () => {
    const parent = new THREE.Scene(), other = new THREE.Group(); parent.add(other);
    const layer = new CameraCoverageLayer(parent); layer.setData(data()); const part = layer.sectors.get('camera-marker');
    const spies = [part.fill.geometry, part.outline.geometry, part.rays.geometry, part.fillMaterial, part.lineMaterial].map((resource) => vi.spyOn(resource, 'dispose'));
    expect(layer.setData({})).toBe(true); expect(layer.setData({})).toBe(false); spies.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
    layer.setData(data()); const next = layer.sectors.get('camera-marker'), dispose = vi.spyOn(next.fillMaterial, 'dispose');
    layer.dispose(); layer.dispose(); expect(dispose).toHaveBeenCalledOnce(); expect(parent.children).toEqual([other]);
    expect(layer.setData(data())).toBe(false); expect(layer.setVisible(true)).toBe(false); expect(layer.sectors.size).toBe(0);
  });
});
