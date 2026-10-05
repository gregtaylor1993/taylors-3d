// Explicit authored caption sites only. Native controls and user content are retained.
import { localeInfo, localize } from './localization.js';
import messages from './translations/editor-presentation-scenes.js';
import liveMessages, { sceneDiagnosticKeys } from './translations/live-camera-scenes.js';
import { editorDiagnosticKeys } from './translations/editor-presentation-diagnostics.js';
import { ownedRuntimeDetails, runtimeNoticeText } from './runtime-notices.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const notices = new WeakMap();
export function editorExtraNotice(key, parameters = {}) {
  const notice = Object.freeze({}); notices.set(notice, { key, parameters }); return notice;
}
export function readEditorExtraNotice(hass, value) {
  const notice = value && typeof value === 'object' ? notices.get(value) : null;
  if (!notice) return value;
  const parameters = Object.fromEntries(Object.entries(notice.parameters).map(([key, parameter]) =>
    [key, ownedRuntimeDetails(parameter) ? runtimeNoticeText(hass, parameter) : parameter]));
  return editorExtraText(hass, notice.key, parameters);
}
export function editorExtraText(hass, key, parameters = {}) {
  const fullKey = `editorExtras.${key}`, language = localeInfo(hass).resolved;
  return localize(hass, fullKey, parameters, messages[language]?.[fullKey] ?? messages.en[fullKey] ?? '');
}
export function editorExtraCaption(hass, key) {
  return `<span data-editor-extra-caption="${escape(key)}">${escape(editorExtraText(hass, key))}</span>`;
}
export function updateEditorExtraCaptions(root, hass) {
  for (const node of root.querySelectorAll('[data-editor-extra-caption]')) {
    const value = editorExtraText(hass, node.dataset.editorExtraCaption);
    if (node.textContent !== value) node.textContent = value;
  }
  for (const node of root.querySelectorAll('[data-editor-extra-aria]')) {
    const value = editorExtraText(hass, node.dataset.editorExtraAria);
    if (node.getAttribute('aria-label') !== value) node.setAttribute('aria-label', value);
  }
}

/** Preserve native select/option identity, including focused partial drafts. */
export function syncEditorOptions(select, html, selected = select?.value) {
  if (!select) return;
  const holder = document.createElement('select'); holder.innerHTML = html;
  const existing = new Map();
  for (const option of [...select.options]) {
    if (!existing.has(option.value)) existing.set(option.value, []);
    existing.get(option.value).push(option);
  }
  const keep = new Set();
  for (const [index, candidate] of [...holder.options].entries()) {
    // Malformed or ambiguous source choices can intentionally contain repeated
    // disabled values. Match each occurrence once instead of silently merging rows.
    const option = existing.get(candidate.value)?.shift() || document.createElement('option');
    option.value = candidate.value; option.disabled = candidate.disabled;
    if (option.textContent !== candidate.textContent) option.textContent = candidate.textContent;
    if (select.options[index] !== option) select.insertBefore(option, select.options[index] || null);
    keep.add(option);
  }
  for (const option of [...select.options]) if (!keep.has(option)) option.remove();
  select.value = selected;
}

// Matching both the exact owned message and its code prevents translating arbitrary
// external errors that happen to use a familiar code. Unknown diagnostics stay literal.
export function editorExtraDiagnostic(hass, diagnostic) {
  if (!diagnostic || typeof diagnostic.message !== 'string') return '';
  const match = sceneDiagnosticKeys.find((entry) => entry.message === diagnostic.message
    && (entry.code === diagnostic.code || entry.code === `capability_${diagnostic.code}`));
  const language = localeInfo(hass).resolved;
  if (match) return localize(hass, match.key, {}, liveMessages[language]?.[match.key] ?? liveMessages.en[match.key]);
  const extra = editorDiagnosticKeys.find((entry) => entry.code === diagnostic.code && entry.message === diagnostic.message);
  return extra ? localize(hass, extra.key, {}, messages[language]?.[extra.key] ?? messages.en[extra.key]) : diagnostic.message;
}
