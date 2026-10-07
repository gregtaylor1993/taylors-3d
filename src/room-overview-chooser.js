// When room labels would overlap, one native disclosure keeps every real room
// reachable without changing the house viewport or adding a render loop.
export class RoomOverviewChooser {
  constructor(container, { onSelect, onInvalidate } = {}) {
    this.container = container; this.onSelect = onSelect; this.onInvalidate = onInvalidate; this.rows = new Map();
    this.el = document.createElement('div'); this.el.className = 'taylors3d-room-chooser'; this.el.dataset.taylors3dUi = ''; this.el.hidden = true;
    this.toggle = document.createElement('button'); this.toggle.type = 'button'; this.toggle.className = 'taylors3d-room-chooser-toggle';
    this.toggle.setAttribute('aria-expanded', 'false');
    this.list = document.createElement('div'); this.list.className = 'taylors3d-room-chooser-list'; this.list.hidden = true; this.list.setAttribute('role', 'group');
    this.el.append(this.toggle, this.list); container.append(this.el);
    this.toggle.addEventListener('click', () => { this.open = !this.open; this.list.hidden = !this.open;
      this.toggle.setAttribute('aria-expanded', String(this.open)); if (this.open) this.rows.values().next().value?.button.focus(); this.onInvalidate?.(); });
    this.el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.open) { event.preventDefault(); event.stopPropagation(); this.close(true); }
    });
    this.outside = (event) => {
      if (!this.open || event.composedPath().includes(this.el)) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.close(true);
    };
    container.addEventListener('pointerdown', this.outside, true);
  }

  update(rows, { label = 'Rooms', title = 'Choose a room', height = 240, width = 300 } = {}, grouped = false) {
    const keep = new Set(rows.map((row) => row.roomId));
    for (const [id, entry] of this.rows) if (!keep.has(id)) { entry.button.remove(); this.rows.delete(id); }
    for (const row of rows) {
      let entry = this.rows.get(row.roomId);
      if (!entry) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'taylors3d-room-overview';
        const name = document.createElement('strong'), summary = document.createElement('span'); button.append(name, summary);
        entry = { button, name, summary, row }; this.rows.set(row.roomId, entry); this.list.append(button);
        button.addEventListener('click', () => {
          if (!this.open || !button.isConnected || this.el.hidden || this.rows.get(row.roomId) !== entry) return;
          const rect = button.getBoundingClientRect(); this.close(false);
          this.onSelect?.(row.roomId, [rect.left + rect.width / 2, rect.top + rect.height / 2]);
        });
      }
      entry.row = row;
      if (entry.name.textContent !== row.name) entry.name.textContent = row.name;
      if (entry.summary.textContent !== row.summary) entry.summary.textContent = row.summary;
      entry.button.title = `${row.name}: ${row.detail || row.summary}`;
      entry.button.setAttribute('aria-pressed', String(row.selected === true));
    }
    const caption = `${label} · ${rows.length}`;
    if (this.toggle.textContent !== caption) this.toggle.textContent = caption;
    this.list.setAttribute('aria-label', title);
    this.list.style.maxHeight = `${Math.max(96, height - 80)}px`;
    this.list.style.maxWidth = `${Math.max(120, width - 20)}px`;
    this.el.hidden = !grouped || !rows.length;
    if (this.el.hidden) this.close(false);
  }

  close(focus = false) {
    const wasOpen = this.open; this.open = false; this.list.hidden = true; this.toggle.setAttribute('aria-expanded', 'false');
    if (focus && this.toggle.isConnected && !this.el.hidden) this.toggle.focus();
    if (wasOpen) this.onInvalidate?.();
  }

  dispose() { this.container.removeEventListener('pointerdown', this.outside, true); this.el.remove(); this.rows.clear(); }
}

export function overviewLabelsOverlap(points, { width = 156, height = 48 } = {}) {
  for (let first = 0; first < points.length; first++) for (let second = first + 1; second < points.length; second++) {
    const a = points[first], b = points[second];
    if (Math.abs(a[0] - b[0]) < width + 8 && Math.abs(a[1] - b[1]) < height + 8) return true;
  }
  return false;
}
