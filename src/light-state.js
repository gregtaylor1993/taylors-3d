// Pure Home Assistant light readers. A display fallback is never a measured colour.
// HA supplies converted rgb_color for its active HS/XY/RGBW/RGBWW/temperature modes.
// https://developers.home-assistant.io/docs/core/entity/light/
const MODES = new Set(['onoff', 'brightness', 'color_temp', 'hs', 'xy', 'rgb', 'rgbw', 'rgbww', 'white']);
const COLOR_MODES = new Set(['hs', 'xy', 'rgb', 'rgbw', 'rgbww']);
const WARM = [255, 191, 128];
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, min, max) => finite(v) && v >= min && v <= max;
const diagnostic = (code, message) => ({ code, message });

function current(state) {
  if (state == null) return { status: 'missing', diagnostics: [diagnostic('missing', 'The light has no current state.')] };
  if (!plain(state) || typeof state.state !== 'string') return { status: 'invalid', diagnostics: [diagnostic('state', 'The light state is malformed.')] };
  if (state.entity_id !== undefined && (typeof state.entity_id !== 'string' || !state.entity_id.startsWith('light.')))
    return { status: 'unsupported', diagnostics: [diagnostic('domain', 'The reported entity is not a light.')] };
  if (state.attributes !== undefined && !plain(state.attributes)) return { status: 'invalid', diagnostics: [diagnostic('attributes', 'The light attributes are malformed.')] };
  const a = state.attributes || {};
  if (Object.hasOwn(a, 'restored') && typeof a.restored !== 'boolean') return { status: 'invalid', diagnostics: [diagnostic('restored', 'The restored-state flag is malformed.')] };
  if (state.state === 'unavailable' || a.restored === true) return { status: 'unavailable', diagnostics: [diagnostic('unavailable', 'Wait for a current light reading.')] };
  if (state.state === 'unknown') return { status: 'unknown', diagnostics: [diagnostic('unknown', 'The light state is unknown.')] };
  if (state.state !== 'on' && state.state !== 'off') return { status: 'unsupported', diagnostics: [diagnostic('state', 'The light does not report an on/off state.')] };
  return { status: state.state, attributes: a, diagnostics: [] };
}

function supported(a) {
  const modes = a.supported_color_modes;
  if (!Array.isArray(modes) || !modes.length || modes.some((m) => !MODES.has(m)) || new Set(modes).size !== modes.length)
    return { modes: [], diagnostics: [diagnostic('supported_color_modes', 'Supported light modes are missing or malformed.')] };
  if ((modes.includes('onoff') || modes.includes('brightness')) && modes.length !== 1)
    return { modes: [], diagnostics: [diagnostic('supported_color_modes', 'On/off and brightness-only modes must stand alone.')] };
  if (modes.includes('white') && (!modes.some((m) => COLOR_MODES.has(m)) || modes.includes('color_temp')))
    return { modes: [], diagnostics: [diagnostic('supported_color_modes', 'White mode requires a colour mode and cannot be combined with colour temperature.')] };
  return { modes, diagnostics: [] };
}

// Capabilities authorize deliberate controls; they do not establish the current appearance.
// Older supported_features bit fields and guessed universal temperature limits are not used.
export function lightCapabilities(state) {
  const result = { brightness: false, rgb: false, colorTemperature: false, minKelvin: null, maxKelvin: null, valid: false, diagnostics: [] };
  const c = current(state);
  if (!c.attributes) return { ...result, diagnostics: c.diagnostics };
  const s = supported(c.attributes);
  if (s.diagnostics.length) return { ...result, diagnostics: s.diagnostics };
  result.brightness = s.modes.some((m) => m !== 'onoff');
  result.rgb = s.modes.some((m) => COLOR_MODES.has(m));
  if (s.modes.includes('color_temp')) {
    const min = c.attributes.min_color_temp_kelvin, max = c.attributes.max_color_temp_kelvin;
    if (!finite(min) || !finite(max) || min <= 0 || max < min) {
      result.diagnostics = [diagnostic('temperature_bounds', 'Colour temperature controls need finite reported minimum and maximum Kelvin values.')];
      return result;
    }
    result.minKelvin = min; result.maxKelvin = max; result.colorTemperature = true;
  }
  result.valid = true;
  return result;
}

function hsv(h, s) {
  const f = (n) => { const k = (n + h / 60) % 6; return 1 - s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map((v) => Math.round(v * 255));
}
function kelvin(k) {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))));
}
const rgb = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => inRange(n, 0, 255));
const hs = (v) => Array.isArray(v) && v.length === 2 && inRange(v[0], 0, 360) && inRange(v[1], 0, 100);

