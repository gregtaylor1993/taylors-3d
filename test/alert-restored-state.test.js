// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { alertState, buildAlerts, StatusOverlays, UNKNOWN_STATUS_COLOR } from '../src/status-overlays.js';
import { readFreshness } from '../src/tracked-source.js';

const reading = (state, restored) => ({ state, attributes: { restored } });
const saved = (state) => reading(state, true);
const floors = [{ id: 'ground', elevation: 0 }];
const binding = { id: 'smoke', type: 'smoke', entity: 'binary_sensor.smoke', clear_rule: 'latched',
  location_mode: 'coordinates', floor_id: 'ground', x: 1, y: 2, z: .12 };

describe('Saved alert readings wait for current evidence', () => {
  it('agrees with the existing current-state freshness reader', () => {
    expect(readFreshness(saved('on'), {}, 1000).status).toBe('unavailable');
    expect(alertState({ type: 'smoke' }, saved('on'))).toMatchObject({ status: 'unavailable', active: false, triggered: false });
  });

  it.each([
    ['smoke', 'on', {}], ['leak', 'on', {}], ['unlocked', 'unlocked', {}],
    ['custom', 'alarm', { trigger_states: ['alarm'], clear_states: ['normal'] }],
  ])('does not treat a restored %s trigger as a new detection', (type, state, extra) => {
    const result = alertState({ type, ...extra, clear_rule: 'latched' }, saved(state));
    expect(result).toMatchObject({ status: 'unavailable', active: false, triggered: false, latched: false });
    expect(result.message).toContain('Stored reading');
  });

  it.each([['smoke', 'off'], ['unlocked', 'locked']])('does not claim a restored %s clear state is current', (type, state) => {
    const result = alertState({ type }, saved(state));
    expect(result).toMatchObject({ status: 'unavailable', active: false, triggered: false });
    expect(result.message).toContain('Stored reading');
  });

  it('retains a previous real latch, permits acknowledgment and resumes only on a current reading', () => {
    expect(alertState(binding, saved('on'), { latched: true })).toMatchObject({ status: 'unavailable', active: true, triggered: false, latched: true });
    expect(alertState(binding, saved('off'), { latched: true })).toMatchObject({ status: 'unavailable', active: true, triggered: false, latched: true });
    expect(alertState(binding, saved('on'), { latched: true, acknowledged: true })).toMatchObject({ status: 'unavailable', active: false, triggered: false, latched: false });
    expect(alertState(binding, reading('on', false), { acknowledged: true })).toMatchObject({ status: 'active', active: true, triggered: true, latched: true });
    expect(alertState(binding, reading('off', false), { latched: true, acknowledged: true })).toMatchObject({ status: 'clear', active: false, triggered: false, latched: false });
  });

  it('keeps location intact while refusing to create latch memory from a restored reading', () => {
    const state = Object.freeze({ state: 'on', attributes: Object.freeze({ restored: true }) });
    const input = { floors, bindings: [binding], states: { [binding.entity]: state } };
    const before = JSON.stringify(input), result = buildAlerts(input);
    expect(result.alerts[0]).toMatchObject({ status: 'unavailable', active: false, triggered: false,
      location: { x: 1, y: 2, z: .12, floorId: 'ground', elevation: 0 }, shown: true });
    expect(result.stats).toMatchObject({ active: 0, unavailable: 1, unplaced: 0 });
    expect(result.nextLatches.smoke).toBe(false); expect(JSON.stringify(input)).toBe(before);
    const keep = buildAlerts({ ...input, previousLatches: { smoke: true } });
    expect(keep.alerts[0]).toMatchObject({ status: 'unavailable', active: true, triggered: false });
    expect(keep.nextLatches.smoke).toBe(true);
    const acknowledged = buildAlerts({ ...input, previousLatches: keep.nextLatches, acknowledged: ['smoke'] });
    expect(acknowledged.alerts[0].active).toBe(false); expect(acknowledged.nextLatches.smoke).toBe(false);
  });

  it('draws a neutral labelled stored state without ongoing alert animation', () => {
    const layer = new StatusOverlays(new THREE.Group());
    try {
      const data = buildAlerts({ floors, bindings: [binding], states: { [binding.entity]: saved('on') } });
      layer.setData({ alerts: data.alerts });
      const part = layer.alerts.get('smoke');
      expect(part.label.element.textContent).toContain('Stored reading');
      expect(part.mesh.material.color.getHexString()).toBe(UNKNOWN_STATUS_COLOR.slice(1));
      layer.update(1000); expect(layer.update(1100)).toBe(false);
    } finally { layer.dispose(); }
  });

  it.each([undefined, false, null, 0, 'true', [], {}])('preserves legacy behavior for absent/false/malformed restored flag %j', (flag) => {
    const current = { state: 'on', attributes: {} };
    const withFlag = flag === undefined ? current : reading('on', flag);
    expect(alertState(binding, withFlag)).toEqual(alertState(binding, current));
  });

  it('preserves missing/unknown/unavailable and invalid trigger configuration results', () => {
    expect(alertState(binding, undefined)).toMatchObject({ status: 'missing', active: false });
    for (const state of ['unknown', 'unavailable']) expect(alertState(binding, { state })).toMatchObject({ status: 'unavailable', active: false });
    expect(alertState({ type: 'custom' }, saved('alarm'))).toMatchObject({ status: 'invalid', active: false });
  });
});
