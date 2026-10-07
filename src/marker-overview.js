// Display-only decluttering. Source coordinates, room membership, actual HA
// readings and alert evidence stay separate from renderer visibility.
import { centroid, pointInPolygon, signedArea } from './placement.js';
import { roomAtPlan } from './navigation.js';
import { buildRoomSummary } from './room-summary.js';
import { localeInfo } from './localization.js';
import captions from './translations/marker-overview.js';

export const MARKER_DISPLAY_MODES = Object.freeze(['all', 'rooms', 'important']);
export const markerDisplayMode = (value) => MARKER_DISPLAY_MODES.includes(value) ? value : 'all';
export const markerOverviewText = (hass, key, values = {}) => {
  const catalogue = captions[localeInfo(hass).resolved] || captions.en;
  return (catalogue[key] || captions.en[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
};
const text = markerOverviewText;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const list = (value) => Array.isArray(value) ? value : [];
const entityIds = (marker) => [...new Set([marker?.entityId, ...list(marker?.entities).map((entry) => typeof entry === 'string' ? entry : entry?.eid)].filter((id) => typeof id === 'string' && id.includes('.')))];
const alertClasses = new Set(['smoke', 'gas', 'carbon_monoxide', 'moisture', 'safety', 'problem', 'tamper', 'door', 'window', 'garage_door', 'opening']);
const presenceClasses = new Set(['motion', 'occupancy', 'presence']);

// An exact current state is the only automatic activity evidence. In
// particular climate "auto", power values and camera streaming are not guessed
// to mean activity. Configured latched alerts are supplied by the alert reader.
export function markerActivity(hass, marker, alertEntities = new Set()) {
  let alert = false, active = false;
  for (const id of entityIds(marker)) {
    if (alertEntities.has(id)) alert = true;
    const source = hass?.states?.[id];
    if (!source || source.attributes?.restored === true || hass?.connection?.connected !== true
      || !hass?.user?.id || hass.user.is_active === false) continue;
    const domain = id.split('.')[0], state = source.state, kind = source.attributes?.device_class;
    if (domain === 'binary_sensor' && state === 'on' && alertClasses.has(kind)
      || domain === 'lock' && state === 'unlocked'
      || domain === 'alarm_control_panel' && ['triggered', 'pending'].includes(state)) alert = true;
    if (['light', 'switch', 'fan', 'input_boolean', 'humidifier'].includes(domain) && state === 'on'
      || domain === 'media_player' && state === 'playing'
      || domain === 'cover' && ['opening', 'closing'].includes(state)
      || domain === 'vacuum' && ['cleaning', 'returning'].includes(state)
      || domain === 'lawn_mower' && ['mowing', 'returning'].includes(state)
      || domain === 'binary_sensor' && state === 'on' && presenceClasses.has(kind)) active = true;
  }
  return { alert, active };
}

// Keep a chip inside its actual outline, including concave rooms. If there is
// no usable interior, do not create a misleading room anchor or hide devices.
export function roomOverviewAnchor(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 2048
    || !polygon.every((point) => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(finite))
    || Math.abs(signedArea(polygon)) < 1e-8) return null;
  const middle = centroid(polygon);
  if (middle.every(finite) && pointInPolygon(middle, polygon)) return middle;
  const xs = polygon.map((point) => point[0]), ys = polygon.map((point) => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  let best = null, distance = Infinity;
  for (let x = 1; x < 16; x++) for (let y = 1; y < 16; y++) {
    const point = [minX + width * x / 16, minY + height * y / 16];
    const next = (point[0] - middle[0]) ** 2 + (point[1] - middle[1]) ** 2;
    if (next < distance && pointInPolygon(point, polygon)) { best = point; distance = next; }
  }
  return best;
}

function markerRoom(marker, position, rooms) {
  // Pins deliberately placed outside their HA area follow their actual plan
  // location. The smallest containing outline handles nested garden zones.
  if (position && finite(position.x) && finite(position.y)) {
    const containing = roomAtPlan(rooms, [position.x, position.y], position.floorId);
    if (containing) return containing.room.id;
    if (position.auto === false || position.live) return null;
  }
  const assigned = rooms.filter((entry) => marker.areaId && entry.room.area_id === marker.areaId
    && (!position?.floorId || entry.floorId === position.floorId));
  return assigned.length === 1 ? assigned[0].room.id : null;
}

export function buildMarkerOverview({ hass, mode, selectedRoomId = null, editing = false, markers = [],
  positions = new Map(), rooms = [], allRooms = rooms, alerts = [], summaryMarkers = markers } = {}) {
  mode = markerDisplayMode(mode);
  if (mode === 'all' || editing) return { mode, editing: !!editing, selectedRoomId: null,
    markers: new Map(list(markers).filter((marker) => typeof marker?.id === 'string').map((marker) => [marker.id, {roomId:null,keep:true}])), rooms: [] };
  const eligible = [], ids = new Set(), duplicates = new Set();
  for (const entry of list(allRooms)) {
    const id = entry?.room?.id;
    if (typeof id !== 'string' || !id || typeof entry.floorId !== 'string' || entry.shown === false) continue;
    if (ids.has(id)) duplicates.add(id); ids.add(id);
    const anchor = roomOverviewAnchor(entry.room.polygon);
    if (anchor) eligible.push({ ...entry, anchor });
  }
  const currentRooms = eligible.filter((entry) => !duplicates.has(entry.room.id));
  const selected = currentRooms.some((entry) => entry.room.id === selectedRoomId) ? selectedRoomId : null;
  const activeAlerts = new Set(list(alerts).filter((row) => row?.active === true).map((row) => row.entity));
  const records = new Map(), members = new Map(currentRooms.map((entry) => [entry.room.id, new Set()]));
  for (const marker of list(markers)) {
    if (!marker || typeof marker.id !== 'string') continue;
    const position = positions instanceof Map ? positions.get(marker.id) : null;
    const roomId = markerRoom(marker, position, currentRooms), activity = markerActivity(hass, marker, activeAlerts);
    const keep = editing || mode === 'all' || activity.alert || mode === 'rooms' && (!roomId || roomId === selected)
      || mode === 'important' && activity.active;
    records.set(marker.id, { roomId, keep: !!keep, ...activity });
  }
  for (const marker of list(summaryMarkers)) {
    if (!marker) continue;
    // Summary membership follows the same actual placement when available.
    // Bound GLB devices without standalone positions use their exact HA area.
    const roomId = markerRoom(marker, positions instanceof Map ? positions.get(marker.id) : null, currentRooms);
    const membership = members.get(roomId);
    if (membership) for (const id of entityIds(marker)) membership.add(id);
  }
  const shownRooms = new Set(list(rooms).filter((entry) => entry?.shown !== false).map((entry) => entry?.room?.id));
  const summaries = mode === 'rooms' && !editing ? currentRooms.filter((entry) => shownRooms.has(entry.room.id)).map((entry) => {
    const roomId = entry.room.id, counts = buildRoomSummary({ hass, entityIds: [...members.get(roomId)] });
    const parts = [];
    if (counts.available) {
      if (counts.lights.total) parts.push(text(hass, 'markerOverview.lights', { count: counts.lights.on }));
      if (counts.media.playing) parts.push(text(hass, 'markerOverview.media', { count: counts.media.playing }));
      const unknown = counts.lights.unknown + counts.media.unknown;
      if (unknown) parts.push(text(hass, 'markerOverview.unknown', { count: unknown }));
    }
    return { roomId, floorId: entry.floorId, x: entry.anchor[0], y: entry.anchor[1],
      name: String(entry.name || entry.room.name || entry.room.area_id || roomId),
      summary: counts.available ? parts.join(' · ') || text(hass, 'markerOverview.open') : text(hass, 'markerOverview.waiting'),
      detail: counts.text, selected: roomId === selected };
  }) : [];
  return { mode, editing: !!editing, selectedRoomId: selected, markers: records, rooms: summaries,
    chooserLabel: text(hass, 'markerOverview.rooms'), chooserTitle: text(hass, 'markerOverview.choose') };
}

export const MARKER_OVERVIEW_CSS = `
  .taylors3d-room-overview { pointer-events:auto;box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;
    justify-content:center;gap:2px;min-height:44px;min-width:68px;max-width:156px;padding:8px 11px;
    border:1px solid var(--taylors3d-ui-border,var(--divider-color,#72777f));border-radius:14px;
    background:var(--taylors3d-ui-glass,var(--card-background-color,#18212b));color:var(--taylors3d-ui-text,var(--primary-text-color,#fff));
    font:inherit;text-align:start;cursor:pointer;box-shadow:0 3px 12px #0003;}
  .taylors3d-room-overview strong {max-width:100%;font-size:12px;font-weight:650;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .taylors3d-room-overview span {max-width:100%;font-size:10px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .taylors3d-room-overview[aria-pressed="true"] {border-color:var(--taylors3d-ui-text,var(--primary-text-color,#fff));box-shadow:0 0 0 1px var(--taylors3d-ui-text,var(--primary-text-color,#fff));}
  .taylors3d-room-overview:hover {filter:brightness(1.08);}
  .taylors3d-room-overview:focus-visible {outline:3px solid var(--taylors3d-ui-text,var(--primary-text-color,#fff));outline-offset:3px;}
  .taylors3d-room-chooser {position:absolute;z-index:12;inset:10px auto auto 10px;max-width:calc(100% - 20px);pointer-events:auto;}
  .taylors3d-room-chooser[hidden],.taylors3d-room-chooser-list[hidden] {display:none!important;}
  .taylors3d-room-chooser-toggle {min-height:44px;padding:8px 13px;border:1px solid var(--taylors3d-ui-border,var(--divider-color,#72777f));border-radius:14px;
    background:var(--taylors3d-ui-glass,var(--card-background-color,#18212b));color:var(--taylors3d-ui-text,var(--primary-text-color,#fff));font:inherit;font-weight:600;cursor:pointer;}
  .taylors3d-room-chooser-list {position:absolute;top:calc(100% + 6px);left:0;width:260px;max-width:calc(100vw - 48px);overflow:auto;overscroll-behavior:contain;
    display:grid;gap:4px;padding:6px;border:1px solid var(--taylors3d-ui-border,var(--divider-color,#72777f));border-radius:16px;box-sizing:border-box;
    background:var(--taylors3d-ui-surface,var(--card-background-color,#18212b));box-shadow:var(--taylors3d-ui-shadow,0 8px 24px #0004);}
  .taylors3d-room-chooser-list .taylors3d-room-overview {width:100%;max-width:none;min-height:48px;box-shadow:none;border-color:transparent;background:transparent;}
  .taylors3d-room-chooser-toggle:focus-visible {outline:3px solid var(--taylors3d-ui-text,var(--primary-text-color,#fff));outline-offset:3px;}
  @media(forced-colors:active){.taylors3d-room-overview{background:Canvas;color:CanvasText;border-color:ButtonText;box-shadow:none;}.taylors3d-room-overview[aria-pressed="true"]{border:2px solid Highlight;}}
`;
