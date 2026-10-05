// Pure bundled card text. No requests, HA overrides, DOM, device actions or layout changes.
// UI callers still escape text for HTML templates or use textContent/attribute setters.
import en from './translations/en.js';
import de from './translations/de.js';
import fr from './translations/fr.js';
import es from './translations/es.js';
import advanced from './translations/advanced-settings.js';
import cardSettings from './translations/card-settings.js';
import mowerOptions from './translations/mower-options.js';
import trackingCalibration from './translations/tracking-calibration.js';
import deviceControls from './translations/device-controls.js';
import roomActionsEditor from './translations/room-actions-editor.js';
import entityAreaFilter from './translations/entity-area-filter.js';
import dashboardBackupReferences from './translations/dashboard-backup-references.js';
import statusOverlays from './translations/status-overlays.js';
import savedHaReferences from './translations/saved-ha-references.js';
import environmentHouse from './translations/editor-environment-house.js';
import liveCameraScenes from './translations/live-camera-scenes.js';
import entityChoiceCaptions from './translations/entity-choice-captions.js';
import editorPresentationScenes from './translations/editor-presentation-scenes.js';
import editorRuntimeDetails from './translations/editor-runtime-details.js';
import dashboardBackupWizard from './translations/dashboard-backup-wizard.js';
import editorCore from './translations/editor-core.js';
import runtimeNotices from './translations/runtime-notices.js';
import furnitureRuntime from './translations/furniture-runtime.js';
import objectPopup from './translations/object-popup.js';
import trackingCalibrationDetails from './translations/tracking-calibration-details.js';

const catalogues = Object.freeze({
  en: Object.freeze({ ...en, ...advanced.en, ...cardSettings.en, ...mowerOptions.en, ...trackingCalibration.en, ...deviceControls.en, ...roomActionsEditor.en, ...entityAreaFilter.en, ...dashboardBackupReferences.en, ...statusOverlays.en, ...savedHaReferences.en, ...environmentHouse.en, ...liveCameraScenes.en, ...entityChoiceCaptions.en, ...editorPresentationScenes.en, ...editorRuntimeDetails.en, ...dashboardBackupWizard.en, ...editorCore.en, ...runtimeNotices.en, ...furnitureRuntime.en, ...objectPopup.en, ...trackingCalibrationDetails.en }),
  de: Object.freeze({ ...de, ...advanced.de, ...cardSettings.de, ...mowerOptions.de, ...trackingCalibration.de, ...deviceControls.de, ...roomActionsEditor.de, ...entityAreaFilter.de, ...dashboardBackupReferences.de, ...statusOverlays.de, ...savedHaReferences.de, ...environmentHouse.de, ...liveCameraScenes.de, ...entityChoiceCaptions.de, ...editorPresentationScenes.de, ...editorRuntimeDetails.de, ...dashboardBackupWizard.de, ...editorCore.de, ...runtimeNotices.de, ...furnitureRuntime.de, ...objectPopup.de, ...trackingCalibrationDetails.de }),
  fr: Object.freeze({ ...fr, ...advanced.fr, ...cardSettings.fr, ...mowerOptions.fr, ...trackingCalibration.fr, ...deviceControls.fr, ...roomActionsEditor.fr, ...entityAreaFilter.fr, ...dashboardBackupReferences.fr, ...statusOverlays.fr, ...savedHaReferences.fr, ...environmentHouse.fr, ...liveCameraScenes.fr, ...entityChoiceCaptions.fr, ...editorPresentationScenes.fr, ...editorRuntimeDetails.fr, ...dashboardBackupWizard.fr, ...editorCore.fr, ...runtimeNotices.fr, ...furnitureRuntime.fr, ...objectPopup.fr, ...trackingCalibrationDetails.fr }),
  es: Object.freeze({ ...es, ...advanced.es, ...cardSettings.es, ...mowerOptions.es, ...trackingCalibration.es, ...deviceControls.es, ...roomActionsEditor.es, ...entityAreaFilter.es, ...dashboardBackupReferences.es, ...statusOverlays.es, ...savedHaReferences.es, ...environmentHouse.es, ...liveCameraScenes.es, ...entityChoiceCaptions.es, ...editorPresentationScenes.es, ...editorRuntimeDetails.es, ...dashboardBackupWizard.es, ...editorCore.es, ...runtimeNotices.es, ...furnitureRuntime.es, ...objectPopup.es, ...trackingCalibrationDetails.es }),
});
export const availableLocales = Object.freeze(Object.keys(catalogues));
const rules = new Map();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function field(value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && own(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
}

function canonicalLocale(value) {
  if (typeof value !== 'string' || !value || value.length > 128) return null;
  try { return Intl.getCanonicalLocales(value)[0] || null; }
  catch { return null; }
}

/** Current canonical request plus the available catalogue language.
 * key observes in-place HA locale changes; plural rules follow resolved text, not requested language.
 * A malformed locale.language can fall back to a valid hass.language before English.
 */
export function localeInfo(hass = {}) {
  const requested = canonicalLocale(field(field(hass, 'locale'), 'language'))
    || canonicalLocale(field(hass, 'language')) || 'en';
  const base = requested.split('-')[0];
  const resolved = own(catalogues, requested) ? requested : own(catalogues, base) ? base : 'en';
  return { requested, resolved, key: `${requested}|${resolved}` };
}

export const localeKey = (hass) => localeInfo(hass).key;

function messageFor(locale, key) {
  const candidates = [...new Set([locale.requested, locale.requested.split('-')[0], 'en'])];
  for (const language of candidates) {
    const catalogue = own(catalogues, language) ? catalogues[language] : null;
    if (catalogue && own(catalogue, key)) return { message: catalogue[key], language };
  }
  return null;
}

function interpolate(template, params) {
  let valid = true;
  const result = template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
    const value = field(params, name);
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return String(value);
    valid = false; return '';
  });
  return valid ? result : null;
}

function readableFallback(fallback, params) {
  return typeof fallback === 'string' ? interpolate(fallback, params) ?? '' : '';
}

/** localize(hass,key,params?,fallback?) -> plain text.
 * Missing keys/required params/invalid plural counts return the readable supplied fallback or ''.
 * Only own primitive parameter data is read; getters, inherited data and custom toString are unused.
 * Plural records use finite nonnegative numeric params.count; there is no state-value coercion.
 */
export function localize(hass, key, params = {}, fallback = '') {
  if (typeof key !== 'string' || !key) return readableFallback(fallback, params);
  const found = messageFor(localeInfo(hass), key);
  if (!found) return readableFallback(fallback, params);
  let template = found.message;
  if (typeof template !== 'string') {
    const count = field(params, 'count');
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return readableFallback(fallback, params);
    let category;
    try {
      if (!rules.has(found.language)) rules.set(found.language, new Intl.PluralRules(found.language));
      category = rules.get(found.language).select(count);
    } catch { category = count === 1 ? 'one' : 'other'; }
    template = field(template, category) ?? field(template, 'other');
  }
  if (typeof template !== 'string') return readableFallback(fallback, params);
  return interpolate(template, params) ?? readableFallback(fallback, params);
}
