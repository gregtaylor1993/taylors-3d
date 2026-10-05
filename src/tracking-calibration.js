// Visual calibration drafts only. No persistence, HA services, timers or scene ownership.
import { entityChoices, entityMetadata, formatEntityValue } from './entity-metadata.js';
import { compileCalibration, readCoordinate, readFreshness } from './tracked-source.js';

const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const copy = (value) => JSON.parse(JSON.stringify(value));
const list = (value) => Array.isArray(value) ? value : [];
const number = (value) => (typeof value === 'number' || typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) && Number.isFinite(Number(value)) ? Number(value) : null;
const pair = (value) => Array.isArray(value) && value.length === 2 && value.every((part) => number(part) !== null) ? value.map(number) : null;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const issue = (code, message) => ({ code, message });
const floorValid = (floors, id) => typeof id === 'string' && !!id.trim() && list(floors).filter((floor) => floor?.id === id && typeof floor.elevation === 'number' && Number.isFinite(floor.elevation)).length === 1
  && list(floors).filter((floor) => floor?.id === id).length === 1;
const frameOf = (source) => { source = plain(source) ? source : {}; return source.source && source.source !== 'xy' ? 'preserved' : list(source.calibration).length ? 'calibrated' : source.plan_meters === true ? 'plan' : 'choose'; };
const pathsValid = (source) => typeof source.x_attr === 'string' && !!source.x_attr.trim() && typeof source.y_attr === 'string' && !!source.y_attr.trim() && source.x_attr !== source.y_attr;
const signature = (source, frame, contextKey) => JSON.stringify([contextKey, frame, source.entity, source.source || 'xy', source.x_attr, source.y_attr,
  source.units, source.plan_meters, source.floorId, source.freshness]);

/** Genuine current evidence, separate from whether a saved calibration is valid.
 * Absent freshness rules mean HA current state with unverified measurement age.
 * floors must contain the explicit source floor with a finite elevation before capture.
 */
export function coordinateEvidence(hass = {}, source = {}, { floors = [], now = Date.now() } = {}) {
  source = plain(source) ? source : {};
  const metadata = entityMetadata(hass, source.entity), reading = readCoordinate(metadata.state, source);
  const fresh = readFreshness(metadata.state, source.freshness, now);
  const base = { status: 'ready', kind: reading.kind, raw: null, observedAt: fresh.observedAt ?? null, expiresAt: fresh.expiresAt ?? null,
    verified: fresh.verified === true, restored: metadata.state?.attributes?.restored === true, diagnostics: [] };
  if (!metadata.available || metadata.hidden || metadata.category || base.restored) return { ...base, status: metadata.missing ? 'missing' : 'unavailable',
    diagnostics: [issue('unavailable', base.restored ? 'Stored/restored reading. Waiting for a current Home Assistant update.' : 'The position source is missing, hidden, disabled, diagnostic or unavailable.')] };
  if (reading.status !== 'ready') return { ...base, status: reading.status, diagnostics: reading.diagnostics };
  if (!['current', 'ready'].includes(fresh.status)) return { ...base, status: fresh.status, diagnostics: fresh.diagnostics };
  if (!floorValid(floors, source.floorId)) return { ...base, status: 'invalid', diagnostics: [issue('floor', 'Choose the actual mapped floor with a finite elevation.')] };
  return { ...base, raw: [...reading.raw], ageLabel: fresh.verified ? 'Age checked against the configured source timestamp.' : 'Current Home Assistant state; measurement age is unverified.' };
}

/** Configuration validation never requires the entity to be online.
 * Existing valid one-point/GPS imports may be preserved, while new calibrated XY needs 2+ pairs.
 * Residual is the actual RMS distance in plan metres, not an accuracy guarantee.
 */
