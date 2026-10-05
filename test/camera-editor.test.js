// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraEditor, cameraEntities } from '../src/camera-editor.js';
import { EditHistory } from '../src/history.js';

const configured = { enabled: true, heading: 90, fov: 70, range: 8, color: '#03a9f4', opacity: .14, show_rays: true };
const camera = (name, state = 'idle') => ({ state, attributes: { friendly_name: name } });
const anchor = (id = 'device:front', entity = 'camera.front', floorId = 'ground', extra = {}) => ({ id, entity, label: 'Front door camera', position: { x: 2, y: 4, z: 2.2, elevation: floorId === 'upper' ? 3 : 0, floorId }, shown: true, ...extra });

function setup({ layout = {}, config = {}, anchors = [anchor()], states = {}, entities = {}, devices = {}, preview = true } = {}) {
  const card = {
    _layout: { rooms: [{ id: 'living' }], pins: { 'device:lamp': { x: 2, y: 1 } }, ...layout }, _config: { layout_key: 'default', ...config },
    _hass: { states: { 'camera.front': camera('Front door'), 'camera.garden': camera('Garden'), 'sensor.temperature': { state: '18', attributes: {} }, ...states }, entities, devices, callService: vi.fn() },
    _floors: [{ id: 'ground', name: 'Ground floor', elevation: 0 }, { id: 'upper', name: 'Upstairs', elevation: 3 }],
    cameraAnchors: vi.fn(() => anchors), _history: new EditHistory(),
  };
  if (preview) card.previewCameraCoverage = vi.fn();
  card._history.reset({ layout: card._layout, config: card._config });
  card.commitFeatureLayout = vi.fn((patch) => {
    card._layout = { ...card._layout, ...patch };
    card._history.record({ layout: card._layout, config: card._config }, 'Edit camera coverage');
  });
  const host = document.createElement('div'); document.body.append(host);
  const editor = new CameraEditor(card, () => { host.innerHTML = editor.render(); });
  host.addEventListener('change', (event) => editor.handleChange(event));
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => editor.handleClick(event));
  host.innerHTML = editor.render();
  const input = (field) => host.querySelector(`[data-field="${field}"]`);
  const change = (field, value, type = 'change') => {
    const element = input(field); expect(element).toBeTruthy();
    if (element.type === 'checkbox') element.checked = value; else element.value = value;
    element.dispatchEvent(new Event(type, { bubbles: true }));
  };
  const click = (action) => { const button = host.querySelector(`[data-act="${action}"]`); expect(button).toBeTruthy(); button.click(); };
  const configure = ({ heading = '90', fov = '70', range = '8' } = {}) => {
    change('cov-enabled', true); change('cov-heading', heading); change('cov-fov', fov); change('cov-range', range);
  };
  return { card, editor, host, input, change, click, configure, anchors };
}
afterEach(() => document.body.replaceChildren());

