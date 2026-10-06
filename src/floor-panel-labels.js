// One CSS2DRenderer serves every floor pane. Its later passes hide earlier
// labels, so preserve only the real DOM elements rendered in this frame.
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const dimensions = (rect) => ({ x: rect?.x ?? rect?.left, y: rect?.y ?? rect?.top,
  width: rect?.width ?? rect?.w, height: rect?.height ?? rect?.h });
const sizeOf = (size) => ({ width: size?.width ?? size?.w, height: size?.height ?? size?.h });
const usableSize = (size) => finite(size.width) && finite(size.height) && size.width > 0 && size.height > 0;
const shown = (object) => {
  for (let current = object; current; current = current.parent) if (current.visible === false) return false;
  return true;
};
const renderStyle = (element) => ({ transform: element.style.transform,
  display: element.style.display, zIndex: element.style.zIndex });

export class FloorPanelLabels {
  constructor(renderer, { onSelect } = {}) {
    this.renderer = renderer; this.root = renderer.domElement;
    this.onSelect = typeof onSelect === 'function' ? onSelect : null;
    this.panes = new Map(); this.labels = new Set(); this.frame = new Map();
    this._fullSize = null;
  }

  _releasePane(pane) {
    pane.button.removeEventListener('click', pane.click);
    // A model replacement can already have removed one of these actual nodes.
    // Move only labels which are still inside our pane; never recreate them.
    for (const element of this.labels) if (element.parentNode === pane.clip) this.root.append(element);
    pane.clip.remove();
  }

  begin(entries = []) {
    const before = sizeOf(this.renderer.getSize?.());
    if (usableSize(before)) this._fullSize = before;
    this.frame.clear();
    for (const element of this.labels) {
      if (!element.parentNode) { this.labels.delete(element); continue; }
      if (element.parentNode === this.root || [...this.panes.values()].some((pane) => element.parentNode === pane.clip))
        element.style.display = 'none';
    }
    const accepted = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      const id = entry?.floorId ?? entry?.floor_id, rect = dimensions(entry?.rect);
      if (typeof id !== 'string' || !id.trim() || accepted.has(id) || !finite(rect.x) || !finite(rect.y)
        || !usableSize(rect)) continue;
      accepted.set(id, { entry, rect });
    }
    for (const [id, pane] of this.panes) if (!accepted.has(id)) { this._releasePane(pane); this.panes.delete(id); }
    for (const [id, { entry, rect }] of accepted) {
      let pane = this.panes.get(id);
      if (!pane) {
        const doc = this.root.ownerDocument, clip = doc.createElement('div'), button = doc.createElement('button');
        clip.dataset.taylors3dFloorPane = id; button.dataset.taylors3dUi = ''; button.type = 'button';
        Object.assign(clip.style, { position: 'absolute', overflow: 'hidden', pointerEvents: 'none', boxSizing: 'border-box',
          border: '1px solid var(--taylors3d-ui-divider, var(--divider-color, #58606a))', borderRadius: '8px' });
        Object.assign(button.style, { position: 'absolute', left: '4px', top: '4px', minWidth: '44px', minHeight: '44px',
          maxWidth: 'calc(100% - 8px)', height: '44px', maxHeight: '44px', boxSizing: 'border-box', pointerEvents: 'auto', zIndex: '2147483647',
          padding: '4px 8px', border: '1px solid var(--taylors3d-ui-border, var(--divider-color, #58606a))', borderRadius: '8px', font: 'inherit',
          color: 'var(--taylors3d-ui-text, var(--primary-text-color, #e8eaed))',
          background: 'var(--taylors3d-ui-surface, var(--card-background-color, #18212b))',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' });
        const click = () => this.onSelect?.(id);
        button.addEventListener('click', click); clip.append(button); this.root.append(clip);
        pane = { id, clip, button, click, entry, rect }; this.panes.set(id, pane);
      }
      pane.entry = entry; pane.rect = rect;
      pane.clip.classList.toggle('compact', entry.compact === true);
      Object.assign(pane.clip.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name : id;
      if (pane.button.textContent !== name) pane.button.textContent = name;
      pane.button.title = name;
      pane.button.style.borderColor = entry.active === true
        ? 'var(--taylors3d-ui-amber, var(--primary-color, #03a9f4))'
        : 'var(--taylors3d-ui-border, var(--divider-color, #58606a))';
      pane.button.setAttribute('aria-pressed', String(entry.active === true));
    }
    return this.panes.size;
  }

  render(scene, entry) {
    const id = entry?.floorId ?? entry?.floor_id, pane = this.panes.get(id);
    if (!pane || !entry?.camera) return false;
    try {
      this.renderer.setSize(pane.rect.width, pane.rect.height);
      const root = this.root, descriptor = Object.getOwnPropertyDescriptor(root, 'appendChild'), append = root.appendChild;
      const labels = this.labels;
      const appendCurrent = function (element) {
        // The stock renderer moves every label back to its root. An already
        // correct current pane needs only projection/style updates: retaining
        // its parent also retains native focus without a synthetic focus call.
        if (this === root && labels.has(element) && element.parentNode === pane.clip) return element;
        return append.call(this, element);
      };
      let installed = false;
      try {
        Object.defineProperty(root, 'appendChild', descriptor && Object.hasOwn(descriptor, 'value')
          ? { ...descriptor, value: appendCurrent }
          : { value: appendCurrent, configurable: true, writable: true, enumerable: descriptor?.enumerable ?? false });
        installed = true;
        this.renderer.render(scene, entry.camera);
      } finally {
        if (installed) {
          if (descriptor) Object.defineProperty(root, 'appendChild', descriptor);
          else delete root.appendChild;
        }
      }
      scene.traverse((object) => {
        const element = object.isCSS2DObject && object.element;
        if (!element || !shown(object) || element.hidden || element.style.display === 'none') return;
        // No cloning: native listeners and the exact CSS2DObject survive.
        const saved = { element, pane, style: renderStyle(element) };
        this.frame.set(element, saved); this.labels.add(element);
        if (element.parentNode !== pane.clip) pane.clip.append(element);
      });
      return true;
    } catch (error) {
      this.clear();
      throw error;
    }
  }

  finish(fullSize) {
    const size = sizeOf(fullSize ?? this._fullSize);
    try {
      for (const { element, pane, style } of this.frame.values()) {
        // Removed source nodes and a consumer's deliberately hidden label stay
        // removed/hidden even if an earlier pass once showed them.
        if (!element.parentNode || element.hidden || !this.panes.has(pane.id)
          || element.parentNode !== this.root && ![...this.panes.values()].some((owned) => element.parentNode === owned.clip)) continue;
        if (element.parentNode !== pane.clip) pane.clip.append(element);
        Object.assign(element.style, style);
      }
      if (usableSize(size)) { this.renderer.setSize(size.width, size.height); this._fullSize = size; }
    } catch (error) {
      this.clear();
      throw error;
    }
  }

  clear() {
    for (const pane of this.panes.values()) this._releasePane(pane);
    this.panes.clear(); this.frame.clear(); this.labels.clear();
    if (this._fullSize && usableSize(this._fullSize)) this.renderer.setSize(this._fullSize.width, this._fullSize.height);
  }
}
