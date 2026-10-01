// Three.js scene for the floorplan: floors, rooms, cut-away walls, DOM markers, light glow.
// Plan (x, y, z) maps to world (x, floorElevation + z, -y) so north is up in top view.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { centroid } from './placement.js';
import { wallSegments } from './layout.js';

const WALL_THICKNESS = 0.12;
const GLOW_RADIUS = 2.2;
const TOOLBAR_PX = 48; // plan is framed below the card's toolbar
const COMPACT_PPM = 30; // pixels per metre below which markers shrink

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.localClippingEnabled = true; // model cut-away
    this.labelRenderer = new CSS2DRenderer();
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.append(this.renderer.domElement, this.labelRenderer.domElement);

    this.persp = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
    this.ortho.up.set(0, 0, -1); // north up when looking straight down
    this.mode = '3d';
    this.camera = this.persp;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-12, 30, 18);
    this.scene.add(sun);

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
    this.model = null; // { url, root, floorNodes: Map(floorId -> node), other: [nodes] }
    this.modelClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.raycaster = new THREE.Raycaster();

    this.floors = [];
    this.visibleFloor = 'all';
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
    if (this.controls) this.controls.dispose();
    const c = new OrbitControls(this.camera, this.renderer.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = true;
    if (this.mode === 'top') {
      c.enableRotate = false;
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    } else {
      c.maxPolarAngle = Math.PI * 0.48;
    }
    c.addEventListener('change', () => { this.dirty = true; });
    if (this.controls) c.enabled = this.controls.enabled;
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

  // GLB underlay. opts: {url, position: [x, y, z] plan metres, rotation: degrees CCW, scale, opacity}.
  // Top-level nodes named "floor:<id>" are shown only with their floor; everything is cut at the
  // selected floor's cut-away height. Resolves to null or an error message.
  setModel(opts) {
    if (!opts || !opts.url) {
      this._disposeModel();
      return Promise.resolve(null);
    }
    const place = () => {
      const g = this.modelGroup;
      const [x, y, z] = opts.position || [0, 0, 0];
      g.position.set(x, z, -y);
      g.rotation.y = ((opts.rotation || 0) * Math.PI) / 180;
      g.scale.setScalar(opts.scale || 1);
      this._applyFloorVisibility();
      this.dirty = true;
    };
    if (this.model && this.model.url === opts.url) {
      place();
      return Promise.resolve(null);
    }
    this._disposeModel();
    const url = opts.url;
    this._modelUrl = url;
    return new Promise((resolve) => {
      new GLTFLoader().load(url, (gltf) => {
        if (this._modelUrl !== url) return resolve(null);
        const root = gltf.scene;
        // GLTFLoader strips ':' from node names; the original is kept in userData.name
        const nameOf = (n) => (n.userData && n.userData.name) || n.name;
        const isFloor = (n) => /^floor[:_]/.test(nameOf(n));
        const floorNodes = new Map();
        const top = root.children.length === 1 && !isFloor(root.children[0]) ? root.children[0].children : root.children;
        for (const n of top) {
          const m = /^floor[:_](.+)$/.exec(nameOf(n));
          if (m) floorNodes.set(m[1], n);
        }
        const opacity = opts.opacity ?? 1;
        root.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) {
            mat.clippingPlanes = [this.modelClip];
            mat.clipShadows = true;
            if (opacity < 1) { mat.transparent = true; mat.opacity = opacity; mat.depthWrite = false; }
          }
        });
        this.model = { url, root, floorNodes };
        this.modelGroup.add(root);
        place();
        resolve(null);
      }, undefined, (err) => {
        console.warn('floorplan3d: could not load model', url, err);
        resolve(`Could not load model ${url}`);
      });
    });
  }

  _disposeModel() {
    this._modelUrl = null;
    if (!this.model) return;
    this._clearGroup(this.modelGroup);
    this.model = null;
    this.dirty = true;
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
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
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
    this.renderer.toneMapping = THREE.NoToneMapping;
    for (const g of this.glows.values()) {
      g.mesh.material.blending = theme.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      g.mesh.material.needsUpdate = true;
    }
    this.dirty = true;
  }

  // floors: [{id, elevation, height}], rooms: [{room, floorId, label}]
  setStructure(floors, rooms, { wallHeight = 1.0 } = {}) {
    this.floors = floors;
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
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, room.outdoor ? outdoorMat : floorMat);
        mesh.position.y = room.outdoor ? -0.01 : 0;
        mesh.userData.roomId = room.id;
        group.add(mesh);
        const outline = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(room.polygon.map(([x, y]) => new THREE.Vector3(x, 0.005, -y))),
          edgeMat,
        );
        group.add(outline);
        if (label) {
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
      for (const w of wallSegments(own.map((r) => r.room))) {
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
      this.cssObjects.push({ obj, floorId: m.floorId, kind: 'marker' });
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
          map: getGlowTexture(), transparent: true, depthWrite: false,
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
    this.visibleFloor = id;
    this._applyFloorVisibility();
    this.dirty = true;
  }

  floorElevation(floorId) {
    const f = this.floors.find((x) => x.id === floorId);
    return f ? f.elevation : 0;
  }

  _shows(floorId) {
    return this.visibleFloor === 'all' || this.visibleFloor === floorId;
  }

  _applyFloorVisibility() {
    for (const g of this.staticGroup.children) g.visible = this._shows(g.userData.floorId);
    // markers live in one group for all floors, so visibility is set per object
    for (const c of this.cssObjects) c.obj.visible = this._shows(c.floorId);
    for (const g of this.glows.values()) g.mesh.visible = this._shows(g.floorId);
    for (const o of this.overlayGroup.children) if (!o.isCSS2DObject) o.visible = this._shows(o.userData.floorId);
    if (this.trail) this.trail.visible = this._shows(this.trail.userData.floorId);
    if (this.model) {
      for (const [id, node] of this.model.floorNodes) node.visible = this._shows(id);
      // everything above the cut-away height of the selected floor is clipped (roof, upper floors)
      const cut = this.visibleFloor === 'all' ? 1e6 : this.floorElevation(this.visibleFloor) + Math.max(this.wallHeight, 0.3);
      this.modelClip.constant = cut;
    }
    if (this.mapPlane && this.mapPlane.material.map) this.mapPlane.visible = this._shows(this.mapPlane.userData.floorId);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.camera = mode === 'top' ? this.ortho : this.persp;
    this._makeControls();
    this.fit();
  }

  // Frame the rooms of the visible floor(s).
  fit() {
    const box = new THREE.Box3();
    for (const g of this.staticGroup.children) if (g.visible) box.expandByObject(g);
    if (box.isEmpty() && this.model) box.expandByObject(this.modelGroup);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 0, 5));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const aspect = this.size.w / this.size.h;
    const target = center.clone();
    if (this.visibleFloor !== 'all') target.y = this.floorElevation(this.visibleFloor);

    if (this.mode === 'top') {
      const { h } = this.size;
      const half = Math.max(size.z / 2, size.x / 2 / aspect) * 1.08 * ((h + TOOLBAR_PX) / Math.max(h - TOOLBAR_PX, 1));
      this._orthoHalf = half;
      this._updateOrtho();
      this.ortho.zoom = 1;
      this.ortho.position.set(target.x, target.y + 60, target.z);
      this.ortho.lookAt(target);
      this.ortho.updateProjectionMatrix();
    } else {
      const dir = new THREE.Vector3(0.18, 0.95, 0.75).normalize(); // from the south, high up
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
      this.persp.position.copy(target).addScaledVector(dir, dist);
      this.persp.lookAt(target);
    }
    this.controls.target.copy(target);
    this.controls.update();
    this.dirty = true;
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
