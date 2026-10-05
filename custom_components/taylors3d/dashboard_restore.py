"""Local-only F04 restore planning; no Home Assistant imports or publication.

Only exact Taylor card storage keys and verified integration-owned model paths
change. The original raw members remain immutable provenance. A successful plan
is NOT permission to publish and does not prove that its namespace is unused.
All layouts are planned for new shared integration keys: the current card reads
shared storage first; it has no configurable browser/user storage selector.

Assets are referenced without copying their bytes. The archive validator retains
up to 512 MiB, and defensive decoded JSON/staged JSON can require extra memory.
No filesystem extraction, arbitrary URL fetching or card instantiation occurs.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
from types import MappingProxyType
from typing import Any, BinaryIO, Mapping

from .dashboard_backup import (
    DashboardBackup,
    MAX_DASHBOARD_WIRE_BYTES,
    MAX_EXPANDED_BYTES,
    MAX_JSON_DEPTH,
    MAX_JSON_VALUES,
    MAX_LAYOUTS,
    MAX_MEMBERS,
    MAX_MODELS,
    create_dashboard_backup,
    validate_dashboard_backup,
)

_NAMESPACE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$")
_OWNED_MODEL = re.compile(r"^/api/taylors3d/model/([A-Za-z0-9_-]{1,64})(\?v=[^\s?#&]+)?$")
_SHA = re.compile(r"^[0-9a-f]{64}$")


class DashboardRestoreError(ValueError):
    """A bounded, explicit reason that an unchanged restore cannot be planned."""

    def __init__(self, code: str, path: str, message: str):
        self.code, self.path, self.message = code, path, message
        super().__init__(message)


def _fail(code: str, path: str, message: str) -> None:
    raise DashboardRestoreError(code, path, message)


def _encode(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


class _CountingOutput:
    """Public core revalidation without a second 512 MiB ZIP allocation."""

    def __init__(self):
        self.position = self.length = 0

    def tell(self) -> int:
        return self.position

    def seek(self, offset: int, whence: int = 0) -> int:
        self.position = offset + (self.position if whence == 1 else self.length if whence == 2 else 0)
        if self.position < 0:
            raise ValueError("negative offset")
        return self.position

    def write(self, data: bytes) -> int:
        size = len(data)
        self.position += size
        self.length = max(self.length, self.position)
        return size

    def flush(self) -> None:
        pass


def _verified(value: DashboardBackup | bytes | BinaryIO) -> tuple[DashboardBackup, dict]:
    if type(value) is DashboardBackup:
        # The public dataclass constructor is not a verification boundary. Take
        # an immutable byte-only snapshot and ask the public writer to recheck
        # its contents. Never trust a forged _report_json/complete flag.
        members = value.members
        if type(members) is not MappingProxyType or len(members) > MAX_MEMBERS or any(type(name) is not str or type(body) is not bytes for name, body in members.items()):
            _fail("backup_input", "backup", "Supply sealed immutable backup member bytes or a validated ZIP stream.")
        if sum(map(len, members.values())) > MAX_EXPANDED_BYTES:
            _fail("backup_input", "backup", "Sealed input members exceed the archive's verified expanded-byte budget.")
        snapshot = DashboardBackup(MappingProxyType(dict(members)), b"{}")
        report = create_dashboard_backup(snapshot, _CountingOutput())
        return snapshot, report
    verified = validate_dashboard_backup(value)
    return verified, verified.report()


def _target_key(namespace: str, source_key: str) -> str:
    prefix = "restore_" + namespace + "_"
    return prefix + hashlib.sha256(source_key.encode("utf-8")).hexdigest()[:64 - len(prefix)]


def _pointer(dashboard: dict, pointer: str) -> dict:
    node: Any = dashboard
    if pointer:
        for part in pointer[1:].split("/"):
            token = part.replace("~1", "/").replace("~0", "~")
            node = node[int(token)] if isinstance(node, list) else node[token]
    if type(node) is not dict or node.get("type") != "custom:taylors3d-card":
        _fail("card_pointer", pointer, "The validated pointer no longer selects an exact Taylor card.")
    return node


def _issue(code: str, path: str, message: str, severity: str = "warning") -> dict:
    return {"code": code, "path": path, "message": message, "severity": severity}


def _dashboard_budget(value: dict) -> None:
    """Added default keys must still fit the archive's raw JSON tree budgets."""
    pending = [(value, 0)]
    count = 0
    while pending:
        node, depth = pending.pop()
        count += 1
        if count > MAX_JSON_VALUES or depth > MAX_JSON_DEPTH:
            _fail("json_budget", "dashboard", "Rewritten dashboard exceeds the core JSON value/depth budget; no fields are dropped.")
        if type(node) is dict:
            pending.extend((child, depth + 1) for pair in node.items() for child in pair)
        elif type(node) is list:
            pending.extend((child, depth + 1) for child in node)


