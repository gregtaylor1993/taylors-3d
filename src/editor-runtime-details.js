// Display-only editor text. No validation, saved values or HA actions are changed.
import { localeInfo } from './localization.js';
import catalogues, { editorDetailEntries } from './translations/editor-runtime-details.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const byKey = new Map(editorDetailEntries.map((entry) => [entry.key, entry]));
const messages = new Map();
for (const entry of editorDetailEntries.filter((entry) => entry.message)) { const list = messages.get(entry.en) || []; list.push(entry); messages.set(entry.en, list); }
const captionFields = new Map(), captionActions = new Map(), captionHeadings = [];
for (const entry of editorDetailEntries.filter((entry) => entry.selector)) {
  const field = entry.selector.match(/^\[data-field="([^"]+)"\]/)?.[1], action = entry.selector.match(/^\[data-act="([^"]+)"\]/)?.[1];
  const index = field ? captionFields : action ? captionActions : null, id = field || action;
  if (index) { const list = index.get(id) || []; list.push(entry); index.set(id, list); } else captionHeadings.push(entry);
}
const ownPrimitive = (value, name) => {
  let descriptor;
  try { descriptor = value && Object.getOwnPropertyDescriptor(value, name); } catch { return undefined; }
  return descriptor && Object.hasOwn(descriptor, 'value') && (descriptor.value === null || ['string', 'number', 'boolean'].includes(typeof descriptor.value))
    && (typeof descriptor.value !== 'number' || Number.isFinite(descriptor.value)) ? descriptor.value : undefined;
};

export function editorDetailText(hass, id, params = {}) {
  const key = id.startsWith('editorDetails.') ? id : `editorDetails.${id}`;
  const entry = byKey.get(key); if (!entry) return '';
  const interpolate = (text) => {
    let valid = true;
    const result = text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
      const value = ownPrimitive(params, name); if (value === undefined || value === null) { valid = false; return ''; } return String(value);
    });
    return valid ? result : '';
  };
  return interpolate(catalogues[localeInfo(hass).resolved]?.[key] ?? entry.en);
}

export const editorDetailSpan = (hass, id, params) => `<span data-editor-detail="${esc(id)}"${params ? ` data-editor-detail-params="${esc(JSON.stringify(params))}"` : ''}>${esc(editorDetailText(hass, id, params))}</span>`;
function markCaption(selected, entry) {
  const host = entry.kind === 'label' ? selected.closest('label') : selected; if (!host) return;
  if (host.tagName === 'OPTION') { if (host.textContent === entry.en) host.dataset.editorDetail = entry.key; return; }
  const text = [...host.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim() === entry.en); if (!text) return;
  const span = host.ownerDocument.createElement('span'); span.dataset.editorDetail = entry.key;
  span.dataset.detailLeading = text.textContent.match(/^\s*/)[0]; span.dataset.detailTrailing = text.textContent.match(/\s*$/)[0];
  span.textContent = text.textContent; text.replaceWith(span);
}
export function updateEditorDetails(root, hass) {
  if (!root) return;
  // Indexed authored Overlay fields: user names and unrelated editors are excluded.
  for (const node of root.querySelectorAll('[data-field^="ovr-"],[data-act^="ovr-"],.taylors3d-overlay-editor h3,.taylors3d-overlay-editor .sub')) {
    for (const entry of captionFields.get(node.dataset.field) || []) {
      const value = entry.selector.match(/ option\[value="([^"]*)"\]$/)?.[1];
      if (value === undefined) markCaption(node, entry);
      else if (node.tagName === 'SELECT') for (const option of node.options) if (option.value === value) markCaption(option, entry);
    }
    for (const entry of captionActions.get(node.dataset.act) || []) markCaption(node, entry);
    if (node.tagName === 'H3' || node.classList.contains('sub')) for (const entry of captionHeadings) if (node.matches(entry.selector)) markCaption(node, entry);
  }
  // One scoped walk, preserving native controls and their held gestures.
  for (const node of root.querySelectorAll('[data-editor-detail]')) {
    let params = {};
    if (node.dataset.editorDetailParams) { try { params = JSON.parse(node.dataset.editorDetailParams); } catch { /* Malformed display metadata is ignored. */ } }
    const text = (node.dataset.detailLeading || '') + editorDetailText(hass, node.dataset.editorDetail, params) + (node.dataset.detailTrailing || '');
    if (node.textContent !== text) node.textContent = text;
  }
}
export function renderEditorDetails(html, hass) {
  const template = document.createElement('template'); template.innerHTML = html; updateEditorDetails(template.content, hass); return template.innerHTML;
}

/** Exact known owned messages only. Diagnostic objects require their original code.
 * Unknown/external codes and accessor messages are never translated or evaluated.
 */
export function editorOwnedMessage(hass, value) {
  const object = value && typeof value === 'object';
  const message = object ? ownPrimitive(value, 'message') : typeof value === 'string' ? value : '';
  const candidates = messages.get(message), entry = object ? candidates?.find((item) => item.code === ownPrimitive(value, 'code')) : candidates?.[0];
  if (!entry) return message ?? '';
  return editorDetailText(hass, entry.key);
}
