// Future photo layout geometry. Root must supply actual measured CSS pixels,
// reserve this rectangle in the existing renderer and remeasure changed controls.
// This pure planner creates no DOM and does not read the browser/window size.
export const HOUSE_SHELL_LIMITS = Object.freeze({ railAt: 960, sheetBelow: 740, rail: 88,
  gap: 16, sheet: 320, minimumSceneHeight: 240 });
const pixels = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e6;

/** height is the configured stage height before any adaptive min-height, not a
 * previous expanded DOM height. That distinction lets a closed sheet shrink back.
 * hidden controls contribute zero measured size. Width is the actual card stage.
 */
export function planHouseShell({ width = 0, height = 0, summaryHeight = 0, toolbarHeight = 0,
  navigationHeight = 0, controlsWidth = 316, controlsHeight = 0, controlsOpen = false,
  editing = false } = {}) {
  const measurements = { width, height, summaryHeight, toolbarHeight, navigationHeight, controlsWidth, controlsHeight };
  if (!Object.values(measurements).every(pixels) || typeof controlsOpen !== 'boolean' || typeof editing !== 'boolean')
    return { valid: false, mode: 'hidden', diagnostics: [{ code: 'measurements', message: 'House layout needs finite current nonnegative pixel measurements and explicit visibility flags.' }], scene: null };
  const limits = HOUSE_SHELL_LIMITS;
  if (!width || !height) return { valid: true, mode: 'hidden', stageHeight: height, diagnostics: [],
    summaryReserve: 0, railReserve: 0, navigationReserve: 0, toolbarReserve: 0, controlsReserve: 0, sheetReserve: 0,
    scene: { x: 0, y: 0, width: 0, height: 0 } };
  const mode = editing ? 'editor' : width >= limits.railAt ? 'rail' : 'bottom';
  const railReserve = mode === 'rail' ? limits.rail : 0;
  const navigationReserve = mode === 'bottom' && navigationHeight ? navigationHeight + limits.gap : 0;
  const toolbarReserve = toolbarHeight ? toolbarHeight + limits.gap : 0;
  const summaryReserve = editing ? 0 : summaryHeight;
  const sheetReserve = controlsOpen && !editing && width < limits.sheetBelow && controlsHeight
    ? Math.min(limits.sheet, controlsHeight) + limits.gap : 0;
  const controlsReserve = controlsOpen && !editing && width >= limits.sheetBelow && controlsWidth
    ? Math.min(controlsWidth, width * .4) + limits.gap : 0;
  const bottom = toolbarReserve + navigationReserve + sheetReserve;
  const stageHeight = Math.max(height, summaryReserve + bottom + limits.minimumSceneHeight);
  return { valid: true, mode, stageHeight, diagnostics: [], summaryReserve, railReserve, navigationReserve,
    toolbarReserve, controlsReserve, sheetReserve,
    scene: { x: railReserve, y: summaryReserve, width: Math.max(0, width - railReserve - controlsReserve),
      height: stageHeight - summaryReserve - bottom } };
}
