import * as THREE from 'three';
import { floorPanelRects, floorPanelAt, floorPanelNdc, renderFloorPanels } from './floor-panels.js';
import { FloorPanelLabels } from './floor-panel-labels.js';
import { floorPanelParticipants } from './floor-panel-membership.js';
import { depthRange } from './render-rules.js';

// A complete 44px header needs its two 5px pane insets as well.
const paneRects = (view, count) => floorPanelRects({ width: view.size.w, height: view.size.h }, count, { minPane: 54 });

// Floor panes share the live scene, lamp pool and existing RAF. These cameras
// contain display-only framing; saved positions and the primary camera stay owned
// by View. Orbit/zoom/pan are linked until separate controls are explicitly chosen.
export class FloorPanelView {
  constructor(view) {
    this.view = view; this._entries = []; this._scope = null; this._base = null;
    this.activeFloorId = null; this.labels = null;
  }

  _rows() {
    const v = this.view, report = v._floorCompiled;
    return !v._disposed && !v.sectionClip && v._floorOptions?.enabled !== false
      && report?.valid === true && report.mode === 'horizontal' && report.panels === true
      ? report.rows.filter((row) => v._shows(row.floor_id)) : [];
  }

  get active() {
    return paneRects(this.view, this._rows().length).length > 0;
  }