@dataclass(frozen=True, slots=True)
class DashboardRestorePlan:
    """Defensive JSON views plus original immutable asset/member byte references."""

    _json: bytes
    _members: Mapping[str, bytes]

    def _value(self, name: str) -> Any:
        return json.loads(self._json)[name]

    @property
    def dashboard(self) -> dict:
        return self._value("dashboard")

    @property
    def save_message(self) -> dict:
        return self._value("save_message")

    @property
    def target_dashboard(self) -> dict:
        return self._value("target_dashboard")

    @property
    def resources(self) -> dict:
        return self._value("resources")

    @property
    def provenance(self) -> dict:
        return self._value("provenance")

    @property
    def original_dashboard_bytes(self) -> bytes:
        return self._members["dashboard.json"]

    @property
    def original_manifest_bytes(self) -> bytes:
        return self._members["manifest.json"]

    def _staging(self, name: str) -> list[dict]:
        rows = self._value(name)
        for row in rows:
            member = row.get("source_member")
            body = self._members[member["path"]] if member is not None else None
            row["original_bytes"] = body
            if name == "layouts":
                row["staged_bytes"] = body
        return rows

    @property
    def layouts(self) -> list[dict]:
        return self._staging("layouts")

    @property
    def models(self) -> list[dict]:
        return self._staging("models")

    @property
    def furniture(self) -> list[dict]:
        return self._staging("furniture")

    def report(self) -> dict:
        return self._value("report")


