// Display-only text for the existing calibration editor. Native fields stay in place.
import { localeInfo } from './localization.js';
import catalogues, { calibrationDetailEntries } from './translations/tracking-calibration-details.js';
import { editorOwnedMessage } from './editor-runtime-details.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const byKey = new Map(calibrationDetailEntries.map((entry) => [entry.key, entry]));
const byMessage = new Map(calibrationDetailEntries.filter((entry) => !entry.selector).map((entry) => [entry.en, entry.key]));
const fields = new Map(), actions = new Map(), prose = [];
for (const entry of calibrationDetailEntries.filter((entry) => entry.selector)) {
  const field = entry.selector.match(/^\[data-field="trk-cal-([^"]+)"\]/)?.[1], action = entry.selector.match(/^\[data-act="trk-cal-([^"]+)"\]/)?.[1];
  const index = field ? fields : action ? actions : null, id = field || action;
  if (index) { const rows = index.get(id) || []; rows.push(entry); index.set(id, rows); } else prose.push(entry);
}
export function calibrationDetailText(hass, id, params = {}) {
  const key = id.startsWith('trackingCalibrationDetails.') ? id : `trackingCalibrationDetails.${id}`, entry = byKey.get(key); if (!entry) return '';
  let valid = true;
  const result = (catalogues[localeInfo(hass).resolved]?.[key] ?? entry.en).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
    let descriptor; try { descriptor = params && Object.getOwnPropertyDescriptor(params, name); } catch { valid = false; return ''; }
    const value = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    if (!['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) { valid = false; return ''; } return String(value);
  });
  return valid ? result : '';
}
export const calibrationDetailSpan = (hass, id, params) => `<span data-cal-detail="${esc(id)}"${params ? ` data-cal-detail-params="${esc(JSON.stringify(params))}"` : ''}>${esc(calibrationDetailText(hass, id, params))}</span>`;
export function calibrationOwnedMessage(hass, value) {
  // Diagnostics are code checked by the shared exact-message reader; source objects are untouched.
  if (typeof value !== 'string') return editorOwnedMessage(hass, value);
  const key = byMessage.get(value); return key ? calibrationDetailText(hass, key) : editorOwnedMessage(hass, value);
}
function mark(node, entry) {
  const host = entry.label ? node.closest('label') : node; if (!host || host.querySelector?.(`[data-cal-detail="${entry.key}"]`)) return;
  if (host.tagName === 'OPTION') { if (host.textContent === entry.en) host.dataset.calDetail = entry.key; return; }
  const raw = [...host.childNodes].find((child) => child.nodeType === 3 && child.textContent.trim() === entry.en); if (!raw) return;
  const span = host.ownerDocument.createElement('span'); span.dataset.calDetail = entry.key;
  span.dataset.calLeading = raw.textContent.match(/^\s*/)[0]; span.dataset.calTrailing = raw.textContent.match(/\s*$/)[0]; span.textContent = raw.textContent; raw.replaceWith(span);
}
export function updateCalibrationDetails(root, hass) {
  if (!root) return;
  for (const node of root.querySelectorAll('[data-tracking-calibration] [data-field^="trk-cal-"],[data-tracking-calibration] [data-act^="trk-cal-"],[data-tracking-calibration] > h4,[data-tracking-calibration] > p')) {
    for (const entry of fields.get(node.dataset.field?.slice(8)) || []) {
      const value = entry.selector.match(/ option\[value="([^"]*)"\]$/)?.[1];
      if (value === undefined) mark(node, entry); else if (node.tagName === 'SELECT') for (const option of node.options) if (option.value === value) mark(option, entry);
    }
    for (const entry of actions.get(node.dataset.act?.slice(8)) || []) mark(node, entry);
    if (node.tagName === 'H4' || node.tagName === 'P') for (const entry of prose) if (node.matches(entry.selector)) mark(node, entry);
  }
  for (const node of root.querySelectorAll('[data-cal-detail]')) {
    let params = {}; if (node.dataset.calDetailParams) { try { params = JSON.parse(node.dataset.calDetailParams); } catch { /* Ignore malformed display metadata. */ } }
    const text = (node.dataset.calLeading || '') + calibrationDetailText(hass, node.dataset.calDetail, params) + (node.dataset.calTrailing || '');
    if (node.textContent !== text) node.textContent = text;
  }
}
export function renderCalibrationDetails(html, hass) {
  const template = document.createElement('template'); template.innerHTML = html; updateCalibrationDetails(template.content, hass); return template.innerHTML;
}
