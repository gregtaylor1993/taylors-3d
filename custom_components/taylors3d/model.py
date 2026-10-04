"""Upload and serve the house model (.glb) per layout key.

Files live in <config>/taylors3d/models/<key>.glb, outside /config/www, so they are only
served to logged-in users. Upload and delete are admin only.
"""

from __future__ import annotations

import hashlib
import os
import re
from http import HTTPStatus
from pathlib import Path

from aiohttp import web

from homeassistant.components.http import HomeAssistantView, require_admin
from homeassistant.core import HomeAssistant

from .const import MAX_MODEL_BYTES, MODEL_DIR, MODEL_URL

KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
CHUNK = 64 * 1024


def model_path(hass: HomeAssistant, key: str) -> Path:
    return Path(hass.config.path(MODEL_DIR)) / f"{key}.glb"


def _is_glb(head: bytes) -> bool:
    # binary glTF 2.0: magic "glTF", version 2
    return len(head) >= 12 and head[:4] == b"glTF" and int.from_bytes(head[4:8], "little") == 2


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)  # atomic: a half-written upload never replaces the old model


class ModelView(HomeAssistantView):
    """GET (any logged-in user), POST multipart field "file" and DELETE (admin)."""

    url = MODEL_URL + "/{key}"
    name = "api:taylors3d:model"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(self, request: web.Request, key: str) -> web.StreamResponse:
        if not KEY_RE.match(key):
            return self.json_message("Invalid key", HTTPStatus.BAD_REQUEST)
        path = model_path(self.hass, key)
        if not await self.hass.async_add_executor_job(path.is_file):
            return self.json_message("No model uploaded", HTTPStatus.NOT_FOUND)
        return web.FileResponse(
            path,
            headers={"Content-Type": "model/gltf-binary", "Cache-Control": "private, max-age=86400"},
        )

    @require_admin
    async def post(self, request: web.Request, key: str) -> web.Response:
        if not KEY_RE.match(key):
            return self.json_message("Invalid key", HTTPStatus.BAD_REQUEST)
        try:
            reader = await request.multipart()
            field = await reader.next()
        except (ValueError, AssertionError):
            return self.json_message("Expected a multipart upload", HTTPStatus.BAD_REQUEST)
        if field is None or getattr(field, "name", None) != "file":
            return self.json_message("Missing file field", HTTPStatus.BAD_REQUEST)
        # stream the body: HA's 16 MB request limit does not apply to multipart reads
        data = bytearray()
        while chunk := await field.read_chunk(CHUNK):
            data += chunk
            if len(data) > MAX_MODEL_BYTES:
                return self.json_message(
                    f"Model is larger than {MAX_MODEL_BYTES // 1024 // 1024} MB", HTTPStatus.REQUEST_ENTITY_TOO_LARGE
                )
        if not _is_glb(bytes(data[:12])):
            return self.json_message("Not a binary glTF 2.0 (.glb) file", HTTPStatus.BAD_REQUEST)
        await self.hass.async_add_executor_job(_write, model_path(self.hass, key), bytes(data))
        return self.json(
            {"size": len(data), "version": hashlib.sha256(data).hexdigest()[:12], "name": field.filename or f"{key}.glb"}
        )

    @require_admin
    async def delete(self, request: web.Request, key: str) -> web.Response:
        if not KEY_RE.match(key):
            return self.json_message("Invalid key", HTTPStatus.BAD_REQUEST)
        path = model_path(self.hass, key)
        await self.hass.async_add_executor_job(lambda: path.unlink(missing_ok=True))
        return self.json({"deleted": True})