export function calibrationReport(source = {}, { floors = [], frame = frameOf(source), imported = false, changedContext = false } = {}) {
  source = plain(source) ? source : {};
  const fit = compileCalibration(source), diagnostics = [...fit.diagnostics];
  if (!imported && (!source.entity || (source.source || 'xy') === 'xy' && !pathsValid(source))) diagnostics.push(issue('source', 'Choose the actual position entity and distinct X/Y attribute paths.'));
  if (!floorValid(floors, source.floorId)) diagnostics.push(issue('floor', 'Choose the actual mapped floor with a finite elevation.'));
  if (changedContext) diagnostics.push(issue('context', 'The source frame changed. Keep these pairs only after verifying the same coordinate frame, or clear them deliberately.'));
  if (frame === 'choose') diagnostics.push(issue('frame', 'Choose direct plan coordinates or a calibrated source map.'));
  if (frame === 'plan' && list(source.calibration).length) diagnostics.push(issue('frame', 'Clear calibration deliberately before using direct plan coordinates.'));
  if (frame === 'calibrated' && !imported && list(source.calibration).length < 2) diagnostics.push(issue('pairs', 'Capture at least two distinct source points and their matching plan points.'));
  const ready = fit.status === 'ready' && !diagnostics.length;
  return { status: ready ? 'ready' : 'invalid', method: fit.method, residual: fit.residual, diagnostics,
    transform: ready ? fit.transform : null, explanation: fit.method === 'similarity'
      ? 'Two points fit exactly. Zero fit error does not measure accuracy; use three spread points for mirrored or unequal-scale maps.'
      : fit.method === 'affine' ? 'Fit error is the RMS difference at the paired points, in metres. It does not guarantee accuracy elsewhere.'
        : fit.method === 'translation' ? 'Preserved one-point translation uses the declared scale; it does not establish rotation.' : 'Direct coordinates use the explicitly declared plan frame and units.' };
}

/** Parent owns binding Save/Cancel/Undo. onChange receives a copied position_source draft.
 * onPlanPick receives frozen {token,raw,floorId,observedAt,expiresAt,verified,contextKey}, or null.
 * Parent must pass that token and selected floor into acceptPlanPoint; points are unsnapped.
 * onPreview receives draft-only pairs/mapped reading/diagnostics, or null on reset/dispose.
 * update() refreshes evidence without rebuilding controls. setSource() replaces an external draft.
 */
