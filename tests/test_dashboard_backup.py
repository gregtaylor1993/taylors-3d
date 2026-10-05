"""Pure F04 archive proof: python tests/test_dashboard_backup.py.

No HA installation/router/browser success is claimed. A synthetic package loads
only the two pure validators, avoiding the integration's HA-dependent __init__.
"""

from __future__ import annotations

import copy
from array import array
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import struct
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import warnings
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
NAME = "pure_dashboard_backup_tests"
PACKAGE = types.ModuleType(NAME)
PACKAGE.__path__ = [str(ROOT / "custom_components" / "taylors3d")]
sys.modules[NAME] = PACKAGE
SPEC = importlib.util.spec_from_file_location(NAME + ".dashboard_backup", ROOT / "custom_components" / "taylors3d" / "dashboard_backup.py")
assert SPEC and SPEC.loader
backup = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = backup
SPEC.loader.exec_module(backup)

FIXTURE_SPEC = importlib.util.spec_from_file_location("dashboard_pack_fixture", ROOT / "tests" / "test_furniture_pack.py")
assert FIXTURE_SPEC and FIXTURE_SPEC.loader
fixture = importlib.util.module_from_spec(FIXTURE_SPEC)
FIXTURE_SPEC.loader.exec_module(fixture)


def inputs() -> dict:
    model = fixture.glb()
    pack = fixture.bundle()
    pack_id = hashlib.sha256(pack).hexdigest()
    item_hash = hashlib.sha256(model).hexdigest()
    layout = {"version": 1, "floors": [{"id": "deleted-exact-floor", "name": "Saved floor"}],
              "rooms": [{"id": "room-exact", "floor_id": "deleted-exact-floor", "area_id": "deleted-exact-area", "polygon": [[0, 0], [2, 0], [2, 2]]}],
              "pins": {"entity:light.missing": {"floor_id": "deleted-exact-floor", "x": 1, "y": 1}},
              "model": {"version": item_hash[:12], "name": "original.glb", "unknown": {"preserve": True}},
              "views": {"original": {"camera": {"position": [1.23456789, 3, 5]}, "unknown": [None, False]}},
              "furniture": {"version": 1, "instances": [{"id": "exact-chair", "pack_id": pack_id, "item_id": "triangle", "asset_sha256": item_hash,
                                                         "floor_id": "deleted-exact-floor", "x": 1, "y": 2}]},
              "unknown": {"future": [3, "text", {"unicode": "Taylor’s"}]}}
    dashboard = {"views": [{"title": "Main", "path": "main", "sections": [{"type": "grid", "cards": [
        {"type": "custom:taylors3d-card", "layout_key": "shared", "unknown": {"property": [1, 2]}},
        {"type": "conditional", "conditions": [{"entity": "sensor.other", "state": "ready"}], "card": {"type": "custom:taylors3d-card", "layout_key": "shared"}},
        {"type": "custom:unrecognized-card", "anything": {"deeply": ["preserved", None]}, "tap_action": {"action": "perform-action", "perform_action": "light.turn_on"}}]}],
        "badges": [{"type": "entity", "entity": "person.exact"}]}], "unknown": {"raw": [True, None, 1.5]}}
    return {"raw_dashboard": dashboard, "source": {"url_path": "source-dashboard", "mode": "storage", "metadata": {"id": "source-id", "title": "Supplied source", "unknown": {"keep": 7}}},
            "resources": {"mode": "storage", "items": [{"id": "resource-id", "url": "/local/other-card.js", "type": "module", "unknown": True}]},
            "layouts": {"shared": {"backend": "shared", "layout": layout, "metadata": {"snapshot_revision": 5, "unknown": [False]}}},
            "models": {"shared": model}, "furniture_packs": {pack_id: pack}, "created_at": "2026-10-05T12:00:00Z", "producer_version": "test-only"}


def prepare(value: dict | None = None):
    return backup.prepare_dashboard_backup(**(inputs() if value is None else value))


def archive(records: list[tuple[str | zipfile.ZipInfo, bytes]], compression: int = zipfile.ZIP_STORED) -> bytes:
    target = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(target, "w", compression=compression) as container:
            for name, body in records:
                container.writestr(name, body)
    return target.getvalue()


def packed(prepared=None) -> bytes:
    target = io.BytesIO()
    backup.create_dashboard_backup(prepare() if prepared is None else prepared, target)
    return target.getvalue()


def central_positions(body: bytes | bytearray) -> list[int]:
    offset = struct.unpack_from("<I", body, len(body) - 22 + 16)[0]
    result = []
    while body[offset:offset + 4] == b"PK\x01\x02":
        result.append(offset)
        name, extra, comment = struct.unpack_from("<HHH", body, offset + 28)
        offset += 46 + name + extra + comment
    return result


