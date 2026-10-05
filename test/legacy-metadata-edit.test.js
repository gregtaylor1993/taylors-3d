// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';

function fixture() {
  const view = { id: 'saved', label: 'Saved', source: 'added', floors: ['removed-floor', 'ground'] };
  const card = {
    _hass: { states: {
      'sensor.position': { state: '1', attributes: { friendly_name: 'Garden position' } },
      'sensor.hidden': { state: '1', attributes: {} },
      'sensor.disabled': { state: '1', attributes: {} },
      'sensor.diagnostic': { state: '1', attributes: {} },
      'camera.visible': { state: 'idle', attributes: { friendly_name: 'Garden map' } },
      'camera.hidden': { state: 'idle', attributes: {} },
    }, entities: {
      'sensor.position': { area_id: 'garden' },
      'sensor.hidden': { hidden_by: 'user' },
      'sensor.disabled': { device_id: 'disabled-device' },
      'sensor.diagnostic': { entity_category: 'diagnostic' },
      'camera.visible': { area_id: 'garden' }, 'camera.hidden': { hidden_by: 'user' },
    }, devices: { 'disabled-device': { disabled_by: 'user' } },
    areas: { garden: { area_id: 'garden', name: 'Garden' }, lounge: { area_id: 'lounge', name: 'Lounge' } } },
    _floors: [{ id: 'ground', name: 'Ground', elevation: 0 }, { id: 'first', name: 'First', elevation: 3 }],
    _layout: { rooms: [], mower: { entity: 'sensor.position', source: 'xy', floor_id: 'removed-floor' }, views: { saved: { floors: view.floors } } },
    _config: {}, _view: {}, _views: [view], _viewId: 'saved', _store: { backend: 'shared' },
    _mowerFloor: () => 'ground', currentView: () => view, _stateFor: () => ({ floors: view.floors }),
    viewIndex: () => null, saveViewPatch: vi.fn(), _commit: vi.fn(), _setFloor: vi.fn(),
  };
  const edit = new EditMode(card);
  edit.render = vi.fn();
  edit.commit = vi.fn((layout) => { card._layout = layout; });
  return edit;
}

describe('legacy picker metadata and retained floor links', () => {
  it('filters mower and map suggestions using current registry eligibility and HA names', () => {
    const edit = fixture(); edit.panel.innerHTML = edit._mowerTab();
    const values = (id) => [...edit.panel.querySelectorAll(`#${id} option`)].map((option) => option.value);
    expect(values('fp-pos-ents')).toEqual(['sensor.position']);
    expect(values('fp-pic-ents')).toEqual(['camera.visible']);
    expect(edit.panel.querySelector('#fp-pos-ents').textContent).toContain('Garden position');
  });

  it('retains a selected missing or filtered mower entity as an explicit warning', () => {
    const edit = fixture(); edit.card._layout.mower.entity = 'sensor.missing';
    edit.panel.innerHTML = edit._mowerTab();
    expect(edit.panel.querySelector('[data-field="mower-entity"]').value).toBe('sensor.missing');
    expect(edit.panel.querySelector('#fp-pos-ents').textContent).toContain('Missing entity');
    expect(edit.panel.querySelector('[data-mower-link-warning]').textContent).toContain('sensor.missing');
    expect(edit.commit).not.toHaveBeenCalled();
  });

  it('shows the exact missing saved mower floor instead of selecting Ground', () => {
    const edit = fixture(); edit.panel.innerHTML = edit._mowerTab();
    const selector = edit.panel.querySelector('[data-field="mower-floor"]');
    expect(selector.value).toBe('removed-floor');
    expect(selector.selectedOptions[0].textContent).toContain('Missing floor');
    expect(edit.commit).not.toHaveBeenCalled();
  });

  it('rejects a newly typed hidden mower link after metadata changes', () => {
    const edit = fixture();
    const input = document.createElement('input'); input.dataset.field = 'mower-entity'; input.value = 'sensor.hidden';
    edit._onPanelChange({ target: input });
    expect(edit.commit).not.toHaveBeenCalled();
    expect(edit.card._layout.mower.entity).toBe('sensor.position');
  });

  it('retains an unchanged saved filtered link when another mower field changes', () => {
    const edit = fixture(); edit.card._layout.mower.entity = 'sensor.hidden';
    const input = document.createElement('input'); input.dataset.field = 'mower-trail'; input.checked = false;
    edit._onPanelChange({ target: input });
    expect(edit.card._layout.mower.entity).toBe('sensor.hidden');
    expect(edit.card._layout.mower.trail).toBe(false);
  });

  it('offers a temporary area filter while retaining the selected exact link', () => {
    const edit = fixture(); edit.panel.innerHTML = edit._mowerTab();
    const filter = edit.panel.querySelector('[data-field="mower-picker-area"]');
    expect(filter).not.toBeNull();
    filter.value = 'area:lounge'; edit._onPanelChange({ target: filter });
    edit.panel.innerHTML = edit._mowerTab();
    expect(edit.panel.querySelector('#fp-pos-ents').textContent).toContain('Outside current filter');
    expect(edit.card._layout.mower).not.toHaveProperty('picker_area');
    expect(edit.commit).not.toHaveBeenCalled();
  });

  it('displays missing saved view floor IDs and keeps them when another floor changes', () => {
    const edit = fixture(); edit.panel.innerHTML = edit._viewsTab();
    const warning = edit.panel.querySelector('[data-missing-view-floor]');
    expect(warning?.textContent).toContain('removed-floor');
    edit._viewsChange('vw-floor', { dataset: { id: 'first' }, checked: true });
    expect(edit.card.saveViewPatch).toHaveBeenCalledWith('saved', { floors: ['removed-floor', 'ground', 'first'] });
  });

  it('allows an explicit missing view-floor checkbox removal without changing other links', () => {
    const edit = fixture(); edit.panel.innerHTML = edit._viewsTab();
    const checkbox = edit.panel.querySelector('[data-field="vw-floor"][data-id="removed-floor"]');
    expect(checkbox?.checked).toBe(true);
    edit._viewsChange('vw-floor', { dataset: { id: 'removed-floor' }, checked: false });
    expect(edit.card.saveViewPatch).toHaveBeenCalledWith('saved', { floors: ['ground'] });
  });

  it('rejects a forged view floor ID that was neither current nor previously saved', () => {
    const edit = fixture(); edit._viewsChange('vw-floor', { dataset: { id: 'invented' }, checked: true });
    expect(edit.card.saveViewPatch).not.toHaveBeenCalled();
  });
});
