"""Furniture routes through actual Taylor's 3D integration setup and HA auth.

These tests never call async_register_furniture directly. Real YAML/user config
entry setup must mount the views before requests, and reload must retain the same
library and registered routes. The actual Home Assistant harness is required;
local syntax checks are not middleware/startup verification.
"""

from __future__ import annotations

from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntryState
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component
import pytest

from custom_components.taylors3d.const import DOMAIN
from custom_components.taylors3d.furniture import DATA_FURNITURE, FURNITURE_URL
from .test_furniture_ha import upload
from .test_furniture_pack import bundle, glb

URL = FURNITURE_URL
SHA = "0" * 64
ROUTE_NAMES = {
    "api:taylors3d:furniture", "api:taylors3d:furniture:asset", "api:taylors3d:furniture:pack",
}


async def setup_integration(hass, source="yaml"):
    """Use only HA's actual integration/config entry lifecycle."""
    assert await async_setup_component(hass, "http", {})
    if source == "yaml":
        assert await async_setup_component(hass, DOMAIN, {DOMAIN: {}})
    else:
        form = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": config_entries.SOURCE_USER},
        )
        assert form["type"] is FlowResultType.FORM
        result = await hass.config_entries.flow.async_configure(form["flow_id"], {})
        assert result["type"] is FlowResultType.CREATE_ENTRY
        assert result["title"] == "Taylor's 3D"
    await hass.async_block_till_done()
    entries = hass.config_entries.async_entries(DOMAIN)
    assert len(entries) == 1
    assert entries[0].state is ConfigEntryState.LOADED
    return entries[0]


def furniture_routes(hass):
    """The real router's resources, rather than a register_view call double."""
    return {name: resource for name, resource in hass.http.app.router.named_resources().items()
            if name.startswith("api:taylors3d:furniture")}


@pytest.mark.parametrize("source", ["yaml", "user"])
async def test_setup_mounts_furniture_via_actual_yaml_or_user_entry(hass, hass_client, tmp_path, source):
    hass.config.config_dir = str(tmp_path)
    await setup_integration(hass, source)
    client = await hass_client()
    response = await client.get(URL)
    assert response.status == 200, await response.text()
    assert await response.json() == {"version": 1, "packs": []}
    assert response.headers["Cache-Control"] == "private, no-store"
    assert DATA_FURNITURE in hass.data
    assert set(furniture_routes(hass)) == ROUTE_NAMES
    assert hass.data[DATA_FURNITURE].root == tmp_path / "taylors3d/furniture"
    assert not any("floorplan3d" in name for name in hass.http.app.router.named_resources())
    assert (await client.get("/api/floorplan3d/furniture")).status == 404
    assert (await client.get(f"/api/floorplan3d/furniture/assets/{SHA}.glb")).status == 404


async def test_setup_after_running_http_does_not_freeze_router_before_config_entry(hass, hass_client, tmp_path):
    """A user may add the integration after HA's own HTTP server has started.

    HA owns its dynamic-router workaround. This test does not unfreeze or patch
    aiohttp's router itself, and never registers the furniture views manually.
    """
    hass.config.config_dir = str(tmp_path)
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "frontend", {})
    await hass.async_start()
    await hass.async_block_till_done()
    client = await hass_client()
    assert (await client.get(URL)).status == 404
    assert DATA_FURNITURE not in hass.data
    await setup_integration(hass, "user")
    response = await client.get(URL)
    assert response.status == 200, await response.text()
    assert (await response.json())["packs"] == []
    assert set(furniture_routes(hass)) == ROUTE_NAMES


async def test_entry_reload_preserves_published_library_and_exact_router_resources(hass, hass_client, tmp_path):
    hass.config.config_dir = str(tmp_path)
    entry = await setup_integration(hass)
    client = await hass_client()
    response = await client.post(URL, data=upload(bundle()))
    assert response.status == 200, await response.text()
    original = await response.json()
    library, layout_store, resources = hass.data[DATA_FURNITURE], hass.data[DOMAIN], furniture_routes(hass)
    assert set(resources) == ROUTE_NAMES
    for _ in range(2):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert entry.state is ConfigEntryState.LOADED
        assert hass.data[DATA_FURNITURE] is library
        assert hass.data[DOMAIN] is layout_store
        current = furniture_routes(hass)
        assert set(current) == ROUTE_NAMES
        assert all(current[name] is resource for name, resource in resources.items())
        response = await client.get(URL)
        assert response.status == 200
        assert (await response.json())["packs"] == [original["pack"]]
        response = await client.get(original["pack"]["items"][0]["asset_url"])
        assert response.status == 200
        assert await response.read() == glb()
    response = await client.post(URL, data=upload(bundle()))
    assert response.status == 200
    assert (await response.json())["imported"] is False


@pytest.mark.parametrize("path", [URL, f"{URL}/assets/{SHA}.glb", f"{URL}/packs/{SHA}.zip"])
async def test_actual_setup_routes_keep_real_anonymous_auth_boundary(hass, hass_client_no_auth, tmp_path, path):
    hass.config.config_dir = str(tmp_path)
    await setup_integration(hass)
    client = await hass_client_no_auth()
    assert (await client.get(path)).status == 401
    assert (await client.post(URL, data=upload(bundle()))).status == 401
    library = hass.data[DATA_FURNITURE]
    assert await hass.async_add_executor_job(library.catalogue) == {"version": 1, "packs": []}


async def test_actual_setup_admin_import_nonadmin_read_and_independent_house_layout(
    hass, hass_client, hass_ws_client, hass_admin_user, tmp_path,
):
    hass.config.config_dir = str(tmp_path)
    await setup_integration(hass)
    ws = await hass_ws_client(hass)
    layout = {"version": 1, "rooms": [], "pins": {}, "label": "Independent original house layout"}
    await ws.send_json_auto_id({"type": "taylors3d/layout/set", "key": "house", "layout": layout})
    assert (await ws.receive_json())["success"]
    store = hass.data[DOMAIN]
    client = await hass_client()
    raw = bundle()
    response = await client.post(URL, data=upload(raw))
    assert response.status == 200, await response.text()
    result = await response.json()
    assert result["imported"] is True
    pack, item = result["pack"], result["pack"]["items"][0]
    assert item["asset_url"] == f"{URL}/assets/{item['sha256']}.glb"
    assert pack["download_url"] == f"{URL}/packs/{pack['pack_id']}.zip"
    assert hass.data[DOMAIN] is store
    assert store.get("house") == layout
    assert not await hass.async_add_executor_job((tmp_path / "taylors3d/models").exists)

    await hass.auth.async_update_user(hass_admin_user, group_ids=[])
    assert (await client.post(URL, data=upload(raw))).status == 401
    response = await client.get(URL)
    assert response.status == 200
    assert (await response.json())["packs"] == [pack]
    for path, expected, mime in [(item["asset_url"], glb(), "model/gltf-binary"), (pack["download_url"], raw, "application/zip")]:
        response = await client.get(path)
        assert response.status == 200
        assert response.headers["Content-Type"] == mime
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert await response.read() == expected
    await ws.send_json_auto_id({"type": "taylors3d/layout/get", "key": "house"})
    assert (await ws.receive_json())["result"] == {"layout": layout}

