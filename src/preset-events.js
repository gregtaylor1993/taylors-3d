// Home Assistant automation requests use its authenticated event subscription, not window events.
export const PRESET_EVENT = 'taylors3d_select_view';
export const PRESET_RESULT = 'taylors3d/preset/result';
export const PRESET_SUBSCRIBE = 'taylors3d/preset/subscribe';

const modeOk = (mode) => mode === '3d' || mode === 'top';
const text = (value) => typeof value === 'string' ? value.trim() : '';
const targetKeys = ['layout_key', 'panel', 'card_id'];
const sameTarget = (a, b) => targetKeys.every((key) => text(a?.[key]) === text(b?.[key]));
const cleanTarget = (target) => Object.fromEntries(targetKeys.filter((key) => text(target?.[key])).map((key) => [key, text(target[key])]));

export function presetTargetMatches(request, target) {
  if (!request || !target || !text(request.layout_key) || request.layout_key !== target.layout_key) return false;
  if (!text(request.panel) && !text(request.card_id)) return false;
  return ['panel', 'card_id'].every((key) => !text(request[key]) || request[key] === target[key]);
}

// IDs take precedence over labels. Duplicate labels need an ID so an automation stays predictable.
export function resolvePreset(views, preset) {
  const name = text(preset);
  const visible = (views || []).filter((view) => view && !view.hidden);
  const byId = visible.find((view) => view.id === name);
  if (byId) return { view: byId };
  const labels = visible.filter((view) => view.label === name);
  if (labels.length === 1) return { view: labels[0] };
  if (labels.length > 1) return { status: 'ambiguous_preset', message: `Several presets are named '${name}'; use the view ID` };
  return { status: 'invalid_preset', message: `No visible preset has ID or name '${name}'` };
}

export class PresetEventController {
  constructor({ getTarget, getViews, getCurrent, onSelect, onError = () => {} }) {
    this._getTarget = getTarget;
    this._getViews = getViews;
    this._getCurrent = getCurrent;
    this._onSelect = onSelect;
    this._onError = onError;
    this._hass = null;
    this._connection = null;
    this._subscriptionTarget = null;
    this._generation = 0;
    this._selection = 0;
    this._unsubscribe = null;
    this._subscribing = false;
    this._returnTimer = null;
    this._seen = new Set();
    this._ready = () => this._subscribe();
  }

  setHass(hass) {
    this._hass = hass;
    const connection = hass?.connection;
    const target = cleanTarget(this._getTarget());
    if (connection === this._connection && sameTarget(target, this._subscriptionTarget)) {
      this._subscribe();
      return;
    }
    this._release();
    this._connection = connection || null;
    this._subscriptionTarget = target;
    // HA resubscribes successful subscriptions itself. ready retries only a failed initial attempt.
    this._connection?.addEventListener?.('ready', this._ready);
    this._subscribe();
  }

  disconnect() {
    this._release();
    this._connection = null;
    this._hass = null;
  }

  interrupt() {
    this._selection++;
    clearTimeout(this._returnTimer);
    this._returnTimer = null;
  }

  _report(error) {
    this._onError(error instanceof Error ? error : new Error(String(error)));
  }

  _release() {
    this.interrupt();
    this._generation++;
    this._connection?.removeEventListener?.('ready', this._ready);
    const unsubscribe = this._unsubscribe;
    this._unsubscribe = null;
    this._subscriptionTarget = null;
    this._subscribing = false;
    this._seen.clear();
    if (unsubscribe) Promise.resolve().then(unsubscribe).catch(() => {});
  }

  _subscribe() {
    const connection = this._connection;
    if (!connection?.subscribeMessage || this._unsubscribe || this._subscribing) return;
    const target = this._subscriptionTarget;
    if (!target?.layout_key || (!target.panel && !target.card_id)) return;
    const generation = this._generation;
    this._subscribing = true;
    Promise.resolve().then(() => connection.subscribeMessage((event) => {
      if (this._connection === connection && this._generation === generation) {
        this._handle(event).catch((error) => this._report(error));
      }
    }, { type: PRESET_SUBSCRIBE, ...target })).then((unsubscribe) => {
      if (this._connection !== connection || this._generation !== generation) {
        return Promise.resolve().then(unsubscribe).catch(() => {});
      }
      this._subscribing = false;
      this._unsubscribe = unsubscribe;
    }).catch((error) => {
      if (this._connection === connection && this._generation === generation) {
        this._subscribing = false;
        this._report(error);
      }
    });
  }

  async _reply(hass, request, target, result) {
    if (!hass?.callWS) throw new Error('The Home Assistant websocket is unavailable; the preset request cannot be confirmed');
    await hass.callWS({
      type: PRESET_RESULT,
      request_id: request.request_id,
      target_id: request.target_id,
      ...Object.fromEntries(targetKeys.filter((key) => text(target[key])).map((key) => [key, target[key]])),
      ...result,
    });
  }

  async _handle(event) {
    const request = event?.data;
    const target = cleanTarget(this._getTarget());
    if (!presetTargetMatches(request, target) || !text(request.request_id) || this._seen.has(request.request_id)) return;
    this._seen.add(request.request_id);
    if (this._seen.size > 200) this._seen.delete(this._seen.values().next().value);
    const hass = this._hass;
    this.interrupt();
    const selection = this._selection;
    const generation = this._generation;
    const previous = this._getCurrent();
    const resolved = resolvePreset(this._getViews(), request.preset);
    if (!resolved.view) {
      this._report(new Error(resolved.message));
      await this._reply(hass, request, target, resolved);
      return;
    }
    const view = resolved.view;
    const mode = [request.mode, view.camera_mode, previous?.mode, '3d'].find(modeOk);
    let applied;
    try {
      applied = await this._onSelect(view, { mode, source: 'automation' });
    } catch (error) {
      this._report(error);
      await this._reply(hass, request, target, { status: 'failed', message: String(error?.message || error).slice(0, 512) });
      return;
    }
    if (applied === false) {
      await this._reply(hass, request, target, { status: 'not_ready', message: 'The card is loading or being edited; try again in view mode' });
      return;
    }
    if (generation !== this._generation || selection !== this._selection || !sameTarget(target, this._getTarget())) {
      await this._reply(hass, request, target, { status: 'not_ready', message: 'The preset request was interrupted or superseded' });
      return;
    }
    await this._reply(hass, request, target, { status: 'selected', view_id: view.id, mode });
    if (generation !== this._generation || selection !== this._selection) return;
    const delay = request.return_after;
    if (!(Number.isFinite(delay) && delay > 0 && delay <= 86400 && previous?.id)) return;
    // A touch, newer request, detached card, changed target or removed preset makes this a no-op.
    this._returnTimer = setTimeout(() => {
      this._returnTimer = null;
      if (generation !== this._generation || selection !== this._selection || !sameTarget(target, this._getTarget())) return;
      const old = resolvePreset(this._getViews(), previous.id).view;
      if (!old) return;
      Promise.resolve().then(() => this._onSelect(old, {
        mode: modeOk(previous.mode) ? previous.mode : mode,
        source: 'return',
        restore: previous,
      })).catch((error) => this._report(error));
    }, delay * 1000);
  }
}
