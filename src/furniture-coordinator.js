// FUTURE card composition only. The actual client owns authenticated transport;
// the card owns layers/history. Nothing fetches during render or saves a draft.
import { FurnitureLibraryClient } from './furniture-library.js';
import { readFurniturePlacement } from './furniture-placement.js';
import { ownFurnitureCaption, copyFurnitureCaption, cloneFurnitureCaptionValue } from './furniture-caption-source.js';
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = cloneFurnitureCaptionValue;
const key = (value) => { try { return JSON.stringify(value); } catch { return null; } };
const messages = Object.freeze({
  unavailable: 'Refresh the furniture library using the current loaded layout and connection.',
  layout: 'Wait for the current layout to finish loading before using the furniture library.',
  session: 'A connected current active Home Assistant account and authenticated downloads are required.',
  admin: 'Import requires a current active administrator in Edit → Furniture with a clean draft.',
  pending: 'Wait for the current furniture ZIP import to finish.',
  stale: 'This furniture action’s layout or session changed. Start a new deliberate action.',
  stale_import: 'This import’s layout or session changed. The server may already have stored the ZIP; refresh the library.',
  published: 'The imported pack is not in the current published catalogue. Refresh the library before placing it.',
  disposed: 'The furniture library coordinator is closed.',
  preview: 'Only a valid current furniture draft can be previewed.',
  loading: 'Loading the current furniture catalogue…',
});
export const FURNITURE_COORDINATOR_MESSAGES = messages;
const failure = (code, extra = {}) => ({ ok: false, diagnostics: [ownFurnitureCaption({ code, message: messages[code] }, 'coordinator', code)], ...extra });
const status = (code, extras = {}) => ownFurnitureCaption({ status: 'unavailable', catalogue: null, message: messages[code], diagnostics: [], ...extras }, 'coordinator', code);

/** FurnitureCoordinator(card,{onChange}).
 * Public stable client is supplied to FurnitureLayer; generation changes fence
 * card-level operations as well as the actual client's asset work. sync() only
 * observes. refresh() is explicit and deduplicated; an import performs one fresh
 * catalogue read before resolving. catalogueSnapshot() and preview return copies.
 * Root supplies furnitureEditorAvailable() for its loaded admin editor context
 * and furnitureImportAvailable() for a clean draft; the latter must NOT reject
 * the editor's own _importPending flag set before its public client call.
 * Root must call sync() on every observed permission/loading/session/layout
 * boundary and clearPreview() before editor/history/model teardown. No timer,
 * renderer, service, raw layout write or filesystem operation is added here.
 */
