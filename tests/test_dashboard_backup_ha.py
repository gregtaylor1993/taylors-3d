"""Future backup routes through actual HA HTTP/auth/executor infrastructure.

Register only these unshipped views; this does not prove integration startup or
restore behavior. The actual pytest-homeassistant-custom-component dependency
is required. Local drafting syntax checks are NOT native middleware test passes.
Supervisor cases simulate Unix routing only, not a physical Supervisor socket.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import io
import json
from pathlib import Path
import threading

import pytest

from homeassistant.components import http as http_component
from homeassistant.components.http import auth as http_auth
from homeassistant.components.http import const as http_const
from homeassistant.components.lovelace import LovelaceData
from homeassistant.components.lovelace.const import LOVELACE_DATA
from homeassistant.components.lovelace.dashboard import LovelaceStorage, LovelaceYAML
from homeassistant.setup import async_setup_component

from custom_components.taylors3d import LayoutStore
from custom_components.taylors3d.const import CARD_FILENAME, CARD_URL_BASE, DOMAIN
from custom_components.taylors3d import dashboard_backup as core
from custom_components.taylors3d import dashboard_backup_http as adapter
from custom_components.taylors3d import furniture
from custom_components.taylors3d.model import model_path
from .test_furniture_pack import bundle, fixture, glb

# HA 2026.2.3 owns this constant in http/__init__.py; the later real HTTP
# server split owns it in http/server.py. Keep both actual framework limits.
if hasattr(http_component, "MAX_CLIENT_SIZE"):
    http_server = http_component
else:
    from homeassistant.components.http import server as http_server

URL = adapter.URL
MiB = 1024 * 1024
SUPERVISOR_AVAILABLE = all((
    hasattr(http_const, "DATA_SUPERVISOR_USER"),
    hasattr(http_const, "KEY_SUPERVISOR_UNIX_SOCKET"),
    hasattr(http_auth, "is_supervisor_unix_socket_request"),
))


def layout():
    return {"version": 1, "rooms": [], "floors": [], "unknown": {"keep": [7, None]}}


def payload():
    return {
        "dashboard": {"title": "Raw selected dashboard", "views": [{"cards": [
            {"type": "conditional", "conditions": [{"entity": "sensor.missing", "state": "on"}],
             "card": {"type": "custom:taylors3d-card", "layout_key": "shared", "arbitrary": [False, 3]}}
        ]}], "unknown": {"retain": "🏠"}},
        "source": {"url_path": "dashboard-test", "mode": "storage", "metadata": {"title": "Original"}},
        "resources": {"mode": "storage", "items": [{"type": "module", "url": f"{CARD_URL_BASE}/{CARD_FILENAME}?v=exact"}]},
        "shared_keys": ["shared"], "layouts": {},
    }


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def stored_archive(source=None, *, model=None):
    value = payload()
    prepared = core.prepare_dashboard_backup(value["dashboard"], source=value["source"], resources=value["resources"],
        layouts={"shared": {"backend": "shared", "layout": layout() if source is None else source}},
        models={} if model is None else {"shared": model})
    target = io.BytesIO()
    core.create_dashboard_backup(prepared, target)
    return target.getvalue()


@pytest.fixture
async def backup_views(hass, tmp_path):
    """No startup wiring: install the future adapter before router freeze."""
    hass.config.config_dir = str(tmp_path)
    assert await async_setup_component(hass, "http", {})
    store = LayoutStore(hass)
    await store.async_load()
    # Seed an actual LayoutStore without scheduling any persistence write.
    store._layouts["shared"] = layout()
    hass.data[DOMAIN] = store
    views = await adapter.async_register_dashboard_backup(hass)
    await hass.async_block_till_done()
    return views


async def configuration_files(hass, tmp_path):
    return await hass.async_add_executor_job(lambda: {
        str(path.relative_to(tmp_path)): path.read_bytes()
        for path in Path(tmp_path).rglob("*") if path.is_file() and (
            path.is_relative_to(Path(tmp_path) / "taylors3d")
            or path == Path(tmp_path) / ".storage/taylors3d.layouts"
        )
    })


async def revoke(hass, user, token, kind):
    if kind == "inactive":
        await hass.auth.async_deactivate_user(user)
    elif kind == "admin":
        await hass.auth.async_update_user(user, group_ids=[])
    elif kind == "removed":
        await hass.auth.async_remove_user(user)
    else:
        refresh = hass.auth.async_validate_access_token(token)
        assert refresh is not None
        hass.auth.async_remove_refresh_token(refresh)


async def stop_request(task, release):
    release.set()
    if not task.done():
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_register_once_has_only_two_exact_owned_resources(hass, backup_views, hass_client):
    resources = {resource.canonical: resource for resource in hass.http.app.router.resources()
                 if resource.canonical.startswith(URL)}
    assert set(resources) == {f"{URL}/export", f"{URL}/inspect"}
    assert len(resources) == 2
    assert await adapter.async_register_dashboard_backup(hass) is backup_views
    current = [resource for resource in hass.http.app.router.resources() if resource.canonical.startswith(URL)]
    assert len(current) == 2
    assert all(resources[resource.canonical] is resource for resource in current)
    client = await hass_client()
    assert (await client.post("/api/unrelated_integration/dashboard_backup/export", json=payload())).status == 404
    assert (await client.get(f"{URL}/export")).status == 405
    assert (await client.post(f"{URL}/restore", json={})).status == 404


async def test_real_auth_rejects_anonymous_before_body_or_worker(hass, backup_views, hass_client_no_auth, monkeypatch):
    client = await hass_client_no_auth()
    observed = []
    original = adapter.build_download

    def build(*args, **kwargs):
        observed.append(True)
        return original(*args, **kwargs)

    monkeypatch.setattr(adapter, "build_download", build)
    assert (await client.post(f"{URL}/export", json=payload())).status == 401
    assert (await client.post(f"{URL}/inspect", data=stored_archive(), headers={"Content-Type": "application/zip"})).status == 401
    assert observed == []


async def test_nonadmin_export_exact_raw_original_member_bytes_without_storage_writes(
    hass, backup_views, hass_client, hass_admin_user, tmp_path,
):
    client = await hass_client()
    await hass.auth.async_update_user(hass_admin_user, group_ids=[])
    value = payload()
    raw_dashboard = '{ "views" : [{"sections":[{"cards":[{"type":"custom:taylors3d-card","layout_key":"personal"}]}]}], "extra": "🏠" }\n'
    raw_layout = '{ "version":1, "rooms":[], "floors":[], "untouched":[null,9] }\n'
    value.pop("dashboard")
    value.update(dashboard_json=raw_dashboard, shared_keys=[], layouts={
        "personal": {"backend": "browser", "layout_json": raw_layout, "metadata": {"captured": "local"}}
    })
    before = await configuration_files(hass, tmp_path)
    response = await client.post(f"{URL}/export", data=encoded(value), headers={"Content-Type": "application/json"})
    assert response.status == 200, await response.text()
    assert response.headers["Cache-Control"] == "private, no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Taylors3D-Complete"] == "true"
    raw = await response.read()
    prepared = await hass.async_add_executor_job(core.validate_dashboard_backup, raw)
    assert prepared.members["dashboard.json"] == raw_dashboard.encode("utf-8")
    row = prepared.manifest["layouts"][0]
    assert prepared.members[row["file"]["path"]] == raw_layout.encode()
    assert row["backend"] == "browser"
    assert (await client.post(f"{URL}/inspect", data=raw, headers={"Content-Type": "application/zip"})).status == 401
    assert await configuration_files(hass, tmp_path) == before
    assert hass.data[DOMAIN].get("shared") == layout()


async def test_current_shared_original_model_and_published_licensed_pack_are_collected(
    hass, backup_views, hass_client, tmp_path,
):
    client = await hass_client()
    original_model, original_pack = glb(), bundle()
    library = furniture.FurnitureLibrary(tmp_path / "taylors3d/furniture")
    result = await hass.async_add_executor_job(library.import_pack, original_pack)
    hass.data[furniture.DATA_FURNITURE] = library
    pack = result["pack"]
    source = layout()
    source["model"] = {"version": hashlib.sha256(original_model).hexdigest()[:12], "name": "Original exact house.glb"}
    source["furniture"] = {"version": 1, "instances": [{"id": "chair", "pack_id": pack["pack_id"],
        "item_id": pack["items"][0]["id"], "asset_sha256": pack["items"][0]["sha256"], "floor_id": "missing-exact-floor"}]}
    hass.data[DOMAIN]._layouts["shared"] = source

    def seed_model():
        path = model_path(hass, "shared")
        path.parent.mkdir(parents=True)
        path.write_bytes(original_model)

    await hass.async_add_executor_job(seed_model)
    before, source_before = await configuration_files(hass, tmp_path), copy.deepcopy(source)
    response = await client.post(f"{URL}/export", json=payload())
    assert response.status == 200, await response.text()
    archive = await response.read()
    prepared = await hass.async_add_executor_job(core.validate_dashboard_backup, archive)
    assert prepared.complete
    assert prepared.members[prepared.manifest["models"][0]["file"]["path"]] == original_model
    assert prepared.members[prepared.manifest["furniture"][0]["file"]["path"]] == original_pack
    assert prepared.manifest["furniture"][0]["metadata"]["license"] == pack["license"]
    response = await client.post(f"{URL}/inspect", data=archive, headers={"Content-Type": "application/zip"})
    assert response.status == 200, await response.text()
    preview = await response.json()
    assert preview["report"]["complete"] and preview["report"]["dependencyFree"]
    assert preview["preview"]["dashboard"] == payload()["dashboard"]
    assert preview["preview"]["layouts"]["shared"]["layout"] == source
    assert preview["restoreAvailable"] is False
    assert source == source_before
    assert await configuration_files(hass, tmp_path) == before


async def test_owned_lovelace_default_mode_and_resources_resolve_without_browser_guess(
    hass, backup_views, hass_client,
):
    # Use actual HA source classes, never fake mode properties or inferred URLs.
    default = LovelaceStorage(hass, None)
    named_yaml = LovelaceYAML(hass, "lovelace", {"filename": "ui-lovelace.yaml"})
    hass.data[LOVELACE_DATA] = LovelaceData(resource_mode="storage", dashboards={None: default, "lovelace": named_yaml},
        resources=None, yaml_dashboards={})
    client = await hass_client()
    value = payload()
    value["source"].update(url_path=None, mode=None)
    value["resources"]["mode"] = None
    response = await client.post(f"{URL}/export", json=value)
    assert response.status == 200, await response.text()
    prepared = await hass.async_add_executor_job(core.validate_dashboard_backup, await response.read())
    assert prepared.manifest["dashboard"]["mode"] == "yaml"
    assert prepared.manifest["resources"]["mode"] == "storage"
    assert prepared.manifest["http_capture"]["source_mode_proven"] is True
    value["source"]["mode"] = "storage"
    response = await client.post(f"{URL}/export", json=value)
    assert response.status == 409
    assert (await response.json())["error"] == "source_changed"


async def test_missing_layout_and_external_dependencies_are_explicit_incomplete(hass, backup_views, hass_client):
    client = await hass_client()
    value = payload()
    value["dashboard"]["views"][0]["cards"].append({"type": "custom:foreign-card", "image": "/local/photo.png"})
    value["resources"]["items"].append({"type": "module", "url": "https://example.invalid/foreign.js"})
    hass.data[DOMAIN]._layouts.clear()
    response = await client.post(f"{URL}/export", json=value)
    assert response.status == 200, await response.text()
    assert response.headers["X-Taylors3D-Complete"] == "false"
    prepared = await hass.async_add_executor_job(core.validate_dashboard_backup, await response.read())
    assert not prepared.complete
    codes = {row["code"] for row in prepared.report()["diagnostics"]}
    assert {"layout_missing", "external_dependency"} <= codes
    assert prepared.dashboard == value["dashboard"]
    response = await client.post(f"{URL}/inspect", data=stored_archive(), headers={"Content-Type": "application/zip"})
    assert response.status == 200
    assert (await response.json())["restoreAvailable"] is False


@pytest.mark.parametrize("path", [[], {}, True, 0, "", " ", "a" * 257, "bad\0path"])
async def test_malformed_selected_source_returns_bounded_400_before_ha_lookup(hass, backup_views, hass_client, path):
    client = await hass_client()
    value = payload()
    value["source"]["url_path"] = path
    response = await client.post(f"{URL}/export", json=value)
    assert response.status == 400
    result = await response.json()
    assert result["error"] == "source_path"
    assert result["path"] == "source.url_path"
    assert len(encoded(result)) < 1024
    assert hass.data[DOMAIN].get("shared") == layout()


@pytest.mark.parametrize("body,content_type,encoding,status", [
    (b'{"dashboard":{},"dashboard":{}}', "application/json", None, 400),
    (b'{"dashboard":NaN}', "application/json", None, 400),
    (b'{}', "text/plain", None, 415),
    (b'{}', "application/json; charset=iso-8859-1", None, 415),
    (b'{}', "application/json", "gzip", 415),
])
async def test_real_request_json_content_and_duplicate_provenance_rejection(
    hass, backup_views, hass_client, body, content_type, encoding, status,
):
    client = await hass_client()
    headers = {"Content-Type": content_type}
    if encoding is not None:
        # Send genuinely encoded data so middleware can reach the explicit guard.
        import gzip
        body = gzip.compress(body)
        headers["Content-Encoding"] = encoding
    response = await client.post(f"{URL}/export", data=body, headers=headers)
    assert response.status == status, await response.text()
    assert response.headers["Cache-Control"] == "private, no-store"


async def test_actual_stream_exceeds_ha_global_read_limit_without_changing_it(hass, backup_views, hass_client):
    client = await hass_client()
    maximum = http_server.MAX_CLIENT_SIZE
    assert maximum == 16 * MiB
    # Whitespace makes the wire exceed HA Request.read's global limit while the
    # actual selected raw dashboard/layout remain small and valid.
    body = b" " * (maximum + 1) + encoded(payload())
    assert len(body) < adapter.MAX_EXPORT_BODY
    response = await client.post(f"{URL}/export", data=body, headers={"Content-Type": "application/json"})
    assert response.status == 200, await response.text()
    prepared = await hass.async_add_executor_job(core.validate_dashboard_backup, await response.read())
    assert prepared.dashboard == payload()["dashboard"]
    assert http_server.MAX_CLIENT_SIZE == maximum
    assert hass.http.app._client_max_size == maximum


async def test_real_large_inspect_spools_original_zip_without_global_limit_change(hass, backup_views, hass_client):
    client = await hass_client()
    doc, binary = fixture()
    binary += b"\0" * (17 * MiB - len(binary))
    doc["buffers"][0]["byteLength"] = len(binary)
    model = glb(doc, binary)
    source = layout()
    source["model"] = {"version": hashlib.sha256(model).hexdigest()[:12]}
    archive = await hass.async_add_executor_job(lambda: stored_archive(source, model=model))
    assert len(archive) > http_server.MAX_CLIENT_SIZE
    response = await client.post(f"{URL}/inspect", data=archive, headers={"Content-Type": "application/zip"})
    assert response.status == 200, await response.text()
    result = await response.json()
    assert result["report"]["complete"] and result["restoreAvailable"] is False
    assert result["manifest"]["models"][0]["file"]["sha256"] == hashlib.sha256(model).hexdigest()
    assert http_server.MAX_CLIENT_SIZE == 16 * MiB
    assert hass.http.app._client_max_size == 16 * MiB


@pytest.mark.parametrize("route,maximum", [("export", 64), ("inspect", 64)])
async def test_actual_chunked_body_limit_does_not_trust_content_length(hass, backup_views, hass_client, monkeypatch, route, maximum):
    client = await hass_client()
    monkeypatch.setattr(adapter, "MAX_EXPORT_BODY" if route == "export" else "MAX_ARCHIVE_BYTES", maximum)
    raw = encoded(payload()) if route == "export" else stored_archive()

    async def chunks():
        for i in range(0, len(raw), 17):
            yield raw[i:i + 17]

    response = await client.post(f"{URL}/{route}", data=chunks(), headers={
        "Content-Type": "application/json" if route == "export" else "application/zip",
    })
    assert response.status == 413
    assert (await response.json())["error"] == "body_size"


@pytest.mark.parametrize("kind", ["inactive", "token", "removed"])
async def test_export_current_user_revoked_during_actual_body_never_builds_archive(
    hass, backup_views, hass_client, hass_admin_user, hass_access_token, monkeypatch, kind,
):
    client = await hass_client()
    original_read, original_build = adapter.read_body, adapter.build_download
    observed, built = False, []

    async def guarded_read(content, maximum, check):
        count = 0

        async def after_chunk():
            nonlocal count, observed
            count += 1
            if count == 2:
                observed = True
                await revoke(hass, hass_admin_user, hass_access_token, kind)
            await check()

        return await original_read(content, maximum, after_chunk)

    def build(*args, **kwargs):
        built.append(True)
        return original_build(*args, **kwargs)

    monkeypatch.setattr(adapter, "read_body", guarded_read)
    monkeypatch.setattr(adapter, "build_download", build)
    response = await client.post(f"{URL}/export", json=payload())
    assert observed and response.status == 401
    assert built == []


@pytest.mark.parametrize("route,kind", [
    ("export", "inactive"), ("export", "token"), ("export", "removed"),
    ("inspect", "inactive"), ("inspect", "admin"), ("inspect", "token"),
])
async def test_real_executor_wait_revalidates_auth_before_download_or_preview(
    hass, backup_views, hass_client, hass_admin_user, hass_access_token, monkeypatch, route, kind,
):
    client = await hass_client()
    started, release = asyncio.Event(), threading.Event()
    worker_name = "build_download" if route == "export" else "inspect_and_close"
    original = getattr(adapter, worker_name)
    owned = []

    def held(*args, **kwargs):
        hass.loop.call_soon_threadsafe(started.set)
        assert release.wait(10), "Executor auth barrier was not released"
        result = original(*args, **kwargs)
        owned.append(result.stream if route == "export" else args[0])
        return result

    monkeypatch.setattr(adapter, worker_name, held)
    body = encoded(payload()) if route == "export" else stored_archive()
    request = asyncio.create_task(client.post(f"{URL}/{route}", data=body, headers={
        "Content-Type": "application/json" if route == "export" else "application/zip",
    }))
    try:
        await asyncio.wait_for(started.wait(), 10)
        await revoke(hass, hass_admin_user, hass_access_token, kind)
        release.set()
        response = await asyncio.wait_for(request, 10)
        assert response.status == 401
        assert owned and all(stream.closed for stream in owned)
        assert hass.data[DOMAIN].get("shared") == layout()
    finally:
        await stop_request(request, release)


async def test_shared_layout_replaced_during_worker_is_conflict_and_tempfile_closes(
    hass, backup_views, hass_client, monkeypatch,
):
    client = await hass_client()
    started, release, owned = asyncio.Event(), threading.Event(), []
    original = adapter.build_download

    def held(*args, **kwargs):
        hass.loop.call_soon_threadsafe(started.set)
        assert release.wait(10)
        result = original(*args, **kwargs)
        owned.append(result.stream)
        return result

    monkeypatch.setattr(adapter, "build_download", held)
    request = asyncio.create_task(client.post(f"{URL}/export", json=payload()))
    try:
        await asyncio.wait_for(started.wait(), 10)
        replacement = {**layout(), "newer": "exact current layout"}
        hass.data[DOMAIN]._layouts["shared"] = replacement
        release.set()
        response = await asyncio.wait_for(request, 10)
        assert response.status == 409
        assert (await response.json())["error"] == "source_changed"
        assert owned and all(stream.closed for stream in owned)
        assert hass.data[DOMAIN].get("shared") is replacement
    finally:
        await stop_request(request, release)


async def test_corrupt_zip_inspection_never_writes_or_instantiates_cards(hass, backup_views, hass_client, tmp_path):
    client = await hass_client()
    before = await configuration_files(hass, tmp_path)
    source = hass.data[DOMAIN].get("shared")
    response = await client.post(f"{URL}/inspect", data=b"not a ZIP", headers={"Content-Type": "application/zip"})
    assert response.status == 400
    assert await configuration_files(hass, tmp_path) == before
    assert hass.data[DOMAIN].get("shared") is source


@pytest.mark.skipif(not SUPERVISOR_AVAILABLE, reason="HA lacks modern Supervisor Unix auth APIs")
@pytest.mark.parametrize("route", ["export", "inspect"])
async def test_tokenless_supervisor_removed_from_actual_auth_store_during_worker_is_rejected(
    hass, backup_views, hass_client_no_auth, hass_supervisor_user, monkeypatch, route,
):
    hass.data[http_const.DATA_SUPERVISOR_USER] = hass_supervisor_user

    def supervisor_route(request):
        request[http_const.KEY_SUPERVISOR_UNIX_SOCKET] = True
        return True

    monkeypatch.setattr(http_auth, "is_supervisor_unix_socket_request", supervisor_route)
    client = await hass_client_no_auth()
    started, release = asyncio.Event(), threading.Event()
    worker_name = "build_download" if route == "export" else "inspect_and_close"
    original = getattr(adapter, worker_name)

    def held(*args, **kwargs):
        hass.loop.call_soon_threadsafe(started.set)
        assert release.wait(10)
        return original(*args, **kwargs)

    monkeypatch.setattr(adapter, worker_name, held)
    request = asyncio.create_task(client.post(f"{URL}/{route}", data=encoded(payload()) if route == "export" else stored_archive(),
        headers={"Content-Type": "application/json" if route == "export" else "application/zip"}))
    try:
        await asyncio.wait_for(started.wait(), 10)
        await hass.auth.async_remove_user(hass_supervisor_user)
        release.set()
        response = await asyncio.wait_for(request, 10)
        assert response.status == 401
        assert await hass.auth.async_get_user(hass_supervisor_user.id) is None
    finally:
        await stop_request(request, release)