export class TrackingCalibration {
  constructor({ source = {}, hass = {}, floors = [], contextKey = null, imported = true, now = () => Date.now(), onChange = () => {}, onPlanPick = () => {}, onPreview = () => {} } = {}) {
    this.source = copy(plain(source) ? source : {}); this.initial = copy(this.source); this.frame = frameOf(this.source); this.initialFrame = this.frame;
    this.hass = hass; this.floors = floors; this.contextKey = contextKey; this.imported = imported; this.initialImported = imported;
    this.now = now; this._onChange = onChange; this._onPlanPick = onPlanPick; this._onPreview = onPreview;
    this.pending = null; this.token = 0; this.changedContext = false; this.disposed = false; this.message = null; this.previewKey = null; this.planEdits = new Map();
  }
  getSource() { return copy(this.source); }
  evidence() { return coordinateEvidence(this.hass, this.source, { floors: this.floors, now: this.now() }); }
  report() {
    const report = calibrationReport(this.source, { floors: this.floors, frame: this.frame, imported: this.imported, changedContext: this.changedContext });
    return this.planEdits.size ? { ...report, status: 'invalid', transform: null, diagnostics: [...report.diagnostics,
      issue('plan_point', 'Complete the edited plan coordinates. Blank values, booleans and nonfinite values cannot be saved.')] } : report;
  }
  _cancel() { if (this.pending) { this.pending = null; this.token++; this._onPlanPick(null); } }
  cancelPlanPick() { if (this.disposed) return; this._cancel(); this.message = null; }
  _refresh() {
    if (this.disposed) return;
    const evidence = this.evidence(), report = this.report();
    const preview = { draft: true, floorId: this.source.floorId, pairs: copy(list(this.source.calibration)),
      mapped: evidence.status === 'ready' && report.transform ? report.transform({ kind: evidence.kind, status: 'ready', raw: evidence.raw }) : null,
      status: evidence.status, method: report.method, residual: report.residual, diagnostics: [...report.diagnostics, ...evidence.diagnostics] };
    const key = JSON.stringify(preview);
    if (key !== this.previewKey) { this.previewKey = key; this._onPreview(preview); }
  }
  _change(previousSignature) {
    if (previousSignature !== signature(this.source, this.frame, this.contextKey)) {
      this._cancel(); if (list(this.source.calibration).length) this.changedContext = true;
    }
    this.message = null; this._onChange(this.getSource()); this._refresh();
  }
  setSource(source, { imported = true } = {}) {
    if (this.disposed || !plain(source)) return false;
    const previous = signature(this.source, this.frame, this.contextKey);
    this._cancel(); this.source = copy(source); this.frame = frameOf(this.source); this.imported = imported; this.planEdits.clear();
    this.changedContext = previous !== signature(this.source, this.frame, this.contextKey) && list(this.source.calibration).length > 0;
    this.message = null; this._refresh(); return true;
  }
  update({ hass = this.hass, floors = this.floors, contextKey = this.contextKey } = {}) {
    if (this.disposed) return;
    if (contextKey !== this.contextKey) this._cancel();
    this.hass = hass; this.floors = floors; this.contextKey = contextKey;
    if (this.pending && (!floorValid(floors, this.pending.floorId) || this.evidence().status !== 'ready')) this._cancel();
    this._refresh();
  }
  setField(field, value) {
    if (this.disposed || !['entity', 'x_attr', 'y_attr', 'floorId'].includes(field) || this.frame === 'preserved') return false;
    const previous = signature(this.source, this.frame, this.contextKey);
    this.source = { ...this.source, [field]: value }; this._change(previous); return true;
  }
  setUnits(units) {
    if (this.disposed || !['m', 'cm', 'mm', 'raw'].includes(units) || this.frame === 'preserved') return false;
    const previous = signature(this.source, this.frame, this.contextKey);
    if (units === 'raw') delete this.source.units; else this.source.units = units;
    this._change(previous); return true;
  }
  setFreshness(rule) {
    if (this.disposed) return false;
    this._cancel(); this.source = { ...this.source };
    if (rule === undefined) delete this.source.freshness; else this.source.freshness = copy(rule);
    this.message = null; this._onChange(this.getSource()); this._refresh(); return true;
  }
  setFrame(frame) {
    if (this.disposed || !['plan', 'calibrated'].includes(frame) || this.frame === 'preserved') return false;
    const previous = signature(this.source, this.frame, this.contextKey);
    this.frame = frame; this.source.source = 'xy'; this.source.plan_meters = frame === 'plan'; this.imported = false;
    this._change(previous); return true;
  }
  confirmSourceContext() { if (this.disposed) return; this._cancel(); this.changedContext = false; this._refresh(); }
  clearMapping() {
    if (this.disposed || this.frame === 'preserved') return false;
    this._cancel(); this.source = { ...this.source, calibration: [] }; this.changedContext = false; this.imported = false; this.planEdits.clear();
    this._onChange(this.getSource()); this._refresh(); return true;
  }
  captureSourcePoint() {
    if (this.disposed) return null;
    this._cancel(); const evidence = this.evidence();
    if (!pathsValid(this.source)) { this.message = 'Choose distinct actual X/Y attribute paths before capturing a point.'; return null; }
    if (this.frame !== 'calibrated' || this.changedContext || evidence.kind !== 'xy' || evidence.status !== 'ready') {
      this.message = this.changedContext ? 'Confirm the source frame before capturing a point.' : this.frame !== 'calibrated' ? 'Choose calibrated X/Y mode to capture points.' : evidence.diagnostics[0]?.message || 'A genuine current X/Y reading is required.';
      return null;
    }
    this.pending = Object.freeze({ token: ++this.token, raw: Object.freeze([...evidence.raw]), floorId: this.source.floorId,
      observedAt: evidence.observedAt, expiresAt: evidence.expiresAt, verified: evidence.verified, contextKey: this.contextKey,
      signature: signature(this.source, this.frame, this.contextKey) });
    this.message = 'Source point captured. Pick where the robot actually was on the selected floor; later readings do not replace this snapshot.';
    this._onPlanPick(this.pending); return this.pending;
  }
  acceptPlanPoint(value, floorId, token) {
    if (this.disposed || !this.pending || token !== this.pending.token) return false;
    const point = pair(value), pending = this.pending;
    if (pending.signature !== signature(this.source, this.frame, this.contextKey) || floorId !== pending.floorId || !floorValid(this.floors, floorId)) {
      this._cancel(); this.message = 'The source or floor changed. Capture a new source point.'; return false;
    }
    if (!point) { this.message = 'Enter two finite plan coordinates. Blank values and booleans are not zero.'; return false; }
    const evidence = this.evidence();
    if (evidence.status !== 'ready' || pending.expiresAt !== null && pending.expiresAt <= this.now()) {
      this._cancel(); this.message = 'The captured source is no longer current. Capture a new source point.'; return false;
    }
    this.source = { ...this.source, calibration: [...list(this.source.calibration), { src: [...pending.raw], plan: point }] };
    this.imported = false; this._cancel(); this.message = null; this._onChange(this.getSource()); this._refresh(); return true;
  }
  setPlanPoint(index, value) {
    const point = pair(value), old = this.source.calibration?.[index];
    if (this.disposed || this.frame === 'preserved' || !Number.isInteger(index) || !plain(old)) return false;
    if (!point) {
      this._cancel(); this.planEdits.set(index, Array.isArray(value) ? [...value] : [null, null]); this.message = 'Complete both finite plan coordinates before saving.';
      this._onChange(this.getSource()); this._refresh(); return false;
    }
    this.planEdits.delete(index); this.message = null;
    this._cancel(); this.source = { ...this.source, calibration: this.source.calibration.map((entry, i) => i === index ? { ...entry, plan: point } : entry) };
    this.imported = false; this._onChange(this.getSource()); this._refresh(); return true;
  }
  removePoint(index) {
    if (this.disposed || this.frame === 'preserved' || !Number.isInteger(index) || index < 0 || index >= list(this.source.calibration).length) return false;
    this._cancel(); this.source = { ...this.source, calibration: this.source.calibration.filter((_, i) => i !== index) }; this.imported = false;
    this.planEdits = new Map([...this.planEdits].filter(([i]) => i !== index).map(([i, value]) => [i > index ? i - 1 : i, value]));
    this._onChange(this.getSource()); this._refresh(); return true;
  }
  reset() {
    this._cancel(); this.source = copy(this.initial); this.frame = this.initialFrame; this.imported = this.initialImported; this.changedContext = false; this.message = null;
    this.previewKey = null; this.planEdits.clear(); this._onPreview(null);
  }
  dispose() { if (this.disposed) return; this.reset(); this.disposed = true; }