  entries() {
    const v = this.view, rows = this._rows();
    const rects = paneRects(v, rows.length);
    if (!rects.length) { this.clear(); return []; }
    const key = JSON.stringify(rows.map((row) => [row.floor_id, row.bounds, row.offset]));
    if (!this._scope || this._scope.camera !== v.camera || this._scope.model !== v.model?.root || this._scope.key !== key) {
      this.labels?.clear(); this._scope = { camera: v.camera, model: v.model?.root, key };
      this._base = { target: v.controls.target.clone(), zoom: v.camera.zoom,
        distance: Math.max(.01, v.camera.position.distanceTo(v.controls.target)) };
      this._entries = rows.map((row) => ({ floorId: row.floor_id, row, camera: v.camera.clone() }));
      if (!rows.some((row) => row.floor_id === this.activeFloorId)) this.activeFloorId = rows[0].floor_id;
    }
    const pan = v.controls.target.clone().sub(this._base.target);
    const direction = v.camera.position.clone().sub(v.controls.target).normalize();
    const ratio = Math.max(.01, v.camera.position.distanceTo(v.controls.target) / this._base.distance);
    const zoomRatio = v.camera.zoom / this._base.zoom;
    for (let index = 0; index < this._entries.length; index++) {
      const entry = this._entries[index], { bounds, offset } = entry.row;
      entry.rect = rects[index]; entry.active = entry.floorId === this.activeFloorId;
      entry.name = (v._floorOptions?.floors || v.floors).find((floor) => floor.id === entry.floorId)?.name || entry.floorId;
      const center = new THREE.Vector3(...bounds.min).add(new THREE.Vector3(...bounds.max)).multiplyScalar(.5).add(new THREE.Vector3(...offset)).add(pan);
      const width = bounds.max[0] - bounds.min[0], depth = bounds.max[2] - bounds.min[2];
      const height = Math.max(.2, bounds.max[1] - bounds.min[1]);
      const aspect = entry.rect.width / entry.rect.height, camera = entry.camera;
      camera.up.copy(v.camera.up); camera.near = v.camera.near; camera.far = v.camera.far;
      if (camera.isPerspectiveCamera) {
        camera.fov = v.camera.fov; camera.aspect = aspect; camera.zoom = zoomRatio;
        camera.clearViewOffset();
        const radius = Math.hypot(width, depth, height) * .5;
        const halfFov = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.min(1, aspect));
        const distance = Math.max(.1, radius / Math.sin(halfFov) * 1.12) * ratio;
        camera.position.copy(center).addScaledVector(direction, distance);
      } else {
        const span = Math.max(depth, width / aspect, .2) * 1.25;
        camera.left = -span * aspect / 2; camera.right = span * aspect / 2;
        camera.top = span / 2; camera.bottom = -span / 2; camera.zoom = zoomRatio;
        camera.clearViewOffset();
        camera.position.copy(center).addScaledVector(direction, Math.max(height + 10, v.camera.position.distanceTo(v.controls.target)));
      }
      const displayedBounds = new THREE.Box3(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max))
        .translate(new THREE.Vector3(...offset));
      const sphere = displayedBounds.getBoundingSphere(new THREE.Sphere());
      const centreDistance = camera.position.distanceTo(sphere.center);
      const paneDepth = depthRange({ target: camera.position.distanceTo(center), house: displayedBounds.distanceToPoint(camera.position),
        centre: centreDistance, radius: sphere.radius, ortho: camera.isOrthographicCamera });
      camera.near = paneDepth.near;
      // The narrow pane may frame from farther away than the primary camera.
      // Retain the existing sky depth, and also include this floor's actual bounds.
      camera.far = Math.max(v.camera.far, paneDepth.far, (centreDistance + sphere.radius) * 1.05);
      camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      entry.target = center;
      const ppm = camera.isOrthographicCamera ? entry.rect.height * camera.zoom / (camera.top - camera.bottom)
        : entry.rect.height / (2 * camera.position.distanceTo(center) * Math.tan(camera.fov * Math.PI / 360));
      entry.compact = ppm < 30;
    }
    return this._entries;
  }

  paneAt(clientX, clientY) {
    return floorPanelAt(clientX, clientY, this.view.renderer.domElement.getBoundingClientRect(), this.entries(),
      { width: this.view.size.w, height: this.view.size.h });
  }

  rayAt(clientX, clientY, floorId) {
    const pane = this.paneAt(clientX, clientY);
    if (!pane || floorId !== undefined && pane.floorId !== floorId) return null;
    const ndc = floorPanelNdc(clientX, clientY, this.view.renderer.domElement.getBoundingClientRect(), pane,
      { width: this.view.size.w, height: this.view.size.h });
    return ndc ? { pane, camera: pane.camera, ndc: new THREE.Vector2(ndc.x, ndc.y) } : null;
  }

  select(floorId) {
    if (!this.entries().some((entry) => entry.floorId === floorId)) return false;
    if (this.activeFloorId === floorId) return true;
    this.activeFloorId = floorId;
    this.labels?.setActive?.(floorId); this.view.dirty = true;
    this.view.onFloorPanelSelect?.(floorId);
    return true;
  }

  cameraSnapshot() {
    const entry = this.entries().find((pane) => pane.floorId === this.activeFloorId);
    if (!entry) return null;
    const offset = new THREE.Vector3(...entry.row.offset), target = entry.target.clone().sub(offset);
    return { camera: { position: entry.camera.position.clone().sub(offset).toArray(), target: target.toArray() },
      topCamera: { center: [target.x, -target.z], zoom: entry.camera.zoom }, mode: this.view.mode };
  }

  focusPlan(point) {
    const entry = this.entries().find((pane) => pane.floorId === point?.floorId);
    if (!entry || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    this.select(entry.floorId);
    const delta = new THREE.Vector3(point.x - entry.target.x, 0, -point.y - entry.target.z);
    if (this.view.mode === 'top') {
      const camera = this.view.getTopCamera();
      this.view.setTopCamera({ ...camera, center: [camera.center[0] + delta.x, camera.center[1] - delta.z] });
    } else this.view.setCamera({ position: this.view.camera.position.clone().add(delta).toArray(),
      target: this.view.controls.target.clone().add(delta).toArray() });
    return true;
  }

  cameraForFloor(floorId) { return this.entries().find((entry) => entry.floorId === floorId)?.camera || null; }

  resetFraming(position = this.view.camera.position, target = this.view.controls.target, zoom = this.view.camera.zoom) {
    if (!this.active) return false;
    this.entries();
    // Reset fits each pane itself. A fit of the full house is not user pan/zoom.
    this._base = { target: target.clone(), zoom, distance: Math.max(.01, position.distanceTo(target)) };
    this.view._wallCameraDirty = true;
    this.view._scheduleOcclusion?.();
    this.view.dirty = true;
    return true;
  }

  projectWorld(world, floorId = this.activeFloorId) {
    const pane = this.entries().find((entry) => entry.floorId === floorId);
    if (!pane) return null;
    const point = world.clone().project(pane.camera);
    if (!(point.z >= -1 && point.z <= 1) || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
    const box = this.view.renderer.domElement.getBoundingClientRect(), { rect } = pane;
    return [box.left + (rect.x + (point.x + 1) * rect.width / 2) * box.width / this.view.size.w,
      box.top + (rect.y + (1 - point.y) * rect.height / 2) * box.height / this.view.size.h];
  }

  participants() {
    return floorPanelParticipants(this.view, this.view.floorPanelContext?.() || {});
  }

  floorForNode(node, members = this.participants()) {
    for (let current = node; current; current = current.parent) if (members.has(current)) return members.get(current);
    const floors = new Set();
    node?.traverse?.((child) => { if (members.has(child)) floors.add(members.get(child)); });
    return floors.size === 1 ? [...floors][0] : null;
  }

  isolate(floorId, members = this.participants()) {
    const journal = new Map(), lampJournal = new Map();
    const hide = (node) => { if (node?.isObject3D && node.visible && !node.isLight) { journal.set(node, node.visible); node.visible = false; } };
    for (const [node, ownFloor] of members) if (ownFloor !== floorId) hide(node);
    // Unclassified CSS labels must not be repeated in another floor's panel.
    this.view.scene.traverse((node) => {
      if (!node.isCSS2DObject) {
        if ((node.isMesh || node.isLine || node.isPoints || node.isSprite) && !members.has(node)) {
          for (let parent = node; parent; parent = parent.parent) if (parent === this.view.model?.root) { hide(node); break; }
        }
        return;
      }
      let owner;
      for (let parent = node; parent; parent = parent.parent) if (members.has(parent)) { owner = members.get(parent); break; }
      if (owner !== floorId) hide(node);
    });
    // Keep the same shader/light slots. Other floors' lamps contribute no light
    // in this pane, without allocating, hiding or recompiling a second pool.
    for (const [id, slot] of this.view.objectLayer?._slots || []) {
      const part = this.view.objectLayer.parts.get(id), light = slot.light;
      if (light && this.floorForNode(part?.obj?.node, members) !== floorId && light.intensity !== 0) {
        lampJournal.set(light, light.intensity); light.intensity = 0;
      }
    }
    for (const [light, ownFloor] of members.authoredLights || []) {
      if (ownFloor !== floorId && light.intensity !== 0) {
        lampJournal.set(light, light.intensity); light.intensity = 0;
      }
    }
    return () => { for (const [node, visible] of journal) node.visible = visible;
      for (const [light, intensity] of lampJournal) light.intensity = intensity; };
  }

  withFloor(floorId, callback, members) {
    const restore = this.isolate(floorId, members);
    try { return callback(); } finally { restore(); }
  }

  render() {
    const entries = this.entries();
    if (!entries.length) return false;
    const members = this.participants();
    this.labels ||= new FloorPanelLabels(this.view.labelRenderer, { onSelect: (id) => this.select(id) });
    this.labels.begin(entries);
    try {
      const result = renderFloorPanels(this.view.renderer, this.view.scene, entries, {
        size: { width: this.view.size.w, height: this.view.size.h },
        enterPane: (entry) => this.isolate(entry.floorId, members),
        onPaneRendered: (entry) => this.labels.render(this.view.scene, entry),
      });
      if (result.rendered !== entries.length) { this.clear(); return false; }
      // Only this synchronous frame owns the map; never cache current HA ownership.
      return { entries, members };
    } catch (error) { this.labels.clear(); throw error;
    } finally { this.labels.finish(this.view.size); }
  }

  clear() {
    this.labels?.clear(); this._entries = []; this._scope = null; this._base = null;
    this.activeFloorId = null;
  }
}
