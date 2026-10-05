import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { modelShadingReport, readModelRendering } from '../src/model-rendering.js';

describe('model rendering policy', () => {
  it('defaults to the existing lighting behavior without mutating settings', () => {
    const settings = Object.freeze({ extension: Object.freeze({ retained: true }) });
    for (const value of [undefined, {}, settings]) expect(readModelRendering(value)).toEqual({ shadows: 'realtime', lamps: 'inherit', valid: true, diagnostics: [] });
    expect(settings.extension.retained).toBe(true);
  });
  it('accepts each explicit policy independently', () => {
    expect(readModelRendering({ shadows: 'off', lamps: 'inherit' })).toEqual({ shadows: 'off', lamps: 'inherit', valid: true, diagnostics: [] });
    expect(readModelRendering({ lamps: 'off' })).toMatchObject({ shadows: 'realtime', lamps: 'off', valid: true });
    expect(readModelRendering({ shadows: 'off', lamps: 'off' })).toMatchObject({ shadows: 'off', lamps: 'off', valid: true });
  });
  it.each([null, false, true, 0, 'off', []])('diagnoses wrong shape %j and retains safe defaults', (value) => {
    expect(readModelRendering(value)).toEqual({ shadows: 'realtime', lamps: 'inherit', valid: false,
      diagnostics: [{ code: 'invalid_policy', message: 'Model rendering settings must be an object.' }] });
  });
  it.each(['baked', 'OFF', false, null, undefined, 0])('rejects malformed known fields %j without losing valid neighbors', (value) => {
    const result = readModelRendering({ shadows: value, lamps: 'off' });
    expect(result).toMatchObject({ shadows: 'realtime', lamps: 'off', valid: false });
    expect(result.diagnostics.map((issue) => issue.code)).toEqual(['invalid_shadows']);
    expect(readModelRendering({ shadows: 'off', lamps: value })).toMatchObject({ shadows: 'off', lamps: 'inherit', valid: false });
  });
  it('ignores inherited settings and never writes unknown fields', () => {
    const settings = Object.assign(Object.create({ shadows: 'off' }), { lamps: 'inherit', future: { foo: 1 } });
    expect(readModelRendering(settings).shadows).toBe('realtime');
    expect(settings.future).toEqual({ foo: 1 });
  });
});

