import { describe, expect, it } from 'vitest';
import { planHouseShell } from '../src/house-shell-layout.js';

describe('future photo layout measures the card instead of the window', () => {
  it('gives a wide desktop rail and right room panel their own scene space', () => {
    const result = planHouseShell({ width: 1280, height: 720, summaryHeight: 86, toolbarHeight: 76,
      navigationHeight: 500, controlsOpen: true, controlsWidth: 316, controlsHeight: 500 });
    expect(result).toMatchObject({ valid: true, mode: 'rail', stageHeight: 720, railReserve: 88,
      controlsReserve: 332, sheetReserve: 0, navigationReserve: 0,
      scene: { x: 88, y: 86, width: 860, height: 542 } });
  });
  it('keeps the house above a phone sheet and both reachable bottom control rows', () => {
    const result = planHouseShell({ width: 320, height: 520, summaryHeight: 112, toolbarHeight: 120,
      navigationHeight: 76, controlsOpen: true, controlsHeight: 450 });
    expect(result).toMatchObject({ mode: 'bottom', railReserve: 0, controlsReserve: 0, sheetReserve: 466,
      stageHeight: 1046, scene: { x: 0, y: 112, width: 320, height: 240 } });
  });
  it('shrinks again after a sheet closes by using the requested base height', () => {
    const input = { width: 390, height: 600, summaryHeight: 80, toolbarHeight: 80, navigationHeight: 64,
      controlsOpen: true, controlsHeight: 320 };
    const opened = planHouseShell(input), closed = planHouseShell({ ...input, controlsOpen: false });
    expect(opened.stageHeight).toBeGreaterThan(input.height); expect(closed.stageHeight).toBe(input.height);
    expect(closed.sheetReserve).toBe(0); expect(closed.scene.height).toBeGreaterThan(opened.scene.height);
  });
  it('reserves actual Summary/Controls/Details heights and never accumulates expansion across snaps or resizes', () => {
    const input={width:360,height:600,summaryHeight:80,toolbarHeight:80,navigationHeight:64,controlsOpen:true};
    const detail=planHouseShell({...input,controlsHeight:560}),compact=planHouseShell({...input,controlsHeight:200});
    expect(detail.sheetReserve).toBe(576); expect(detail.stageHeight).toBe(1072); expect(detail.scene.height).toBe(240);
    expect(compact.sheetReserve).toBe(216); expect(compact.stageHeight).toBe(712); expect(compact.scene.height).toBe(240);
    expect(planHouseShell({...input,controlsHeight:560})).toEqual(detail);
    expect(planHouseShell({...input,width:1200,controlsHeight:560}).sheetReserve).toBe(0);
    expect(planHouseShell({...input,controlsOpen:false}).stageHeight).toBe(600);
  });
  it.each([320, 390, 739, 740, 959, 960, 1280])('uses non-overlapping actual reservations at width %i', (width) => {
    const result = planHouseShell({ width, height: 480, summaryHeight: 128, toolbarHeight: 144,
      navigationHeight: 84, controlsOpen: true, controlsWidth: 316, controlsHeight: 900 });
    expect(result.scene.height).toBeGreaterThanOrEqual(240);
    expect(result.scene.x + result.scene.width + result.controlsReserve).toBe(width);
    expect(result.scene.y + result.scene.height + result.toolbarReserve + result.navigationReserve + result.sheetReserve).toBe(result.stageHeight);
    expect(result.scene.width).toBeGreaterThan(0);
    expect(result.mode).toBe(width >= 960 ? 'rail' : 'bottom');
    expect(result.sheetReserve > 0).toBe(width < 740); expect(result.controlsReserve > 0).toBe(width >= 740);
  });
  it('leaves unchanged measured inputs deterministic without adding a clock or browser dependency', () => {
    const input = Object.freeze({ width: 1100, height: 700, summaryHeight: 88, toolbarHeight: 64 });
    expect(planHouseShell(input)).toEqual(planHouseShell(input)); expect(input.height).toBe(700);
  });
  it('hides header/navigation and room sheet while the separate editor is open', () => {
    const result = planHouseShell({ width: 1200, height: 520, summaryHeight: 80, toolbarHeight: 80,
      navigationHeight: 70, controlsOpen: true, controlsHeight: 300, editing: true });
    expect(result).toMatchObject({ mode: 'editor', summaryReserve: 0, railReserve: 0, navigationReserve: 0,
      controlsReserve: 0, sheetReserve: 0, scene: { x: 0, y: 0, width: 1200, height: 424 } });
  });
  it('has no phantom margins for genuinely hidden controls', () => {
    expect(planHouseShell({ width: 600, height: 520, controlsOpen: true, controlsHeight: 0 })).toMatchObject({
      toolbarReserve: 0, navigationReserve: 0, sheetReserve: 0, scene: { x: 0, y: 0, width: 600, height: 520 } });
  });
  it.each([{ width: 0, height: 500 }, { width: 500, height: 0 }])('does not ask a hidden card to render %j', (input) => {
    expect(planHouseShell(input)).toMatchObject({ valid: true, mode: 'hidden', scene: { width: 0, height: 0 } });
  });
  it.each([NaN, Infinity, -1, '320', null, 1000001])('rejects invalid pixel measurements %j', (width) => {
    expect(planHouseShell({ width, height: 520 })).toMatchObject({ valid: false, scene: null });
  });
  it.each([{ controlsOpen: 'true' }, { editing: 1 }, { controlsWidth: undefined, controlsHeight: Infinity }])('rejects malformed actual layout flags %j', (extra) => {
    expect(planHouseShell({ width: 320, height: 520, ...extra }).valid).toBe(false);
  });
});
