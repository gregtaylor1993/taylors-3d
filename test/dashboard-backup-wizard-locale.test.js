// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardBackupEditor } from '../src/dashboard-backup-editor.js';
import messages from '../src/translations/dashboard-backup-wizard.js';

const fixtures = [];
function fixture(language = 'en') {
  const dashboard = { title: 'Full dashboard backup', views: [{ title: 'User_<b>view_été', cards: [{ type: 'custom:taylors3d-card', layout_key: 'User_layout' }] }] };
  const connection = Object.assign(new EventTarget(), { connected: true }), callWS = vi.fn(async ({ type }) => {
    if (type === 'lovelace/dashboards/list') return [{ id: 'User_dashboard', url_path: 'user-dashboard', title: 'User_<b>dashboard_été', mode: 'storage' }];
    throw Error('Unexpected request');
  });
  const card = { ownerDocument: document, isConnected: true, _editing: true, _edit: { tab: 'data' },
    _config: { layout_key: 'User_layout' }, _layout: { raw: 'User_layout_été' }, _view: { model: { root: { uuid: 'User_model' } } },
    _hass: { language, locale: { language }, connection, auth: {}, user: { id: 'User_account', is_admin: true, is_active: true },
      states: {}, entities: {}, devices: {}, areas: {}, floors: {}, callWS, fetchWithAuth: vi.fn(), callService: vi.fn() }, commitFeatureLayout: vi.fn() };
  const host = document.createElement('div'); document.body.append(host);
  const editor = new DashboardBackupEditor(card, () => { host.innerHTML = editor.render(); editor.updatePreviews(host); });
  editor.setActive(true); host.innerHTML = editor.render(); editor.updatePreviews(host);
  host.addEventListener('input', (event) => editor.change(event.target));
  host.addEventListener('click', (event) => { const button = event.target.closest('button'); if (button) editor.click(button); });
  const field = (name) => host.querySelector(`[data-field="dashboard-backup-${name}"]`), button = (name) => host.querySelector(`[data-act="dashboard-backup-${name}"]`);
  const locale = (value) => { card._hass.language = value; card._hass.locale.language = value; editor.onStates(); };
  const inspection = { preview: { dashboard, layouts: { User_layout: { layout: { version: 1 } } } }, manifest: { resources: { mode: 'storage', items: [] } },
    report: { complete: true, counts: { cards: 1, layouts: 1, models: 0, furniture_packs: 0 }, diagnostics: [{ message: 'User_server_<i>detail_été', path: '/User/path' }] } };
  fixtures.push({ editor, host }); return { card, host, editor, field, button, locale, inspection };
}
afterEach(() => { for (const { editor, host } of fixtures.splice(0)) { editor.dispose(); host.remove(); } vi.restoreAllMocks(); });

