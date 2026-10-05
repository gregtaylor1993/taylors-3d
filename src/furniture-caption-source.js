// Private provenance for card-owned furniture messages. No text or metadata is
// added to transport responses, catalogues, saved layouts, or diagnostic objects.
const captions = new WeakMap();
const field = (value, key) => value && typeof value === 'object'
  ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;

export function ownFurnitureCaption(value, scope, code) {
  const message = field(value, 'message');
  if (value && typeof value === 'object' && typeof message === 'string') {
    captions.set(value, { scope, code, message, diagnosticCode: field(value, 'code') });
  }
  return value;
}

export function furnitureCaptionOf(value) {
  const caption = value && typeof value === 'object' ? captions.get(value) : null;
  return caption && caption.message === field(value, 'message')
    && caption.diagnosticCode === field(value, 'code') ? caption : null;
}

export function copyFurnitureCaption(source, target) {
  const caption = furnitureCaptionOf(source);
  if (caption && caption.message === field(target, 'message')) {
    captions.set(target, { ...caption, diagnosticCode: field(target, 'code') });
  }
  return target;
}

// Existing defensive clones retain their private presentation provenance.
// Only authored top-level messages and diagnostics are considered, never pack
// names, imported metadata, licence text, or arbitrary nested user strings.
export function cloneFurnitureCaptionValue(value) {
  const result = structuredClone(value);
  copyFurnitureCaption(value, result);
  const original = Array.isArray(value) ? value : field(value, 'diagnostics');
  const copied = Array.isArray(result) ? result : field(result, 'diagnostics');
  if (Array.isArray(original) && Array.isArray(copied)) {
    for (let index = 0; index < original.length; index++) {
      copyFurnitureCaption(field(original, String(index)), field(copied, String(index)));
    }
  }
  return result;
}
