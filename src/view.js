// Three.js scene for the floorplan: floors, rooms, cut-away walls, DOM markers, light glow.
// Plan (x, y, z) maps to world (x, floorElevation + z, -y) so north is up in top view.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { centroid } from './placement.js';
import { wallSegments } from './layout.js';
import { levelVisible } from './bindings.js';
import { buildManifest, threeAdapter } from './manifest.js';

// Plan rectangle of a world-space box (used for rooms tagged without an outline).
export function fallbackOutline(box) {
  return [[box.min.x, -box.max.z], [box.max.x, -box.max.z], [box.max.x, -box.min.z], [box.min.x, -box.min.z]];
}

const WALL_THICKNESS = 0.12;
const GLOW_RADIUS = 2.2;
const TOOLBAR_PX = 48; // plan is framed below the card's toolbar
const COMPACT_PPM = 30;
const MAX_FRAME_MESH_M = 60; // meshes larger than this are left out when framing the model // pixels per metre below which markers shrink

export function planToWorld(x, y, z, elevation = 0) {
  return new THREE.Vector3(x, elevation + z, -y);
}

let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export class FloorplanView {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.localClippingEnabled = true; // model cut-away
    this.labelRenderer = new CSS2DRenderer();
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.append(this.renderer.domElement, this.labelRenderer.domElement);

    this.persp = new THREE.PerspectiveCamera(35, 1, 0.3, 500);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
    this.ortho.up.set(0, 0, -1); // north up when looking straight down
    this.mode = '3d';
    this.camera = this.persp;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.2);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sun.position.set(-12, 30, 18);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.daylight = true;

    this.staticGroup = new THREE.Group();
    this.markerGroup = new THREE.Group();
    this.glowGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group(); // editor graphics, drawn on top
    this.mowerGroup = new THREE.Group(); // map image + trail
    this.scene.add(this.staticGroup, this.mowerGroup, this.glowGroup, this.markerGroup, this.overlayGroup);
    this.mapPlane = null;
    this.trail = null;
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.model = null; // { id, root, manifest }
    this.modelClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.raycaster = new THREE.Raycaster();

    this.floors = [];
    this.visibleFloor = 'all';
    this._visibleSet = null; // Set of floor ids, null = all
    this._markerStates = null;
    this._modelVisibility = null;
    this._cutOverride = undefined;
    this.cssObjects = []; // { obj, floorId }
    this.markerObjects = new Map(); // id -> { obj, floorId }
    this.glows = new Map(); // id -> { mesh, floorId }
    this.theme = { dark: false };
    this.wallHeight = 1.0;
    this.size = { w: 1, h: 1 };
    this.dirty = true;
    this._raf = null;
    this._makeControls();
  }

  _makeControls() {
    const prevTarget = this.controls && this.controls.target.clone();
    if (this.controls) this.controls.dispose();
    const c = new OrbitControls(this.camera, this.renderer.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.05;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    if (this.mode === 'top') {
      c.enableRotate = false;
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    } else {
      c.maxPolarAngle = Math.PI * 0.47;
      c.maxDistance = 130;
      c.minDistance = this._minDistance || 4;
    }
    c.addEventListener('change', () => { this.dirty = true; });
    c.addEventListener('start', () => { this._tween = null; });
    if (this.controls) c.enabled = this.controls.enabled;
    if (prevTarget) c.target.copy(prevTarget);
    this.controls = c;
  }

  setControlsEnabled(on) {
    this.controls.enabled = on;
  }

  // Plan point [x, y] under a screen position, on the horizontal plane at world height `height`.
  planPoint(clientX, clientY, height) {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), new THREE.Vector3());
    return hit ? [hit.x, -hit.z] : null;
  }

  // Screen position (client px) of a plan point, the inverse of planPoint.
  screenPoint(x, y, z, floorId) {
    const v = planToWorld(x, y, z, this.floorElevation(floorId)).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }

  // Editor overlay. lines: [{points, closed, floorId, color}], fills: [{points, floorId, color, opacity}],
  // handles: [{element, x, y, floorId}] (DOM, CSS2D).
  setOverlay({ lines = [], fills = [], handles = [] } = {}) {
    this._clearGroup(this.overlayGroup);
    this.cssObjects = this.cssObjects.filter((c) => c.kind !== 'handle');
    for (const f of fills) {
      if (f.points.length < 3) continue;
      const geo = new THREE.ShapeGeometry(new THREE.Shape(f.points.map(([x, y]) => new THREE.Vector2(x, y))));
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: f.color, transparent: true, opacity: f.opacity ?? 0.18, depthTest: false, side: THREE.DoubleSide,
      }));
      mesh.position.y = this.floorElevation(f.floorId) + 0.02;
      mesh.renderOrder = 9;
      mesh.userData.floorId = f.floorId;
      this.overlayGroup.add(mesh);
    }
    for (const l of lines) {
      if (l.points.length < 2) continue;
      const pts = l.points.map(([x, y]) => new THREE.Vector3(x, 0, -y));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: l.color, depthTest: false, transparent: true });
      const line = l.closed ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat);
      line.position.y = this.floorElevation(l.floorId) + 0.03;
      line.renderOrder = 10;
      line.userData.floorId = l.floorId;
      this.overlayGroup.add(line);
    }
    for (const h of handles) {
      const obj = new CSS2DObject(h.element);
      obj.position.copy(planToWorld(h.x, h.y, 0.03, this.floorElevation(h.floorId)));
      this.overlayGroup.add(obj);
      this.cssObjects.push({ obj, floorId: h.floorId, kind: 'handle' });
    }
    this._applyFloorVisibility();
    this.dirty = true;
  }

  // GLB underlay. opts: {url} or {id, data: ArrayBuffer | () => Promise<ArrayBuffer>}, plus
  // position: [x, y, z] plan metres, rotation: degrees CCW, scale, opacity.
  // Top-level nodes named "floor:<id>" are shown only with their floor; everything is cut at the
  // selected floor's cut-away height. Same url/id again only re-places the loaded model.
  // Resolves to null or an error message.
  setModel(opts) {
    const id = opts && (opts.id || opts.url);
    if (!id) {
      this._disposeModel();
      return Promise.resolve(null);
    }
    const place = () => {
      const g = this.modelGroup;
      const [x, y, z] = opts.position || [0, 0, 0];
      g.position.set(Number(x) || 0, Number(z) || 0, -(Number(y) || 0));
      g.rotation.y = ((opts.rotation || 0) * Math.PI) / 180;
      g.scale.setScalar(opts.scale || 1);
      const opacity = opts.opacity ?? 1;
      if (this.model) {
        this.model.root.traverse((o) => {
          if (!o.isMesh) return;
          for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
            mat.transparent = opacity < 1 || mat.userData.wasTransparent;
            mat.opacity = opacity < 1 ? opacity : mat.userData.baseOpacity;
            mat.depthWrite = opacity >= 1;
            mat.needsUpdate = true;
          }
        });
      }
      if (this.model && this.daylight) this._fitShadow();
      this.renderer.shadowMap.needsUpdate = true;
      this._applyFloorVisibility();
      this.dirty = true;
    };
    if (this.model && this.model.id === id) {
      place();
      return Promise.resolve(null);
    }
    if (this._modelId === id) return this._modelLoading; // already on its way
    this._disposeModel();
    this._modelId = id;
    const label = opts.name || opts.url || 'model';
    this._modelLoading = new Promise((resolve) => {
      const fail = (err) => {
        console.warn('floorplan3d: could not load model', label, err);
        if (this._modelId === id) this._modelId = null;
        resolve(`Could not load model ${label}`);
      };
      const onLoad = (gltf) => {
        if (this._modelId !== id) return resolve(null);
        const root = gltf.scene;
        const manifest = buildManifest(threeAdapter(root));
        // legacy levels without order/elevation stack bottom-up by their lowest point
        for (const l of manifest.levels) {
          const lb = new THREE.Box3().setFromObject(l.node);
          l.minY = lb.isEmpty() ? 0 : lb.min.y; // set for every level
        }
        // rooms tagged without an outline: use their footprint (root is not placed yet, so world = model space)
        root.updateMatrixWorld(true);
        for (const r of manifest.rooms) {
          if (r.outline) continue;
          const box = new THREE.Box3().setFromObject(r.node);
          if (box.isEmpty()) continue;
          r.outline = fallbackOutline(box);
          r.outlineFallback = true;
        }
        root.traverse((o) => {
          if (!o.isMesh) return;
          for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
            mat.clippingPlanes = [this.modelClip];
            mat.clipShadows = true;
            mat.userData.baseOpacity = mat.opacity;
            mat.userData.wasTransparent = mat.transparent;
          }
        });
        this._modelVisibility = null;
        this.model = { id, root, manifest };
        this.modelGroup.add(root);
        root.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
        this._applyLook();
        place();
        resolve(null);
      };
      const loader = new GLTFLoader();
      if (opts.url) loader.load(opts.url, onLoad, undefined, fail);
      else {
        Promise.resolve(typeof opts.data === 'function' ? opts.data() : opts.data)
          .then((buf) => loader.parse(buf, '', onLoad, fail))
          .catch(fail);
      }
    });
    return this._modelLoading;
  }

  modelManifest() {
    return this.model ? this.model.manifest : null;
  }

  // level id -> { show, floor } from the card's bindings
  setModelLevels(assign) {
    this.modelLevels = assign || {};
    this._applyFloorVisibility();
    this.dirty = true;
  }

  // The tagged part under a screen point: nearest tagged ancestor of the first visible hit below
  // the cut; untagged meshes come back as { kind: 'untagged' } so the UI can say so.
  pickModel(clientX, clientY) {
    if (!this.model) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const hit = this.raycaster.intersectObject(this.model.root, true)
      .find((h) => h.object.isMesh && shown(h.object) && h.point.y <= this.modelClip.constant + 1e-6);
    if (!hit) return null;
    const hitInfo = { point: hit.point.toArray(), object: hit.object };
    const owner = this.model.manifest.ownerOf(hit.object);
    if (owner) return { ...owner, hit: hitInfo };
    const names = [];
    for (let p = hit.object; p && p !== this.model.root; p = p.parent) names.unshift((p.userData && p.userData.name) || p.name || '?');
    return { kind: 'untagged', node: hit.object, path: names.join('/'), hit: hitInfo };
  }

  highlightModelNode(node) {
    if (this.pickHelper) {
      this.scene.remove(this.pickHelper);
      this.pickHelper.geometry.dispose();
      this.pickHelper.material.dispose();
      this.pickHelper = null;
    }
    if (node) {
      this.pickHelper = new THREE.BoxHelper(node, this.theme.primary || 0x03a9f4);
      this.pickHelper.material.depthTest = false;
      this.pickHelper.renderOrder = 11;
      this.scene.add(this.pickHelper);
    }
    this.dirty = true;
  }

  _disposeModel() {
    this._modelId = null;
    this._modelVisibility = null;
    if (!this.model) return;
    this.highlightModelNode(null);
    this._clearGroup(this.modelGroup);
    this.model = null;
    this._applyLook();
    this.dirty = true;
  }

  setDaylight(day) {
    this.daylight = !!day;
    this._applyLook();
  }

  // Renderer, light and shadow settings for model / no model and day / night.
  _applyLook() {
    const r = this.renderer, day = this.model ? this.daylight : true, sun = this.sun, hemi = this.hemi;
    if (this.model) {
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.25;
      r.shadowMap.enabled = true;
      r.shadowMap.autoUpdate = false; // re-rendered on demand (needsUpdate), not every frame
      r.shadowMap.needsUpdate = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      hemi.color.setHex(day ? 0xcfdcff : 0x6f86c6);
      hemi.groundColor.setHex(day ? 0x7a6248 : 0x2a2622);
      hemi.intensity = day ? 1.1 : 1.4;
      // night: the sun doubles as moonlight (no shadows) until lamps cast real light
      sun.color.setHex(day ? 0xffffff : 0xa8bcff);
      sun.intensity = day ? 2.6 : 0.9;
      sun.castShadow = day;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0005;
      this._fitShadow();
    } else {
      r.toneMapping = THREE.NoToneMapping;
      r.toneMappingExposure = 1;
      r.shadowMap.enabled = false;
      hemi.color.setHex(0xffffff);
      hemi.groundColor.setHex(0x8a8a8a);
      hemi.intensity = day ? 2.2 : 0.6;
      sun.color.setHex(0xffffff);
      sun.intensity = day ? 1.4 : 0;
      sun.castShadow = false;
      sun.position.set(-12, 30, 18);
      sun.target.position.set(0, 0, 0);
    }
    // toneMapping / shadowMap changes need the shaders rebuilt
    this.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
    this.dirty = true;
  }

  // Fit the sun's shadow camera to the placed model.
  _fitShadow() {
    if (!this.model) return;
    const sun = this.sun;
    this.modelGroup.updateMatrixWorld(true);
    // ignore giant meshes (ground planes, roads): they would blow the shadow camera up
    let box = new THREE.Box3();
    this.model.root.traverse((o) => {
      if (!o.isMesh) return;
      const b = new THREE.Box3().setFromObject(o);
      if (Math.max(b.max.x - b.min.x, b.max.z - b.min.z) <= MAX_FRAME_MESH_M) box.union(b);
    });
    if (box.isEmpty()) box = new THREE.Box3().setFromObject(this.modelGroup);
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(new THREE.Vector3(-0.4, 1, 0.35).normalize(), radius * 2.5);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -radius * 1.1;
    cam.right = cam.top = radius * 1.1;
    cam.near = 0.5;
    cam.far = radius * 5;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  // True when the model's levels come from tags (extras / names), not the legacy heuristic.
  isTagged() {
    return !!this.model && this.model.manifest.levels.some((l) => l.source === 'extras' || l.source === 'name');
  }

  // Mower map image laid on the floor. o: {url, x, y, rotation, width, opacity, floorId} or null.
  // x, y = image centre in plan metres, rotation in degrees counter-clockwise, top of image = north.
  setMapOverlay(o) {
    if (!o || !o.url) {
      if (this.mapPlane) {
        this.mowerGroup.remove(this.mapPlane);
        this.mapPlane.geometry.dispose();
        if (this.mapPlane.material.map) this.mapPlane.material.map.dispose();
        this.mapPlane.material.dispose();
        this.mapPlane = null;
        this.dirty = true;
      }
      return;
    }
    if (!this.mapPlane) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      this.mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
      this.mapPlane.renderOrder = 1;
      this.mapPlane.visible = false; // until the first image arrives
      this.mowerGroup.add(this.mapPlane);
    }
    const plane = this.mapPlane;
    plane.userData.floorId = o.floorId;
    plane.position.copy(planToWorld(o.x || 0, o.y || 0, 0.015, this.floorElevation(o.floorId)));
    plane.rotation.y = ((o.rotation || 0) * Math.PI) / 180;
    plane.material.opacity = o.opacity ?? 0.6;
    const aspect = plane.userData.aspect || 1;
    const w = o.width || 20;
    plane.scale.set(w, 1, w * aspect);
    if (plane.userData.url !== o.url) {
      plane.userData.url = o.url;
      // swap textures only once the new image has loaded, so camera refreshes don't flicker
      new THREE.TextureLoader().load(o.url, (tex) => {
        if (plane.userData.url !== o.url || this.mapPlane !== plane) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        const old = plane.material.map;
        plane.material.map = tex;
        plane.material.needsUpdate = true;
        if (old) old.dispose();
        plane.userData.aspect = tex.image.height / tex.image.width;
        plane.scale.set(w, 1, w * plane.userData.aspect);
        plane.visible = this._shows(o.floorId);
        this.dirty = true;
      }, undefined, () => console.warn('floorplan3d: could not load mower map', o.url));
    }
    if (plane.material.map) plane.visible = this._shows(o.floorId);
    this.dirty = true;
  }

  // Mower trail: plan points [[x, y], ...] on one floor, or null.
  setTrail(points, floorId) {
    if (this.trail) {
      this.mowerGroup.remove(this.trail);
      this.trail.geometry.dispose();
      this.trail.material.dispose();
      this.trail = null;
    }
    if (points && points.length > 1) {
      const geo = new THREE.BufferGeometry().setFromPoints(points.map(([x, y]) => new THREE.Vector3(x, 0, -y)));
      const color = this.theme.primary || 0x03a9f4;
      this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false }));
      this.trail.position.y = this.floorElevation(floorId) + 0.04;
      this.trail.renderOrder = 3;
      this.trail.userData.floorId = floorId;
      this.trail.visible = this._shows(floorId);
      this.mowerGroup.add(this.trail);
    }
    this.dirty = true;
  }

  // Move one handle without rebuilding the overlay (vertex drag).
  moveHandle(element, x, y, floorId) {
    const c = this.cssObjects.find((o) => o.kind === 'handle' && o.obj.element === element);
    if (c) c.obj.position.copy(planToWorld(x, y, 0.03, this.floorElevation(floorId)));
    this.dirty = true;
  }

  moveMarker(id, x, y, z, floorId) {
    const m = this.markerObjects.get(id);
    if (!m) return;
    m.obj.position.copy(planToWorld(x, y, z, this.floorElevation(floorId)));
    const g = this.glows.get(id);
    if (g) g.mesh.position.copy(planToWorld(x, y, 0.03, this.floorElevation(floorId)));
    this.dirty = true;
  }

  setTheme(theme) {
    this.theme = theme;
    this._applyLook();
    for (const g of this.glows.values()) {
      g.mesh.material.blending = theme.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      g.mesh.material.needsUpdate = true;
    }
    this.dirty = true;
  }

  // floors: [{id, elevation, height}], rooms: [{room, floorId, label}]
  setStructure(floors, rooms, { wallHeight = 1.0, walls = true, fills = true, outlines = true, labels = true } = {}) {
    this.floors = floors;
    this._rooms = rooms;
    this.wallHeight = wallHeight;
    this._clearGroup(this.staticGroup);
    this.cssObjects = this.cssObjects.filter((c) => c.kind !== 'label');
    const t = this.theme;
    // polygon offset: room floors win over a GLB model's slab at the same height (no z-fighting)
    const offset = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    const floorMat = new THREE.MeshLambertMaterial({ color: t.floor, side: THREE.DoubleSide, ...offset });
    const outdoorMat = new THREE.MeshLambertMaterial({ color: t.outdoor, side: THREE.DoubleSide, transparent: true, opacity: 0.7, ...offset });
    const wallMat = new THREE.MeshLambertMaterial({ color: t.wall });
    const edgeMat = new THREE.LineBasicMaterial({ color: t.edge });

    for (const f of floors) {
      const group = new THREE.Group();
      group.userData.floorId = f.id;
      group.position.y = f.elevation;
      const own = rooms.filter((r) => r.floorId === f.id);
      for (const { room, label } of own) {
        if (!room.polygon || room.polygon.length < 3) continue;
        const shape = new THREE.Shape(room.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
        if (fills) {
          const geo = new THREE.ShapeGeometry(shape);
          geo.rotateX(-Math.PI / 2);
          const mesh = new THREE.Mesh(geo, room.outdoor ? outdoorMat : floorMat);
          mesh.position.y = room.outdoor ? -0.01 : 0;
          mesh.userData.roomId = room.id;
          group.add(mesh);
        }
        if (outlines) {
          const outline = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(room.polygon.map(([x, y]) => new THREE.Vector3(x, 0.005, -y))),
            edgeMat,
          );
          group.add(outline);
        }
        if (label && labels) {
          const el = document.createElement('div');
          el.className = 'fp-room-label' + (room.outdoor ? ' outdoor' : '');
          el.textContent = label;
          const obj = new CSS2DObject(el);
          const [cx, cy] = centroid(room.polygon);
          obj.position.set(cx, 0.02, -cy);
          obj.center.set(0.5, 0.5);
          group.add(obj);
          this.cssObjects.push({ obj, floorId: f.id, kind: 'label' });
        }
      }
      for (const w of walls ? wallSegments(own.map((r) => r.room)) : []) {
        const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
        const len = Math.hypot(dx, dy);
        const box = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_THICKNESS, wallHeight, WALL_THICKNESS), wallMat);
        box.position.set((w.a[0] + w.b[0]) / 2, wallHeight / 2, -(w.a[1] + w.b[1]) / 2);
        box.rotation.y = Math.atan2(dy, dx);
        group.add(box);
      }
      this.staticGroup.add(group);
    }
    this._applyFloorVisibility();
    this.dirty = true;
  }

  // markers: [{id, element, x, y, z, floorId}]
  setMarkers(markers) {
    for (const { obj } of this.markerObjects.values()) this._removeCss(obj);
    this.markerObjects.clear();
    this.cssObjects = this.cssObjects.filter((c) => c.kind !== 'marker');
    for (const m of markers) {
      const obj = new CSS2DObject(m.element);
      obj.position.copy(planToWorld(m.x, m.y, m.z, this.floorElevation(m.floorId)));
      this.markerGroup.add(obj);
      this.markerObjects.set(m.id, { obj, floorId: m.floorId });
      this.cssObjects.push({ obj, floorId: m.floorId, kind: 'marker', id: m.id });
    }
    this._applyFloorVisibility();
    this.dirty = true;
  }

  // glows: [{id, x, y, floorId, rgb, strength}] (lights that are on)
  setGlows(glows) {
    const seen = new Set();
    for (const g of glows) {
      seen.add(g.id);
      let entry = this.glows.get(g.id);
      if (!entry) {
        const mat = new THREE.MeshBasicMaterial({
          map: getGlowTexture(), transparent: true, depthWrite: false, toneMapped: false,
          blending: this.theme.dark ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
        mesh.renderOrder = 2;
        this.glowGroup.add(mesh);
        entry = { mesh, floorId: g.floorId };
        this.glows.set(g.id, entry);
      }
      entry.floorId = g.floorId;
      const { mesh } = entry;
      mesh.position.copy(planToWorld(g.x, g.y, 0.03, this.floorElevation(g.floorId)));
      const r = GLOW_RADIUS * (0.6 + 0.4 * g.strength) * 2;
      mesh.scale.set(r, 1, r);
      mesh.material.color.setRGB(g.rgb[0] / 255, g.rgb[1] / 255, g.rgb[2] / 255, THREE.SRGBColorSpace);
      mesh.material.opacity = (this.theme.dark ? 0.75 : 0.55) * g.strength;
    }
    for (const [id, entry] of this.glows) {
      if (seen.has(id)) continue;
      this.glowGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
      this.glows.delete(id);
    }
    this._applyFloorVisibility();
    this.dirty = true;
  }

  setVisibleFloor(id) {
    this.setVisibleFloors(id === 'all' ? 'all' : [id]);
  }

  // ids: floor id array or 'all'. [] means 'none': all floor-bound markers/groups are hidden
  // (callers then set model flags + setCut). visibleFloor keeps the first id (or 'all') for existing callers.
  setVisibleFloors(ids) {
    const list = ids === 'all' || !Array.isArray(ids) ? null : ids;
    this._visibleSet = list ? new Set(list) : null;
    this.visibleFloor = list ? (list.length ? list[0] : 'none') : 'all';
    this._applyFloorVisibility();
    this.dirty = true;
  }

  // flags[i] -> index.nodes[i].node.visible; null returns to the level rules.
  applyModelVisibility(index, flags) {
    this._restoreModelVisibility();
    if (flags && index) {
      index.nodes.forEach((n, i) => { n.node.visible = !!flags[i]; });
      this._modelVisibility = { index, flags };
    } else {
      this._modelVisibility = null;
    }
    this._applyFloorVisibility();
    this.dirty = true;
  }

  // Set every node of the previously flagged index visible again.
  _restoreModelVisibility() {
    if (this._modelVisibility) for (const n of this._modelVisibility.index.nodes) n.node.visible = true;
    this._modelVisibility = null;
  }

  // states: Map<markerId, {shown, faded}> or null (floor visibility rules). A marker (or glow)
  // whose id is missing from the map follows the floor rules.
  setMarkerStates(states) {
    this._markerStates = states || null;
    this._applyFloorVisibility();
    this.dirty = true;
  }

  // Clip height override (metres, world); null = no cut; undefined = automatic.
  setCut(height) {
    this._cutOverride = height;
    this._applyFloorVisibility();
    this.dirty = true;
  }

  getCamera() {
    if (this.mode === 'top' && this._lastCam3d) return this._lastCam3d;
    const r = (a) => a.toArray().map((x) => Math.round(x * 100) / 100);
    return { position: r(this.persp.position), target: r(this.controls.target) };
  }

  setCamera(cam, { instant = false } = {}) {
    if (this.mode !== '3d' || !cam) return;
    const pos = new THREE.Vector3(...cam.position), target = new THREE.Vector3(...cam.target);
    // saved cameras must not be clamped by the zoom limits; relaxed until the next fit()
    const d = pos.distanceTo(target);
    this.controls.minDistance = Math.min(this.controls.minDistance, d);
    this.controls.maxDistance = Math.max(this.controls.maxDistance, d);
    this._moveCamera(pos, target, instant);
  }

  // cam: {position, target} or null for the default framing.
  resetCamera(cam) {
    if (cam) this.setCamera(cam);
    else this.fit();
  }

  _moveCamera(pos, target, instant) {
    if (instant || !this._framed) {
      this._tween = null;
      this.persp.position.copy(pos);
      this.persp.lookAt(target);
      this._framed = true;
      this.controls.target.copy(target);
      this.controls.update();
    } else {
      this._tween = { t0: performance.now(), from: { pos: this.persp.position.clone(), target: this.controls.target.clone() }, to: { pos, target } };
    }
    this.dirty = true;
  }

  // World-space triangle vertices of a mesh (flat x,y,z list).
  meshTriangles(mesh) {
    const g = mesh.geometry;
    if (!g || !g.attributes.position) return [];
    mesh.updateWorldMatrix(true, false);
    const pos = g.attributes.position, idx = g.index, out = [], v = new THREE.Vector3();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
    return out;
  }

  // Plan-space bounding rectangle of a mesh (fallback when its floor cannot be traced).
  meshPlanRect(mesh) {
    const b = new THREE.Box3().setFromObject(mesh);
    const x0 = b.min.x, x1 = b.max.x, y0 = -b.max.z, y1 = -b.min.z;
    const r = (v) => Math.round(v / 0.05) * 0.05;
    return [[r(x0), r(y0)], [r(x1), r(y0)], [r(x1), r(y1)], [r(x0), r(y1)]].map((q) => q.map((v) => Math.round(v * 1000) / 1000));
  }

  floorElevation(floorId) {
    const f = this.floors.find((x) => x.id === floorId);
    return f ? f.elevation : 0;
  }

  _shows(floorId) {
    return this._visibleSet ? this._visibleSet.has(floorId) : this.visibleFloor === 'all' || this.visibleFloor === floorId;
  }

  _applyFloorVisibility() {
    for (const g of this.staticGroup.children) g.visible = this._shows(g.userData.floorId);
    // markers live in one group for all floors, so visibility is set per object
    const ms = this._markerStates;
    const stateOf = (id) => (ms && id !== undefined ? ms.get(id) : null);
    for (const c of this.cssObjects) {
      const st = c.kind === 'marker' ? stateOf(c.id) : null;
      c.obj.visible = st ? !!st.shown : this._shows(c.floorId);
    }
    for (const [id, g] of this.glows) {
      const st = stateOf(id);
      g.mesh.visible = st ? !!st.shown : this._shows(g.floorId);
    }
    for (const o of this.overlayGroup.children) if (!o.isCSS2DObject) o.visible = this._shows(o.userData.floorId);
    if (this.trail) this.trail.visible = this._shows(this.trail.userData.floorId);
    if (this.model) {
      const assign = this.modelLevels || {};
      if (!this._modelVisibility) {
        for (const l of this.model.manifest.levels) l.node.visible = levelVisible(assign[l.id], this.visibleFloor, (id) => this.floors.find((f) => f.id === id)?.elevation);
      }
      // everything above the cut-away height of the selected floor is clipped (roof, upper floors)
      const cut = this.visibleFloor === 'all' || this.isTagged() ? 1e6 : this.floorElevation(this.visibleFloor) + Math.max(this.wallHeight, 0.3);
      this.modelClip.constant = this._cutOverride === undefined ? cut : (this._cutOverride ?? 1e6);
      if (this.pickHelper) this.pickHelper.update();
      this.renderer.shadowMap.needsUpdate = true;
    }
    // "top" = the highest floor that actually has markers (an empty attic must not fade everything)
    let top = null, topElev = -Infinity;
    for (const c of this.cssObjects) {
      if (c.kind !== 'marker') continue;
      const e = this.floorElevation(c.floorId);
      if (e > topElev) { topElev = e; top = c.floorId; }
    }
    for (const c of this.cssObjects) {
      if (c.kind !== 'marker') continue;
      const st = stateOf(c.id);
      c.obj.element.classList.toggle('fp-faded', st ? !!st.faded : !!this.model && this.visibleFloor === 'all' && c.floorId !== top);
    }
    if (this.mapPlane && this.mapPlane.material.map) this.mapPlane.visible = this._shows(this.mapPlane.userData.floorId);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (this.mode === '3d') this._lastCam3d = this.getCamera();
    this.mode = mode;
    this.camera = mode === 'top' ? this.ortho : this.persp;
    this._makeControls();
    this.fit();
  }

  // Frame the rooms of the visible floor(s); the model when there are no rooms (or asked to).
  fit({ model = false, instant = false } = {}) {
    const box = new THREE.Box3();
    if (!model) {
      // rooms as data (independent of fills/outlines/walls flags), on the visible floors
      for (const { room, floorId } of this._rooms || []) {
        if (!this._shows(floorId) || !room.polygon || room.polygon.length < 3) continue;
        const f = this.floors.find((x) => x.id === floorId);
        const y0 = f ? f.elevation : 0, y1 = y0 + ((f && f.height) || 2.7);
        for (const [x, y] of room.polygon) {
          box.expandByPoint(new THREE.Vector3(x, y0, -y));
          box.expandByPoint(new THREE.Vector3(x, y1, -y));
        }
      }
    }
    if (box.isEmpty() && this.model) {
      // only the parts currently shown, and not above the cut
      this.modelGroup.updateMatrixWorld(true);
      this.model.root.traverse((o) => {
        if (!o.isMesh) return;
        for (let p = o; p; p = p.parent) if (!p.visible) return;
        const b = new THREE.Box3().setFromObject(o);
        // a world ground plane or a long road would frame the whole neighbourhood
        if (Math.max(b.max.x - b.min.x, b.max.z - b.min.z) > MAX_FRAME_MESH_M) return;
        b.max.y = Math.min(b.max.y, this.modelClip.constant);
        if (b.min.y <= b.max.y) box.union(b);
      });
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 0, 5));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const aspect = this.size.w / this.size.h;
    const target = center.clone();
    this._minDistance = Math.max(size.x, size.z) < 10 ? 1 : 4;
    if (this.mode === '3d') { this.controls.minDistance = this._minDistance; this.controls.maxDistance = 130; }
    if (this.visibleFloor !== 'all') target.y = this.floorElevation(this.visibleFloor);

    if (this.mode === 'top') {
      const { h } = this.size;
      const half = Math.max(size.z / 2, size.x / 2 / aspect) * 1.08 * ((h + TOOLBAR_PX) / Math.max(h - TOOLBAR_PX, 1));
      this._tween = null;
      this._orthoHalf = half;
      this._updateOrtho();
      this.ortho.zoom = 1;
      this.ortho.position.set(target.x, target.y + 60, target.z);
      this.ortho.lookAt(target);
      this.ortho.updateProjectionMatrix();
    } else {
      const dir = this.model
        ? new THREE.Vector3(0.42, 0.616, 0.69).normalize() // 3/4 view
        : new THREE.Vector3(0.18, 0.95, 0.75).normalize(); // from the south, high up
      const corners = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      // start far, then shrink until the projected corners fill ~85 % of the view
      let dist = Math.max(size.x, size.z, 4) * 3;
      for (let i = 0; i < 6; i++) {
        this.persp.position.copy(target).addScaledVector(dir, dist);
        this.persp.lookAt(target);
        this.persp.updateMatrixWorld();
        let extent = 0;
        for (const c of corners) {
          const p = c.clone().project(this.persp);
          extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
        }
        dist *= extent / 0.85;
      }
      const to = { pos: target.clone().addScaledVector(dir, dist), target: target.clone() };
      this._moveCamera(to.pos, to.target, instant);
      return;
    }
    this.controls.target.copy(target);
    this.controls.update();
    this.dirty = true;
  }

  _stepTween(now) {
    const tw = this._tween;
    const t = Math.min(1, (now - tw.t0) / 400);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.persp.position.lerpVectors(tw.from.pos, tw.to.pos, e);
    this.controls.target.lerpVectors(tw.from.target, tw.to.target, e);
    this.controls.update();
    this.dirty = true;
    if (t === 1) this._tween = null;
  }

  _updateOrtho() {
    const half = this._orthoHalf || 10;
    const { w, h } = this.size;
    const aspect = w / (h + TOOLBAR_PX);
    Object.assign(this.ortho, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    this.ortho.setViewOffset(w, h + TOOLBAR_PX, 0, 0, w, h);
  }

  // Screen pixels per plan metre at the orbit target.
  pixelsPerMetre() {
    const { h } = this.size;
    if (this.mode === 'top') return (h * this.ortho.zoom) / (this.ortho.top - this.ortho.bottom);
    const dist = this.persp.position.distanceTo(this.controls.target);
    return h / (2 * dist * Math.tan((this.persp.fov * Math.PI) / 360));
  }

  resize(w, h) {
    if (!w || !h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    // render the top part of a taller view, so the scene centre sits below the toolbar
    this.persp.aspect = w / (h + TOOLBAR_PX);
    this.persp.setViewOffset(w, h + TOOLBAR_PX, 0, 0, w, h);
    this._updateOrtho();
    this.dirty = true;
  }

  start() {
    if (this._raf) return;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      if (this._tween) this._stepTween(performance.now());
      this.controls.update();
      if (!this.dirty) return;
      this.dirty = false;
      this.labelRenderer.domElement.classList.toggle('compact', this.pixelsPerMetre() < COMPACT_PPM);
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _removeCss(obj) {
    if (obj.parent) obj.parent.remove(obj);
    // removing the object does not reliably remove its DOM element
    if (obj.element && obj.element.parentNode) obj.element.parentNode.removeChild(obj.element);
  }

  _clearGroup(group) {
    group.traverse((o) => {
      if (o.isCSS2DObject && o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    group.clear();
  }

  dispose() {
    this.stop();
    this.controls.dispose();
    this._clearGroup(this.staticGroup);
    this._clearGroup(this.markerGroup);
    this._clearGroup(this.glowGroup);
    this._clearGroup(this.overlayGroup);
    this._disposeModel();
    this.setMapOverlay(null);
    this.setTrail(null);
    this.markerObjects.clear();
    this.glows.clear();
    this.cssObjects = [];
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
