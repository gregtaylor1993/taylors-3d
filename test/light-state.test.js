import { describe, expect, it } from 'vitest';
import { lightCapabilities, readLightAppearance } from '../src/light-state.js';

const state = (attributes = {}, reported = 'on') => ({ entity_id: 'light.test', state: reported, attributes });
const modern = (mode, attributes = {}) => state({ supported_color_modes: [mode], color_mode: mode, brightness: 128, ...attributes });
const safe = (r) => {
  expect(Number.isFinite(r.level)).toBe(true); expect(r.level).toBeGreaterThanOrEqual(0); expect(r.level).toBeLessThanOrEqual(1);
  expect(r.color).toHaveLength(3); expect(r.color.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)).toBe(true);
  expect(Number.isFinite(r.output)).toBe(true);
};

describe('reported HA light appearance', () => {
  it.each(['rgb', 'hs', 'xy', 'rgbw', 'rgbww', 'color_temp'])('uses HA-derived RGB for active %s without rejecting converted attributes', (mode) => {
    const a = readLightAppearance(modern(mode, { rgb_color: [128, 64, 32], hs_color: [30, 75], xy_color: [.4, .4], color_temp_kelvin: 2700 }));
    expect(a).toMatchObject({ status: 'ready', level: 128 / 255, color: [128, 64, 32], colorSource: 'ha-rgb', brightnessKnown: true, colorKnown: true });
    expect(a.output).toBeCloseTo((128 / 255) ** 2); safe(a);
  });
  it('calculates overall output independently of brightness for black/dim RGB colours', () => {
    expect(readLightAppearance(modern('rgb', { brightness: 255, rgb_color: [0, 0, 0] })).output).toBe(0);
    expect(readLightAppearance(modern('rgb', { brightness: 255, rgb_color: [1, 0, 0] })).output).toBe(1 / 255);
    expect(readLightAppearance(modern('rgb', { brightness: 0, rgb_color: [255, 255, 255] })).output).toBe(0);
  });
  it('converts actual HS and Kelvin readings if the RGB conversion is omitted', () => {
    expect(readLightAppearance(modern('hs', { hs_color: [120, 100] }))).toMatchObject({ color: [0, 255, 0], colorSource: 'hs', status: 'ready' });
    const warm = readLightAppearance(modern('color_temp', { color_temp_kelvin: 2700 }));
    const cool = readLightAppearance(modern('color_temp', { color_temp_kelvin: 6500 }));
    expect(warm.colorSource).toBe('kelvin'); expect(warm.color[0] / warm.color[2]).toBeGreaterThan(cool.color[0] / cool.color[2]);
    safe(warm); safe(cool);
  });
  it.each(['xy', 'rgbw', 'rgbww'])('does not guess active %s colour when HA-converted RGB is absent', (mode) => {
    const r = readLightAppearance(modern(mode, { xy_color: [.4, .4], rgbw_color: [0, 0, 0, 255], rgbww_color: [0, 0, 0, 255, 255] }));
    expect(r.status).toBe('unknown'); expect(r.output).toBe(0); expect(r.colorKnown).toBe(false); safe(r);
  });
  it('does not turn a legacy XY-only reading into a guessed warm colour', () => {
    expect(readLightAppearance(state({ xy_color: [.3, .3] }))).toMatchObject({ status: 'unknown', output: 0 });
  });
  it('ignores inactive colour fields in a non-colour mode', () => {
    expect(readLightAppearance(modern('brightness', { rgb_color: [NaN], hs_color: [Infinity], brightness: 51 })))
      .toMatchObject({ status: 'fallback', level: .2, color: [255, 191, 128], colorSource: 'display-fallback', colorKnown: false });
    expect(readLightAppearance(modern('onoff', { brightness: null, rgb_color: null })))
      .toMatchObject({ status: 'fallback', level: 1, brightnessKnown: false, colorKnown: false });
  });
  it('accepts documented effect-mode brightness fallback without claiming a measured colour', () => {
    const r = readLightAppearance(state({ supported_color_modes: ['rgb'], color_mode: 'brightness', effect: 'rainbow', brightness: 51, rgb_color: null }));
    expect(r).toMatchObject({ status: 'fallback', level: .2, colorSource: 'display-fallback' });
    expect(readLightAppearance(state({ supported_color_modes: ['rgb'], color_mode: 'brightness', brightness: 51 })).status).toBe('invalid');
  });
  it('retains a clearly labelled fixed appearance for legacy fixtures', () => {
    expect(readLightAppearance(state())).toMatchObject({ status: 'fallback', level: 1, color: [255, 191, 128], brightnessKnown: false, colorKnown: false });
    expect(readLightAppearance(state({ brightness: 51 }))).toMatchObject({ status: 'fallback', level: .2, brightnessKnown: true, colorKnown: false });
    expect(readLightAppearance(state({ rgb_color: [255, 0, 0] }))).toMatchObject({ status: 'fallback', colorKnown: true, brightnessKnown: false });
  });
  it.each([undefined, null])('keeps modern missing brightness dark (%s)', (brightness) => {
    expect(readLightAppearance(modern('rgb', { brightness, rgb_color: [255, 0, 0] }))).toMatchObject({ status: 'unknown', level: 0, output: 0 });
  });
  it.each([NaN, Infinity, -Infinity, -1, 256, '128', true, false, []])('rejects malformed active brightness %s', (brightness) => {
    const r = readLightAppearance(modern('rgb', { brightness, rgb_color: [255, 0, 0] }));
    expect(r.status).toBe('invalid'); expect(r.output).toBe(0); safe(r);
  });
  it.each([[255, 0], [255, 0, 0, 255], [NaN, 0, 0], [Infinity, 0, 0], [-1, 0, 0], [256, 0, 0], ['255', 0, 0], [true, 0, 0]].map((value) => ({ value })))('rejects malformed active RGB $value', ({ value: rgb_color }) => {
    const r = readLightAppearance(modern('rgb', { rgb_color, hs_color: [0, 100] }));
    expect(r.status).toBe('invalid'); expect(r.output).toBe(0); safe(r);
  });
  it.each([[NaN, 100], [0, Infinity], [361, 100], [0, -1], ['120', 100]].map((value) => ({ value })))('rejects malformed HS $value', ({ value: hs_color }) => {
    expect(readLightAppearance(modern('hs', { hs_color }))).toMatchObject({ status: 'invalid', output: 0 });
  });
  it.each([0, -2700, NaN, Infinity, '2700', true])('rejects malformed Kelvin %s', (color_temp_kelvin) => {
    expect(readLightAppearance(modern('color_temp', { color_temp_kelvin }))).toMatchObject({ status: 'invalid', output: 0 });
  });
  it.each([null, {}, [], { state: true }, state({}, 'unavailable'), state({}, 'unknown'), state({ restored: true }), state({ restored: 'false' }), state({ restored: 0 }), { entity_id: 'switch.a', state: 'on', attributes: {} }])('keeps unavailable/malformed/restored/non-light inputs finite and dark: %j', (input) => {
    const r = readLightAppearance(input); expect(r.output).toBe(0); expect(r.status).not.toBe('ready'); expect(r.status).not.toBe('fallback'); safe(r);
  });
  it('off ignores retained malformed appearance attributes, as HA clears active fields', () => {
    expect(readLightAppearance(state({ color_mode: null, brightness: null, rgb_color: [NaN] }, 'off'))).toMatchObject({ status: 'off', level: 0, output: 0 });
  });
  it('keeps semantic key unchanged for names, timestamps, inactive fields and new object identity', () => {
    const first = modern('rgb', { brightness: 51, rgb_color: [255, 0, 0] });
    const next = { ...first, last_updated: 'later', attributes: { ...first.attributes, friendly_name: 'renamed', hs_color: [NaN], battery: 12 } };
    expect(readLightAppearance(first).key).toBe(readLightAppearance(next).key);
    expect(readLightAppearance(first).key).not.toBe(readLightAppearance(modern('rgb', { brightness: 52, rgb_color: [255, 0, 0] })).key);
  });
});

