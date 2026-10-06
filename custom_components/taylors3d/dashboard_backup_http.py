"""FUTURE authenticated read-only export/inspect; deliberately unregistered.

Export accepts raw selected dashboard JSON, explicit source/resources, exact
shared_keys, and explicit user/browser layout snapshots. Optional dashboard_json
and layout_json preserve supplied original UTF-8 member bytes. No layout
normalization, ID relinking, external fetch, filesystem scanning or restore/save
occurs. Inspect reads application/zip, never an arbitrary path or URL.

HA currently uses a 16 MiB application client_max_size. These two endpoints read
request.content in bounded chunks with their OWN 36 MiB JSON/512 MiB ZIP limits;
they do not change that global or call Request.read/json/post. This deliberate
stream path is supported by aiohttp, not a claim its global limit covers it.
https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/server.py
https://github.com/aio-libs/aiohttp/blob/v3.14.3/aiohttp/web_request.py

ZIP input/output spool to temporary files and transfer in <=64 KiB chunks.
The core still retains up to 512 MiB member bytes, plus bounded request JSON,
parsed previews and one pack validation. This is NOT memory-free, an atomic
live-HA snapshot, a full-HA-system backup, or a restore API. A cancelled/partial
download must be discarded. Current auth is checked before every body/output
chunk and after executor work; bytes already sent cannot be recalled.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from functools import partial
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
from typing import Any, BinaryIO, Callable
from urllib.parse import urlsplit

from .const import CARD_FILENAME, CARD_URL_BASE, DOMAIN
from .dashboard_backup import (
    DashboardBackup, DashboardBackupError, MAX_ARCHIVE_BYTES, MAX_DASHBOARD_WIRE_BYTES,
    MAX_DIAGNOSTICS, MAX_EXPANDED_BYTES, MAX_JSON_BYTES, MAX_JSON_DEPTH,
    MAX_JSON_VALUES, MAX_LAYOUTS, MAX_MANIFEST_BYTES, MAX_MODEL_BYTES, MAX_PACK_BYTES,
    prepare_dashboard_backup, create_dashboard_backup, validate_dashboard_backup,
)
from .furniture import DATA_FURNITURE, FurnitureStorageError

URL = "/api/taylors3d/dashboard_backup"
DATA_BACKUP_HTTP = "taylors3d_dashboard_backup_http"
CHUNK = 64 * 1024
MAX_EXPORT_BODY = MAX_JSON_BYTES + MAX_MANIFEST_BYTES
MAX_INSPECT_RESPONSE = MAX_JSON_BYTES + MAX_MANIFEST_BYTES
_MODEL_KEY = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_SHA = re.compile(r"^[0-9a-f]{64}$")


class BackupHTTPError(ValueError):
    """Safe fixed messages, never transport bodies, credentials/config paths."""

    def __init__(self, code: str, message: str, path: str = "") -> None:
        self.code, self.message, self.path = code, message, path
        super().__init__(message)


def _fail(code: str, message: str, path: str = "") -> None:
    raise BackupHTTPError(code, message, path)


def lovelace_data_key(constants: Any) -> str:
    """Use HA's exported registry identity, including its older DOMAIN key."""
    key = constants.LOVELACE_DATA if hasattr(constants, "LOVELACE_DATA") else getattr(constants, "DOMAIN", None)
    if not isinstance(key, str) or not key:
        _fail("platform_unavailable", "Actual Lovelace registry identity is unavailable.")
    return key


def lovelace_field(data: Any, field: str) -> Any:
    """Read the exact live legacy dict or modern LovelaceData field."""
    if type(data) is dict:
        return data.get("mode" if field == "resource_mode" else field)
    return getattr(data, field, None)


