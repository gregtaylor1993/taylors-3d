// Session-only history for saved layout/card configuration. Never pass live hass states or actions.
// Snapshots use the same JSON representation as persistence and are copied at every public boundary.
const DEFAULT_LIMIT = 100;
const DEFAULT_BYTES = 8 * 1024 * 1024;

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

const copy = (value) => JSON.parse(JSON.stringify(value));

function entry(snapshot, label) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('History needs a configuration snapshot');
  const state = copy(snapshot);
  const signature = canonical(state);
  return { state, signature, label: String(label || 'Edit'), bytes: new TextEncoder().encode(signature).length };
}

export class EditHistory {
  constructor({ limit = DEFAULT_LIMIT, maxBytes = DEFAULT_BYTES } = {}) {
    this.limit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : DEFAULT_LIMIT;
    this.maxBytes = Number.isFinite(maxBytes) ? Math.max(1, Math.floor(maxBytes)) : DEFAULT_BYTES;
    this.reset();
  }

  // A new load/layout key starts a new history. Importing an editable layout uses record instead.
  reset(snapshot = null) {
    const seed = snapshot === null ? null : entry(snapshot, 'Loaded configuration');
    this._entries = seed ? [seed] : [];
    this._index = seed ? 0 : -1;
    this._transaction = null;
  }

  get _current() { return this._transaction?.latest || this._entries[this._index] || null; }
  get current() { return this._current ? copy(this._current.state) : null; }
  get grouping() { return !!this._transaction; }
  get canUndo() { return !!(this._transaction?.changed || this._index > 0); }
  get canRedo() { return !this._transaction?.changed && this._index >= 0 && this._index < this._entries.length - 1; }
  get undoLabel() { return this._transaction?.changed ? this._transaction.label : this._index > 0 ? this._entries[this._index].label : ''; }
  get redoLabel() { return this.canRedo ? this._entries[this._index + 1].label : ''; }
  get size() { return Math.max(0, this._entries.length - 1); }
  get bytes() { return this._entries.reduce((sum, item) => sum + item.bytes, 0); }

  // Repeated identical commits do not consume history or destroy a redo branch.
  record(snapshot, label = 'Edit') {
    const next = entry(snapshot, this._transaction?.label || label);
    if (!this._current) { this.reset(snapshot); return false; }
    if (next.signature === this._current.signature) return false;
    if (this._transaction) {
      this._transaction.latest = next;
      this._transaction.changed = next.signature !== this._entries[this._index].signature;
      return true;
    }
    this._append(next);
    return true;
  }

  begin(label = 'Edit') {
    if (!this._current || this._transaction) return false;
    this._transaction = { label: String(label || 'Edit'), latest: this._current, changed: false };
    return true;
  }

  // One pointer/slider gesture becomes one entry, even if it saved many intermediate positions.
  end(snapshot) {
    if (!this._transaction) return false;
    if (snapshot !== undefined) this.record(snapshot);
    const transaction = this._transaction;
    this._transaction = null;
    if (!transaction.changed) return false;
    this._append(transaction.latest);
    return true;
  }

  // The caller may apply this return value to cancel an in-progress configuration gesture.
  cancel() {
    if (!this._transaction) return null;
    this._transaction = null;
    return this.current;
  }

  undo() {
    this.end();
    if (!this.canUndo) return null;
    this._index--;
    return this.current;
  }

  redo() {
    this.end();
    if (!this.canRedo) return null;
    this._index++;
    return this.current;
  }

  _append(next) {
    this._entries = this._entries.slice(0, this._index + 1);
    this._entries.push(next);
    // Keep the current snapshot even if it alone exceeds the budget; it simply has no undo.
    let bytes = this.bytes;
    while (this._entries.length > 1 && (this._entries.length > this.limit + 1 || bytes > this.maxBytes)) {
      bytes -= this._entries.shift().bytes;
    }
    this._index = this._entries.length - 1;
  }
}

// Respect native editing inside HA controls, including inputs within shadow roots.
export function isNativeEditing(event) {
  const composed = event.composedPath?.();
  const path = composed?.length ? composed : [event.target];
  return path.some((node) => /^(INPUT|SELECT|TEXTAREA)$/.test(node?.tagName || '')
    || node?.isContentEditable || ['true', '', 'plaintext-only'].includes(node?.getAttribute?.('contenteditable'))
    || ['textbox', 'combobox'].includes(node?.getAttribute?.('role')));
}

export function historyShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || isNativeEditing(event)) return null;
  const key = String(event.key || '').toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y') return 'redo';
  return null;
}