const texture = (channel = 0) => { const tex = new THREE.Texture(); tex.channel = channel; return tex; };
const mesh = (name, material, uv1 = false) => {
  const geometry = new THREE.PlaneGeometry(2, 2);
  if (uv1) geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  const object = new THREE.Mesh(geometry, material); object.name = name; return object;
};
describe('actual model shading evidence', () => {
  it('returns a plain empty report without a model', () => {
    for (const root of [undefined, null, {}]) expect(modelShadingReport(root)).toEqual({ hasModel: false,
      counts: { meshes: 0, materials: 0, materialUses: 0, aoMaterials: 0, lightMapMaterials: 0, unlitMaterials: 0, texturedMaterials: 0 },
      uvChannels: [], materials: [], missingUV: [], diagnostics: [] });
  });
  it('counts shared/multimaterial references once but diagnoses UVs on each geometry', () => {
    const ao = texture(1), map = texture(), material = new THREE.MeshStandardMaterial({ map, aoMap: ao }); material.name = 'Authored AO';
    const unlit = new THREE.MeshBasicMaterial({ map: texture() }); unlit.name = 'Authored unlit';
    const root = new THREE.Group(), complete = mesh('Complete', material, true), missing = mesh('Missing second UV', [material, unlit]);
    root.add(complete, missing);
    const report = modelShadingReport(root);
    expect(report.counts).toEqual({ meshes: 2, materials: 2, materialUses: 3, aoMaterials: 1, lightMapMaterials: 0, unlitMaterials: 1, texturedMaterials: 2 });
    expect(report.uvChannels).toEqual([{ channel: 0, attribute: 'uv', materialUses: 2, meshUses: 3 }, { channel: 1, attribute: 'uv1', materialUses: 1, meshUses: 2 }]);
    expect(report.materials.find((m) => m.id === material.uuid)).toMatchObject({ uses: 2, unlit: false, aoMap: true, lightMap: false });
    expect(report.missingUV).toEqual([{ meshId: missing.uuid, meshName: 'Missing second UV', materialId: material.uuid, materialName: 'Authored AO', slot: 'aoMap', channel: 1, attribute: 'uv1' }]);
    expect(report.diagnostics[0].code).toBe('missing_uv');
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
  it('reports an actual light map separately without inferring baked lighting from material names/colors', () => {
    const root = new THREE.Group(), lit = new THREE.MeshStandardMaterial({ lightMap: texture(2) }), suggestive = new THREE.MeshStandardMaterial({ color: 'red' });
    suggestive.name = 'BAKED_UNLIT_AO';
    const first = mesh('Light map', lit); first.geometry.setAttribute('uv2', first.geometry.getAttribute('uv').clone()); root.add(first, mesh('Named only', suggestive));
    const report = modelShadingReport(root);
    expect(report.counts).toMatchObject({ lightMapMaterials: 1, aoMaterials: 0, unlitMaterials: 0 });
    expect(report.materials.find((m) => m.id === suggestive.uuid)).toMatchObject({ unlit: false, aoMap: false, lightMap: false, textures: [] });
    expect(report.missingUV).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('baked:');
  });
  it('requires actual texture/material flags and complete UV coordinates', () => {
    const root = new THREE.Group(), material = new THREE.MeshStandardMaterial(); material.aoMap = { channel: 1 };
    material.map = texture(); const object = mesh('Short UVs', material);
    object.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0], 2)); root.add(object);
    const report = modelShadingReport(root);
    expect(report.counts.aoMaterials).toBe(0); expect(report.missingUV.map((entry) => entry.slot)).toEqual(['map']);
  });
  it.each([-1, 4, 1.5, '1', undefined])('reports unsupported UV channel %j without guessing a replacement', (channel) => {
    const material = new THREE.MeshStandardMaterial({ map: texture() }); material.map.channel = channel;
    const root = new THREE.Group(); root.add(mesh('Invalid channel', material));
    const report = modelShadingReport(root);
    expect(report.uvChannels).toEqual([]); expect(report.materials[0].textures).toEqual([]);
    expect(report.diagnostics).toEqual([{ code: 'invalid_uv_channel', message: 'A material texture has an unsupported UV channel.', materialId: material.uuid, slot: 'map' }]);
  });
  it('leaves authored material/texture/UV values and versions exactly intact', () => {
    const root = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ map: texture(), aoMap: texture(1) });
    const object = mesh('Authored', mat, true); root.add(object); const uv = object.geometry.attributes.uv, uv1 = object.geometry.attributes.uv1;
    const before = { material: mat.version, map: mat.map.version, ao: mat.aoMap.version, geometry: object.geometry, uv, uv1, channel: mat.aoMap.channel };
    expect(modelShadingReport(root)).toEqual(modelShadingReport(root));
    expect({ material: mat.version, map: mat.map.version, ao: mat.aoMap.version, geometry: object.geometry, uv: object.geometry.attributes.uv, uv1: object.geometry.attributes.uv1, channel: mat.aoMap.channel }).toEqual(before);
  });
  it('does not require inactive physical-material feature texture channels', () => {
    const root = new THREE.Group(), material = new THREE.MeshPhysicalMaterial({ clearcoat: 0, clearcoatMap: texture(1) }); root.add(mesh('Clearcoat disabled', material));
    expect(modelShadingReport(root).missingUV).toEqual([]);
    material.clearcoat = 1; expect(modelShadingReport(root).missingUV.map((entry) => entry.slot)).toEqual(['clearcoatMap']);
  });
});
