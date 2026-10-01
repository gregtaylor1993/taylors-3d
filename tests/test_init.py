"""Tests for the floorplan3d integration."""

from pathlib import Path

import pytest

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.floorplan3d.const import DOMAIN, STORAGE_KEY

LAYOUT = {"version": 1, "rooms": [{"id": "r1", "area_id": "kitchen", "polygon": [[0, 0], [4, 0], [4, 3]]}]}


async def _setup(hass: HomeAssistant) -> None:
    """Set up through YAML, which imports a config entry."""
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, DOMAIN, {DOMAIN: {}})
    await hass.async_block_till_done()
    assert len(hass.config_entries.async_entries(DOMAIN)) == 1


async def test_get_unknown_key_returns_null(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "floorplan3d/layout/get", "key": "default"})
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"] == {"layout": None}


async def test_set_then_get_and_persist(hass: HomeAssistant, hass_ws_client, hass_storage, freezer) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "floorplan3d/layout/set", "key": "default", "layout": LAYOUT})
    assert (await client.receive_json())["success"]

    await client.send_json_auto_id({"type": "floorplan3d/layout/get", "key": "default"})
    assert (await client.receive_json())["result"] == {"layout": LAYOUT}

    await client.send_json_auto_id({"type": "floorplan3d/layout/get", "key": "other"})
    assert (await client.receive_json())["result"] == {"layout": None}

    # delayed save reaches .storage
    from datetime import timedelta
    from pytest_homeassistant_custom_component.common import async_fire_time_changed
    freezer.tick(timedelta(seconds=5))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert hass_storage[STORAGE_KEY]["data"] == {"layouts": {"default": LAYOUT}}


async def test_loads_existing_storage(hass: HomeAssistant, hass_ws_client, hass_storage) -> None:
    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY, "data": {"layouts": {"k": LAYOUT}}}
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "floorplan3d/layout/get", "key": "k"})
    assert (await client.receive_json())["result"] == {"layout": LAYOUT}


async def test_set_requires_admin(hass: HomeAssistant, hass_ws_client, hass_read_only_access_token) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json_auto_id({"type": "floorplan3d/layout/set", "key": "default", "layout": LAYOUT})
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "unauthorized"
    # non-admins can still read
    await client.send_json_auto_id({"type": "floorplan3d/layout/get", "key": "default"})
    assert (await client.receive_json())["success"]


@pytest.mark.parametrize("bad", [{"key": "", "layout": {}}, {"key": "k", "layout": []}, {"key": "x" * 65, "layout": {}}])
async def test_set_validates(hass: HomeAssistant, hass_ws_client, bad) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "floorplan3d/layout/set", **bad})
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "invalid_format"


async def test_set_rejects_huge_layout(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "floorplan3d/layout/set", "key": "k", "layout": {"x": "a" * 2_100_000}})
    msg = await client.receive_json()
    assert msg["error"]["code"] == "too_large"


async def test_serves_bundled_card(hass: HomeAssistant, hass_client) -> None:
    card = Path(__file__).parent.parent / "custom_components" / DOMAIN / "frontend" / "floorplan3d-card.js"
    created = not card.exists()
    if created:
        card.parent.mkdir(exist_ok=True)
        card.write_text("console.log('card');")
    try:
        await _setup(hass)
        urls = hass.data["frontend_extra_module_url"].urls
        url = next(u for u in urls if "floorplan3d-card.js" in u)
        client = await hass_client()
        resp = await client.get(url.split("?")[0])
        assert resp.status == 200
        assert "javascript" in resp.headers["Content-Type"]
    finally:
        if created:
            card.unlink()