  _statusHTML() {
    const evidence = this.evidence(), report = this.report();
    return `<p>${evidence.restored ? 'Stored position reading' : 'Position reading'}: ${esc(this.source.entity ? formatEntityValue(this.hass, this.source.entity) : 'Choose a source')} · ${esc(evidence.status)}</p>
      ${evidence.raw ? `<p>${evidence.kind === 'gps' ? 'Raw latitude/longitude' : 'Raw X/Y'}: ${evidence.raw.map(esc).join(', ')} — ${esc(evidence.ageLabel)}</p>` : ''}
      <p>Calibration: ${esc(report.status)}${report.method ? ` · ${esc(report.method)}` : ''}${report.residual !== null ? ` · Fit error ${esc(report.residual)} m` : ''}</p><p>${esc(report.explanation)}</p>
      ${this.message ? `<p role="status">${esc(this.message)}</p>` : ''}<ul>${[...report.diagnostics, ...evidence.diagnostics].map((item) => `<li>${esc(item.message)}</li>`).join('')}</ul>`;
  }
  renderHTML() {
    if (this.disposed) return '';
    const input = (field, label, value, extra = '') => `<label>${esc(label)}<input data-field="trk-cal-${field}" value="${esc(value)}" ${extra}></label>`;
    const button = (action, label, extra = '') => `<button type="button" data-act="trk-cal-${action}" ${extra}>${esc(label)}</button>`;
    const options = (items, selected) => items.map(([id, label, disabled]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</option>`).join('');
    const select = (field, label, items, selected) => `<label>${esc(label)}<select data-field="trk-cal-${field}">${options(items, selected)}</select></label>`;
    const entities = [['', 'Choose the actual position source'], ...entityChoices(this.hass, { domains: ['sensor', 'device_tracker', 'vacuum'], selected: this.source.entity }).map((item) => [item.value, `${item.label} · ${item.value}`, !item.selectable])];
    const floors = [['', 'Choose the actual floor'], ...list(this.floors).map((floor) => [floor.id, floor.name || floor.id])];
    if (this.source.floorId && !floors.some(([id]) => id === this.source.floorId)) floors.push([this.source.floorId, `Missing floor: ${this.source.floorId}`, true]);
    const units = [['m', 'Metres'], ['cm', 'Centimetres'], ['mm', 'Millimetres'], ['raw', 'Raw map units (unknown scale)']];
    if (this.source.units !== undefined && !units.some(([id]) => id === this.source.units)) units.push([this.source.units, `Unsupported saved unit: ${this.source.units}`, true]);
    const supported = this.frame !== 'preserved';
    return `<section data-tracking-calibration data-taylors3d-ui="tracking-calibration"><style>
      [data-tracking-calibration] label{display:flex;flex-direction:column;gap:5px;margin:9px 0}[data-tracking-calibration] input,[data-tracking-calibration] select,[data-tracking-calibration] button{box-sizing:border-box;max-width:100%;min-height:44px;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#f5f5f5)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}[data-tracking-calibration] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}[data-tracking-calibration] li{overflow-wrap:anywhere}
      </style><h4>Vacuum coordinate calibration</h4><p>Only captured source readings are paired with plan points. These controls do not move or start your vacuum. Save belongs to the parent Tracking form.</p>
      ${supported ? `${select('frame', 'Coordinate frame', [['choose', 'Choose a frame'], ['plan', 'Already aligned to plan'], ['calibrated', 'Calibrate source map']], this.frame)}
        ${select('entity', 'Position source', entities, this.source.entity)}${input('x_attr', 'Raw X attribute path', this.source.x_attr)}${input('y_attr', 'Raw Y attribute path', this.source.y_attr)}
        ${select('units', 'Source units', units, this.source.units ?? 'raw')}${select('floorId', 'Measured floor', floors, this.source.floorId)}` : '<p>This imported source is preserved read-only. It is not converted to a new X/Y map.</p>'}
      <ol>${list(this.source.calibration).map((entry, index) => `<li>Source ${esc(JSON.stringify(entry?.src))}
        ${supported ? `${input('plan-x', 'Matching plan X — metres east', (this.planEdits.get(index) || entry?.plan)?.[0], `data-index="${index}" type="number" step="any"`)}${input('plan-y', 'Matching plan Y — metres north', (this.planEdits.get(index) || entry?.plan)?.[1], `data-index="${index}" type="number" step="any"`)}${button('remove', 'Remove this pair', `data-index="${index}"`)}` : ` → Plan ${esc(JSON.stringify(entry?.plan))}`}</li>`).join('')}</ol>
      ${this.changedContext ? `<p>The source frame changed. Keep pairs only after verifying that it is the same coordinate map.</p>${button('confirm', 'I verified the same frame; keep pairs')}` : ''}
      ${supported ? `${button('capture', 'Capture current source point', 'data-cal-capture')}${button('clear', 'Clear calibration pairs deliberately')}` : ''}
      ${this.pending ? `<section data-cal-pending><p>Captured ${this.pending.raw.map(esc).join(', ')}. Pick the matching point on ${esc(this.pending.floorId)}.</p>${input('pending-x', 'Plan X — metres east', '', 'type="number" step="any"')}${input('pending-y', 'Plan Y — metres north', '', 'type="number" step="any"')}${button('accept', 'Use these plan coordinates')}${button('cancel-pick', 'Cancel point pick')}</section>` : ''}
      <div data-cal-status aria-live="polite">${this._statusHTML()}</div></section>`;
  }
  updatePreviews(container) {
    if (this.disposed || !container) return;
    const status = container.querySelector('[data-cal-status]'), html = this._statusHTML();
    if (status && status.innerHTML !== html) status.innerHTML = html;
    const capture = container.querySelector('[data-cal-capture]');
    if (capture) capture.disabled = this.frame !== 'calibrated' || this.changedContext || !!this.pending || this.evidence().status !== 'ready';
    const pending = container.querySelector('[data-cal-pending]');
    if (pending) pending.hidden = !this.pending;
    this._refresh();
  }
  onChange(field, element) {
    if (this.disposed || !field?.startsWith('trk-cal-')) return false;
    const name = field.slice(8);
    if (name === 'frame') this.setFrame(element.value);
    else if (name === 'units') this.setUnits(element.value);
    else if (name === 'plan-x' || name === 'plan-y') {
      const index = Number(element.dataset?.index), current = this.planEdits.get(index) || this.source.calibration?.[index]?.plan;
      if (current) this.setPlanPoint(index, name === 'plan-x' ? [element.value, current[1]] : [current[0], element.value]);
    } else if (['entity', 'x_attr', 'y_attr', 'floorId'].includes(name)) this.setField(name, element.value);
    return true;
  }
  onClick(action, element = {}) {
    if (this.disposed || !action?.startsWith('trk-cal-')) return false;
    const name = action.slice(8);
    if (name === 'capture') this.captureSourcePoint();
    else if (name === 'cancel-pick') this.cancelPlanPick();
    else if (name === 'clear') this.clearMapping();
    else if (name === 'confirm') this.confirmSourceContext();
    else if (name === 'remove') this.removePoint(Number(element.dataset?.index));
    else if (name === 'accept') {
      const root = element.closest?.('[data-tracking-calibration]');
      this.acceptPlanPoint([root?.querySelector('[data-field="trk-cal-pending-x"]')?.value, root?.querySelector('[data-field="trk-cal-pending-y"]')?.value], this.pending?.floorId, this.pending?.token);
    }
    return true;
  }
}