def _encode(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def decode_export_request(data: bytes) -> dict:
    """Strict original request JSON; duplicate keys cannot hide provenance."""
    if not isinstance(data, bytes) or not 0 < len(data) <= MAX_EXPORT_BODY:
        _fail("body_size", "Export JSON must be nonempty and at most 36 MiB.")

    def pairs(entries):
        result = {}
        for key, value in entries:
            if key in result:
                _fail("duplicate_json_key", "Duplicate request JSON keys are not supported.")
            result[key] = value
        return result

    def invalid(_value):
        _fail("json_number", "Nonfinite request JSON numbers are not supported.")

    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=pairs, parse_constant=invalid)
        pending, count = [(value, 0)], 0
        while pending:
            item, depth = pending.pop()
            count += 1
            if count > MAX_JSON_VALUES or depth > MAX_JSON_DEPTH:
                _fail("json_complexity", "Request JSON exceeds its depth/value budget.")
            if isinstance(item, str):
                item.encode("utf-8")
            elif isinstance(item, float) and not math.isfinite(item):
                invalid(item)
            elif isinstance(item, dict):
                pending.extend((child, depth + 1) for pair in item.items() for child in pair)
            elif isinstance(item, list):
                pending.extend((child, depth + 1) for child in item)
        if type(value) is not dict:
            _fail("shape", "Export needs one raw JSON request object.")
        return value
    except (ValueError, UnicodeError, RecursionError) as error:
        if isinstance(error, BackupHTTPError):
            raise
        _fail("json", "Expected complete bounded UTF-8 export JSON.")


