"""Pure adapter proof: python tests/test_dashboard_backup_http.py.

No HA/router/auth-middleware success is claimed by these stdlib-only cases.
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
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
NAME = "pure_dashboard_backup_http_tests"
PACKAGE = types.ModuleType(NAME)
PACKAGE.__path__ = [str(ROOT / "custom_components" / "taylors3d")]
sys.modules[NAME] = PACKAGE
SPEC = importlib.util.spec_from_file_location(NAME + ".dashboard_backup_http", ROOT / "custom_components" / "taylors3d" / "dashboard_backup_http.py")
assert SPEC and SPEC.loader
adapter = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = adapter
SPEC.loader.exec_module(adapter)
FIXTURE_SPEC = importlib.util.spec_from_file_location("dashboard_http_fixture", ROOT / "tests" / "test_furniture_pack.py")
assert FIXTURE_SPEC and FIXTURE_SPEC.loader
fixture = importlib.util.module_from_spec(FIXTURE_SPEC)
FIXTURE_SPEC.loader.exec_module(fixture)
core = sys.modules[NAME + ".dashboard_backup"]


def payload() -> dict:
    return {"dashboard": {"views": [{"cards": [{"type": "custom:taylors3d-card", "layout_key": "shared"}]}], "unknown": {"keep": [4, None]}},
            "source": {"url_path": "dashboard-house", "mode": "storage", "metadata": {"raw": ["unchanged"]}},
            "resources": {"mode": "storage", "items": []}, "shared_keys": ["shared"], "layouts": {}, "producer_version": "test-only"}


def layout() -> dict:
    return {"version": 1, "floors": [{"id": "deleted-exact-floor"}], "rooms": [], "unknown": {"preserve": True}}


def prepare(value=None, shared=None, **kwargs):
    return adapter.prepare_export(payload() if value is None else value, {"shared": layout()} if shared is None else shared,
                                  model_reader=kwargs.pop("model_reader", Mock(side_effect=AssertionError("Unreferenced model read"))),
                                  pack_reader=kwargs.pop("pack_reader", Mock(side_effect=AssertionError("Unreferenced pack read"))), **kwargs)


def unpack(prepared):
    stream = io.BytesIO(); core.create_dashboard_backup(prepared, stream)
    return core.validate_dashboard_backup(stream.getvalue())


class BackupHTTPPureTest(unittest.TestCase):
    def test_lovelace_registry_key_supports_exported_legacy_domain(self):
        modern = types.SimpleNamespace(LOVELACE_DATA="typed_lovelace", DOMAIN="lovelace")
        legacy = types.SimpleNamespace(DOMAIN="lovelace")
        self.assertEqual(adapter.lovelace_data_key(modern), "typed_lovelace")
        self.assertEqual(adapter.lovelace_data_key(legacy), "lovelace")
        for constants in (types.SimpleNamespace(), types.SimpleNamespace(DOMAIN=None),
                          types.SimpleNamespace(LOVELACE_DATA=None, DOMAIN="lovelace")):
            with self.subTest(constants=constants):
                with self.assertRaises(adapter.BackupHTTPError) as caught:
                    adapter.lovelace_data_key(constants)
                self.assertEqual(caught.exception.code, "platform_unavailable")

    def test_legacy_source_modes_use_actual_selected_backend_and_resource_mode(self):
        value = payload()
        value["source"].update(url_path=None, mode=None)
        value["resources"]["mode"] = None
        data = {"mode": "storage", "dashboards": {None: types.SimpleNamespace(mode="storage"),
            "lovelace": types.SimpleNamespace(mode="yaml")}, "resources": object(), "yaml_dashboards": {}}
        snapshot = data.copy()
        modes = adapter.source_modes(data, value)
        self.assertEqual(modes, {"mode": "yaml", "resource_mode": "storage"})
        result = prepare(value, owned_source=modes)
        self.assertEqual(result.manifest["dashboard"]["mode"], "yaml")
        self.assertEqual(result.manifest["resources"]["mode"], "storage")
        self.assertTrue(result.manifest["http_capture"]["source_mode_proven"])
        self.assertEqual(data, snapshot)
        value["source"]["mode"] = "storage"
        with self.assertRaises(adapter.BackupHTTPError) as caught:
            prepare(value, owned_source=modes)
        self.assertEqual(caught.exception.code, "source_changed")

    def test_present_malformed_legacy_or_modern_dashboard_registry_fails_closed(self):
        for value in (None, [], False, "dashboards"):
            for data in ({"mode": "storage", "dashboards": value},
                         types.SimpleNamespace(resource_mode="storage", dashboards=value)):
                with self.subTest(data=data):
                    with self.assertRaises(adapter.BackupHTTPError) as caught:
                        adapter.source_modes(data, payload())
                    self.assertEqual(caught.exception.code, "platform_unavailable")

    def test_exact_shared_snapshot_and_unknown_fields_are_preserved_without_mutation(self):
        value, shared = payload(), {"shared": layout()}; before = copy.deepcopy((value, shared))
        prepared = prepare(value, shared); verified = unpack(prepared)
        self.assertTrue(verified.complete)
        self.assertEqual(verified.dashboard, value["dashboard"])
        self.assertEqual(verified.manifest["dashboard"]["metadata"], value["source"]["metadata"])
        self.assertEqual(json.loads(verified.members[verified.manifest["layouts"][0]["file"]["path"]]), shared["shared"])
        self.assertEqual((value, shared), before)
        self.assertEqual(verified.manifest["layouts"][0]["backend"], "shared")
        self.assertFalse(verified.manifest["http_capture"]["atomic"])

    def test_original_utf8_dashboard_and_personal_layout_member_bytes_are_preserved(self):
        value = payload(); raw = '{ "views" : [{"cards":[{"type":"custom:taylors3d-card","layout_key":"personal"}]}], "other": "🏠" }\n'
        value.pop("dashboard"); value["dashboard_json"] = raw; value["shared_keys"] = []
        raw_layout = '{ "version" : 1, "rooms": [], "floors": [], "unknown": [null,3] }\n'
        value["layouts"] = {"personal": {"backend": "browser", "layout_json": raw_layout, "metadata": {"original": "capture"}}}
        result = prepare(value, {})
        self.assertEqual(result.members["dashboard.json"], raw.encode("utf-8"))
        row = result.manifest["layouts"][0]
        self.assertEqual(result.members[row["file"]["path"]], raw_layout.encode())
        self.assertEqual(row["backend"], "browser")

    def test_caller_cannot_override_shared_provenance_or_export_unreferenced_layouts(self):
        for mutation in (lambda p: p["layouts"].update(shared={"backend": "browser", "layout": layout()}),
                         lambda p: p["layouts"].update(other={"backend": "shared", "layout": layout()}),
                         lambda p: p["shared_keys"].append("shared"), lambda p: p.pop("shared_keys")):
            value = payload(); mutation(value)
            with self.subTest(value=value), self.assertRaises(adapter.BackupHTTPError):
                prepare(value)
        value = payload(); value["shared_keys"].append("unreferenced")
        with self.assertRaises(core.DashboardBackupError) as caught:
            prepare(value, {"shared": layout(), "unreferenced": layout()})
        self.assertEqual(caught.exception.code, "unreferenced_layout")

    def test_missing_layouts_are_diagnosed_without_guessing_similar_keys(self):
        result = prepare(shared={"shared": None})
        self.assertFalse(result.complete)
        self.assertIn("layout_missing", {item["code"] for item in result.report()["diagnostics"]})
        self.assertEqual(result.manifest["layouts"], [])

    def test_uploaded_model_uses_exact_referenced_key_and_original_hash(self):
        original = fixture.glb(); source = layout(); source["model"] = {"version": hashlib.sha256(original).hexdigest()[:12], "name": "original.glb"}
        model_reader = Mock(return_value=original); pack_reader = Mock(side_effect=AssertionError("no packs"))
        result = prepare(shared={"shared": source}, model_reader=model_reader, pack_reader=pack_reader)
        self.assertTrue(result.complete); self.assertEqual(model_reader.call_args.args[0], "shared")
        self.assertEqual(result.members[result.manifest["models"][0]["file"]["path"]], original)
        self.assertEqual(result.manifest["models"][0]["metadata"], source["model"]); pack_reader.assert_not_called()

    def test_explicit_truthy_model_overrides_never_read_the_owned_uploaded_file(self):
        for model in ("https://external.invalid/original.glb", {}, [], True):
            value = payload(); value["dashboard"]["views"][0]["cards"][0]["model"] = model
            source = layout(); source["model"] = {"version": "uploaded"}; read = Mock(side_effect=AssertionError("must not read"))
            with self.subTest(model=model):
                result = prepare(value, {"shared": source}, model_reader=read)
                self.assertFalse(result.complete); self.assertEqual(result.manifest["models"], []); read.assert_not_called()
                self.assertEqual(result.dashboard["views"][0]["cards"][0]["model"], model)
                self.assertFalse(adapter.inspection(result)["report"]["dependencyFree"])

    def test_original_furniture_pack_bytes_membership_credit_and_exact_ids(self):
        original, model = fixture.bundle(), fixture.glb(); pack_id = hashlib.sha256(original).hexdigest(); source = layout()
        source["furniture"] = {"version": 1, "instances": [{"id": "chair", "pack_id": pack_id, "item_id": "triangle",
            "asset_sha256": hashlib.sha256(model).hexdigest(), "floor_id": "deleted-exact-floor", "x": 0, "y": 0}]}
        read = Mock(return_value=original); result = prepare(shared={"shared": source}, pack_reader=read)
        self.assertTrue(result.complete); self.assertEqual(read.call_args.args[0], pack_id)
        row = result.manifest["furniture"][0]; self.assertEqual(result.members[row["file"]["path"]], original)
        self.assertEqual(row["metadata"]["license"]["text"], fixture.pack.validate_furniture_pack(original)["license"]["text"])
        self.assertEqual(source["furniture"]["instances"][0]["floor_id"], "deleted-exact-floor")

    def test_unpublished_pack_and_missing_model_produce_incomplete_archive(self):
        source = layout(); source["model"] = {"version": "saved"}; source["furniture"] = {"version": 1, "instances": [{"pack_id": "a" * 64,
            "item_id": "triangle", "asset_sha256": "b" * 64}]}
        result = prepare(shared={"shared": source}, model_reader=Mock(side_effect=adapter.BackupHTTPError("model_missing", "Missing")),
            pack_reader=Mock(side_effect=adapter.FurnitureStorageError("not_found", "pack", "Missing")))
        self.assertFalse(result.complete); self.assertTrue({"model_missing", "pack_missing"}.issubset({r["code"] for r in result.report()["diagnostics"]}))

    def test_noncanonical_model_key_is_preserved_without_arbitrary_path_reads(self):
        value = payload(); value["shared_keys"] = ["exact/~key"]; value["dashboard"]["views"][0]["cards"][0]["layout_key"] = "exact/~key"
        source = layout(); source["model"] = {"version": "saved"}; reader = Mock(side_effect=AssertionError("no path guesses"))
        result = prepare(value, {"exact/~key": source}, model_reader=reader)
        self.assertFalse(result.complete); reader.assert_not_called(); self.assertIn("model_key", {r["code"] for r in result.report()["diagnostics"]})

    def test_external_resources_images_and_foreign_cards_are_incomplete_and_never_fetched(self):
        value = payload(); value["resources"]["items"] = [{"type": "module", "url": "https://foreign.invalid/card.js"}]
        value["dashboard"]["views"][0]["cards"].append({"type": "custom:foreign-card", "image": "/local/image.png"})
        result = prepare(value)
        self.assertFalse(result.complete); outside = [d for d in result.report()["diagnostics"] if d["code"] == "external_dependency"]
        self.assertEqual(len(outside), 3); self.assertTrue(all(d["severity"] == "missing" for d in outside))
        preview = adapter.inspection(result); self.assertFalse(preview["report"]["dependencyFree"]); self.assertFalse(preview["restoreAvailable"])

    def test_installed_own_frontend_is_required_software_not_a_remote_asset_copy(self):
        value = payload(); value["resources"]["items"] = [{"type": "module", "url": f"{adapter.CARD_URL_BASE}/{adapter.CARD_FILENAME}?v=exact"}]
        result = prepare(value); self.assertTrue(result.complete)
        self.assertTrue(adapter.inspection(result)["report"]["dependencyFree"])
        self.assertEqual(result.manifest["http_capture"]["software_required"]["domain"], "taylors3d")

    def test_js_false_model_values_are_not_mislabelled_external_dependencies(self):
        original = fixture.glb(); source = layout(); source["model"] = {"version": hashlib.sha256(original).hexdigest()[:12]}
        for model in (None, False, 0, ""):
            with self.subTest(model=model):
                value = payload(); value["dashboard"]["views"][0]["cards"][0]["model"] = model
                result = prepare(value, {"shared": source}, model_reader=Mock(return_value=original))
                self.assertTrue(result.complete)
                self.assertTrue(adapter.inspection(result)["report"]["dependencyFree"])

    def test_inspect_old_core_complete_archive_still_reports_unbundled_external_dependencies(self):
        value = payload(); value["resources"]["items"] = [{"type": "module", "url": "/local/foreign.js"}]
        old = core.prepare_dashboard_backup(value["dashboard"], source=value["source"], resources=value["resources"],
            layouts={"shared": {"backend": "shared", "layout": layout()}})
        self.assertTrue(old.complete); result = adapter.inspection(old)
        self.assertTrue(result["report"]["complete"]); self.assertFalse(result["report"]["dependencyFree"])
        result["preview"]["dashboard"]["unknown"]["keep"].append("changed")
        self.assertEqual(old.dashboard["unknown"]["keep"], [4, None])

    def test_owned_source_resolves_null_default_mode_without_guessing_and_rejects_stale_modes(self):
        value = payload(); value["source"]["mode"] = None; value["source"]["url_path"] = None; value["resources"]["mode"] = None
        result = prepare(value, owned_source={"mode": "yaml", "resource_mode": "storage"})
        self.assertEqual(result.manifest["dashboard"]["mode"], "yaml"); self.assertEqual(result.manifest["resources"]["mode"], "storage")
        self.assertTrue(result.manifest["http_capture"]["source_mode_proven"])
        with self.assertRaises(adapter.BackupHTTPError) as caught:
            prepare(value)
        self.assertEqual(caught.exception.code, "source_mode")
        value["source"]["mode"] = "storage"
        with self.assertRaises(adapter.BackupHTTPError) as caught:
            prepare(value, owned_source={"mode": "yaml", "resource_mode": "storage"})
        self.assertEqual(caught.exception.code, "source_changed")

    def test_generated_strategy_remains_raw_with_owned_underlying_mode(self):
        value = payload(); value["dashboard"] = {"strategy": {"type": "raw-original", "unknown": [7]}}; value["shared_keys"] = []
        value["source"]["mode"] = None
        result = prepare(value, {}, owned_source={"mode": "storage", "resource_mode": "storage"})
        self.assertEqual(result.dashboard, value["dashboard"]); self.assertEqual(result.manifest["dashboard"]["mode"], "generated")

    def test_bad_selected_source_shapes_reject_before_backend_dictionary_lookup(self):
        data = types.SimpleNamespace(dashboards={None: types.SimpleNamespace(mode="storage")}, resource_mode="storage")
        for path in ([], {}, True, 0, "", " ", "a" * 257, "bad\0path"):
            with self.subTest(path=path):
                with self.assertRaises(adapter.BackupHTTPError) as caught:
                    adapter.source_modes(data, {"source": {"url_path": path}})
                self.assertEqual(caught.exception.code, "source_path")
        for source in ({}, None, [], False):
            with self.subTest(source=source), self.assertRaises(adapter.BackupHTTPError):
                adapter.source_modes(data, {"source": source})

    def test_source_mode_selection_is_exact_null_default_is_owned_not_browser_inferred(self):
        storage, yaml = types.SimpleNamespace(mode="storage"), types.SimpleNamespace(mode="yaml")
        data = types.SimpleNamespace(dashboards={None: storage, "lovelace": yaml, "dashboard-test": storage}, resource_mode="yaml")
        value = payload(); value["source"]["url_path"] = None
        self.assertEqual(adapter.source_modes(data, value), {"mode": "yaml", "resource_mode": "yaml"})
        value["source"]["url_path"] = "dashboard-test"
        self.assertEqual(adapter.source_modes(data, value), {"mode": "storage", "resource_mode": "yaml"})
        value["source"]["url_path"] = "dashboard-missing"
        self.assertEqual(adapter.source_modes(data, value), {"mode": None, "resource_mode": "yaml"})
        self.assertEqual(adapter.source_modes(None, value), {"mode": None, "resource_mode": None})

    def test_duplicate_nonfinite_invalid_unicode_complex_and_nonobject_json_requests(self):
        for body in (b'{"shared_keys":[],"shared_keys":[]}', b'{"x":NaN}', b'{"x":1e999}', b'{"x":"\\ud800"}', b'[]', b'\xff', b'{}trailing', b''):
            with self.subTest(body=body), self.assertRaises(adapter.BackupHTTPError):
                adapter.decode_export_request(body)
        nested = {}; current = nested
        for _ in range(65):
            current["next"] = {}; current = current["next"]
        with self.assertRaises(adapter.BackupHTTPError):
            adapter.decode_export_request(json.dumps(nested).encode())
        self.assertEqual(adapter.decode_export_request(json.dumps(payload()).encode()), payload())

    def test_original_embedded_json_duplicates_and_budgets_are_not_silently_coerced(self):
        value = payload(); value.pop("dashboard"); value["dashboard_json"] = '{"views":[],"views":[]}'
        with self.assertRaises(adapter.BackupHTTPError):
            prepare(value)
        value["dashboard_json"] = '{"views":[],"large":"' + 'x' * core.MAX_DASHBOARD_WIRE_BYTES + '"}'
        with self.assertRaises(adapter.BackupHTTPError) as caught:
            prepare(value)
        self.assertEqual(caught.exception.code, "json_size")

    def test_original_model_version_mismatch_fails_before_archive_or_any_source_write(self):
        source = layout(); source["model"] = {"version": "a" * 12}; before = copy.deepcopy(source)
        with self.assertRaises(core.DashboardBackupError) as caught:
            prepare(shared={"shared": source}, model_reader=Mock(return_value=fixture.glb()))
        self.assertEqual(caught.exception.code, "source_changed"); self.assertEqual(source, before)

    def test_remaining_asset_budget_is_passed_and_enforced_before_extra_assets(self):
        source = layout(); source["model"] = {"version": "saved"}; reader = Mock(return_value=fixture.glb())
        with patch.object(adapter, "MAX_EXPANDED_BYTES", 1), self.assertRaises(adapter.BackupHTTPError) as caught:
            prepare(shared={"shared": source}, model_reader=reader)
        self.assertEqual(caught.exception.code, "asset_size")

    def test_canonical_owned_model_read_is_bounded_missing_and_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "taylors3d" / "models" / "shared.glb"; path.parent.mkdir(parents=True)
            with self.assertRaises(adapter.BackupHTTPError) as caught:
                adapter.read_owned_model(path, core.MAX_MODEL_BYTES)
            self.assertEqual(caught.exception.code, "model_missing")
            raw = fixture.glb(); path.write_bytes(raw)
            self.assertEqual(adapter.read_owned_model(path, len(raw)), raw)
            with self.assertRaises(adapter.BackupHTTPError):
                adapter.read_owned_model(path, len(raw) - 1)
            with patch.object(Path, "is_symlink", return_value=True), self.assertRaises(adapter.BackupHTTPError) as caught:
                adapter.read_owned_model(path, len(raw))
            self.assertEqual(caught.exception.code, "unsafe_storage")

    def test_temporary_download_and_inspection_ownership_and_raw_preview(self):
        result = adapter.build_download(payload(), {"shared": layout()}, model_reader=Mock(), pack_reader=Mock())
        self.assertGreater(result.size, 0); self.assertTrue(result.report["complete"])
        with result.stream:
            response = json.loads(adapter.inspect_and_close(result.stream))
        self.assertTrue(result.stream.closed); self.assertEqual(response["preview"]["dashboard"], payload()["dashboard"])
        self.assertFalse(response["restoreAvailable"])
        malformed = io.BytesIO(b'not zip')
        with self.assertRaises(core.DashboardBackupError):
            adapter.inspect_and_close(malformed)
        self.assertTrue(malformed.closed)


class BackupHTTPAsyncTest(unittest.IsolatedAsyncioTestCase):
    def auth(self, admin=False, token=True):
        user = types.SimpleNamespace(id="actual-user", is_active=True, is_admin=admin)
        session = types.SimpleNamespace(user=user)
        users = {user.id: user}; tokens = {"actual-session": session}

        async def get_user(key):
            return users.get(key)

        hass = types.SimpleNamespace(auth=types.SimpleNamespace(async_get_user=get_user, async_get_refresh_token=tokens.get), data={"supervisor": user})
        request = {"hass_user": user}
        if token:
            request["hass_refresh_token_id"] = "actual-session"
        fence = adapter.AuthFence(hass, request, admin=admin, supervisor_check=lambda req: req.get("unix") is True, supervisor_user_key="supervisor")
        return fence, user, users, tokens, request, hass

    async def test_authenticated_read_fence_allows_nonadmin_but_inspect_requires_admin(self):
        fence, user, *_ = self.auth(); self.assertTrue(await fence.current())
        fence.admin = True; self.assertFalse(await fence.current()); user.is_admin = True
        self.assertFalse(await fence.current())  # Observed loss never recovers an old action.

    async def test_real_store_identity_token_account_and_role_revocation_are_latched(self):
        for kind in ("inactive", "admin", "removed", "token", "request_user", "request_token"):
            fence, user, users, tokens, request, _hass = self.auth(admin=True)
            self.assertTrue(await fence.current())
            if kind == "inactive": user.is_active = False
            elif kind == "admin": user.is_admin = False
            elif kind == "removed": users.clear()
            elif kind == "token": tokens.clear()
            elif kind == "request_user": request["hass_user"] = copy.copy(user)
            else: request["hass_refresh_token_id"] = "different"
            with self.subTest(kind=kind):
                self.assertFalse(await fence.current()); user.is_active = user.is_admin = True; users[user.id] = user
                tokens["actual-session"] = types.SimpleNamespace(user=user); request.update(hass_user=user, hass_refresh_token_id="actual-session")
                self.assertFalse(await fence.current())

    async def test_modern_tokenless_supervisor_must_be_exact_current_store_and_supervisor_user(self):
        fence, user, users, _tokens, request, hass = self.auth(admin=True, token=False)
        request["unix"] = True; self.assertTrue(await fence.current()); users.clear()
        self.assertFalse(await fence.current()); self.assertTrue(user.is_active and user.is_admin)
        fence, _user, _users, _tokens, request, hass = self.auth(admin=True, token=False)
        request["unix"] = True; hass.data["supervisor"] = object(); self.assertFalse(await fence.current())
        fence, *_ = self.auth(admin=True, token=False); self.assertFalse(await fence.current())

    async def test_user_revoked_while_auth_store_lookup_awaits_is_rechecked_after_wait(self):
        fence, user, *_rest, hass = self.auth(admin=True)

        async def revoke_then_return(_key):
            user.is_active = False; return user

        hass.auth.async_get_user = revoke_then_return
        self.assertFalse(await fence.current())

    async def test_decoded_body_bytes_are_bounded_without_length_trust_and_auth_checked_per_chunk(self):
        fence, *_ = self.auth(); chunks = [b'1234', b'56', b'']; checks = 0

        async def read(size):
            self.assertEqual(size, adapter.CHUNK); return chunks.pop(0)

        async def check():
            nonlocal checks
            checks += 1; await fence.check()

        result = await adapter.read_body(types.SimpleNamespace(read=read), 6, check)
        self.assertEqual(result, b'123456'); self.assertEqual(checks, 6)
        chunks[:] = [b'1234', b'567']
        with self.assertRaises(adapter.BackupHTTPError) as caught:
            await adapter.read_body(types.SimpleNamespace(read=read), 6, check)
        self.assertEqual(caught.exception.code, "body_size")

    async def test_body_revocation_prevents_returning_or_validating_late_bytes(self):
        fence, user, *_ = self.auth()

        async def read(_size):
            user.is_active = False; return b'private'

        with self.assertRaises(adapter.BackupHTTPError) as caught:
            await adapter.read_body(types.SimpleNamespace(read=read), 100, fence.check)
        self.assertEqual(caught.exception.code, "auth")

    async def test_cancelled_executor_result_resource_is_closed_after_worker_finishes(self):
        started, released = threading.Event(), threading.Event(); owned = io.BytesIO()

        def work():
            started.set(); released.wait(timeout=5); return owned

        async def executor(fn, *args):
            return await asyncio.get_running_loop().run_in_executor(None, fn, *args)

        task = asyncio.create_task(adapter._executor(types.SimpleNamespace(async_add_executor_job=executor), work, abandoned=lambda result: result.close()))
        while not started.is_set():
            await asyncio.sleep(0)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertFalse(owned.closed); released.set()
        for _ in range(1000):
            if owned.closed: break
            await asyncio.sleep(0.001)
        self.assertTrue(owned.closed)


if __name__ == "__main__":
    unittest.main(verbosity=2)
