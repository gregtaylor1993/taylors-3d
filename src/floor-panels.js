import { Vector2, Vector4 } from 'three';

export const FLOOR_PANEL_LIMITS = Object.freeze({ maxPanes: 4, minPane: 44, breakpoint: 640, gap: 8 });
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const validSize = (size) => size && positive(size.width) && positive(size.height);
const validRect = (rect) => rect && finite(rect.x) && finite(rect.y) && rect.x >= 0 && rect.y >= 0
  && positive(rect.width) && positive(rect.height);
const rectOf = (entry) => entry?.rect || entry;
const exactId = (value) => typeof value === 'string' && value.length > 0 && value.trim() === value
  && [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);

/** CSS-pixel, top-left rectangles. Renderer pixel ratio is deliberately not used. */
export function floorPanelRects(size, count, options = {}) {
  const { gap = FLOOR_PANEL_LIMITS.gap, breakpoint = FLOOR_PANEL_LIMITS.breakpoint,
    minPane = FLOOR_PANEL_LIMITS.minPane } = options;
  if (!validSize(size) || !Number.isInteger(count) || count < 1 || count > FLOOR_PANEL_LIMITS.maxPanes
    || !finite(gap) || gap < 0 || !positive(breakpoint) || !positive(minPane)) return [];
  const columns = size.width >= breakpoint;
  const length = columns ? size.width : size.height, cross = columns ? size.height : size.width;
  const span = (length - gap * (count - 1)) / count;
  if (span < minPane || cross < minPane) return [];
  return Array.from({ length: count }, (_, index) => {
    const start = index * (span + gap), extent = index === count - 1 ? length - start : span;
    return { index, x: columns ? start : 0, y: columns ? 0 : start,
      width: columns ? extent : cross, height: columns ? cross : extent };
  });
}

function pointOnCanvas(clientX, clientY, canvasRect, size) {
  if (!finite(clientX) || !finite(clientY) || !canvasRect || !finite(canvasRect.left) || !finite(canvasRect.top)
    || !positive(canvasRect.width) || !positive(canvasRect.height) || !validSize(size)) return null;
  const x = (clientX - canvasRect.left) * size.width / canvasRect.width;
  const y = (clientY - canvasRect.top) * size.height / canvasRect.height;
  return x >= 0 && y >= 0 && x < size.width && y < size.height ? { x, y } : null;
}
const contains = (rect, point) => validRect(rect) && point.x >= rect.x && point.x < rect.x + rect.width
  && point.y >= rect.y && point.y < rect.y + rect.height;
function inferredSize(panes) {
  if (!Array.isArray(panes) || !panes.length || panes.some((pane) => !validRect(rectOf(pane)))) return null;
  return { width: Math.max(...panes.map((pane) => rectOf(pane).x + rectOf(pane).width)),
    height: Math.max(...panes.map((pane) => rectOf(pane).y + rectOf(pane).height)) };
}

/** Returns the supplied pane itself, so exact floor IDs/cameras are never guessed. */
export function floorPanelAt(clientX, clientY, canvasRect, panes, size = inferredSize(panes)) {
  if (!Array.isArray(panes) || !panes.length || panes.length > FLOOR_PANEL_LIMITS.maxPanes) return null;
  const point = pointOnCanvas(clientX, clientY, canvasRect, size);
  if (!point) return null;
  const matches = panes.filter((pane) => contains(rectOf(pane), point));
  return matches.length === 1 ? matches[0] : null;
}

