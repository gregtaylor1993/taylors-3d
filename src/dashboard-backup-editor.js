// Edit → Data full-dashboard backup controls. The existing single-layout JSON
// controls remain separate because they do not contain a complete dashboard.
import { DashboardBackupClient } from './dashboard-backup-client.js';
import { DashboardBackupExportClient } from './dashboard-backup-export.js';
import { DashboardRestoreClient } from './dashboard-restore-client.js';
import { collectDashboardReferences, resolveDashboardReferences } from './dashboard-backup-references.js';
import { localize, localeInfo } from './localization.js';
import wizardCaptions from './translations/dashboard-backup-wizard.js';
import referenceCaptions from './translations/dashboard-backup-references.js';

const P = 'dashboard-backup-', esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slug = (v) => typeof v === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/.test(v);
const dump = (v) => { try { return JSON.stringify(v, null, 2); } catch { return 'Unreadable static data'; } };
const activeUser = (h) => typeof h?.user?.id === 'string' && !!h.user.id.trim() && (!Object.hasOwn(h.user, 'is_active') || h.user.is_active === true);
const errorMessage = (r) => r?.diagnostics?.map((d) => d.message).join(' ') || 'The operation could not be completed.';

/** constructor(card,onRender), render/change(input)/click(button), aliases
 * onInput/onChange/onClick/updatePreviews, setActive/onStates/revalidate/reset/
 * dispose. Parent calls setActive(tab==='data') and updatePreviews after render;
 * calls onStates on every HA setter and reset on history/source changes.
 * No root layout commits, card instantiation, resources or automatic publication.
 * Default is explicitly HA's default dashboard (null), not a browser URL guess.
 */
