// Read the configured CSS height independently of a temporary, taller room sheet.
// Restore the exact inline minimum and priority before the browser can paint.
export function houseBaseHeight(stage) {
  if (!stage?.style || typeof stage.getBoundingClientRect !== 'function') return 0;
  const value = stage.style.getPropertyValue('min-height');
  const priority = stage.style.getPropertyPriority('min-height');
  let height;
  try {
    stage.style.setProperty('min-height', '0px', 'important');
    height = stage.getBoundingClientRect().height;
  } finally {
    if (value) stage.style.setProperty('min-height', value, priority);
    else stage.style.removeProperty('min-height');
  }
  return typeof height === 'number' && Number.isFinite(height) && height >= 0 && height <= 1e6 ? height : 0;
}