/** Exact pane-local ray coordinates; gaps and right/bottom edges are excluded. */
export function floorPanelNdc(clientX, clientY, canvasRect, pane, size = { width: canvasRect?.width, height: canvasRect?.height }) {
  const point = pointOnCanvas(clientX, clientY, canvasRect, size), rect = rectOf(pane);
  if (!point || !contains(rect, point)) return null;
  return { x: (point.x - rect.x) / rect.width * 2 - 1, y: 1 - (point.y - rect.y) / rect.height * 2 };
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width
  && a.y < b.y + b.height && b.y < a.y + a.height;
const inScene = (scene, node) => {
  for (let current = node; current; current = current.parent) if (current === scene) return true;
  return false;
};
function validEntries(entries, size, scene) {
  if (!Array.isArray(entries) || !entries.length || entries.length > FLOOR_PANEL_LIMITS.maxPanes || !validSize(size)) return false;
  const ids = new Set(), cameras = new Set(), rectangles = [];
  for (const entry of entries) {
    const rect = entry?.rect, camera = entry?.camera;
    if (!exactId(entry?.floorId) || ids.has(entry.floorId) || !camera?.isCamera || cameras.has(camera)
      || !(camera.isPerspectiveCamera || camera.isOrthographicCamera) || !validRect(rect)
      || rect.x + rect.width > size.width || rect.y + rect.height > size.height
      || rectangles.some((previous) => overlaps(previous, rect))) return false;
    if (entry.visibility !== undefined) {
      if (!Array.isArray(entry.visibility)) return false;
      const nodes = new Set();
      for (const candidate of entry.visibility) {
        if (!candidate?.node?.isObject3D || !inScene(scene, candidate.node) || typeof candidate.visible !== 'boolean'
          || nodes.has(candidate.node)) return false;
        nodes.add(candidate.node);
      }
    }
    ids.add(entry.floorId); cameras.add(camera); rectangles.push(rect);
  }
  return true;
}

function adaptCamera(camera, rect) {
  const projection = camera.projectionMatrix.clone(), inverse = camera.projectionMatrixInverse.clone();
  const fields = camera.isPerspectiveCamera ? ['aspect'] : ['left', 'right', 'top', 'bottom'];
  const values = fields.map((field) => camera[field]);
  if (camera.isPerspectiveCamera) camera.aspect = rect.width / rect.height;
  else {
    const center = (camera.left + camera.right) / 2;
    const halfWidth = (camera.top - camera.bottom) * rect.width / rect.height / 2;
    camera.left = center - halfWidth; camera.right = center + halfWidth;
  }
  const restore = () => {
    fields.forEach((field, index) => { camera[field] = values[index]; });
    camera.projectionMatrix.copy(projection); camera.projectionMatrixInverse.copy(inverse);
  };
  try { camera.updateProjectionMatrix(); } catch (error) { restore(); throw error; }
  return restore;
}

/** One existing renderer/scene/light pool. Callbacks run synchronously inside the
 * exact pane. Visibility and projection changes are temporary, including throws.
 * `enterPane(entry,index)` may return cleanup; labels belong to onPaneRendered.
 */
export function renderFloorPanels(renderer, scene, entries, options = {}) {
  const methods = ['getSize', 'getViewport', 'getScissor', 'getScissorTest', 'setViewport', 'setScissor', 'setScissorTest', 'render'];
  if (!renderer || methods.some((name) => typeof renderer[name] !== 'function') || !scene?.isObject3D || typeof scene.traverse !== 'function')
    throw new TypeError('Floor panels need the current renderer and scene.');
  const measured = renderer.getSize(new Vector2());
  const size = options.size || { width: measured.x, height: measured.y };
  if (!validEntries(entries, size, scene)) return { rendered: 0, panes: [], reason: 'invalid_entries' };
  const viewport = renderer.getViewport(new Vector4()).clone(), scissor = renderer.getScissor(new Vector4()).clone();
  const scissorTest = renderer.getScissorTest(), autoClear = renderer.autoClear;
  const shadow = renderer.shadowMap, shadowState = shadow ? { autoUpdate: shadow.autoUpdate, needsUpdate: shadow.needsUpdate } : null;
  const visibility = new Map(), lightShadows = new Map();
  scene.traverse((node) => {
    visibility.set(node, node.visible);
    if (node.isLight && node.shadow) lightShadows.set(node.shadow, node.shadow.needsUpdate);
  });
  const restoreVisibility = () => { for (const [node, visible] of visibility) node.visible = visible; };
  let error = null, rendered = 0, shadowsPrepared = false;
  const attempt = (operation) => { try { operation(); } catch (failure) { error ||= failure; } };
  try {
    renderer.autoClear = false;
    // Clear the complete owned canvas once. Each pane then has its own depth clear.
    renderer.setViewport(0, 0, size.width, size.height);
    renderer.setScissor(0, 0, size.width, size.height); renderer.setScissorTest(true);
    if (options.clear !== false && typeof renderer.clear === 'function') renderer.clear(true, true, true);
    if (shadow?.enabled && (shadowState.autoUpdate || shadowState.needsUpdate)) {
      renderer.setViewport(0, 0, 0, 0); renderer.setScissor(0, 0, 0, 0);
      if (typeof options.prepareShadows === 'function') options.prepareShadows(renderer, scene, entries);
      else renderer.render(scene, entries[0].camera);
      shadowsPrepared = true; restoreVisibility();
    }
    if (shadow) { shadow.autoUpdate = false; shadow.needsUpdate = false; }
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index], { rect, camera } = entry;
      let restoreCamera = null, cleanup = null;
      try {
        restoreCamera = adaptCamera(camera, rect);
        renderer.setViewport(rect.x, size.height - rect.y - rect.height, rect.width, rect.height);
        renderer.setScissor(rect.x, size.height - rect.y - rect.height, rect.width, rect.height);
        renderer.setScissorTest(true);
        for (const candidate of entry.visibility || []) candidate.node.visible = candidate.visible;
        const entered = options.enterPane?.(entry, index);
        if (entered !== undefined && typeof entered !== 'function') throw new TypeError('Pane visibility cleanup must be a function.');
        cleanup = entered || null;
        if (typeof renderer.clearDepth === 'function') renderer.clearDepth();
        renderer.render(scene, camera); rendered++;
        options.onPaneRendered?.(entry, index);
      } catch (failure) { error ||= failure; }
      finally {
        if (cleanup) attempt(cleanup);
        if (restoreCamera) attempt(restoreCamera);
        attempt(restoreVisibility);
      }
      if (error) break;
    }
  } catch (failure) { error ||= failure; }
  finally {
    attempt(restoreVisibility);
    attempt(() => renderer.setViewport(viewport)); attempt(() => renderer.setScissor(scissor));
    attempt(() => renderer.setScissorTest(scissorTest)); renderer.autoClear = autoClear;
    if (shadow) {
      shadow.autoUpdate = shadowState.autoUpdate;
      shadow.needsUpdate = error ? shadowState.needsUpdate || shadowsPrepared : shadowsPrepared ? false : shadowState.needsUpdate;
    }
    if (error) for (const [lightShadow, requested] of lightShadows) lightShadow.needsUpdate = requested;
  }
  if (error) throw error;
  return { rendered, panes: entries.map((entry) => entry.floorId) };
}

/** Lightweight coordinator; it owns no cameras, renderer, scene, timers or DOM. */
export class FloorPanelsRenderer {
  constructor({ getPaneEntries, enterPane, onPaneRendered, prepareShadows } = {}) {
    this.getPaneEntries = getPaneEntries;
    this.enterPane = enterPane; this.onPaneRendered = onPaneRendered; this.prepareShadows = prepareShadows;
  }

  render(renderer, scene, options = {}) {
    const entries = options.entries ?? this.getPaneEntries?.() ?? [];
    return renderFloorPanels(renderer, scene, entries, { enterPane: this.enterPane, onPaneRendered: this.onPaneRendered,
      prepareShadows: this.prepareShadows, ...options });
  }
}
