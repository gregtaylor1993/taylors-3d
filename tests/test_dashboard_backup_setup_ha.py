"""ISOLATED F04 candidate through actual integration setup/HA router/public APIs.

Never call backup/restore registrars directly and never unfreeze the router.
These tests are prepared for the real HA harness; local syntax/source-method
checks cannot be reported as startup/auth/middleware success. Staging prepares
new Taylor assets/layouts only; no test publishes a restored HA dashboard.
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

import aiohttp
import pytest
from pytest_homeassistant_custom_component.common import async_fire_time_changed
from homeassistant.config_entries import ConfigEntryState
from homeassistant.components import frontend
from homeassistant.components.lovelace.const import DOMAIN as LOVELACE_DATA
from homeassistant.setup import async_setup_component

from custom_components.taylors3d import LayoutStore
from custom_components.taylors3d.const import CARD_FILENAME, CARD_URL_BASE, DOMAIN, STORAGE_KEY
from custom_components.taylors3d import dashboard_backup as core
from custom_components.taylors3d import dashboard_backup_http as backup
from custom_components.taylors3d import dashboard_restore as planner
from custom_components.taylors3d import dashboard_restore_http as restore
from custom_components.taylors3d.furniture import DATA_FURNITURE, FURNITURE_URL
from custom_components.taylors3d.model import model_path
from .test_furniture_setup_ha import setup_integration
from .test_furniture_ha import upload
from .test_furniture_pack import bundle, glb

URL = backup.URL
ROUTES = {URL + "/export", URL + "/inspect", URL + "/stage/{namespace}"}


def raw_dashboard():
    return {"title": "Exact complete source", "views": [{"title": "Main", "sections": [{"type": "grid", "cards": [
        {"type": "conditional", "conditions": [{"entity": "sensor.deleted", "state": "on"}],
         "card": {"type": "custom:taylors3d-card", "layout_key": "old", "unknown": {"keep": [False, 7]}}},
        {"type": "entities", "entities": ["light.original", "sensor.deleted"], "unknown": {"native": [None]}},
    ]}]}], "unknown": {"preserve": "🏠"}}


def raw_layout():
    return {"version": 1, "rooms": [], "floors": [{"id": "deleted-original-floor"}],
            "pins": {"entity:light.deleted": {"floor_id": "deleted-original-floor", "x": 1.2, "y": -4}},
            "unknown": {"preserve": [None, False, {"exact": "text"}]}}


def simple_archive(layout=None):
    value = core.prepare_dashboard_backup(raw_dashboard(),
        source={"url_path": "source-dashboard", "mode": "storage", "metadata": {}},
        resources={"mode": "storage", "items": []},
        layouts={"old": {"backend": "shared", "layout": raw_layout() if layout is None else layout}})
    target = io.BytesIO()
    core.create_dashboard_backup(value, target)
    return target.getvalue()


def actual_routes(hass):
    rows = [resource for resource in hass.http.app.router.resources() if resource.canonical.startswith(URL)]
    assert len(rows) == 3, "No duplicate or unexpected backup/staging resources"
    result = {resource.canonical: resource for resource in rows}
    assert set(result) == ROUTES
    return result


async def initialise(hass, tmp_path, source="yaml"):
    hass.config.config_dir = str(tmp_path)
    entry = await setup_integration(hass, source)
    assert await async_setup_component(hass, "lovelace", {})
    await hass.async_block_till_done()
    return entry


async def seed_source(hass, hass_ws_client):
    """Current HA source fixture uses only real public dashboard/WS APIs."""
    dashboard, layout = raw_dashboard(), raw_layout()
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "taylors3d/layout/set", "key": "old", "layout": layout})
    assert (await client.receive_json())["success"]
    data = hass.data[LOVELACE_DATA]
    dashboards = data["dashboards"] if type(data) is dict else data.dashboards
    default = dashboards.get("lovelace") or dashboards.get(None)
    assert default is not None
    await default.async_save(dashboard)
    return dashboard, layout, default


def export_payload(dashboard, *, original_text=False):
    member = {"dashboard_json": json.dumps(dashboard, ensure_ascii=False, indent=3) + "\n"} if original_text else {"dashboard": dashboard}
    return {**member, "source": {"url_path": None, "mode": "storage", "metadata": {"captured": "exact test source"}},
        "resources": {"mode": "storage", "items": [{"url": CARD_URL_BASE + "/" + CARD_FILENAME, "type": "module"}]},
        "shared_keys": ["old"], "layouts": {}, "producer_version": "self-owned test fixture"}


async def owned_files(hass, tmp_path):
    return await hass.async_add_executor_job(lambda: {
        str(path.relative_to(tmp_path)): path.read_bytes()
        for path in Path(tmp_path).rglob("*") if path.is_file() and path.is_relative_to(Path(tmp_path) / "taylors3d")
    })


@pytest.mark.parametrize("source", ["yaml", "user"])
async def test_actual_yaml_or_user_setup_mounts_exact_owned_routes(hass, hass_client, tmp_path, source):
    entry = await initialise(hass, tmp_path, source)
    assert entry.state is ConfigEntryState.LOADED
    assert callable(hass.data[DOMAIN].contains)
    assert backup.DATA_BACKUP_HTTP in hass.data and restore.DATA_RESTORE_HTTP in hass.data
    actual_routes(hass)
    assert not any(resource.canonical.startswith("/api/unrelated_integration") for resource in hass.http.app.router.resources())
    client = await hass_client()
    assert (await client.post("/api/unrelated_integration/dashboard_backup/export", json={})).status == 404
    assert (await client.post("/api/taylors3d/dashboard_backup/publish/new", json={})).status == 404


async def test_real_running_http_accepts_later_config_entry_without_router_patch(hass, hass_client, tmp_path):
    hass.config.config_dir = str(tmp_path)
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "frontend", {})
    await hass.async_start()
    await hass.async_block_till_done()
    client = await hass_client()
    assert (await client.post(URL + "/export", json={})).status == 404
    await initialise(hass, tmp_path, "user")
    actual_routes(hass)
    response = await client.post(URL + "/stage/new", data=b"not a ZIP", headers={"Content-Type": "application/zip"})
    assert response.status == 400 and (await response.json())["error"] == "archive_integrity"


async def test_reload_retains_same_store_library_and_route_objects(hass, hass_client, hass_ws_client, tmp_path):
    entry = await initialise(hass, tmp_path)
    dashboard, _layout, _default = await seed_source(hass, hass_ws_client)
    client = await hass_client()
    routes = actual_routes(hass)
    store, library = hass.data[DOMAIN], hass.data[DATA_FURNITURE]
    backup_owner, restore_owner = hass.data[backup.DATA_BACKUP_HTTP], hass.data[restore.DATA_RESTORE_HTTP]
    for _ in range(2):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert entry.state is ConfigEntryState.LOADED
        assert hass.data[DOMAIN] is store and hass.data[DATA_FURNITURE] is library
        assert hass.data[backup.DATA_BACKUP_HTTP] is backup_owner and hass.data[restore.DATA_RESTORE_HTTP] is restore_owner
        assert all(actual_routes(hass)[key] is value for key, value in routes.items())
        response = await client.post(URL + "/export", json=export_payload(dashboard))
        assert response.status == 200, await response.text()
        assert response.headers["X-Taylors3D-Complete"] == "true"


async def test_public_contains_loads_existing_null_without_guessing_absence(hass, hass_storage, tmp_path):
    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY,
        "data": {"layouts": {"old-null": None, "normal": raw_layout()}}}
    await initialise(hass, tmp_path)
    store = hass.data[DOMAIN]
    assert store.get("old-null") is None and store.get("absent") is None
    assert store.contains("old-null") is True and store.contains("absent") is False
    assert store.contains("normal") is True and store.get("normal") == raw_layout()
    again = LayoutStore(hass)
    await again.async_load()
    assert again.contains("old-null") and not again.contains("absent")


@pytest.mark.parametrize("route", ["export", "inspect", "stage/new"])
async def test_integration_routes_keep_actual_anonymous_boundary(hass, hass_client_no_auth, tmp_path, route):
    await initialise(hass, tmp_path)
    client = await hass_client_no_auth()
    kwargs = {"json": {}} if route == "export" else {"data": simple_archive(), "headers": {"Content-Type": "application/zip"}}
    assert (await client.post(URL + "/" + route, **kwargs)).status == 401


async def test_nonadmin_may_export_but_must_not_inspect_or_stage(
    hass, hass_client, hass_ws_client, hass_admin_user, tmp_path,
):
    await initialise(hass, tmp_path)
    dashboard, source, _default = await seed_source(hass, hass_ws_client)
    await hass.auth.async_update_user(hass_admin_user, group_ids=[])
    client = await hass_client()
    response = await client.post(URL + "/export", json=export_payload(dashboard))
    assert response.status == 200, await response.text()
    body = await response.read()
    assert (await client.post(URL + "/inspect", data=body, headers={"Content-Type": "application/zip"})).status == 401
    assert (await client.post(URL + "/stage/new", data=body, headers={"Content-Type": "application/zip"})).status == 401
    assert hass.data[DOMAIN].get("old") == source


async def test_real_export_inspect_stage_preserves_full_raw_dashboard_model_licensed_pack(
    hass, hass_client, hass_ws_client, hass_storage, tmp_path, freezer,
):
    await initialise(hass, tmp_path)
    dashboard, source, default = await seed_source(hass, hass_ws_client)
    client = await hass_client()
    original_model, original_pack = glb(), bundle()
    form = aiohttp.FormData()
    form.add_field("file", original_model, filename="owned-house.glb", content_type="model/gltf-binary")
    response = await client.post("/api/taylors3d/model/old", data=form)
    assert response.status == 200, await response.text()
    model_meta = await response.json()
    response = await client.post(FURNITURE_URL, data=upload(original_pack))
    assert response.status == 200, await response.text()
    pack = (await response.json())["pack"]
    source["model"] = model_meta
    source["furniture"] = {"version": 1, "instances": [{"id": "exact", "pack_id": pack["pack_id"], "item_id": pack["items"][0]["id"],
        "asset_sha256": pack["items"][0]["sha256"], "floor_id": "deleted-original-floor", "unknown": {"retain": True}}]}
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "taylors3d/layout/set", "key": "old", "layout": source})
    assert (await ws.receive_json())["success"]
    source_before = copy.deepcopy(source)
    files_before = await owned_files(hass, tmp_path)
    payload = export_payload(dashboard, original_text=True)
    response = await client.post(URL + "/export", json=payload)
    assert response.status == 200, await response.text()
    assert response.headers["Content-Type"] == "application/zip"
    assert response.headers["Content-Disposition"] == 'attachment; filename="taylors3d-dashboard-backup.zip"'
    assert response.headers["X-Taylors3D-Complete"] == "true"
    body = await response.read()
    verified = await hass.async_add_executor_job(core.validate_dashboard_backup, body)
    assert verified.complete and verified.members["dashboard.json"] == payload["dashboard_json"].encode("utf-8")
    assert verified.members[verified.manifest["models"][0]["file"]["path"]] == original_model
    assert verified.members[verified.manifest["furniture"][0]["file"]["path"]] == original_pack
    response = await client.post(URL + "/inspect", data=body, headers={"Content-Type": "application/zip"})
    assert response.status == 200, await response.text()
    inspected = await response.json()
    assert inspected["report"]["complete"] and inspected["report"]["dependencyFree"]
    assert inspected["preview"]["dashboard"] == dashboard and inspected["restoreAvailable"] is False
    data = hass.data[LOVELACE_DATA]
    dashboards = data["dashboards"] if type(data) is dict else data.dashboards
    resources = data["resources"] if type(data) is dict else data.resources
    dashboards_before, resources_before = dashboards.copy(), copy.deepcopy(resources.async_items())
    response = await client.post(URL + "/stage/recovered", data=body, headers={"Content-Type": "application/zip"})
    assert response.status == 200, await response.text()
    result = await response.json()
    target = result["target_dashboard"]["url_path"]
    key = result["staging"]["layouts"][0]["target_key"]
    assert result["ok"] and result["report"]["publication_available"] is False
    assert result["staging"]["layouts_persistence"] == "scheduled_not_durable"
    assert result["staging"]["dashboard_created"] is False and result["staging"]["resources_installed"] is False
    assert dashboards == dashboards_before and resources.async_items() == resources_before
    assert target not in hass.data.get(frontend.DATA_PANELS, {})
    assert await default.async_load(True) == dashboard
    expected_dashboard = copy.deepcopy(dashboard)
    expected_dashboard["views"][0]["sections"][0]["cards"][0]["card"]["layout_key"] = key
    assert result["save_message"]["config"] == expected_dashboard
    assert hass.data[DOMAIN].get("old") == source_before and hass.data[DOMAIN].get(key) == source_before
    assert hass.data[DOMAIN].contains(key)
    assert await hass.async_add_executor_job(model_path(hass, key).read_bytes) == original_model
    assert await hass.async_add_executor_job(hass.data[DATA_FURNITURE].archive, pack["pack_id"]) == original_pack
    assert result["staging"]["furniture"][0]["imported"] is False
    files_after = await owned_files(hass, tmp_path)
    assert all(files_after[path] == value for path, value in files_before.items())
    freezer.tick(timedelta(seconds=5))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert hass_storage[STORAGE_KEY]["data"]["layouts"][key] == source_before


async def test_persisted_null_collision_through_setup_never_overwrites(hass, hass_storage, hass_client, tmp_path):
    body = simple_archive()
    planned = await hass.async_add_executor_job(planner.plan_dashboard_restore, body, "recovered")
    key = planned.layouts[0]["target_key"]
    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY,
        "data": {"layouts": {key: None, "old": raw_layout()}}}
    await initialise(hass, tmp_path)
    before = await owned_files(hass, tmp_path)
    client = await hass_client()
    response = await client.post(URL + "/stage/recovered", data=body, headers={"Content-Type": "application/zip"})
    assert response.status == 409, await response.text()
    result = await response.json()
    assert result["error"] == "collision" and result["orphans"] == []
    assert hass.data[DOMAIN].contains(key) and hass.data[DOMAIN].get(key) is None
    assert hass_storage[STORAGE_KEY]["data"]["layouts"][key] is None
    assert await owned_files(hass, tmp_path) == before


@pytest.mark.parametrize("kind", ["inactive", "admin", "token", "removed"])
async def test_actual_setup_rechecks_current_account_during_model_stage(
    hass, hass_client, hass_admin_user, hass_access_token, tmp_path, monkeypatch, kind,
):
    await initialise(hass, tmp_path)
    model, source = glb(), raw_layout()
    source["model"] = {"version": hashlib.sha256(model).hexdigest()[:12]}
    prepared = core.prepare_dashboard_backup(raw_dashboard(), source={"url_path": "source-dashboard", "mode": "storage", "metadata": {}},
        resources={"mode": "storage", "items": []}, layouts={"old": {"backend": "shared", "layout": source}}, models={"old": model})
    output = io.BytesIO()
    core.create_dashboard_backup(prepared, output)
    original, started, release = restore.stage_model_file, asyncio.Event(), threading.Event()
    def held(*args):
        hass.loop.call_soon_threadsafe(started.set)
        assert release.wait(10)
        return original(*args)
    monkeypatch.setattr(restore, "stage_model_file", held)
    client = await hass_client()
    task = asyncio.create_task(client.post(URL + "/stage/recovered", data=output.getvalue(), headers={"Content-Type": "application/zip"}))
    try:
        await asyncio.wait_for(started.wait(), 10)
        if kind == "inactive":
            await hass.auth.async_deactivate_user(hass_admin_user)
        elif kind == "admin":
            await hass.auth.async_update_user(hass_admin_user, group_ids=[])
        elif kind == "removed":
            await hass.auth.async_remove_user(hass_admin_user)
        else:
            token = hass.auth.async_validate_access_token(hass_access_token)
            assert token is not None
            hass.auth.async_remove_refresh_token(token)
        release.set()
        response = await asyncio.wait_for(task, 10)
        assert response.status == 401, await response.text()
        result = await response.json()
        assert result["staging"]["layouts"] == [] and len(result["orphans"]) == 1
        orphan = result["orphans"][0]
        assert orphan["kind"] == "model" and not hass.data[DOMAIN].contains(orphan["target_key"])
        assert await hass.async_add_executor_job(model_path(hass, orphan["target_key"]).read_bytes) == model
        assert "taylors3d-restore-recovered" not in hass.data.get(frontend.DATA_PANELS, {})
    finally:
        release.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
