// Private provenance keeps our translated notices separate from external errors.
// Error.message and protocol responses retain their established English text.
import { localize, localeInfo } from './localization.js';
import messages from './translations/runtime-notices.js';
const details = new WeakMap();
function caption(hass, key, params) {
  const fullKey = `runtimeNotice.${key}`, language = localeInfo(hass).resolved;
  return localize(hass, fullKey, params, messages[language]?.[fullKey] ?? messages.en[fullKey] ?? '');
}
export function ownedRuntimeError(key, params = {}) {
  const saved = Object.freeze({ ...params }), error = new Error(caption({ language: 'en' }, key, saved));
  details.set(error, Object.freeze({ key, params: saved }));
  return error;
}
export function ownedRuntimeDetails(value) {
  return value && typeof value === 'object' ? details.get(value) || null : null;
}
export function runtimeNoticeText(hass, value) {
  const notice = ownedRuntimeDetails(value);
  return notice ? caption(hass, notice.key, notice.params) : typeof value === 'string' ? value
    : typeof value?.message === 'string' ? value.message : value == null ? '' : String(value);
}
