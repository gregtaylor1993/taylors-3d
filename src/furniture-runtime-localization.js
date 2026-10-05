import { localeInfo, localize } from './localization.js';
import messages from './translations/furniture-runtime.js';
import { furnitureCaptionOf } from './furniture-caption-source.js';

const notices = new WeakMap();
export function furnitureRuntimeMessage(hass, value) {
  const caption = furnitureCaptionOf(value);
  const literal = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'message')?.value : value;
  if (!caption) return typeof literal === 'string' ? literal : '';
  const key = `furnitureRuntime.${caption.scope}.${caption.code}`;
  if (messages.en[key] !== caption.message) return caption.message;
  return localize(hass, key, {}, messages[localeInfo(hass).resolved]?.[key] ?? caption.message);
}
export function furnitureRuntimeNotice(diagnostic) {
  if (!furnitureCaptionOf(diagnostic)) return furnitureRuntimeMessage(undefined, diagnostic);
  const notice = Object.freeze({}); notices.set(notice, diagnostic); return notice;
}
export function readFurnitureRuntimeNotice(hass, value) {
  const diagnostic = value && typeof value === 'object' ? notices.get(value) : null;
  return diagnostic ? furnitureRuntimeMessage(hass, diagnostic) : value;
}
