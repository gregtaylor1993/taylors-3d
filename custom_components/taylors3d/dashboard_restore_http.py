"""FUTURE admin-only asset staging; no dashboard creation or registration on import.

POST /api/taylors3d/dashboard_backup/stage/<namespace>, application/zip, with
optional allow_incomplete=0|1. Stream bounded actual bytes; the global HA HTTP
limit is never changed. Raw archives are independently validated and planned.

Current public LayoutStore.get/set schedule persistence: no public flush exists.
Staging additionally requires its future public contains(key) contract; get()
alone cannot distinguish an absent key from a malformed persisted null slot.
Success verifies current shared values but does NOT claim crash-durable layouts,
an HA transaction/CAS, namespace reservation against other HA writers, or commit
authorization. restore_id is a diagnostic ID only. Frontend publication must
recheck its current admin/session and use official dashboard APIs separately.

Browser localStorage cannot be checked by a server. Missing layout descriptors
are rejected; every accepted new populated shared layout takes precedence over
unchanged browser fallbacks. Current all-user HA fallback keys are read through
the official frontend.storage.async_user_store API, never a fake WS connection.

Only new model files, public immutable furniture imports, and new shared layouts
are written. Failed/cancelled work can leave new staged orphans; nothing old is
deleted or rolled back. Descriptors reference original verified bytes; integrity
reads allocate another individual asset buffer. The archive core still retains
up to 512 MiB plus decoded JSON/response memory, alongside the spooled ZIP file.

Primary APIs inspected:
https://github.com/home-assistant/core/blob/dev/homeassistant/components/frontend/storage.py
https://github.com/home-assistant/core/blob/dev/homeassistant/components/frontend/__init__.py
https://github.com/home-assistant/core/blob/dev/homeassistant/components/lovelace/__init__.py
https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/storage.py
"""

from __future__ import annotations

import asyncio
from functools import partial
import hashlib
from itertools import islice
import json
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile
from typing import Any, Callable

from .const import DOMAIN
from .dashboard_backup import DashboardBackupError, MAX_ARCHIVE_BYTES, MAX_JSON_BYTES, MAX_MANIFEST_BYTES
from .dashboard_backup_http import AuthFence, BackupHTTPError, read_owned_model
from .dashboard_restore import DashboardRestoreError, DashboardRestorePlan, plan_dashboard_restore
from .furniture import DATA_FURNITURE, FurnitureLibrary, FurnitureStorageError

URL = "/api/taylors3d/dashboard_backup/stage"
DATA_RESTORE_HTTP = "taylors3d_dashboard_restore_http"
CHUNK = 64 * 1024
MAX_STAGE_RESPONSE = MAX_JSON_BYTES + MAX_MANIFEST_BYTES
MAX_NAMESPACES = 128
MAX_USERS = 1024
_NAMESPACE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$")
_KEY = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class RestoreHTTPError(ValueError):
    def __init__(self, code: str, message: str, path: str = ""):
        self.code, self.message, self.path = code, message, path
        super().__init__(message)


def _fail(code: str, message: str, path: str = "") -> None:
    raise RestoreHTTPError(code, message, path)


