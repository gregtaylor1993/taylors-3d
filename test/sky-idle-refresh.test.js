// @vitest-environment jsdom
// Exercise the actual Card sky callback and View rendering invalidation with
// real Three lights, model bounds and sky nodes. Only GPU/bitmap painting is a
// boundary; no production sky method is replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FloorplanView } from '../src/view.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';
import '../src/taylors3d-card.js';

const epoch = Date.parse('2026-10-05T12:00:00Z'), fixtures = [];
const sunState = (elevation = 30, azimuth = 180) => ({ state: elevation > 0 ? 'above_horizon' : 'below_horizon', attributes: { elevation, azimuth } });

function fixture({ bodies = false, location = { latitude: null, longitude: null } } = {}) {
  const scene = new THREE.Scene(), modelGroup = new THREE.Group(), root = new THREE.Group(), level = new THREE.Group();
  level.userData.fp = { kind: 'level', id: 'simulated-ground', role: 'storey' };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), new THREE.MeshStandardMaterial()); mesh.position.y = 1.5;
  level.add(mesh); root.add(level); modelGroup.add(root); scene.add(modelGroup);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4), hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.2), moonLight = new THREE.DirectionalLight(0xa8bcff, 0);
  const skyGroup = new THREE.Group(), clear = { color: new THREE.Color(), alpha: 0 };
  scene.add(skyGroup, sun, sun.target, hemi, moonLight, moonLight.target);
  const view = Object.assign(Object.create(FloorplanView.prototype), { scene, modelGroup, sun, hemi, moonLight, skyGroup,
    model: { id: 'simulated-sky-house', north: 0, root, manifest: buildManifest(threeAdapter(root)) },
    renderer: { shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false }, setClearColor: (color, alpha) => { clear.color.copy(color); clear.alpha = alpha; } },
    sky: { night: 0, sunDir: null, sun: 1 }, skyBodies: { sun: null, moon: null }, skySprites: { sun: null, moon: null },
    skyRing: null, _moonKey: null, _skyOn: false, sectionClip: null, dirty: false,
    stats: { frames: 0, shadow: 0, shadowLights: 0, occPasses: 0, occPartial: 0, occDone: 0 } });
  // The callback does not need HTMLElement connection/render lifecycle. Its
  // genuine prototype still reads HA evidence, alignment and the unit clock.
  const card = Object.assign(Object.create(customElements.get('taylors3d-card').prototype), { _view: view,
    _config: { sky_bodies: bodies }, _layout: { model: {} }, _skyMode: 'auto', _skyLast: null,
    _hass: { config: { ...location }, states: { 'sun.sun': sunState() }, entities: {}, devices: {} } });
  const f = { card, view, root, clear }; fixtures.push(f); return f;
}

const visualState = ({ view, root, clear }) => ({ sky: structuredClone(view.sky), bodies: structuredClone(view.skyBodies),
  sun: { uuid: view.sun.uuid, intensity: view.sun.intensity, position: view.sun.position.toArray(), target: view.sun.target.position.toArray(), color: view.sun.color.getHexString() },
  hemi: { uuid: view.hemi.uuid, intensity: view.hemi.intensity, color: view.hemi.color.getHexString(), ground: view.hemi.groundColor.getHexString() },
  moon: { uuid: view.moonLight.uuid, intensity: view.moonLight.intensity, position: view.moonLight.position.toArray() },
  clear: [clear.color.getHexString(), clear.alpha], skyOn: view._skyOn,
  nodes: (() => { const rows = []; view.scene.traverse((node) => rows.push([node.uuid, node.visible, node.position.toArray()])); return rows; })(),
  source: root.children.map((node) => [node.uuid, node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()]), stats: { ...view.stats } });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(epoch); delete window.__demoNow;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  for (const { view } of fixtures.splice(0)) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    view.scene.traverse((node) => { if (node.geometry) geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material) { materials.add(material); if (material.map) textures.add(material.map); }
    });
    geometries.forEach((value) => value.dispose()); materials.forEach((value) => value.dispose()); textures.forEach((value) => value.dispose());
  }
  delete window.__demoNow; vi.restoreAllMocks(); vi.useRealTimers();
});

