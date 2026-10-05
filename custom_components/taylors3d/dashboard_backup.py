"""FUTURE, unregistered v1 selected-dashboard interchange. Pure stdlib only.

No HA imports, file-path reads, extraction, network, remapping, card creation or
restore writes occur. Callers supply snapshots and original asset bytes. A ZIP
is streamed to an EMPTY supplied seekable binary file; validation reads only a
supplied stream/bytes. Validated member bytes are retained, so worst-case member
memory is bounded by 512 MiB (plus caller bytes, parsed JSON and one pack's
validation work). This is not a browser-memory or atomic-restore guarantee.

``complete`` means referenced Taylor-owned payloads are present and consistent;
external models/resources remain explicit dependencies even when complete.
Only ``report()``/``complete`` are validated truth, never an imported flag alone.
House GLB framing is checked, not renderer/texture capabilities. Furniture uses
the existing static-pack validator, preserving original ZIP/licence bytes.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import re
import stat
import struct
from types import MappingProxyType
from typing import Any, BinaryIO
import zipfile
import zlib

from .furniture_pack import FurniturePackError, validate_furniture_pack

FORMAT = "taylors3d-dashboard-backup"
VERSION = 1
MiB = 1024 * 1024
MAX_ARCHIVE_BYTES = MAX_EXPANDED_BYTES = 512 * MiB
MAX_LAYOUTS = MAX_MODELS = 64
MAX_PACKS = 128
MAX_CARD_REFERENCES = 4096
MAX_MEMBERS = 2 + MAX_LAYOUTS + MAX_MODELS + MAX_PACKS
MAX_MANIFEST_BYTES = 4 * MiB
MAX_JSON_BYTES = 32 * MiB
MAX_DASHBOARD_WIRE_BYTES = 3 * MiB
MAX_LAYOUT_BYTES = 2_000_000
MAX_MODEL_BYTES = 100 * MiB
MAX_PACK_BYTES = 64 * MiB
MAX_JSON_DEPTH = 64
MAX_JSON_VALUES = 250_000
MAX_DIAGNOSTICS = 4096
CHUNK = 64 * 1024
_SHA = re.compile(r"^[0-9a-f]{64}$")
_UTC_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$")
_MEMBER = re.compile(r"^(?:manifest\.json|dashboard\.json|layouts/[0-9a-f]{64}\.json|models/[0-9a-f]{64}\.glb|furniture/[0-9a-f]{64}\.zip)$")


class DashboardBackupError(ValueError):
    """Stable failure code/path; messages never include transport credentials."""

    def __init__(self, code: str, path: str, message: str) -> None:
        self.code, self.path, self.message = code, path, message
        super().__init__(f"{path}: {message}")


def _fail(code: str, path: str, message: str) -> None:
    raise DashboardBackupError(code, path, message)


def _object(value: Any, path: str) -> dict[str, Any]:
    if type(value) is not dict:
        _fail("shape", path, "Expected a JSON object.")
    return value


def _text(value: Any, path: str, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value):
        _fail("text", path, f"Use nonblank text of at most {maximum} characters without control characters.")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        _fail("utf8", path, "Text must be valid Unicode.")
    return value


def _key(value: Any, path: str) -> str:
    return _text(value, path, 64)


def _tree(value: Any, path: str, text_budget: int | None = None) -> None:
    """Bound source objects before serialization; reject cycles/coercions."""
    pending = [(value, 0, frozenset())]
    count = characters = 0
    while pending:
        item, depth, ancestors = pending.pop()
        count += 1
        if depth > MAX_JSON_DEPTH or count > MAX_JSON_VALUES:
            _fail("json_complexity", path, "JSON exceeds its depth/value budget.")
        if type(item) in (dict, list):
            if id(item) in ancestors:
                _fail("json_cycle", path, "Cyclic source objects cannot be backed up.")
            owners = ancestors | {id(item)}
            if type(item) is dict:
                if any(type(key) is not str for key in item):
                    _fail("json_key", path, "JSON object keys must be strings.")
                pending.extend((child, depth + 1, owners) for pair in item.items() for child in pair)
            else:
                pending.extend((child, depth + 1, owners) for child in item)
        elif type(item) is float and not math.isfinite(item):
            _fail("json_number", path, "Nonfinite JSON numbers are not supported.")
        elif type(item) is str:
            characters += len(item)
            if text_budget is not None and characters > text_budget:
                _fail("json_size", path, "Source text exceeds its JSON member budget.")
            try:
                item.encode("utf-8")
            except UnicodeEncodeError:
                _fail("utf8", path, "JSON strings must be valid Unicode.")
        elif type(item) not in (str, int, float, bool, type(None)):
            _fail("json_type", path, "Use only JSON values, without implicit conversion.")


def _json(data: bytes, path: str, maximum: int) -> dict[str, Any]:
    if len(data) > maximum:
        _fail("json_size", path, "JSON exceeds its byte budget.")

    def pairs(entries: list[tuple[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, item in entries:
            if key in out:
                _fail("duplicate_json_key", path, "Duplicate JSON keys are not supported.")
            out[key] = item
        return out

    def constant(_: str) -> None:
        _fail("json_number", path, "Nonfinite JSON numbers are not supported.")

    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
        if isinstance(error, DashboardBackupError):
            raise
        _fail("json", path, "Expected bounded, complete UTF-8 JSON.")
    _tree(value, path)
    return _object(value, path)


def _encoded(value: Any, path: str, maximum: int) -> tuple[bytes, dict[str, Any]]:
    if isinstance(value, (bytes, bytearray, memoryview)):
        if (value.nbytes if isinstance(value, memoryview) else len(value)) > maximum:
            _fail("json_size", path, "JSON exceeds its byte budget.")
        data = bytes(value)
        return data, _json(data, path, maximum)
    _tree(value, path, maximum)
    _object(value, path)
    try:
        data = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (ValueError, RecursionError):
        _fail("json", path, "Expected bounded JSON.")
    return data, _json(data, path, maximum)


def _copy(value: Any) -> Any:
    _tree(value, "snapshot", MAX_JSON_BYTES)
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))
    except (ValueError, RecursionError):
        _fail("json", "snapshot", "Expected bounded JSON snapshot values.")


def _bytes(value: Any, path: str, maximum: int) -> bytes:
    if not isinstance(value, (bytes, bytearray, memoryview)) or not 0 < (value.nbytes if isinstance(value, memoryview) else len(value)) <= maximum:
        _fail("asset_size", path, "Expected original bytes within the member budget.")
    return bytes(value)


def _file(path: str, data: bytes) -> dict[str, Any]:
    return {"path": path, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _layout_path(key: str) -> str:
    return "layouts/" + hashlib.sha256(key.encode("utf-8")).hexdigest() + ".json"


def _diagnostic(code: str, path: str, message: str, severity: str = "missing") -> dict[str, str]:
    return {"code": code, "path": path, "message": message, "severity": severity}


def _js_truthy(value: Any) -> bool:
    """Match the real card's JSON-value `if` semantics, without coercion.

    Empty arrays/objects are TRUE in JS, unlike Python. Nonfinite source values
    were rejected already. Missing/null, false, numeric zero and empty text are
    the only false JSON values; an explicit malformed true value cannot select
    a different source by falling back.
    """
    if value is None or value is False:
        return False
    if type(value) in (int, float):
        return value != 0
    if isinstance(value, str):
        return bool(value)
    return True


def _cards(dashboard: dict[str, Any]) -> list[dict[str, Any]]:
    """Exact typed entries anywhere in raw JSON, including unknown wrappers."""
    result = []
    pending = [(dashboard, "")]
    while pending:
        item, pointer = pending.pop()
        if isinstance(item, dict):
            if item.get("type") == "custom:taylors3d-card":
                key = item.get("layout_key", "default")
                try:
                    _key(key, pointer + "/layout_key")
                except DashboardBackupError:
                    key = None
                result.append({"pointer": pointer, "layout_key": key})
            for key, child in reversed(list(item.items())):
                pending.append((child, pointer + "/" + key.replace("~", "~0").replace("/", "~1")))
        elif isinstance(item, list):
            for index in range(len(item) - 1, -1, -1):
                pending.append((item[index], pointer + "/" + str(index)))
    if len(result) > MAX_CARD_REFERENCES:
        _fail("card_budget", "dashboard", "Too many Taylor card references.")
    return result


def _pointer(value: dict[str, Any], pointer: str) -> dict[str, Any]:
    # Pointers are checked against _cards' canonical spelling, not coerced.
    item: Any = value
    if pointer:
        for token in pointer[1:].split("/"):
            token = token.replace("~1", "/").replace("~0", "~")
            item = item[int(token)] if isinstance(item, list) else item[token]
    return item


def _resources(value: Any) -> dict[str, Any]:
    value = _object(value, "resources")
    if value.get("mode") not in ("yaml", "storage") or not isinstance(value.get("items"), list) or len(value["items"]) > 4096:
        _fail("resources", "resources", "Supply the actual resource mode and bounded raw resource list.")
    for index, item in enumerate(value["items"]):
        _object(item, f"resources.items[{index}]")
        _text(item.get("url"), f"resources.items[{index}].url", 4096)
        if item.get("type") not in ("css", "js", "module", "html"):
            _fail("resources", f"resources.items[{index}].type", "Unsupported resource reference type.")
    return value


def _refs(dashboard: dict[str, Any], layouts: Mapping[str, dict[str, Any]], resources: dict[str, Any]) -> tuple[list, set, dict, list]:
    cards = _cards(dashboard)
    if len({card["layout_key"] for card in cards if card["layout_key"] is not None}) > MAX_LAYOUTS:
        _fail("count", "cards", "At most 64 distinct referenced layout keys are supported.")
    model_keys: set[str] = set()
    packs: dict[str, list[tuple[str, dict]]] = {}
    issues = []
    for card in cards:
        key, pointer = card["layout_key"], card["pointer"]
        raw = _pointer(dashboard, pointer)
        if key is None:
            issues.append(_diagnostic("layout_key", pointer, "This Taylor card has an invalid explicit layout key; no replacement was guessed."))
        elif key not in layouts:
            issues.append(_diagnostic("layout_missing", pointer, "The referenced Taylor layout snapshot was not supplied."))
        if _js_truthy(raw.get("model")):
            if not isinstance(raw["model"], str) or not raw["model"].strip():
                issues.append(_diagnostic("model_reference", pointer + "/model", "The explicit model source is malformed; its raw value is preserved."))
            else:
                issues.append(_diagnostic("model_dependency", pointer + "/model", "The explicit model source remains an unchanged dependency; no URL was downloaded.", "dependency"))
        elif key in layouts and isinstance(layouts[key].get("model"), dict) and _js_truthy(layouts[key]["model"].get("version")):
            model_keys.add(key)
            version = layouts[key]["model"]["version"]
            if not isinstance(version, str) or not version.strip():
                issues.append(_diagnostic("model_version", _layout_path(key), "The uploaded-model version is malformed; its exact raw reference and original bytes are retained."))
    for key, layout in layouts.items():
        furniture = layout.get("furniture")
        if furniture is None:
            continue
        if not isinstance(furniture, dict) or furniture.get("version") != 1 or type(furniture.get("version")) is not int or not isinstance(furniture.get("instances"), list) or len(furniture["instances"]) > 128:
            issues.append(_diagnostic("furniture_reference", _layout_path(key), "Saved furniture references are malformed; the raw layout is preserved."))
            continue
        for index, instance in enumerate(furniture["instances"]):
            path = _layout_path(key) + f"#/furniture/instances/{index}"
            if not isinstance(instance, dict) or not isinstance(instance.get("pack_id"), str) or not _SHA.fullmatch(instance["pack_id"]) or not isinstance(instance.get("asset_sha256"), str) or not _SHA.fullmatch(instance["asset_sha256"]) or not isinstance(instance.get("item_id"), str):
                issues.append(_diagnostic("furniture_reference", path, "The exact saved pack/item/hash reference is invalid; no substitute was guessed."))
            else:
                packs.setdefault(instance["pack_id"], []).append((path, instance))
                if len(packs) > MAX_PACKS:
                    _fail("count", "furniture", "At most 128 distinct referenced original packs are supported.")
    for index in range(len(resources["items"])):
        issues.append(_diagnostic("resource_dependency", f"resources.items[{index}]", "This unchanged dashboard resource reference requires its separately installed source.", "dependency"))
    return cards, model_keys, packs, issues


def _model(data: bytes, path: str) -> None:
    if len(data) < 20 or data[:4] != b"glTF" or struct.unpack_from("<II", data, 4) != (2, len(data)) or len(data) % 4:
        _fail("model", path, "Expected original complete binary glTF 2.0 framing.")
    offset, first = 12, True
    while offset < len(data):
        if offset + 8 > len(data):
            _fail("model", path, "Truncated GLB chunk header.")
        length, kind = struct.unpack_from("<II", data, offset)
        if length % 4 or offset + 8 + length > len(data) or first and (kind != 0x4E4F534A or not length):
            _fail("model", path, "Invalid GLB chunk framing or initial JSON chunk.")
        first = False
        offset += 8 + length


def _pack(data: bytes, path: str) -> dict[str, Any]:
    try:
        report = validate_furniture_pack(data)
    except FurniturePackError as error:
        _fail("furniture_" + error.code, path, "Original furniture pack is invalid: " + error.message)
    return {"manifest": report["manifest"], "license": report["license"], "licenses": report["licenses"],
            "logical_sha256": report["sha256"], "stats": report["stats"],
            "items": [{"id": item["id"], "sha256": item["sha256"]} for item in report["items"]]}


def _tables(manifest: dict, name: str, maximum: int, identity: str) -> dict[str, dict]:
    rows = manifest.get(name)
    if not isinstance(rows, list) or len(rows) > maximum:
        _fail("count", name, f"Expected at most {maximum} records.")
    result = {}
    for row in rows:
        _object(row, name)
        key = _key(row.get(identity), name + "." + identity) if identity != "pack_id" else row.get(identity)
        if identity == "pack_id" and (not isinstance(key, str) or not _SHA.fullmatch(key)):
            _fail("identity", name, "Use the original pack's exact full lowercase SHA256.")
        if key in result:
            _fail("duplicate_reference", name, "Duplicate snapshot/asset identities are not supported.")
        result[key] = row
    return result


def _contents(manifest: dict, members: Mapping[str, bytes]) -> dict[str, Any]:
    if manifest.get("format") != FORMAT or type(manifest.get("version")) is not int or manifest["version"] != VERSION:
        _fail("version", "manifest", "Unsupported dashboard backup format/version.")
    captured_at = _text(manifest.get("created_at"), "created_at", 64)
    if not _UTC_TIME.fullmatch(captured_at):
        _fail("capture_time", "created_at", "Use an exact ISO UTC capture time ending in Z or +00:00.")
    try:
        datetime.fromisoformat(captured_at)
    except ValueError:
        _fail("capture_time", "created_at", "Capture time must be a real calendar time.")
    producer = _object(manifest.get("producer"), "producer")
    _text(producer.get("name"), "producer.name", 128)
    _text(producer.get("version"), "producer.version", 128)
    if type(manifest.get("complete")) is not bool:
        _fail("completeness", "complete", "Expected an explicit boolean; references are independently checked.")
    source = _object(manifest.get("dashboard"), "dashboard")
    if source.get("mode") not in ("storage", "yaml", "generated") or "url_path" not in source:
        _fail("dashboard_source", "dashboard", "Supply an explicit source dashboard address and mode.")
    if source["url_path"] is not None:
        _text(source["url_path"], "dashboard.url_path", 256)
    _object(source.get("metadata"), "dashboard.metadata")
    expected = {"manifest.json"}

    def member(row: dict, path: str, maximum: int) -> bytes:
        descriptor = _object(row.get("file"), path + ".file")
        if descriptor.get("path") != path or type(descriptor.get("bytes")) is not int or not 0 < descriptor["bytes"] <= maximum or not isinstance(descriptor.get("sha256"), str) or not _SHA.fullmatch(descriptor["sha256"]):
            _fail("descriptor", path, "Invalid exact member path, byte budget or full SHA256.")
        if path not in members:
            _fail("member_missing", path, "A declared archive member is missing.")
        data = members[path]
        if len(data) != descriptor["bytes"] or hashlib.sha256(data).hexdigest() != descriptor["sha256"]:
            _fail("hash", path, "Member bytes differ from their declared size/hash.")
        expected.add(path)
        return data

    dashboard_data = member(source, "dashboard.json", MAX_DASHBOARD_WIRE_BYTES)
    dashboard = _json(dashboard_data, "dashboard.json", MAX_DASHBOARD_WIRE_BYTES)
    if not isinstance(dashboard.get("views"), list) and not isinstance(dashboard.get("strategy"), dict):
        _fail("dashboard_shape", "dashboard.json", "Preserve a raw dashboard with views or an explicit strategy.")
    wire = json.dumps({"id": 1, "type": "lovelace/config/save", "url_path": source["url_path"], "config": dashboard}, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(wire) > MAX_DASHBOARD_WIRE_BYTES:
        _fail("wire_budget", "dashboard.json", "Dashboard save message exceeds the 3 MiB UTF-8 wire budget.")
    resources = _resources(manifest.get("resources"))
    layout_rows = _tables(manifest, "layouts", MAX_LAYOUTS, "key")
    layouts = {}
    for key, row in layout_rows.items():
        if row.get("backend") not in ("shared", "user", "browser"):
            _fail("backend", key, "Record the actual layout snapshot storage source.")
        _object(row.get("metadata"), "layouts.metadata")
        data = member(row, _layout_path(key), MAX_LAYOUT_BYTES)
        layout = _json(data, _layout_path(key), MAX_LAYOUT_BYTES)
        if len(json.dumps(layout)) > MAX_LAYOUT_BYTES:
            _fail("layout_budget", key, "Layout exceeds the integration's 2,000,000-character serialized budget.")
        layouts[key] = layout
    cards, model_keys, pack_refs, issues = _refs(dashboard, layouts, resources)
    declared_cards = manifest.get("cards")
    if not isinstance(declared_cards, list) or any(type(row) is not dict or "pointer" not in row or "layout_key" not in row for row in declared_cards) or [{"pointer": row["pointer"], "layout_key": row["layout_key"]} for row in declared_cards] != cards:
        _fail("card_references", "cards", "Card pointers/keys must exactly match all raw Taylor card entries.")
    if set(layouts) - {card["layout_key"] for card in cards}:
        _fail("unreferenced_layout", "layouts", "Do not include layouts outside the selected dashboard.")
    model_rows = _tables(manifest, "models", MAX_MODELS, "layout_key")
    if set(model_rows) - model_keys:
        _fail("unreferenced_model", "models", "Do not include unreferenced or URL-sourced models.")
    for key, row in model_rows.items():
        _object(row.get("metadata"), "models.metadata")
        digest = _object(row.get("file"), "models.file").get("sha256")
        data = member(row, f"models/{digest}.glb", MAX_MODEL_BYTES)
        _model(data, row["file"]["path"])
        version = layouts[key]["model"].get("version")
        if isinstance(version, str) and re.fullmatch(r"[0-9a-f]{12}", version) and not digest.startswith(version):
            _fail("source_changed", key, "Original model bytes do not match the captured upload version.")
    for key in sorted(model_keys - model_rows.keys()):
        issues.append(_diagnostic("model_missing", _layout_path(key), "Original uploaded GLB bytes were not supplied."))
    pack_rows = _tables(manifest, "furniture", MAX_PACKS, "pack_id")
    if set(pack_rows) - pack_refs.keys():
        _fail("unreferenced_pack", "furniture", "Do not include furniture packs outside the selected dashboard.")
    outer_expanded = sum(len(body) for body in members.values())
    nested_expanded = 0
    for pack_id, row in pack_rows.items():
        data = member(row, f"furniture/{pack_id}.zip", MAX_PACK_BYTES)
        if row["file"]["sha256"] != pack_id:
            _fail("identity", pack_id, "Pack identity must hash its exact original ZIP bytes.")
        metadata = _pack(data, row["file"]["path"])
        nested_expanded += metadata["stats"]["expanded_bytes"]
        if outer_expanded + nested_expanded > MAX_EXPANDED_BYTES:
            _fail("total_budget", "furniture", "Outer payload plus original pack expansion exceeds the 512 MiB verification budget.")
        if type(row.get("metadata")) is not dict or any(row["metadata"].get(key) != value for key, value in metadata.items()):
            _fail("license_metadata", pack_id, "Pack metadata/licences differ from the original validated archive.")
        identities = {item["id"]: item["sha256"] for item in metadata["items"]}
        for path, instance in pack_refs[pack_id]:
            if identities.get(instance["item_id"]) != instance["asset_sha256"]:
                issues.append(_diagnostic("furniture_item_missing", path, "The saved item/hash is not an exact member of this original pack."))
    for pack_id in sorted(pack_refs.keys() - pack_rows.keys()):
        issues.append(_diagnostic("pack_missing", pack_id, "Original licensed furniture archive was not supplied."))
    if set(members) != expected:
        _fail("undeclared_member", "archive", "Every member must be an exact declared payload or manifest.json.")
    if sum(len(body) for body in members.values()) > MAX_EXPANDED_BYTES or sum(len(body) for name, body in members.items() if name.endswith(".json")) > MAX_JSON_BYTES:
        _fail("total_budget", "archive", "Expanded archive or combined JSON exceeds its budget.")
    supplied = manifest.get("diagnostics")
    if not isinstance(supplied, list) or len(supplied) > MAX_DIAGNOSTICS:
        _fail("diagnostics", "diagnostics", "Expected a bounded explicit diagnostic list.")
    seen = {(entry["code"], entry["path"], entry["message"]): entry for entry in issues}
    for entry in supplied:
        _object(entry, "diagnostics")
        for field, maximum in (("code", 128), ("message", 4096)):
            _text(entry.get(field), "diagnostics." + field, maximum)
        # A JSON Pointer can legitimately contain a raw control character in
        # an unknown config key. This is data, never an extraction/file path.
        if not isinstance(entry.get("path"), str) or len(entry["path"]) > 4096:
            _fail("diagnostics", "diagnostics.path", "Use a bounded exact diagnostic/JSON-pointer path.")
        if entry.get("severity") not in ("missing", "dependency", "info"):
            _fail("diagnostics", "diagnostics.severity", "Use missing, dependency or info.")
        seen.setdefault((entry["code"], entry["path"], entry["message"]), entry)
    if len(seen) > MAX_DIAGNOSTICS:
        _fail("diagnostics", "diagnostics", "Derived diagnostics exceed their budget.")
    diagnostics = list(seen.values())
    complete = not any(entry["severity"] == "missing" for entry in diagnostics)
    if manifest["complete"] and not complete:
        _fail("completeness", "complete", "Claimed complete backup has missing/invalid references.")
    return {"complete": complete, "diagnostics": diagnostics, "counts": {"cards": len(cards), "layouts": len(layouts), "models": len(model_rows), "furniture_packs": len(pack_rows), "members": len(members)},
            "expanded_bytes": outer_expanded, "nested_expanded_bytes": nested_expanded,
            "verified_expanded_bytes": outer_expanded + nested_expanded}


@dataclass(frozen=True, slots=True)
class DashboardBackup:
    """Sealed member bytes; public JSON/report access always returns a copy."""

    _members: Mapping[str, bytes]
    _report_json: bytes

    @property
    def members(self) -> Mapping[str, bytes]:
        return self._members

    @property
    def manifest(self) -> dict[str, Any]:
        return json.loads(self._members["manifest.json"])

    @property
    def dashboard(self) -> dict[str, Any]:
        return json.loads(self._members["dashboard.json"])

    @property
    def complete(self) -> bool:
        return self.report()["complete"]

    def report(self) -> dict[str, Any]:
        return json.loads(self._report_json)


def _seal(manifest: dict, members: dict[str, bytes]) -> DashboardBackup:
    report = _contents(manifest, members)
    return DashboardBackup(MappingProxyType(dict(members)), json.dumps(report, ensure_ascii=False, allow_nan=False).encode("utf-8"))


def prepare_dashboard_backup(raw_dashboard: dict | bytes, *, source: dict, resources: dict,
                             layouts: Mapping[str, dict], models: Mapping[str, bytes] | None = None,
                             furniture_packs: Mapping[str, bytes] | None = None, created_at: str | None = None,
                             producer_version: str = "unknown", diagnostics: list | None = None,
                             extra: dict | None = None) -> DashboardBackup:
    """Supply layouts[key]={backend,layout:dict|UTF8 bytes,metadata:{...}}.

    Models map exact layout key to ORIGINAL GLB bytes; packs map original ZIP
    SHA256 to exact ORIGINAL ZIP bytes. Inputs may be mutable: snapshots are
    encoded/copied once. Missing referenced inputs produce an incomplete report.
    Unreferenced supplied input is rejected instead of exporting unrelated data.
    """
    source_data, source = _encoded(source, "source", MAX_MANIFEST_BYTES)
    del source_data
    dashboard_data, dashboard = _encoded(raw_dashboard, "dashboard.json", MAX_DASHBOARD_WIRE_BYTES)
    resource_data, resources = _encoded(resources, "resources", MAX_MANIFEST_BYTES)
    del resource_data
    if not isinstance(layouts, Mapping) or len(layouts) > MAX_LAYOUTS:
        _fail("count", "layouts", "Supply at most 64 explicit layout snapshots.")
    models = {} if models is None else models
    furniture_packs = {} if furniture_packs is None else furniture_packs
    if not isinstance(models, Mapping) or len(models) > MAX_MODELS or not isinstance(furniture_packs, Mapping) or len(furniture_packs) > MAX_PACKS:
        _fail("count", "assets", "Explicit asset mappings exceed their count budgets.")
    _, manifest = _encoded({} if extra is None else extra, "extra", MAX_MANIFEST_BYTES)
    reserved = {"format", "version", "created_at", "producer", "dashboard", "resources", "cards", "layouts", "models", "furniture", "diagnostics", "complete"}
    if reserved & manifest.keys():
        _fail("manifest_fields", "extra", "Extra fields cannot replace format-owned fields.")
    manifest.update({"format": FORMAT, "version": VERSION, "created_at": datetime.now(timezone.utc).isoformat() if created_at is None else created_at,
                     "producer": {"name": "Taylor's 3D", "version": producer_version},
                     "dashboard": {**source, "file": _file("dashboard.json", dashboard_data)}, "resources": resources,
                     "cards": [], "layouts": [], "models": [], "furniture": [], "diagnostics": [], "complete": False})
    members = {"dashboard.json": dashboard_data}
    total = json_total = len(dashboard_data)

    def add(path: str, body: bytes) -> None:
        nonlocal total, json_total
        if path in members:
            if members[path] != body:
                _fail("hash", path, "Shared asset identity has different supplied bytes.")
            return
        total += len(body)
        if path.endswith(".json"):
            json_total += len(body)
        if total > MAX_EXPANDED_BYTES or json_total > MAX_JSON_BYTES:
            _fail("total_budget", "archive", "Supplied payload exceeds the total/JSON budget.")
        members[path] = body
    layout_values = {}
    for key, row in layouts.items():
        _key(key, "layouts.key")
        _object(row, "layouts.snapshot")
        data, layout = _encoded(row.get("layout"), _layout_path(key), MAX_LAYOUT_BYTES)
        metadata_data, metadata = _encoded(row.get("metadata", {}), "layouts.metadata", MAX_MANIFEST_BYTES)
        del metadata_data
        layout_values[key] = layout
        add(_layout_path(key), data)
        manifest["layouts"].append({"key": key, "backend": row.get("backend"), "metadata": metadata, "file": _file(_layout_path(key), data)})
    cards, _, _, _ = _refs(dashboard, layout_values, _resources(resources))
    manifest["cards"] = cards
    for key, body in models.items():
        _key(key, "models.layout_key")
        data = _bytes(body, key, MAX_MODEL_BYTES)
        path = "models/" + hashlib.sha256(data).hexdigest() + ".glb"
        add(path, data)
        manifest["models"].append({"layout_key": key, "metadata": _copy(layout_values.get(key, {}).get("model", {})), "file": _file(path, data)})
    nested_total = 0
    for pack_id, body in furniture_packs.items():
        if not isinstance(pack_id, str) or not _SHA.fullmatch(pack_id):
            _fail("identity", "furniture.pack_id", "Use the original ZIP's full lowercase SHA256.")
        data = _bytes(body, pack_id, MAX_PACK_BYTES)
        path = f"furniture/{pack_id}.zip"
        add(path, data)
        metadata = _pack(data, path)
        nested_total += metadata["stats"]["expanded_bytes"]
        if total + nested_total > MAX_EXPANDED_BYTES:
            _fail("total_budget", "furniture", "Outer payload plus pack expansion exceeds the whole verification budget.")
        manifest["furniture"].append({"pack_id": pack_id, "metadata": metadata, "file": _file(path, data)})
    # Compute missing refs from actual payloads, never from a caller's flag.
    if diagnostics is not None and type(diagnostics) is not list:
        _fail("diagnostics", "diagnostics", "Expected a diagnostic list, without implicit defaulting.")
    manifest["diagnostics"] = _copy([] if diagnostics is None else diagnostics)
    provisional, _ = _encoded(manifest, "manifest.json", MAX_MANIFEST_BYTES)
    members["manifest.json"] = provisional
    report = _contents(manifest, members)
    manifest["diagnostics"] = report["diagnostics"]
    manifest["complete"] = report["complete"]
    data, manifest = _encoded(manifest, "manifest.json", MAX_MANIFEST_BYTES)
    members["manifest.json"] = data
    return _seal(manifest, members)


def _read_at(stream: BinaryIO, offset: int, length: int, path: str) -> bytes:
    stream.seek(offset)
    body = stream.read(length)
    if not isinstance(body, bytes) or len(body) != length:
        _fail("archive_integrity", path, "Archive is truncated or changed while being read.")
    return body


def _directory(stream: BinaryIO, size: int) -> tuple[list[dict], int]:
    tail_start = max(0, size - 65_557)
    tail = _read_at(stream, tail_start, size - tail_start, "archive")
    end = tail.rfind(b"PK\x05\x06")
    if end < 0 or end + 22 > len(tail):
        _fail("archive_integrity", "archive", "Missing complete ZIP directory.")
    disk, central_disk, disk_count, count, central_size, offset, comment = struct.unpack_from("<HHHHIIH", tail, end + 4)
    end += tail_start
    if count > MAX_MEMBERS:
        _fail("member_budget", "archive", "Too many actual ZIP members.")
    if disk or central_disk or disk_count != count or count < 2 or offset + central_size != end or end + 22 + comment != size or comment > 4096:
        _fail("archive_integrity", "archive", "Unsupported multidisk/ZIP64/trailing/inconsistent directory.")
    central_start, rows = offset, []
    while offset < end:
        header = _read_at(stream, offset, 46, "archive")
        if header[:4] != b"PK\x01\x02":
            _fail("archive_integrity", "archive", "Invalid central-directory framing.")
        flags, method = struct.unpack_from("<HH", header, 8)
        crc, compressed, expanded = struct.unpack_from("<III", header, 16)
        name_len, extra, entry_comment, entry_disk = struct.unpack_from("<HHHH", header, 28)
        external, local = struct.unpack_from("<II", header, 38)
        if not 0 < name_len <= 100 or extra or entry_comment > 4096 or entry_disk or compressed == 0xFFFFFFFF or expanded == 0xFFFFFFFF or local == 0xFFFFFFFF or offset + 46 + name_len + entry_comment > end:
            _fail("archive_format", "archive", "Unsupported member names, ZIP64, aliases or extra metadata.")
        raw_name = _read_at(stream, offset + 46, name_len, "archive")
        try:
            name = raw_name.decode("utf-8" if flags & 0x800 else "cp437")
        except UnicodeDecodeError:
            _fail("archive_path", "archive", "Invalid encoded ZIP member name.")
        if not _MEMBER.fullmatch(name):
            _fail("archive_path", "archive", "Use only exact generated lowercase member names.")
        if flags & ~0x080E or method not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) or stat.S_IFMT(external >> 16) not in (0, stat.S_IFREG):
            _fail("archive_format", name, "Encrypted, nonregular or unsupported ZIP members are rejected.")
        maximum = MAX_MANIFEST_BYTES if name == "manifest.json" else MAX_DASHBOARD_WIRE_BYTES if name == "dashboard.json" else MAX_LAYOUT_BYTES if name.startswith("layouts/") else MAX_MODEL_BYTES if name.startswith("models/") else MAX_PACK_BYTES
        if not 0 < expanded <= maximum or compressed > MAX_ARCHIVE_BYTES:
            _fail("member_budget", name, "Declared member exceeds its byte budget.")
        rows.append({"name": name, "raw_name": raw_name, "flags": flags, "method": method, "crc": crc, "compressed": compressed, "expanded": expanded, "local": local})
        if len(rows) > MAX_MEMBERS:
            _fail("member_budget", "archive", "Actual member count exceeds its budget.")
        offset += 46 + name_len + entry_comment
    if offset != end or len(rows) != count:
        _fail("archive_integrity", "archive", "Actual member count differs from the directory.")
    if len({row["name"] for row in rows}) != len(rows) or len({row["local"] for row in rows}) != len(rows):
        _fail("duplicate_member", "archive", "Duplicate names or shared local-header aliases are rejected.")
    if sum(row["expanded"] for row in rows) > MAX_EXPANDED_BYTES or sum(row["expanded"] for row in rows if row["name"].endswith(".json")) > MAX_JSON_BYTES:
        _fail("total_budget", "archive", "Declared expanded/JSON totals exceed their budgets.")
    return rows, central_start


def _read_zip_member(stream: BinaryIO, row: dict, limit: int) -> bytes:
    path, offset = row["name"], row["local"]
    header = _read_at(stream, offset, 30, path)
    flags, method = struct.unpack_from("<HH", header, 6)
    crc, compressed, expanded = struct.unpack_from("<III", header, 14)
    name_len, extra = struct.unpack_from("<HH", header, 26)
    if header[:4] != b"PK\x03\x04" or flags != row["flags"] or method != row["method"] or extra or name_len != len(row["raw_name"]) or _read_at(stream, offset + 30, name_len, path) != row["raw_name"]:
        _fail("archive_integrity", path, "Local and central ZIP headers disagree.")
    if not flags & 8 and (crc, compressed, expanded) != (row["crc"], row["compressed"], row["expanded"]):
        _fail("archive_integrity", path, "Local sizes/CRC differ from the directory.")
    start = offset + 30 + name_len
    end = start + row["compressed"]
    if flags & 8:
        prefix = _read_at(stream, end, 4, path)
        descriptor_start = end + 4 if prefix == b"PK\x07\x08" else end
        descriptor = struct.unpack("<III", _read_at(stream, descriptor_start, 12, path))
        if descriptor != (row["crc"], row["compressed"], row["expanded"]):
            _fail("archive_integrity", path, "ZIP data descriptor differs from its directory.")
        if descriptor_start + 12 != limit:
            _fail("archive_integrity", path, "Hidden bytes or overlapping ZIP members are rejected.")
    elif end != limit:
        _fail("archive_integrity", path, "Hidden bytes or overlapping ZIP members are rejected.")
    if start > end or end > limit:
        _fail("archive_integrity", path, "Member extends outside its local range.")
    if method == zipfile.ZIP_STORED:
        if row["compressed"] != row["expanded"]:
            _fail("archive_integrity", path, "Stored member's actual and expanded lengths differ.")
        body = _read_at(stream, start, row["expanded"], path)
        if zlib.crc32(body) & 0xFFFFFFFF != row["crc"]:
            _fail("archive_integrity", path, "Actual member CRC is invalid.")
        return body
    decoder, body, actual_crc = zlib.decompressobj(-15), bytearray(), 0
    while start < end:
        chunk = _read_at(stream, start, min(CHUNK, end - start), path)
        start += len(chunk)
        while chunk:
            output = decoder.decompress(chunk, min(CHUNK, row["expanded"] - len(body) + 1))
            if len(body) + len(output) > row["expanded"]:
                _fail("archive_integrity", path, "Actual deflate output exceeds the declared length.")
            body.extend(output)
            actual_crc = zlib.crc32(output, actual_crc)
            chunk = decoder.unconsumed_tail
            if decoder.unused_data:
                _fail("archive_integrity", path, "Trailing bytes follow the deflate stream.")
    if not decoder.eof or len(body) != row["expanded"] or actual_crc & 0xFFFFFFFF != row["crc"]:
        _fail("archive_integrity", path, "Incomplete deflate output, length or CRC.")
    return bytes(body)


def validate_dashboard_backup(value: bytes | BinaryIO) -> DashboardBackup:
    """Validate complete framing, actual output, hashes and references; no writes."""
    stream = io.BytesIO(value) if isinstance(value, bytes) else value
    try:
        original = stream.tell()
        stream.seek(0, io.SEEK_END)
        size = stream.tell()
        if not 0 < size <= MAX_ARCHIVE_BYTES:
            _fail("archive_size", "archive", "Backup exceeds the 512 MiB whole-archive budget.")
        rows, central = _directory(stream, size)
        ordered = sorted(rows, key=lambda row: row["local"])
        if ordered[0]["local"] != 0:
            _fail("archive_integrity", "archive", "Executable/prefixed ZIP archives are rejected.")
        members = {}
        for index, row in enumerate(ordered):
            limit = ordered[index + 1]["local"] if index + 1 < len(ordered) else central
            members[row["name"]] = _read_zip_member(stream, row, limit)
        if "manifest.json" not in members:
            _fail("member_missing", "manifest.json", "The versioned manifest is missing.")
        manifest = _json(members["manifest.json"], "manifest.json", MAX_MANIFEST_BYTES)
        return _seal(manifest, members)
    except (OSError, TypeError, AttributeError, struct.error, zlib.error, OverflowError, ValueError) as error:
        if isinstance(error, DashboardBackupError):
            raise
        _fail("archive_integrity", "archive", "Expected a readable complete bounded binary ZIP stream.")
    finally:
        if "original" in locals():
            try:
                stream.seek(original)
            except (OSError, ValueError, AttributeError):
                pass


def create_dashboard_backup(prepared: DashboardBackup, output: BinaryIO) -> dict[str, Any]:
    """Stream a sealed backup to an EMPTY readable/writable seekable binary file.

    No filesystem target is chosen. On transport write failure the supplied
    temporary stream may be partial; caller owns discarding it. Existing output
    content is never overwritten. Generated outer ZIP uses STORED members.
    """
    if not isinstance(prepared, DashboardBackup):
        _fail("prepared", "backup", "Prepare/validate snapshots before creating an archive.")
    # Re-check descriptors before touching any supplied output.
    report = _contents(prepared.manifest, prepared.members)
    total = sum(len(body) + 76 + 2 * len(name) for name, body in prepared.members.items()) + 22
    if total > MAX_ARCHIVE_BYTES:
        _fail("archive_size", "archive", "Payload plus ZIP framing exceeds the whole-archive budget.")
    try:
        output.seek(0, io.SEEK_END)
        if output.tell() != 0:
            _fail("output_not_empty", "output", "Supply an empty temporary binary output, never an existing backup.")
        output.seek(0)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
            for name, body in prepared.members.items():
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                with archive.open(info, "w") as destination:
                    for start in range(0, len(body), CHUNK):
                        destination.write(memoryview(body)[start:start + CHUNK])
        if output.tell() != total:
            _fail("archive_integrity", "output", "Written archive length differs from its bounded framing.")
        return {**report, "archive_bytes": total}
    except (OSError, TypeError, AttributeError, zipfile.LargeZipFile, ValueError) as error:
        if isinstance(error, DashboardBackupError):
            raise
        _fail("archive_io", "output", "Unable to write the supplied temporary binary stream.")