describe('native full dashboard wizard captions', () => {
  it('provides complete typed four-language captions with matching primitive placeholders and English fallback', () => {
    const keys = Object.keys(messages.en), parameters = (value) => [...value.matchAll(/\{([A-Za-z_]+)\}/g)].map((match) => match[1]).sort();
    expect(keys.length).toBeGreaterThan(50);
    for (const language of ['de', 'fr', 'es']) { expect(Object.keys(messages[language])).toEqual(keys); for (const key of keys) {
      expect(messages[language][key].trim()).not.toBe(''); expect(parameters(messages[language][key])).toEqual(parameters(messages.en[key]));
    } }
    expect(fixture('ja').host.querySelector('h3').textContent).toBe('Full dashboard backup');
  });
  it.each([['de', 'Vollständige Dashboard-Sicherung', 'Kopie vorbereiten'], ['fr', 'Sauvegarde complète du tableau de bord', 'Préparer la copie'],
    ['es', 'Copia completa del panel', 'Preparar copia']])('renders %s captions without translating archive names, paths or changing saved data', (language, title, prepare) => {
    const { card, host, editor, button, inspection } = fixture(language), before = structuredClone(card._layout);
    editor.inspection = inspection; editor.updatePreviews(host);
    expect(host.querySelector('h3').textContent).toBe(title); expect(button('prepare').textContent).toBe(prepare);
    expect(host.querySelector('[data-dashboard-backup-config]').textContent).toContain('Full dashboard backup');
    expect(host.textContent).toContain('User_server_<i>detail_été'); expect(host.textContent).toContain('/User/path'); expect(host.querySelector('i')).toBeNull();
    expect(card._layout).toEqual(before); expect(card._hass.callWS).not.toHaveBeenCalled(); expect(card._hass.fetchWithAuth).not.toHaveBeenCalled();
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('retains exact file/name/consent fields and ownership version through locale-only updates', () => {
    const { editor, host, field, button, locale } = fixture(), namespace = field('namespace'), file = field('file'), review = field('reviewed'), prepare = button('prepare');
    namespace.value = 'user-unfinished'; namespace.dispatchEvent(new Event('input', { bubbles: true })); namespace.focus();
    const selectedFile = new File(['User_raw_bytes'], 'User_backup_été.zip'); editor.file = selectedFile; editor.reviewed = true; editor.updatePreviews(host);
    const version = editor._version, context = editor._base; locale('fr'); locale('de'); locale('es');
    expect(field('namespace')).toBe(namespace); expect(document.activeElement).toBe(namespace); expect(namespace.value).toBe('user-unfinished');
    expect(field('file')).toBe(file); expect(editor.file).toBe(selectedFile); expect(field('reviewed')).toBe(review); expect(review.checked).toBe(true);
    expect(button('prepare')).toBe(prepare); expect(editor._version).toBe(version); expect(editor._base).toBe(context);
  });
  it('updates static details in place while preserving open state, summary focus, raw JSON and the cached reference graph', () => {
    const { editor, host, locale, inspection } = fixture(); editor.inspection = inspection; editor.updatePreviews(host);
    const staticHost = host.querySelector('[data-dashboard-backup-static]'), details = staticHost.querySelector('details'), summary = details.querySelector('summary');
    const pre = details.querySelector('pre'), text = pre.textContent, graph = editor._referenceGraph; details.open = true; summary.tabIndex = 0; summary.focus(); locale('de');
    expect(host.querySelector('[data-dashboard-backup-static]')).toBe(staticHost); expect(staticHost.querySelector('details')).toBe(details);
    expect(details.open).toBe(true); expect(details.querySelector('summary')).toBe(summary); expect(document.activeElement).toBe(summary);
    expect(summary.textContent).toBe('Statische vollständige Dashboard-Konfiguration'); expect(details.querySelector('pre')).toBe(pre); expect(pre.textContent).toBe(text);
    expect(editor._referenceGraph).toBe(graph); expect(editor.inspection).toBe(inspection);
  });
  it('retains a current held Refresh gesture through translation and sends exactly its original read request', async () => {
    const { editor, card, button, locale } = fixture(), refresh = button('list'); refresh.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const intent = editor._intents.get(refresh); locale('fr'); expect(button('list')).toBe(refresh); expect(editor._intents.get(refresh)).toBe(intent);
    refresh.dispatchEvent(new Event('pointerup', { bubbles: true })); refresh.click(); for (let index = 0; index < 25; index++) await Promise.resolve();
    expect(card._hass.callWS).toHaveBeenCalledExactlyOnceWith({ type: 'lovelace/dashboards/list' });
    expect(editor._displayMessage()).toContain('Choisissez le tableau de bord exact'); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps an unknown server error literal and escaped while translating owned notices and embedded raw error details', () => {
    const { editor, host, locale } = fixture(); editor._setMessage('prepared'); editor.updatePreviews(host); locale('fr');
    expect(host.querySelector('[data-dashboard-backup-status]').textContent).toContain('Aucun tableau de bord n’a été créé');
    editor._setMessage([{ key: 'zipComplete' }, { key: 'inspectionUnavailable', params: { error: 'User_<b>HTTP_error_été: 403' } }]); editor.updatePreviews(host);
    expect(host.querySelector('[data-dashboard-backup-status]').textContent).toContain('User_<b>HTTP_error_été: 403'); expect(host.querySelector('b')).toBeNull();
    editor.message = 'User_future_<i>server_error_été: raw_units'; locale('es');
    expect(host.querySelector('[data-dashboard-backup-status]').textContent).toBe(editor.message); expect(host.querySelector('i')).toBeNull();
  });
});
