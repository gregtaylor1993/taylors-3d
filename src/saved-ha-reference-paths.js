// Exact saved reference paths for the five additive Taylor features. No HA,
// archive, metadata, DOM or transport dependency. No generic string heuristics.
export const SAVED_HA_REFERENCE_LIMITS = Object.freeze({ references: 4096, diagnostics: 128, nodes: 16000, depth: 16 });
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const field = (v, key) => {
  const descriptor = plain(v) || Array.isArray(v) ? Object.getOwnPropertyDescriptor(v, key) : null;
  return { own: !!descriptor, safe: !descriptor || Object.hasOwn(descriptor, 'value'), value: descriptor?.value };
};
const valid = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v
  && !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const I = Symbol('known non-reference data'), ref = (kind) => ({ kind }), E = ref('entity'), F = ref('floor'), R = ref('room'), H = ref('anchor');
const obj = (fields) => ({ fields }), list = (items) => ({ items });
const ignored = (keys) => Object.fromEntries(keys.split(' ').map((key) => [key, I]));
const position = obj({ floorId: F, floor_id: F, ...ignored('x y z elevation shown visible') });
const schemas = {
  room_actions: obj({ version: I, rooms: list(obj({ room_id: R, actions: list(obj({ entity: E, ...ignored('id label service') })) })) }),
  scene_previews: obj({ enabled: I, items: list(obj({ scene_entity: E, lights: list(obj({ entity: E,
    ...ignored('state brightness color') })), ...ignored('id label') })) }),
  security_bindings: list(obj({ entity: E, floorId: F, floor_id: F, position,
    target: { planTarget: obj({ roomId: R, position_key: H, floorId: F, position, ...ignored('type z') }) },
    ...ignored('id label object_id kind open_states closed_states enabled color size outline hinge opening swing angle_degrees closed_degrees axis pivot transition_ms freshness contact_source_confirmed highlight motion') })),
  weather: obj({ entity: E, ...ignored('enabled quality intensity effects') }),
  house_summary: obj({ weather_entity: E, alarm_entity: E, person_entities: list(E), title: I }),
};

/** Actual effective source rules: four features use shared ?? card config;
 * room_actions uses the own shared descriptor even null/undefined/accessor.
 * Unknown fields stay raw and are disclosed, not treated as understood config.
 * segments preserve exact keys; path matches the existing saved-warning style.
 */
export function enumerateSavedHaReferences(input = {}) {
  const references = [], diagnostics = [], limits = SAVED_HA_REFERENCE_LIMITS, ancestors = new Set();
  let nodes = 0, complete = true, capped = false;
  const diagnostic = (code, segments, feature) => {
    complete = false;
    if (diagnostics.length < limits.diagnostics) diagnostics.push({ code, path: segments.join('.'), segments: [...segments], feature });
    else capped = true;
  };
  const layoutField = field(input, 'layout'), configField = field(input, 'config');
  if (!layoutField.safe) diagnostic('reference_accessor', ['layout'], null);
  if (!configField.safe) diagnostic('reference_accessor', ['config'], null);
  const layout = layoutField.safe ? layoutField.value : undefined, config = configField.safe ? configField.value : undefined;
  if (layout !== undefined && layout !== null && !plain(layout)) diagnostic('reference_shape', ['layout'], null);
  if (config !== undefined && config !== null && !plain(config)) diagnostic('reference_shape', ['config'], null);
  const walk = (value, schema, segments, feature, depth = 0) => {
    if (++nodes > limits.nodes || depth > limits.depth) { capped = true; diagnostic('reference_limit', segments, feature); return; }
    if (schema === I) return;
    if (schema.planTarget) {
      const type = field(value, 'type');
      if (!type.safe || type.value !== 'plan') { diagnostic(type.safe ? 'reference_shape' : 'reference_accessor', [...segments, 'type'], feature); return; }
      walk(value, schema.planTarget, segments, feature, depth + 1); return;
    }
    if (schema.kind) {
      if (value === null || value === undefined || value === '') return;
      if (!valid(value) || schema.kind === 'entity' && !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(value)) { diagnostic('reference_invalid', segments, feature); return; }
      if (references.length >= limits.references) { capped = true; diagnostic('reference_limit', segments, feature); return; }
      references.push({ kind: schema.kind, id: value, path: segments.join('.'), segments: [...segments], feature }); return;
    }
    if (ancestors.has(value)) { diagnostic('reference_unsafe', segments, feature); return; }
    if (schema.items) {
      if (!Array.isArray(value)) { diagnostic('reference_shape', segments, feature); return; }
      const length = field(value, 'length').value;
      ancestors.add(value);
      for (let index = 0; index < length; index++) {
        if (nodes >= limits.nodes) { capped = true; diagnostic('reference_limit', [...segments, index], feature); break; }
        const entry = field(value, String(index));
        if (!entry.own || !entry.safe) diagnostic(entry.safe ? 'reference_shape' : 'reference_accessor', [...segments, index], feature);
        else walk(entry.value, schema.items, [...segments, index], feature, depth + 1);
      }
      ancestors.delete(value); return;
    }
    if (!plain(value)) { diagnostic('reference_shape', segments, feature); return; }
    ancestors.add(value); const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (++nodes > limits.nodes) { capped = true; diagnostic('reference_limit', segments, feature); break; }
      const path = [...segments, typeof key === 'string' ? key : '(symbol)'], entry = field(value, key);
      if (!entry.safe) diagnostic('reference_accessor', path, feature);
      else if (typeof key !== 'string' || !Object.hasOwn(schema.fields, key)) diagnostic('reference_unknown', path, feature);
      else walk(entry.value, schema.fields[key], path, feature, depth + 1);
    }
    ancestors.delete(value);
  };
  for (const [feature, schema] of Object.entries(schemas)) {
    const shared = field(layout, feature), card = field(config, feature);
    const selected = feature === 'room_actions' && shared.own || shared.own && (!shared.safe || shared.value !== null && shared.value !== undefined) ? shared : card;
    const name = selected === shared ? 'layout' : 'config', segments = [name, feature];
    if (!selected.own) continue;
    if (feature === 'room_actions' && selected.safe && selected.value === undefined) continue;
    if (!selected.safe) diagnostic('reference_accessor', segments, feature);
    else {
      if (feature === 'room_actions' && plain(selected.value)) {
        const version = field(selected.value, 'version');
        if (!version.safe || version.value !== 1) { diagnostic(version.safe ? 'reference_version' : 'reference_accessor', [...segments, 'version'], feature); continue; }
      }
      walk(selected.value, schema, segments, feature);
    }
  }
  if (capped) {
    complete = false;
    // A diagnostic cap also gets an explicit remainder disclosure.
    if (!diagnostics.some((d) => d.code === 'reference_limit' && d.path === 'saved')) {
      const row = { code: 'reference_limit', path: 'saved', segments: ['saved'], feature: null };
      if (diagnostics.length >= limits.diagnostics) diagnostics[limits.diagnostics - 1] = row; else diagnostics.push(row);
    }
  }
  return { references, diagnostics, complete };
}
