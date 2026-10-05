// Static, read-only CURRENT ENVIRONMENT report. Archive verification remains a
// separate server result. Only explicitly known schema fields are references;
// entity-looking strings in opaque/custom data are never interpreted or changed.
import { enumerateSavedHaReferences } from './saved-ha-reference-paths.js';
export const BACKUP_REFERENCE_LIMITS = Object.freeze({ depth: 48, nodes: 60000, references: 4096, omissions: 512, string: 1000000 });
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const data = (v, key) => { if (!v || typeof v !== 'object') return undefined;
  const d = Object.getOwnPropertyDescriptor(v, key); return d && Object.hasOwn(d, 'value') ? d.value : undefined; };
const pointer = (p, key) => p + '/' + String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const exact = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v
  && !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const entity = (v) => exact(v) && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(v);
const IGNORE = Symbol('known non-reference data'), UNINSPECTED = Symbol('uninspected saved field'), E = { ref: 'entity' }, A = { ref: 'area' }, F = { ref: 'floor' }, D = { ref: 'device' };
const object = (fields) => ({ fields }), array = (items) => ({ items }), map = (values, keys) => ({ values, keys });
const scalars = (names) => Object.fromEntries(names.split(' ').filter(Boolean).map((name) => [name, IGNORE]));
const position = object({ floorId: F, floor_id: F, ...scalars('x y z elevation shown visible auto on_model anchor offset parent object_id') });
const freshness = IGNORE; // Timestamp paths/age are source data, not HA IDs.
const source = object({ entity: E, floorId: F, floor_id: F, freshness,
  ...scalars('source x_attr y_attr latitude_attr longitude_attr units north_up plan_meters calibration attribute room_map') });
const tracking = object({ entity: E, identity_entity: E, floorId: F, floor_id: F, position,
  room_source: source, position_source: source, position_key: { marker: true }, freshness,
  ...scalars('id kind label enabled signal roomId identity_attribute identity_value active_states clear_states vehicle_source_confirmed timestamp_mode timestamp_attr timestamp_format expires_seconds event_types event_type_attr event_id_attr color size heading interpolate_ms show_inactive') });
const actionTarget = object({ entity_id: array(E), area_id: array(A), floor_id: array(F), device_id: array(D) });
const action = object({ target: actionTarget, data: actionTarget, service_data: actionTarget, entity: E,
  ...scalars('action perform_action service navigation_path url_path confirmation haptic repeat') });
const overlayEntity = { stringOrObject: object({ entity: E, ...scalars('independent circuit group role period') }) };
const overlayBinding = object({ entities: array(overlayEntity),
  ...scalars('mode aggregation period unit min max colors independent_confirmed') });
const model = object({ rooms: map(object({ area: A, ...scalars('auto visible name') })),
  levels: map(object({ floor: { ref: 'floor', sentinels: ['always', 'hidden'] }, ...scalars('auto show') })),
  floor_map: map({ ref: 'floor', sentinels: ['always', 'hidden'] }),
  ...scalars('version name size sha256 position rotation scale opacity pins_migrated id') });
