"""Prepared FUTURE stage route tests through actual HA middleware/public stores.

Not integration startup wiring and not dashboard publication. Requires the real
pytest-homeassistant-custom-component environment; syntax/local stdlib success
does not count as these tests passing. Modern Supervisor cases only simulate
Unix routing, not a physical Supervisor socket.
"""
from __future__ import annotations

import asyncio
import copy
from datetime import timedelta
import hashlib
import io
import json
from pathlib import Path
import threading

import pytest
from pytest_homeassistant_custom_component.common import async_fire_time_changed
from homeassistant.components import frontend, http as http_component
from homeassistant.components.frontend import storage as frontend_storage
from homeassistant.components.http import auth as http_auth, const as http_const
from homeassistant.components import lovelace as lovelace_component
from homeassistant.components.lovelace.const import DOMAIN as LOVELACE_DATA
from homeassistant.setup import async_setup_component

from custom_components.taylors3d import LayoutStore
from custom_components.taylors3d.const import DOMAIN
from custom_components.taylors3d import dashboard_backup as core
from custom_components.taylors3d import dashboard_restore as planner
from custom_components.taylors3d import dashboard_restore_http as adapter
from custom_components.taylors3d import furniture
from custom_components.taylors3d.model import model_path
from .test_furniture_pack import bundle, fixture, glb

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
    return {"version": 1, "rooms": [], "floors": [{"id": "old-deleted-exact-floor"}],
            "unknown": {"preserve": [None, "🏠", False]}}


def stored_archive(source=None, *, model=None, pack=None, missing_layout=False):
    dashboard = {"title": "Raw entire dashboard", "views": [{"sections": [{"cards": [
        {"type": "conditional", "conditions": [{"entity": "sensor.deleted", "state": "on"}],
         "card": {"type": "custom:taylors3d-card", "layout_key": "old", "unknown": {"keep": 9}}},
        {"type": "entities", "entities": ["light.deleted", "sensor.other"], "unknown": [False]},
    ]}]}], "arbitrary": {"raw": [1, None]}}
    source = layout() if source is None else source
    prepared = core.prepare_dashboard_backup(dashboard,
        source={"url_path": "old-dashboard", "mode": "storage", "metadata": {"original": "untouched"}},
        resources={"mode": "storage", "items": []},
        layouts={} if missing_layout else {"old": {"backend": "shared", "layout": source}},
        models={} if model is None else {"old": model},
        furniture_packs={} if pack is None else {hashlib.sha256(pack).hexdigest(): pack})
    target = io.BytesIO()
    core.create_dashboard_backup(prepared, target)
    return target.getvalue()


@pytest.fixture
async def restore_views(hass, tmp_path):
    """Use actual shared/furniture stores; register only the future route."""
    hass.config.config_dir = str(tmp_path)
    assert await async_setup_component(hass, "http", {})
    store = LayoutStore(hass)
    await store.async_load()
    store.set("old", layout())
    hass.data[DOMAIN] = store
    hass.data[furniture.DATA_FURNITURE] = furniture.FurnitureLibrary(tmp_path / "taylors3d/furniture")
    # Exact real backend container without creating any dashboard or WS writer.
    parts = {"dashboards": {}, "resources": None, "yaml_dashboards": {}}
    data_type = getattr(lovelace_component, "LovelaceData", None)
    hass.data[LOVELACE_DATA] = {"mode": "storage", **parts} if data_type is None else data_type(resource_mode="storage", **parts)
    views = await adapter.async_register_dashboard_restore(hass)
    await hass.async_block_till_done()
    return views


