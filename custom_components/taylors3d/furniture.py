"""Immutable local furniture library, separate from layouts and house models.

Only generated SHA256 filenames are written; supplied ZIP paths are never
extracted. The catalogue replacement is the sole publication point. Interrupted
staging files remain unlisted, so imports cannot expose a partial pack. This
module's storage code is importable without HA; HTTP integration is registered
lazily by async_register_furniture(). There is deliberately no deletion API.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import threading
from typing import Any

from .furniture_pack import MAX_ARCHIVE_BYTES, MAX_ASSET_BYTES, MAX_ITEMS, FurniturePackError, validate_furniture_pack

FURNITURE_DIR = "taylors3d/furniture"
FURNITURE_URL = "/api/taylors3d/furniture"
DATA_FURNITURE = "taylors3d_furniture_library"
CHUNK = 64 * 1024
MAX_PACKS = 1024
MAX_INDEX_BYTES = 512 * 1024
MAX_RECORD_BYTES = 8 * 1024 * 1024
MAX_CATALOGUE_BYTES = 32 * 1024 * 1024
_SHA = re.compile(r"^[0-9a-f]{64}$")
_ITEM = re.compile(r"^[a-z0-9_-]{1,64}$")


class FurnitureStorageError(ValueError):
    """A safe, readable storage failure; path never reveals config locations."""

    def __init__(self, code: str, path: str, message: str) -> None:
        self.code, self.path, self.message = code, path, message
        super().__init__(f"{path}: {message}")


def _fail(code: str, path: str, message: str) -> None:
    raise FurnitureStorageError(code, path, message)


def _sha(value: Any) -> bool:
    return isinstance(value, str) and _SHA.fullmatch(value) is not None


def _encode(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _decode(data: bytes, path: str) -> Any:
    def pairs(entries: list[tuple[str, Any]]) -> dict[str, Any]:
        result = {}
        for key, value in entries:
            if key in result:
                _fail("corrupt_catalogue", path, "Duplicate stored JSON keys; restore the library from a backup.")
            result[key] = value
        return result

    def invalid_constant(_value: str) -> None:
        _fail("corrupt_catalogue", path, "Nonfinite stored JSON; restore the library from a backup.")

    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=pairs, parse_constant=invalid_constant)
        # Stored metadata originally passed the validator. Reject corruption
        # such as 1e999 or escaped lone surrogates before returning HTTP JSON.
        _encode(value)
        return value
    except (ValueError, UnicodeError, RecursionError) as error:
        if isinstance(error, FurnitureStorageError):
            raise
        _fail("corrupt_catalogue", path, "Invalid stored JSON; restore the library from a backup.")


async def read_furniture_upload(field: Any, maximum: int = MAX_ARCHIVE_BYTES) -> bytes:
    """Bound actual decoded multipart bytes, independent of Content-Length."""
    if getattr(field, "name", None) != "file":
        _fail("upload_field", "file", "Select one ZIP file in the file field.")
    data = bytearray()
    while chunk := await field.read_chunk(CHUNK):
        if not isinstance(chunk, bytes):
            _fail("upload_body", "file", "The ZIP upload did not contain binary bytes.")
        if len(data) + len(chunk) > maximum:
            _fail("archive_size", "file", f"ZIP upload exceeds {maximum // 1024 // 1024} MiB.")
        data.extend(chunk)
    if not data:
        _fail("upload_body", "file", "The ZIP file is empty.")
    return bytes(data)


class FurnitureLibrary:
    """Synchronous executor-safe storage; one registered instance serializes imports.

    Immutable files are checked before reuse. A failed publication can leave
    verified orphan files, which remain invisible until a later valid import.
    This is a single-HA-process library, not a cross-process database lock.
    """

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root).absolute()
        self._lock = threading.RLock()

    def _directory(self, name: str | None = None, *, create: bool = False) -> Path:
        if create:
            self.root.parent.mkdir(parents=True, exist_ok=True)
        path = self.root if name is None else self.root / name
        for candidate in (self.root,) if name is None else (self.root, path):
            if candidate.is_symlink() or (candidate.exists() and not candidate.is_dir()):
                _fail("unsafe_storage", "library", "Library folders must be real directories, not links or files.")
            if create:
                candidate.mkdir(exist_ok=True)
        return path

    def _read(self, path: Path, maximum: int, label: str) -> bytes:
        try:
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
                _fail("corrupt_storage", label, "Stored file is not a bounded regular file; restore it from a backup.")
            with path.open("rb") as stream:
                data = stream.read(maximum + 1)
        except FileNotFoundError:
            _fail("corrupt_storage", label, "A published library file is missing; restore it from a backup.")
        if len(data) > maximum:
            _fail("corrupt_storage", label, "Stored file exceeds its size limit; restore it from a backup.")
        return data

    def _verified(self, path: Path, digest: str, maximum: int, label: str) -> bytes:
        data = self._read(path, maximum, label)
        if hashlib.sha256(data).hexdigest() != digest:
            _fail("corrupt_storage", label, "Stored content no longer matches its SHA256 identity; restore it from a backup.")
        return data

    def _atomic_write(self, path: Path, data: bytes) -> None:
        """Unique temporary names; fsync bytes before the one atomic replace."""
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".staging-", suffix=".tmp", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            temporary = None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def _immutable_write(self, path: Path, data: bytes, maximum: int, label: str) -> None:
        if path.exists() or path.is_symlink():
            existing = self._verified(path, hashlib.sha256(data).hexdigest(), maximum, label)
            if existing != data:
                _fail("corrupt_storage", label, "Existing immutable content differs; restore it from a backup.")
        else:
            self._atomic_write(path, data)

    def _record_valid(self, record: Any, pack_id: str) -> bool:
        if not isinstance(record, dict) or record.get("pack_id") != pack_id or not _sha(record.get("logical_sha256")):
            return False
        if not isinstance(record.get("manifest"), dict) or not isinstance(record.get("license"), dict) or not isinstance(record.get("licenses"), dict):
            return False
        if type(record.get("archive_bytes")) is not int or not 1 <= record["archive_bytes"] <= MAX_ARCHIVE_BYTES:
            return False
        items = record.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
            return False
        ids = set()
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not _ITEM.fullmatch(item["id"]) or item["id"] in ids:
                return False
            ids.add(item["id"])
            if not _sha(item.get("sha256")) or not isinstance(item.get("license"), dict):
                return False
        return True

    def _load(self) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        index_path = self._directory() / "catalogue.json"
        if not index_path.exists() and not index_path.is_symlink():
            return {"version": 1, "packs": []}, []
        index = _decode(self._read(index_path, MAX_INDEX_BYTES, "catalogue"), "catalogue")
        if not isinstance(index, dict) or type(index.get("version")) is not int or index["version"] != 1 or not isinstance(index.get("packs"), list) or len(index["packs"]) > MAX_PACKS:
            _fail("corrupt_catalogue", "catalogue", "Unsupported library index; restore it from a backup.")
        records = []
        known = set()
        metadata_bytes = 0
        folder = self._directory("packs")
        for reference in index["packs"]:
            if not isinstance(reference, dict) or not _sha(reference.get("pack_id")) or not _sha(reference.get("metadata_sha256")) or reference["pack_id"] in known:
                _fail("corrupt_catalogue", "catalogue", "Invalid or duplicate stored pack identity; restore it from a backup.")
            pack_id = reference["pack_id"]
            known.add(pack_id)
            body = self._verified(folder / f"{pack_id}.json", reference["metadata_sha256"], min(MAX_RECORD_BYTES, MAX_CATALOGUE_BYTES - metadata_bytes), "pack metadata")
            metadata_bytes += len(body)
            record = _decode(body, "pack metadata")
            if not self._record_valid(record, pack_id):
                _fail("corrupt_catalogue", "pack metadata", "Invalid stored pack record; restore it from a backup.")
            records.append(record)
        return index, records

    def catalogue(self) -> dict[str, Any]:
        with self._lock:
            _index, records = self._load()
            return {"version": 1, "packs": copy.deepcopy(records)}

    def import_pack(self, data: bytes) -> dict[str, Any]:
        with self._lock:
            return self._import_validated(data, validate_furniture_pack(data))

    def _import_validated(self, data: bytes, report: dict[str, Any]) -> dict[str, Any]:
        """Internal commit for the HTTP handler's executor-validated bytes.

        Reports never come from an HTTP field. Splitting validation from this
        serialized commit lets the event loop recheck the authenticated account
        and session after awaited validation, before scheduling any file writes.
        """
        with self._lock:
            if report["archive_sha256"] != hashlib.sha256(data).hexdigest():
                _fail("corrupt_storage", "original pack", "Validated archive bytes changed before storage.")
            index, records = self._load()
            pack_id = report["archive_sha256"]
            existing = next((record for record in records if record["pack_id"] == pack_id), None)
            if existing is None and len(records) >= MAX_PACKS:
                _fail("library_budget", "catalogue", f"Library supports at most {MAX_PACKS} immutable packs.")
            record = {"pack_id": pack_id, "logical_sha256": report["sha256"], "archive_bytes": len(data),
                      "manifest": report["manifest"], "license": report["license"], "licenses": report["licenses"],
                      "stats": report["stats"], "download_url": f"{FURNITURE_URL}/packs/{pack_id}.zip",
                      "items": [{**{key: value for key, value in item.items() if key != "data"},
                                 "metadata": report["manifest"]["items"][item_index],
                                 "pack_id": pack_id, "asset_url": f"{FURNITURE_URL}/assets/{item['sha256']}.glb"}
                                for item_index, item in enumerate(report["items"])]}
            encoded = _encode(record)
            if len(encoded) > MAX_RECORD_BYTES:
                _fail("library_budget", "pack metadata", "Pack credit metadata exceeds the stored-record budget.")
            if existing is not None and existing != record:
                _fail("corrupt_storage", "pack metadata", "Published pack metadata differs from the original archive.")
            if existing is None and sum(len(_encode(previous)) for previous in records) + len(encoded) > MAX_CATALOGUE_BYTES:
                _fail("library_budget", "catalogue", "Combined library credit metadata exceeds its storage budget.")
            next_index = index if existing is not None else {"version": 1, "packs": [*index["packs"], {"pack_id": pack_id, "metadata_sha256": hashlib.sha256(encoded).hexdigest()}]}
            body = _encode(next_index)
            if len(body) > MAX_INDEX_BYTES:
                _fail("library_budget", "catalogue", "Library index exceeds its storage budget.")
            # Every deterministic budget check precedes irreversible staging.
            # Only genuine interrupted I/O can leave unlisted immutable files.
            asset_dir = self._directory("assets", create=True)
            archive_dir = self._directory("archives", create=True)
            pack_dir = self._directory("packs", create=True)
            published_assets = {item["sha256"] for previous in records for item in previous["items"]}
            for digest, asset in report["assets"].items():
                path = asset_dir / f"{digest}.glb"
                if digest in published_assets:
                    self._verified(path, digest, MAX_ASSET_BYTES, "furniture asset")
                else:
                    self._immutable_write(path, asset["data"], MAX_ASSET_BYTES, "furniture asset")
            if existing is not None:
                self._verified(archive_dir / f"{pack_id}.zip", pack_id, MAX_ARCHIVE_BYTES, "original pack")
            self._immutable_write(archive_dir / f"{pack_id}.zip", data, MAX_ARCHIVE_BYTES, "original pack")
            self._immutable_write(pack_dir / f"{pack_id}.json", encoded, MAX_RECORD_BYTES, "pack metadata")
            if existing is not None:
                return {"imported": False, "pack": copy.deepcopy(existing)}
            self._atomic_write(self.root / "catalogue.json", body)
            return {"imported": True, "pack": copy.deepcopy(record)}

    def asset(self, digest: str) -> bytes:
        if not _sha(digest):
            _fail("identifier", "asset", "Use an exact lowercase SHA256 asset identity.")
        with self._lock:
            _index, records = self._load()
            if not any(item["sha256"] == digest for record in records for item in record["items"]):
                _fail("not_found", "asset", "This furniture asset is not in the published library.")
            return self._verified(self._directory("assets") / f"{digest}.glb", digest, MAX_ASSET_BYTES, "furniture asset")

    def archive(self, pack_id: str) -> bytes:
        if not _sha(pack_id):
            _fail("identifier", "pack", "Use an exact lowercase SHA256 pack identity.")
        with self._lock:
            _index, records = self._load()
            if not any(record["pack_id"] == pack_id for record in records):
                _fail("not_found", "pack", "This original ZIP is not in the published library.")
            return self._verified(self._directory("archives") / f"{pack_id}.zip", pack_id, MAX_ARCHIVE_BYTES, "original pack")


async def async_register_furniture(hass: Any) -> FurnitureLibrary:
    """Register HA-authenticated views once. Import requires current admin access.

    Imported bytes are fully validated in HA's executor. Responses use verified
    bytes rather than FileResponse, avoiding a verify/serve file replacement gap.
    """
    if DATA_FURNITURE in hass.data:
        return hass.data[DATA_FURNITURE]
    from http import HTTPStatus
    from aiohttp import web
    from homeassistant.components.http import HomeAssistantView, require_admin
    from homeassistant.components.http.const import KEY_HASS_REFRESH_TOKEN_ID, KEY_HASS_USER

    library = FurnitureLibrary(hass.config.path(FURNITURE_DIR))

    def failure(view: Any, error: Exception) -> Any:
        if isinstance(error, (FurniturePackError, FurnitureStorageError)):
            code = error.code
            status = HTTPStatus.BAD_REQUEST
            if code == "archive_size":
                status = HTTPStatus.REQUEST_ENTITY_TOO_LARGE
            elif code == "not_found":
                status = HTTPStatus.NOT_FOUND
            elif code in ("corrupt_storage", "corrupt_catalogue", "unsafe_storage"):
                status = HTTPStatus.CONFLICT
            return view.json({"error": code, "path": error.path, "message": error.message}, status_code=status)
        return view.json_message("Furniture library storage is unavailable.", HTTPStatus.INTERNAL_SERVER_ERROR)

    class CatalogueView(HomeAssistantView):
        url = FURNITURE_URL
        name = "api:taylors3d:furniture"
        requires_auth = True

        async def get(self, request: Any) -> Any:
            try:
                result = await hass.async_add_executor_job(library.catalogue)
            except (FurnitureStorageError, OSError) as error:
                return failure(self, error)
            response = self.json(result)
            response.headers["Cache-Control"] = "private, no-store"
            return response

        @require_admin
        async def post(self, request: Any) -> Any:
            expected_user = request.get(KEY_HASS_USER)
            expected_user_id = getattr(expected_user, "id", None)
            expected_session = request.get(KEY_HASS_REFRESH_TOKEN_ID)

            async def current_admin() -> bool:
                user = request.get(KEY_HASS_USER)
                if user is not expected_user or not isinstance(expected_user_id, str) or not expected_user_id.strip():
                    return False
                # An in-flight request retains its original user object. HA can
                # remove that object from the auth store without changing its
                # active/admin fields, particularly for tokenless Supervisor
                # requests. Re-resolve the account after every awaited stage.
                current = await hass.auth.async_get_user(expected_user_id)
                if current is not user or current.id != expected_user_id or not current.is_admin or not current.is_active:
                    return False
                if request.get(KEY_HASS_USER) is not user:
                    return False
                if request.get(KEY_HASS_REFRESH_TOKEN_ID) != expected_session:
                    return False
                if expected_session is not None:
                    session = hass.auth.async_get_refresh_token(expected_session)
                    return session is not None and session.user is user
                # HA's Supervisor Unix socket authenticates without a token.
                return request.get("ha_supervisor_unix_socket") is True

            if not await current_admin():
                return self.json_message("Active administrator access is required.", HTTPStatus.UNAUTHORIZED)
            try:
                reader = await request.multipart()
                field = await reader.next()
                data = await read_furniture_upload(field)
                if await reader.next() is not None:
                    return self.json_message("Upload one file field only.", HTTPStatus.BAD_REQUEST)
                if not await current_admin():
                    return self.json_message("Active administrator access is required.", HTTPStatus.UNAUTHORIZED)
                report = await hass.async_add_executor_job(validate_furniture_pack, data)
                if not await current_admin():
                    return self.json_message("Active administrator access is required.", HTTPStatus.UNAUTHORIZED)
                result = await hass.async_add_executor_job(library._import_validated, data, report)
            except (FurniturePackError, FurnitureStorageError, OSError) as error:
                return failure(self, error)
            except (ValueError, AssertionError):
                return self.json_message("Expected a complete multipart ZIP upload.", HTTPStatus.BAD_REQUEST)
            return self.json(result)

    class AssetView(HomeAssistantView):
        url = FURNITURE_URL + "/assets/{digest}.glb"
        name = "api:taylors3d:furniture:asset"
        requires_auth = True

        async def get(self, request: Any, digest: str) -> Any:
            try:
                data = await hass.async_add_executor_job(library.asset, digest)
            except (FurnitureStorageError, OSError) as error:
                return failure(self, error)
            return web.Response(body=data, headers={"Content-Type": "model/gltf-binary", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})

    class ArchiveView(HomeAssistantView):
        url = FURNITURE_URL + "/packs/{pack_id}.zip"
        name = "api:taylors3d:furniture:pack"
        requires_auth = True

        async def get(self, request: Any, pack_id: str) -> Any:
            try:
                data = await hass.async_add_executor_job(library.archive, pack_id)
            except (FurnitureStorageError, OSError) as error:
                return failure(self, error)
            return web.Response(body=data, headers={"Content-Type": "application/zip", "Content-Disposition": f'attachment; filename="{pack_id}.zip"', "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})

    hass.http.register_view(CatalogueView())
    hass.http.register_view(AssetView())
    hass.http.register_view(ArchiveView())
    hass.data[DATA_FURNITURE] = library
    return library
