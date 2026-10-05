import { describe, expect, it, vi } from 'vitest';
import { clearImportedSource, inspectSourceValue, URL_MODEL_SOURCE_KEYS } from '../src/imported-source-controls.js';

describe('exact imported-source deletion', () => {
  it('works from frozen raw config without changing null/default/unknown imports', () => {
    const views = Object.freeze({ front: Object.freeze({ extension: null }), garden: Object.freeze({ label: 'Literal' }) });
    const config = Object.freeze({ type: 'custom:taylors3d-card', model: '/local/model.glb', model_opacity: 0,
      model_rendering: Object.freeze({ lamps: 'off' }), views, empty: '', nullValue: null, height: '520px' });
    const model = clearImportedSource(config, { kind: 'uploaded-model' });
    expect(model.changed).toBe(true); expect(model.config).toEqual({ type: 'custom:taylors3d-card', model_rendering: { lamps: 'off' }, views, empty: '', nullValue: null, height: '520px' });
    const view = clearImportedSource(config, { kind: 'shared-view', key: 'front' });
    expect(view.changed).toBe(true); expect(view.config.views).toEqual({ garden: views.garden }); expect(config.views.front).toEqual({ extension: null });
  });
  it('preserves a literal __proto__ view key and clears only that exact entry', () => {
    const views = JSON.parse('{"__proto__":{"unknown":"literal"},"front":{"label":"Keep"}}'), config = { views, unknown: null };
    const result = clearImportedSource(config, { kind: 'shared-view', key: '__proto__' });
    expect(result.changed).toBe(true); expect(result.config).toEqual({ views: { front: { label: 'Keep' } }, unknown: null });
    expect(Object.hasOwn(views, '__proto__')).toBe(true); expect(Object.getPrototypeOf(result.config.views)).toBe(Object.prototype);
  });
  it('never reads source/action accessors or invokes custom string conversion', () => {
    const getter = vi.fn(() => '/local/unexpected.glb'), config = { unknown: { kept: true } }; Object.defineProperty(config, 'model', { enumerable: true, get: getter });
    expect(inspectSourceValue(config).readable).toBe(false); expect(clearImportedSource(config, { kind: 'uploaded-model' }).changed).toBe(false);
    const action = {}; Object.defineProperty(action, 'kind', { get: getter });
    expect(clearImportedSource({ model: 'real' }, action).changed).toBe(false); expect(getter).not.toHaveBeenCalled();
    const toString = vi.fn(() => 'unexpected'); expect(inspectSourceValue({ value: { toString } }).readable).toBe(false); expect(toString).not.toHaveBeenCalled();
  });
  it('does not clear malformed/unchanged sources unless the matching action is chosen', () => {
    const config = { views: { front: null }, model_floors: ['malformed'], model_rendering: { shadows: 'off' } };
    expect(clearImportedSource(config, { kind: 'clear-views' }).changed).toBe(false);
    expect(clearImportedSource(config, { kind: 'shared-view', key: 'missing' }).changed).toBe(false);
    expect(clearImportedSource(config, { kind: 'automatic-floors' }).config).toEqual({ views: config.views, model_rendering: config.model_rendering });
    expect(clearImportedSource(config, { kind: 'shared-view', key: 'front' }).config).toEqual({ ...config, views: {} });
  });
  it('inspects distinct literal JSON types and limits cyclic/deep values honestly', () => {
    expect(inspectSourceValue(undefined).signature).not.toBe(inspectSourceValue('[present undefined]').signature);
    expect(inspectSourceValue({ extension: '<literal>', nil: null, empty: '', flag: false }).text).toContain('"nil": null');
    const cyclic = {}; cyclic.self = cyclic; expect(inspectSourceValue(cyclic).readable).toBe(false);
    let deep = {}; for (let index = 0; index < 30; index++) deep = { child: deep }; expect(inspectSourceValue(deep).readable).toBe(false);
    expect(inspectSourceValue('x'.repeat(100001)).readable).toBe(false);
  });
  it('limits the uploaded-model allowlist to URL-only options', () => {
    expect(URL_MODEL_SOURCE_KEYS).toEqual(['model', 'model_position', 'model_rotation', 'model_scale', 'model_opacity', 'model_floors', 'model_position_x', 'model_position_y', 'model_position_z']);
    const config = { model: 'url', model_position_x: 1, model_position_y: 2, model_position_z: 3, merge: false,
      model_rendering: { shadows: 'off' }, objects: { literal: null }, furniture: { exact: 'keep' } };
    expect(clearImportedSource(config, { kind: 'uploaded-model' }).config).toEqual({ merge: false, model_rendering: config.model_rendering, objects: config.objects, furniture: config.furniture });
  });
});