def _encode(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def stage_arguments(namespace: Any, query: Any) -> bool:
    """Reject malformed namespace/query before reading a potentially large body."""
    if type(namespace) is not str or not _NAMESPACE.fullmatch(namespace):
        _fail("namespace", "Use a lowercase 1..24-character alphanumeric/hyphen namespace.", "namespace")
    try:
        # A duplicate-bearing MultiDict is expected from HA. Read at most two
        # entries because every possible third entry is already invalid.
        entries = list(islice(query.items(), 2))
    except (AttributeError, TypeError):
        _fail("query", "Use the optional allow_incomplete=0|1 query only.", "query")
    if any(not isinstance(row, (tuple, list)) or len(row) != 2 for row in entries):
        _fail("query", "Query entries must have one exact key and value.", "query")
    if any(key != "allow_incomplete" for key, _value in entries) or len(entries) > 1:
        _fail("query", "Only one optional allow_incomplete=0|1 query value is supported.", "query")
    if entries and entries[0][1] not in ("0", "1"):
        _fail("query", "allow_incomplete must be exactly 0 or 1.", "allow_incomplete")
    return bool(entries and entries[0][1] == "1")


def _safe_model_path(path: Path) -> None:
    """Only caller's canonical ModelView path; config root remains HA-owned."""
    for folder in (path.parent.parent, path.parent):
        if folder.is_symlink() or folder.exists() and not folder.is_dir():
            _fail("unsafe_storage", "Owned model directories must be real directories.", "models")
    try:
        path.lstat()
    except FileNotFoundError:
        return
    _fail("collision", "The fresh model target already exists; choose a new namespace.", "models")


def stage_model_file(path: Path, body: bytes, digest: str) -> dict:
    """fsync a unique temporary, then atomically link ONLY to an absent target.

    os.link is an atomic exclusive publication on supported local filesystems.
    If hard links are unsupported, fail rather than overwrite/fallback-copy.
    A late I/O error can leave a new orphan, never replace an existing model.
    """
    if type(body) is not bytes or hashlib.sha256(body).hexdigest() != digest:
        _fail("asset_integrity", "Verified original model bytes changed before staging.", "models")
    _safe_model_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    _safe_model_path(path)
    temporary = None
    published = False
    try:
        with tempfile.NamedTemporaryFile(mode="w+b", dir=path.parent, prefix=".restore-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            for offset in range(0, len(body), CHUNK):
                stream.write(memoryview(body)[offset:offset + CHUNK])
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
            published = True
        except FileExistsError:
            _fail("collision", "The fresh model was created by another writer; nothing was overwritten.", "models")
        except OSError:
            _fail("exclusive_publication_unavailable", "This filesystem cannot atomically publish an exclusive new model; no overwrite fallback was used.", "models")
        actual = read_owned_model(path, len(body))
        if actual != body or hashlib.sha256(actual).hexdigest() != digest:
            _fail("asset_integrity", "The new model changed while verifying staged integrity.", "models")
        return {"sha256": digest, "bytes": len(body), "exclusive": True, "integrity_verified": True}
    except BaseException as error:
        if published:
            setattr(error, "published_new_model", True)
        raise
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)  # only our unique generated temporary
            except OSError as error:
                if published:
                    # Cleanup happens after the successful hard link too. Its
                    # failure must not erase evidence of a new published model.
                    error.published_new_model = True
                raise


async def _executor(hass: Any, function: Callable, *args, abandoned: Callable | None = None):
    job = asyncio.ensure_future(hass.async_add_executor_job(function, *args))
    try:
        return await asyncio.shield(job)
    except asyncio.CancelledError:
        def done(completed):
            try:
                result = completed.result()
                if abandoned is not None:
                    abandoned(result, None)
            except BaseException as error:
                if abandoned is not None:
                    abandoned(None, error)
        job.add_done_callback(done)
        raise


def plan_and_close(stream, namespace: str, allow_incomplete: bool) -> DashboardRestorePlan:
    try:
        return plan_dashboard_restore(stream, namespace, allow_incomplete=allow_incomplete)
    finally:
        stream.close()


async def spool_archive(hass, content, check: Callable):
    """Actual bounded body bytes; worker keeps temporary ownership on cancellation."""
    stream = await _executor(hass, partial(tempfile.TemporaryFile, mode="w+b"),
                             abandoned=lambda result, _error: result.close() if result else None)
    length = 0
    try:
        while True:
            await check()
            chunk = await content.read(CHUNK)
            await check()
            if not chunk:
                break
            if type(chunk) is not bytes or len(chunk) > CHUNK or length + len(chunk) > MAX_ARCHIVE_BYTES:
                _fail("body_size", "ZIP exceeds the actual bounded 512 MiB body budget.")
            length += len(chunk)
            try:
                await _executor(hass, stream.write, chunk, abandoned=lambda _result, _error, owned=stream: owned.close())
            except asyncio.CancelledError:
                stream = None
                raise
            await check()
        if not length:
            _fail("body", "The ZIP body is empty.")
        stream.seek(0)
        result, stream = stream, None
        return result
    finally:
        if stream is not None:
            stream.close()


class RestoreStager:
    """One HA-loop owner; public store/library APIs plus namespace-local locks."""

    def __init__(self, hass, store, library, model_path: Callable, platform_check: Callable):
        self.hass, self.store, self.library = hass, store, library
        self.model_path, self.platform_check = model_path, platform_check
        self.locks: dict[str, asyncio.Lock] = {}
        self.records: dict[str, dict] = {}

    def snapshot(self, namespace: str) -> dict | None:
        row = self.records.get(namespace)
        return json.loads(_encode(row)) if row else None

    async def _current(self, check: Callable) -> None:
        await check()
        if self.hass.data.get(DOMAIN) is not self.store:
            _fail("component_changed", "Shared Taylor storage changed during staging.")
        if self.library is not None and self.hass.data.get(DATA_FURNITURE) is not self.library:
            _fail("component_changed", "The furniture library changed during staging.")

    def _contains(self, key: str) -> bool:
        contains = getattr(self.store, "contains", None)
        if not callable(contains):
            _fail("unsupported_layout_store", "Shared storage needs a public contains(key) existence check before safe staging; no data was overwritten.", "layouts")
        present = contains(key)
        if type(present) is not bool:
            _fail("unsupported_layout_store", "The public shared-storage existence check must return an exact boolean.", "layouts")
        return present

    async def _preflight(self, plan, layouts, check, owned_layouts=None):
        await self._current(check)
        if not callable(getattr(self.store, "contains", None)):
            _fail("unsupported_layout_store", "Shared storage needs a public contains(key) existence check before safe staging; no data was overwritten.", "layouts")
        evidence = await self.platform_check(plan, check)
        await self._current(check)
        owned_layouts = {} if owned_layouts is None else owned_layouts
        for row in layouts:
            key = row["target_key"]
            present = self._contains(key)
            current = self.store.get(key)
            if key in owned_layouts:
                if not present or current is not owned_layouts[key] or _encode(current) != _encode(row["layout"]):
                    _fail("staged_changed", "A new shared staged layout changed before completion.", "layouts")
            elif present:
                _fail("collision", "The fresh shared layout target already exists.", "layouts")
            elif current is not None:
                _fail("unsupported_layout_store", "The public shared-storage existence and read APIs disagree.", "layouts")
        return evidence

    async def stage(self, plan: DashboardRestorePlan, namespace: str, check: Callable) -> dict:
        stage_arguments(namespace, {})
        if type(plan) is not DashboardRestorePlan or plan.target_dashboard["url_path"] != "taylors3d-restore-" + namespace:
            _fail("plan", "Use an independently validated plan for this exact namespace.")
        if namespace not in self.locks and len(self.locks) >= MAX_NAMESPACES:
            _fail("namespace_budget", "Too many staging namespaces; review earlier stages before retrying.")
        lock = self.locks.setdefault(namespace, asyncio.Lock())
        async with lock:
            if namespace in self.records:
                _fail("namespace_reserved", "This stage namespace was already used. Choose a new namespace; there is no overwrite/retry action.")
            layouts, models, packs = plan.layouts, plan.models, plan.furniture
            if any(not row["available"] for row in layouts):
                _fail("browser_fallback_unverifiable", "A missing shared layout could load old browser fallback data, which a server cannot inspect. Complete those layouts before staging.", "layouts")
            for row in layouts + models:
                if type(row["target_key"]) is not str or not _KEY.fullmatch(row["target_key"]):
                    _fail("plan", "The plan has a noncanonical owned target key.")
            if any(row["available"] for row in packs) and self.library is None:
                _fail("library_unavailable", "The public furniture library must be available before staging included packs.")
            evidence = await self._preflight(plan, layouts, check)
            # Each fresh layout key also owns its future ModelView namespace,
            # even if this archive contains no uploaded-model descriptor.
            model_paths = {row["target_key"]: self.model_path(row["target_key"]) for row in layouts + models}
            for path in model_paths.values():
                await _executor(self.hass, _safe_model_path, path)
                await self._current(check)
            if self.library is not None:
                catalogue = await _executor(self.hass, self.library.catalogue)
                await self._current(check)
                existing_packs = {row["pack_id"] for row in catalogue["packs"]}
                for row in packs:
                    if row["available"] and row["pack_id"] in existing_packs:
                        existing = await _executor(self.hass, self.library.archive, row["pack_id"])
                        await self._current(check)
                        if existing != row["original_bytes"]:
                            _fail("asset_integrity", "Published immutable pack bytes do not match the original verified archive.", "furniture")
            # Validate the complete JSON response budget before the first write.
            skeleton = {"target_dashboard": plan.target_dashboard, "save_message": plan.save_message,
                        "resources": plan.resources, "report": plan.report()}
            if len(_encode(skeleton)) + 128 * 1024 > MAX_STAGE_RESPONSE:
                _fail("response_size", "The defensive staging response exceeds its 36 MiB budget.")
            record = {"namespace": namespace, "restore_id": secrets.token_hex(16), "status": "staging",
                      "models": [], "layouts": [], "furniture": [], "orphans": []}
            self.records[namespace] = record
            owned_layouts = {}
            try:
                for row in models:
                    if not row["available"]:
                        continue
                    await self._current(check)
                    key = row["target_key"]
                    digest = row["source_member"]["sha256"]
                    def abandoned(result, error, key=key, digest=digest):
                        if result is not None or getattr(error, "published_new_model", False):
                            record["orphans"].append({"kind": "model", "target_key": key, "sha256": digest, "status": "cancelled_new_stage"})
                    try:
                        result = await _executor(self.hass, stage_model_file, model_paths[key], row["original_bytes"], digest, abandoned=abandoned)
                    except BaseException as error:
                        if getattr(error, "published_new_model", False):
                            record["orphans"].append({"kind": "model", "target_key": key, "sha256": digest, "status": "new_stage_integrity_failed"})
                        raise
                    record["models"].append({"target_key": key, **result})
                    await self._current(check)
                for row in packs:
                    if not row["available"]:
                        continue
                    await self._current(check)
                    pack_id = row["pack_id"]
                    def abandoned_pack(result, _error, pack_id=pack_id):
                        record["orphans"].append({"kind": "furniture", "pack_id": pack_id, "status": "publication_may_have_occurred" if result is None else "new_pack" if result["imported"] else "existing_immutable_pack"})
                    try:
                        result = await _executor(self.hass, self.library.import_pack, row["original_bytes"], abandoned=abandoned_pack)
                    except asyncio.CancelledError:
                        # The still-running shielded worker owns this outcome;
                        # its completion callback records the honest uncertainty.
                        raise
                    except Exception:
                        # Public immutable import can fail after publishing new
                        # files or its catalogue. Do not imply complete rollback.
                        record["orphans"].append({"kind": "furniture", "pack_id": pack_id,
                                                  "status": "publication_may_have_occurred"})
                        raise
                    record["furniture"].append({"pack_id": pack_id, "imported": result["imported"], "sha256": pack_id})
                    await self._current(check)
                    actual = await _executor(self.hass, self.library.archive, pack_id)
                    await self._current(check)
                    if actual != row["original_bytes"]:
                        _fail("asset_integrity", "The staged licensed pack differs from its exact original bytes.", "furniture")
                evidence = await self._preflight(plan, layouts, check)
                # A final read-only model collision check also covers missing
                # placeholders. Present rows must still be our exact new bytes.
                model_rows = {row["target_key"]: row for row in models}
                for key, path in model_paths.items():
                    row = model_rows.get(key)
                    if row is not None and row["available"]:
                        actual = await _executor(self.hass, read_owned_model, path, len(row["original_bytes"]))
                        await self._current(check)
                        if actual != row["original_bytes"]:
                            _fail("staged_changed", "A new staged model changed before layout publication.", "models")
                    else:
                        await _executor(self.hass, _safe_model_path, path)
                        await self._current(check)
                for row in layouts:
                    await self._current(check)
                    # No await between the final normal read and normal set:
                    # other HA-loop writers cannot interleave this pair.
                    key, layout = row["target_key"], row["layout"]
                    if self._contains(key):
                        _fail("collision", "A fresh shared layout target was created by another writer.", "layouts")
                    if self.store.get(key) is not None:
                        _fail("unsupported_layout_store", "The public shared-storage existence and read APIs disagree.", "layouts")
                    staged = {"target_key": key, "original_sha256": row["source_member"]["sha256"],
                              "staged_json_sha256": hashlib.sha256(_encode(layout)).hexdigest(), "persistence": "scheduled_not_durable"}
                    record["layouts"].append(staged)
                    self.store.set(key, layout)
                    owned_layouts[key] = layout
                    if not self._contains(key) or self.store.get(key) is not layout:
                        _fail("staged_changed", "Shared layout publication did not retain the expected exact raw data.", "layouts")
                evidence = await self._preflight(plan, layouts, check, owned_layouts)
                record["status"] = "staged"
                response = {"ok": True, "namespace": namespace, "restore_id": record["restore_id"],
                            **skeleton, "staging": {"models": record["models"], "layouts": record["layouts"], "furniture": record["furniture"],
                                "unavailable": [{"kind": kind, "source_key": row.get("source_key"), "pack_id": row.get("pack_id")}
                                                for kind, rows in (("model", models), ("furniture", packs)) for row in rows if not row["available"]],
                                "integrity_verified": True, "integrity_scope": "present_assets_and_populated_shared_layouts",
                                "layouts_persistence": "scheduled_not_durable", "dashboard_created": False,
                                "resources_installed": False, "collision_evidence": evidence}, "orphans": []}
                await self._current(check)
                encoded = _encode(response)
                if len(encoded) > MAX_STAGE_RESPONSE:
                    _fail("response_size", "The defensive staging response exceeds its 36 MiB budget.")
                return json.loads(encoded)
            except BaseException:
                record["status"] = "failed_or_cancelled"
                for kind, rows in (("model", record["models"]), ("layout", record["layouts"]), ("furniture", record["furniture"])):
                    record["orphans"].extend({"kind": kind, **row, "status": "staged_without_dashboard"} for row in rows
                                              if kind != "furniture" or row["imported"])
                raise


async def async_register_dashboard_restore(hass: Any) -> dict:
    """Explicit future registration only; no existing integration startup edit."""
    if DATA_RESTORE_HTTP in hass.data:
        return hass.data[DATA_RESTORE_HTTP]
    from http import HTTPStatus
    from aiohttp import web
    from homeassistant.components.http import HomeAssistantView, require_admin
    from homeassistant.components.http import const as http_const
    from homeassistant.components.frontend import async_panel_exists
    from homeassistant.components.frontend.storage import async_user_store
    from homeassistant.components.lovelace.const import LOVELACE_DATA
    from . import LayoutStore
    from .model import model_path

    def fence_for(request):
        return AuthFence(hass, request, admin=True, user_key=http_const.KEY_HASS_USER,
                         token_key=http_const.KEY_HASS_REFRESH_TOKEN_ID,
                         supervisor_check=getattr(http_const, "is_supervisor_unix_socket_request", lambda _request: False),
                         supervisor_user_key=getattr(http_const, "DATA_SUPERVISOR_USER", None))

    async def platform_check(plan, check):
        await check()
        data = hass.data.get(LOVELACE_DATA)
        dashboards = getattr(data, "dashboards", None)
        yaml_dashboards = getattr(data, "yaml_dashboards", None)
        if type(dashboards) is not dict or type(yaml_dashboards) is not dict:
            _fail("platform_unavailable", "Actual Lovelace dashboard data is unavailable; namespace absence cannot be proven.")
        path = plan.target_dashboard["url_path"]
        if path in dashboards or path in yaml_dashboards or async_panel_exists(hass, path):
            _fail("collision", "The new dashboard address is already in use.", "dashboard")
        users = await hass.auth.async_get_users()
        await check()
        if len(users) > MAX_USERS:
            _fail("platform_budget", "The bounded all-user fallback collision check cannot cover this account count.")
        keys = plan.report()["collision_targets"]["legacy_fallback_keys"]
        for user in users:
            if not isinstance(user.id, str) or not user.id.strip():
                _fail("platform_unavailable", "Actual user-storage identity is unavailable.")
            store = await async_user_store(hass, user.id)
            await check()
            if type(store.data) is not dict:
                _fail("platform_unavailable", "Actual per-user frontend storage cannot be checked.")
            if any(key in store.data for key in keys):
                _fail("collision", "A new target has an existing per-user Taylor fallback. Choose a fresh namespace.", "user_data")
        if hass.data.get(LOVELACE_DATA) is not data or path in dashboards or path in yaml_dashboards or async_panel_exists(hass, path):
            _fail("collision", "Dashboard namespace changed during collision checking.", "dashboard")
        return {"dashboard": "absent_at_check", "user_fallbacks": "all_current_users_absent_at_check",
                "browser": "not_read;unchanged_and_shadowed_by_populated_shared_layouts", "transaction": False}

    class StageView(HomeAssistantView):
        url = URL + "/{namespace}"
        name = "api:taylors3d:dashboard_backup:stage"
        requires_auth = True

        def __init__(self):
            self.stagers = {}

        @require_admin
        async def post(self, request, namespace):
            fence, stream, stager = fence_for(request), None, None
            try:
                await fence.check()
                allow = stage_arguments(namespace, request.query)
                if request.content_type != "application/zip" or request.headers.get("Content-Encoding", "identity").lower() != "identity":
                    _fail("content_type", "Use an uncompressed application/zip request body.")
                if request.content_length is not None and request.content_length > MAX_ARCHIVE_BYTES:
                    _fail("body_size", "ZIP exceeds the 512 MiB declared body budget.")
                stream = await spool_archive(hass, request.content, fence.check)
                owned, stream = stream, None
                plan = await _executor(hass, plan_and_close, owned, namespace, allow)
                await fence.check()
                store, library = hass.data.get(DOMAIN), hass.data.get(DATA_FURNITURE)
                if not isinstance(store, LayoutStore) or library is not None and not isinstance(library, FurnitureLibrary):
                    _fail("component_unavailable", "Actual shared Taylor storage/public furniture library is unavailable.")
                identity = (id(store), id(library))
                if identity not in self.stagers:
                    if self.stagers:
                        _fail("component_changed", "Restore storage identity changed; restart this unregistered staging owner before proceeding.")
                    self.stagers[identity] = RestoreStager(hass, store, library, partial(model_path, hass), platform_check)
                stager = self.stagers[identity]
                result = await stager.stage(plan, namespace, fence.check)
                await fence.check()
                return web.Response(body=_encode(result), headers={"Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
            except (RestoreHTTPError, DashboardRestoreError, DashboardBackupError, BackupHTTPError, FurnitureStorageError, OSError, ValueError) as error:
                code = getattr(error, "code", "storage")
                status = HTTPStatus.BAD_REQUEST
                if code == "auth":
                    status = HTTPStatus.UNAUTHORIZED
                elif code == "content_type":
                    status = HTTPStatus.UNSUPPORTED_MEDIA_TYPE
                elif code in ("body_size", "archive_size", "total_budget", "wire_budget", "response_size"):
                    status = HTTPStatus.REQUEST_ENTITY_TOO_LARGE
                elif code in ("collision", "namespace_reserved", "component_changed", "staged_changed", "unsafe_storage", "asset_integrity", "corrupt_storage", "corrupt_catalogue", "unsupported_layout_store"):
                    status = HTTPStatus.CONFLICT
                elif code == "namespace_budget":
                    status = HTTPStatus.TOO_MANY_REQUESTS
                record = stager.snapshot(namespace) if stager else None
                result = {"ok": False, "error": code, "path": getattr(error, "path", ""),
                          "message": getattr(error, "message", "Owned restore storage is unavailable; existing data was not rolled back or overwritten."),
                          "namespace": namespace, "restore_id": record.get("restore_id") if record else None,
                          "staging": {kind: record.get(kind, []) if record else [] for kind in ("models", "layouts", "furniture")},
                          "orphans": record.get("orphans", []) if record else [], "publication_available": False}
                return web.Response(body=_encode(result), status=status, headers={"Content-Type": "application/json", "Cache-Control": "private, no-store"})
            finally:
                if stream is not None:
                    stream.close()

    view = StageView()
    hass.http.register_view(view)
    result = {"stage": view}
    hass.data[DATA_RESTORE_HTTP] = result
    return result
