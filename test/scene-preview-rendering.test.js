import { describe, expect, it } from 'vitest';
import { chainState } from '../src/objects/logic.js';
import { readLightAppearance } from '../src/light-state.js';
import { renderLightChainPreview } from '../src/scene-preview-rendering.js';

const light = (state, rgb = [255, 255, 255]) => ({ state, attributes: { brightness: 255, supported_color_modes: ['rgb'], color_mode: 'rgb', rgb_color: rgb } });
const override = (state = 'on', rgb = [255, 0, 0]) => {
  const appearance = readLightAppearance(light(state, rgb));
  return { desiredOn: state === 'on', appearance, key: JSON.stringify([state, rgb]) };
};
function fixture(states, controller = 'switch.relay') {
  const chain = chainState({ group: 'room' }, { entity: 'light.room' }, { room: { entity: controller } }, states);
  return { chain, before: JSON.stringify([states, chain]), states };
}

describe('private scene-preview light rendering', () => {
  it('previews an on light while the public off reading and control chain stay exactly real', () => {
    const f = fixture({ 'light.room': light('off'), 'switch.relay': { state: 'on' } });
    const desired = override(), map = new Map([['light.room', desired]]);
    const result = renderLightChainPreview(f.chain, f.states, map);
    expect(result.lit).toBe(true); expect(result.appearance).toBe(desired.appearance);
    expect(f.chain.lit).toBe(false); expect(f.chain.source.state).toBe('off');
    expect(JSON.stringify([f.states, f.chain])).toBe(f.before);
    expect(renderLightChainPreview(f.chain, f.states, new Map(map))).toEqual(result);
  });

  it.each([
    { state: 'off' }, { state: 'unknown' }, { state: 'unavailable' }, null,
    { state: 'on', attributes: { restored: true } }, { state: 'on', attributes: { restored: 'false' } },
    { state: 'on', attributes: [] }, { state: 'on', entity_id: 'switch.other' },
  ])('never previews through an off or uncertain actual physical relay: %j', (relay) => {
    const f = fixture({ 'light.room': light('off'), 'switch.relay': relay });
    const result = renderLightChainPreview(f.chain, f.states, new Map([['light.room', override()]]));
    expect(result.lit).toBe(false); expect(JSON.stringify([f.states, f.chain])).toBe(f.before);
  });

  it('keeps an unmapped light controller in its actual off state', () => {
    const f = fixture({ 'light.room': light('off'), 'light.controller': light('off') }, 'light.controller');
    expect(renderLightChainPreview(f.chain, f.states, new Map([['light.room', override()]])).lit).toBe(false);
    expect(renderLightChainPreview(f.chain, f.states, new Map([['light.room', override()], ['light.controller', override()]])).lit).toBe(true);
    expect(JSON.stringify([f.states, f.chain])).toBe(f.before);
  });

  it('retains the first actual light colour when only a later light gate is previewed', () => {
    const f = fixture({ 'light.room': light('on', [0, 0, 255]), 'light.controller': light('off') }, 'light.controller');
    const result = renderLightChainPreview(f.chain, f.states, new Map([['light.controller', override()]]));
    expect(result.lit).toBe(true); expect(result.appearance.color).toEqual([0, 0, 255]);
    expect(JSON.stringify([f.states, f.chain])).toBe(f.before);
  });

  it('reads the latest real first-light colour even if its public chain was cached before an HA update', () => {
    const f = fixture({ 'light.room': light('on', [0, 0, 255]), 'light.controller': light('off') }, 'light.controller');
    const chainSource = f.chain.source;
    f.states['light.room'] = light('on', [255, 0, 0]);
    const result = renderLightChainPreview(f.chain, f.states, new Map([['light.controller', override()]]));
    expect(result.lit).toBe(true); expect(result.appearance.color).toEqual([255, 0, 0]);
    expect(f.chain.source).toBe(chainSource); expect(f.chain.source.attributes.rgb_color).toEqual([0, 0, 255]);
  });

  it.each(['unknown', 'unavailable'])('does not invent a current target from a %s reading', (state) => {
    const f = fixture({ 'light.room': light(state), 'switch.relay': { state: 'on' } });
    expect(renderLightChainPreview(f.chain, f.states, new Map([['light.room', override()]])).lit).toBe(false);
  });

  it('leaves unrelated chains unaffected and ignores attempted non-light overrides', () => {
    const f = fixture({ 'light.room': light('on'), 'switch.relay': { state: 'off' } });
    expect(renderLightChainPreview(f.chain, f.states, new Map([['light.other', override()]]))).toBeNull();
    expect(renderLightChainPreview(f.chain, f.states, new Map([['switch.relay', override()]]))).toBeNull();
    expect(renderLightChainPreview(f.chain, f.states, null)).toBeNull();
    expect(renderLightChainPreview(null, f.states, new Map())).toBeNull();
  });

  it('previews off and zero light output without changing actual on readings', () => {
    const f = fixture({ 'light.room': light('on'), 'switch.relay': { state: 'on' } });
    const off = renderLightChainPreview(f.chain, f.states, new Map([['light.room', override('off')]]));
    const black = renderLightChainPreview(f.chain, f.states, new Map([['light.room', override('on', [0, 0, 0])]]));
    expect(off.lit).toBe(false); expect(black.lit).toBe(false); expect(f.chain.lit).toBe(true);
    expect(JSON.stringify([f.states, f.chain])).toBe(f.before);
  });

  it('changes its visual key when a real relay or explicit desired setting changes', () => {
    const states = { 'light.room': light('off'), 'switch.relay': { state: 'on' } }, f = fixture(states);
    const map = new Map([['light.room', override()]]), before = renderLightChainPreview(f.chain, states, map);
    states['switch.relay'] = { state: 'off' };
    expect(renderLightChainPreview(f.chain, states, map).key).not.toBe(before.key);
    states['switch.relay'] = { state: 'on' }; map.set('light.room', override('on', [0, 0, 255]));
    expect(renderLightChainPreview(f.chain, states, map).key).not.toBe(before.key);
  });
});