const view = object({ floors: array(F), ...scalars('id label hidden rules camera camera_top cameraFrame camera_topFrame camera_mode cut section parent enabled show room_id object_id') });
const features = {
  mower: object({ entity: E, floor_id: F, floorId: F, overlay: object({ entity: E, ...scalars('x y rotation width opacity refresh url crop') }),
    ...scalars('source x_attr y_attr latitude_attr longitude_attr units north_up plan_meters calibration trail track_image image_tracking image_blob heading interpolate_ms') }),
  presence_bindings: array(tracking), vehicle_bindings: array(tracking), vacuum_bindings: array(tracking),
  // These feature paths share the effective-schema reader with registryIssues.
  room_actions: IGNORE, house_summary: IGNORE, weather: IGNORE, scene_previews: IGNORE, security_bindings: IGNORE,
  alert_bindings: array(object({ entity: E, area_id: A, floorId: F, floor_id: F, position, position_key: { marker: true }, markerId: { marker: true },
    ...scalars('id label type roomId room_id object_id x y z clear_rule trigger_states clear_states severity enabled color size threshold above below unit') })),
  room_overlays: object({ bindings: map({ arrayOrObject: overlayBinding, arrayItems: overlayEntity }), ...scalars('mode legend min max unit aggregation enabled') }),
  camera_coverage: map(object(scalars('enabled heading fov range color opacity show_rays segments')), { marker: true }),
  furniture: object({ instances: array(object({ floor_id: F, ...scalars('id pack_id asset_sha256 item_id x y z rotation_degrees scale') })), ...scalars('version') }),
  views: map(view), floor_presentation: object({ floors: array(F), ...scalars('mode gap_m axis base_elevation_m') }),
  model_rendering: IGNORE, wall_presentation: IGNORE, ambient_idle: IGNORE,
};
const layoutSchema = object({ ...features, version: IGNORE, model,
  floors: array(object({ id: F, ...scalars('name elevation height') })),
  rooms: array(object({ area_id: A, floor_id: F, floorId: F, ...scalars('id name polygon doors outdoor hidden label color height') })),
  pins: map(position, { marker: true }), hidden: array({ marker: true }),
  objects: map(object({ entity: E, ...scalars('hidden anchor offset label enabled') })), groups: map(object({ entity: E, ...scalars('hidden label') })),
  ...scalars('model_bindings default_view selected_view') });
const taylorSchema = object({ ...features, model: IGNORE, model_floors: map({ ref: 'floor', sentinels: ['always', 'hidden'] }),
  floor: { ref: 'floor', sentinels: ['all'] }, include: array(E), exclude: array(E), entities: array(E),
  ...scalars('type layout_key height group_by wall_height view view_id zoom_to sky_bodies sun_azimuth sun_elevation mini_map mini_map_size mini_map_position show_bubble_bar bubble_buttons toolbar_buttons show_header title control_panel layout_style house_colour_scheme house_theme theme lights light_glow lamps light_pool merge occlusion model_position model_rotation model_scale model_opacity model_merge model_shadows shadows floor_height show_room_names device_tap_action show_unavailable show_entity_names marker_size camera_mode furniture_library') });
const knownCards = new Set('entities entity button tile glance picture picture-entity picture-glance light thermostat humidifier alarm-panel sensor gauge history-graph statistics-graph statistic weather-forecast map calendar media-control area markdown iframe horizontal-stack vertical-stack grid conditional heading'.split(' '));

/** Extract once per immutable inspector snapshot. Every input byte stays raw.
 * Unrecognized branches, unsafe static data and bounded remainder are disclosed.
 * Paths are JSON pointers, including exact dictionary keys and original IDs.
 */
