// Three.js scene for the floorplan: floors, rooms, cut-away walls, DOM markers, light glow.
// Plan (x, y, z) maps to world (x, floorElevation + z, -y) so north is up in top view.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { centroid } from './placement.js';
import { wallSegments } from './layout.js';
import { levelVisible, measuredElevations } from './bindings.js';
import { buildManifest, threeAdapter } from './manifest.js';
import { sectionLevels, unionBox, pivotCamera, rayPlaneY, orthoZoom, topZoom } from './views.js';
import {
  castsShadow, shadowInfo, isCoplanarOverlay, depthRange, depthChanged, isOccluded, sunDirection, ghostMaterial, pickable,
} from './render-rules.js';

const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap'];

// Plan rectangle of a world-space box (used for rooms tagged without an outline).
export function fallbackOutline(box) {
  return [[box.min.x, -box.max.z], [box.max.x, -box.max.z], [box.max.x, -box.min.z], [box.min.x, -box.min.z]];
}

const WALL_THICKNESS = 0.12;
const GLOW_RADIUS = 2.2;
const TOOLBAR_PX = 48; // plan is framed below the card's toolbar
const COMPACT_PPM = 30;
const MAX_FRAME_MESH_M = 60; // meshes larger than this are left out when framing the model
const SHADOW_MESH_M = 30; // untagged models: meshes up to this size make the sun's shadow box
const SHADOW_MARGIN_M = 4;
const OCCLUSION_DELAY_MS = 150; // camera still this long -> occlusion pass
const OCCLUSION_MAX = 300; // markers per pass
const OCCLUSION_SLICE_MS = 8; // a pass yields (setTimeout) after this long
const PICK_LINE_M = 0.02; // raycast threshold for lines / points (three's default is 1 m)