function appearance(status, level = 0, color = [0, 0, 0], colorSource = 'none', brightnessKnown = false, colorKnown = false, diagnostics = []) {
  const output = level * Math.max(...color) / 255;
  return { status, level, color, colorSource, brightnessKnown, colorKnown, diagnostics, output,
    key: JSON.stringify([status, level, color, colorSource, brightnessKnown, colorKnown]) };
}
const invalid = (code, message) => appearance('invalid', 0, [0, 0, 0], 'none', false, false, [diagnostic(code, message)]);
const unknown = (code, message) => appearance('unknown', 0, [0, 0, 0], 'none', false, false, [diagnostic(code, message)]);

// level is the brightness fraction. output also accounts for black/dim RGB channels,
// matching HA's documented brightness * max(rgb)/255 definition for pool ranking.
// All returned renderer values are finite. The semantic key ignores names/timestamps.
export function readLightAppearance(state) {
  const c = current(state);
  if (!c.attributes) return appearance(c.status, 0, [0, 0, 0], 'none', false, false, c.diagnostics);
  if (c.status === 'off') return appearance('off'); // HA intentionally clears active colour fields while off.
  const a = c.attributes;
  const modern = a.color_mode !== undefined || a.supported_color_modes !== undefined;
  let mode = a.color_mode;
  if (a.supported_color_modes !== undefined) {
    const s = supported(a);
    if (s.diagnostics.length) return appearance('invalid', 0, [0, 0, 0], 'none', false, false, s.diagnostics);
    if (mode != null && !s.modes.includes(mode)) {
      const effect = typeof a.effect === 'string' && a.effect !== '' && a.effect !== 'off';
      if (!effect || (mode !== 'onoff' && mode !== 'brightness')) return invalid('color_mode', 'The current light mode is not supported.');
    }
  }
  if (modern && mode == null) return unknown('color_mode', 'The active light mode is not reported.');
  if (modern && !MODES.has(mode)) return invalid('color_mode', 'The active light mode is malformed or unsupported.');
  // Legacy states without modern capabilities retain their established fixed fixture look.
  if (!modern) mode = a.rgb_color != null ? 'rgb' : a.hs_color != null ? 'hs' : a.color_temp_kelvin != null ? 'color_temp'
    : a.xy_color != null ? 'xy' : a.rgbw_color != null ? 'rgbw' : a.rgbww_color != null ? 'rgbww' : 'legacy';
  const dimmable = modern && mode !== 'onoff';
  let level = 1, brightnessKnown = false;
  if (a.brightness != null && mode !== 'onoff') {
    if (!inRange(a.brightness, 0, 255)) return invalid('brightness', 'Brightness must be a finite number from 0 to 255.');
    level = a.brightness / 255; brightnessKnown = true;
  } else if (dimmable) return unknown('brightness', 'The active light brightness is not reported.');
  let color, colorSource, colorKnown = false;
  if (mode === 'legacy' || mode === 'onoff' || mode === 'brightness' || mode === 'white') {
    color = WARM.slice(); colorSource = 'display-fallback';
  } else if (a.rgb_color != null) {
    if (!rgb(a.rgb_color)) return invalid('rgb_color', 'The active RGB colour must contain three finite channels from 0 to 255.');
    color = a.rgb_color.slice(); colorSource = 'ha-rgb'; colorKnown = true;
  } else if (mode === 'hs' && a.hs_color != null) {
    if (!hs(a.hs_color)) return invalid('hs_color', 'Hue and saturation must be finite values in their reported ranges.');
    color = hsv(a.hs_color[0], a.hs_color[1] / 100); colorSource = 'hs'; colorKnown = true;
  } else if (mode === 'color_temp' && a.color_temp_kelvin != null) {
    if (!finite(a.color_temp_kelvin) || a.color_temp_kelvin <= 0) return invalid('color_temp_kelvin', 'The active Kelvin value must be a finite positive number.');
    color = kelvin(a.color_temp_kelvin); colorSource = 'kelvin'; colorKnown = true;
  } else return unknown('color', 'The active colour has no usable reported RGB conversion.');
  const fallback = !colorKnown || !brightnessKnown;
  const diagnostics = fallback ? [diagnostic('display_fallback', 'This fixed fixture appearance is a display fallback, not a fully measured light reading.')] : [];
  return appearance(fallback ? 'fallback' : 'ready', level, color, colorSource, brightnessKnown, colorKnown, diagnostics);
}
