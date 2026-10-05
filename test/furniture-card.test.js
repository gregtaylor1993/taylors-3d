// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';
import { FurnitureEditor } from '../src/furniture-editor.js';

const cards = [];
function setup() {
  const card = new (customElements.get('taylors3d-card'))(); cards.push(card);
  Object.defineProperty(card, 'isConnected', { value: true, configurable: true });
  card._config = { layout_key: 'home' }; card._layout = { furniture: { version: 1, instances: [] } }; card._loading = false;
  card._hass = { connection: { connected: true }, user: { id: 'admin', is_active: true, is_admin: true }, fetchWithAuth: vi.fn() };
  card._editing = true; card._edit = { tab: 'furniture', _furnitureEditor: { dirty: false, stale: false, _importPending: true },
    _furnitureDrag: { update: vi.fn(), cancel: vi.fn() } };
  card._floors = [{ id: 'ground', elevation: 0 }];
  card._view = { model: { root: {} }, floorElevation: () => 0 }; card._schedule = vi.fn();
  const coordinator = { generation: 1, draft: null, sync: vi.fn(() => true),
    catalogueSnapshot: vi.fn(() => ({ status: 'ready', catalogue: { version: 1, packs: [] } })),
    refresh: vi.fn(() => Promise.resolve({ ok: true })), client: { archive: vi.fn() },
    previewDraft: vi.fn((raw) => { coordinator.draft = structuredClone(raw); return true; }),
    clearPreview: vi.fn(() => { coordinator.draft = null; return true; }),
    get preview() { return structuredClone(coordinator.draft); } };
  card._furnitureCoordinator = coordinator;
  card._furnitureLayer = { setData: vi.fn(), report: vi.fn(() => ({ ready: true })), dispose: vi.fn() };
  return { card, coordinator, layer: card._furnitureLayer };
}
afterEach(() => { for (const card of cards.splice(0)) {
  card._furnitureLayer?.dispose(); card._ambientController.dispose(); card._scenePreviewController.dispose(); card._presetEvents.disconnect();
} vi.restoreAllMocks(); });

describe('Furniture card composition', () => {
  it('leaves ordinary cards without furniture free of a client, layer and catalogue request', () => {
    const { card } = setup(); delete card._layout.furniture; card._furnitureCoordinator = null; card._furnitureLayer = null; card._edit.tab = 'rooms';
    card._syncFurniture(); expect(card._furnitureCoordinator).toBeNull(); expect(card._furnitureLayer).toBeNull();
    expect(card._hass.fetchWithAuth).not.toHaveBeenCalled();
  });
  it('allows the editor own pending-before-call import seam only with a clean current admin draft', () => {
    const { card } = setup(); expect(card.furnitureImportAvailable()).toBe(true);
    card._edit._furnitureEditor.dirty = true; expect(card.furnitureImportAvailable()).toBe(false);
    card._edit._furnitureEditor.dirty = false; card._hass.user.is_admin = false; expect(card.furnitureImportAvailable()).toBe(false);
    card._hass.user.is_admin = true; card._loading = true; expect(card.furnitureImportAvailable()).toBe(false);
  });
  it('uses actual floor elevations with a defensive draft while leaving saved coordinates alone', () => {
    const { card, layer } = setup(), saved = structuredClone(card._layout);
    card._view.floorElevation = () => 4.125; const draft = { version: 1, instances: [] };
    card.furniturePreviewDraft(draft); expect(layer.setData).toHaveBeenLastCalledWith(expect.objectContaining({ raw: draft,
      floors: [{ id: 'ground', elevation: 4.125 }], enabled: true })); expect(card._layout).toEqual(saved);
  });
  it.each(['root', 'model', 'alignment', 'floor'])('discards a transient preview after an observed %s source change', (change) => {
    const { card, coordinator, layer } = setup(); const draft = { version: 1, instances: [{ id: 'draft-only' }] };
    card.furniturePreviewDraft(draft);
    if (change === 'root') card._view.model.root = {};
    if (change === 'model') card._config.model = '/local/replacement.glb';
    if (change === 'alignment') card._layout.model = { scale: 2 };
    if (change === 'floor') card._floors[0].elevation = 5;
    card._syncFurniture(); expect(coordinator.clearPreview).toHaveBeenCalled();
    expect(layer.setData).toHaveBeenLastCalledWith(expect.objectContaining({ raw: card._layout.furniture }));
    expect(card._layout.furniture.instances).toEqual([]);
  });
  it('requests a saved referenced library once per session and leaves errors for deliberate retry', () => {
    const { card, coordinator } = setup(); card._layout.furniture.instances = [{ id: 'saved' }];
    coordinator.catalogueSnapshot.mockReturnValue({ status: 'unavailable', catalogue: null });
    card._syncFurniture(); card._syncFurniture(); expect(coordinator.refresh).toHaveBeenCalledOnce();
    coordinator.catalogueSnapshot.mockReturnValue({ status: 'error', catalogue: null }); card._syncFurniture(); expect(coordinator.refresh).toHaveBeenCalledOnce();
    coordinator.generation++; coordinator.catalogueSnapshot.mockReturnValue({ status: 'unavailable', catalogue: null });
    card._syncFurniture(); expect(coordinator.refresh).toHaveBeenCalledTimes(2);
  });
  it('does not download a licensed ZIP after its initiating session is replaced', async () => {
    const { card, coordinator } = setup(); let resolve; coordinator.client.archive.mockReturnValue(new Promise((done) => { resolve = done; }));
    const create = vi.fn(); vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    const pending = card.furnitureExportPack('a'.repeat(64)); coordinator.generation++;
    resolve({ ok: true, bytes: new Uint8Array([1, 2]) }); expect(await pending).toBe(false); expect(create).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it.each(['undoEdit', 'redoEdit'])('clears dirty furniture before direct %s restores an unrelated feature', (action) => {
    const { card, coordinator } = setup(), sha = 'a'.repeat(64), pack = 'b'.repeat(64);
    card._layout.furniture.instances = [{ id: 'chair-1', pack_id: pack, item_id: 'chair', asset_sha256: sha,
      floor_id: 'ground', x: 1, y: 2, z: 0, rotation_degrees: 0, scale: 1 }];
    coordinator.catalogueSnapshot.mockReturnValue({ status: 'ready', catalogue: { version: 1, packs: [{ pack_id: pack,
      items: [{ id: 'chair', pack_id: pack, sha256: sha, unit: 'm', anchor: [0, 0, 0] }] }] } });
    const original = structuredClone(card._layout), changed = { ...original, room_overlays: { enabled: true } };
    card._history.reset({ layout: original, config: card._config }); card._history.record({ layout: changed, config: card._config });
    if (action === 'redoEdit') card._history.undo();
    card._layout = action === 'undoEdit' ? changed : original;
    const editor = new FurnitureEditor(card); card._edit._furnitureEditor = editor; editor.render();
    editor.draft.instances[0].x = 4; editor.dirty = true;
    card._edit.afterUpdate = () => editor.render(); card._suspendAmbient = vi.fn(); card.finishWallSelectionPreparation = vi.fn(); card._stopScenePreview = vi.fn();
    card.setConfig = (config) => { card._config = config; }; card._commit = (layout) => { card._layout = layout; };
    card[action](); expect(editor.dirty).toBe(false); expect(editor.draft.instances[0].x).toBe(1);
    expect(card._edit._furnitureDrag.cancel).toHaveBeenCalled(); editor.dispose();
  });
});
