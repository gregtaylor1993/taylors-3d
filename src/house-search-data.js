// Search destinations are descriptions, never device commands. The card
// resolves the chosen destination again against the current account and layout.
import { entityMetadata } from './entity-metadata.js';
import { editorGroupForTab, editorTabs } from './editor-navigation.js';
import { globalSearchText } from './global-search.js';
import { localeInfo, localize } from './localization.js';
import navigationMessages from './translations/editor-navigation.js';

export function houseSearchItems({ hass, rooms = [], floors = [], views = [], layoutStyle, hasObjects = false }) {
  const items = [], seen = new Set();
  const add = (kind, target, label, subtitle = '', keywords = []) => {
    if (typeof target !== 'string' || !target || typeof label !== 'string' || !label.trim()) return;
    const id = `${kind}:${target}`;
    if (seen.has(id)) return;
    seen.add(id); items.push({ id, kind, target, label, subtitle, keywords: [...keywords, globalSearchText(hass, kind)] });
  };
  const roomIds = new Map();
  for (const entry of rooms) if (entry?.room?.id) roomIds.set(entry.room.id, (roomIds.get(entry.room.id) || 0) + 1);
  for (const entry of rooms) {
    const room = entry?.room, floor = floors.find((value) => value.id === entry?.floorId && !value.stale);
    if (!room || room.stale || roomIds.get(room.id) !== 1 || !floor || !hass?.areas?.[room.area_id]) continue;
    add('room', room.id, entry.name || hass.areas[room.area_id].name || room.name,
      floor.name || '', [room.name, room.area_id].filter((value) => typeof value === 'string'));
  }
  for (const id of Object.keys(hass?.states || {})) {
    const metadata = entityMetadata(hass, id);
    if (!metadata.hasState || metadata.hidden || metadata.disabled || metadata.category) continue;
    add(metadata.domain === 'scene' ? 'scene' : 'device', id, metadata.name || id,
      [metadata.area?.name, metadata.floor?.name].filter(Boolean).join(' · '), [id]);
  }
  for (const view of views) if (view && !view.hidden) add('view', view.id, view.label || view.id);
  if (hass?.user?.is_admin === true) for (const [id, label] of editorTabs({ hasObjects, houseStyle: layoutStyle === 'house' })) {
    const group = editorGroupForTab(id)?.id, key = `edit.navigation.${group}`;
    const groupName = localize(hass, key, {}, navigationMessages[localeInfo(hass).resolved]?.[key] ?? navigationMessages.en[key] ?? group);
    add('setting', id, localize(hass, `edit.tabs.${id}`, {}, label), '', [groupName]);
  }
  // HA can give a switch, power sensor and energy sensor the same friendly
  // device name. Show their actual IDs only where needed to distinguish them.
  const labels = new Map();
  for (const item of items) if (item.kind === 'device' || item.kind === 'scene') {
    const key = `${item.kind}:${item.label.toLocaleLowerCase()}`;
    labels.set(key, (labels.get(key) || 0) + 1);
  }
  return items.map((item) => labels.get(`${item.kind}:${item.label.toLocaleLowerCase()}`) > 1
    ? { ...item, subtitle: [item.subtitle, item.target].filter(Boolean).join(' · ') } : item);
}
