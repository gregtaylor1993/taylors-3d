// Private model-light reading. The public chain and HA states always stay real.
// Overrides come only from validateScenePreview's all-or-nothing compiled Map.
import { readLightAppearance } from './light-state.js';

function gate(entity, state, override) {
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || !['on', 'off'].includes(state.state) || state.entity_id !== undefined && state.entity_id !== entity) return false;
  const attributes = state.attributes;
  if (attributes !== undefined && (!attributes || typeof attributes !== 'object' || Array.isArray(attributes))) return false;
  if (attributes && Object.hasOwn(attributes, 'restored')
    && (typeof attributes.restored !== 'boolean' || attributes.restored)) return false;
  return override ? override.desiredOn === true : state.state === 'on';
}

/** A renderer-only reading for one real model chain, or null when unaffected.
 * A preview can display an on light whose real state is off. Unmapped lights and
 * non-light relays remain real gates; it cannot invent an active physical relay.
 * The chain's first light still supplies colour, matching normal chainState.
 */
export function renderLightChainPreview(chain, states, overrides) {
  if (!(overrides instanceof Map) || !Array.isArray(chain?.entities)) return null;
  const mapped = chain.entities.filter((entity) => typeof entity === 'string' && entity.startsWith('light.') && overrides.has(entity));
  if (!mapped.length) return null;
  const source = chain.entities.find((entity) => typeof entity === 'string' && entity.startsWith('light.'));
  const appearance = overrides.get(source)?.appearance ?? readLightAppearance(states?.[source]);
  const gates = chain.entities.map((entity) => gate(entity, states?.[entity], entity.startsWith('light.') ? overrides.get(entity) : null));
  const lit = gates.every(Boolean) && appearance.output > 0;
  return { appearance, lit,
    key: JSON.stringify([mapped.map((entity) => [entity, overrides.get(entity).key]), gates, appearance.key]) };
}
