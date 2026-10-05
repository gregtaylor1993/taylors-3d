// Visual calibration drafts only. No persistence, HA services, timers or scene ownership.
import { entityChoices, entityMetadata, formatEntityValue } from './entity-metadata.js';
import { compileCalibration, readCoordinate, readFreshness } from './tracked-source.js';
import { localize } from './localization.js';
import { calibrationDetailText, calibrationDetailSpan, calibrationOwnedMessage, renderCalibrationDetails, updateCalibrationDetails } from './tracking-calibration-localization.js';

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
const pathsValid = (source) => {
  const keys = source.source === 'gps' ? ['latitude_attr', 'longitude_attr'] : ['x_attr', 'y_attr'];
  const paths = keys.map((key) => source[key] ?? (source.source === 'gps' ? key.slice(0, -5) : ''));
  return paths.every((path) => typeof path === 'string' && !!path.trim() && path.split('.').every((part) => !!part.trim())) && paths[0] !== paths[1];
};
const signature = (source, frame, contextKey) => JSON.stringify([contextKey, frame, source.entity, source.source || 'xy', source.x_attr, source.y_attr,
  source.units, source.plan_meters, source.floorId, source.freshness, source.latitude_attr, source.longitude_attr, source.north_up]);
// Offer only own, finite numeric values actually supplied by the chosen source.
// Attribute names never identify latitude/longitude; the user chooses each path.
const numericPaths = (attributes) => {
  const found = [], seen = new Set(); let inspected = 0;
  const visit = (value, path, depth) => {
    if (++inspected > 500 || depth > 8) return;
    if (path && number(value) !== null) { found.push(path); return; }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (key && !key.includes('.') && Object.hasOwn(descriptor, 'value')) visit(descriptor.value, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  visit(attributes, '', 0); return found;
};

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
 * Existing valid one-point/GPS imports may be preserved; new calibrated XY/GPS needs 2+ pairs.
 * Residual is the actual RMS distance in plan metres, not an accuracy guarantee.
 */
export function calibrationReport(source = {}, { floors = [], frame = frameOf(source), imported = false, changedContext = false } = {}) {
  source = plain(source) ? source : {};
  const fit = compileCalibration(source), diagnostics = [...fit.diagnostics];
  if (!imported && (!source.entity || !pathsValid(source))) diagnostics.push(issue('source', source.source === 'gps'
    ? 'Choose the actual position entity and distinct latitude/longitude attribute paths.' : 'Choose the actual position entity and distinct X/Y attribute paths.'));
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
        : fit.method === 'translation' ? source.source === 'gps'
          ? 'Preserved one-point GPS mapping uses the explicitly saved north-up plan; it does not establish rotation from measured pairs.'
          : 'Preserved one-point translation uses the declared scale; it does not establish rotation.' : 'Direct coordinates use the explicitly declared plan frame and units.' };
}

/** Parent owns binding Save/Cancel/Undo. onChange receives a copied position_source draft.
 * onPlanPick receives frozen {token,raw,floorId,observedAt,expiresAt,verified,contextKey}, or null.
 * Parent must pass that token and selected floor into acceptPlanPoint; points are unsnapped.
 * onPreview receives draft-only pairs/mapped reading/diagnostics, or null on reset/dispose.
 * update() refreshes evidence without rebuilding controls. setSource() replaces an external draft.
 */
export class TrackingCalibration {
  constructor({ source = {}, hass = {}, floors = [], contextKey = null, imported = true, now = () => Date.now(), onChange = () => {}, onPlanPick = () => {}, onPreview = () => {} } = {}) {
    this.source = copy(plain(source) ? source : {}); this.initial = copy(this.source); this.frame = this.source.source === 'gps' && !imported ? 'calibrated' : frameOf(this.source); this.initialFrame = this.frame;
    this.hass = hass; this.floors = floors; this.contextKey = contextKey; this.imported = imported; this.initialImported = imported;
    this.now = now; this._onChange = onChange; this._onPlanPick = onPlanPick; this._onPreview = onPreview;
    this.pending = null; this.token = 0; this.changedContext = false; this.changedKind = false; this.disposed = false; this.message = null; this.previewKey = null; this.planEdits = new Map();
  }
  _text(key, fallback) { return localize(this.hass, `edit.tracking.calibration.${key}`, {}, fallback); }
  _detail(key, params) { return calibrationDetailText(this.hass, key, params); }
  _detailSpan(key, params) { return calibrationDetailSpan(this.hass, key, params); }
  _displayMessage(value) { return calibrationOwnedMessage(this.hass, value); }
  getSource() { return copy(this.source); }
  evidence() { return coordinateEvidence(this.hass, this.source, { floors: this.floors, now: this.now() }); }
  report() {
    const report = calibrationReport(this.source, { floors: this.floors, frame: this.frame, imported: this.imported, changedContext: this.changedContext });
    const diagnostics = report.diagnostics.map((diagnostic) => diagnostic.code === 'source' && this.source.source === 'gps'
      ? { ...diagnostic, message: this._text('gpsSourceRequired', diagnostic.message) } : diagnostic);
    if (this.changedKind) diagnostics.push(issue('coordinate_kind', this._text('kindChanged', 'XY and GPS use different coordinate frames. Clear the old pairs deliberately before capturing the new source.')));
    if (this.planEdits.size) diagnostics.push(issue('plan_point', 'Complete the edited plan coordinates. Blank values, booleans and nonfinite values cannot be saved.'));
    return diagnostics.length ? { ...report, status: 'invalid', transform: null, diagnostics } : report;
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
    this._cancel(); this.source = copy(source); this.frame = source.source === 'gps' && !imported ? 'calibrated' : frameOf(this.source); this.imported = imported; this.planEdits.clear(); this.changedKind = false;
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
    if (this.disposed || !['entity', 'x_attr', 'y_attr', 'latitude_attr', 'longitude_attr', 'floorId'].includes(field) || this.frame === 'preserved') return false;
    const previous = signature(this.source, this.frame, this.contextKey);
    this.source = { ...this.source, [field]: value }; this._change(previous); return true;
  }
  setUnits(units) {
    if (this.disposed || !['m', 'cm', 'mm', 'raw'].includes(units) || this.frame === 'preserved' || this.source.source === 'gps') return false;
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
    if (this.disposed || !['plan', 'calibrated'].includes(frame) || this.frame === 'preserved' || this.source.source === 'gps') return false;
    const previous = signature(this.source, this.frame, this.contextKey);
    this.frame = frame; this.source.source = 'xy'; this.source.plan_meters = frame === 'plan'; this.imported = false;
    this._change(previous); return true;
  }
  editGPS() {
    if (this.disposed || this.source.source !== 'gps' || this.frame !== 'preserved') return false;
    this._cancel(); this.frame = 'calibrated'; this.message = null; this._refresh(); return true;
  }
  setKind(kind) {
    if (this.disposed || !['xy', 'gps'].includes(kind) || this.frame === 'preserved') return false;
    if (kind === (this.source.source || 'xy')) return true;
    const previous = signature(this.source, this.frame, this.contextKey);
    if (list(this.source.calibration).length) this.changedKind = true;
    this.source = { ...this.source, source: kind };
    if (kind === 'gps') {
      // Empty choices require deliberate real attribute selection. Existing
      // imported paths and all other source fields remain untouched.
      if (!Object.hasOwn(this.source, 'latitude_attr')) this.source.latitude_attr = '';
      if (!Object.hasOwn(this.source, 'longitude_attr')) this.source.longitude_attr = '';
      this.frame = 'calibrated';
    } else this.frame = list(this.source.calibration).length ? 'calibrated' : this.source.plan_meters === true ? 'plan' : 'choose';
    this.imported = false; this._change(previous); return true;
  }
  confirmSourceContext() {
    if (this.disposed) return false; this._cancel();
    if (this.changedKind) { this.message = this._text('kindChanged', 'XY and GPS use different coordinate frames. Clear the old pairs deliberately before capturing the new source.'); this._refresh(); return false; }
    this.changedContext = false; this._refresh(); return true;
  }
  clearMapping() {
    if (this.disposed || this.frame === 'preserved') return false;
    this._cancel(); this.source = { ...this.source, calibration: [] }; this.changedContext = false; this.changedKind = false; this.imported = false; this.planEdits.clear();
    this._onChange(this.getSource()); this._refresh(); return true;
  }
  captureSourcePoint() {
    if (this.disposed) return null;
    this._cancel(); const evidence = this.evidence();
    if (!pathsValid(this.source)) { this.message = this.source.source === 'gps'
      ? this._text('gpsPathsRequired', 'Choose distinct actual latitude/longitude attribute paths before capturing a point.') : 'Choose distinct actual X/Y attribute paths before capturing a point.'; return null; }
    if (this.frame !== 'calibrated' || this.changedContext || this.changedKind || !['xy', 'gps'].includes(evidence.kind) || evidence.status !== 'ready') {
      this.message = this.changedKind ? this._text('kindChanged', 'XY and GPS use different coordinate frames. Clear the old pairs deliberately before capturing the new source.')
        : this.changedContext ? 'Confirm the source frame before capturing a point.' : this.frame !== 'calibrated' ? 'Choose calibrated X/Y mode to capture points.' : evidence.diagnostics[0]?.message || 'A genuine current coordinate reading is required.';
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
    this._cancel(); this.source = copy(this.initial); this.frame = this.initialFrame; this.imported = this.initialImported; this.changedContext = false; this.changedKind = false; this.message = null;
    this.previewKey = null; this.planEdits.clear(); this._onPreview(null);
  }
  dispose() { if (this.disposed) return; this.reset(); this.disposed = true; }

  _statusHTML() {
    const evidence = this.evidence(), report = this.report();
    const explanation = this.source.source === 'gps' && report.method === 'translation' ? this._text('northUpExplanation', report.explanation) : report.explanation;
    return `<p>${esc(this._detail(evidence.restored ? 'storedReading' : 'positionReading'))}: ${esc(this.source.entity ? formatEntityValue(this.hass, this.source.entity) : this._detail('chooseSource'))} · ${esc(evidence.status)}</p>
      ${evidence.raw ? `<p>${esc(this._detail(evidence.kind === 'gps' ? 'rawGPS' : 'rawXY'))}: ${evidence.raw.map(esc).join(', ')} — ${esc(this._displayMessage(evidence.ageLabel))}</p>` : ''}
      <p>${esc(this._detail('calibration'))} ${esc(report.status)}${report.method ? ` · ${esc(report.method)}` : ''}${report.residual !== null ? esc(this._detail('fitError', { residual: report.residual })) : ''}</p><p>${esc(this._displayMessage(explanation))}</p>
      ${this.message ? `<p role="status">${esc(this._displayMessage(this.message))}</p>` : ''}<ul>${[...report.diagnostics, ...evidence.diagnostics].map((item) => `<li>${esc(this._displayMessage(item))}</li>`).join('')}</ul>`;
  }
  _gpsChoices(field) {
    const metadata = entityMetadata(this.hass, this.source.entity), restored = metadata.state?.attributes?.restored;
    const paths = metadata.available && !metadata.hidden && !metadata.category && (restored === undefined || restored === false)
      ? numericPaths(metadata.state?.attributes) : [];
    const selected = this.source[field] ?? field.slice(0, -5);
    const rows = [['', this._text(field === 'latitude_attr' ? 'chooseLatitude' : 'chooseLongitude', field === 'latitude_attr'
      ? 'Choose the actual latitude attribute' : 'Choose the actual longitude attribute')], ...paths.map((path) => [path, path])];
    if (selected && !paths.includes(selected)) rows.push([selected, `${this._text('unavailablePath', 'Unavailable saved attribute')}: ${selected}`, true]);
    return { rows, selected };
  }
  _syncGpsChoices(container) {
    for (const field of ['latitude_attr', 'longitude_attr']) {
      const select = container.querySelector(`[data-field="trk-cal-${field}"]`); if (!select) continue;
      const { rows, selected } = this._gpsChoices(field), old = [...select.options];
      if (old.length !== rows.length || rows.some(([value, label, disabled], index) => value !== old[index]?.value || label !== old[index]?.textContent || !!disabled !== old[index]?.disabled)) {
        const existing = new Map(old.map((option) => [option.value, option]));
        select.replaceChildren(...rows.map(([value, label, disabled]) => { const option = existing.get(value) || select.ownerDocument.createElement('option');
          option.value = value; option.textContent = label; option.disabled = !!disabled; return option; }));
      }
      if (select.value !== selected) select.value = selected;
    }
  }
  renderHTML() {
    if (this.disposed) return '';
    const input = (field, label, value, extra = '') => `<label>${esc(label)}<input data-field="trk-cal-${field}" value="${esc(value)}" ${extra}></label>`;
    const button = (action, label, extra = '') => `<button type="button" data-act="trk-cal-${action}" ${extra}>${esc(label)}</button>`;
    const options = (items, selected) => items.map(([id, label, disabled, detail]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}${detail ? ` data-cal-detail="${esc(detail.key)}" data-cal-detail-params="${esc(JSON.stringify(detail.params))}"` : ''}>${esc(label)}</option>`).join('');
    const select = (field, label, items, selected) => {
      const key = { source: 'sourceKind', latitude_attr: 'latitude', longitude_attr: 'longitude' }[field];
      return `<label>${key ? `<span data-cal-caption="${key}">${esc(label)}</span>` : esc(label)}<select data-field="trk-cal-${field}">${options(items, selected)}</select></label>`;
    };
    const entities = [['', 'Choose the actual position source'], ...entityChoices(this.hass, { domains: ['sensor', 'device_tracker', 'vacuum'], selected: this.source.entity }).map((item) => [item.value, `${item.label} · ${item.value}`, !item.selectable])];
    const floors = [['', 'Choose the actual floor'], ...list(this.floors).map((floor) => [floor.id, floor.name || floor.id])];
    if (this.source.floorId && !floors.some(([id]) => id === this.source.floorId)) floors.push([this.source.floorId, this._detail('missingFloor', { id: this.source.floorId }), true, { key: 'missingFloor', params: { id: this.source.floorId } }]);
    const units = [['m', 'Metres'], ['cm', 'Centimetres'], ['mm', 'Millimetres'], ['raw', 'Raw map units (unknown scale)']];
    if (this.source.units !== undefined && !units.some(([id]) => id === this.source.units)) units.push([this.source.units, this._detail('unsupportedUnit', { unit: this.source.units }), true, { key: 'unsupportedUnit', params: { unit: this.source.units } }]);
    const supported = this.frame !== 'preserved', gps = this.source.source === 'gps';
    const gpsAttributes = ['latitude_attr', 'longitude_attr'].map((field) => {
      const { rows, selected } = this._gpsChoices(field);
      return select(field, this._text(field === 'latitude_attr' ? 'latitude' : 'longitude', field === 'latitude_attr'
        ? 'Latitude attribute path — degrees' : 'Longitude attribute path — degrees'), rows, selected);
    }).join('');
    return renderCalibrationDetails(`<section data-tracking-calibration data-taylors3d-ui="tracking-calibration"><style>
      [data-tracking-calibration] label{display:flex;flex-direction:column;gap:5px;margin:9px 0}[data-tracking-calibration] input,[data-tracking-calibration] select,[data-tracking-calibration] button{box-sizing:border-box;max-width:100%;min-height:44px;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#f5f5f5)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}[data-tracking-calibration] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}[data-tracking-calibration] li{overflow-wrap:anywhere}
      </style><h4>Vacuum coordinate calibration</h4><p>Only captured source readings are paired with plan points. These controls do not move or start your vacuum. Save belongs to the parent Tracking form.</p>
      ${supported ? `${select('source', this._text('sourceKind', 'Coordinate source'), [['xy', this._text('xy', 'X/Y map coordinates')], ['gps', this._text('gps', 'GPS latitude/longitude')]], this.source.source || 'xy')}
        ${gps ? `<p data-cal-caption="projection">${esc(this._text('projection', 'GPS attributes are latitude/longitude in degrees. The existing runtime projects them around the first captured point, then fits your matching plan points. Capture at least two distinct positions; no north-up direction is assumed.'))}</p>`
          : select('frame', 'Coordinate frame', [['choose', 'Choose a frame'], ['plan', 'Already aligned to plan'], ['calibrated', 'Calibrate source map']], this.frame)}
        ${select('entity', 'Position source', entities, this.source.entity)}${gps ? gpsAttributes : `${input('x_attr', 'Raw X attribute path', this.source.x_attr)}${input('y_attr', 'Raw Y attribute path', this.source.y_attr)}${select('units', 'Source units', units, this.source.units ?? 'raw')}`}
        ${select('floorId', 'Measured floor', floors, this.source.floorId)}` : `<p>${this._detailSpan('preserved')}</p>${gps ? button('edit-gps', this._text('editGps', 'Edit this GPS source deliberately'), 'data-cal-caption="editGps"') : ''}`}
      <ol>${list(this.source.calibration).map((entry, index) => `<li>${this._detailSpan('source')} ${esc(JSON.stringify(entry?.src))}
        ${supported ? `${input('plan-x', 'Matching plan X — metres east', (this.planEdits.get(index) || entry?.plan)?.[0], `data-index="${index}" type="number" step="any"`)}${input('plan-y', 'Matching plan Y — metres north', (this.planEdits.get(index) || entry?.plan)?.[1], `data-index="${index}" type="number" step="any"`)}${button('remove', 'Remove this pair', `data-index="${index}"`)}` : ` → ${this._detailSpan('plan')} ${esc(JSON.stringify(entry?.plan))}`}</li>`).join('')}</ol>
      ${this.changedContext ? `<p>${this._detailSpan('changedFrame')}</p>${button('confirm', 'I verified the same frame; keep pairs')}` : ''}
      ${supported ? `${button('capture', 'Capture current source point', 'data-cal-capture')}${button('clear', 'Clear calibration pairs deliberately')}` : ''}
      ${this.pending ? `<section data-cal-pending><p>${this._detailSpan('captured', { raw: this.pending.raw.join(', '), floor: this.pending.floorId })}</p>${input('pending-x', 'Plan X — metres east', '', 'type="number" step="any"')}${input('pending-y', 'Plan Y — metres north', '', 'type="number" step="any"')}${button('accept', 'Use these plan coordinates')}${button('cancel-pick', 'Cancel point pick')}</section>` : ''}
      <div data-cal-status aria-live="polite">${this._statusHTML()}</div></section>`, this.hass);
  }
  updatePreviews(container) {
    if (this.disposed || !container) return;
    const status = container.querySelector('[data-cal-status]'), html = this._statusHTML();
    if (status && status.innerHTML !== html) status.innerHTML = html;
    const capture = container.querySelector('[data-cal-capture]');
    if (capture) capture.disabled = this.frame !== 'calibrated' || this.changedContext || this.changedKind || !pathsValid(this.source) || !!this.pending || this.evidence().status !== 'ready';
    const pending = container.querySelector('[data-cal-pending]');
    if (pending) pending.hidden = !this.pending;
    this._syncGpsChoices(container);
    for (const caption of container.querySelectorAll('[data-cal-caption]')) {
      if (caption.dataset.calFallback === undefined) caption.dataset.calFallback = caption.textContent;
      caption.textContent = this._text(caption.dataset.calCaption, caption.dataset.calFallback);
    }
    const source = container.querySelector('[data-field="trk-cal-source"]');
    for (const option of source?.options || []) option.textContent = this._text(option.value, option.value === 'gps' ? 'GPS latitude/longitude' : 'X/Y map coordinates');
    updateCalibrationDetails(container, this.hass);
    this._refresh();
  }
  onChange(field, element) {
    if (this.disposed || !field?.startsWith('trk-cal-')) return false;
    const name = field.slice(8);
    if (name === 'frame') this.setFrame(element.value);
    else if (name === 'source') this.setKind(element.value);
    else if (name === 'units') this.setUnits(element.value);
    else if (name === 'plan-x' || name === 'plan-y') {
      const index = Number(element.dataset?.index), current = this.planEdits.get(index) || this.source.calibration?.[index]?.plan;
      if (current) this.setPlanPoint(index, name === 'plan-x' ? [element.value, current[1]] : [current[0], element.value]);
    } else if (['entity', 'x_attr', 'y_attr', 'latitude_attr', 'longitude_attr', 'floorId'].includes(name)) this.setField(name, element.value);
    return true;
  }
  onClick(action, element = {}) {
    if (this.disposed || !action?.startsWith('trk-cal-')) return false;
    const name = action.slice(8);
    if (name === 'capture') this.captureSourcePoint();
    else if (name === 'edit-gps') this.editGPS();
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