def _key(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 64 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        _fail("layout_key", "Use an exact nonblank layout key of at most 64 characters.")
    value.encode("utf-8")
    return value


def _member(row: dict, field: str) -> dict | bytes:
    raw = field + "_json"
    if (field in row) == (raw in row):
        _fail("shape", f"Supply exactly one {field} or {raw} member.")
    value = row.get(field) if field in row else row.get(raw)
    if raw in row:
        if not isinstance(value, str):
            _fail("shape", f"{raw} must be exact UTF-8 JSON text.")
        return value.encode("utf-8")
    if type(value) is not dict:
        _fail("shape", f"{field} must be a raw JSON object.")
    return value


def request_shared_keys(payload: dict) -> list[str]:
    keys = payload.get("shared_keys")
    if not isinstance(keys, list) or len(keys) > MAX_LAYOUTS:
        _fail("shared_keys", "Supply an explicit list of at most 64 exact shared layout keys.")
    result = [_key(key) for key in keys]
    if len(set(result)) != len(result):
        _fail("shared_keys", "Shared layout keys must be unique; no aliases are guessed.")
    return result


def read_owned_model(path: Path, maximum: int) -> bytes:
    """Path comes only from ModelView.model_path with its exact canonical key.

    Reject linked model directories/files and changing/nonregular files. This
    does not secure a hostile operating-system/config-directory owner; config
    root ownership remains HA's responsibility. No caller path is accepted.
    """
    try:
        if path.parent.is_symlink() or path.parent.parent.is_symlink():
            _fail("unsafe_storage", "Owned model folders cannot be symbolic links.")
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode):
            _fail("unsafe_storage", "The original model must be a regular owned file.")
        if not 0 < before.st_size <= min(maximum, MAX_MODEL_BYTES):
            _fail("asset_size", "Original model exceeds the remaining archive/model byte budget.")
        with path.open("rb") as stream:
            opened = os.fstat(stream.fileno())
            if (before.st_dev, before.st_ino, before.st_size) != (opened.st_dev, opened.st_ino, opened.st_size):
                _fail("source_changed", "The original model changed during collection.")
            data = stream.read(min(maximum, MAX_MODEL_BYTES) + 1)
            after = os.fstat(stream.fileno())
        if len(data) != before.st_size or (opened.st_size, opened.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            _fail("source_changed", "The original model changed during collection.")
        return data
    except FileNotFoundError:
        _fail("model_missing", "The original uploaded model is missing.")


def _diagnostic(code: str, path: str, message: str, severity: str = "missing") -> dict:
    return {"code": code, "path": path, "message": message, "severity": severity}


def _software_resource(url: Any) -> bool:
    if not isinstance(url, str):
        return False
    try:
        parsed = urlsplit(url)
        return not parsed.scheme and not parsed.netloc and not parsed.fragment and parsed.path == f"{CARD_URL_BASE}/{CARD_FILENAME}"
    except ValueError:
        return False


def _js_truthy(value: Any) -> bool:
    # Match the card's model || uploaded-model decision. Empty JSON objects and
    # arrays are truthy in JavaScript, even though they are false in Python.
    return not (value is None or value is False or value == "" or
                (type(value) in (int, float) and value == 0))


def external_dependencies(dashboard: dict, layouts: dict, resources: dict) -> list[dict]:
    """Known outside assets/foreign card software, no arbitrary URL discovery.

    HA entity/area/floor IDs remain environment references, never remapped or
    asserted to be bundled. Unknown plugin content remains raw; a foreign custom
    card itself is a dependency even if its private image keys are unknowable.
    The installed Taylor frontend is required software, not a copied asset.
    """
    result = []
    for i, item in enumerate(resources.get("items", [])):
        if not _software_resource(item.get("url")):
            result.append(_diagnostic("external_dependency", f"resources.items[{i}]", "This outside resource is declared but its source bytes are not included."))
    pending = [(dashboard, "dashboard")]
    pending.extend((layout, f"layouts/{key}") for key, layout in layouts.items())
    while pending:
        item, pointer = pending.pop()
        if isinstance(item, dict):
            kind = item.get("type")
            if isinstance(kind, str) and kind.startswith("custom:") and kind != "custom:taylors3d-card":
                result.append(_diagnostic("external_dependency", pointer, "This foreign custom card requires separately installed software."))
            if kind == "custom:taylors3d-card" and _js_truthy(item.get("model")):
                result.append(_diagnostic("external_dependency", pointer + "/model", "This explicit model dependency is not an owned uploaded model; no URL was downloaded."))
            for key, child in item.items():
                child_path = pointer + "/" + key.replace("~", "~0").replace("/", "~1")
                if key in ("image", "image_url", "entity_picture") and isinstance(child, str) and child.strip() and not child.startswith("data:image/"):
                    result.append(_diagnostic("external_dependency", child_path, "This configured image source is declared but its bytes are not included."))
                elif key == "background" and isinstance(child, str) and ("url(" in child.lower() or child.startswith(("/", "http:", "https:"))):
                    result.append(_diagnostic("external_dependency", child_path, "This configured background image is declared but its bytes are not included."))
                pending.append((child, child_path))
        elif isinstance(item, list):
            pending.extend((child, pointer + "/" + str(i)) for i, child in enumerate(item))
        if len(result) > MAX_DIAGNOSTICS:
            _fail("diagnostics", "Too many external dependency references.")
    return result


def prepare_export(payload: dict, shared: dict, *, model_reader: Callable[[str, int], bytes],
                   pack_reader: Callable[[str, int], bytes], owned_source: dict | None = None) -> DashboardBackup:
    """Executor-only, supplied exact snapshots/readers; no registration or writes."""
    keys = request_shared_keys(payload)
    if set(shared) - set(keys):
        _fail("shared_keys", "Only explicitly requested shared keys may be collected.")
    supplied = payload.get("layouts", {})
    if type(supplied) is not dict or len(supplied) + len(keys) > MAX_LAYOUTS:
        _fail("layouts", "Supply at most 64 exact shared/user/browser snapshots.")
    snapshots = {}
    for key in keys:
        if shared.get(key) is not None:
            snapshots[key] = {"backend": "shared", "layout": shared[key], "metadata": {}}
    for key, row in supplied.items():
        _key(key)
        if key in keys or type(row) is not dict or row.get("backend") not in ("user", "browser"):
            _fail("provenance", "Caller snapshots must have user/browser provenance and cannot override shared keys.")
        snapshots[key] = {**row, "layout": _member(row, "layout")}
        snapshots[key].pop("layout_json", None)
    dashboard = _member(payload, "dashboard")
    source = payload.get("source")
    resources = payload.get("resources")
    if type(source) is not dict or type(resources) is not dict:
        _fail("shape", "Supply explicit selected source metadata and resource references.")
    # Copy before modifying only the proven mode. Raw unknown fields/metadata are
    # retained; source metadata supplied by a browser is not an atomic HA proof.
    source, resources = json.loads(_encode(source)), json.loads(_encode(resources))
    if isinstance(dashboard, bytes):
        if len(dashboard) > MAX_DASHBOARD_WIRE_BYTES:
            _fail("json_size", "Raw dashboard JSON exceeds its 3 MiB member budget.")
        raw_dashboard = decode_export_request(dashboard)
    else:
        raw_dashboard = dashboard
    generated = isinstance(raw_dashboard.get("strategy"), dict)
    mode_proven = bool(owned_source and owned_source.get("mode") in ("yaml", "storage"))
    if mode_proven:
        expected = "generated" if generated else owned_source["mode"]
        if source.get("mode") not in (None, expected):
            _fail("source_changed", "The selected dashboard source mode changed; collect it again.")
        source["mode"] = expected
        actual_resource_mode = owned_source.get("resource_mode")
        if actual_resource_mode in ("yaml", "storage"):
            if resources.get("mode") not in (None, actual_resource_mode):
                _fail("source_changed", "The actual resource mode changed; collect it again.")
            resources["mode"] = actual_resource_mode
    if generated and source.get("mode") is None:
        source["mode"] = "generated"
    if source.get("mode") not in ("yaml", "storage", "generated") or resources.get("mode") not in ("yaml", "storage"):
        _fail("source_mode", "The source or resource mode is unresolved; no mode was guessed.")
    arguments = {"source": source, "resources": resources, "layouts": snapshots,
                 "created_at": payload.get("created_at"), "producer_version": payload.get("producer_version", "unknown")}
    draft = prepare_dashboard_backup(dashboard, **arguments)
    manifest = draft.manifest
    raw_layouts = {row["key"]: json.loads(draft.members[row["file"]["path"]]) for row in manifest["layouts"]}
    diagnostics = external_dependencies(draft.dashboard, raw_layouts, resources)
    diagnostics.append(_diagnostic("capture_provenance", "source", "Browser dashboard/resource metadata is a supplied snapshot, not an atomic live Home Assistant transaction.", "info"))
    models, packs = {}, {}
    remaining = MAX_EXPANDED_BYTES - sum(len(body) for body in draft.members.values())
    # Derive requests from the core's independently validated diagnostics, not
    # caller asset names or paths. Hash-named layout members disambiguate keys.
    member_keys = {row["file"]["path"]: row["key"] for row in manifest["layouts"]}
    for entry in draft.report()["diagnostics"]:
        if entry["code"] == "model_missing":
            key = member_keys[entry["path"]]
            if not _MODEL_KEY.fullmatch(key):
                diagnostics.append(_diagnostic("model_key", entry["path"], "This exact layout key is outside the integration's model path rules; no filename was guessed."))
                continue
            try:
                data = model_reader(key, min(remaining, MAX_MODEL_BYTES))
            except (BackupHTTPError, FurnitureStorageError) as error:
                if error.code not in ("model_missing", "not_found"):
                    raise
                continue
            if not isinstance(data, bytes) or not 0 < len(data) <= min(remaining, MAX_MODEL_BYTES):
                _fail("asset_size", "Original model exceeds its remaining byte budget.")
            models[key] = data; remaining -= len(data)
        elif entry["code"] == "pack_missing":
            pack_id = entry["path"]
            if not _SHA.fullmatch(pack_id):
                _fail("identity", "Use an exact published original furniture ZIP identity.")
            try:
                data = pack_reader(pack_id, min(remaining, MAX_PACK_BYTES))
            except (BackupHTTPError, FurnitureStorageError) as error:
                if error.code not in ("pack_missing", "not_found"):
                    raise
                continue
            if not isinstance(data, bytes) or not 0 < len(data) <= min(remaining, MAX_PACK_BYTES):
                _fail("asset_size", "Original furniture ZIP exceeds its remaining byte budget.")
            packs[pack_id] = data; remaining -= len(data)
    return prepare_dashboard_backup(dashboard, **arguments, models=models, furniture_packs=packs, diagnostics=diagnostics,
                                    extra={"http_capture": {"source_mode_proven": mode_proven, "atomic": False,
                                                              "software_required": {"domain": DOMAIN, "frontend": CARD_FILENAME}}})


def inspection(prepared: DashboardBackup) -> dict:
    manifest, report = prepared.manifest, prepared.report()
    layouts = {row["key"]: {"backend": row["backend"], "metadata": row["metadata"],
                            "layout": json.loads(prepared.members[row["file"]["path"]])} for row in manifest["layouts"]}
    outside = external_dependencies(prepared.dashboard, {key: row["layout"] for key, row in layouts.items()}, manifest["resources"])
    return {"manifest": manifest, "report": {**report, "dependencyFree": not outside, "externalDependencies": outside},
            "preview": {"dashboard": prepared.dashboard, "layouts": layouts}, "restoreAvailable": False}


class AuthFence:
    """Re-resolve real auth-store identity after every awaited stage; latch loss."""

    def __init__(self, hass: Any, request: Any, *, admin: bool, user_key: str = "hass_user",
                 token_key: str = "hass_refresh_token_id", supervisor_check: Callable = lambda _request: False,
                 supervisor_user_key: Any = None) -> None:
        self.hass, self.request, self.admin = hass, request, admin
        self.user_key, self.token_key = user_key, token_key
        self.user, self.token = request.get(user_key), request.get(token_key)
        self.user_id = getattr(self.user, "id", None)
        self.supervisor_check, self.supervisor_user_key = supervisor_check, supervisor_user_key
        self.valid = True

    async def current(self) -> bool:
        if not self.valid:
            return False
        if not isinstance(self.user_id, str) or not self.user_id.strip() or self.request.get(self.user_key) is not self.user:
            self.valid = False; return False
        current = await self.hass.auth.async_get_user(self.user_id)
        allowed = current is self.user and getattr(current, "id", None) == self.user_id and getattr(current, "is_active", None) is True
        allowed = allowed and (not self.admin or getattr(current, "is_admin", None) is True)
        allowed = allowed and self.request.get(self.user_key) is self.user and self.request.get(self.token_key) == self.token
        if allowed and self.token is not None:
            token = self.hass.auth.async_get_refresh_token(self.token)
            allowed = token is not None and token.user is self.user
        elif allowed:
            allowed = self.supervisor_check(self.request) is True and self.supervisor_user_key is not None and self.hass.data.get(self.supervisor_user_key) is self.user
        self.valid = bool(allowed)
        return self.valid

    async def check(self) -> None:
        if not await self.current():
            _fail("auth", "Current active account/session access is required.")


async def read_body(content: Any, maximum: int, check: Callable) -> bytes:
    """Actual decoded chunk bytes, independent of declared Content-Length."""
    result = bytearray()
    while True:
        await check(); chunk = await content.read(CHUNK); await check()
        if not chunk:
            break
        if not isinstance(chunk, bytes) or len(chunk) > CHUNK:
            _fail("body", "Expected bounded binary request chunks.")
        if len(result) + len(chunk) > maximum:
            _fail("body_size", "Request body exceeds its endpoint byte budget.")
        result.extend(chunk)
    if not result:
        _fail("body", "Request body is empty.")
    return bytes(result)


async def _executor(hass: Any, function: Callable, *args, abandoned: Callable | None = None):
    """Workers retain resource ownership if a cancelled HTTP await abandons them."""
    job = asyncio.ensure_future(hass.async_add_executor_job(function, *args))
    try:
        return await asyncio.shield(job)
    except asyncio.CancelledError:
        def done(completed):
            try:
                result = completed.result()
                if abandoned is not None:
                    abandoned(result)
            except BaseException:
                pass
        job.add_done_callback(done)
        raise


def source_modes(data: Any, payload: dict) -> dict:
    """Read only the exact backend dashboard, with HA's null-default ordering."""
    source = payload.get("source")
    if type(source) is not dict or "url_path" not in source:
        _fail("source_path", "Supply an explicit selected dashboard URL path or null.", "source.url_path")
    path = source["url_path"]
    if path is not None:
        if not isinstance(path, str) or not path.strip() or len(path) > 256 or any(ord(c) < 32 or ord(c) == 127 for c in path):
            _fail("source_path", "Use one exact nonblank dashboard path of at most 256 characters, or null.", "source.url_path")
        try:
            path.encode("utf-8")
        except UnicodeError:
            _fail("source_path", "The selected dashboard path must be valid Unicode.", "source.url_path")
    dashboards = {} if data is None else lovelace_field(data, "dashboards")
    if type(dashboards) is not dict:
        _fail("platform_unavailable", "Actual Lovelace dashboard registry cannot be checked.")
    selected = (dashboards.get("lovelace") or dashboards.get(None)) if path is None else dashboards.get(path)
    return {"mode": getattr(selected, "mode", None), "resource_mode": lovelace_field(data, "resource_mode")}


@dataclass
class ExportDownload:
    stream: BinaryIO
    size: int
    report: dict


def build_download(*args, **kwargs) -> ExportDownload:
    stream = tempfile.TemporaryFile(mode="w+b")
    try:
        prepared = prepare_export(*args, **kwargs)
        report = create_dashboard_backup(prepared, stream)
        size = stream.tell(); stream.seek(0)
        return ExportDownload(stream, size, report)
    except BaseException:
        stream.close(); raise


def inspect_and_close(stream: BinaryIO) -> bytes:
    try:
        response = _encode(inspection(validate_dashboard_backup(stream)))
        if len(response) > MAX_INSPECT_RESPONSE:
            _fail("preview_size", "The validated preview exceeds its 36 MiB response budget.")
        return response
    finally:
        stream.close()


async def async_register_dashboard_backup(hass: Any) -> dict:
    """Future explicit registration only. Does not start/freeze the HA router."""
    if DATA_BACKUP_HTTP in hass.data:
        return hass.data[DATA_BACKUP_HTTP]
    from http import HTTPStatus
    from aiohttp import web
    from homeassistant.components.http import HomeAssistantView, require_admin
    from homeassistant.components.http import const as http_const
    from homeassistant.components.lovelace import const as lovelace_const
    from .model import KEY_RE, model_path
    data_key = lovelace_data_key(lovelace_const)

    def auth(request, admin):
        return AuthFence(hass, request, admin=admin, user_key=http_const.KEY_HASS_USER,
                         token_key=http_const.KEY_HASS_REFRESH_TOKEN_ID,
                         supervisor_check=getattr(http_const, "is_supervisor_unix_socket_request", lambda _request: False),
                         supervisor_user_key=getattr(http_const, "DATA_SUPERVISOR_USER", None))

    def failure(view, error):
        if isinstance(error, (BackupHTTPError, DashboardBackupError, FurnitureStorageError)):
            status = HTTPStatus.BAD_REQUEST
            if error.code == "auth":
                status = HTTPStatus.UNAUTHORIZED
            elif error.code == "content_type":
                status = HTTPStatus.UNSUPPORTED_MEDIA_TYPE
            elif error.code in ("body_size", "asset_size", "preview_size", "archive_size", "total_budget", "json_size", "wire_budget"):
                status = HTTPStatus.REQUEST_ENTITY_TOO_LARGE
            elif error.code in ("source_changed", "corrupt_storage", "corrupt_catalogue", "unsafe_storage"):
                status = HTTPStatus.CONFLICT
            response = view.json({"error": error.code, "path": error.path, "message": error.message}, status_code=status)
        else:
            response = view.json_message("Dashboard backup storage or input is unavailable.", HTTPStatus.INTERNAL_SERVER_ERROR)
        response.headers["Cache-Control"] = "private, no-store"
        return response

    def content_guard(request, content_type, maximum):
        if request.content_type != content_type or request.headers.get("Content-Encoding", "identity").lower() != "identity":
            _fail("content_type", "Use the endpoint's uncompressed declared content type.")
        if content_type == "application/json" and request.charset not in (None, "utf-8", "UTF-8"):
            _fail("content_type", "Export JSON must use UTF-8.")
        if request.content_length is not None and request.content_length > maximum:
            _fail("body_size", "Request body exceeds its endpoint byte budget.")

    def owned_source(payload):
        return source_modes(hass.data.get(data_key), payload)

    class ExportView(HomeAssistantView):
        url = URL + "/export"
        name = "api:taylors3d:dashboard_backup:export"
        requires_auth = True

        async def post(self, request):
            fence, download, stream_owned = auth(request, False), None, True
            try:
                await fence.check(); content_guard(request, "application/json", MAX_EXPORT_BODY)
                body = await read_body(request.content, MAX_EXPORT_BODY, fence.check)
                payload = await _executor(hass, decode_export_request, body); await fence.check()
                keys = request_shared_keys(payload); store = hass.data.get(DOMAIN)
                shared = {key: store.get(key) if store is not None else None for key in keys}

                def model_reader(key, maximum):
                    if not KEY_RE.fullmatch(key):
                        _fail("model_key", "Use an exact canonical model key.")
                    return read_owned_model(model_path(hass, key), maximum)

                library = hass.data.get(DATA_FURNITURE)

                def pack_reader(pack_id, maximum):
                    if library is None:
                        _fail("pack_missing", "The published furniture library is unavailable.")
                    result = library.archive(pack_id)
                    if len(result) > maximum:
                        _fail("asset_size", "Original furniture ZIP exceeds its remaining archive byte budget.")
                    return result

                job = partial(build_download, payload, shared, model_reader=model_reader, pack_reader=pack_reader, owned_source=owned_source(payload))
                download = await _executor(hass, job, abandoned=lambda value: value.stream.close()); await fence.check()
                if hass.data.get(DOMAIN) is not store or any((store.get(key) if store is not None else None) is not shared[key] for key in keys):
                    _fail("source_changed", "A shared layout changed during collection; collect it again.")
                response = web.StreamResponse(headers={"Content-Type": "application/zip", "Content-Length": str(download.size),
                    "Content-Disposition": 'attachment; filename="taylors3d-dashboard-backup.zip"', "Cache-Control": "private, no-store",
                    "X-Content-Type-Options": "nosniff", "X-Taylors3D-Complete": str(download.report["complete"]).lower()})
                await fence.check(); await response.prepare(request)
                while True:
                    await fence.check()
                    try:
                        chunk = await _executor(hass, download.stream.read, CHUNK, abandoned=lambda _result: download.stream.close())
                    except asyncio.CancelledError:
                        stream_owned = False; raise
                    await fence.check()
                    if not chunk:
                        break
                    await response.write(chunk)
                await response.write_eof(); return response
            except (BackupHTTPError, DashboardBackupError, FurnitureStorageError, OSError, ValueError) as error:
                if download is not None and 'response' in locals() and response.prepared:
                    # A partial authenticated stream is never a usable archive.
                    response.force_close()
                    if request.transport is not None:
                        request.transport.close()
                    return response
                return failure(self, error)
            finally:
                if download is not None and stream_owned:
                    download.stream.close()

    class InspectView(HomeAssistantView):
        url = URL + "/inspect"
        name = "api:taylors3d:dashboard_backup:inspect"
        requires_auth = True

        @require_admin
        async def post(self, request):
            fence, stream = auth(request, True), None
            try:
                await fence.check(); content_guard(request, "application/zip", MAX_ARCHIVE_BYTES)
                stream = await _executor(hass, partial(tempfile.TemporaryFile, mode="w+b"), abandoned=lambda value: value.close())
                length = 0
                while True:
                    await fence.check(); chunk = await request.content.read(CHUNK); await fence.check()
                    if not chunk:
                        break
                    if not isinstance(chunk, bytes) or len(chunk) > CHUNK or length + len(chunk) > MAX_ARCHIVE_BYTES:
                        _fail("body_size", "ZIP exceeds its actual 512 MiB byte budget.")
                    length += len(chunk)
                    try:
                        await _executor(hass, stream.write, chunk, abandoned=lambda _result, owned=stream: owned.close())
                    except asyncio.CancelledError:
                        stream = None; raise
                    await fence.check()
                if not length:
                    _fail("body", "ZIP is empty.")
                stream.seek(0); owned, stream = stream, None  # Worker closes even after HTTP cancellation.
                data = await _executor(hass, inspect_and_close, owned); await fence.check()
                return web.Response(body=data, headers={"Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
            except (BackupHTTPError, DashboardBackupError, FurnitureStorageError, OSError, ValueError) as error:
                return failure(self, error)
            finally:
                if stream is not None:
                    stream.close()

    views = {"export": ExportView(), "inspect": InspectView()}
    for view in views.values():
        hass.http.register_view(view)
    hass.data[DATA_BACKUP_HTTP] = views
    return views