describe('actual automatic sky refresh render requests', () => {
  it.each([
    { name: 'missing HA location', location: {} },
    { name: 'explicit unavailable location', location: { latitude: null, longitude: null } },
    { name: 'unchanged valid location', location: { latitude: 51.5, longitude: -.1 } },
  ])('keeps hidden bodies visually idle after a minute with $name and unchanged sun', ({ location }) => {
    const f = fixture({ location }); f.card._applySky(false);
    expect(f.view.dirty).toBe(true); expect(f.view._skyOn).toBe(false); expect(f.view.skyBodies).toEqual({ sun: null, moon: null });
    f.view.dirty = false; const before = visualState(f);
    vi.setSystemTime(epoch + 61000); f.card._applySky(false);
    expect(visualState(f)).toEqual(before);
    expect(f.view.dirty).toBe(false);
  });

  it('retains a pending frame and ignores ordinary unrelated readings before the minute boundary', () => {
    const f = fixture(); f.card._applySky(false); f.view.dirty = false; const before = visualState(f);
    for (let index = 0; index < 10; index++) {
      f.card._hass.states = { ...f.card._hass.states, 'sensor.simulated_unrelated': { state: String(index), attributes: {} } };
      f.card._applySky(false);
    }
    expect(f.view.dirty).toBe(false); expect(visualState(f)).toEqual(before);
    f.view.dirty = true; f.card._applySky(false); expect(f.view.dirty).toBe(true);
  });

  it('still honours an explicit forced refresh with hidden bodies', () => {
    const f = fixture(); f.card._applySky(false); f.view.dirty = false; const before = visualState(f);
    f.card._applySky(true);
    expect(f.view.dirty).toBe(true); expect(visualState(f)).toEqual(before);
  });

  it('still updates actual sun and hemisphere lighting when the real sun changes with bodies hidden', () => {
    const f = fixture(); f.card._applySky(false); const before = visualState(f); f.view.dirty = false;
    vi.setSystemTime(epoch + 61000); f.card._hass.states['sun.sun'] = sunState(-20, 270); f.card._applySky(false);
    expect(f.view.dirty).toBe(true); expect(f.view.sun.intensity).toBe(0); expect(f.view.hemi.intensity).toBeLessThan(before.hemi.intensity);
    expect(f.view.sun.position.toArray()).not.toEqual(before.sun.position); expect(f.view.sky.sunDir).not.toEqual(before.sky.sunDir);
    expect(f.view.sun.uuid).toBe(before.sun.uuid); expect(f.view.hemi.uuid).toBe(before.hemi.uuid);
    expect(f.view.skyBodies).toEqual({ sun: null, moon: null }); expect(f.view._skyOn).toBe(false);
    expect(visualState(f).source).toEqual(before.source);
  });

  it('preserves real body creation and removal on explicit configuration transitions', () => {
    const f = fixture({ location: { latitude: 51.5, longitude: -.1 } }); f.card._applySky(false); f.view.dirty = false;
    f.card._config.sky_bodies = true; f.card._applySky(true);
    expect(f.view.dirty).toBe(true); expect(f.view._skyOn).toBe(true); expect(f.view.skySprites.sun.isSprite).toBe(true);
    expect(f.view.skySprites.moon.isSprite).toBe(true); expect(f.view.skySprites.sun.visible).toBe(true); expect(f.view.skyRing.visible).toBe(true);
    const sun = f.view.skySprites.sun, moon = f.view.skySprites.moon, ring = f.view.skyRing;
    f.view.dirty = false; f.card._config.sky_bodies = false; f.card._applySky(true);
    expect(f.view.dirty).toBe(true); expect(f.view._skyOn).toBe(false); expect(sun.visible).toBe(false); expect(moon.visible).toBe(false); expect(ring.visible).toBe(false);
    expect(f.view.skySprites.sun).toBe(sun); expect(f.view.skySprites.moon).toBe(moon); expect(f.view.skyRing).toBe(ring); expect(f.view.moonLight.intensity).toBe(0);
  });

  it('keeps the normal automatic moon movement and redraw when bodies are enabled with valid HA location', () => {
    const f = fixture({ bodies: true, location: { latitude: 51.5, longitude: -.1 } }); f.card._applySky(false);
    const before = visualState(f), sun = f.view.skySprites.sun, moon = f.view.skySprites.moon; f.view.dirty = false;
    vi.setSystemTime(epoch + 61000); f.card._applySky(false);
    expect(f.view.dirty).toBe(true); expect(f.view.skyBodies.moon.dir).not.toEqual(before.bodies.moon.dir);
    expect(f.view.skyBodies.sun).toEqual(before.bodies.sun); expect(f.view.sky).toEqual(before.sky);
    expect(f.view.skySprites.sun).toBe(sun); expect(f.view.skySprites.moon).toBe(moon); expect(visualState(f).source).toEqual(before.source);
  });

  it('removes an old moon immediately when enabled bodies lose their real HA location', () => {
    const f = fixture({ bodies: true, location: { latitude: 0, longitude: 0 } }); f.card._applySky(false);
    expect(f.view.skyBodies.moon).not.toBeNull(); f.view.dirty = false;
    f.card._hass.config = { latitude: null, longitude: null }; f.card._applySky(false);
    expect(f.view.dirty).toBe(true); expect(f.view.skyBodies.moon).toBeNull(); expect(f.view.skySprites.moon.visible).toBe(false);
    expect(f.view.moonLight.intensity).toBe(0); expect(f.view.skyBodies.sun).not.toBeNull();
  });
});
