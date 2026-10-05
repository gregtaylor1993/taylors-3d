// Visual model policy only: never rewrites authored materials or HA device state.
export function readModelRendering(value) {
  const policy = { shadows: 'realtime', lamps: 'inherit', valid: true, diagnostics: [] };
  if (value === undefined) return policy;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    policy.valid = false;
    policy.diagnostics.push({ code: 'invalid_policy', message: 'Model rendering settings must be an object.' });
    return policy;
  }
  for (const [field, allowed] of [['shadows', ['realtime', 'off']], ['lamps', ['inherit', 'off']]]) {
    if (!Object.hasOwn(value, field)) continue;
    if (allowed.includes(value[field])) policy[field] = value[field];
    else {
      policy.valid = false;
      policy.diagnostics.push({ code: `invalid_${field}`, message: `Model ${field} must be ${allowed.join(' or ')}.` });
    }
  }
  return policy;
}

// These are 2D UV texture slots in the installed Three.js renderer. Environment,
// gradient and matcap textures use other coordinates and do not require mesh UVs.
const UV_MAPS = ['map', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap', 'normalMap', 'displacementMap',
  'emissiveMap', 'metalnessMap', 'roughnessMap', 'anisotropyMap', 'clearcoatMap',
  'clearcoatNormalMap', 'clearcoatRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'specularMap', 'specularColorMap', 'specularIntensityMap',
  'transmissionMap', 'thicknessMap'];
const EXTRA_MAP_FEATURES = { anisotropyMap: 'anisotropy', clearcoatMap: 'clearcoat',
  clearcoatNormalMap: 'clearcoat', clearcoatRoughnessMap: 'clearcoat', iridescenceMap: 'iridescence',
  iridescenceThicknessMap: 'iridescence', sheenColorMap: 'sheen', sheenRoughnessMap: 'sheen',
  transmissionMap: 'transmission', thicknessMap: 'transmission' };

// Plain, read-only evidence about a loaded model. An AO/base-colour/light map's
// presence cannot prove how it was authored or whether lighting was baked into it.
// Unique materials are counted once; UV requirements are checked for each mesh use.
export function modelShadingReport(root) {
  const report = { hasModel: !!root?.isObject3D, counts: { meshes: 0, materials: 0, materialUses: 0,
    aoMaterials: 0, lightMapMaterials: 0, unlitMaterials: 0, texturedMaterials: 0 },
  uvChannels: [], materials: [], missingUV: [], diagnostics: [] };
  if (!report.hasModel || typeof root.traverse !== 'function') return report;
  const materials = new Map(), channels = new Map();
  const channelFor = (channel) => {
    if (!channels.has(channel)) channels.set(channel, { channel, attribute: channel === 0 ? 'uv' : `uv${channel}`, materialUses: 0, meshUses: 0 });
    return channels.get(channel);
  };
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    report.counts.meshes++;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material?.isMaterial) continue;
      report.counts.materialUses++;
      let entry = materials.get(material);
      if (!entry) {
        entry = { id: material.uuid || `material:${materials.size}`, name: material.name || '', type: material.type || '',
          unlit: material.isMeshBasicMaterial === true, aoMap: material.aoMap?.isTexture === true,
          lightMap: material.lightMap?.isTexture === true, uses: 0, textures: [] };
        materials.set(material, entry); report.materials.push(entry);
        for (const slot of UV_MAPS) {
          const texture = material[slot], feature = EXTRA_MAP_FEATURES[slot];
          if (!texture?.isTexture || (feature && !(material[feature] > 0))) continue;
          const channel = texture.channel;
          if (!Number.isInteger(channel) || channel < 0 || channel > 3) {
            report.diagnostics.push({ code: 'invalid_uv_channel', message: 'A material texture has an unsupported UV channel.', materialId: entry.id, slot });
            continue;
          }
          const uv = channelFor(channel); uv.materialUses++;
          entry.textures.push({ slot, channel, attribute: uv.attribute });
        }
        report.counts.materials++; report.counts.aoMaterials += Number(entry.aoMap);
        report.counts.lightMapMaterials += Number(entry.lightMap); report.counts.unlitMaterials += Number(entry.unlit);
        report.counts.texturedMaterials += Number(UV_MAPS.some((slot) => material[slot]?.isTexture));
      }
      entry.uses++;
      for (const { slot, channel, attribute } of entry.textures) {
        channelFor(channel).meshUses++;
        const uv = mesh.geometry?.attributes?.[attribute], vertices = mesh.geometry?.attributes?.position?.count;
        if (uv && uv.itemSize >= 2 && Number.isFinite(uv.count) && uv.count > 0 && (!Number.isFinite(vertices) || uv.count >= vertices)) continue;
        const missing = { meshId: mesh.uuid || '', meshName: mesh.name || '', materialId: entry.id, materialName: entry.name, slot, channel, attribute };
        report.missingUV.push(missing);
        report.diagnostics.push({ code: 'missing_uv', message: `A material's ${slot} requires a complete ${attribute} mesh attribute.`, ...missing });
      }
    }
  });
  report.uvChannels = [...channels.values()].sort((a, b) => a.channel - b.channel);
  return report;
}
