"""Pure local planner proof: python tests/test_dashboard_restore.py.

No HA publication/session/storage/CAS claim. Load only the existing archive core
and the new planner, bypassing the integration's Home Assistant entry point.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
from types import MappingProxyType

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_NAME = "pure_dashboard_restore_tests"
PACKAGE = types.ModuleType(PACKAGE_NAME)
PACKAGE.__path__ = [str(ROOT / "custom_components" / "taylors3d")]
sys.modules[PACKAGE_NAME] = PACKAGE
SPEC = importlib.util.spec_from_file_location(PACKAGE_NAME + ".dashboard_restore", ROOT / "custom_components" / "taylors3d" / "dashboard_restore.py")
assert SPEC and SPEC.loader
restore = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = restore
SPEC.loader.exec_module(restore)
core = sys.modules[PACKAGE_NAME + ".dashboard_backup"]

FIXTURE_SPEC = importlib.util.spec_from_file_location("restore_archive_fixture", ROOT / "tests" / "test_dashboard_backup.py")
assert FIXTURE_SPEC and FIXTURE_SPEC.loader
fixture = importlib.util.module_from_spec(FIXTURE_SPEC)
FIXTURE_SPEC.loader.exec_module(fixture)


def source():
    return fixture.inputs()


def prepared(value=None):
    return core.prepare_dashboard_backup(**(source() if value is None else value))


def plan(value=None, namespace="recovered", **options):
    return restore.plan_dashboard_restore(prepared(value), namespace, **options)


def packed(value=None):
    output = io.BytesIO()
    core.create_dashboard_backup(prepared(value), output)
    return output.getvalue()


def cards(value):
    return value["views"][0]["sections"][0]["cards"]


class DashboardRestoreTest(unittest.TestCase):
    def rejected(self, call, code):
        with self.assertRaises((restore.DashboardRestoreError, core.DashboardBackupError)) as caught:
            call()
        self.assertEqual(caught.exception.code, code)
        self.assertTrue(caught.exception.path)
        self.assertTrue(caught.exception.message)

    def test_whole_dashboard_only_exact_taylor_keys_change(self):
        value = source()
        before = copy.deepcopy(value)
        result = plan(value)
        expected = copy.deepcopy(before["raw_dashboard"])
        target = result.layouts[0]["target_key"]
        cards(expected)[0]["layout_key"] = target
        cards(expected)[1]["card"]["layout_key"] = target
        self.assertEqual(result.dashboard, expected)
        self.assertEqual(value, before)
        self.assertEqual(result.layouts[0]["layout"], before["layouts"]["shared"]["layout"])
        self.assertEqual(result.resources, before["resources"])
        self.assertEqual(result.provenance["dashboard"]["metadata"], before["source"]["metadata"])

    def test_exact_default_taylor_key_becomes_explicit_new_shared_key(self):
        value = source()
        cards(value["raw_dashboard"])[0].pop("layout_key")
        cards(value["raw_dashboard"])[1]["card"].pop("layout_key")
        value["layouts"] = {"default": value["layouts"].pop("shared")}
        value["models"] = {"default": value["models"].pop("shared")}
        result = plan(value)
        self.assertEqual(result.layouts[0]["source_key"], "default")
        self.assertEqual(cards(result.dashboard)[0]["layout_key"], result.layouts[0]["target_key"])
        self.assertFalse(result.report()["patches"][0]["before_present"])

    def test_shared_layout_model_and_pack_assets_stage_once_with_original_bytes(self):
        value = source()
        result = plan(value)
        self.assertEqual(result.report()["counts"], {"cards": 2, "layouts": 1, "models": 1, "furniture_packs": 1})
        self.assertEqual(result.models[0]["target_key"], result.layouts[0]["target_key"])
        self.assertEqual(result.models[0]["original_bytes"], value["models"]["shared"])
        self.assertEqual(result.furniture[0]["original_bytes"], next(iter(value["furniture_packs"].values())))
        self.assertEqual(result.furniture[0]["pack_id"], hashlib.sha256(result.furniture[0]["original_bytes"]).hexdigest())
        self.assertIn("Supplied synthetic licence", result.furniture[0]["metadata"]["license"]["text"])
        self.assertEqual(result.furniture[0]["metadata"], prepared(value).manifest["furniture"][0]["metadata"])

    def test_original_noncanonical_json_bytes_retained_separately(self):
        value = source()
        value["raw_dashboard"] = json.dumps(value["raw_dashboard"], ensure_ascii=True, indent=4).encode()
        value["layouts"]["shared"]["layout"] = json.dumps(value["layouts"]["shared"]["layout"], ensure_ascii=True, indent=2).encode()
        result = plan(value)
        self.assertEqual(result.original_dashboard_bytes, value["raw_dashboard"])
        self.assertEqual(result.layouts[0]["original_bytes"], value["layouts"]["shared"]["layout"])
        self.assertIs(result.layouts[0]["original_bytes"], result.layouts[0]["staged_bytes"])
        self.assertEqual(result.layouts[0]["layout"], json.loads(value["layouts"]["shared"]["layout"]))

    def test_mutating_returned_views_never_changes_plan_or_assets(self):
        result = plan()
        original_dashboard = result.dashboard
        original_report = result.report()
        original_layouts = result.layouts
        original_furniture = result.furniture
        result.dashboard["views"].clear()
        result.report()["patches"].clear()
        result.save_message["config"].clear()
        result.target_dashboard["url_path"] = "old-dashboard"
        result.resources["items"].clear()
        result.layouts[0]["layout"]["rooms"].clear()
        result.models[0]["metadata"].clear()
        result.furniture[0]["metadata"]["license"].clear()
        result.provenance["source_manifest"].clear()
        self.assertEqual(result.dashboard, original_dashboard)
        self.assertEqual(result.report(), original_report)
        self.assertEqual(result.layouts, original_layouts)
        self.assertEqual(result.furniture, original_furniture)
        self.assertTrue(result.target_dashboard["url_path"].startswith("taylors3d-restore-"))

    def test_nested_unknown_wrappers_and_escaped_json_pointers_preserved(self):
        value = source()
        value["raw_dashboard"]["/~unknown"] = {"deep~name": [{"type": "custom:taylors3d-card", "layout_key": "shared", "entities": ["light.exact"]}]}
        result = plan(value)
        self.assertEqual(result.dashboard["/~unknown"]["deep~name"][0]["entities"], ["light.exact"])
        patch_rows = result.report()["patches"]
        self.assertTrue(any(row["pointer"] == "/~1~0unknown/deep~0name/0/layout_key" for row in patch_rows))
        self.assertEqual(result.report()["counts"]["cards"], 3)

    def test_invalid_namespace_types_and_paths_are_rejected(self):
        for namespace in (None, False, "", "Upper", " ../unsafe", "x/y", "x_y", "x\x00y", "x" * 25, "-edge", "edge-", "💡"):
            with self.subTest(namespace=namespace):
                self.rejected(lambda: plan(namespace=namespace), "namespace")

    def test_safe_namespace_keys_are_deterministic_bounded_and_different(self):
        first, second = plan(namespace="a" * 24), plan(namespace="a" * 24)
        self.assertEqual(first.report(), second.report())
        self.assertEqual(first.layouts[0]["target_key"], second.layouts[0]["target_key"])
        self.assertLessEqual(len(first.layouts[0]["target_key"]), 64)
        self.assertNotEqual(first.layouts[0]["target_key"], "shared")
        self.assertNotEqual(first.layouts[0]["target_key"], plan(namespace="another").layouts[0]["target_key"])

    def test_collision_with_an_old_archived_key_cannot_be_planned_as_new(self):
        value = source()
        first_target = plan(value).layouts[0]["target_key"]
        second_layout = {"version": 1, "unknown": "retain"}
        value["layouts"][first_target] = {"backend": "shared", "layout": second_layout, "metadata": {}}
        cards(value["raw_dashboard"]).append({"type": "custom:taylors3d-card", "layout_key": first_target})
        self.rejected(lambda: plan(value), "source_key_collision")

    def test_internal_target_collision_is_checked(self):
        value = source()
        value["layouts"]["another"] = {"backend": "shared", "layout": {}, "metadata": {}}
        cards(value["raw_dashboard"]).append({"type": "custom:taylors3d-card", "layout_key": "another"})
        with patch.object(restore, "_target_key", return_value="same_generated_key"):
            self.rejected(lambda: plan(value), "namespace_collision")

    def test_external_namespace_absence_is_not_claimed_or_checked(self):
        result = plan()
        self.assertEqual(result.report()["collision_checked"], {"internal": True, "external": False})
        self.assertFalse(result.report()["publication_available"])
        self.assertTrue(result.report()["requires_current_admin_at_publication"])
        self.assertTrue(result.report()["requires_shared_integration"])
        self.assertEqual(result.target_dashboard["mode"], "storage")
        self.assertEqual(result.save_message["type"], "lovelace/config/save")
        self.assertEqual(result.save_message["url_path"], result.target_dashboard["url_path"])
        self.assertEqual(result.save_message["config"], result.dashboard)

    def test_browser_and_user_layouts_are_explicitly_promoted_without_config_guess(self):
        for backend in ("browser", "user", "shared"):
            value = source()
            value["layouts"]["shared"]["backend"] = backend
            cards(value["raw_dashboard"])[0]["storage"] = "unknown-extension-preserved"
            result = plan(value)
            self.assertEqual(result.layouts[0]["source_backend"], backend)
            self.assertEqual(result.layouts[0]["target_backend"], "shared")
            self.assertEqual(cards(result.dashboard)[0]["storage"], "unknown-extension-preserved")
            promoted = [row for row in result.report()["diagnostics"] if row["code"] == "storage_promoted"]
            self.assertEqual(len(promoted), int(backend != "shared"))

    def test_yaml_and_generated_strategy_keep_raw_data_with_storage_conversion_notice(self):
        for mode in ("yaml", "generated"):
            value = source()
            value["source"]["mode"] = mode
            value["raw_dashboard"]["strategy"] = {"type": "custom:unknown-strategy", "options": {"untouched": [None, False]}}
            result = plan(value)
            self.assertEqual(result.dashboard["strategy"], value["raw_dashboard"]["strategy"])
            self.assertEqual(result.provenance["dashboard"]["mode"], mode)
            notice = next(row for row in result.report()["diagnostics"] if row["code"] == "storage_conversion")
            self.assertIn("YAML files/comments are not restored", notice["message"])

    def test_pure_strategy_dashboard_with_no_taylor_card_is_preserved(self):
        value = source()
        value["raw_dashboard"] = {"strategy": {"type": "auto", "unknown": {"b": [False]}}, "title": "Raw"}
        value["layouts"], value["models"], value["furniture_packs"] = {}, {}, {}
        result = plan(value)
        self.assertEqual(result.dashboard, value["raw_dashboard"])
        self.assertEqual(result.layouts, [])
        self.assertEqual(result.models, [])
        self.assertEqual(result.report()["patches"], [])

    def test_owned_url_rewrites_only_when_exact_model_member_exists(self):
        value = source()
        version = value["layouts"]["shared"]["layout"]["model"]["version"]
        cards(value["raw_dashboard"])[1]["card"]["model"] = "/api/taylors3d/model/shared?v=" + version
        result = plan(value)
        url = cards(result.dashboard)[1]["card"]["model"]
        self.assertEqual(url, "/api/taylors3d/model/" + result.models[0]["target_key"] + "?v=" + version)
        row = next(row for row in result.report()["patches"] if row["reason"] == "verified_model_asset")
        self.assertEqual(row["before"], cards(value["raw_dashboard"])[1]["card"]["model"])

    def test_only_staged_exact_owned_model_dependency_is_resolved_in_plan_report(self):
        value = source()
        value["resources"]["items"] = []
        cards(value["raw_dashboard"])[1]["card"]["model"] = "/api/taylors3d/model/shared"
        result = plan(value)
        self.assertTrue(result.report()["dependency_free"])
        self.assertTrue(any(row["code"] == "model_dependency" for row in result.provenance["source_manifest"]["diagnostics"]))
        self.assertTrue(any(row["code"] == "model_dependency_resolved" and row["severity"] == "info" for row in result.report()["diagnostics"]))
        self.assertFalse(any(row["code"] == "model_dependency" and row["severity"] == "dependency" for row in result.report()["diagnostics"]))
        cards(value["raw_dashboard"])[1]["card"]["model"] = "https://example.invalid/original.glb"
        self.assertFalse(plan(value).report()["dependency_free"])

    def test_external_models_resources_and_non_taylor_model_paths_are_untouched(self):
        value = source()
        cards(value["raw_dashboard"])[1]["card"]["model"] = "https://example.invalid/original.glb?unknown=1"
        cards(value["raw_dashboard"])[2]["model"] = "/api/taylors3d/model/shared"
        result = plan(value)
        self.assertEqual(cards(result.dashboard)[1]["card"]["model"], cards(value["raw_dashboard"])[1]["card"]["model"])
        self.assertEqual(cards(result.dashboard)[2], cards(value["raw_dashboard"])[2])
        self.assertEqual(result.resources, value["resources"])
        self.assertFalse(result.report()["resources_installed"])
        self.assertFalse(result.report()["dependency_free"])
        self.assertTrue(any(row["code"] == "model_dependency" for row in result.report()["diagnostics"]))

    def test_truthy_malformed_explicit_model_is_not_replaced_with_uploaded_asset(self):
        value = source()
        cards(value["raw_dashboard"])[1]["card"]["model"] = {}
        self.rejected(lambda: plan(value), "incomplete_backup")
        result = plan(value, allow_incomplete=True)
        self.assertEqual(cards(result.dashboard)[1]["card"]["model"], {})
        self.assertFalse(result.report()["complete"])

    def test_missing_layout_default_blocks_and_explicit_partial_uses_unpopulated_new_key(self):
        value = source()
        value["layouts"], value["models"], value["furniture_packs"] = {}, {}, {}
        self.rejected(lambda: plan(value), "incomplete_backup")
        result = plan(value, allow_incomplete=True)
        self.assertFalse(result.report()["complete"])
        self.assertFalse(result.layouts[0]["available"])
        self.assertIsNone(result.layouts[0]["layout"])
        self.assertIsNone(result.layouts[0]["original_bytes"])
        self.assertNotEqual(cards(result.dashboard)[0]["layout_key"], "shared")
        self.assertTrue(any(row["code"] == "incomplete_allowed" for row in result.report()["diagnostics"]))

    def test_missing_uploaded_model_has_new_unpopulated_model_target(self):
        value = source()
        value["models"] = {}
        self.rejected(lambda: plan(value), "incomplete_backup")
        result = plan(value, allow_incomplete=True)
        self.assertFalse(result.models[0]["available"])
        self.assertIsNone(result.models[0]["original_bytes"])
        self.assertEqual(result.models[0]["target_key"], result.layouts[0]["target_key"])
        self.assertEqual(result.layouts[0]["layout"]["model"], value["layouts"]["shared"]["layout"]["model"])

    def test_missing_original_owned_url_never_points_to_old_mutable_model(self):
        value = source()
        cards(value["raw_dashboard"])[1]["card"]["model"] = "/api/taylors3d/model/not-captured?v=oldversion"
        self.rejected(lambda: plan(value), "owned_model_missing")
        result = plan(value, allow_incomplete=True)
        missing = next(row for row in result.models if row["source_key"] == "not-captured")
        self.assertFalse(missing["available"])
        self.assertNotIn("not-captured", cards(result.dashboard)[1]["card"]["model"])
        self.assertEqual(cards(result.dashboard)[1]["card"]["model"], "/api/taylors3d/model/" + missing["target_key"] + "?v=oldversion")
        self.assertFalse(result.report()["complete"])

    def test_noncanonical_owned_urls_fail_instead_of_retaining_old_storage_alias(self):
        for url in ("/api/taylors3d/model/%73hared", "/api/taylors3d/model/shared?foo=1", "/api/taylors3d/model/shared#fragment"):
            value = source()
            cards(value["raw_dashboard"])[1]["card"]["model"] = url
            self.rejected(lambda: plan(value, allow_incomplete=True), "owned_model_url")

    def test_missing_pack_and_deleted_original_entity_floor_refs_are_not_guessed(self):
        value = source()
        value["furniture_packs"] = {}
        result = plan(value, allow_incomplete=True)
        self.assertEqual(result.layouts[0]["layout"], value["layouts"]["shared"]["layout"])
        self.assertEqual(len(result.furniture), 1)
        self.assertEqual(result.furniture[0]["pack_id"], next(iter(source()["furniture_packs"])))
        self.assertFalse(result.furniture[0]["available"])
        self.assertIsNone(result.furniture[0]["original_bytes"])
        self.assertFalse(result.report()["complete"])
        self.assertTrue(any(row["code"] == "pack_missing" for row in result.report()["diagnostics"]))

    def test_invalid_explicit_layout_key_fails_even_for_allowed_incomplete(self):
        value = source()
        cards(value["raw_dashboard"])[1]["card"]["layout_key"] = {}
        self.rejected(lambda: plan(value, allow_incomplete=True), "layout_key")

    def test_archive_bytes_and_stream_use_public_validator_and_restore_stream_position(self):
        body = packed()
        first = restore.plan_dashboard_restore(body, "from-bytes")
        stream = io.BytesIO(body)
        stream.seek(13)
        second = restore.plan_dashboard_restore(stream, "from-bytes")
        self.assertEqual(first.report(), second.report())
        self.assertEqual(first.dashboard, second.dashboard)
        self.assertEqual(stream.tell(), 13)
        self.rejected(lambda: restore.plan_dashboard_restore(body[:-1], "broken"), "archive_integrity")

    def test_forged_sealed_report_cannot_claim_missing_references_complete(self):
        value = source()
        value["models"] = {}
        genuine = prepared(value)
        forged = core.DashboardBackup(genuine.members, b'{"complete":true}')
        self.rejected(lambda: restore.plan_dashboard_restore(forged, "forged"), "incomplete_backup")

    def test_forged_member_bytes_must_revalidate_hashes_without_writes(self):
        genuine = prepared()
        members = dict(genuine.members)
        members["dashboard.json"] = b'{"views":[]}'
        forged = core.DashboardBackup(MappingProxyType(members), b'{"complete":true}')
        self.rejected(lambda: restore.plan_dashboard_restore(forged, "forged"), "hash")

    def test_explicit_incomplete_flag_is_not_coerced(self):
        for flag in (None, 1, "yes", [], {}):
            self.rejected(lambda: plan(allow_incomplete=flag), "allow_incomplete")

    def test_new_save_envelope_is_bounded_after_long_fresh_keys_are_inserted(self):
        value = source()
        original = prepared(value)
        old_message = {"id": 1, "type": "lovelace/config/save", "url_path": value["source"]["url_path"], "config": value["raw_dashboard"]}
        original_size = len(json.dumps(old_message, ensure_ascii=False, separators=(",", ":")).encode())
        with patch.object(restore, "MAX_DASHBOARD_WIRE_BYTES", original_size + 10):
            self.rejected(lambda: restore.plan_dashboard_restore(original, "long-new-namespace"), "wire_budget")

    def test_new_default_card_key_cannot_exceed_core_json_value_budget(self):
        value = source()
        cards(value["raw_dashboard"])[0].pop("layout_key")
        cards(value["raw_dashboard"])[1]["card"].pop("layout_key")
        value["layouts"] = {"default": value["layouts"].pop("shared")}
        value["models"] = {"default": value["models"].pop("shared")}
        original = prepared(value)
        pending, values = [value["raw_dashboard"]], 0
        while pending:
            node = pending.pop()
            values += 1
            if isinstance(node, dict):
                pending.extend(child for pair in node.items() for child in pair)
            elif isinstance(node, list):
                pending.extend(node)
        with patch.object(restore, "MAX_JSON_VALUES", values, create=True):
            self.rejected(lambda: restore.plan_dashboard_restore(original, "values"), "json_budget")

    def test_tree_budget_counts_raw_object_keys_like_archive_core(self):
        original = prepared()
        pending, values = [original.dashboard], 0
        while pending:
            node = pending.pop()
            values += 1
            if isinstance(node, dict):
                pending.extend(child for pair in node.items() for child in pair)
            elif isinstance(node, list):
                pending.extend(node)
        with patch.object(restore, "MAX_JSON_VALUES", values - 1):
            self.rejected(lambda: restore.plan_dashboard_restore(original, "values"), "json_budget")

    def test_target_dashboard_cannot_equal_the_old_captured_dashboard(self):
        value = source()
        value["source"]["url_path"] = "taylors3d-restore-recovered"
        self.rejected(lambda: plan(value), "source_dashboard_collision")

    def test_missing_layout_collision_preview_includes_actual_fallback_storage_keys(self):
        value = source()
        value["layouts"], value["models"], value["furniture_packs"] = {}, {}, {}
        result = plan(value, allow_incomplete=True)
        target = result.layouts[0]["target_key"]
        self.assertEqual(result.report()["collision_targets"]["legacy_fallback_keys"], ["taylors3d_" + target])
        self.assertTrue(any(row["code"] == "fallback_collision_review" for row in result.report()["diagnostics"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
