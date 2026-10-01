// Layout persistence.
// 1. floorplan3d companion integration (shared across all users and devices)
// 2. frontend user data (stored in HA, but per user)
// 3. browser localStorage (last resort)

export const EMPTY_LAYOUT = () => ({
  version: 1,
  floors: [],
  rooms: [],
  pins: {},
  hidden: [],
  mower: null,
});

export class LayoutStore {
  constructor(key) {
    this.key = key || 'default';
    this.backend = null;
    this._timer = null;
    this._pending = null;
  }

  async load(hass) {
    try {
      const r = await hass.callWS({ type: 'floorplan3d/layout/get', key: this.key });
      this.backend = 'shared';
      return normalise(r && r.layout);
    } catch (e) { /* integration not installed */ }
    try {
      const r = await hass.callWS({ type: 'frontend/get_user_data', key: 'floorplan3d_' + this.key });
      this.backend = 'user';
      return normalise(r && r.value);
    } catch (e) { /* old HA */ }
    this.backend = 'browser';
    try {
      return normalise(JSON.parse(localStorage.getItem('floorplan3d_' + this.key) || 'null'));
    } catch (e) {
      return EMPTY_LAYOUT();
    }
  }

  save(hass, layout, delay = 600) {
    clearTimeout(this._timer);
    // a newer save replaces this one; settle the old promise so callers don't hang
    if (this._pending) this._pending(false);
    return new Promise((resolve) => {
      this._pending = resolve;
      this._timer = setTimeout(async () => {
        this._pending = null;
        try {
          if (this.backend === 'shared') {
            await hass.callWS({ type: 'floorplan3d/layout/set', key: this.key, layout });
          } else if (this.backend === 'user') {
            await hass.callWS({ type: 'frontend/set_user_data', key: 'floorplan3d_' + this.key, value: layout });
          } else {
            localStorage.setItem('floorplan3d_' + this.key, JSON.stringify(layout));
          }
          resolve(true);
        } catch (e) {
          console.error('floorplan3d: save failed', e);
          resolve(false);
        }
      }, delay);
    });
  }
}

export function normalise(l) {
  const base = EMPTY_LAYOUT();
  if (!l || typeof l !== 'object') return base;
  return {
    ...base,
    ...l,
    floors: Array.isArray(l.floors) ? l.floors : [],
    rooms: Array.isArray(l.rooms) ? l.rooms : [],
    pins: l.pins && typeof l.pins === 'object' ? l.pins : {},
    hidden: Array.isArray(l.hidden) ? l.hidden : [],
  };
}
