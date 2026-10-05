// Browser-free preparation checks. These cannot prove native Root geometry,
// GPU ownership, source/bundle behavior or Undo/Redo; the native driver does that.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { areaEntity, entityAreaIds, entityAreaRegistry, entityAreaSpecifications, entityAreaLayout, assertEntityAreaBundlePrerequisites } from '../scripts/lib/entity-area-filter-fixture.mjs';

const directories = [];
const root = path.resolve(import.meta.dirname, '..');
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = path.resolve(directory), tempRoot = path.resolve(os.tmpdir());
    if (!target.startsWith(tempRoot + path.sep) || !path.basename(target).startsWith('taylors3d-area-fixture-')) throw new Error('Unexpected test cleanup directory');
    await fs.rm(target, { recursive: true, force: true });
  }
});

async function currentBundles() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taylors3d-area-fixture-')); directories.push(directory);
  const source = path.join(directory, 'src/taylors3d-card.js');
  const files = [path.join(directory, 'dist/taylors3d-card.js'), path.join(directory, 'custom_components/taylors3d/frontend/taylors3d-card.js')];
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.writeFile(source, 'export const explicitFixture = "current anonymous source";');
  const compiled = await build({ entryPoints: [source], outfile: files[0], bundle: true, format: 'esm', target: 'es2020', minify: true, sourcemap: false, write: false, logLevel: 'silent' });
  const expected = Buffer.from(compiled.outputFiles[0].contents);
  for (const file of files) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, expected); }
  return { directory, source, files, expected };
}

describe('area-filter native proof prerequisites', () => {
  it.each([0, 1])('fails before a native proof when distributed copy %i is missing', async (index) => {
    const fixture = await currentBundles(); await fs.unlink(fixture.files[index]);
    await expect(assertEntityAreaBundlePrerequisites(fixture.directory)).rejects.toThrow(`${index === 0 ? 'dist/taylors3d-card.js' : 'custom_components/taylors3d/frontend/taylors3d-card.js'} is missing or stale`);
    await expect(fs.readFile(fixture.files[1 - index])).resolves.toEqual(fixture.expected);
    await expect(fs.stat(fixture.files[index])).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects stale source without overwriting either saved bundle', async () => {
    const fixture = await currentBundles(); await fs.writeFile(fixture.source, 'export const explicitFixture = "deliberately changed source";');
    await expect(assertEntityAreaBundlePrerequisites(fixture.directory)).rejects.toThrow('dist/taylors3d-card.js is missing or stale');
    for (const file of fixture.files) await expect(fs.readFile(file)).resolves.toEqual(fixture.expected);
  });
  it('rejects two divergent installed copies even when the dashboard bundle is current', async () => {
    const fixture = await currentBundles(); await fs.writeFile(fixture.files[1], 'export const explicitFixture = "obsolete installed copy";');
    await expect(assertEntityAreaBundlePrerequisites(fixture.directory)).rejects.toThrow('custom_components/taylors3d/frontend/taylors3d-card.js is missing or stale');
    await expect(fs.readFile(fixture.files[0])).resolves.toEqual(fixture.expected);
  });
  it('returns a verified digest when both exact current copies exist', async () => {
    const fixture = await currentBundles();
    await expect(assertEntityAreaBundlePrerequisites(fixture.directory)).resolves.toMatch(/^[a-f0-9]{64}$/);
    for (const file of fixture.files) await expect(fs.readFile(file)).resolves.toEqual(fixture.expected);
  });
  it('prepares all four actual editor DOMs without attempting Chrome or claiming bundle execution', async () => {
    const run = await promisify(execFile)(process.execPath, ['scripts/entity-area-filter-check.mjs', '--preflight'], {
      cwd: root, env: { ...process.env, CHROME_PATH: path.join(root, 'nonexistent-preflight-chrome.exe') }, maxBuffer: 1024 * 1024,
    });
    for (const spec of entityAreaSpecifications) expect(run.stdout).toContain(`${spec.name} actual editor delegates exactly one deliberate bounded configuration proposal`);
    expect(run.stdout).toMatch(/\d+\/\d+ entity-area-filter checks passed; no browser launched\./);
    expect(run.stdout).not.toContain('FAIL');
    expect(run.stdout).toContain('Native Root/source+bundle geometry, GPU and Undo/Redo await the browser run.');
  });
});

describe('anonymous shared GLB area data', () => {
  it('uses distinct exact entity and inherited parent-device areas with explicit administrative exclusions', () => {
    const data = entityAreaRegistry();
    expect(data.entities[areaEntity('scene', 'lounge')].area_id).toBeNull();
    expect(data.devices[data.entities[areaEntity('scene', 'lounge')].device_id].parent_device_id).toBe('filter-parent');
    expect(data.devices['filter-parent'].area_id).toBe(entityAreaIds.lounge);
    expect(data.entities[areaEntity('scene', 'garden')].area_id).toBe(entityAreaIds.garden);
    expect(data.entities[areaEntity('scene', 'unassigned')]).toMatchObject({ area_id: null, device_id: null });
    expect(data.entities[areaEntity('scene', 'hidden')].hidden_by).toBe('user');
    expect(data.entities[areaEntity('scene', 'disabled')].disabled_by).toBe('user');
    expect(data.entities[areaEntity('scene', 'diagnostic')].entity_category).toBe('diagnostic');
  });
  it('includes literal hostile-looking names and missing-capability sources without sharing mutation across runs', () => {
    const first = entityAreaRegistry(), second = entityAreaRegistry();
    expect(first.states[areaEntity('person', 'lounge')].attributes.friendly_name).toBe('User_person_lounge_<b>été');
    expect(first.states[areaEntity('light', 'malformed')].attributes.supported_color_modes).toEqual(['unsupported_fixture_mode']);
    first.states[areaEntity('person', 'lounge')].attributes.friendly_name = 'explicit changed draft';
    expect(second.states[areaEntity('person', 'lounge')].attributes.friendly_name).toBe('User_person_lounge_<b>été');
    const layout = entityAreaLayout(123); layout.room_actions.rooms[0].actions[0].entity = 'scene.changed_fixture';
    expect(entityAreaLayout(123).room_actions.rooms[0].actions[0].entity).toBe(areaEntity('scene', 'lounge'));
    expect(entityAreaLayout(123).model.size).toBe(123);
  });
});