export class FurnitureCoordinator {
  constructor(card, { onChange = () => {} } = {}) {
    this.card = card; this.onChange = onChange; this.disposed = false; this._allowClient = true;
    this._generation = 0; this._requestId = 0; this._scope = null; this._clientGeneration = null; this._clientReady = false;
    this._refreshOwner = null; this._importOwner = null; this._preview = null; this._previewKey = null; this._notifying = false;
    this._state = status('unavailable');
    this.client = new FurnitureLibraryClient({ getHass: () => this._allowClient && this._readAllowed() ? this.card._hass : null });
    this.sync();
  }
  get generation() { this.sync(); return this._generation; }
  get importing() { this.sync(); return !!this._importOwner; }
  get preview() { this.sync(); return this._preview === null ? null : clone(this._preview); }
  _layoutReady() { return !this.card?._loading && plain(this.card?._layout); }
  _readAllowed() {
    const card = this.card, hass = card?._hass, user = hass?.user;
    return !this.disposed && this._layoutReady() && card?.isConnected === true && hass?.connection?.connected === true
      && typeof user?.id === 'string' && user.id.trim() !== '' && (!Object.hasOwn(user, 'is_active') || user.is_active === true)
      && typeof hass.fetchWithAuth === 'function';
  }
  _hook(name) { try { return typeof this.card?.[name] !== 'function' || this.card[name]() === true; } catch { return false; } }
  _editorAllowed() { return this._clientReady && this._readAllowed() && this.card._hass.user.is_admin === true && this.card._editing === true
    && this.card._edit?.tab === 'furniture' && this._hook('furnitureEditorAvailable'); }
  _importAllowed() { return this._editorAllowed() && this._preview === null && this._hook('furnitureImportAvailable'); }
  _capture() {
    const card = this.card, hass = card?._hass, user = hass?.user;
    return { layout: card?._layout, connection: hass?.connection, auth: hass?.auth, user, fetch: hass?.fetchWithAuth,
      key: key([card?._config?.layout_key, this._layoutReady(), card?.isConnected, hass?.connection?.connected,
        user?.id, user?.is_admin, !!user && Object.hasOwn(user, 'is_active'), user?.is_active, user?.permissions]) };
  }
  _same(a, b, layout = true) { return !!a && !!b && a.key !== null && b.key !== null
    && ['connection', 'auth', 'user', 'fetch', 'key', ...(layout ? ['layout'] : [])].every((field) => a[field] === b[field]); }
  _notify() {
    if (this._notifying) return; this._notifying = true;
    try { this.onChange(); } catch { /* Notification cannot change request ownership or save. */ }
    finally { this._notifying = false; }
  }
  _clearPreview() { const changed = this._preview !== null; this._preview = null; this._previewKey = null; return changed; }
  sync() {
    if (this.disposed) return false;
    const scope = this._capture(), changed = !this._same(this._scope, scope), transportChanged = this._scope && !this._same(this._scope, scope, false);
    if (transportChanged) {
      // auth is intentionally not part of the client's HA-session reader. A
      // public null observation invalidates it without touching private fields
      // or replacing the stable object retained by the renderer layer.
      this._allowClient = false; this.client.revalidate(); this._allowClient = true;
    }
    const allowed = this.client.revalidate(), clientGeneration = this.client.generation; this._clientReady = allowed;
    const clientChanged = this._clientGeneration !== null && this._clientGeneration !== clientGeneration;
    if (changed || clientChanged) {
      this._scope = scope; this._clientGeneration = clientGeneration; this._generation++; this._requestId++;
      this._refreshOwner = null; this._importOwner = null; this._clearPreview();
      // A same-session Save can replace the raw layout object. The immutable
      // global catalogue remains valid, while old UI operation owners do not.
      if (!allowed || transportChanged || clientChanged || this._state.status === 'loading') this._state =
        status(!this._layoutReady() ? 'layout' : allowed ? 'unavailable' : 'session');
      this._notify();
    }
    if (this._importOwner?.valid && !this._importAllowed()) { this._importOwner.valid = false; this._notify(); }
    if (this._preview !== null && !this._editorAllowed()) { this._clearPreview(); this._notify(); }
    return allowed;
  }
  catalogueSnapshot() { this.sync(); return copyFurnitureCaption(this._state, clone({ ...this._state, generation: this._generation,
    refreshing: !!this._refreshOwner, importing: !!this._importOwner })); }
  _owner(kind) { return { id: ++this._requestId, kind, generation: this._generation, clientGeneration: this.client.generation,
    scope: this._capture(), valid: true }; }
  _current(owner) { return !this.disposed && owner.valid && owner.generation === this._generation && owner.clientGeneration === this.client.generation
    && this._same(owner.scope, this._capture()) && this._readAllowed()
    && (owner.kind === 'refresh' ? this._refreshOwner === owner : this._importOwner === owner && this._importAllowed()); }
  refresh() {
    if (!this.sync()) return Promise.resolve(failure(this.disposed ? 'disposed' : this._layoutReady() ? 'session' : 'layout', { catalogue: null }));
    if (this._refreshOwner && this._current(this._refreshOwner)) return this._refreshOwner.promise;
    return this._startRefresh();
  }
  _startRefresh() {
    const owner = this._owner('refresh'); this._refreshOwner = owner;
    owner.promise = Promise.resolve().then(async () => {
      if (!this._current(owner)) return failure('stale', { catalogue: null });
      const result = await this.client.catalogue(); this.sync();
      if (!this._current(owner)) return failure('stale', { catalogue: null });
      this._state = result.ok ? { status: 'ready', catalogue: clone(result.catalogue), message: '', diagnostics: [] }
        : copyFurnitureCaption(result.diagnostics[0], { status: 'error', catalogue: null,
          message: result.diagnostics[0]?.message || messages.unavailable, diagnostics: clone(result.diagnostics) });
      this._notify(); return clone(result);
    }).finally(() => { if (this._refreshOwner === owner) { this._refreshOwner = null; this._notify(); } });
    if (!this._state.catalogue) this._state = status('loading', { status: 'loading' });
    this._notify(); return owner.promise;
  }
  importPack(file) {
    if (!this.sync()) return Promise.resolve(failure(this.disposed ? 'disposed' : this._layoutReady() ? 'session' : 'layout',
      { imported: false, pack: null, publicationMayHaveOccurred: false }));
    if (this._importOwner) return Promise.resolve(failure('pending', { imported: false, pack: null, publicationMayHaveOccurred: false }));
    if (!this._importAllowed()) return Promise.resolve(failure(this.disposed ? 'disposed' : !this._layoutReady() ? 'layout' : 'admin',
      { imported: false, pack: null, publicationMayHaveOccurred: false }));
    const owner = this._owner('import'); this._importOwner = owner;
    owner.promise = Promise.resolve().then(async () => {
      if (!this._current(owner)) return failure('stale', { imported: false, pack: null, publicationMayHaveOccurred: false });
      const result = await this.client.importPack(file); this.sync();
      if (!this._current(owner)) return failure('stale_import', { imported: result.imported === true, pack: null, publicationMayHaveOccurred: true });
      if (!result.ok) return clone(result);
      // A fresh read is required; an older read already in flight cannot prove
      // that the server's accepted immutable pack is now published.
      const refreshed = await this._startRefresh(); this.sync();
      if (!this._current(owner)) return failure('stale_import', { imported: result.imported === true, pack: null, publicationMayHaveOccurred: true });
      if (!refreshed.ok) return { ...clone(refreshed), imported: result.imported === true, pack: null, publicationMayHaveOccurred: true };
      if (!refreshed.catalogue.packs.some((pack) => pack.pack_id === result.pack.pack_id))
        return failure('published', { imported: result.imported === true, pack: null, publicationMayHaveOccurred: true });
      return { ...clone(result), catalogue: clone(refreshed.catalogue), publicationMayHaveOccurred: true };
    }).finally(() => { if (this._importOwner === owner) { this._importOwner = null; this._notify(); } });
    this._notify(); return owner.promise;
  }
  previewDraft(raw) {
    if (raw === null) return this.clearPreview();
    this.sync(); if (!this._editorAllowed() || this._importOwner || !plain(raw) || !readFurniturePlacement(raw).valid) return false;
    let value, valueKey; try { value = clone(raw); valueKey = key(value); } catch { return false; }
    if (valueKey === null) return false; if (valueKey === this._previewKey) return true;
    this._preview = value; this._previewKey = valueKey; this._notify(); return true;
  }
  clearPreview() { const changed = this._clearPreview(); if (changed) this._notify(); return changed; }
  dispose() {
    if (this.disposed) return; this.disposed = true; this._generation++; this._requestId++;
    this._refreshOwner = null; this._importOwner = null; this._clearPreview(); this.client.dispose();
    this._state = status('disposed', { diagnostics: failure('disposed').diagnostics }); this._notify();
  }
}