def tampered(mutator) -> bytes:
    value = prepare()
    members = dict(value.members)
    manifest = value.manifest
    mutator(manifest, members)
    members["manifest.json"] = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode()
    return archive(list(members.items()))


class DashboardBackupTest(unittest.TestCase):
    def rejected(self, call, code=None):
        with self.assertRaises(backup.DashboardBackupError) as caught:
            call()
        self.assertTrue(caught.exception.code)
        self.assertTrue(caught.exception.path)
        self.assertTrue(caught.exception.message)
        if code:
            self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_whole_heterogeneous_dashboard_layout_and_unknown_fields_preserved(self):
        original = inputs()
        snapshot = copy.deepcopy(original)
        result = backup.validate_dashboard_backup(packed(prepare(original)))
        self.assertEqual(result.dashboard, snapshot["raw_dashboard"])
        key_path = "layouts/" + hashlib.sha256(b"shared").hexdigest() + ".json"
        self.assertEqual(json.loads(result.members[key_path]), snapshot["layouts"]["shared"]["layout"])
        self.assertEqual(result.manifest["dashboard"]["metadata"], snapshot["source"]["metadata"])
        self.assertEqual(original, snapshot)

    def test_shared_layout_and_assets_deduplicate_without_rewriting_cards(self):
        result = prepare()
        self.assertEqual(result.report()["counts"], {"cards": 2, "layouts": 1, "models": 1, "furniture_packs": 1, "members": 5})
        self.assertEqual([row["layout_key"] for row in result.manifest["cards"]], ["shared", "shared"])
        self.assertTrue(result.complete)

    def test_original_glb_zip_hash_and_supplied_licences_are_exact(self):
        value = inputs()
        result = backup.validate_dashboard_backup(packed(prepare(value)))
        model = result.manifest["models"][0]
        pack = result.manifest["furniture"][0]
        self.assertEqual(result.members[model["file"]["path"]], value["models"]["shared"])
        self.assertEqual(result.members[pack["file"]["path"]], value["furniture_packs"][pack["pack_id"]])
        self.assertEqual(pack["pack_id"], hashlib.sha256(value["furniture_packs"][pack["pack_id"]]).hexdigest())
        self.assertIn("Supplied synthetic licence", pack["metadata"]["license"]["text"])

    def test_prepared_snapshots_are_protected_against_source_and_returned_copy_mutation(self):
        value = inputs()
        value["models"]["shared"] = bytearray(value["models"]["shared"])
        value["furniture_packs"] = {key: bytearray(body) for key, body in value["furniture_packs"].items()}
        result = prepare(value)
        original = dict(result.members)
        value["raw_dashboard"]["views"].clear()
        value["layouts"]["shared"]["layout"]["floors"][0]["id"] = "changed"
        value["models"]["shared"][0] = 0
        next(iter(value["furniture_packs"].values()))[0] = 0
        result.manifest["dashboard"]["metadata"].clear()
        result.dashboard["views"].clear()
        result.report()["diagnostics"].clear()
        self.assertEqual(dict(result.members), original)
        with self.assertRaises(TypeError):
            result.members["dashboard.json"] = b"{}"
        self.assertEqual(dict(backup.validate_dashboard_backup(packed(result)).members), original)

    def test_validated_original_json_member_bytes_are_preserved(self):
        value = inputs()
        dashboard = json.dumps(value["raw_dashboard"], ensure_ascii=True, indent=4).encode()
        layout = json.dumps(value["layouts"]["shared"]["layout"], ensure_ascii=True, indent=2).encode()
        value["raw_dashboard"] = dashboard
        value["layouts"]["shared"]["layout"] = layout
        result = backup.validate_dashboard_backup(packed(prepare(value)))
        self.assertEqual(result.members["dashboard.json"], dashboard)
        self.assertEqual(result.members[result.manifest["layouts"][0]["file"]["path"]], layout)
        self.assertEqual(dict(backup.validate_dashboard_backup(packed(result)).members), dict(result.members))

    def test_generated_strategy_and_extension_metadata_are_raw(self):
        value = inputs()
        value.update(raw_dashboard={"strategy": {"type": "custom:exact-strategy", "options": {"unknown": [3, None]}}, "unknown": "kept"}, layouts={}, models={}, furniture_packs={})
        value["source"]["mode"] = "generated"
        value["extra"] = {"future": {"version": 8, "array": [False, None]}}
        result = backup.validate_dashboard_backup(packed(prepare(value)))
        self.assertEqual(result.dashboard, value["raw_dashboard"])
        self.assertEqual(result.manifest["future"], value["extra"]["future"])
        self.assertEqual(result.manifest["dashboard"]["mode"], "generated")

    def test_json_pointer_escapes_and_exact_utf8_layout_key_hash(self):
        value = inputs()
        key = "Étage/~ exact"
        card = {"type": "custom:taylors3d-card", "layout_key": key}
        value["raw_dashboard"] = {"views": [], "unknown/~wrapper": {"nested": [card]}}
        value["layouts"] = {key: {"backend": "user", "layout": {"version": 1}, "metadata": {"user_id": "exact-user"}}}
        value.update(models={}, furniture_packs={})
        result = prepare(value)
        self.assertEqual(result.manifest["cards"], [{"pointer": "/unknown~1~0wrapper/nested/0", "layout_key": key}])
        self.assertEqual(result.manifest["layouts"][0]["file"]["path"], "layouts/" + hashlib.sha256(key.encode()).hexdigest() + ".json")

    def test_no_floor_area_entity_remap_or_registry_guess(self):
        result = prepare()
        layout = json.loads(result.members[result.manifest["layouts"][0]["file"]["path"]])
        self.assertEqual(layout["rooms"][0]["floor_id"], "deleted-exact-floor")
        self.assertEqual(layout["rooms"][0]["area_id"], "deleted-exact-area")
        self.assertIn("entity:light.missing", layout["pins"])

    def test_absent_card_key_is_explicit_default_but_bad_present_key_is_not_guessed(self):
        value = inputs()
        value.update(raw_dashboard={"views": [{"cards": [{"type": "custom:taylors3d-card"}, {"type": "custom:taylors3d-card", "layout_key": ""}]}]},
                     layouts={"default": {"backend": "browser", "layout": {}, "metadata": {}}}, models={}, furniture_packs={})
        result = prepare(value)
        self.assertEqual([row["layout_key"] for row in result.manifest["cards"]], ["default", None])
        self.assertFalse(result.complete)
        self.assertIn("layout_key", {entry["code"] for entry in result.report()["diagnostics"]})

    def test_missing_layout_model_and_pack_have_explicit_incomplete_diagnostics(self):
        for missing in ("layouts", "models", "furniture_packs"):
            with self.subTest(missing=missing):
                value = inputs()
                value[missing] = {}
                if missing == "layouts":
                    value.update(models={}, furniture_packs={})
                result = backup.validate_dashboard_backup(packed(prepare(value)))
                self.assertFalse(result.complete)
                expected = {"layouts": "layout_missing", "models": "model_missing", "furniture_packs": "pack_missing"}[missing]
                self.assertIn(expected, {entry["code"] for entry in result.report()["diagnostics"]})

    def test_saved_wrong_furniture_item_or_hash_is_preserved_and_diagnosed(self):
        for field, invalid in (("item_id", "gone"), ("asset_sha256", "0" * 64), ("pack_id", "not-a-hash")):
            with self.subTest(field=field):
                value = inputs()
                instance = value["layouts"]["shared"]["layout"]["furniture"]["instances"][0]
                instance[field] = invalid
                if field == "pack_id":
                    value["furniture_packs"] = {}
                result = prepare(value)
                self.assertFalse(result.complete)
                layout = json.loads(result.members[result.manifest["layouts"][0]["file"]["path"]])
                self.assertEqual(layout["furniture"]["instances"][0][field], invalid)

    def test_explicit_external_model_and_resource_sources_are_dependencies_not_downloads(self):
        value = inputs()
        for card in value["raw_dashboard"]["views"][0]["sections"][0]["cards"][:2]:
            (card.get("card") or card)["model"] = "https://assets.example.test/original.glb"
        value["models"] = {}
        result = prepare(value)
        self.assertTrue(result.complete)
        codes = [entry["code"] for entry in result.report()["diagnostics"]]
        self.assertEqual(codes.count("model_dependency"), 2)
        self.assertIn("resource_dependency", codes)
        self.assertFalse(result.manifest["models"])
        self.assertEqual(result.dashboard, value["raw_dashboard"])

    def test_not_supplied_complete_flag_cannot_hide_lost_references(self):
        value = inputs()
        value["models"] = {}
        incomplete = prepare(value)
        members = dict(incomplete.members)
        manifest = incomplete.manifest
        manifest["complete"] = True
        manifest["diagnostics"] = []
        members["manifest.json"] = json.dumps(manifest).encode()
        self.rejected(lambda: backup.validate_dashboard_backup(archive(list(members.items()))), "completeness")

    def test_validator_derives_dependency_diagnostics_even_if_removed_from_manifest(self):
        result = backup.validate_dashboard_backup(tampered(lambda manifest, _: manifest.update(diagnostics=[])))
        self.assertIn("resource_dependency", {entry["code"] for entry in result.report()["diagnostics"]})

    def test_added_or_repointed_or_missing_card_manifest_reference_is_rejected(self):
        for mutate in (lambda m: m["cards"].pop(), lambda m: m["cards"][0].update(pointer="/views/00"), lambda m: m["cards"][0].update(layout_key="another")):
            with self.subTest(mutate=mutate):
                self.rejected(lambda: backup.validate_dashboard_backup(tampered(lambda m, _: mutate(m))), "card_references")

    def test_unreferenced_supplied_layout_model_and_pack_are_rejected(self):
        for name in ("layouts", "models", "furniture_packs"):
            with self.subTest(name=name):
                value = inputs()
                if name == "layouts":
                    value[name]["private-other"] = {"backend": "shared", "layout": {}, "metadata": {}}
                elif name == "models":
                    value[name]["private-other"] = fixture.glb()
                else:
                    other = fixture.bundle(text=b"Another supplied licence.")
                    value[name][hashlib.sha256(other).hexdigest()] = other
                self.rejected(lambda: prepare(value), {"layouts": "unreferenced_layout", "models": "unreferenced_model", "furniture_packs": "unreferenced_pack"}[name])

    def test_model_upload_snapshot_version_mismatch_detects_changed_source(self):
        value = inputs()
        value["layouts"]["shared"]["layout"]["model"]["version"] = "0" * 12
        self.rejected(lambda: prepare(value), "source_changed")

    def test_model_framing_rejects_truncated_or_false_declared_length(self):
        for change in (lambda body: body[:-1], lambda body: body[:8] + struct.pack("<I", 20) + body[12:], lambda body: body[:16] + b"xxxx" + body[20:]):
            with self.subTest(change=change):
                value = inputs()
                value["models"]["shared"] = change(value["models"]["shared"])
                value["layouts"]["shared"]["layout"]["model"]["version"] = "older-format"
                self.rejected(lambda: prepare(value), "model")

    def test_furniture_original_hash_license_and_geometry_validator_are_required(self):
        value = inputs()
        pack_id = next(iter(value["furniture_packs"]))
        value["furniture_packs"] = {pack_id: b"not a zip"}
        self.rejected(lambda: prepare(value))
        self.rejected(lambda: backup.validate_dashboard_backup(tampered(lambda m, _: m["furniture"][0]["metadata"]["license"].update(text="Replaced credit"))), "license_metadata")

    def test_original_pack_identity_cannot_be_relabelled(self):
        self.rejected(lambda: backup.validate_dashboard_backup(tampered(lambda m, _: m["furniture"][0].update(pack_id="0" * 64))))

    def test_payload_hash_or_byte_declaration_mismatch_rejected(self):
        for change in (lambda m, _: m["dashboard"]["file"].update(sha256="0" * 64), lambda m, _: m["dashboard"]["file"].update(bytes=1), lambda m, files: files.update({"dashboard.json": b'{"views":[]}'})):
            with self.subTest(change=change):
                self.rejected(lambda: backup.validate_dashboard_backup(tampered(change)), "hash")

    def test_declared_missing_or_undeclared_payload_rejected(self):
        self.rejected(lambda: backup.validate_dashboard_backup(tampered(lambda m, files: files.pop(m["models"][0]["file"]["path"]))), "member_missing")
        self.rejected(lambda: backup.validate_dashboard_backup(tampered(lambda _, files: files.update({"models/" + "0" * 64 + ".glb": fixture.glb()}))), "undeclared_member")

    def test_traversal_absolute_case_alias_nul_backslash_and_directory_paths_rejected(self):
        for name in ("../dashboard.json", "/dashboard.json", "Dashboard.json", "dashboard.json\0suffix", "layouts\\bad.json", "layouts/", "C:/dashboard.json"):
            with self.subTest(name=name):
                self.rejected(lambda: backup.validate_dashboard_backup(archive([(name, b"{}"), ("manifest.json", b"{}")])))

    def test_duplicate_zip_member_and_local_header_alias_rejected(self):
        rows = list(prepare().members.items())
        self.rejected(lambda: backup.validate_dashboard_backup(archive([*rows, rows[0]])), "duplicate_member")
        body = bytearray(archive(rows))
        positions = central_positions(body)
        struct.pack_into("<I", body, positions[1] + 42, 0)
        self.rejected(lambda: backup.validate_dashboard_backup(bytes(body)), "duplicate_member")

    def test_symlink_and_unsupported_compression_are_rejected(self):
        link = zipfile.ZipInfo("dashboard.json")
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.rejected(lambda: backup.validate_dashboard_backup(archive([(link, b"{}"), ("manifest.json", b"{}")])), "archive_format")
        self.rejected(lambda: backup.validate_dashboard_backup(archive(list(prepare().members.items()), zipfile.ZIP_BZIP2)), "archive_format")

    def test_prefix_trailing_bytes_and_unlisted_local_member_bytes_rejected(self):
        body = packed()
        self.rejected(lambda: backup.validate_dashboard_backup(b"prefix" + body), "archive_integrity")
        self.rejected(lambda: backup.validate_dashboard_backup(body + b"trailer"), "archive_integrity")
        # A local gap is not a declared payload. Move all central offsets and
        # EOCD together so merely finding a valid directory cannot accept it.
        gap = bytearray(body)
        central = central_positions(gap)[0]
        gap[central:central] = b"hidden"
        struct.pack_into("<I", gap, len(gap) - 22 + 16, central + 6)
        self.rejected(lambda: backup.validate_dashboard_backup(bytes(gap)), "archive_integrity")

    def test_real_deflated_archive_roundtrip_and_corrupt_crc_rejected(self):
        result = prepare()
        body = archive(list(result.members.items()), zipfile.ZIP_DEFLATED)
        self.assertEqual(dict(backup.validate_dashboard_backup(body).members), dict(result.members))
        bad = bytearray(body)
        name_length = struct.unpack_from("<H", bad, 26)[0]
        bad[30 + name_length] ^= 1
        self.rejected(lambda: backup.validate_dashboard_backup(bytes(bad)), "archive_integrity")

    def test_forged_short_deflate_prefix_does_not_hide_expanded_output(self):
        body = bytearray(archive(list(prepare().members.items()), zipfile.ZIP_DEFLATED))
        central = central_positions(body)[0]
        prefix = prepare().members["dashboard.json"][:10]
        for offset in (14, central + 16):
            struct.pack_into("<I", body, offset, zlib.crc32(prefix) & 0xFFFFFFFF)
        for offset in (22, central + 24):
            struct.pack_into("<I", body, offset, len(prefix))
        self.rejected(lambda: backup.validate_dashboard_backup(bytes(body)), "archive_integrity")

    def test_member_and_total_budgets_checked_before_decoding(self):
        body = packed()
        with patch.object(backup, "MAX_MODEL_BYTES", 20), patch.object(backup, "_read_zip_member", side_effect=AssertionError("must not decode")):
            self.rejected(lambda: backup.validate_dashboard_backup(body), "member_budget")
        with patch.object(backup, "MAX_EXPANDED_BYTES", 100), patch.object(backup, "_read_zip_member", side_effect=AssertionError("must not decode")):
            self.rejected(lambda: backup.validate_dashboard_backup(body), "total_budget")
        with patch.object(backup, "MAX_ARCHIVE_BYTES", 100):
            self.rejected(lambda: backup.validate_dashboard_backup(body), "archive_size")

    def test_forged_small_central_count_cannot_bypass_actual_member_budget(self):
        body = bytearray(packed())
        struct.pack_into("<HH", body, len(body) - 22 + 8, 2, 2)
        self.rejected(lambda: backup.validate_dashboard_backup(bytes(body)), "archive_integrity")

    def test_duplicate_json_keys_nonfinite_utf8_surrogate_and_deep_input_rejected(self):
        for raw in (b'{"views":[],"views":[]}', b'{"views":[],"x":NaN}', b'{"views":[],"x":1e999}', b'{"views":[],"x":"\xff"}', b'{"views":[],"x":"\\ud800"}'):
            with self.subTest(raw=raw):
                value = inputs()
                value["raw_dashboard"] = raw
                self.rejected(lambda: prepare(value))
        value = inputs()
        deep = []
        for _ in range(backup.MAX_JSON_DEPTH + 1):
            deep = [deep]
        value["raw_dashboard"]["unknown"] = deep
        self.rejected(lambda: prepare(value), "json_complexity")

    def test_duplicate_json_keys_in_imported_manifest_and_layout_rejected(self):
        result = prepare()
        members = dict(result.members)
        members["manifest.json"] = b'{"version":1,"version":1}'
        self.rejected(lambda: backup.validate_dashboard_backup(archive(list(members.items()))), "duplicate_json_key")
        def change(manifest, files):
            row = manifest["layouts"][0]
            data = b'{"version":1,"version":1}'
            files[row["file"]["path"]] = data
            row["file"].update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        self.rejected(lambda: backup.validate_dashboard_backup(tampered(change)), "duplicate_json_key")

    def test_source_cycles_nonstring_keys_and_non_json_types_rejected(self):
        for transform in (lambda d: d.update(loop=d), lambda d: d.update({3: "non-string"}), lambda d: d.update(value={1, 2})):
            with self.subTest(transform=transform):
                value = inputs()
                transform(value["raw_dashboard"])
                self.rejected(lambda: prepare(value))

    def test_dashboard_wire_budget_and_integration_unicode_layout_budget(self):
        value = inputs()
        with patch.object(backup, "MAX_DASHBOARD_WIRE_BYTES", len(json.dumps(value["raw_dashboard"], ensure_ascii=False, separators=(",", ":")).encode()) + 1):
            self.rejected(lambda: prepare(value), "wire_budget")
        value = inputs()
        value.update(models={}, furniture_packs={})
        value["layouts"]["shared"]["layout"] = {"unicode": "é" * 50}
        with patch.object(backup, "MAX_LAYOUT_BYTES", 200):
            self.rejected(lambda: prepare(value), "layout_budget")

    def test_count_json_value_and_manifest_budgets(self):
        with patch.object(backup, "MAX_LAYOUTS", 0):
            self.rejected(lambda: prepare(), "count")
        with patch.object(backup, "MAX_JSON_VALUES", 10):
            self.rejected(lambda: prepare(), "json_complexity")
        with patch.object(backup, "MAX_MANIFEST_BYTES", 200):
            self.rejected(lambda: prepare(), "json_size")
        with patch.object(backup, "MAX_JSON_BYTES", 100):
            self.rejected(lambda: prepare(), "total_budget")

    def test_format_version_and_storage_provenance_are_strict(self):
        for mutate in (lambda m: m.update(version=True), lambda m: m.update(format="another-domain"), lambda m: m["layouts"][0].update(backend="guessed"), lambda m: m["dashboard"].pop("url_path"), lambda m: m["dashboard"].update(mode="assumed")):
            with self.subTest(mutate=mutate):
                self.rejected(lambda: backup.validate_dashboard_backup(tampered(lambda m, _: mutate(m))))

    def test_generated_layout_member_name_is_not_sanitized_or_relabelled(self):
        self.rejected(lambda: backup.validate_dashboard_backup(tampered(lambda m, _: m["layouts"][0]["file"].update(path="layouts/" + "0" * 64 + ".json"))), "descriptor")

    def test_resource_unknown_metadata_preserved_but_mode_type_and_url_strict(self):
        value = inputs()
        value["resources"]["items"][0]["unknown"] = {"opaque": [False, None]}
        self.assertEqual(prepare(value).manifest["resources"], value["resources"])
        for mutate in (lambda r: r.update(mode="guess"), lambda r: r["items"][0].update(type="execute"), lambda r: r["items"][0].update(url="")):
            with self.subTest(mutate=mutate):
                value = inputs()
                mutate(value["resources"])
                self.rejected(lambda: prepare(value), "resources" if value["resources"].get("mode") == "guess" or value["resources"]["items"][0]["type"] == "execute" else "text")

    def test_empty_seekable_temporary_file_stream_is_written_and_position_restored_on_read(self):
        result = prepare()
        with tempfile.TemporaryFile("w+b") as stream:
            report = backup.create_dashboard_backup(result, stream)
            self.assertEqual(stream.tell(), report["archive_bytes"])
            stream.seek(7)
            restored = backup.validate_dashboard_backup(stream)
            self.assertEqual(stream.tell(), 7)
            self.assertEqual(dict(restored.members), dict(result.members))

    def test_existing_output_untouched_and_no_mutation_after_bad_input(self):
        stream = io.BytesIO(b"existing important backup")
        self.rejected(lambda: backup.create_dashboard_backup(prepare(), stream), "output_not_empty")
        self.assertEqual(stream.getvalue(), b"existing important backup")
        value = inputs()
        value["raw_dashboard"]["unknown"] = float("inf")
        original = copy.deepcopy(value)
        self.rejected(lambda: prepare(value), "json_number")
        self.assertEqual(value, original)

    def test_archive_framing_budget_rejects_before_output_write(self):
        result = prepare()
        stream = io.BytesIO()
        with patch.object(backup, "MAX_ARCHIVE_BYTES", result.report()["expanded_bytes"]):
            self.rejected(lambda: backup.create_dashboard_backup(result, stream), "archive_size")
        self.assertEqual(stream.getvalue(), b"")

    def test_binary_io_failures_and_truncation_are_readable_and_input_position_restored(self):
        for raw in (b"", b"not a zip", packed()[:-2]):
            with self.subTest(raw=raw[:10]):
                stream = io.BytesIO(raw)
                stream.seek(min(2, len(raw)))
                position = stream.tell()
                self.rejected(lambda: backup.validate_dashboard_backup(stream))
                self.assertEqual(stream.tell(), position)
        self.rejected(lambda: backup.validate_dashboard_backup("not a stream"), "archive_integrity")

    def test_explicit_wrong_mapping_types_not_silently_normalized(self):
        for field, invalid in (("models", []), ("models", False), ("furniture_packs", []), ("diagnostics", False), ("extra", [])):
            with self.subTest(field=field):
                value = inputs()
                if field in ("models", "furniture_packs"):
                    value.update(models={}, furniture_packs={})
                value[field] = invalid
                self.rejected(lambda: prepare(value))

    def test_bad_extra_source_cycles_and_reserved_fields_are_readable(self):
        for extra in ({"version": 1}, {"value": float("nan")}, {"not_json": {1}}):
            with self.subTest(extra=extra):
                value = inputs()
                value["extra"] = extra
                self.rejected(lambda: prepare(value))
        value = inputs()
        extra = {}
        extra["cycle"] = extra
        value["extra"] = extra
        self.rejected(lambda: prepare(value))

    def test_canonical_member_paths_cannot_overflow_or_use_zip_metadata_aliases(self):
        info = zipfile.ZipInfo("dashboard.json")
        info.extra = b"\x75\x70\x00\x00"
        self.rejected(lambda: backup.validate_dashboard_backup(archive([(info, b"{}"), ("manifest.json", b"{}")])), "archive_format")

    def test_nested_original_pack_expansion_counts_toward_whole_verification_budget(self):
        result = prepare()
        self.assertGreater(result.report()["nested_expanded_bytes"], 0)
        self.assertEqual(result.report()["verified_expanded_bytes"], result.report()["expanded_bytes"] + result.report()["nested_expanded_bytes"])
        cap = result.report()["verified_expanded_bytes"] - 1
        with patch.object(backup, "MAX_EXPANDED_BYTES", cap):
            self.rejected(lambda: prepare(), "total_budget")
            self.rejected(lambda: backup.validate_dashboard_backup(packed(result)), "total_budget")

    def test_exact_referenced_key_pack_and_card_counts_are_bounded_even_if_missing(self):
        value = inputs()
        value.update(raw_dashboard={"views": [{"cards": [{"type": "custom:taylors3d-card", "layout_key": "one"}, {"type": "custom:taylors3d-card", "layout_key": "two"}]}]},
                     layouts={}, models={}, furniture_packs={})
        with patch.object(backup, "MAX_LAYOUTS", 1):
            self.rejected(lambda: prepare(value), "count")
        with patch.object(backup, "MAX_CARD_REFERENCES", 1):
            self.rejected(lambda: prepare(value), "card_budget")
        value = inputs()
        value["furniture_packs"] = {}
        value["layouts"]["shared"]["layout"]["furniture"]["instances"].append({"pack_id": "0" * 64, "item_id": "missing", "asset_sha256": "1" * 64})
        with patch.object(backup, "MAX_PACKS", 1):
            self.rejected(lambda: prepare(value), "count")

    def test_malformed_explicit_model_keeps_raw_value_but_cannot_claim_complete(self):
        for raw in (True, ["not a URL"], " "):
            with self.subTest(raw=raw):
                value = inputs()
                for entry in value["raw_dashboard"]["views"][0]["sections"][0]["cards"][:2]:
                    (entry.get("card") or entry)["model"] = raw
                value["models"] = {}
                result = prepare(value)
                self.assertFalse(result.complete)
                self.assertEqual(result.dashboard, value["raw_dashboard"])
                self.assertIn("model_reference", {row["code"] for row in result.report()["diagnostics"]})

    def test_unknown_reference_record_metadata_survives_without_weakening_known_licences(self):
        def add(manifest, _):
            manifest["cards"][0]["future"] = {"opaque": True}
            manifest["furniture"][0]["metadata"]["future"] = {"edition": 9}
            manifest["layouts"][0]["file"]["future"] = [None, False]
        result = backup.validate_dashboard_backup(tampered(add))
        self.assertEqual(result.manifest["cards"][0]["future"], {"opaque": True})
        self.assertEqual(result.manifest["furniture"][0]["metadata"]["future"], {"edition": 9})
        self.assertTrue(result.complete)

    def test_unknown_control_character_json_key_keeps_exact_missing_pointer(self):
        value = inputs()
        value.update(raw_dashboard={"views": [], "unknown\nkey": {"type": "custom:taylors3d-card", "layout_key": "lost"}}, layouts={}, models={}, furniture_packs={})
        result = backup.validate_dashboard_backup(packed(prepare(value)))
        self.assertEqual(result.manifest["cards"][0]["pointer"], "/unknown\nkey")
        self.assertIn("/unknown\nkey", {row["path"] for row in result.report()["diagnostics"]})
        self.assertEqual(result.dashboard, value["raw_dashboard"])

    def test_shared_model_bytes_deduplicate_but_each_exact_layout_link_remains(self):
        value = inputs()
        value["raw_dashboard"]["views"][0]["sections"][0]["cards"].append({"type": "custom:taylors3d-card", "layout_key": "second"})
        value["layouts"]["second"] = copy.deepcopy(value["layouts"]["shared"])
        value["models"]["second"] = value["models"]["shared"]
        result = backup.validate_dashboard_backup(packed(prepare(value)))
        self.assertEqual(result.report()["counts"]["models"], 2)
        self.assertEqual(len({row["file"]["path"] for row in result.manifest["models"]}), 1)
        self.assertTrue(result.complete)

    def test_streaming_writer_uses_bounded_chunks_and_never_selects_filesystem_path(self):
        class BoundedWrite(io.BytesIO):
            def write(self, data):
                if len(data) > backup.CHUNK:
                    raise AssertionError("unbounded write")
                return super().write(data)
        stream = BoundedWrite()
        with patch("builtins.open", side_effect=AssertionError("no path access")):
            result = prepare()
            backup.create_dashboard_backup(result, stream)
            self.assertTrue(backup.validate_dashboard_backup(stream).complete)

    def test_truncated_or_changed_input_stream_cannot_return_unverified_members(self):
        class TruncatedRead(io.BytesIO):
            def read(self, size=-1):
                return super().read(size)[:-1]
        self.rejected(lambda: backup.validate_dashboard_backup(TruncatedRead(packed())), "archive_integrity")

    def test_partial_temporary_write_failure_is_readable_without_touching_source(self):
        class BrokenWrite(io.BytesIO):
            def write(self, data):
                if self.tell() > 60:
                    raise OSError("synthetic temporary output failure")
                return super().write(data)
        result = prepare()
        members = dict(result.members)
        self.rejected(lambda: backup.create_dashboard_backup(result, BrokenWrite()), "archive_io")
        self.assertEqual(dict(result.members), members)

    def test_multibyte_memoryview_size_is_measured_in_bytes_before_conversion(self):
        body = fixture.glb()
        value = inputs()
        value["models"]["shared"] = memoryview(body).cast("I")
        with patch.object(backup, "MAX_MODEL_BYTES", len(body) // 2):
            self.rejected(lambda: prepare(value), "asset_size")
        data = array("I", [0] * 20)
        with patch.object(backup, "_json", side_effect=AssertionError("must reject before decode")):
            self.rejected(lambda: backup._encoded(memoryview(data), "input", 30), "json_size")

    def test_present_capture_time_is_strict_and_not_replaced_by_now(self):
        for invalid in ("", "not an ISO time", "2026-10-05T12:00:00", "2026-10-05T12:00:00+01:00"):
            with self.subTest(invalid=invalid):
                value = inputs()
                value["created_at"] = invalid
                self.rejected(lambda: prepare(value))
        value = inputs()
        value["created_at"] = "2026-10-05T12:00:00.123456+00:00"
        self.assertEqual(prepare(value).manifest["created_at"], value["created_at"])

    def test_zip_data_descriptors_from_real_nonseekable_writer_are_verified(self):
        class Nonseekable(io.BytesIO):
            def seek(self, *_):
                raise OSError("nonseekable writer")
        stream = Nonseekable()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as container:
            for name, body in prepare().members.items():
                container.writestr(name, body)
        data = stream.getvalue()
        self.assertTrue(backup.validate_dashboard_backup(data).complete)
        malformed = bytearray(data)
        descriptor = malformed.find(b"PK\x07\x08")
        malformed[descriptor + 4] ^= 1
        self.rejected(lambda: backup.validate_dashboard_backup(bytes(malformed)), "archive_integrity")

    def test_js_truthy_empty_explicit_model_objects_never_fall_back_to_uploaded_model(self):
        for raw in ({}, []):
            with self.subTest(raw=raw):
                value = inputs()
                for entry in value["raw_dashboard"]["views"][0]["sections"][0]["cards"][:2]:
                    target = entry["card"] if "card" in entry else entry
                    target["model"] = raw
                self.rejected(lambda: prepare(value), "unreferenced_model")
                value["models"] = {}
                result = prepare(value)
                self.assertFalse(result.complete)
                self.assertIn("model_reference", {row["code"] for row in result.report()["diagnostics"]})
                self.assertNotIn("model_missing", {row["code"] for row in result.report()["diagnostics"]})

    def test_js_false_model_overrides_preserve_actual_uploaded_fallback(self):
        for raw in (None, False, 0, -0.0, ""):
            with self.subTest(raw=raw):
                value = inputs()
                for entry in value["raw_dashboard"]["views"][0]["sections"][0]["cards"][:2]:
                    target = entry["card"] if "card" in entry else entry
                    target["model"] = raw
                result = prepare(value)
                self.assertTrue(result.complete)
                self.assertEqual(result.report()["counts"]["models"], 1)
                self.assertEqual(result.dashboard, value["raw_dashboard"])

    def test_js_truthy_malformed_upload_version_retains_ownership_and_diagnoses_it(self):
        for version in ({}, [], True):
            with self.subTest(version=version):
                value = inputs()
                value["layouts"]["shared"]["layout"]["model"]["version"] = version
                result = prepare(value)
                self.assertEqual(result.report()["counts"]["models"], 1)
                self.assertFalse(result.complete)
                self.assertIn("model_version", {row["code"] for row in result.report()["diagnostics"]})


if __name__ == "__main__":
    unittest.main(verbosity=2)