describe('camera coverage visual configuration', () => {
  it('lists actual cameras including unavailable streams and filters hidden/diagnostic choices', () => {
    const hass = { states: { 'camera.z': camera('Z camera', 'unavailable'), 'camera.a': camera('A camera'), 'camera.hidden': camera('Hidden'), 'camera.diagnostic': camera('Diagnostic'), 'light.fake': camera('Not a camera') }, entities: { 'camera.hidden': { hidden_by: 'user' }, 'camera.diagnostic': { entity_category: 'diagnostic' } } };
    expect(cameraEntities(hass)).toEqual([['camera.a', 'A camera'], ['camera.z', 'Z camera (Unavailable)']]);
  });

  it('leaves direction, lens and range blank until explicitly chosen, with no saved changes or services', () => {
    const { card, input, host, change, click } = setup();
    expect(input('cov-heading').value).toBe(''); expect(input('cov-fov').value).toBe(''); expect(input('cov-range').value).toBe('');
    expect(host.textContent).toContain('Heading not chosen');
    change('cov-enabled', true); click('cov-save');
    expect(host.textContent).toContain('Choose a finite heading'); expect(host.textContent).toContain('nothing has been saved');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
    expect(card.previewCameraCoverage.mock.calls.at(-1)[0]['camera.front']).toEqual({ enabled: false });
  });

  it('saves one explicit unique camera binding with preserved layout data and undo history', () => {
    const { card, host, configure, change, click } = setup();
    configure(); change('cov-color', '#aabbcc'); change('cov-opacity', '.3'); change('cov-show-rays', false);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(host.textContent).toContain('Ground floor'); expect(host.textContent).toContain('2 m east, 4 m north');
    click('cov-save');
    expect(card._layout.camera_coverage).toEqual({ 'camera.front': { ...configured, color: '#aabbcc', opacity: .3, show_rays: false } });
    expect(card.commitFeatureLayout).toHaveBeenCalledTimes(1);
    expect(card._layout.pins).toEqual({ 'device:lamp': { x: 2, y: 1 } }); expect(card._layout.rooms).toEqual([{ id: 'living' }]);
    expect(card._history.undo().layout.camera_coverage).toBeUndefined();
    expect(card.previewCameraCoverage.mock.calls.at(-1)).toEqual([null]); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('uses layout settings before fallback and snapshots the full fallback map on Save', () => {
    const fallback = { 'camera.front': { ...configured }, 'camera.garden': { enabled: false } };
    const { card, input, change, click } = setup({ config: { camera_coverage: fallback } });
    expect(input('cov-range').value).toBe('8'); change('cov-range', '10'); click('cov-save');
    expect(card._layout.camera_coverage['camera.front'].range).toBe(10); expect(card._layout.camera_coverage['camera.garden']).toEqual({ enabled: false });
    expect(card._config.camera_coverage).toBe(fallback); expect(fallback['camera.front'].range).toBe(8);
    card._layout.camera_coverage = {}; expect(new CameraEditor(card).config).toEqual({});
  });

  it('cancels a draft and restores saved values and the scene preview without a history entry', () => {
    const saved = { 'camera.front': { ...configured } };
    const { card, input, change, click, editor } = setup({ layout: { camera_coverage: saved } });
    change('cov-range', '14'); expect(card.previewCameraCoverage.mock.calls.at(-1)[0]['camera.front'].range).toBe(14);
    click('cov-cancel'); expect(input('cov-range').value).toBe('8'); expect(editor.dirty).toBe(false);
    expect(card._layout.camera_coverage).toBe(saved); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card.previewCameraCoverage.mock.calls.at(-1)).toEqual([null]);
  });

  it('switching cameras discards unsaved values while showing genuine unplaced camera choices', () => {
    const { card, configure, change, input, host } = setup();
    configure(); change('cov-camera', 'camera.garden');
    expect(input('cov-heading').value).toBe(''); expect(host.textContent).toContain('No mapped camera position'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    configure(); expect(host.textContent).toContain('Place this camera on a mapped floor');
    expect(card.previewCameraCoverage.mock.calls.at(-1)[0]['camera.garden']).toEqual({ enabled: false });
  });

  it('stores duplicate camera entities by a chosen anchor and keeps their floors separate', () => {
    const anchors = [anchor(), anchor('model:front-upper', 'camera.front', 'upper', { label: 'Upper camera mount' })];
    const { card, change, input, configure, click, host } = setup({ anchors });
    expect(input('cov-anchor').options).toHaveLength(2); expect(host.textContent).toContain('Upstairs');
    change('cov-anchor', 'model:front-upper'); configure({ heading: '180', fov: '100', range: '5' }); click('cov-save');
    expect(Object.keys(card._layout.camera_coverage)).toEqual(['model:front-upper']); expect(card._layout.camera_coverage['model:front-upper'].heading).toBe(180);
    expect(host.textContent).toContain('selected object or marker');
    change('cov-anchor', 'device:front'); expect(input('cov-fov').value).toBe('');
    configure(); click('cov-save'); expect(Object.keys(card._layout.camera_coverage).sort()).toEqual(['device:front', 'model:front-upper']); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('converts an inherited ambiguous entity binding to an explicit anchor without deleting sibling settings', () => {
    const anchors = [anchor(), anchor('model:front-upper', 'camera.front', 'upper')];
    const { card, change, click } = setup({ anchors, layout: { camera_coverage: { 'camera.front': { ...configured }, 'model:front-upper': { ...configured, range: 3 }, 'camera.garden': { enabled: false } } } });
    change('cov-range', '9'); click('cov-save');
    expect(card._layout.camera_coverage['camera.front']).toBeUndefined(); expect(card._layout.camera_coverage['device:front'].range).toBe(9);
    expect(card._layout.camera_coverage['model:front-upper'].range).toBe(3); expect(card._layout.camera_coverage['camera.garden']).toEqual({ enabled: false });
  });

  it('migrates a unique imported anchor key to its entity so an old exact binding cannot override Save', () => {
    const { card, change, click } = setup({ layout: { camera_coverage: { 'device:front': { ...configured }, 'camera.front': { ...configured, range: 2 } } } });
    change('cov-range', '12'); click('cov-save');
    expect(card._layout.camera_coverage['device:front']).toBeUndefined(); expect(card._layout.camera_coverage['camera.front'].range).toBe(12);
  });

  it('rejects duplicated anchor IDs instead of attaching coverage to an arbitrary position', () => {
    const { card, host, configure, click } = setup({ anchors: [anchor(), anchor('device:front', 'camera.front', 'upper')] });
    configure(); click('cov-save'); expect(host.textContent).toContain('anchor IDs must be unique'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });

  it.each([
    ['cov-fov', '0', 'Horizontal field of view must be'], ['cov-fov', '176', 'Horizontal field of view must be'],
    ['cov-range', '0', 'Coverage range must be'], ['cov-range', '101', 'Coverage range must be'],
    ['cov-heading', '', 'Choose a finite heading'], ['cov-fov', '', 'Choose a finite horizontal field of view'],
    ['cov-range', '', 'Choose a finite range'], ['cov-opacity', '2', 'Coverage opacity'], ['cov-color', 'red', 'six-digit'],
  ])('blocks invalid %s=%s without saving any layout changes', (field, value, warning) => {
    const { card, host, configure, change, click } = setup(); configure(); change(field, value); click('cov-save');
    expect(host.textContent).toContain(warning); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('normalises finite wrapped headings, and a slider chooses a direction explicitly', () => {
    const { card, configure, input, change, click, host } = setup();
    configure({ heading: '-90' }); expect(input('cov-heading-slider').value).toBe('270'); expect(host.textContent).toContain('270° clockwise');
    change('cov-heading-slider', '180', 'input'); expect(input('cov-heading').value).toBe('180'); expect(host.textContent).toContain('180° clockwise');
    click('cov-save'); expect(card._layout.camera_coverage['camera.front'].heading).toBe(180);
  });

  it('accepts a real explicit anchor heading while refusing to infer a direction from its position', () => {
    const { card, input, change, click, host } = setup({ anchors: [anchor('device:front', 'camera.front', 'ground', { heading: 450 })] });
    expect(input('cov-heading').value).toBe('90'); expect(host.textContent).toContain('explicit plan heading');
    change('cov-enabled', true); change('cov-fov', '80'); change('cov-range', '6'); click('cov-save');
    expect(card._layout.camera_coverage['camera.front'].heading).toBe(90);
  });

  it.each([
    { x: NaN, y: 2, floorId: 'ground' }, { x: 2, y: Infinity, floorId: 'ground' },
    { x: 2, y: 3 }, { x: 2, y: 3, floorId: 'ground', z: NaN }, { x: 2, y: 3, floorId: 'ground', elevation: Infinity },
  ])('requires a finite real camera position and mapped floor: %j', (position) => {
    const { card, configure, click, host } = setup({ anchors: [anchor('device:front', 'camera.front', 'ground', { position })] });
    configure(); click('cov-save'); expect(host.textContent).toContain('Place this camera on a mapped floor'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('makes missing saved entities read-only, preserves their settings and permits explicit Clear', () => {
    const saved = { 'camera.missing': { ...configured }, 'camera.front': { enabled: false } };
    const { card, editor, change, input, host, click } = setup({ layout: { camera_coverage: saved } });
    change('cov-camera', 'camera.missing');
    expect(input('cov-fov').value).toBe('70'); expect(input('cov-fov').disabled).toBe(true); expect(host.textContent).toContain('settings are read-only');
    editor.onChange('cov-range', { value: '20', type: 'number' }); expect(editor.draft.range).toBe(8); expect(card._layout.camera_coverage).toBe(saved);
    click('cov-clear'); expect(card._layout.camera_coverage['camera.missing']).toBeUndefined(); expect(card._layout.camera_coverage['camera.front']).toEqual({ enabled: false }); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('retains orphan saved model anchors as read-only choices rather than guessing a camera or floor', () => {
    const { card, host, input, change, click } = setup({ layout: { camera_coverage: { 'model:removed': { ...configured } } } });
    change('cov-camera', 'saved:model:removed'); expect(input('cov-heading').disabled).toBe(true); expect(host.textContent).toContain('Saved anchor: model:removed'); expect(host.textContent).toContain('No mapped camera position');
    click('cov-clear'); expect(card._layout.camera_coverage).toEqual({});
  });

  it('warns about unavailable/hidden anchors without claiming detection is working or inventing data', () => {
    const { card, host, configure, click } = setup({ states: { 'camera.front': camera('Front door', 'unavailable') }, anchors: [anchor('device:front', 'camera.front', 'upper', { shown: false })] });
    configure(); expect(host.textContent).toContain('stream is unavailable'); expect(host.textContent).toContain('currently hidden'); expect(host.textContent).toContain('Upstairs');
    click('cov-save'); expect(card._layout.camera_coverage['camera.front'].enabled).toBe(true); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('preserves registry-only/hidden saved cameras as read-only instead of reusing a stale position', () => {
    const saved = { 'camera.front': { ...configured }, 'camera.hidden': { enabled: false } };
    const { host, input, change, click, card } = setup({ states: { 'camera.front': undefined, 'camera.hidden': camera('Hidden camera') }, entities: { 'camera.front': { name: 'Registry camera' }, 'camera.hidden': { hidden: true } }, layout: { camera_coverage: saved }, anchors: [] });
    change('cov-camera', 'camera.front'); expect(host.textContent).toContain('has no current state'); expect(input('cov-enabled').disabled).toBe(true); click('cov-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._layout.camera_coverage).toBe(saved);
    change('cov-camera', 'camera.hidden'); expect(host.textContent).toContain('hidden or marked'); expect(input('cov-range').disabled).toBe(true);
  });

  it('omits new hidden camera anchors but still shows them when they have inherited settings', () => {
    const { input, editor, card } = setup({ anchors: [anchor(), anchor('hidden', 'camera.hidden')], states: { 'camera.hidden': camera('Hidden') }, entities: { 'camera.hidden': { hidden: true } } });
    expect([...input('cov-camera').options].map((entry) => entry.value)).not.toContain('camera.hidden');
    card._layout.camera_coverage = { hidden: { ...configured } }; expect(editor.choices.map((entry) => entry.value)).toContain('camera.hidden');
  });

  it('respects disabled status inherited from a camera device and preserves its saved binding as read-only', () => {
    const saved = { 'camera.front': { ...configured } };
    const { card, host, input, click } = setup({ entities: { 'camera.front': { device_id: 'disabled-camera' } }, devices: { 'disabled-camera': { disabled_by: 'user' } }, layout: { camera_coverage: saved }, anchors: [] });
    expect(cameraEntities(card._hass).map(([entity]) => entity)).not.toContain('camera.front');
    expect([...input('cov-camera').options].map((entry) => entry.value)).toContain('camera.front');
    expect(host.textContent).toContain('camera or its device is disabled'); expect(input('cov-heading').disabled).toBe(true);
    click('cov-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._layout.camera_coverage).toBe(saved);
    click('cov-clear'); expect(card._layout.camera_coverage).toEqual({}); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('captures unsaved numeric input before blur and Cancel prevents a later Save from using discarded text', () => {
    const { card, input, change, click, editor } = setup({ layout: { camera_coverage: { 'camera.front': { ...configured } } } });
    const range = input('cov-range'); range.focus(); change('cov-range', '13', 'input');
    expect(document.activeElement).toBe(range); expect(editor.draft.range).toBe('13'); expect(card.previewCameraCoverage.mock.calls.at(-1)[0]['camera.front'].range).toBe(13);
    click('cov-cancel'); click('cov-save'); expect(card._layout.camera_coverage['camera.front'].range).toBe(8);
  });

  it('clears a saved preview before Undo and reads the restored binding rather than retaining the draft', () => {
    const { card, editor, host, change, click, input } = setup({ layout: { camera_coverage: { 'camera.front': { ...configured } } } });
    change('cov-range', '12', 'input'); click('cov-save'); expect(card.previewCameraCoverage.mock.calls.at(-1)).toEqual([null]);
    card._layout = card._history.undo().layout; host.innerHTML = editor.render(); expect(input('cov-range').value).toBe('8'); expect(editor.previewing).toBe(false); expect(card._layout.camera_coverage['camera.front'].range).toBe(8);
  });

  it('refreshes live warnings without replacing a focused input, slider, camera selector or draft text', () => {
    const { card, editor, host, input, configure, change } = setup(); configure(); change('cov-range', '9');
    const range = input('cov-range'), slider = input('cov-heading-slider'), choice = input('cov-camera'); range.focus();
    card._hass = { ...card._hass, states: { ...card._hass.states, 'camera.front': camera('Front door', 'unavailable') } };
    editor.afterUpdate(host); expect(host.textContent).toContain('stream is unavailable');
    expect(document.activeElement).toBe(range); expect(input('cov-range')).toBe(range); expect(input('cov-range').value).toBe('9'); expect(input('cov-heading-slider')).toBe(slider); expect(input('cov-camera')).toBe(choice);
    const preview = host.querySelector('[data-cov-preview]'), write = vi.spyOn(preview, 'innerHTML', 'set');
    editor.updatePreviews(host); expect(write).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('a missing live entity disables settings in place while preserving focus and an unsaved draft', () => {
    const { card, editor, host, input, change } = setup({ layout: { camera_coverage: { 'camera.front': { ...configured } } } });
    change('cov-range', '9'); const range = input('cov-range'); range.focus(); delete card._hass.states['camera.front'];
    editor.updatePreviews(host); expect(range.disabled).toBe(true); expect(document.activeElement).toBe(range); expect(range.value).toBe('9'); expect(host.textContent).toContain('read-only'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });

  it('retains an ID-keyed selected camera after live removal without silently saving to another camera', () => {
    const saved = { 'device:front': { ...configured }, upper: { ...configured, range: 3 } };
    const current = [anchor(), anchor('upper', 'camera.front', 'upper')];
    const { card, editor, host, input, change, click } = setup({ anchors: current, layout: { camera_coverage: saved } });
    change('cov-range', '12', 'input'); const range = input('cov-range'); range.focus();
    delete card._hass.states['camera.front']; current.splice(0);
    editor.updatePreviews(host);
    expect(editor.selected.entity).toBe('camera.front'); expect(editor.sourceKey).toBe('device:front'); expect(range.value).toBe('12'); expect(range.disabled).toBe(true); expect(document.activeElement).toBe(range);
    editor.onClick('cov-save', host.querySelector('[data-act="cov-save"]'));
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._layout.camera_coverage).toBe(saved); expect(card._layout.camera_coverage['camera.garden']).toBeUndefined();
    click('cov-cancel'); expect(input('cov-camera').value).toBe('camera.front'); expect(input('cov-range').value).toBe('8');
    click('cov-clear'); expect(card._layout.camera_coverage).toEqual({ upper: { ...configured, range: 3 } }); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('a removed selected duplicate anchor stays read-only instead of moving its draft to the remaining mount', () => {
    const saved = { 'device:front': { ...configured }, upper: { ...configured, range: 3 } };
    const current = [anchor(), anchor('upper', 'camera.front', 'upper')];
    const { card, editor, host, input, change, click } = setup({ anchors: current, layout: { camera_coverage: saved } });
    change('cov-anchor', 'upper'); change('cov-range', '15', 'input'); current.pop(); editor.updatePreviews(host);
    expect(editor.anchor).toBeUndefined(); expect(editor.anchorId).toBe('upper'); expect(editor.selected.entity).toBe('camera.front'); expect(input('cov-range').disabled).toBe(true); expect(host.textContent).toContain('selected camera anchor is missing');
    host.innerHTML = editor.render(); expect(input('cov-anchor').value).toBe('upper'); expect(input('cov-anchor').selectedOptions[0].textContent).toContain('Missing anchor');
    editor.onClick('cov-save', host.querySelector('[data-act="cov-save"]')); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('cov-cancel'); expect(input('cov-range').value).toBe('3'); expect(input('cov-anchor').value).toBe('upper');
    click('cov-clear'); expect(card._layout.camera_coverage).toEqual({ 'device:front': { ...configured } });
  });

  it('Clear removes only the chosen duplicate anchor and can be undone', () => {
    const saved = { 'device:front': { ...configured }, 'upper': { ...configured, range: 4 } };
    const { card, click } = setup({ anchors: [anchor(), anchor('upper', 'camera.front', 'upper')], layout: { camera_coverage: saved } });
    click('cov-clear'); expect(card._layout.camera_coverage).toEqual({ upper: { ...configured, range: 4 } }); expect(card._history.undo().layout.camera_coverage).toEqual(saved);
  });

  it('clears authoritative fallback coverage with an empty layout map instead of reactivating it', () => {
    const fallback = { 'camera.front': { ...configured } }; const { card, click, editor } = setup({ config: { camera_coverage: fallback } });
    click('cov-clear'); expect(card._layout.camera_coverage).toEqual({}); expect(editor.config).toEqual({}); expect(card._config.camera_coverage).toBe(fallback);
  });

  it('can save disabled coverage without a lens/range/direction and disable an existing sector', () => {
    const { card, click, change } = setup(); click('cov-save'); expect(card._layout.camera_coverage['camera.front']).toEqual({ enabled: false, color: '#03a9f4', opacity: .14, show_rays: true });
    card._layout.camera_coverage['camera.front'] = { ...configured }; change('cov-enabled', false); click('cov-save'); expect(card._layout.camera_coverage['camera.front'].enabled).toBe(false);
  });

  it('reports malformed imported settings and does not silently rewrite them on display', () => {
    const saved = { 'camera.front': 'broken' }; const { card, host, click } = setup({ layout: { camera_coverage: saved } });
    expect(host.textContent).toContain('saved binding is malformed'); click('cov-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._layout.camera_coverage).toBe(saved);
    click('cov-clear'); expect(card._layout.camera_coverage).toEqual({});
  });

  it('validates inherited units/curve settings rather than erasing invalid values during preview', () => {
    const { card, host, click } = setup({ layout: { camera_coverage: { 'camera.front': { ...configured, unit: 'ft', segments: 100 } } } });
    expect(host.textContent).toContain('range uses metres'); expect(host.textContent).toContain('2–64 segments'); click('cov-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });

  it('saves without a preview adapter and resets/disposes transient preview without any service call', () => {
    const basic = setup({ preview: false }); basic.configure(); basic.click('cov-save'); expect(basic.card._layout.camera_coverage['camera.front']).toEqual(configured);
    const live = setup(); live.configure(); live.editor.reset(); expect(live.card.previewCameraCoverage.mock.calls.at(-1)).toEqual([null]); expect(live.editor.draft).toBeNull();
    live.host.innerHTML = live.editor.render(); live.configure(); live.editor.dispose(); expect(live.card.previewCameraCoverage.mock.calls.at(-1)).toEqual([null]); expect(live.editor.render()).toBe(''); expect(live.editor.onChange('cov-range', {})).toBe(false); expect(live.editor.onClick('cov-save', {})).toBe(false);
    expect(basic.card._hass.callService).not.toHaveBeenCalled(); expect(live.card._hass.callService).not.toHaveBeenCalled();
  });

  it('shows a clear empty state and leaves delegated events for other tabs untouched', () => {
    const { card, editor, host } = setup({ anchors: [], states: { 'camera.front': undefined, 'camera.garden': undefined } });
    delete card._hass.states['camera.front']; delete card._hass.states['camera.garden']; host.innerHTML = editor.render();
    expect(host.textContent).toContain('No cameras are available'); expect(editor.onChange('ovr-mode', {})).toBe(false); expect(editor.onClick('ovr-save', {})).toBe(false); expect(editor.onChange('cov-unknown', {})).toBe(false); expect(editor.onClick('cov-unknown', {})).toBe(false);
  });

  it('escapes inherited labels/IDs and keeps the SVG direction accessible and finite', () => {
    const { host, configure } = setup({ anchors: [anchor('id"><img src=x>', 'camera.front', 'ground', { label: '<script>bad</script>' })], states: { 'camera.front': camera('Front <img src=x>') } });
    configure(); expect(host.querySelector('img')).toBeNull(); expect(host.querySelector('script')).toBeNull(); expect(host.querySelector('svg').getAttribute('role')).toBe('img'); expect(host.querySelector('svg').getAttribute('aria-label')).toContain('90° clockwise from north'); expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