export function collectDashboardReferences(preview) {
  const references = [], uninspected = [], omissions = new Set(), seen = new Set(), limits = BACKUP_REFERENCE_LIMITS;
  let nodes = 0, capped = false;
  const omit = (code, path) => { const key = code + ':' + path;
    if (!omissions.has(key) && uninspected.length < limits.omissions) { omissions.add(key); uninspected.push({ code, path }); }
    else if (uninspected.length >= limits.omissions) capped = true; };
  const ancestors = new Set();
  const snapshot = (raw, path, depth = 0) => {
    if (++nodes > limits.nodes || depth > limits.depth) { omit('limit', path); capped = true; return undefined; }
    if (raw === null || typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') { if (raw.length > limits.string) { omit('limit', path); return undefined; } return raw; }
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (!Array.isArray(raw) && !plain(raw) || ancestors.has(raw)) { omit('unsafe', path); return undefined; }
    ancestors.add(raw); const keys = Reflect.ownKeys(raw), out = Array.isArray(raw) ? [] : Object.create(null);
    if (keys.length > limits.nodes - nodes) { omit('limit', path); ancestors.delete(raw); capped = true; return undefined; }
    for (const key of keys) {
      if (Array.isArray(raw) && key === 'length') continue;
      const p = pointer(path, key), descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (typeof key !== 'string' || !descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
        omit('unsafe', p);
        // Preserve own-field authority without evaluating unsafe data. Removing
        // a shared accessor would wrongly make its inactive card fallback live.
        if (typeof key === 'string') Object.defineProperty(out, key, { value: UNINSPECTED, enumerable: true });
        continue;
      }
      Object.defineProperty(out, key, { value: snapshot(descriptor.value, p, depth + 1), enumerable: true });
      if (nodes > limits.nodes) break;
    }
    ancestors.delete(raw); return out;
  };
  const root = snapshot(preview, '/preview');
  const add = (kind, id, path, floors, sentinels = []) => {
    if (id === undefined || id === null || id === '' || sentinels.includes(id)) return;
    if (Array.isArray(id)) { id.forEach((value, i) => add(kind, value, pointer(path, i), floors, sentinels)); return; }
    if (!exact(id) || kind === 'entity' && !entity(id)) { omit('invalid_reference', path); return; }
    if (references.length >= limits.references) { omit('limit', path); capped = true; return; }
    const key = kind + ':' + path + ':' + id; if (seen.has(key)) return; seen.add(key);
    references.push({ kind, id, path, layoutFloor: kind === 'floor' && floors.has(id) });
  };
  const marker = (id, path, floors) => {
    if (typeof id !== 'string') { omit('invalid_reference', path); return; }
    if (id.startsWith('entity:')) add('entity', id.slice(7), path, floors);
    else if (id.startsWith('device:')) add('device', id.slice(7), path, floors);
    else if (entity(id)) add('entity', id, path, floors);
    else if (!id.startsWith('object:')) omit('unresolved_marker', path);
  };
  const walk = (raw, schema, path, floors) => {
    if (schema === IGNORE || raw === undefined || raw === null) return;
    if (schema === action && (!plain(raw) || !['none', 'more-info', 'toggle', 'perform-action', 'call-service', 'navigate', 'url'].includes(raw.action))) { omit('opaque_config', path); return; }
    if (schema.stringOrObject) { walk(raw, typeof raw === 'string' ? E : schema.stringOrObject, path, floors); return; }
    if (schema.arrayOrObject) { walk(raw, Array.isArray(raw) ? array(schema.arrayItems) : schema.arrayOrObject, path, floors); return; }
    if (schema.ref) { add(schema.ref, raw, path, floors, schema.sentinels); return; }
    if (schema.marker) { marker(raw, path, floors); return; }
    if (schema.items) {
      // Explicit HA action targets and entity selectors accept one ID or a list.
      if (typeof raw === 'string' && schema.items.ref) { walk(raw, schema.items, path, floors); return; }
      if (!Array.isArray(raw)) { omit('unknown_shape', path); return; }
      raw.forEach((value, i) => walk(value, schema.items, pointer(path, i), floors)); return;
    }
    if (schema.values) {
      if (!plain(raw)) { omit('unknown_shape', path); return; }
      for (const [key, value] of Object.entries(raw)) {
        const p = pointer(path, key); if (schema.keys) walk(key, schema.keys, p, floors); walk(value, schema.values, p, floors);
      } return;
    }
    if (!plain(raw)) { omit('unknown_shape', path); return; }
    for (const [key, value] of Object.entries(raw)) {
      const p = pointer(path, key); if (Object.hasOwn(schema.fields, key)) walk(value, schema.fields[key], p, floors); else omit('unknown_config', p);
    }
  };
  const layouts = plain(root?.layouts) ? root.layouts : Object.create(null), floorsByKey = new Map();
  const additive = (input, bases, floors) => {
    const result = enumerateSavedHaReferences(input);
    const savedPath = (segments) => segments.slice(1).reduce(pointer, bases[segments[0]] ?? '/preview');
    for (const r of result.references) if (['entity', 'area', 'floor', 'device'].includes(r.kind)) {
      add(r.kind, r.id, savedPath(r.segments), floors);
    }
    for (const d of result.diagnostics) omit(d.code === 'reference_limit' ? 'limit' : d.code === 'reference_accessor' || d.code === 'reference_unsafe' ? 'unsafe' : 'unknown_config', savedPath(d.segments));
    if (!result.complete && result.diagnostics.some((d) => d.code === 'reference_limit')) capped = true;
  };
  for (const [key, row] of Object.entries(layouts)) {
    const layout = row?.layout, floors = new Set(Array.isArray(layout?.floors) ? layout.floors.map((f) => f?.id).filter(exact) : []);
    const base = pointer(pointer('/preview/layouts', key), 'layout');
    // Standalone archived layouts remain reportable saved data. Effective shared
    // paths are deduplicated when a referencing card resolves them again below.
    floorsByKey.set(key, floors); walk(layout, layoutSchema, base, floors); additive({ layout }, { layout: base }, floors);
  }
  const card = (raw, path) => {
    if (!plain(raw)) { omit('unknown_card', path); return; }
    const type = raw.type, floors = floorsByKey.get(raw.layout_key || 'default') || new Set();
    if (type === 'custom:taylors3d-card') {
      const key = raw.layout_key || 'default', layout = layouts[key]?.layout;
      if (!Object.hasOwn(layouts, key)) omit('layout_not_inspected', path + '/layout_key');
      // Resolve each card with its exact shared layout. A shared override cannot
      // make an inactive card fallback look like a missing dashboard dependency;
      // nullish shared fields can still use distinct fallbacks on different cards.
      walk(raw, taylorSchema, path, floors);
      additive({ layout, config: raw }, { layout: pointer(pointer('/preview/layouts', key), 'layout'), config: path }, floors); return;
    }
    if (!knownCards.has(type)) { omit('unknown_card', path); return; }
    for (const [key, value] of Object.entries(raw)) {
      const p = pointer(path, key);
      if (key === 'cards' && Array.isArray(value)) value.forEach((c, i) => card(c, pointer(p, i)));
      else if (key === 'card') card(value, p);
      else if (['entity', 'camera_image', 'image_entity'].includes(key)) walk(value, E, p, floors);
      else if (key === 'area') walk(value, A, p, floors);
      else if (key === 'entities') {
        if (!Array.isArray(value)) { omit('unknown_shape', p); continue; }
        value.forEach((entry, i) => {
          const ep = pointer(p, i);
          if (typeof entry === 'string') walk(entry, E, ep, floors);
          else if (plain(entry)) {
            if (typeof entry.type === 'string' && entry.type.startsWith('custom:')) { omit('unknown_card', ep); return; }
            walk(entry, object({ entity: E, tap_action: action, hold_action: action, double_tap_action: action,
              ...scalars('name icon secondary_info state_color type attribute format unit prefix suffix') }), ep, floors);
          }
          else omit('unknown_shape', ep);
        });
      } else if (['tap_action', 'hold_action', 'double_tap_action'].includes(key)) walk(value, action, p, floors);
      else if (key === 'conditions' || key === 'visibility') conditions(value, p, floors);
      else if (key === 'badges' && Array.isArray(value)) value.forEach((badge, i) => {
        if (typeof badge === 'string') walk(badge, E, pointer(p, i), floors); else card(badge, pointer(p, i));
      });
      else if (['content', 'url', 'elements', 'features', 'strategy', 'card_mod', 'header', 'footer'].includes(key)) omit('opaque_config', p);
      else if (!'type title name icon theme state_color show_name show_icon show_state camera_view aspect_ratio image fit_mode columns square hours_to_show refresh_interval min max severity needle graph detail unit attribute entities heading heading_style grid_options layout_options'.split(' ').includes(key)) omit('unknown_config', p);
    }
  };
  const conditions = (raw, path, floors) => {
    if (!Array.isArray(raw)) { omit('unknown_shape', path); return; }
    raw.forEach((condition, i) => {
      const p = pointer(path, i), type = condition?.condition;
      if (!plain(condition) || type !== undefined && !['state', 'numeric_state', 'screen', 'user', 'and', 'or', 'not'].includes(type)) { omit('opaque_config', p); return; }
      for (const [key, value] of Object.entries(condition)) {
        if (key === 'entity') walk(value, E, pointer(p, key), floors);
        else if (key === 'conditions') conditions(value, pointer(p, key), floors);
        else if (!['condition', 'state', 'state_not', 'above', 'below', 'screen', 'users'].includes(key)) omit('opaque_config', pointer(p, key));
      }
    });
  };
  const dashboard = root?.dashboard;
  if (!plain(dashboard)) omit('dashboard_not_inspected', '/preview/dashboard');
  else {
    for (const key of Object.keys(dashboard)) if (!['views', 'title', 'background', 'button_card_templates'].includes(key)) omit('opaque_config', pointer('/preview/dashboard', key));
    if (dashboard.button_card_templates !== undefined) omit('opaque_config', '/preview/dashboard/button_card_templates');
    if (!Array.isArray(dashboard.views)) omit('dashboard_not_inspected', '/preview/dashboard/views');
    else dashboard.views.forEach((v, i) => {
      const p = pointer('/preview/dashboard/views', i);
      if (!plain(v)) { omit('unknown_shape', p); return; }
      if (Array.isArray(v.cards)) v.cards.forEach((c, j) => card(c, pointer(p + '/cards', j)));
      if (Array.isArray(v.sections)) v.sections.forEach((section, j) => {
        const sp = pointer(p + '/sections', j);
        if (Array.isArray(section?.cards)) section.cards.forEach((c, n) => card(c, pointer(sp + '/cards', n)));
        for (const k of Object.keys(section || {})) if (!['type', 'cards', 'column_span'].includes(k)) omit('opaque_config', pointer(sp, k));
      });
      if (Array.isArray(v.badges)) v.badges.forEach((badge, j) => {
        const bp = pointer(p + '/badges', j); if (typeof badge === 'string') walk(badge, E, bp, new Set()); else card(badge, bp);
      });
      for (const k of Object.keys(v)) if (!'cards sections badges type title path icon theme background panel subview visible max_columns dense_section_placement'.split(' ').includes(k)) omit('opaque_config', pointer(p, k));
    });
  }
  if (capped) omit('limit', '/preview');
  return { references, uninspected, bounded: !capped, nodes };
}

/** Compare only extracted IDs, every call, even if registry dictionaries mutate
 * in place. Own-property projections never invoke HA formatters/getters/hooks.
 * Missing requires loaded relevant dictionaries; absence is not an empty map.
 */
export function resolveDashboardReferences(graph, hass = {}) {
  const uninspected = graph.uninspected.map((row) => ({ ...row })), registry = {}, missingRegistries = new Set();
  const collections = new Map(), projections = new Map();
  const collection = (key) => {
    if (collections.has(key)) return collections.get(key);
    const value = data(hass, key), loaded = plain(value); registry[key] = loaded ? 'loaded' : 'not_loaded'; collections.set(key, loaded ? value : null); return loaded ? value : null;
  };
  const waiting = (key) => { if (!missingRegistries.has(key)) { missingRegistries.add(key); uninspected.push({ code: 'registry_not_loaded', path: '/current/' + key }); } };
  const unsafe = (value, keys, path) => {
    for (const key of keys) {
      const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : null;
      if (descriptor && !Object.hasOwn(descriptor, 'value')) {
        const p = pointer(path, key); if (!missingRegistries.has(p)) { missingRegistries.add(p); uninspected.push({ code: 'registry_unsafe', path: p }); } return true;
      }
    } return false;
  };
  const project = (kind, id, layoutFloor) => {
    const cache = kind + ':' + id + ':' + layoutFloor; if (projections.has(cache)) return projections.get(cache);
    let result;
    if (kind === 'entity') {
      const states = collection('states'), entities = collection('entities'), state = data(states, id), entry = data(entities, id);
      if (!states) waiting('states'); if (!entities) waiting('entities');
      const reading = data(state, 'state'), attributes = data(state, 'attributes'), deviceId = data(entry, 'device_id');
      const device = typeof deviceId === 'string' ? data(collection('devices'), deviceId) : undefined;
      if (typeof deviceId === 'string' && !collection('devices')) waiting('devices');
      result = { status: state || entry ? 'present' : states && entities ? 'missing' : 'waiting',
        reading: !states ? 'not_loaded' : !state ? 'no_state' : data(attributes, 'restored') === true ? 'restored'
          : reading === 'unavailable' ? 'unavailable' : reading === 'unknown' ? 'unknown' : typeof reading === 'string' && reading.trim() ? 'reported' : 'invalid',
        hidden: data(entry, 'hidden') === true || !!data(entry, 'hidden_by'),
        disabled: data(entry, 'disabled') === true || !!data(entry, 'disabled_by') || !!data(device, 'disabled_by'),
        category: typeof data(entry, 'entity_category') === 'string' ? data(entry, 'entity_category') : null };
      if (unsafe(states, [id], '/current/states') || unsafe(entities, [id], '/current/entities')
        || unsafe(state, ['state', 'attributes'], pointer('/current/states', id))
        || unsafe(attributes, ['restored'], pointer(pointer('/current/states', id), 'attributes'))
        || unsafe(entry, ['hidden', 'hidden_by', 'disabled', 'disabled_by', 'entity_category', 'device_id'], pointer('/current/entities', id))
        || typeof deviceId === 'string' && (unsafe(collection('devices'), [deviceId], '/current/devices')
          || unsafe(device, ['disabled_by'], pointer('/current/devices', deviceId)))) result.status = 'waiting';
    } else {
      const key = kind + 's', values = collection(key), entry = data(values, id); if (!values) waiting(key);
      result = { status: entry ? 'present' : kind === 'floor' && layoutFloor ? 'layout_only' : values ? 'missing' : 'waiting' };
      if (unsafe(values, [id], '/current/' + key)) result.status = 'waiting';
    }
    projections.set(cache, result); return result;
  };
  const references = graph.references.map((row) => ({ ...row, ...project(row.kind, row.id, row.layoutFloor) }));
  const counts = { checked: references.length, missing: 0, waiting: 0, unavailable: 0, eligibility: 0, layoutOnly: 0, uninspected: uninspected.length };
  for (const r of references) {
    if (r.status === 'missing') counts.missing++; if (r.status === 'waiting') counts.waiting++; if (r.status === 'layout_only') counts.layoutOnly++;
    if (r.status === 'present' && r.kind === 'entity' && (['no_state', 'unavailable', 'restored', 'invalid'].includes(r.reading)
      || r.reading === 'unknown' && !r.id.startsWith('scene.'))) counts.unavailable++;
    if (r.hidden || r.disabled || r.category) counts.eligibility++;
  }
  return { references, uninspected, registry, counts, coverage: uninspected.length || !graph.bounded ? 'partial' : 'known_fields',
    needsReview: counts.missing + counts.waiting + counts.unavailable + counts.eligibility + counts.layoutOnly + counts.uninspected > 0 };
}
export const inspectDashboardReferences = (preview, hass) => resolveDashboardReferences(collectDashboardReferences(preview), hass);