async def staged_files(hass, tmp_path):
    return await hass.async_add_executor_job(lambda: {
        str(path.relative_to(tmp_path)): path.read_bytes()
        for path in Path(tmp_path).rglob("*") if path.is_file() and path.is_relative_to(Path(tmp_path) / "taylors3d")
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


async def finish_request(task, release):
    release.set()
    if not task.done():
        task.cancel()
    await asyncio.gather(task, return_exceptions=True)


async def test_future_route_unique_idempotent_and_other_domain_absent(hass, restore_views, hass_client):
    owned = [resource for resource in hass.http.app.router.resources() if resource.canonical.startswith(URL)]
    assert [resource.canonical for resource in owned] == [URL + "/{namespace}"]
    assert await adapter.async_register_dashboard_restore(hass) is restore_views
    assert [resource for resource in hass.http.app.router.resources() if resource.canonical.startswith(URL)] == owned
    client = await hass_client()
    assert (await client.get(URL + "/new")).status == 405
    assert (await client.post("/api/unrelated_integration/dashboard_backup/stage/new", data=stored_archive())).status == 404
    assert (await client.post("/api/taylors3d/dashboard_backup/publish/new", data=stored_archive())).status == 404


async def test_real_anonymous_and_nonadmin_rejected_before_body_or_planner(
    hass, restore_views, hass_client_no_auth, hass_client, hass_admin_user, monkeypatch,
):
    calls = []
    original = adapter.plan_and_close

    def observed(*args):
        calls.append(True)
        return original(*args)

    monkeypatch.setattr(adapter, "plan_and_close", observed)
    client = await hass_client_no_auth()
    assert (await client.post(URL + "/new", data=stored_archive(), headers={"Content-Type": "application/zip"})).status == 401
    client = await hass_client()
    await hass.auth.async_update_user(hass_admin_user, group_ids=[])
    assert (await client.post(URL + "/new", data=stored_archive(), headers={"Content-Type": "application/zip"})).status == 401
    assert calls == []


async def test_actual_stores_publish_exact_original_assets_and_new_shared_layout_only(
    hass, restore_views, hass_client, tmp_path, freezer,
):
    original_model, original_pack = glb(), bundle()
    pack_id = hashlib.sha256(original_pack).hexdigest()
    source = layout()
    source["model"] = {"version": hashlib.sha256(original_model).hexdigest()[:12], "name": "original exact.glb"}
    source["furniture"] = {"version": 1, "instances": [{"id": "chair", "pack_id": pack_id,
        "item_id": "triangle", "asset_sha256": hashlib.sha256(original_model).hexdigest(), "floor_id": "old-deleted-exact-floor"}]}
    body = stored_archive(source, model=original_model, pack=original_pack)
    expected = await hass.async_add_executor_job(planner.plan_dashboard_restore, body, "recovered")
    old = copy.deepcopy(hass.data[DOMAIN].get("old"))
    data = hass.data[LOVELACE_DATA]
    actual_dashboards = data["dashboards"] if type(data) is dict else data.dashboards
    dashboards = actual_dashboards.copy()
    client = await hass_client()
    response = await client.post(URL + "/recovered", data=body, headers={"Content-Type": "application/zip"})
    assert response.status == 200, await response.text()
    result = await response.json()
    assert result["ok"] and result["save_message"] == expected.save_message
    assert result["staging"]["integrity_verified"] and result["staging"]["dashboard_created"] is False
    assert result["report"]["publication_available"] is False
    assert result["staging"]["layouts_persistence"] == "scheduled_not_durable"
    assert result["staging"]["collision_evidence"]["transaction"] is False
    assert result["orphans"] == []
    assert len(result["restore_id"]) == 32
    key = expected.layouts[0]["target_key"]
    assert hass.data[DOMAIN].get(key) == source
    assert hass.data[DOMAIN].get("old") == old
    assert actual_dashboards == dashboards
    assert expected.target_dashboard["url_path"] not in hass.data.get(frontend.DATA_PANELS, {})
    assert await hass.async_add_executor_job(model_path(hass, key).read_bytes) == original_model
    assert await hass.async_add_executor_job(hass.data[furniture.DATA_FURNITURE].archive, pack_id) == original_pack
    # Public delayed persistence is eventually tested, not promised on response.
    freezer.tick(timedelta(seconds=2))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    loaded = LayoutStore(hass)
    await loaded.async_load()
    assert loaded.get(key) == source
    assert response.headers["Cache-Control"] == "private, no-store"


@pytest.mark.parametrize("kind", ["shared", "shared_null", "model", "user_false", "user_null", "panel", "legacy_panel", "dashboard", "yaml"])
async def test_real_collision_prevents_new_assets_and_old_values_remain(
    hass, restore_views, hass_client, hass_admin_user, tmp_path, monkeypatch, kind,
):
    body = stored_archive()
    expected = await hass.async_add_executor_job(planner.plan_dashboard_restore, body, "recovered")
    key, path = expected.layouts[0]["target_key"], expected.target_dashboard["url_path"]
    if kind in ("shared", "shared_null"):
        hass.data[DOMAIN].set(key, {"old": "unchanged"} if kind == "shared" else None)
    elif kind == "model":
        def old_model():
            target = model_path(hass, key)
            target.parent.mkdir(parents=True)
            target.write_bytes(b"unchanged old original")
        await hass.async_add_executor_job(old_model)
    elif kind.startswith("user_"):
        # Any actual user's exact fallback key counts, even false/null values.
        other = await hass.auth.async_create_user("Another actual user")
        user_store = await frontend_storage.async_user_store(hass, other.id)
        if type(user_store) is tuple:
            store, data = user_store
            data["taylors3d_" + key] = False if kind == "user_false" else None
            await store.async_save(data)
        else:
            await user_store.async_set_item("taylors3d_" + key, False if kind == "user_false" else None)
    elif kind in ("panel", "legacy_panel"):
        if kind == "legacy_panel":
            monkeypatch.delattr(frontend, "async_panel_exists", raising=False)
        frontend.async_register_built_in_panel(hass, "history", frontend_url_path=path)
    elif kind == "dashboard":
        data = hass.data[LOVELACE_DATA]
        (data["dashboards"] if type(data) is dict else data.dashboards)[path] = object()  # identity presence only; not a fake loader/writer
    else:
        data = hass.data[LOVELACE_DATA]
        (data["yaml_dashboards"] if type(data) is dict else data.yaml_dashboards)[path] = {"mode": "yaml", "filename": "ui-lovelace.yaml"}
    before = await staged_files(hass, tmp_path)
    client = await hass_client()
    response = await client.post(URL + "/recovered", data=body, headers={"Content-Type": "application/zip"})
    assert response.status == 409, await response.text()
    result = await response.json()
    assert result["error"] == "collision" and result["orphans"] == []
    assert await staged_files(hass, tmp_path) == before


async def test_legacy_panel_added_during_awaited_user_lookup_blocks_all_staging(
    hass, restore_views, hass_client, tmp_path, monkeypatch,
):
    """Recheck the real legacy registry after await, before new asset writes."""
    model = glb()
    source = layout()
    source["model"] = {"version": hashlib.sha256(model).hexdigest()[:12]}
    body = stored_archive(source, model=model)
    expected = await hass.async_add_executor_job(planner.plan_dashboard_restore, body, "recovered")
    key, path = expected.layouts[0]["target_key"], expected.target_dashboard["url_path"]
    before = await staged_files(hass, tmp_path)
    original = hass.auth.async_get_users
    looked_up = []
    client = await hass_client()

    async def users_with_new_panel(_auth):
        users = await original()
        frontend.async_register_built_in_panel(hass, "history", frontend_url_path=path)
        looked_up.append(True)
        return users

    monkeypatch.delattr(frontend, "async_panel_exists", raising=False)
    monkeypatch.setattr(type(hass.auth), "async_get_users", users_with_new_panel)
    response = await client.post(URL + "/recovered", data=body, headers={"Content-Type": "application/zip"})
    assert response.status == 409, await response.text()
    result = await response.json()
    assert looked_up == [True]
    assert result["error"] == "collision" and result["orphans"] == []
    assert path in hass.data[frontend.DATA_PANELS]
    assert not hass.data[DOMAIN].contains(key)
    assert await staged_files(hass, tmp_path) == before


@pytest.mark.parametrize("kind", ["dashboard", "yaml", "replace_dashboards", "replace_yaml"])
async def test_legacy_dashboard_maps_changed_during_user_storage_await_block_all_staging(
    hass, restore_views, hass_client, tmp_path, monkeypatch, kind,
):
    """Use real user storage; replaced maps must not escape captured old maps."""
    model = glb()
    source = layout()
    source["model"] = {"version": hashlib.sha256(model).hexdigest()[:12]}
    body = stored_archive(source, model=model)
    expected = await hass.async_add_executor_job(planner.plan_dashboard_restore, body, "recovered")
    key, path = expected.layouts[0]["target_key"], expected.target_dashboard["url_path"]
    legacy = {"mode": "storage", "dashboards": {}, "resources": None, "yaml_dashboards": {}}
    hass.data[LOVELACE_DATA] = legacy
    before = await staged_files(hass, tmp_path)
    client = await hass_client()
    original = frontend_storage.async_user_store
    loaded = []

    async def user_store_with_changed_maps(actual, user_id):
        result = await original(actual, user_id)
        if not loaded:
            field = "yaml_dashboards" if kind in ("yaml", "replace_yaml") else "dashboards"
            if kind.startswith("replace_"):
                legacy[field] = {path: None}
            else:
                legacy[field][path] = None
            loaded.append(True)
        return result

    monkeypatch.setattr(frontend_storage, "async_user_store", user_store_with_changed_maps)
    response = await client.post(URL + "/recovered", data=body, headers={"Content-Type": "application/zip"})
    assert response.status == 409, await response.text()
    result = await response.json()
    assert loaded == [True] and result["error"] == "collision" and result["orphans"] == []
    assert not hass.data[DOMAIN].contains(key)
    assert await staged_files(hass, tmp_path) == before


@pytest.mark.parametrize("kind", ["inactive", "admin", "token", "removed"])
async def test_legacy_data_user_storage_await_rechecks_current_account_before_staging(
    hass, restore_views, hass_client, hass_admin_user, hass_access_token, tmp_path, monkeypatch, kind,
):
    """Actual version-specific tuple/UserStore loading cannot outlive access."""
    hass.data[LOVELACE_DATA] = {"mode": "storage", "dashboards": {}, "resources": None, "yaml_dashboards": {}}
    body = stored_archive()
    expected = await hass.async_add_executor_job(planner.plan_dashboard_restore, body, "recovered")
    before = await staged_files(hass, tmp_path)
    client = await hass_client()
    original = frontend_storage.async_user_store
    revoked = []

    async def revoked_user_store(actual, user_id):
        result = await original(actual, user_id)
        if not revoked:
            await revoke(hass, hass_admin_user, hass_access_token, kind)
            revoked.append(True)
        return result

    monkeypatch.setattr(frontend_storage, "async_user_store", revoked_user_store)
    response = await client.post(URL + "/recovered", data=body, headers={"Content-Type": "application/zip"})
    assert response.status == 401, await response.text()
    result = await response.json()
    assert revoked == [True] and result["error"] == "auth" and result["orphans"] == []
    assert not hass.data[DOMAIN].contains(expected.layouts[0]["target_key"])
    assert await staged_files(hass, tmp_path) == before


@pytest.mark.parametrize("suffix,error", [
    ("/Upper", "namespace"), ("/new_unsafe", "namespace"),
    ("/new?allow_incomplete=true", "query"), ("/new?allow_incomplete=1&allow_incomplete=0", "query"),
    ("/new?unknown=1", "query"),
])
async def test_malformed_actual_path_query_is_bounded_400_before_plan(hass, restore_views, hass_client, monkeypatch, suffix, error):
    def unexpected(*_args):
        raise AssertionError("Invalid path/query must not validate or stage an archive")
    monkeypatch.setattr(adapter, "plan_and_close", unexpected)
    client = await hass_client()
    response = await client.post(URL + suffix, data=b"invalid", headers={"Content-Type": "application/zip"})
    assert response.status == 400
    result = await response.json()
    assert result["error"] == error and result["staging"] == {"models": [], "layouts": [], "furniture": []}
    assert len(json.dumps(result)) < 2048


@pytest.mark.parametrize("body,content_type,status,error", [
    (b"invalid", "application/zip", 400, "archive_integrity"),
    (b"", "application/zip", 400, "body"),
    (b"invalid", "text/plain", 415, "content_type"),
])
async def test_content_or_bad_zip_never_writes(hass, restore_views, hass_client, tmp_path, body, content_type, status, error):
    before = await staged_files(hass, tmp_path)
    client = await hass_client()
    response = await client.post(URL + "/recovered", data=body, headers={"Content-Type": content_type})
    assert response.status == status, await response.text()
    result = await response.json()
    assert result["error"] == error
    assert await staged_files(hass, tmp_path) == before


async def test_incomplete_missing_layout_is_blocked_even_with_explicit_partial_opt_in(hass, restore_views, hass_client):
    client = await hass_client()
    response = await client.post(URL + "/recovered?allow_incomplete=1", data=stored_archive(missing_layout=True),
                                 headers={"Content-Type": "application/zip"})
    assert response.status == 400
    assert (await response.json())["error"] == "browser_fallback_unverifiable"


@pytest.mark.parametrize("legacy_frontend", [False, True])
async def test_candidate_public_existence_api_accepts_fresh_populated_shared_stage(
    hass, restore_views, hass_client, monkeypatch, legacy_frontend,
):
    if legacy_frontend:
        monkeypatch.delattr(frontend, "async_panel_exists", raising=False)
    assert hass.data[DOMAIN].contains("old")
    assert not hass.data[DOMAIN].contains("missing")
    client = await hass_client()
    response = await client.post(URL + "/recovered", data=stored_archive(), headers={"Content-Type": "application/zip"})
    assert response.status == 200, await response.text()
    result = await response.json()
    assert result["ok"] and result["orphans"] == []
    assert hass.data[DOMAIN].contains(result["staging"]["layouts"][0]["target_key"])


async def test_actual_stream_budget_does_not_trust_content_length_or_change_ha_limit(hass, restore_views, hass_client, monkeypatch):
    maximum = http_server.MAX_CLIENT_SIZE
    monkeypatch.setattr(adapter, "MAX_ARCHIVE_BYTES", 128)
    body = stored_archive()
    async def chunks():
        for offset in range(0, len(body), 17):
            yield body[offset:offset + 17]
    client = await hass_client()
    response = await client.post(URL + "/recovered", data=chunks(), headers={"Content-Type": "application/zip"})
    assert response.status == 413 and (await response.json())["error"] == "body_size"
    assert http_server.MAX_CLIENT_SIZE == maximum == 16 * MiB
    assert hass.http.app._client_max_size == maximum


async def test_large_original_zip_uses_bounded_stream_without_ha_global_read_limit_change(hass, restore_views, hass_client):
    doc, binary = fixture()
    binary += b"\0" * (17 * MiB - len(binary))
    doc["buffers"][0]["byteLength"] = len(binary)
    model = glb(doc, binary)
    source = layout()
    source["model"] = {"version": hashlib.sha256(model).hexdigest()[:12]}
    body = await hass.async_add_executor_job(lambda: stored_archive(source, model=model))
    assert len(body) > http_server.MAX_CLIENT_SIZE
    client = await hass_client()
    response = await client.post(URL + "/large", data=body, headers={"Content-Type": "application/zip"})
    assert response.status == 200, await response.text()
    result = await response.json()
    assert result["staging"]["models"][0]["sha256"] == hashlib.sha256(model).hexdigest()
    assert http_server.MAX_CLIENT_SIZE == hass.http.app._client_max_size == 16 * MiB


@pytest.mark.parametrize("kind", ["inactive", "admin", "token", "removed"])
async def test_real_body_revalidation_rejects_revoked_user_before_planning(
    hass, restore_views, hass_client, hass_admin_user, hass_access_token, monkeypatch, kind,
):
    original = adapter.spool_archive
    seen = False
    async def guarded(hass_arg, content, check):
        count = 0
        async def current():
            nonlocal count, seen
            count += 1
            if count == 2:
                seen = True
                await revoke(hass, hass_admin_user, hass_access_token, kind)
            await check()
        return await original(hass_arg, content, current)
    monkeypatch.setattr(adapter, "spool_archive", guarded)
    client = await hass_client()
    response = await client.post(URL + "/recovered", data=stored_archive(), headers={"Content-Type": "application/zip"})
    assert seen and response.status == 401
    assert (await response.json())["orphans"] == []


@pytest.mark.parametrize("kind", ["inactive", "admin", "token", "removed"])
async def test_real_executor_revocation_returns_new_model_orphan_and_no_shared_write(
    hass, restore_views, hass_client, hass_admin_user, hass_access_token, monkeypatch, kind,
):
    model = glb()
    source = layout()
    source["model"] = {"version": hashlib.sha256(model).hexdigest()[:12]}
    body = stored_archive(source, model=model)
    original, started, release = adapter.stage_model_file, asyncio.Event(), threading.Event()
    def held(*args):
        hass.loop.call_soon_threadsafe(started.set)
        assert release.wait(10), "Native executor test did not release its barrier"
        return original(*args)
    monkeypatch.setattr(adapter, "stage_model_file", held)
    client = await hass_client()
    task = asyncio.create_task(client.post(URL + "/recovered", data=body, headers={"Content-Type": "application/zip"}))
    try:
        await asyncio.wait_for(started.wait(), 10)
        await revoke(hass, hass_admin_user, hass_access_token, kind)
        release.set()
        response = await asyncio.wait_for(task, 10)
        assert response.status == 401, await response.text()
        result = await response.json()
        assert result["staging"]["layouts"] == []
        assert len(result["orphans"]) == 1 and result["orphans"][0]["kind"] == "model"
        key = result["orphans"][0]["target_key"]
        assert hass.data[DOMAIN].get(key) is None
        assert await hass.async_add_executor_job(model_path(hass, key).read_bytes) == model
        data = hass.data[LOVELACE_DATA]
        assert (data["dashboards"] if type(data) is dict else data.dashboards) == {}
    finally:
        await finish_request(task, release)


@pytest.mark.skipif(not SUPERVISOR_AVAILABLE, reason="HA lacks modern Supervisor Unix authentication APIs")
async def test_real_supervisor_removed_during_plan_is_rejected_before_stage(
    hass, restore_views, hass_client_no_auth, hass_supervisor_user, monkeypatch,
):
    hass.data[http_const.DATA_SUPERVISOR_USER] = hass_supervisor_user
    def supervisor_route(request):
        request[http_const.KEY_SUPERVISOR_UNIX_SOCKET] = True
        return True
    monkeypatch.setattr(http_auth, "is_supervisor_unix_socket_request", supervisor_route)
    original, started, release = adapter.plan_and_close, asyncio.Event(), threading.Event()
    def held(*args):
        hass.loop.call_soon_threadsafe(started.set)
        assert release.wait(10)
        return original(*args)
    monkeypatch.setattr(adapter, "plan_and_close", held)
    client = await hass_client_no_auth()
    task = asyncio.create_task(client.post(URL + "/recovered", data=stored_archive(), headers={"Content-Type": "application/zip"}))
    try:
        await asyncio.wait_for(started.wait(), 10)
        await hass.auth.async_remove_user(hass_supervisor_user)
        release.set()
        response = await asyncio.wait_for(task, 10)
        assert response.status == 401 and (await response.json())["orphans"] == []
    finally:
        await finish_request(task, release)
