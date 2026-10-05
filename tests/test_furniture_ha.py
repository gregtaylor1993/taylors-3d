"""Future furniture HTTP tests using the actual Home Assistant harness.

Run with the declared pytest-homeassistant-custom-component dependency:
    python -m pytest -q tests/test_furniture_ha.py

These tests register the future views directly; integration __init__ wiring is
deliberately outside this foundation. They use real HA auth middleware, users,
tokens, aiohttp multipart readers and executor-backed storage, not view doubles.
The Windows drafting environment has no HA harness; syntax checks alone must
never be reported as passing these middleware tests.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import threading
from unittest.mock import AsyncMock, Mock

import aiohttp
from aiohttp.multipart import BodyPartReader
import pytest

from homeassistant.components.http import auth as http_auth
from homeassistant.components.http import const as http_const
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.taylors3d import furniture
from .test_furniture_pack import bundle, glb

URL = furniture.FURNITURE_URL
ABSENT_SHA = "0" * 64
SUPERVISOR_SOCKET_AUTH_AVAILABLE = (
    hasattr(http_const, "DATA_SUPERVISOR_USER")
    and hasattr(http_const, "KEY_SUPERVISOR_UNIX_SOCKET")
    and hasattr(http_auth, "is_supervisor_unix_socket_request")
)


def upload(data: bytes, *, field: str = "file", extra: bool = False) -> aiohttp.FormData:
    """A genuine multipart ZIP body, with no fake Content-Length assumption."""
    form = aiohttp.FormData()
    form.add_field(field, data, filename="local-pack.zip", content_type="application/zip")
    if extra:
        form.add_field("other", "not a second allowed field")
    return form


@pytest.fixture
async def furniture_library(hass: HomeAssistant, tmp_path):
    """Register real views before hass_client freezes its actual HTTP router."""
    hass.config.config_dir = str(tmp_path)
    assert await async_setup_component(hass, "http", {})
    library = await furniture.async_register_furniture(hass)
    await hass.async_block_till_done()
    return library


async def catalogue(hass: HomeAssistant, library) -> dict:
    return await hass.async_add_executor_job(library.catalogue)


async def stored_files(hass: HomeAssistant, library) -> dict[str, bytes]:
    def read():
        return {str(path.relative_to(library.root)): path.read_bytes()
                for path in library.root.rglob("*") if path.is_file()}
    return await hass.async_add_executor_job(read)


async def revoke(hass: HomeAssistant, user, token: str, kind: str) -> None:
    """Change the real HA account/token on the event-loop thread."""
    if kind == "inactive":
        await hass.auth.async_deactivate_user(user)
    elif kind == "admin":
        await hass.auth.async_update_user(user, group_ids=[])
    else:
        refresh_token = hass.auth.async_validate_access_token(token)
        assert refresh_token is not None
        hass.auth.async_remove_refresh_token(refresh_token)


async def test_furniture_registers_once_without_touching_house_storage(hass, furniture_library, hass_client, tmp_path):
    library = furniture_library
    assert await furniture.async_register_furniture(hass) is library
    client = await hass_client()
    response = await client.get(URL)
    assert response.status == 200
    assert (await response.json())["packs"] == []
    assert response.headers["Cache-Control"] == "private, no-store"
    assert await stored_files(hass, library) == {}
    assert not await hass.async_add_executor_job(Path(tmp_path / "taylors3d/models").exists)


async def test_furniture_real_auth_middleware_rejects_all_anonymous_routes(
    hass, furniture_library, hass_client_no_auth, monkeypatch,
):
    client = await hass_client_no_auth()
    read_upload = AsyncMock(wraps=furniture.read_furniture_upload)
    monkeypatch.setattr(furniture, "read_furniture_upload", read_upload)
    for path in (URL, f"{URL}/assets/{ABSENT_SHA}.glb", f"{URL}/packs/{ABSENT_SHA}.zip"):
        assert (await client.get(path)).status == 401
    assert (await client.post(URL, data=upload(bundle()))).status == 401
    read_upload.assert_not_awaited()
    assert await stored_files(hass, furniture_library) == {}


async def test_furniture_admin_import_verified_bytes_and_nonadmin_reads(
    hass, furniture_library, hass_client, hass_admin_user, monkeypatch,
):
    client = await hass_client()
    raw = bundle()
    response = await client.post(URL, data=upload(raw))
    assert response.status == 200, await response.text()
    result = await response.json()
    assert result["imported"] is True
    pack = result["pack"]
    item = pack["items"][0]
    assert item["license"]["text"] == pack["license"]["text"]

    # The actual admin group controls require_admin; reading stays authenticated.
    await hass.auth.async_update_user(hass_admin_user, group_ids=[])
    read_upload = AsyncMock(wraps=furniture.read_furniture_upload)
    monkeypatch.setattr(furniture, "read_furniture_upload", read_upload)
    assert (await client.post(URL, data=upload(raw))).status == 401
    read_upload.assert_not_awaited()
    response = await client.get(URL)
    assert response.status == 200
    assert (await response.json())["packs"] == [pack]
    response = await client.get(item["asset_url"])
    assert response.status == 200
    assert response.headers["Content-Type"] == "model/gltf-binary"
    assert response.headers["Cache-Control"].startswith("private,")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert await response.read() == glb()
    response = await client.get(pack["download_url"])
    assert response.status == 200
    assert response.headers["Content-Type"] == "application/zip"
    assert response.headers["Content-Disposition"] == f'attachment; filename="{pack["pack_id"]}.zip"'
    assert response.headers["Cache-Control"].startswith("private,")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert await response.read() == raw


@pytest.mark.parametrize("kind", ["inactive", "admin", "token"])
async def test_furniture_revoked_current_account_during_real_multipart_cannot_validate_or_publish(
    hass, furniture_library, hass_client, hass_admin_user, hass_access_token, monkeypatch, kind,
):
    client = await hass_client()
    original_read = BodyPartReader.read_chunk
    observed = False

    async def read_then_revoke(reader, *args, **kwargs):
        nonlocal observed
        chunk = await original_read(reader, *args, **kwargs)
        if chunk and reader.name == "file" and not observed:
            observed = True
            await revoke(hass, hass_admin_user, hass_access_token, kind)
        return chunk

    validate = Mock(wraps=furniture.validate_furniture_pack)
    monkeypatch.setattr(BodyPartReader, "read_chunk", read_then_revoke)
    monkeypatch.setattr(furniture, "validate_furniture_pack", validate)
    response = await client.post(URL, data=upload(bundle()))
    assert observed
    assert response.status == 401
    validate.assert_not_called()
    assert (await catalogue(hass, furniture_library))["packs"] == []
    assert await stored_files(hass, furniture_library) == {}


@pytest.mark.parametrize("kind", ["inactive", "admin", "token"])
async def test_furniture_revocation_while_real_executor_validates_cannot_stage_files(
    hass, furniture_library, hass_client, hass_admin_user, hass_access_token, monkeypatch, kind,
):
    client = await hass_client()
    original_validate = furniture.validate_furniture_pack
    started = asyncio.Event()
    release = threading.Event()

    def held_validate(data):
        hass.loop.call_soon_threadsafe(started.set)
        if not release.wait(10):
            raise AssertionError("Validation test barrier was not released")
        return original_validate(data)

    monkeypatch.setattr(furniture, "validate_furniture_pack", held_validate)
    request = asyncio.create_task(client.post(URL, data=upload(bundle())))
    try:
        await asyncio.wait_for(started.wait(), 10)
        await revoke(hass, hass_admin_user, hass_access_token, kind)
        release.set()
        response = await asyncio.wait_for(request, 10)
        assert response.status == 401
        assert (await catalogue(hass, furniture_library))["packs"] == []
        assert await stored_files(hass, furniture_library) == {}
    finally:
        release.set()
        if not request.done():
            request.cancel()
            await asyncio.gather(request, return_exceptions=True)


@pytest.mark.skipif(
    not SUPERVISOR_SOCKET_AUTH_AVAILABLE,
    reason="Installed Home Assistant has no Supervisor Unix socket authentication API",
)
@pytest.mark.parametrize("stage", ["multipart", "validation"])
async def test_furniture_tokenless_supervisor_user_removed_during_upload_cannot_publish(
    hass, furniture_library, hass_client_no_auth, hass_supervisor_user, monkeypatch, stage,
):
    """Real HA auth-store revocation, with only Unix socket routing simulated.

    This deliberately does not claim a real Supervisor Unix transport test.
    The actual auth middleware resolves the current Supervisor user, then the
    actual multipart reader/executor pauses while HA removes that account.
    """
    hass.data[http_const.DATA_SUPERVISOR_USER] = hass_supervisor_user

    def supervisor_route(request):
        request[http_const.KEY_SUPERVISOR_UNIX_SOCKET] = True
        return True

    monkeypatch.setattr(http_auth, "is_supervisor_unix_socket_request", supervisor_route)
    client = await hass_client_no_auth()
    original_validate = furniture.validate_furniture_pack
    validate = Mock(wraps=original_validate)
    monkeypatch.setattr(furniture, "validate_furniture_pack", validate)
    if stage == "multipart":
        original_read = BodyPartReader.read_chunk
        observed = False

        async def read_then_remove(reader, *args, **kwargs):
            nonlocal observed
            chunk = await original_read(reader, *args, **kwargs)
            if chunk and reader.name == "file" and not observed:
                observed = True
                await hass.auth.async_remove_user(hass_supervisor_user)
            return chunk

        monkeypatch.setattr(BodyPartReader, "read_chunk", read_then_remove)
        response = await client.post(URL, data=upload(bundle()))
        assert observed
        validate.assert_not_called()
    else:
        started = asyncio.Event()
        release = threading.Event()

        def held_validate(data):
            hass.loop.call_soon_threadsafe(started.set)
            if not release.wait(10):
                raise AssertionError("Supervisor validation test barrier was not released")
            return original_validate(data)

        monkeypatch.setattr(furniture, "validate_furniture_pack", held_validate)
        request = asyncio.create_task(client.post(URL, data=upload(bundle())))
        try:
            await asyncio.wait_for(started.wait(), 10)
            await hass.auth.async_remove_user(hass_supervisor_user)
            release.set()
            response = await asyncio.wait_for(request, 10)
        finally:
            release.set()
            if not request.done():
                request.cancel()
                await asyncio.gather(request, return_exceptions=True)
    assert await hass.auth.async_get_user(hass_supervisor_user.id) is None
    assert response.status == 401
    assert (await catalogue(hass, furniture_library))["packs"] == []
    assert await stored_files(hass, furniture_library) == {}


async def test_furniture_revoked_token_cannot_fetch_already_published_assets(hass, furniture_library, hass_client, hass_access_token):
    client = await hass_client()
    response = await client.post(URL, data=upload(bundle()))
    assert response.status == 200
    pack = (await response.json())["pack"]
    token = hass.auth.async_validate_access_token(hass_access_token)
    assert token is not None
    hass.auth.async_remove_refresh_token(token)
    for path in (URL, pack["items"][0]["asset_url"], pack["download_url"]):
        assert (await client.get(path)).status == 401
    assert len((await catalogue(hass, furniture_library))["packs"]) == 1


@pytest.mark.parametrize("field,extra", [("wrong", False), ("file", True)])
async def test_furniture_rejects_wrong_or_extra_real_multipart_fields(hass, furniture_library, hass_client, field, extra):
    client = await hass_client()
    response = await client.post(URL, data=upload(bundle(), field=field, extra=extra))
    assert response.status == 400
    assert (await catalogue(hass, furniture_library))["packs"] == []
    assert await stored_files(hass, furniture_library) == {}


async def test_furniture_size_limit_reads_actual_multipart_bytes(hass, furniture_library, hass_client, monkeypatch):
    client = await hass_client()
    original_read = furniture.read_furniture_upload

    async def bounded_read(field):
        return await original_read(field, maximum=64)

    monkeypatch.setattr(furniture, "read_furniture_upload", bounded_read)
    response = await client.post(URL, data=upload(bundle()))
    assert response.status == 413
    assert (await response.json())["error"] == "archive_size"
    assert await stored_files(hass, furniture_library) == {}


async def test_furniture_corrupt_asset_returns_conflict_and_reimport_keeps_catalogue(hass, furniture_library, hass_client):
    client = await hass_client()
    raw = bundle()
    response = await client.post(URL, data=upload(raw))
    assert response.status == 200
    pack = (await response.json())["pack"]
    item = pack["items"][0]
    asset = furniture_library.root / "assets" / f"{item['sha256']}.glb"
    await hass.async_add_executor_job(asset.write_bytes, b"damaged synthetic asset")
    response = await client.get(item["asset_url"])
    assert response.status == 409
    assert (await response.json())["error"] == "corrupt_storage"
    response = await client.post(URL, data=upload(raw))
    assert response.status == 409
    assert (await catalogue(hass, furniture_library))["packs"] == [pack]
    assert await hass.async_add_executor_job(asset.read_bytes) == b"damaged synthetic asset"
