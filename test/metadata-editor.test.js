// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { resolveLevels, resolveRoomAreas } from '../src/bindings.js';

function fixture() {
  const manifest = { levels: [{ id: 'ground', label: 'Ground', role: 'storey', order: 0 }],
    rooms: [{ id: 'kitchen', kind: 'room', label: 'Kitchen', level: 'ground' }], objects: [], errors: [], warnings: [] };
  const floors = [{ id: 'ground', name: 'Ground', elevation: 0 }];
  const card = { _hass: { floors: { ground: { floor_id: 'ground' } }, areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' } },
    entities: {}, devices: {}, states: {} }, _floors: floors, _view: {}, _store: { backend: 'shared' }, _config: {},
    _layout: { rooms: [], model: { known: { levels: ['ground'], rooms: ['kitchen'] },
      levels: { ground: { floor: 'deleted_floor' } }, rooms: { kitchen: { area: 'deleted_area' } } }, objects: {} },
    _commit: vi.fn() };
  card.modelBindings = () => ({ manifest,
    levels: resolveLevels(manifest.levels, floors, card._layout.model.levels),
    rooms: resolveRoomAreas(manifest.rooms, Object.keys(card._hass.areas), card._layout.model.rooms),
    diff: { levels: { missing: [] }, rooms: { missing: [] } }, notice: { levels: { added: [], missing: [] }, rooms: { added: [], missing: [] } } });
  return new EditMode(card);
}

describe('metadata choices in the visual editor', () => {
  it('keeps missing area/floor IDs selected and offers deliberate replacement/unassignment', () => {
    const edit = fixture(), before = JSON.stringify(edit.layout);
    edit.panel.innerHTML = edit._modelBindingsHtml();
    const floor = edit.panel.querySelector('[data-field="md-level"]'), area = edit.panel.querySelector('[data-field="md-room"]');
    expect(floor.value).toBe('floor:deleted_floor'); expect(floor.selectedOptions[0].textContent).toContain('Missing floor');
    expect(area.value).toBe('deleted_area'); expect(area.selectedOptions[0].textContent).toContain('Missing area');
    expect([...floor.options].map((option) => option.value)).toContain('none');
    expect([...area.options].map((option) => option.value)).toContain('');
    expect(JSON.stringify(edit.layout)).toBe(before); expect(edit.card._commit).not.toHaveBeenCalled();
  });

  it('reports missing saved links without changing layout or requesting a repair', () => {
    const edit = fixture(), before = JSON.stringify(edit.layout);
    edit.panel.innerHTML = edit._dataTab();
    expect(edit.panel.textContent).toContain('2 saved link(s) need attention');
    expect(edit.panel.textContent).toContain('deleted_floor'); expect(edit.panel.textContent).toContain('deleted_area');
    expect(edit.panel.textContent).toContain('Relink or clear');
    expect(JSON.stringify(edit.layout)).toBe(before); expect(edit.card._commit).not.toHaveBeenCalled();
  });

  it('filters model entity suggestions, labels them with HA names, and retains a missing saved binding', () => {
    const edit = fixture(), m = edit.card.modelBindings();
    m.manifest.objects = [{ id: 'lamp', type: 'light', label: 'Lamp', level: 'ground', room: 'kitchen', suggest: {} }];
    edit.card.modelBindings = () => m;
    edit.card._bindings = new Map([['lamp', { entity: 'light.missing', missing: true }]]);
    edit.card._layout.objects = { lamp: { entity: 'light.missing' } }; edit.objExpanded.add('ground/kitchen');
    edit.card._hass.states = {
      'light.visible': { state: 'on', attributes: { friendly_name: 'Desk & lamp' } },
      'light.hidden': { state: 'on', attributes: { friendly_name: 'Hidden' } },
      'light.disabled': { state: 'on', attributes: {} }, 'sensor.other': { state: '1', attributes: {} },
    };
    edit.card._hass.entities = { 'light.hidden': { hidden_by: 'user' }, 'light.disabled': { disabled_by: 'integration' } };
    edit.panel.innerHTML = edit._objectsTab();
    const options = [...edit.panel.querySelectorAll('#fp-obj-light option')];
    expect(options.map((option) => option.value).sort()).toEqual(['light.missing', 'light.visible']);
    expect(options.find((option) => option.value === 'light.visible').textContent).toContain('Desk & lamp');
    expect(options.find((option) => option.value === 'light.missing').textContent).toContain('Missing entity');
    expect(edit.panel.querySelector('[data-field="obj-entity"]').value).toBe('light.missing');
  });
});