// fp.north (degrees) on the model root or its two top levels, else null
function northOf(root) {
  const q = [[root, 0]];
  while (q.length) {
    const [o, d] = q.shift();
    const n = o.userData && o.userData.fp && o.userData.fp.north;
    if (Number.isFinite(n)) return n;
    if (d < 2) for (const c of o.children) q.push([c, d + 1]);
  }
  return null;
}

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
    this.sky = { night: 0, sunDir: null };

    this.staticGroup = new THREE.Group();
    this.markerGroup = new THREE.Group();
    this.glowGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group(); // editor graphics, drawn on top
    this.mowerGroup = new THREE.Group(); // map image + trail
    this.stemGroup = new THREE.Group(); // edit mode: marker -> floor stems
    this.scene.add(this.staticGroup, this.mowerGroup, this.glowGroup, this.markerGroup, this.overlayGroup, this.stemGroup);
    this.stems = new Map(); // id -> { line, disc }
    this._stemsOn = false;
    this._stemRes = null; // shared geometries + materials of the current stems
    this.mapPlane = null;
    this.trail = null;
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.objectsGroup = new THREE.Group(); // model objects: the real light pool and spot targets
    this.scene.add(this.objectsGroup);
    this.objectLayer = null; // ObjectLayer (registers itself); reset when the model goes
    this.onObjectsInvalidate = null; // called when model placement or visibility changed
    this.model = null; // { id, root, manifest }
    this.modelClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.sectionClip = null; // side section: global clipping plane (card world) or null
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = PICK_LINE_M;
    this.raycaster.params.Points.threshold = PICK_LINE_M;
    this._occRay = new THREE.Raycaster();
    this._occlusion = true; // dim markers behind model walls
    this._occTimer = null;
    this._occBoxes = null; // [{ mesh, box }] world boxes of occluding model meshes (cached per placement)
    this._bounds = null; // { house: Box3, centre: Vector3, radius } for the depth range
    this._occGen = 0; // occlusion pass generation (a new schedule cancels running slices)
    this._occFull = false; // a full pass is pending or running
    this._occIds = null; // marker ids waiting for a partial pass (live mower)
    this._occSig = null; // inputs of the last occlusion pass (shown markers, model visibility, cut, section)
    this._shadowSig = null; // inputs of the last shadow map render (model visibility, cut, section)
    this.stats = { occPasses: 0, occPartial: 0, shadow: 0 }; // counters for the headless checks
    this._depth = null;

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
    this._zoomTo = 'center'; // zoom pivot: 'center' (controls target) or 'cursor'
    this.pivotMarker = null; // edit mode: small cross at the rotation centre
    this._onWheel = () => { this.dirty = true; };
    this.renderer.domElement.addEventListener('wheel', this._onWheel, { passive: true });
    this._makeControls();
  }

  _makeControls() {
    const prevTarget = this.controls && this.controls.target.clone();
    if (this.controls) this.controls.dispose();
    const c = new OrbitControls(this.camera, this.renderer.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.05;
    c.screenSpacePanning = true;
    c.zoomToCursor = this._zoomTo === 'cursor';
    if (this.mode === 'top') {
      c.enableRotate = false;
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    } else {
      c.maxPolarAngle = Math.PI * 0.47;
      c.maxDistance = 130;
      c.minDistance = this._minDistance || 4;
    }
    c.addEventListener('change', () => {
      this.dirty = true;
      this._camMovedAt = performance.now();
      this._scheduleOcclusion();
    });
    c.addEventListener('start', () => { this._tween = null; });
    if (this.controls) c.enabled = this.controls.enabled;
    if (prevTarget) c.target.copy(prevTarget);
    this.controls = c;
  }

  // Zoom pivot: 'cursor' zooms towards the pointer, 'center' (default) zooms and rotates around the target.
  setZoomTo(mode) {
    this._zoomTo = mode === 'cursor' ? 'cursor' : 'center';
    this.controls.zoomToCursor = this._zoomTo === 'cursor';
  }

  // Rotation centre under a screen point: the model surface, else the horizontal plane at height y.
  pivotPoint(clientX, clientY, y = 0) {
    const pick = this.pickModel(clientX, clientY);
    if (pick && pick.hit) return pick.hit.point;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    return rayPlaneY(origin.toArray(), direction.toArray(), y);
  }

  // Move the rotation centre to a world point; the camera keeps its angle and distance (tweened).
  // Returns the new camera { position, target }.
  setPivot(point) {
    if (this.mode !== '3d' || !point) return null;
    const cam = pivotCamera(this.getCamera(), point);
    this.setCamera(cam);
    return cam;
  }

  // Edit mode: show the rotation centre as a small cross (three short lines, primary colour).
  setPivotMarker(on) {
    if (!on) {
      if (this.pivotMarker) {
        this.scene.remove(this.pivotMarker);
        this.pivotMarker.geometry.dispose();
        this.pivotMarker.material.dispose();
        this.pivotMarker = null;
        this.dirty = true;
      }
      return;
    }
    if (this.pivotMarker) return;
    const L = 0.25;
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-L, 0, 0, L, 0, 0, 0, -L, 0, 0, L, 0, 0, 0, -L, 0, 0, L], 3));
    const m = new THREE.LineBasicMaterial({ color: this.theme.primary || 0x03a9f4, depthTest: false, transparent: true });
    this.pivotMarker = new THREE.LineSegments(g, m);
    this.pivotMarker.renderOrder = 12;
    this.pivotMarker.userData.helper = true;
    this.pivotMarker.position.copy(this.controls.target);
    this.scene.add(this.pivotMarker);
    this.dirty = true;
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
      mesh.userData.helper = true;
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
      line.userData.helper = true;
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
        // ghosted: blended but depth writes kept, so overlapping parts do not vanish; glass untouched
        this.model.root.traverse((o) => {
          if (!o.isMesh) return;
          for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
            const g = ghostMaterial(mat.userData, opacity);
            if (!g) continue;
            if (mat.alphaHash !== g.alphaHash || mat.transparent !== g.transparent) mat.needsUpdate = true;
            Object.assign(mat, g);
          }
        });
        this.model.opacity = opacity;
        this._occBoxes = null; // placement changed
        this._bounds = this._sceneBounds();
      }
      if (this.model) this._fitShadow();
      this._shadowDirty();
      this._applyFloorVisibility();
      this._scheduleOcclusion(0);
      this._objectsInvalid();
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
        // tagged models are never cut: no clipping plane (and no extra shader variant) at all
        const tagged = manifest.levels.some((l) => l.source === 'extras' || l.source === 'name');
        // heights a flat sheet can lie on: level floors, the terrain / floor layers, the model bottom
        const floorYs = [0];
        for (const l of manifest.levels) if (Number.isFinite(l.elevation)) floorYs.push(l.elevation);
        for (const m of Object.values(measuredElevations(manifest.levels))) floorYs.push(m.elevation);
        const all = new THREE.Box3();
        root.traverse((o) => {
          if (!o.isMesh) return;
          const b = new THREE.Box3().setFromObject(o);
          all.union(b);
          if (shadowInfo(o).layers.some((l) => /^(terrain|floor)$/i.test(l))) floorYs.push(b.max.y);
        });
        if (!all.isEmpty()) floorYs.push(all.min.y);
        const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        root.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) {
            if (!tagged) {
              mat.clippingPlanes = [this.modelClip];
              mat.clipShadows = true;
            }
            mat.userData.baseOpacity = mat.opacity;
            mat.userData.wasTransparent = mat.transparent;
            // glTF does not store anisotropic filtering: without it floor boards and tiles blur at grazing angles
            for (const key of TEX_KEYS) {
              const tex = mat[key];
              if (tex && tex.anisotropy !== aniso) { tex.anisotropy = aniso; tex.needsUpdate = true; }
            }
            mat.userData.baseDepthWrite = mat.depthWrite;
          }
          const box = new THREE.Box3().setFromObject(o);
          const info = shadowInfo(o, { size: box.getSize(new THREE.Vector3()).toArray(), bottom: box.min.y, floors: floorYs });
          o.receiveShadow = true;
          o.castShadow = castsShadow(info);
          o.userData.seeThrough = !!info.transparent || info.opacity < 0.6 || info.transmission > 0;
          if (isCoplanarOverlay(info)) {
            for (const mat of mats) Object.assign(mat, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
          }
        });
        this._modelVisibility = null;
        this.model = { id, root, manifest, tagged, north: northOf(root), opacity: 1 };
        this.modelGroup.add(root);
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
    const candidate = (o) => {
      // the material as authored (glass), not as ghosted by the opacity slider
      const m = (Array.isArray(o.material) ? o.material[0] : o.material) || { userData: {} };
      const ud = m.userData || {};
      return pickable({
        isMesh: o.isMesh, helper: !!o.userData.helper,
        transparent: ud.wasTransparent ?? !!m.transparent, opacity: ud.baseOpacity ?? m.opacity ?? 1,
      });
    };
    const hit = this.raycaster.intersectObject(this.model.root, true)
      .find((h) => candidate(h.object) && shown(h.object) && h.point.y <= this.modelClip.constant + 1e-6 && !this._cutAway(h.point));
    if (!hit) return null;
    const fn = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
    const hitInfo = { point: hit.point.toArray(), object: hit.object, up: !fn || Math.abs(fn.y) >= Math.cos((25 * Math.PI) / 180) };
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
      this.pickHelper.userData.helper = true;
      this.scene.add(this.pickHelper);
    }
    this.dirty = true;
  }

  _disposeModel() {
    this._modelId = null;
    this._modelVisibility = null;
    if (!this.model) return;
    this.highlightModelNode(null);
    if (this.objectLayer) this.objectLayer.setModel(null); // restores cloned materials before they are disposed
    this._clearGroup(this.modelGroup);
    this.model = null;
    this._occBoxes = null;
    this._cancelOcclusion();
    this._clearOcclusion();
    this._applyLook();
    this.dirty = true;
  }

  setDaylight(day) {
    this.daylight = !!day;
    this.sky = { night: day ? 0 : 1, sunDir: null };
    this._applyLook();
  }

  // night 0..1 and the unit vector toward the sun (world) or null (fixed bearing from fp.north).
  // With a model only the light values change; shadows are re-rendered when the sun moved > 1 degree
  // or night entered / left 1 (sun.castShadow stays true, so no shader recompile).
  setSky({ night = 0, sunDir = null } = {}) {
    const old = this.sky;
    this.sky = { night, sunDir };
    this.daylight = night < 0.5;
    if (!this.model) { this._applyLook(); return; }
    this._applyLights();
    const a = old.sunDir, b = sunDir;
    let moved = (!!a !== !!b);
    if (a && b) moved = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) > Math.PI / 180;
    if (moved || (old.night >= 1) !== (night >= 1)) this._fitShadow();
    this.dirty = true;
  }

  _applyLights() {
    const t = Math.max(0, Math.min(1, this.sky.night)), hemi = this.hemi, sun = this.sun;
    hemi.color.setHex(0xc4d6ff);
    hemi.groundColor.setHex(0x2a2520);
    hemi.intensity = 0.9 + (0.14 - 0.9) * t;
    sun.color.setHex(0xfff0dc);
    sun.intensity = 2.6 * (1 - t);
    const day = new THREE.Color(0x2a2d30), night = new THREE.Color(0x0e0f10);
    this.renderer.setClearColor(day.lerp(night, t), 1);
  }

  // Renderer, light and shadow settings for model / no model and day / night.
  _applyLook() {
    const r = this.renderer, day = this.model ? this.daylight : true, sun = this.sun, hemi = this.hemi;
    if (this.model) {
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.25;
      r.shadowMap.enabled = true;
      r.shadowMap.autoUpdate = false; // re-rendered on demand (needsUpdate), not every frame
      this._shadowDirty();
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      this._applyLights();
      sun.castShadow = true; // stays on (toggling recompiles shaders); night = intensity 0
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.02; // against acne on roofs
      this._fitShadow();
    } else {
      r.toneMapping = THREE.NoToneMapping;
      r.toneMappingExposure = 1;
      r.shadowMap.enabled = false;
      r.setClearColor(0x000000, 0);
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

  // Fit the sun's shadow camera to the house: storey / basement / roof levels (untagged: meshes up
  // to 30 m across) + 4 m, not the whole plot, so the 2048² map stays sharp. Sun azimuth from fp.north.
  _fitShadow() {
    if (!this.model) return;
    const sun = this.sun;
    this.modelGroup.updateMatrixWorld(true);
    let box = new THREE.Box3();
    for (const l of this.model.manifest.levels) {
      if (l.role === 'storey' || l.role === 'basement' || l.role === 'roof') box.union(new THREE.Box3().setFromObject(l.node));
    }
    if (box.isEmpty()) {
      this.model.root.traverse((o) => {
        if (!o.isMesh) return;
        const b = new THREE.Box3().setFromObject(o);
        if (Math.max(b.max.x - b.min.x, b.max.z - b.min.z) <= SHADOW_MESH_M) box.union(b);
      });
    }
    if (box.isEmpty()) box = new THREE.Box3().setFromObject(this.modelGroup);
    if (box.isEmpty()) return;
    box.expandByScalar(SHADOW_MARGIN_M);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const dir = new THREE.Vector3(...(this.sky.sunDir || sunDirection(this.model.north, this.modelGroup.rotation.y)));
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(dir, radius * 2.5);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = 0.5;
    cam.far = radius * 5;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    this._shadowDirty();
    this.dirty = true;
  }

  // True when the model's levels come from tags (extras / names), not the legacy heuristic.
  isTagged() {
    return !!this.model && this.model.tagged;
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
      this.trail.userData.helper = true;
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
    // only this marker: visibility (it may have crossed the section cut) and its own occlusion
    const c = this.cssObjects.find((o) => o.kind === 'marker' && o.id === id);
    if (c) c.obj.visible = this._markerVisible(c);
    if (g) g.mesh.visible = this._glowVisible(id, g);
    const st = this.stems.get(id);
    if (st) st.disc.visible = m.obj.visible;
    this._placeStem(id, m.obj.position, floorId);
    this._scheduleOcclusion(OCCLUSION_DELAY_MS, id);
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
          outline.userData.helper = true;
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
    this._bounds = this._sceneBounds();
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
    if (this._stemsOn) this._buildStems();
    this._occSig = null; // new elements carry no occlusion state yet
    this._applyFloorVisibility();
    this.dirty = true;
  }

  // Edit mode: a thin vertical line from every shown marker down to its floor plus a small disc
  // on the floor, so a marker at mounting height reads as standing over one spot while orbiting.
  setStems(on) {
    this._stemsOn = !!on;
    if (on) this._buildStems();
    else this._disposeStems();
    this._applyFloorVisibility();
    this.dirty = true;
  }

  _stemColor() {
    const c = new THREE.Color('#03a9f4');
    try {
      const css = getComputedStyle(this.container).getPropertyValue('--primary-color').trim();
      if (/^(#|rgba?\(|hsla?\()/i.test(css)) c.setStyle(css);
    } catch { /* detached or unparsable: keep the fallback */ }
    return c;
  }

  _buildStems() {
    this._disposeStems();
    const color = this._stemColor();
    const res = {
      lineGeo: new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]),
      discGeo: new THREE.CircleGeometry(0.08, 24).rotateX(-Math.PI / 2),
      lineMat: new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }),
      discMat: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
    };
    this._stemRes = res;
    for (const [id, m] of this.markerObjects) {
      const line = new THREE.Line(res.lineGeo, res.lineMat);
      const disc = new THREE.Mesh(res.discGeo, res.discMat);
      line.renderOrder = disc.renderOrder = 3;
      line.userData.stemId = disc.userData.stemId = id;
      line.userData.helper = disc.userData.helper = true;
      this.stemGroup.add(line, disc);
      this.stems.set(id, { line, disc });
      this._placeStem(id, m.obj.position, m.floorId);
    }
  }

  _placeStem(id, world, floorId) {
    const st = this.stems.get(id);
    if (!st) return;
    const floor = this.floorElevation(floorId);
    const h = Math.max(world.y - floor, 0);
    st.line.position.set(world.x, floor, world.z);
    st.line.scale.set(1, Math.max(h, 1e-4), 1);
    st.line.userData.height = h;
    st.disc.position.set(world.x, floor + 0.05, world.z); // above room fills (+0.02), glows, trail
    st.line.visible = st.disc.visible && h > 0.01;
  }

  _disposeStems() {
    for (const { line, disc } of this.stems.values()) this.stemGroup.remove(line, disc);
    this.stems.clear();
    if (this._stemRes) {
      for (const r of Object.values(this._stemRes)) r.dispose();
      this._stemRes = null;
    }
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
      mesh.visible = this._glowVisible(g.id, entry); // glows cast no shadow and hide no marker
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

  // Side section: plane {normal, constant} (card world) clips everything (renderer.clippingPlanes);
  // model materials turn double-sided so cut walls read solid; markers and glows on the removed side
  // are hidden. null restores everything.
  setSection(plane) {
    if (plane) {
      if (!this.sectionClip) this.sectionClip = new THREE.Plane();
      this.sectionClip.normal.set(...plane.normal);
      this.sectionClip.constant = plane.constant;
      this.sectionClip.normalize();
      this.renderer.clippingPlanes = [this.sectionClip];
    } else {
      this.sectionClip = null;
      this.renderer.clippingPlanes = [];
    }
    this._sectionMaterials();
    this._applyFloorVisibility(); // the section is part of the shadow / occlusion signatures
    this.dirty = true;
  }

  // double-sided model materials while the section is on (original side remembered in userData)
  _sectionMaterials() {
    if (!this.model) return;
    const on = !!this.sectionClip;
    this.model.root.traverse((o) => {
      if (!o.isMesh) return;
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        if (on && mat.userData.sectionSide === undefined) {
          mat.userData.sectionSide = mat.side;
          mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        } else if (!on && mat.userData.sectionSide !== undefined) {
          mat.side = mat.userData.sectionSide;
          delete mat.userData.sectionSide;
          mat.needsUpdate = true;
        }
      }
    });
  }

  // world-space bounding box of the placed model ({min, max} arrays) or null
  modelBox() {
    if (!this.model) return null;
    this.modelGroup.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(this.model.root);
    return b.isEmpty() ? null : { min: b.min.toArray(), max: b.max.toArray() };
  }

  // box framing the section: union of the storey/basement levels (the house), else the whole model
  sectionBox() {
    if (!this.model) return null;
    this.modelGroup.updateMatrixWorld(true);
    const boxes = sectionLevels(this.model.manifest.levels).map((l) => {
      const b = new THREE.Box3().setFromObject(l.node);
      return b.isEmpty() ? null : { min: b.min.toArray(), max: b.max.toArray() };
    });
    return unionBox(boxes) || this.modelBox();
  }

  // a plane given in model space (glTF scene coordinates) -> card world
  modelPlaneToWorld(plane) {
    if (!this.model) return plane;
    this.modelGroup.updateMatrixWorld(true);
    const p = new THREE.Plane(new THREE.Vector3(...plane.normal), plane.constant).applyMatrix4(this.model.root.matrixWorld);
    return { normal: p.normal.toArray(), constant: p.constant };
  }

  // a point in model world (glTF scene coordinates) -> card world, through the model's placement
  modelPointToWorld(p) {
    if (!this.model) return p;
    this.modelGroup.updateMatrixWorld(true);
    return new THREE.Vector3(...p).applyMatrix4(this.model.root.matrixWorld).toArray();
  }

  _cutAway(pos) {
    return !!this.sectionClip && this.sectionClip.distanceToPoint(pos) < 0;
  }

  getCamera() {
    if (this.mode === 'top' && this._lastCam3d) return this._lastCam3d;
    const r = (a) => a.toArray().map((x) => Math.round(x * 100) / 100);
    return { position: r(this.persp.position), target: r(this.controls.target) };
  }

  // Top view: ortho centre in plan metres + zoom (1 = 10 m half height), or null outside top mode.
  getTopCamera() {
    if (this.mode !== 'top') return null;
    const t = this.controls.target, r = (x) => Math.round(x * 100) / 100 + 0;
    return { center: [r(t.x), r(-t.z)], zoom: Math.round(topZoom(this.ortho.zoom, this._orthoHalf || 10) * 1000) / 1000 };
  }

  setTopCamera(c, { instant = false } = {}) {
    if (this.mode !== 'top' || !c) return;
    const target = new THREE.Vector3(c.center[0], this.controls.target.y, -c.center[1]);
    const zoom = orthoZoom(c.zoom, this._orthoHalf || 10);
    if (instant) {
      this._tween = null;
      this._placeOrtho(target, zoom);
    } else {
      this._tween = { top: true, t0: performance.now(), from: { target: this.controls.target.clone(), zoom: this.ortho.zoom }, to: { target, zoom } };
    }
    this.dirty = true;
  }

  _placeOrtho(target, zoom) {
    this.ortho.zoom = zoom;
    this.ortho.position.set(target.x, target.y + 60, target.z);
    this.ortho.lookAt(target);
    this.ortho.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.controls.update();
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
    for (const c of this.cssObjects) c.obj.visible = this._markerVisible(c);
    for (const [id, g] of this.glows) g.mesh.visible = this._glowVisible(id, g);
    for (const [id, st] of this.stems) {
      const m = this.markerObjects.get(id);
      const shown = !!(m && m.obj.visible);
      st.disc.visible = shown;
      st.line.visible = shown && st.line.userData.height > 0.01;
    }
    for (const o of this.overlayGroup.children) if (!o.isCSS2DObject) o.visible = this._shows(o.userData.floorId);
    if (this.trail) this.trail.visible = this._shows(this.trail.userData.floorId);
    if (this.model) {
      const assign = this.modelLevels || {};
      if (!this._modelVisibility) {
        for (const l of this.model.manifest.levels) l.node.visible = levelVisible(assign[l.id], this.visibleFloor, (id) => this.floors.find((f) => f.id === id)?.elevation);
      }
      // everything above the cut-away height of the selected floor is clipped (roof, upper floors)
      // untagged: the top of the selected storey (wall_height is for drawn walls only)
      const vf = this.floors.find((f) => f.id === this.visibleFloor);
      const cut = this.visibleFloor === 'all' || this.isTagged() ? 1e6 : this.floorElevation(this.visibleFloor) + ((vf && vf.height) || 2.7);
      this.modelClip.constant = this._cutOverride === undefined ? cut : (this._cutOverride ?? 1e6);
      if (this.pickHelper) this.pickHelper.update();
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
    // shadow map and occlusion only when their inputs changed (not on every state update)
    const model = this._modelSig();
    if (model !== this._shadowSig) {
      this._shadowSig = model;
      if (this.model) this._shadowDirty();
      this._objectsInvalid(); // lamps on hidden levels give their pool lights to visible ones
    }
    const occ = model + '|' + this.mode + '|' + this._shownMarkersSig();
    if (occ !== this._occSig) {
      this._occSig = occ;
      this._scheduleOcclusion(0);
    }
  }

  // css object (marker, label, handle) visibility: marker state, else its floor; section cut
  _markerVisible(c) {
    const st = c.kind === 'marker' && this._markerStates && c.id !== undefined ? this._markerStates.get(c.id) : null;
    return (st ? !!st.shown : this._shows(c.floorId)) && !(c.kind !== 'handle' && this._cutAway(c.obj.position));
  }

  _glowVisible(id, g) {
    const st = this._markerStates ? this._markerStates.get(id) : null;
    return (st ? !!st.shown : this._shows(g.floorId)) && !this._cutAway(g.mesh.position);
  }

  // What the shadow map depends on: the model, which of its nodes are shown, the cut, the section.
  _modelSig() {
    if (!this.model) return '';
    const mv = this._modelVisibility;
    const vis = mv ? mv.index.nodes.map((n) => (n.node.visible ? 1 : 0)).join('')
      : this.model.manifest.levels.map((l) => (l.node.visible ? 1 : 0)).join('');
    const s = this.sectionClip;
    return [this.model.id, vis, this.modelClip.constant, s ? [...s.normal.toArray(), s.constant].map((v) => v.toFixed(4)).join() : ''].join('|');
  }

  // Shown markers and where they are (occlusion input).
  _shownMarkersSig() {
    const out = [];
    for (const c of this.cssObjects) {
      if (c.kind !== 'marker' || !c.obj.visible) continue;
      const p = c.obj.position;
      out.push(`${c.id}@${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`);
    }
    return out.join(';');
  }

  _shadowDirty() {
    this.renderer.shadowMap.needsUpdate = true;
    this.stats.shadow++;
  }

  markDirty() {
    this.dirty = true;
  }

  requestShadowUpdate() {
    this._shadowDirty();
    this.dirty = true;
  }

  _objectsInvalid() {
    if (this.onObjectsInvalidate && this.model) this.onObjectsInvalidate();
  }

  // The 3D camera before switching to Top (null until then).
  get lastCamera3d() {
    return this._lastCam3d || null;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (this.mode === '3d') this._lastCam3d = this.getCamera();
    this.mode = mode;
    this.camera = mode === 'top' ? this.ortho : this.persp;
    if (mode === 'top') { this._cancelOcclusion(); this._clearOcclusion(); } // no occlusion in top view
    this._makeControls();
    this.fit();
    if (mode === '3d') this._scheduleOcclusion(0);
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
      this._bounds = this._sceneBounds();
      this._moveCamera(to.pos, to.target, instant);
      this._updateDepth();
      return;
    }
    this.controls.target.copy(target);
    this.controls.update();
    this._bounds = this._sceneBounds();
    this._updateDepth();
    this.dirty = true;
  }

  // Depth-range bounds: the house box (rooms + model meshes up to 60 m) and the bounding sphere of
  // everything (terrain included).
  _sceneBounds() {
    const house = new THREE.Box3(), full = new THREE.Box3();
    for (const { room, floorId } of this._rooms || []) {
      if (!room.polygon || room.polygon.length < 3) continue;
      const f = this.floors.find((x) => x.id === floorId);
      const y0 = f ? f.elevation : 0, y1 = y0 + ((f && f.height) || 2.7);
      for (const [x, y] of room.polygon) house.expandByPoint(new THREE.Vector3(x, y0, -y)).expandByPoint(new THREE.Vector3(x, y1, -y));
    }
    full.union(house);
    if (this.model) {
      this.modelGroup.updateMatrixWorld(true);
      this.model.root.traverse((o) => {
        if (!o.isMesh) return;
        const b = new THREE.Box3().setFromObject(o);
        full.union(b);
        if (Math.max(b.max.x - b.min.x, b.max.z - b.min.z) <= MAX_FRAME_MESH_M) house.union(b);
      });
    }
    if (full.isEmpty()) full.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    if (house.isEmpty()) house.copy(full);
    const sphere = full.getBoundingSphere(new THREE.Sphere());
    return { house, centre: sphere.center, radius: Math.max(sphere.radius, 5) };
  }

  // Near / far from the camera position (depth precision where the model is); only on > 1 % changes.
  _updateDepth() {
    const cam = this.camera, ortho = cam === this.ortho;
    const b = this._bounds || (this._bounds = this._sceneBounds());
    const p = cam.position;
    const next = depthRange({
      target: p.distanceTo(this.controls.target), house: b.house.distanceToPoint(p),
      centre: p.distanceTo(b.centre), radius: b.radius, ortho,
    });
    if (!depthChanged({ near: cam.near, far: cam.far }, next)) return;
    cam.near = next.near;
    cam.far = next.far;
    cam.updateProjectionMatrix();
  }

  // Card option `occlusion`: markers behind model walls are dimmed (class fp-occluded).
  setOcclusion(on) {
    this._occlusion = on !== false;
    this._scheduleOcclusion(0);
  }

  // Occlusion pass once the camera has been still for 150 ms (debounced; never per frame). A new
  // schedule cancels the pending timer and any pass still running in slices.
  // id: only that marker (a moving live marker); a pending or running full pass already covers it.
  // Nothing runs while the card is detached (start() schedules a full pass again).
  _scheduleOcclusion(delay = OCCLUSION_DELAY_MS, id = null) {
    if (this._disposed || !this._raf) return;
    if (id !== null) {
      if (this._occFull) return;
      (this._occIds = this._occIds || new Set()).add(id);
    } else {
      this._occFull = true;
      this._occIds = null;
    }
    if (this._occTimer) clearTimeout(this._occTimer);
    this._occGen++;
    this._occTimer = setTimeout(() => this._runOcclusion(), delay);
  }

  _cancelOcclusion() {
    if (this._occTimer) clearTimeout(this._occTimer);
    this._occTimer = null;
    this._occGen++;
    this._occFull = false;
    this._occIds = null;
  }

  _clearOcclusion() {
    for (const c of this.cssObjects) if (c.kind === 'marker') c.obj.element.classList.remove('fp-occluded');
  }

  // World boxes of the model meshes that can hide a marker (not glass / see-through), cached.
  _occluders() {
    if (this._occBoxes) return this._occBoxes;
    this.modelGroup.updateMatrixWorld(true);
    const out = [];
    this.model.root.traverse((o) => {
      if (!o.isMesh || o.userData.seeThrough || o.userData.helper) return;
      const box = new THREE.Box3().setFromObject(o);
      if (!box.isEmpty()) out.push({ mesh: o, box });
    });
    this._occBoxes = out;
    return out;
  }

  _runOcclusion() {
    this._occTimer = null;
    if (this._disposed) return;
    const full = this._occFull, ids = this._occIds;
    if (!this._occlusion || this.mode !== '3d' || !this.model || (this.model.opacity ?? 1) < 0.6) {
      this._occFull = false;
      this._occIds = null;
      this._clearOcclusion();
      return;
    }
    const since = performance.now() - (this._camMovedAt || 0);
    if (since < OCCLUSION_DELAY_MS) {
      const wait = OCCLUSION_DELAY_MS - since;
      if (full) this._scheduleOcclusion(wait);
      else { this._occIds = null; for (const id of ids || []) this._scheduleOcclusion(wait, id); }
      return;
    }
    this._occIds = null;
    if (full) this.stats.occPasses++;
    else this.stats.occPartial++;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const boxes = this._occluders().filter((b) => shown(b.mesh));
    const shownMarkers = this.cssObjects.filter((c) => c.kind === 'marker' && c.obj.visible && (full || (ids && ids.has(c.id))));
    const markers = shownMarkers.slice(0, OCCLUSION_MAX);
    // past the budget: not tested, so not dimmed (a stale fp-occluded would leave them unclickable)
    for (const c of shownMarkers.slice(OCCLUSION_MAX)) c.obj.element.classList.remove('fp-occluded');
    const gen = this._occGen;
    const rc = this._occRay, pos = new THREE.Vector3(), dir = new THREE.Vector3(), tmp = new THREE.Vector3();
    const cut = this.modelClip.constant;
    let i = 0;
    const slice = () => {
      this._occTimer = null;
      if (this._disposed || gen !== this._occGen) return; // cancelled (camera, view, model, dispose)
      const t0 = performance.now();
      for (; i < markers.length; i++) {
        if (performance.now() - t0 > OCCLUSION_SLICE_MS) { this._occTimer = setTimeout(slice, 0); return; }
        const c = markers[i];
        if (!c.obj.parent) continue; // removed meanwhile
        c.obj.getWorldPosition(pos);
        const dist = origin.distanceTo(pos);
        rc.set(origin, dir.subVectors(pos, origin).normalize());
        rc.near = 0;
        rc.far = Math.max(dist - 0.3, 0);
        let hitD = null;
        for (const { mesh, box } of boxes) {
          if (!box.containsPoint(origin)) { // inside the box: the ray may hit it anywhere, test the mesh
            const at = rc.ray.intersectBox(box, tmp);
            if (!at || origin.distanceTo(at) > rc.far) continue; // box pre-filter
          }
          const h = rc.intersectObject(mesh, false).find((x) => x.point.y <= cut + 1e-6 && !this._cutAway(x.point));
          if (h) { hitD = h.distance; break; }
        }
        c.obj.element.classList.toggle('fp-occluded', isOccluded(hitD, dist));
      }
      if (full) this._occFull = false;
    };
    slice();
  }

  _stepTween(now) {
    const tw = this._tween;
    const t = Math.min(1, (now - tw.t0) / 400);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    if (tw.top) {
      if (this.mode !== 'top') { this._tween = null; return; }
      this._placeOrtho(new THREE.Vector3().lerpVectors(tw.from.target, tw.to.target, e), tw.from.zoom + (tw.to.zoom - tw.from.zoom) * e);
      this.dirty = true;
      if (t === 1) this._tween = null;
      return;
    }
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
      if (this.controls.update()) this.dirty = true; // damping still moving
      if (this.pivotMarker && !this.pivotMarker.position.equals(this.controls.target)) {
        this.pivotMarker.position.copy(this.controls.target);
        this.dirty = true;
      }
      if (this.pivotMarker && this.pivotMarker.visible === !!this.sectionClip) {
        this.pivotMarker.visible = !this.sectionClip; // no rotation-centre cross over the section camera
        this.dirty = true;
      }
      if (!this.dirty) return;
      this.dirty = false;
      this._updateDepth();
      this.labelRenderer.domElement.classList.toggle('compact', this.pixelsPerMetre() < COMPACT_PPM);
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
    this._scheduleOcclusion(0);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._cancelOcclusion(); // a detached card runs no passes
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
    this._disposed = true;
    this._cancelOcclusion();
    this.renderer.domElement.removeEventListener('wheel', this._onWheel);
    this.controls.dispose();
    this._clearGroup(this.staticGroup);
    this._clearGroup(this.markerGroup);
    this._clearGroup(this.glowGroup);
    this._clearGroup(this.overlayGroup);
    this._disposeStems();
    this.setPivotMarker(false);
    this._disposeModel();
    if (this.objectLayer) this.objectLayer.dispose();
    this.onObjectsInvalidate = null;
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