describe('actual supported light controls', () => {
  it.each(['hs', 'xy', 'rgb', 'rgbw', 'rgbww'])('exposes deliberate RGB control for %s mode', (mode) => {
    expect(lightCapabilities(modern(mode))).toMatchObject({ valid: true, brightness: true, rgb: true, colorTemperature: false, minKelvin: null, maxKelvin: null });
  });
  it('supports on/off, brightness-only, and valid white plus colour modes', () => {
    expect(lightCapabilities(modern('onoff'))).toMatchObject({ valid: true, brightness: false, rgb: false });
    expect(lightCapabilities(modern('brightness'))).toMatchObject({ valid: true, brightness: true, rgb: false });
    expect(lightCapabilities(state({ supported_color_modes: ['rgb', 'white'] }))).toMatchObject({ valid: true, brightness: true, rgb: true });
  });
  it('only exposes Kelvin with finite reported bounds and actual color_temp support', () => {
    expect(lightCapabilities(modern('color_temp', { min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6000 })))
      .toMatchObject({ valid: true, brightness: true, rgb: false, colorTemperature: true, minKelvin: 2200, maxKelvin: 6000 });
    expect(lightCapabilities(modern('rgb', { min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6000 }))).toMatchObject({ valid: true, colorTemperature: false, minKelvin: null });
  });
  it.each([[undefined, undefined], [null, 6000], [NaN, 6000], [2200, Infinity], [0, 6000], [6000, 2200], ['2200', 6000], [true, 6000]])('rejects unknown/malformed temperature bounds %s / %s', (min, max) => {
    expect(lightCapabilities(modern('color_temp', { min_color_temp_kelvin: min, max_color_temp_kelvin: max }))).toMatchObject({ valid: false, colorTemperature: false });
  });
  it.each([undefined, null, [], ['unknown'], ['onoff', 'rgb'], ['brightness', 'rgb'], ['white'], ['white', 'color_temp', 'rgb'], ['rgb', 'rgb'], 'rgb', [false]].map((value) => ({ value })))('does not guess unsupported or deprecated capabilities $value', ({ value: supported_color_modes }) => {
    expect(lightCapabilities(state({ supported_color_modes, supported_features: 63, rgb_color: [255, 0, 0] })).valid).toBe(false);
  });
  it('allows supported deliberate actions despite unknown current colour/brightness and while off', () => {
    const a = { supported_color_modes: ['rgb'], color_mode: null, brightness: null, rgb_color: null };
    expect(lightCapabilities(state(a))).toMatchObject({ valid: true, brightness: true, rgb: true });
    expect(lightCapabilities(state(a, 'off'))).toMatchObject({ valid: true, brightness: true, rgb: true });
    expect(readLightAppearance(state(a))).toMatchObject({ status: 'unknown', output: 0 });
  });
  it.each(['unavailable', 'unknown', 'cleaning'])('blocks controls for non-current on/off state %s', (reported) => {
    expect(lightCapabilities(state({ supported_color_modes: ['rgb'] }, reported)).valid).toBe(false);
  });
  it.each([true, 'false', 0, null, undefined])('blocks restored or malformed restored flags %s', (restored) => {
    expect(lightCapabilities(modern('rgb', { restored })).valid).toBe(false);
  });
});