def plan_dashboard_restore(value: DashboardBackup | bytes | BinaryIO, namespace: str, *, allow_incomplete: bool = False) -> DashboardRestorePlan:
    """Prepare a NEW storage dashboard and collision-checkable shared targets.

    ``namespace`` is an explicit lowercase 1..24-character slug. Its freshness
    must be checked against current HA/layout/model storage before publication.
    Missing references need a deliberate ``allow_incomplete=True`` and keep their
    exact IDs; missing owned models point at fresh, deliberately empty targets.
    Unknown/foreign resources are preview declarations, never installation work.
    """
    if type(namespace) is not str or not _NAMESPACE.fullmatch(namespace):
        _fail("namespace", "namespace", "Use an explicit lowercase alphanumeric/hyphen slug of 1..24 characters with alphanumeric ends.")
    if type(allow_incomplete) is not bool:
        _fail("allow_incomplete", "allow_incomplete", "Allowing missing references requires an explicit boolean.")
    verified, verification = _verified(value)
    manifest, dashboard, members = verified.manifest, verified.dashboard, verified.members
    complete = verification["complete"]
    if not complete and not allow_incomplete:
        _fail("incomplete_backup", "backup", "This backup has missing/invalid references. Review them before explicitly planning an incomplete restore.")
    diagnostics = list(verification["diagnostics"])
    if not complete:
        diagnostics.append(_issue("incomplete_allowed", "backup", "Missing references remain unresolved; this plan must never be described as a complete recovery."))
    source = manifest["dashboard"]
    target_path = "taylors3d-restore-" + namespace
    if target_path == source["url_path"]:
        _fail("source_dashboard_collision", "dashboard", "This namespace would reuse the old captured dashboard address. Choose another namespace for a NEW dashboard.")
    if source["mode"] != "storage":
        diagnostics.append(_issue("storage_conversion", "dashboard", "The captured raw " + source["mode"] + " configuration will become a NEW storage dashboard; YAML files/comments are not restored."))

    layout_rows = {row["key"]: row for row in manifest["layouts"]}
    model_rows = {row["layout_key"]: row for row in manifest["models"]}
    keys: list[str] = []
    for card in manifest["cards"]:
        key = card["layout_key"]
        if key is None:
            _fail("layout_key", card["pointer"] + "/layout_key", "An invalid explicit Taylor layout key cannot be safely remapped; repair the captured source or use another backup.")
        if key not in keys:
            keys.append(key)
    if len(keys) > MAX_LAYOUTS:
        _fail("layout_count", "layouts", "Too many distinct restored layout targets.")
    key_map = {key: _target_key(namespace, key) for key in keys}
    model_map = {key: key_map[key] for key in model_rows}
    patches: list[dict] = []
    for card in manifest["cards"]:
        node, key, pointer = _pointer(dashboard, card["pointer"]), card["layout_key"], card["pointer"]
        old_present = "layout_key" in node
        old_key = node.get("layout_key", "default")
        node["layout_key"] = key_map[key]
        patches.append({"pointer": pointer + "/layout_key", "before": old_key, "before_present": old_present,
                        "after": key_map[key], "reason": "new_shared_key"})
        url = node.get("model")
        owned = _OWNED_MODEL.fullmatch(url) if type(url) is str else None
        if owned:
            model_key, query = owned.groups()
            model_map.setdefault(model_key, key_map.get(model_key, _target_key(namespace, model_key)))
            available = model_key in model_rows
            if not available and not allow_incomplete:
                _fail("owned_model_missing", pointer + "/model", "This integration-owned model URL has no original asset in the archive. A new unpopulated target requires explicit incomplete planning.")
            node["model"] = "/api/taylors3d/model/" + model_map[model_key] + (query or "")
            patches.append({"pointer": pointer + "/model", "before": url, "after": node["model"],
                            "reason": "verified_model_asset" if available else "new_unpopulated_model"})
            if available:
                diagnostics = [dict(row, code="model_dependency_resolved", severity="info", source_severity=row["severity"],
                                    message="The exact owned model dependency is staged under a new verified target; original diagnostics remain in archive provenance.")
                               if row["code"] == "model_dependency" and row["path"] == pointer + "/model" and row["severity"] == "dependency"
                               else row for row in diagnostics]
            if not available:
                diagnostics.append(_issue("owned_model_unpopulated", pointer + "/model", "Original owned-model bytes are missing. The fresh target is intentionally empty; the old mutable model will not be used.", "missing"))
        elif type(url) is str and url.startswith("/api/taylors3d/model/"):
            # An encoded/unsupported query or alias cannot remain accidentally
            # attached to mutable old Integration storage after restore.
            _fail("owned_model_url", pointer + "/model", "This noncanonical integration-owned model URL cannot be mapped exactly; repair or recapture it first.")

    layouts: list[dict] = []
    models: list[dict] = []
    for key in keys:
        row = layout_rows.get(key)
        layouts.append({"source_key": key, "target_key": key_map[key], "available": row is not None,
                        "source_backend": row["backend"] if row else None, "target_backend": "shared",
                        "source_member": row["file"] if row else None, "metadata": row["metadata"] if row else None,
                        "layout": json.loads(members[row["file"]["path"]]) if row else None, "patches": []})
        if row and row["backend"] != "shared":
            diagnostics.append(_issue("storage_promoted", key, "The captured " + row["backend"] + " layout is explicitly staged in NEW shared integration storage; its original bytes and provenance are retained."))
        if row:
            model = layouts[-1]["layout"].get("model")
            if type(model) is dict and model.get("version") is not None and model.get("version") is not False and model.get("version") != 0 and model.get("version") != "":
                model_map.setdefault(key, key_map[key])
    if any(not row["available"] for row in layouts):
        diagnostics.append(_issue("fallback_collision_review", "layouts", "Unpopulated shared keys can trigger the current card's per-user/browser fallback. Verify all listed legacy fallback keys are absent before any incomplete publication."))
    if len(model_map) > MAX_MODELS:
        _fail("model_count", "models", "Too many distinct fresh model targets.")
    all_keys = {**key_map, **model_map}
    if any(not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", key) for key in all_keys.values()) or len(set(all_keys.values())) != len(all_keys):
        _fail("namespace_collision", "targets", "Generated keys are not internally unique within the Integration's 64-character budget.")
    if set(all_keys.values()) & all_keys.keys():
        _fail("source_key_collision", "targets", "This namespace would reuse an old archived layout/model key. Choose another namespace; old source keys must remain untouched.")
    for key, target in model_map.items():
        row = model_rows.get(key)
        models.append({"source_key": key, "target_key": target, "available": row is not None,
                       "source_member": row["file"] if row else None, "metadata": row["metadata"] if row else None})
    complete = complete and all(row["available"] for row in layouts + models)
    if not complete and not any(row["code"] == "incomplete_allowed" for row in diagnostics):
        diagnostics.append(_issue("incomplete_allowed", "backup", "A missing owned-model dependency is planned as a fresh empty target; this is an explicitly incomplete recovery."))
    pack_rows = {row["pack_id"]: row for row in manifest["furniture"]}
    pack_references: dict[str, list[dict]] = {}
    for row in layouts:
        furniture_config = row["layout"].get("furniture") if row["layout"] is not None else None
        if type(furniture_config) is not dict or type(furniture_config.get("instances")) is not list:
            continue
        for index, instance in enumerate(furniture_config["instances"]):
            if type(instance) is dict and type(instance.get("pack_id")) is str and _SHA.fullmatch(instance["pack_id"]) and type(instance.get("asset_sha256")) is str and _SHA.fullmatch(instance["asset_sha256"]) and type(instance.get("item_id")) is str:
                pack_references.setdefault(instance["pack_id"], []).append({"source_layout_key": row["source_key"], "instance_index": index,
                                                                            "item_id": instance["item_id"], "asset_sha256": instance["asset_sha256"]})
    furniture = []
    for pack_id in list(pack_rows) + [key for key in pack_references if key not in pack_rows]:
        row = pack_rows.get(pack_id)
        furniture.append({"pack_id": pack_id, "available": row is not None, "source_member": row["file"] if row else None,
                          "metadata": row["metadata"] if row else None, "source_references": pack_references.get(pack_id, []),
                          "publication": "validate_exact_immutable_identity_before_staging" if row else "unresolved_original_pack"})
    complete = complete and all(row["available"] for row in furniture)
    _dashboard_budget(dashboard)
    save_message = {"id": 1, "type": "lovelace/config/save", "url_path": target_path, "config": dashboard}
    wire_size = len(_encode(save_message))
    if wire_size > MAX_DASHBOARD_WIRE_BYTES:
        _fail("wire_budget", "dashboard", "The rewritten NEW-dashboard save envelope exceeds the 3 MiB UTF-8 budget; no truncated dashboard is planned.")
    report = {"valid": True, "complete": complete, "archive_complete": verification["complete"], "allow_incomplete": allow_incomplete,
              "publication_available": False, "collision_checked": {"internal": True, "external": False},
              "requires_shared_integration": True, "requires_current_admin_at_publication": True,
              "resources_installed": False, "dependency_scope": "declared_archive_dependencies",
              "dependency_free": not any(row["severity"] in ("missing", "dependency") for row in diagnostics),
              "diagnostics": diagnostics, "patches": patches, "save_wire_bytes": wire_size,
              "counts": {"cards": len(manifest["cards"]), "layouts": len(layouts), "models": len(models), "furniture_packs": len(furniture)},
              "collision_targets": {"dashboard_url_path": target_path, "layout_keys": list(key_map.values()), "model_keys": list(model_map.values()),
                                    "legacy_fallback_keys": ["taylors3d_" + key for key in key_map.values()]}}
    payload = {"dashboard": dashboard, "save_message": save_message,
               "target_dashboard": {"url_path": target_path, "mode": "storage", "title": "Taylor's 3D restore (" + namespace + ")"},
               "layouts": layouts, "models": models, "furniture": furniture, "resources": manifest["resources"],
               "provenance": {"format": manifest["format"], "version": manifest["version"], "created_at": manifest["created_at"],
                              "producer": manifest["producer"], "dashboard": source, "source_manifest": manifest,
                              "archive_report": verification}, "report": report}
    return DashboardRestorePlan(_encode(payload), MappingProxyType(dict(members)))
