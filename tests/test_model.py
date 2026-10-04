"""Tests for model upload / download."""

import struct

import aiohttp
import pytest

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.taylors3d.const import DOMAIN

URL = "/api/taylors3d/model/default"


def glb(payload: bytes = b"{}  ") -> bytes:
    """Minimal binary glTF: header + one JSON chunk."""
    body = struct.pack("<II", len(payload), 0x4E4F534A) + payload
    return b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body


def form(data: bytes, name: str = "house.glb", field: str = "file") -> aiohttp.FormData:
    f = aiohttp.FormData()
    f.add_field(field, data, filename=name, content_type="model/gltf-binary")
    return f


@pytest.fixture
async def setup(hass: HomeAssistant, tmp_path) -> None:
    hass.config.config_dir = str(tmp_path)  # uploads must not leak between tests or runs
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, DOMAIN, {DOMAIN: {}})
    await hass.async_block_till_done()


async def test_upload_get_delete(hass: HomeAssistant, setup, hass_client) -> None:
    client = await hass_client()
    assert (await client.get(URL)).status == 404

    data = glb()
    resp = await client.post(URL, data=form(data))
    assert resp.status == 200, await resp.text()
    info = await resp.json()
    assert info["size"] == len(data)
    assert info["name"] == "house.glb"
    assert len(info["version"]) == 12
    assert (await hass.async_add_executor_job(open, hass.config.path("taylors3d/models/default.glb"), "rb")).read() == data

    resp = await client.get(URL)
    assert resp.status == 200
    assert resp.headers["Content-Type"] == "model/gltf-binary"
    assert await resp.read() == data

    # a new upload replaces the old one
    data2 = glb(b'{"a":1}  ')
    info2 = await (await client.post(URL, data=form(data2))).json()
    assert info2["version"] != info["version"]
    assert await (await client.get(URL)).read() == data2

    assert (await client.delete(URL)).status == 200
    assert (await client.get(URL)).status == 404


async def test_rejects_non_glb(hass: HomeAssistant, setup, hass_client) -> None:
    client = await hass_client()
    resp = await client.post(URL, data=form(b"<html>not a model</html>"))
    assert resp.status == 400
    assert "glTF" in (await resp.json())["message"]
    resp = await client.post(URL, data=form(b"glTF" + struct.pack("<II", 1, 12)))  # glTF 1.0
    assert resp.status == 400
    resp = await client.post(URL, data=form(glb(), field="other"))
    assert resp.status == 400


async def test_rejects_too_large(hass: HomeAssistant, setup, hass_client, monkeypatch) -> None:
    monkeypatch.setattr("custom_components.taylors3d.model.MAX_MODEL_BYTES", 1000)
    client = await hass_client()
    resp = await client.post(URL, data=form(glb(b" " * 2000)))
    assert resp.status == 413
    assert (await client.get(URL)).status == 404


async def test_accepts_files_over_ha_request_limit(hass: HomeAssistant, setup, hass_client) -> None:
    client = await hass_client()
    big = glb(b" " * (17 * 1024 * 1024))  # over HA's 16 MB request body limit
    resp = await client.post(URL, data=form(big))
    assert resp.status == 200, await resp.text()
    assert (await resp.json())["size"] == len(big)


async def test_invalid_key(hass: HomeAssistant, setup, hass_client) -> None:
    client = await hass_client()
    assert (await client.get("/api/taylors3d/model/..%2Fsecrets")).status in (400, 404)
    assert (await client.post("/api/taylors3d/model/a.b", data=form(glb()))).status == 400


async def test_requires_login(hass: HomeAssistant, setup, hass_client_no_auth) -> None:
    client = await hass_client_no_auth()
    assert (await client.get(URL)).status == 401
    assert (await client.post(URL, data=form(glb()))).status == 401


async def test_upload_and_delete_require_admin(hass: HomeAssistant, setup, hass_client, hass_admin_user) -> None:
    client = await hass_client()
    assert (await client.post(URL, data=form(glb()))).status == 200
    hass_admin_user.groups = []  # demote the test user
    assert (await client.post(URL, data=form(glb()))).status == 401
    assert (await client.delete(URL)).status == 401
    assert (await client.get(URL)).status == 200  # reading stays allowed