export class DashboardBackupEditor {
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.active = false; this.disposed = false; this._version = 0; this._root = null; this._base = null;
    this._urls = new Map(); this._pressed = new Map(); this._intents = new WeakMap();
    // Clients re-read this at every await, so a tab/source/frame loss cannot
    // slip through merely because the parent has not called onStates yet.
    const getHass = () => this.canRead && (!this._operationContext || this._same(this._operationContext, this._context())) ? this.card._hass : null;
    this._getHass = getHass;
    this.reader = new DashboardBackupClient({ getHass });
    this.exporter = new DashboardBackupExportClient({ getHass, isCurrent: () => this.canRead,
      getStorage: () => this.card.ownerDocument?.defaultView?.localStorage ?? globalThis.localStorage });
    this.restorer = new DashboardRestoreClient({ getHass }); this._clear();
    this._handlers = new Map([['pointerdown', (e) => this._press(e)], ['pointerup', (e) => this._release(e)], ['pointercancel', (e) => this._cancelPress(e)],
      ['keydown', (e) => this._key(e)], ['keyup', (e) => this._release(e)], ['focusout', (e) => this._cancelPress(e)]]);
  }
  get canRead() { return !this.disposed && this.active && this.card.isConnected === true && this.card._editing === true && this.card._edit?.tab === 'data'
    && !!this.card._layout && !this.card._loading && this.card._hass?.connection?.connected === true && activeUser(this.card._hass); }
  get canRestore() { return this.canRead && this.card._hass.user.is_admin === true; }
  _context() { const h = this.card._hass; return { layout: this.card._layout, config: this.card._config, root: this.card._view?.model?.root,
    connection: h?.connection, auth: h?.auth, connectionAuth: h?.connection?.options?.auth, user: h?.user, ws: h?.callWS, fetch: h?.fetchWithAuth,
    flags: dump([h?.user?.id, h?.user?.is_admin, h?.user?.is_active, h?.user?.permissions, this.card.isConnected, this.active, this.card._editing,
      this.card._edit?.tab, this.card._loading, this.card._config?.layout_key, this.card._config?.model, this.card._layout?.model, this.card._modelAlign?.(), this.canRead]) }; }
  _same(a, b) { return !!a && !!b && Object.keys(a).every((key) => a[key] === b[key]); }
  _text(key, params = {}, language = localeInfo(this.card._hass).resolved) {
    const name = `dashboardBackup.${key}`, fallback = wizardCaptions[language]?.[name] ?? wizardCaptions.en[name] ?? '';
    return language === 'en' ? fallback.replace(/\{([A-Za-z_]+)\}/g, (match, id) => ['string', 'number', 'boolean'].includes(typeof params[id]) ? String(params[id]) : match)
      : localize(this.card._hass, name, params, fallback);
  }
  _caption(key, params = {}, tag = 'span', attributes = '', language) {
    return `<${tag} data-backup-wizard-text="${key}" data-backup-wizard-params="${esc(JSON.stringify(params))}" ${attributes}>${esc(this._text(key, params, language))}</${tag}>`;
  }
  _syncCaptions(section) {
    for (const node of section.querySelectorAll('[data-backup-wizard-text]')) {
      const value = this._text(node.dataset.backupWizardText, JSON.parse(node.dataset.backupWizardParams || '{}'));
      if (node.textContent !== value) node.textContent = value;
    }
  }
  _setMessage(parts) {
    const captions = typeof parts === 'string' ? [{ key: parts }] : parts;
    this.message = captions.map((part) => part.key ? this._text(part.key, part.params, 'en') : part.literal || '').join('');
    this._messageCaption = { source: this.message, captions };
  }
  _displayMessage() {
    return this._messageCaption?.source === this.message ? this._messageCaption.captions.map((part) => part.key ? this._text(part.key, part.params) : part.literal || '').join('') : this.message;
  }
  _clear() { this.selectedPath = null; this.dashboards = []; this.collection = null; this.file = null; this.blob = null; this.complete = null;
    this.inspection = null; this.inspectToken = null; this.stage = null; this.stageToken = null; this.publication = null; this.provenance = [];
    this.namespace = ''; this.reviewed = false; this.partial = false; this.includeUserFallback = false; this.includeBrowserFallback = false; this.busy = false; this._mutationMayHaveStarted = false; this.message = '';
    this.environmentReport = null; this._referenceSource = null; this._referenceGraph = null; }
  _revokeDownloads() { for (const [url, timer] of this._urls) { clearTimeout(timer); URL.revokeObjectURL(url); } this._urls.clear(); }
  _cancelWork() { this.reader.dispose(); if (!this.disposed) this.reader = new DashboardBackupClient({ getHass: this._getHass });
    this.exporter.cancel(); this.restorer.cancel(); this._operationContext = null; this._revokeDownloads(); this._version++; for (const intent of this._pressed.values()) intent.poisoned = true; }
  setActive(value) { const active = value === true; if (active === this.active) return; this.active = active; this.reset(); }
  reset() { const copying = this._copyMayRemain || this._mutationMayHaveStarted || !!this.stage || !!this.publication?.orphans?.length;
    this._copyMayRemain = copying; this._cancelWork(); this._clear();
    if (copying) this._setMessage('cleared');
    this._base = this._context(); if (this._root) this.updatePreviews(this._root); }
  revalidate() {
    if (this.disposed) return false; this.reader.revalidate(); this.exporter.revalidate(); this.restorer.revalidate();
    const context = this._context(); if (!this._base) this._base = context;
    else if (!this._same(this._base, context)) {
      const copying = this._copyMayRemain || this._mutationMayHaveStarted || !!this.stage || !!this.publication?.orphans?.length;
      this._copyMayRemain = copying; this._cancelWork(); this._clear();
      this._setMessage([{ key: 'changed' }, ...(copying ? [{ key: 'copyingReview' }] : [])]);
      this._base = context;
      // Every observed change still cancels requests and poisons old gestures.
      // Only the visible Data screen owns a parent redraw: rebuilding another
      // tab would replace its native held controls and lose their intent fence.
      if (this.active && this.card._editing === true && this.card._edit?.tab === 'data') this.onRender(); }
    this._syncEnvironment(this._root); this._revalidatePresses(); return this.canRead;
  }
  onStates() { this.revalidate(); this.updatePreviews(this._root); }
  _missingLayouts() { return this.inspection?.report?.diagnostics?.some((d) => ['layout_missing', 'layout_key'].includes(d.code)) === true; }
  _allowed(kind) {
    if (kind === 'cancel') return true; if (!this.canRead || this.busy) return false;
    if (kind === 'list') return true;
    if (['read', 'export'].includes(kind)) return this.selectedPath === null || this.dashboards.some((d) => d.url_path === this.selectedPath);
    if (kind === 'download') return !!this.blob && (this.complete === true || this.partial);
    if (!this.canRestore) return false;
    if (kind === 'inspect') return !!this.file;
    if (kind === 'prepare') return !!this.inspectToken && this.reviewed && slug(this.namespace) && !this._missingLayouts() && (this.inspection?.report.complete === true || this.partial);
    if (kind === 'create') return !!this.stageToken && this.stage?.namespace === this.namespace && this.reviewed;
    return false;
  }
  _current(version, context) { return !this.disposed && version === this._version && this.canRead && this._same(context, this._context()); }
  async _operation(kind, work) {
    this.revalidate(); if (!this._allowed(kind)) return false;
    const context = this._context(), version = ++this._version; this._operationContext = context; this._mutationMayHaveStarted = ['prepare', 'create'].includes(kind);
    this.busy = true; this._setMessage('working'); this.updatePreviews(this._root);
    const check = () => { if (!this._current(version, context)) throw new Error('stale'); };
    try { await work(check); check(); this._mutationMayHaveStarted = false; }
    catch { if (this._current(version, context)) this._setMessage([{ key: 'stopped' }, ...(this._mutationMayHaveStarted ? [{ key: 'copyingStopped' }] : [])]); }
    finally { if (version === this._version) { this.busy = false; this._operationContext = null; this._version++; this.onRender(); } }
    return true;
  }
  listDashboards() { return this._operation('list', async (check) => { const result = await this.reader.dashboards(); check();
    if (!result.ok) { this.message = errorMessage(result); return; } this.dashboards = result.dashboards; this._setMessage('chooseDashboard'); }); }
  readDashboard() { return this._operation('read', async (check) => { const result = await this.reader.collect(this.selectedPath); check();
    this.collection = result.ok ? result : null; if (result.ok) this._setMessage('snapshot'); else this.message = errorMessage(result); }); }
  exportBackup() { return this._operation('export', async (check) => {
    this._revokeDownloads(); this.blob = null; this.file = null; this.complete = null; this.inspection = null; this.inspectToken = null; this.stage = null; this.stageToken = null; this.publication = null; this.reviewed = false; this.partial = false; this.restorer.cancel();
    const result = await this.exporter.create(this.selectedPath, { includeUserFallback: this.includeUserFallback, includeBrowserFallback: this.includeBrowserFallback }); check();
    if (!result.ok) { this.message = errorMessage(result); return; }
    this.collection = result.collection; this.provenance = result.provenance; this.blob = result.blob; this.complete = result.complete;
    this._setMessage(result.complete ? 'zipComplete' : 'zipIncomplete');
    if (this.canRestore) { const inspected = await this.restorer.inspect(this.blob); check(); if (inspected.ok) {
      if (inspected.inspection.report.complete !== result.complete) { this.blob = null; this._setMessage('disagreement'); return; }
      this.inspection = inspected.inspection; this.inspectToken = inspected.token;
    } else this._setMessage([...(this._messageCaption?.source === this.message ? this._messageCaption.captions : [{ literal: this.message }]), { key: 'inspectionUnavailable', params: { error: errorMessage(inspected) } }]); }
  }); }
  inspectBackup() { return this._operation('inspect', async (check) => {
    this._revokeDownloads(); this.blob = null; this.inspection = null; this.inspectToken = null; this.stage = null; this.stageToken = null; this.publication = null; this.reviewed = false; this.partial = false;
    const result = await this.restorer.inspect(this.file); check();
    if (!result.ok) { this.message = errorMessage(result); return; }
    this.inspection = result.inspection; this.inspectToken = result.token; this.complete = result.inspection.report.complete;
    this._setMessage('inspected');
  }); }
  prepareCopy() { return this._operation('prepare', async (check) => {
    this.stage = null; this.stageToken = null; this.publication = null;
    const result = await this.restorer.stage(this.inspectToken, { namespace: this.namespace, previewApproved: this.reviewed, allowIncomplete: this.partial }); check();
    if (!result.ok) { this.publication = result; this.message = errorMessage(result) + ' ' + (result.guidance || 'No dashboard was published.'); return; }
    this.stage = result.stage; this.stageToken = result.token; this._setMessage('prepared');
  }); }
  createDashboard() { return this._operation('create', async (check) => {
    const token = this.stageToken; this.stageToken = null;
    const result = await this.restorer.publish(token, { namespace: this.namespace, approved: true }); check(); this.publication = result;
    this.message = result.ok ? result.guidance : errorMessage(result) + ' ' + (result.guidance || 'No automatic retry will run.');
  }); }
  downloadZip() {
    this.revalidate(); if (!this._allowed('download')) return false;
    const doc = this._root?.ownerDocument ?? this.card.ownerDocument; if (!doc || typeof URL.createObjectURL !== 'function') { this._setMessage('downloadUnavailable'); this.onRender(); return false; }
    const url = URL.createObjectURL(this.blob), link = doc.createElement('a'); link.href = url; link.download = 'taylors3d-dashboard-backup.zip';
    doc.body.append(link); link.click(); link.remove(); const timer = setTimeout(() => { URL.revokeObjectURL(url); this._urls.delete(url); }, 1000); this._urls.set(url, timer); return true;
  }
  _staticHtml() {
    const report = this.inspection?.report, source = this.inspection?.preview.dashboard ?? this.collection?.dashboard;
    // The cached HTML uses fixed English source text. Locale updates only marked
    // captions in place, keeping open details/summary focus and raw JSON nodes.
    const caption = (key, params = {}, tag = 'span', attributes = '') => this._caption(key, params, tag, attributes, 'en');
    return `${source ? `<details>${caption('static', {}, 'summary')}<pre data-dashboard-backup-config>${esc(dump(source))}</pre></details>` : ''}
      ${report ? `${caption('counts', { cards: report.counts.cards, layouts: report.counts.layouts, models: report.counts.models, packs: report.counts.furniture_packs }, 'p', 'data-dashboard-backup-counts')}
        <p>${caption(report.complete ? 'complete' : 'incomplete')} ${caption('completenessHelp')}</p>
        <details open>${caption('dependencies', {}, 'summary')}<ul>${report.diagnostics.map((d) => `<li>${esc(d.message)} <code>${esc(d.path)}</code></li>`).join('') || caption('noMissing', {}, 'li')}</ul></details>
        <details>${caption('verified', {}, 'summary')}<pre>${esc(dump({ report, resources: this.inspection.manifest.resources }))}</pre></details>` : ''}
      ${this.collection?.diagnostics?.length ? `<details>${caption('warnings', {}, 'summary')}<ul>${this.collection.diagnostics.map((d) => `<li>${esc(d.message)}</li>`).join('')}</ul></details>` : ''}
      ${this.provenance.length ? `<details>${caption('origins', {}, 'summary')}<ul>${this.provenance.map((p) => `<li><code>${esc(p.key)}</code>: ${esc(p.backend)}. ${esc(p.note)}</li>`).join('')}</ul></details>` : ''}
      ${this._missingLayouts() ? caption('missingLayouts', {}, 'p', 'role="status"') : ''}
      ${this.stage ? `<p>${caption('preparedAddress')} <code>${esc(this.stage.target_dashboard.url_path)}</code>. ${caption('preparedHelp')}</p>` : ''}
      ${this.publication?.orphans?.length ? `<details>${caption('orphans', {}, 'summary')}<pre>${esc(dump(this.publication.orphans))}</pre></details>` : ''}
      ${this._newDashboardLink()}`;
  }
  _newDashboardLink() { const row = this.publication?.createdDashboard, prefix = 'taylors3d-restore-'; return this.canRestore && typeof row?.id === 'string' && row.id.trim()
    && typeof row.url_path === 'string' && row.url_path.startsWith(prefix) && slug(row.url_path.slice(prefix.length))
    ? `<p>${this._caption('openCreated', {}, 'a', `data-dashboard-backup-created href="/${esc(encodeURIComponent(row.url_path))}"`, 'en')}</p>` : ''; }
  render() {
    if (this.disposed) return ''; this.revalidate();
    return `<section data-dashboard-backup-editor data-taylors3d-ui="dashboard-backup"><style>
      [data-dashboard-backup-editor]{min-width:0;color:var(--taylors3d-ui-text,var(--primary-text-color,#212121));overflow-wrap:anywhere}
      [data-dashboard-backup-editor] label{display:flex;flex-direction:column;gap:6px;margin:12px 0}
      [data-dashboard-backup-editor] input,[data-dashboard-backup-editor] select,[data-dashboard-backup-editor] button{min-height:44px;max-width:100%;box-sizing:border-box;font:inherit;color:inherit;background:var(--taylors3d-ui-surface,var(--ha-card-background,var(--card-background-color,#fff)));border:1px solid var(--divider-color,#767676);border-radius:8px;padding:8px 12px}
      [data-dashboard-backup-editor] input[type=checkbox]{width:44px;height:44px;flex:none}
      [data-dashboard-backup-editor] .db-check{flex-direction:row;align-items:center}
      [data-dashboard-backup-editor] .db-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
      [data-dashboard-backup-editor] :focus-visible{outline:3px solid var(--primary-color,#087ea4);outline-offset:3px}
      [data-dashboard-backup-editor] pre{max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
      [data-dashboard-backup-editor] :disabled{opacity:.55}
    </style>${this._caption('title', {}, 'h3')}${this._caption('intro', {}, 'p')}
      <label>${this._caption('dashboard')}<select data-field="${P}dashboard"><option value="default" ${this.selectedPath === null ? 'selected' : ''}>${esc(this._text('default'))}</option>${this.dashboards.map((d) => `<option value="path:${esc(d.url_path)}" ${d.url_path === this.selectedPath ? 'selected' : ''}>${esc(d.title || d.url_path)} (${esc(d.url_path)})</option>`).join('')}</select></label>
      <div class="db-actions">${this._caption('list', {}, 'button', `type="button" data-act="${P}list"`)}${this._caption('read', {}, 'button', `type="button" data-act="${P}read"`)}</div>
      <label class="db-check"><input type="checkbox" data-field="${P}user" ${this.includeUserFallback ? 'checked' : ''}>${this._caption('user')}</label>
      <label class="db-check"><input type="checkbox" data-field="${P}browser" ${this.includeBrowserFallback ? 'checked' : ''}>${this._caption('browser')}</label>${this._caption('fallbackHelp', {}, 'p')}
      <div class="db-actions">${this._caption('export', {}, 'button', `type="button" data-act="${P}export"`)}${this._caption('download', {}, 'button', `type="button" data-act="${P}download"`)}</div>
      ${this._caption('restoreTitle', {}, 'h3')}${this._caption('restoreHelp', {}, 'p')}
      <label>${this._caption('file')}<input type="file" accept="application/zip,.zip" data-field="${P}file"></label>${this._caption('inspect', {}, 'button', `type="button" data-act="${P}inspect"`)}
      <label>${this._caption('namespace')}<input type="text" maxlength="24" data-field="${P}namespace" value="${esc(this.namespace)}" autocomplete="off"></label>
      <label class="db-check"><input type="checkbox" data-field="${P}reviewed" ${this.reviewed ? 'checked' : ''}><span data-dashboard-backup-reference-review>${esc(this._referenceText('review'))}</span></label>
      <label class="db-check"><input type="checkbox" data-field="${P}partial" ${this.partial ? 'checked' : ''}>${this._caption('partial')}</label>
      <div class="db-actions">${['prepare', 'create', 'cancel'].map((key) => this._caption(key, {}, 'button', `type="button" data-act="${P}${key}"`)).join('')}</div>
      <p data-dashboard-backup-status role="status">${esc(this._displayMessage() || this._text(!this.canRead ? 'openData' : !this.canRestore ? 'reader' : 'empty'))}</p>
      <div data-dashboard-backup-static>${this._staticHtml()}</div>
      <section data-dashboard-backup-environment hidden><h4 data-reference-caption="title"></h4><p data-reference-caption="explanation"></p>
      <p data-reference-counts></p><details open><summary data-reference-caption="knownPaths"></summary><ul data-reference-list></ul></details>
      <details open><summary data-reference-caption="uninspected"></summary><ul data-reference-omissions></ul></details>
      <p data-reference-caption="scope"></p></section></section>`;
  }
  updatePreviews(root = this._root) {
    const section = root?.matches?.('[data-dashboard-backup-editor]') ? root : root?.querySelector?.('[data-dashboard-backup-editor]'); if (!section || this.disposed) return;
    this._bind(section); this.revalidate();
    this._syncFields(section);
    for (const button of section.querySelectorAll('button[data-act]')) button.disabled = !this._allowed(button.dataset.act.slice(P.length));
    for (const input of section.querySelectorAll('input,select')) { const key = input.dataset.field?.slice(P.length);
      input.disabled = !this.canRead || this.busy || ['file', 'namespace', 'reviewed'].includes(key) && !this.canRestore;
    }
    section.querySelector('[data-dashboard-backup-status]').textContent = this._displayMessage() || this._text(!this.canRestore ? 'exportOnly' : 'empty');
    const content = section.querySelector('[data-dashboard-backup-static]'), html = this._staticHtml();
    // Browser HTML serialization can change entity spelling. Cache the source
    // string rather than replacing details/summary focus on each HA update.
    if (content !== this._staticNode || html !== this._staticCache) { content.innerHTML = html; this._staticNode = content; this._staticCache = html; }
    this._syncCaptions(section);
    this._syncEnvironment(section);
    this._revalidatePresses();
  }
  _referenceText(key, params = {}) {
    const full = 'edit.data.references.' + key, language = localeInfo(this.card._hass).resolved;
    return localize(this.card._hass, full, params, referenceCaptions[language]?.[full] ?? referenceCaptions.en[full] ?? referenceCaptions.en['edit.data.references.omission']);
  }
  _syncEnvironment(section) {
    const source = this.inspection?.preview ?? this.collection;
    if (source !== this._referenceSource) { this._referenceSource = source; this._referenceGraph = source ? collectDashboardReferences(source) : null; }
    this.environmentReport = this._referenceGraph ? resolveDashboardReferences(this._referenceGraph, this.card._hass) : null;
    if (!section) return;
    const host = section.querySelector('[data-dashboard-backup-environment]'); if (!host) return;
    host.hidden = !this.environmentReport;
    const review = section.querySelector('[data-dashboard-backup-reference-review]'); if (review) review.textContent = this._referenceText('review');
    if (!this.environmentReport) return;
    const report = this.environmentReport, key = JSON.stringify([localeInfo(this.card._hass).key, report.uninspected,
      report.references.map((r) => [r.kind, r.id, r.status, r.reading, r.hidden, r.disabled, r.category])]);
    if (host === this._referenceHost && this._referenceRenderedGraph === this._referenceGraph && key === this._referenceRenderKey) return;
    this._referenceHost = host; this._referenceRenderedGraph = this._referenceGraph; this._referenceRenderKey = key;
    for (const caption of host.querySelectorAll('[data-reference-caption]')) caption.textContent = this._referenceText(caption.dataset.referenceCaption);
    host.querySelector('[data-reference-counts]').textContent = this._referenceText('counts', this.environmentReport.counts);
    const referenceLabel = (row) => [row.id, this._referenceText(row.status),
      ...(['no_state', 'unavailable', 'restored', 'unknown', 'invalid', 'not_loaded'].includes(row.reading) ? [this._referenceText(row.reading)] : []),
      ...(row.hidden ? [this._referenceText('hidden')] : []), ...(row.disabled ? [this._referenceText('disabled')] : []),
      ...(row.category ? [this._referenceText('category') + ': ' + row.category] : []), row.path].join(' · ');
    const sync = (list, rows, text) => {
      const existing = new Map([...list.children].map((node) => [node.dataset.referenceKey, node])), keep = new Set();
      for (const row of rows) {
        const key = JSON.stringify([row.kind || row.code, row.path, row.id]), node = existing.get(key) || list.ownerDocument.createElement('li');
        node.dataset.referenceKey = key; const value = text(row); if (node.textContent !== value) node.textContent = value;
        if (!list.contains(node)) list.append(node); keep.add(node);
      }
      for (const node of [...list.children]) if (!keep.has(node)) node.remove();
    };
    sync(host.querySelector('[data-reference-list]'), report.references.length ? report.references : [{ code: 'none', path: '' }], (row) => row.id ? referenceLabel(row) : this._referenceText('none'));
    sync(host.querySelector('[data-reference-omissions]'), report.uninspected, (row) => this._referenceText(['registry_not_loaded', 'limit', 'unsafe'].includes(row.code) ? row.code : 'omission') + ' · ' + row.path);
  }
  _syncFields(section) {
    const select = section.querySelector(`[data-field="${P}dashboard"]`);
    if (select) {
      const rows = [{ value: 'default', label: this._text('default'), disabled: false },
        ...this.dashboards.map((row) => ({ value: 'path:' + row.url_path, label: `${row.title || row.url_path} (${row.url_path})`, disabled: false }))];
      if (this.selectedPath !== null && !this.dashboards.some((row) => row.url_path === this.selectedPath)) {
        rows.push({ value: 'path:' + this.selectedPath, label: this._text('unavailableDashboard', { path: this.selectedPath }), disabled: true });
      }
      const options = [...select.options];
      if (options.length !== rows.length || rows.some((row, i) => row.value !== options[i]?.value
        || row.label !== options[i]?.textContent || row.disabled !== options[i]?.disabled)) {
        const existing = new Map(options.map((option) => [option.value, option]));
        select.replaceChildren(...rows.map((row) => {
          const option = existing.get(row.value) ?? section.ownerDocument.createElement('option');
          option.value = row.value; option.textContent = row.label; option.disabled = row.disabled; return option;
        }));
      }
      const value = this.selectedPath === null ? 'default' : 'path:' + this.selectedPath;
      if (select.value !== value) select.value = value;
    }
    // Input events already copy exact native text into these draft fields.
    // Equal updates do nothing; an intentional reset/context loss clears the
    // retained nodes instead of leaving old visible consent/name values.
    const values = { namespace: this.namespace, reviewed: this.reviewed, partial: this.partial,
      user: this.includeUserFallback, browser: this.includeBrowserFallback };
    for (const [key, value] of Object.entries(values)) {
      const input = section.querySelector(`[data-field="${P}${key}"]`); if (!input) continue;
      if (input.type === 'checkbox') { if (input.checked !== value) input.checked = value; }
      else if (input.value !== value) input.value = value;
    }
    const file = section.querySelector(`[data-field="${P}file"]`);
    if (!this.file && file?.value) file.value = '';
  }
  change(input) {
    const key = input?.dataset?.field?.startsWith(P) ? input.dataset.field.slice(P.length) : null; if (!key) return false;
    this.revalidate(); if (!this.canRead || this.busy || ['file', 'namespace', 'reviewed'].includes(key) && !this.canRestore) return true;
    if (key === 'namespace') this.namespace = input.value;
    else if (key === 'reviewed') this.reviewed = input.checked === true;
    else if (key === 'partial') this.partial = input.checked === true;
    else if (key === 'user' || key === 'browser') { this[key === 'user' ? 'includeUserFallback' : 'includeBrowserFallback'] = input.checked === true;
      this._revokeDownloads(); this.blob = null; this.complete = null; this.inspection = null; this.inspectToken = null; this.restorer.cancel(); }
    else if (key === 'dashboard') {
      const path = input.value === 'default' ? null : input.value.startsWith('path:') ? input.value.slice(5) : undefined;
      if (path === undefined || path !== null && !this.dashboards.some((d) => d.url_path === path)) return true;
      this.selectedPath = path; this.collection = null; this.blob = null; this.inspection = null; this.inspectToken = null; this.restorer.cancel();
    } else if (key === 'file') {
      this.file = input.files?.length === 1 ? input.files[0] : null; this._revokeDownloads(); this.collection = null; this.provenance = []; this.blob = null;
      this.inspection = null; this.inspectToken = null; this.reviewed = false; this.partial = false; this.restorer.cancel();
    } else return false;
    this.stage = null; this.stageToken = null;
    // Keep a previous failed/partial attempt visible while the user edits a new
    // namespace; changing a field must not erase known orphan guidance.
    if (!['namespace', 'reviewed', 'partial'].includes(key)) this.publication = null;
    this._version++; this.updatePreviews(this._root); return true;
  }
  onInput(field, input) { return field?.startsWith(P) ? this.change(input) : false; }
  onChange(field, input) { return this.onInput(field, input); }
  click(button) {
    const action = button?.dataset?.act; if (!action?.startsWith(P)) return false; this.revalidate(); if (!this._consume(button)) return true;
    const kind = action.slice(P.length); if (!this._allowed(kind)) return true;
    if (kind === 'cancel') { this.reset(); this.onRender(); }
    else if (kind === 'download') this.downloadZip();
    else ({ list: () => this.listDashboards(), read: () => this.readDashboard(), export: () => this.exportBackup(), inspect: () => this.inspectBackup(),
      prepare: () => this.prepareCopy(), create: () => this.createDashboard() })[kind]?.(); return true;
  }
  onClick(action, button) { return action?.startsWith(P) && button?.dataset.act === action ? this.click(button) : false; }
  _button(event) { const button = event.target?.closest?.('button[data-act]'); return button?.dataset.act.startsWith(P) ? button : null; }
  _live(button) { return button?.isConnected === true && this._root?.contains(button); }
  _stamp(button) { return { context: this._context(), version: this._version, action: button.dataset.act }; }
  _matches(stamp, button) { return this._live(button) && !button.disabled && stamp.version === this._version && stamp.action === button.dataset.act && this._same(stamp.context, this._context()) && this._allowed(button.dataset.act.slice(P.length)); }
  _revalidatePresses() { for (const [button, intent] of this._pressed) if (!this._matches(intent.stamp, button)) intent.poisoned = true; }
  _press(event) { const button = this._button(event); if (!button || !this._live(button) || event.button !== undefined && event.button !== 0 || event.isPrimary === false) return;
    const intent = { stamp: this._stamp(button), poisoned: !this._allowed(button.dataset.act.slice(P.length)), consumed: false, held: true,
      kind: event.type === 'keydown' ? 'keyboard' : 'pointer', key: event.key, pointerId: event.pointerId }; this._intents.set(button, intent); this._pressed.set(button, intent); }
  _key(event) { if (!['Enter', ' '].includes(event.key)) return; const button = this._button(event); if (!button) return; const existing = this._intents.get(button);
    if (event.repeat || existing?.held && existing.kind === 'keyboard') { if (!existing) { this._press(event); const intent = this._intents.get(button); if (intent) intent.poisoned = true; } this._revalidatePresses(); return; } this._press(event); }
  _release(event) { const button = this._button(event), intent = this._intents.get(button); if (!intent || event.type === 'keyup' && intent.key !== event.key
    || event.type === 'pointerup' && intent.pointerId !== undefined && intent.pointerId !== event.pointerId) return; this._revalidatePresses(); intent.held = false; }
  _cancelPress(event) { const intent = this._intents.get(this._button(event)); if (intent?.held) { intent.poisoned = true; intent.held = false; } }
  _consume(button) { if (!this._live(button) || button.disabled) return false; this._revalidatePresses(); const intent = this._intents.get(button);
    if (!intent) return true; if (intent.poisoned || intent.consumed || !this._matches(intent.stamp, button)) { intent.poisoned = true; return false; } intent.consumed = true; return true; }
  _unbind() { for (const intent of this._pressed.values()) intent.poisoned = true; this._pressed.clear();
    if (this._root) for (const [type, handler] of this._handlers) this._root.removeEventListener(type, handler, true); this._root = null; }
  _bind(root) { if (this._root === root) return; this._unbind(); this._root = root; for (const [type, handler] of this._handlers) root.addEventListener(type, handler, true); }
  dispose() { if (this.disposed) return; this.disposed = true; this._cancelWork(); this._clear(); this._unbind(); this.reader.dispose(); this.exporter.dispose(); this.restorer.dispose(); }
}
