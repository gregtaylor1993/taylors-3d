// Read-only presentation for buildHouseSummary(). This future component has no
// Home Assistant actions, navigation, clock or default household readings.
// Root owns visibility and scene measurements; importing it creates no DOM.
import { localize } from './localization.js';

const text = (value, fallback) => typeof value === 'string' && value.trim() ? value : fallback;
const statuses = new Set(['ready', 'partial', 'unavailable', 'unknown', 'invalid', 'waiting', 'empty', 'not_configured']);
const rowNames = Object.freeze({ weather: 'Weather', people: 'Selected people', alarm: 'Alarm', lights: 'Light entities' });
const fallbackLabels = Object.freeze({ weather: 'Weather unavailable', people: 'People status unavailable',
  alarm: 'Alarm unavailable', lights: 'Light status unavailable' });
const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };

export class HouseHeader {
  constructor(parent) {
    this.parent = parent; this.disposed = false;
    const doc = parent.ownerDocument;
    this.element = doc.createElement('header');
    this.element.dataset.taylors3dSummary = '';
    this.element.dataset.taylors3dUi = 'house-header';
    this.element.setAttribute('aria-label', "Taylor's 3D house summary");
    const titleGroup = doc.createElement('div');
    this.title = doc.createElement('h2'); this.title.dataset.taylors3dSummaryTitle = '';
    this.meta = doc.createElement('p'); this.meta.dataset.taylors3dSummaryMeta = '';
    titleGroup.append(this.title, this.meta);
    this.items = doc.createElement('div'); this.items.dataset.taylors3dSummaryItems = '';
    this.rows = new Map();
    for (const key of Object.keys(rowNames)) {
      const node = doc.createElement('span');
      node.dataset.taylors3dSummaryItem = key;
      node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite'); node.setAttribute('aria-atomic', 'true');
      this.rows.set(key, node); this.items.append(node);
    }
    this.element.append(titleGroup, this.items); parent.append(this.element);
    this.update();
  }

  update(summary = {}, hass) {
    if (this.disposed) return false;
    setText(this.title, text(summary?.title?.text, "Taylor's 3D"));
    this.element.setAttribute('aria-label', localize(hass, 'house.header.aria', { name: this.title.textContent }, "Taylor's 3D house summary"));
    this.title.dataset.source = text(summary?.title?.source, 'default');
    setText(this.meta, text(summary?.session?.label, localize(hass, 'house.header.waiting', {}, 'Waiting for Home Assistant')));
    this.meta.dataset.status = statuses.has(summary?.session?.status) ? summary.session.status : 'waiting';
    for (const [key, node] of this.rows) {
      const row = summary?.[key], status = statuses.has(row?.status) ? row.status : 'unavailable';
      // Unselected optional sources stay out of the header. An explicitly saved
      // source that later disappears remains visible with its actual status.
      node.hidden = key !== 'lights' && (!row || status === 'not_configured');
      node.dataset.status = status;
      const name = localize(hass, `house.header.${key}`, {}, rowNames[key]);
      const label = text(row?.label, localize(hass, `house.header.${key}Unavailable`, {}, fallbackLabels[key]));
      setText(node, label); node.setAttribute('aria-label', localize(hass, 'house.header.itemAria', { label: name, value: label }, `${name}: ${label}`));
      if (key === 'lights') node.title = localize(hass, 'house.header.lightCountHelp', {}, 'Counts Home Assistant light entities, including configured groups; not a count of physical bulbs.');
      else if (key === 'people') node.title = localize(hass, 'house.header.peopleCountHelp', {}, 'Only the explicitly selected people are counted.');
      else node.title = text(row?.name, name);
    }
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.element.remove(); this.rows.clear();
  }
}
