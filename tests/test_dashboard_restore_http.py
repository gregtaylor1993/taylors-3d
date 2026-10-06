"""Scoped stdlib staging proof: python tests/test_dashboard_restore_http.py.

Real ZIP/planner/furniture storage and exclusive model files, fake HA-loop/store
interfaces only. These tests do NOT prove Home Assistant middleware/router/auth.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
NAME = "pure_dashboard_restore_http_tests"
PACKAGE = types.ModuleType(NAME)
PACKAGE.__path__ = [str(ROOT / "custom_components" / "taylors3d")]
sys.modules[NAME] = PACKAGE
SPEC = importlib.util.spec_from_file_location(NAME + ".dashboard_restore_http", ROOT / "custom_components/taylors3d/dashboard_restore_http.py")
assert SPEC and SPEC.loader
adapter = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = adapter
SPEC.loader.exec_module(adapter)
core = sys.modules[NAME + ".dashboard_backup"]
restore = sys.modules[NAME + ".dashboard_restore"]
furniture = sys.modules[NAME + ".furniture"]
FIXTURE_SPEC = importlib.util.spec_from_file_location("restore_http_archive_fixture", ROOT / "tests/test_dashboard_backup.py")
assert FIXTURE_SPEC and FIXTURE_SPEC.loader
fixture = importlib.util.module_from_spec(FIXTURE_SPEC)
FIXTURE_SPEC.loader.exec_module(fixture)


def source():
    return fixture.inputs()


def planned(value=None, namespace="recovered", **options):
    return restore.plan_dashboard_restore(core.prepare_dashboard_backup(**(source() if value is None else value)), namespace, **options)


def archive(value=None):
    target = io.BytesIO()
    core.create_dashboard_backup(core.prepare_dashboard_backup(**(source() if value is None else value)), target)
    return target.getvalue()


class Store:
    def __init__(self):
        self.values, self.writes = {}, []

    def get(self, key):
        return self.values.get(key)

    def contains(self, key):
        return key in self.values

    def set(self, key, layout):
        self.values[key] = layout
        self.writes.append((key, layout))


class Hass:
    def __init__(self):
        self.data = {}

    async def async_add_executor_job(self, function, *args):
        return await asyncio.to_thread(function, *args)


class Content:
    def __init__(self, body, *, after_read=None):
        self.body, self.offset, self.after_read = body, 0, after_read

    async def read(self, count):
        value = self.body[self.offset:self.offset + count]
        self.offset += len(value)
        if self.after_read:
            self.after_read()
        return value


class PanelCompatibilityTest(unittest.TestCase):
    def test_frontend_store_reader_accepts_current_object_and_legacy_store_tuple(self):
        data = {"occupied-null": None, "occupied-false": False}
        modern = types.SimpleNamespace(data=data)
        legacy_store = types.SimpleNamespace(async_save=lambda _data: None)
        self.assertIs(adapter.user_storage_data(modern), data)
        self.assertIs(adapter.user_storage_data((legacy_store, data)), data)
        self.assertTrue("occupied-null" in adapter.user_storage_data((legacy_store, data)))
        self.assertTrue("occupied-false" in adapter.user_storage_data(modern))

    def test_frontend_store_reader_rejects_malformed_or_unproven_shapes(self):
        legacy_store = types.SimpleNamespace(async_save=lambda _data: None)
        for store in (None, [], ({}, {}), (legacy_store,), (legacy_store, {}, None),
                      [legacy_store, {}], (legacy_store, None), (legacy_store, []),
                      types.SimpleNamespace(), types.SimpleNamespace(data=None),
                      types.SimpleNamespace(data=[])):
            with self.subTest(store=store):
                with self.assertRaises(adapter.RestoreHTTPError) as caught:
                    adapter.user_storage_data(store)
                self.assertEqual(caught.exception.code, "platform_unavailable")

    def test_lovelace_maps_support_exact_legacy_dict_and_current_object(self):
        dashboards, yaml = {"null": None}, {"yaml": {"mode": "yaml"}}
        for data in ({"mode": "storage", "dashboards": dashboards, "yaml_dashboards": yaml},
                     types.SimpleNamespace(resource_mode="storage", dashboards=dashboards, yaml_dashboards=yaml)):
            with self.subTest(data=data):
                actual = adapter.dashboard_maps(data)
                self.assertIs(actual[0], dashboards)
                self.assertIs(actual[1], yaml)
                self.assertIn("null", actual[0])

    def test_lovelace_maps_reject_absent_or_malformed_registry(self):
        for data in (None, {}, [], {"dashboards": {}, "yaml_dashboards": None},
                     {"dashboards": [], "yaml_dashboards": {}}, types.SimpleNamespace(dashboards={})):
            with self.subTest(data=data):
                with self.assertRaises(adapter.RestoreHTTPError) as caught:
                    adapter.dashboard_maps(data)
                self.assertEqual(caught.exception.code, "platform_unavailable")

    def test_current_public_api_is_used_without_reading_legacy_registry(self):
        hass = Hass()
        calls = []
        frontend = types.SimpleNamespace(async_panel_exists=lambda actual, path: calls.append((actual, path)) or True)
        self.assertTrue(adapter.panel_exists(hass, frontend, "occupied"))
        self.assertEqual(calls, [(hass, "occupied")])
        frontend.async_panel_exists = lambda _actual, _path: False
        self.assertFalse(adapter.panel_exists(hass, frontend, "fresh"))
        self.assertEqual(hass.data, {})

    def test_legacy_registry_membership_includes_null_and_false_entries(self):
        hass = Hass()
        registry = {"null": None, "false": False, "panel": object()}
        hass.data["actual_registry"] = registry
        frontend = types.SimpleNamespace(DATA_PANELS="actual_registry")
        for path in registry:
            with self.subTest(path=path):
                self.assertTrue(adapter.panel_exists(hass, frontend, path))
        self.assertFalse(adapter.panel_exists(hass, frontend, "fresh"))
        self.assertIs(hass.data["actual_registry"], registry)

    def test_legacy_uninitialised_registry_matches_ha_absence_without_creating_it(self):
        hass = Hass()
        frontend = types.SimpleNamespace(DATA_PANELS="actual_registry")
        self.assertFalse(adapter.panel_exists(hass, frontend, "fresh"))
        self.assertEqual(hass.data, {})

    def test_legacy_collision_reader_uses_latest_registry_each_time(self):
        hass = Hass()
        frontend = types.SimpleNamespace(DATA_PANELS="actual_registry")
        self.assertFalse(adapter.panel_exists(hass, frontend, "new"))
        hass.data[frontend.DATA_PANELS] = {"new": None}
        self.assertTrue(adapter.panel_exists(hass, frontend, "new"))
        hass.data[frontend.DATA_PANELS] = {}
        self.assertFalse(adapter.panel_exists(hass, frontend, "new"))

    def test_unknown_or_malformed_legacy_registry_fails_closed(self):
        hass = Hass()
        for frontend in (types.SimpleNamespace(), types.SimpleNamespace(DATA_PANELS=None),
                         types.SimpleNamespace(DATA_PANELS=[])):
            with self.subTest(frontend=frontend), self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter.panel_exists(hass, frontend, "fresh")
            self.assertEqual(caught.exception.code, "platform_unavailable")
        frontend = types.SimpleNamespace(DATA_PANELS="actual_registry")
        for value in (None, [], "fresh", False):
            hass.data[frontend.DATA_PANELS] = value
            with self.subTest(value=value), self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter.panel_exists(hass, frontend, "fresh")
            self.assertEqual(caught.exception.code, "platform_unavailable")

    def test_nonboolean_or_noncallable_new_api_fails_closed_without_fallback(self):
        hass = Hass()
        frontend = types.SimpleNamespace(DATA_PANELS="actual_registry")
        for value in (None, False, 0, "function"):
            frontend.async_panel_exists = value
            with self.subTest(value=value), self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter.panel_exists(hass, frontend, "fresh")
            self.assertEqual(caught.exception.code, "platform_unavailable")
        for value in (None, 0, 1, [], "absent"):
            frontend.async_panel_exists = lambda _hass, _path: value
            with self.subTest(value=value), self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter.panel_exists(hass, frontend, "fresh")
            self.assertEqual(caught.exception.code, "platform_unavailable")


class RestoreArgumentsTest(unittest.TestCase):
    def test_strict_namespace_and_explicit_query(self):
        self.assertFalse(adapter.stage_arguments("r", {}))
        self.assertFalse(adapter.stage_arguments("r-1", {"allow_incomplete": "0"}))
        self.assertTrue(adapter.stage_arguments("r-1", {"allow_incomplete": "1"}))
        for namespace in (None, True, "", "Upper", "../old", "x/y", "x_", "edge-", "-edge", "x" * 25, "💡"):
            with self.subTest(namespace=namespace), self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter.stage_arguments(namespace, {})
            self.assertEqual(caught.exception.code, "namespace")
        for query in ({"extra": "1"}, {"allow_incomplete": True}, {"allow_incomplete": "true"},
                      {"allow_incomplete": "01"}, {"allow_incomplete": "1", "other": "0"}):
            with self.subTest(query=query), self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter.stage_arguments("safe", query)
            self.assertEqual(caught.exception.code, "query")

    def test_wrong_shape_query_has_coded_error(self):
        for query in (None, [], "allow_incomplete=1", True):
            with self.subTest(query=query):
                with self.assertRaises(adapter.RestoreHTTPError) as caught:
                    adapter.stage_arguments("safe", query)
                self.assertEqual(caught.exception.code, "query")

    def test_duplicate_multidict_values_rejected(self):
        query = types.SimpleNamespace(items=lambda: [("allow_incomplete", "0"), ("allow_incomplete", "1")])
        with self.assertRaises(adapter.RestoreHTTPError) as caught:
            adapter.stage_arguments("safe", query)
        self.assertEqual(caught.exception.code, "query")


class RestoreFileTest(unittest.TestCase):
    def test_atomic_new_model_original_bytes_and_no_temporary_left(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "taylors3d/models/new.glb"
            body = source()["models"]["shared"]
            result = adapter.stage_model_file(path, body, hashlib.sha256(body).hexdigest())
            self.assertEqual(path.read_bytes(), body)
            self.assertTrue(result["exclusive"] and result["integrity_verified"])
            self.assertEqual(list(path.parent.iterdir()), [path])

    def test_existing_or_concurrent_target_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "taylors3d/models/new.glb"
            path.parent.mkdir(parents=True)
            body = source()["models"]["shared"]
            path.write_bytes(b"older unchanged")
            with self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter.stage_model_file(path, body, hashlib.sha256(body).hexdigest())
            self.assertEqual(caught.exception.code, "collision")
            self.assertEqual(path.read_bytes(), b"older unchanged")
            path.unlink()

            def another_writer(_temporary, destination):
                destination.write_bytes(b"concurrent unchanged")
                raise FileExistsError()

            with patch.object(adapter.os, "link", side_effect=another_writer), self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter.stage_model_file(path, body, hashlib.sha256(body).hexdigest())
            self.assertEqual(caught.exception.code, "collision")
            self.assertEqual(path.read_bytes(), b"concurrent unchanged")
            self.assertEqual(list(path.parent.iterdir()), [path])

    def test_directory_or_published_hardlink_alias_is_never_fresh_target(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "taylors3d/models/new.glb"
            path.mkdir(parents=True)
            with self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter._safe_model_path(path)
            self.assertEqual(caught.exception.code, "collision")
            path.rmdir()
            original = Path(folder) / "old.glb"
            original.write_bytes(b"unchanged original")
            adapter.os.link(original, path)
            with self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter._safe_model_path(path)
            self.assertEqual(caught.exception.code, "collision")
            self.assertEqual(original.read_bytes(), path.read_bytes())

    def test_impossible_exclusive_publication_and_hash_failure_do_not_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "taylors3d/models/new.glb"
            body = source()["models"]["shared"]
            with self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter.stage_model_file(path, body, "0" * 64)
            self.assertEqual(caught.exception.code, "asset_integrity")
            self.assertFalse(path.parent.exists())
            with patch.object(adapter.os, "link", side_effect=OSError("unsupported")), self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter.stage_model_file(path, body, hashlib.sha256(body).hexdigest())
            self.assertEqual(caught.exception.code, "exclusive_publication_unavailable")
            self.assertFalse(path.exists())
            self.assertEqual(list(path.parent.iterdir()), [])

    def test_post_link_integrity_failure_is_reported_as_new_orphan(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "taylors3d/models/new.glb"
            body = source()["models"]["shared"]
            with patch.object(adapter, "read_owned_model", return_value=b"changed"), self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter.stage_model_file(path, body, hashlib.sha256(body).hexdigest())
            self.assertTrue(caught.exception.published_new_model)
            self.assertTrue(path.exists())

    def test_post_link_temporary_cleanup_error_keeps_publication_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "taylors3d/models/new.glb"
            body = source()["models"]["shared"]
            original_unlink = Path.unlink
            def unavailable_temporary_unlink(target, *args, **kwargs):
                if target.name.startswith(".restore-"):
                    raise OSError("Simulated temporary cleanup failure")
                return original_unlink(target, *args, **kwargs)
            with patch.object(Path, "unlink", autospec=True, side_effect=unavailable_temporary_unlink), self.assertRaises(OSError) as caught:
                adapter.stage_model_file(path, body, hashlib.sha256(body).hexdigest())
            self.assertTrue(getattr(caught.exception, "published_new_model", False))
            self.assertEqual(path.read_bytes(), body)

    def test_owned_directory_symlink_rejected_if_supported(self):
        with tempfile.TemporaryDirectory() as folder:
            target, root = Path(folder) / "target", Path(folder) / "taylors3d"
            target.mkdir()
            try:
                root.symlink_to(target, target_is_directory=True)
            except OSError:
                self.skipTest("OS account cannot create symlinks")
            with self.assertRaises(adapter.RestoreHTTPError) as caught:
                adapter._safe_model_path(root / "models/new.glb")
            self.assertEqual(caught.exception.code, "unsafe_storage")


class RestoreStagerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.hass, self.store = Hass(), Store()
        self.library = furniture.FurnitureLibrary(self.root / "taylors3d/furniture")
        self.hass.data[adapter.DOMAIN] = self.store
        self.hass.data[adapter.DATA_FURNITURE] = self.library
        self.active, self.platform_calls = True, 0
        self.platform_hook = None
        self.stager = adapter.RestoreStager(self.hass, self.store, self.library,
            lambda key: self.root / "taylors3d/models" / (key + ".glb"), self.platform)

    async def check(self):
        if not self.active:
            raise adapter.BackupHTTPError("auth", "Current authorization changed.")

    async def platform(self, _plan, check):
        await check()
        self.platform_calls += 1
        if self.platform_hook:
            await self.platform_hook(self.platform_calls)
        return {"dashboard": "absent_at_check", "user_fallbacks": "all_current_users_absent_at_check",
                "browser": "not_read;unchanged_and_shadowed_by_populated_shared_layouts", "transaction": False}

    async def rejected(self, plan, code):
        with self.assertRaises((adapter.RestoreHTTPError, adapter.BackupHTTPError, furniture.FurnitureStorageError)) as caught:
            await self.stager.stage(plan, "recovered", self.check)
        self.assertEqual(caught.exception.code, code)

    async def test_full_stage_preserves_original_assets_raw_layout_and_no_dashboard_call(self):
        value, plan = source(), planned()
        before = copy.deepcopy(value)
        result = await self.stager.stage(plan, "recovered", self.check)
        self.assertTrue(result["ok"])
        self.assertFalse(result["staging"]["dashboard_created"] or result["staging"]["resources_installed"])
        self.assertEqual(result["report"]["collision_checked"], {"internal": True, "external": False})
        self.assertEqual(result["save_message"], plan.save_message)
        self.assertEqual(result["staging"]["layouts_persistence"], "scheduled_not_durable")
        key = plan.layouts[0]["target_key"]
        self.assertEqual(self.store.get(key), value["layouts"]["shared"]["layout"])
        self.assertEqual(self.stager.model_path(key).read_bytes(), value["models"]["shared"])
        original_pack = next(iter(value["furniture_packs"].values()))
        self.assertEqual(self.library.archive(plan.furniture[0]["pack_id"]), original_pack)
        self.assertEqual(value, before)
        self.assertEqual(result["orphans"], [])
        self.assertTrue(result["staging"]["integrity_verified"])
        self.assertEqual(len(result["restore_id"]), 32)
        self.assertEqual(self.platform_calls, 3)

    async def test_stage_response_and_ledger_defensive_copies(self):
        plan = planned()
        result = await self.stager.stage(plan, "recovered", self.check)
        result["save_message"]["config"].clear()
        result["staging"]["layouts"].clear()
        self.stager.snapshot("recovered")["models"].clear()
        self.assertEqual(len(self.stager.snapshot("recovered")["models"]), 1)
        self.assertEqual(self.store.get(plan.layouts[0]["target_key"]), plan.layouts[0]["layout"])

    async def test_existing_shared_model_and_platform_collision_each_prevent_all_writes(self):
        plan = planned()
        key = plan.layouts[0]["target_key"]
        old = {"old": "unchanged"}
        self.store.values[key] = old
        await self.rejected(plan, "collision")
        self.assertIs(self.store.get(key), old)
        self.assertEqual(self.store.writes, [])

        self.assertFalse((self.root / "taylors3d/models").exists())
        self.store.values.clear()
        path = self.stager.model_path(key)
        path.parent.mkdir(parents=True)
        path.write_bytes(b"old model")
        await self.rejected(plan, "collision")
        self.assertEqual(path.read_bytes(), b"old model")
        self.assertEqual(self.library.catalogue()["packs"], [])
        path.unlink()

        async def collision(_count):
            raise adapter.RestoreHTTPError("collision", "Dashboard or user fallback exists.")

        self.platform_hook = collision
        await self.rejected(plan, "collision")
        self.assertEqual(self.store.writes, [])

    async def test_existing_null_shared_key_is_a_collision_never_overwritten(self):
        plan = planned()
        key = plan.layouts[0]["target_key"]
        self.store.values[key] = None
        await self.rejected(plan, "collision")
        self.assertTrue(self.store.contains(key))
        self.assertIsNone(self.store.get(key))
        self.assertEqual(self.store.writes, [])
        self.assertFalse((self.root / "taylors3d/models").exists())

    async def test_no_uploaded_model_still_requires_fresh_layout_model_namespace(self):
        value = source()
        value["layouts"]["shared"]["layout"].pop("model")
        value["models"] = {}
        plan = planned(value)
        self.assertEqual(plan.models, [])
        key = plan.layouts[0]["target_key"]
        path = self.stager.model_path(key)
        path.parent.mkdir(parents=True)
        path.write_bytes(b"existing independent original model")
        await self.rejected(plan, "collision")
        self.assertEqual(path.read_bytes(), b"existing independent original model")
        self.assertEqual(self.store.writes, [])

    async def test_incomplete_public_store_contract_fails_before_any_write(self):
        with patch.object(self.store, "contains", None):
            await self.rejected(planned(), "unsupported_layout_store")
        self.assertEqual(self.store.writes, [])
        self.assertFalse((self.root / "taylors3d/models").exists())

    async def test_nonboolean_or_inconsistent_public_contains_contract_fails_closed(self):
        for result in (None, 0, 1, "false"):
            with self.subTest(result=result), patch.object(self.store, "contains", return_value=result):
                await self.rejected(planned(), "unsupported_layout_store")
        key = planned().layouts[0]["target_key"]
        self.store.values[key] = {"old": "present"}
        with patch.object(self.store, "contains", return_value=False):
            await self.rejected(planned(), "unsupported_layout_store")
        self.assertEqual(self.store.writes, [])
        self.assertFalse((self.root / "taylors3d/models").exists())

    async def test_missing_layout_never_publishes_browser_fallback_key(self):
        value = source()
        value["layouts"], value["models"], value["furniture_packs"] = {}, {}, {}
        await self.rejected(planned(value, allow_incomplete=True), "browser_fallback_unverifiable")
        self.assertEqual(self.platform_calls, 0)
        self.assertEqual(self.store.writes, [])

    async def test_partial_missing_model_pack_are_explicit_unpopulated_targets(self):
        value = source()
        value["models"], value["furniture_packs"] = {}, {}
        plan = planned(value, allow_incomplete=True)
        result = await self.stager.stage(plan, "recovered", self.check)
        self.assertFalse(result["report"]["complete"])
        self.assertEqual({row["kind"] for row in result["staging"]["unavailable"]}, {"model", "furniture"})
        self.assertEqual(result["staging"]["models"], [])
        self.assertEqual(result["staging"]["furniture"], [])
        self.assertFalse(self.stager.model_path(plan.models[0]["target_key"]).exists())
        self.assertEqual(self.store.get(plan.layouts[0]["target_key"]), value["layouts"]["shared"]["layout"])

    async def test_same_immutable_published_pack_dedup_verified_and_not_orphaned(self):
        plan = planned()
        self.library.import_pack(plan.furniture[0]["original_bytes"])
        result = await self.stager.stage(plan, "recovered", self.check)
        self.assertFalse(result["staging"]["furniture"][0]["imported"])
        self.assertEqual(result["orphans"], [])

    async def test_invalid_or_missing_public_library_blocks_before_model_write(self):
        self.stager.library = None
        await self.rejected(planned(), "library_unavailable")
        self.assertEqual(self.store.writes, [])
        self.assertFalse((self.root / "taylors3d/models").exists())

    async def test_component_replacement_or_initial_auth_loss_prevents_stage(self):
        self.hass.data[adapter.DOMAIN] = Store()
        await self.rejected(planned(), "component_changed")
        self.hass.data[adapter.DOMAIN] = self.store
        self.active = False
        await self.rejected(planned(), "auth")
        self.assertEqual(self.store.writes, [])
        self.assertFalse((self.root / "taylors3d/models").exists())

    async def test_auth_lost_after_executor_model_stage_reports_exact_new_orphan(self):
        original = adapter.stage_model_file

        def revoke_after_write(*args):
            result = original(*args)
            self.active = False
            return result

        with patch.object(adapter, "stage_model_file", side_effect=revoke_after_write):
            await self.rejected(planned(), "auth")
        ledger = self.stager.snapshot("recovered")
        self.assertEqual([row["kind"] for row in ledger["orphans"]], ["model"])
        self.assertTrue(self.stager.model_path(ledger["models"][0]["target_key"]).exists())
        self.assertEqual(self.store.writes, [])
        self.assertEqual(self.library.catalogue()["packs"], [])

    async def test_partial_public_pack_failure_reports_possible_new_orphans(self):
        original = self.library.import_pack

        def published_then_error(body):
            original(body)
            raise furniture.FurnitureStorageError("storage", "furniture", "Simulated failure after catalogue publication.")

        with patch.object(self.library, "import_pack", side_effect=published_then_error):
            await self.rejected(planned(), "storage")
        ledger = self.stager.snapshot("recovered")
        self.assertTrue(any(row["kind"] == "furniture" and row["status"] == "publication_may_have_occurred" for row in ledger["orphans"]))
        self.assertEqual(self.store.writes, [])
        self.assertEqual(len(self.library.catalogue()["packs"]), 1)

    async def test_layout_partial_set_failure_or_current_mutation_never_claims_rollback(self):
        def partly_saved(key, layout):
            self.store.values[key] = layout
            raise OSError("scheduled save unavailable")

        with patch.object(self.store, "set", side_effect=partly_saved), self.assertRaises(OSError):
            await self.stager.stage(planned(), "recovered", self.check)
        ledger = self.stager.snapshot("recovered")
        self.assertTrue(any(row["kind"] == "layout" for row in ledger["orphans"]))
        self.assertEqual(ledger["status"], "failed_or_cancelled")
        self.assertTrue(self.store.values)

    async def test_final_platform_collision_leaves_only_new_orphans_no_dashboard(self):
        async def collision_on_last(count):
            if count == 3:
                raise adapter.RestoreHTTPError("collision", "New dashboard raced the final check.")

        self.platform_hook = collision_on_last
        await self.rejected(planned(), "collision")
        ledger = self.stager.snapshot("recovered")
        self.assertEqual({row["kind"] for row in ledger["orphans"]}, {"model", "layout", "furniture"})
        self.assertEqual(ledger["status"], "failed_or_cancelled")

    async def test_shared_target_created_during_asset_wait_never_overwritten(self):
        plan = planned()
        key, older = plan.layouts[0]["target_key"], {"concurrent": "retained"}
        async def create_on_second(count):
            if count == 2:
                self.store.values[key] = older
        self.platform_hook = create_on_second
        await self.rejected(plan, "collision")
        self.assertIs(self.store.get(key), older)
        self.assertEqual(self.store.writes, [])
        self.assertEqual({row["kind"] for row in self.stager.snapshot("recovered")["orphans"]}, {"model", "furniture"})

    async def test_null_shared_target_created_during_asset_wait_is_preserved(self):
        plan = planned()
        key = plan.layouts[0]["target_key"]
        async def null_on_second(count):
            if count == 2:
                self.store.values[key] = None
        self.platform_hook = null_on_second
        await self.rejected(plan, "collision")
        self.assertTrue(self.store.contains(key))
        self.assertIsNone(self.store.get(key))
        self.assertEqual(self.store.writes, [])

    async def test_final_model_integrity_change_does_not_publish_layout(self):
        plan = planned()
        key = plan.models[0]["target_key"]
        async def corrupt_on_second(count):
            if count == 2:
                self.stager.model_path(key).write_bytes(b"changed current staged model")
        self.platform_hook = corrupt_on_second
        await self.rejected(plan, "staged_changed")
        self.assertEqual(self.store.writes, [])
        self.assertEqual(self.stager.model_path(key).read_bytes(), b"changed current staged model")
        self.assertTrue(self.stager.snapshot("recovered")["orphans"])

    async def test_failure_never_lists_existing_immutable_pack_as_new_orphan(self):
        plan = planned()
        pack = plan.furniture[0]
        self.library.import_pack(pack["original_bytes"])
        async def collision_on_second(count):
            if count == 2:
                raise adapter.RestoreHTTPError("collision", "A late namespace collision")
        self.platform_hook = collision_on_second
        await self.rejected(plan, "collision")
        ledger = self.stager.snapshot("recovered")
        self.assertFalse(ledger["furniture"][0]["imported"])
        self.assertEqual([row["kind"] for row in ledger["orphans"]], ["model"])
        self.assertEqual(self.library.archive(pack["pack_id"]), pack["original_bytes"])

    async def test_response_budget_and_used_namespace_reject_without_overwrite(self):
        with patch.object(adapter, "MAX_STAGE_RESPONSE", 64):
            await self.rejected(planned(), "response_size")
        self.assertEqual(self.store.writes, [])
        self.assertIsNone(self.stager.snapshot("recovered"))
        result = await self.stager.stage(planned(), "recovered", self.check)
        before = copy.deepcopy(self.store.values)
        await self.rejected(planned(), "namespace_reserved")
        self.assertEqual(self.store.values, before)
        self.assertEqual(self.stager.snapshot("recovered")["restore_id"], result["restore_id"])

    async def test_namespace_lock_serialises_same_scope_and_rejects_second_stage(self):
        results = await asyncio.gather(*(self.stager.stage(planned(), "recovered", self.check) for _ in range(2)), return_exceptions=True)
        self.assertEqual(sum(isinstance(row, dict) and row["ok"] for row in results), 1)
        errors = [row for row in results if isinstance(row, Exception)]
        self.assertEqual([row.code for row in errors], ["namespace_reserved"])
        self.assertEqual(len(self.store.writes), 1)

    async def test_cancelled_worker_finishes_owned_write_and_tracks_orphan(self):
        original, started, release = adapter.stage_model_file, threading.Event(), threading.Event()

        def held(*args):
            started.set()
            if not release.wait(5):
                raise AssertionError("Cancellation test did not release its worker")
            return original(*args)

        with patch.object(adapter, "stage_model_file", side_effect=held):
            task = asyncio.create_task(self.stager.stage(planned(), "recovered", self.check))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 5))
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                release.set()
                for _ in range(100):
                    if self.stager.snapshot("recovered")["orphans"]:
                        break
                    await asyncio.sleep(0.01)
                ledger = self.stager.snapshot("recovered")
                self.assertEqual(ledger["status"], "failed_or_cancelled")
                self.assertEqual([row["status"] for row in ledger["orphans"]], ["cancelled_new_stage"])
                self.assertTrue(self.stager.model_path(ledger["orphans"][0]["target_key"]).exists())
                self.assertEqual(self.store.writes, [])
            finally:
                release.set()

    async def test_spool_counts_actual_chunks_auth_and_close_on_failure(self):
        body = archive()
        stream = await adapter.spool_archive(self.hass, Content(body), self.check)
        self.assertEqual(stream.read(), body)
        stream.close()
        with patch.object(adapter, "MAX_ARCHIVE_BYTES", 17), self.assertRaises(adapter.RestoreHTTPError) as caught:
            await adapter.spool_archive(self.hass, Content(body), self.check)
        self.assertEqual(caught.exception.code, "body_size")
        with self.assertRaises(adapter.RestoreHTTPError) as caught:
            await adapter.spool_archive(self.hass, Content(b""), self.check)
        self.assertEqual(caught.exception.code, "body")
        with self.assertRaises(adapter.BackupHTTPError):
            await adapter.spool_archive(self.hass, Content(body, after_read=lambda: setattr(self, "active", False)), self.check)

    async def test_plan_worker_closes_owned_stream_success_and_invalid_archive(self):
        stream = io.BytesIO(archive())
        plan = adapter.plan_and_close(stream, "recovered", False)
        self.assertTrue(stream.closed)
        self.assertEqual(plan.target_dashboard["url_path"], "taylors3d-restore-recovered")
        stream = io.BytesIO(b"invalid")
        with self.assertRaises(core.DashboardBackupError):
            adapter.plan_and_close(stream, "recovered", False)
        self.assertTrue(stream.closed)


if __name__ == "__main__":
    unittest.main(verbosity=2)
