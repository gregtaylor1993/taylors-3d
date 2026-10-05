"""Focused pure storage and HTTP-contract tests, without the HA harness.

Run python -B tests/test_furniture.py. The small view doubles exercise delegated
auth contracts; they do not claim a live Home Assistant HTTP integration test.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_SPEC = importlib.util.spec_from_file_location("furniture_storage_fixture", ROOT / "tests" / "test_furniture_pack.py")
assert FIXTURE_SPEC and FIXTURE_SPEC.loader
fixture = importlib.util.module_from_spec(FIXTURE_SPEC)
FIXTURE_SPEC.loader.exec_module(fixture)

# A private namespace permits the real relative import without executing HA's
# integration __init__; it cannot replace modules used by real HA pytest tests.
PACKAGE = "pure_furniture_storage"
package = ModuleType(PACKAGE)
package.__path__ = [str(ROOT / "custom_components" / "taylors3d")]
sys.modules[PACKAGE] = package
sys.modules[PACKAGE + ".furniture_pack"] = fixture.pack
SPEC = importlib.util.spec_from_file_location(PACKAGE + ".furniture", ROOT / "custom_components" / "taylors3d" / "furniture.py")
assert SPEC and SPEC.loader
furniture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(furniture)


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config = Path(self.directory.name)
        self.library = furniture.FurnitureLibrary(self.config / furniture.FURNITURE_DIR)
        self.raw = fixture.bundle()

    def error(self, function, code):
        with self.assertRaises(furniture.FurnitureStorageError) as caught:
            function()
        self.assertEqual(caught.exception.code, code)
        self.assertNotIn(str(self.config), str(caught.exception))
        return caught.exception

    def test_empty_read_does_not_create_or_touch_house_storage(self):
        models = self.config / "taylors3d" / "models"
        models.mkdir(parents=True)
        house = models / "default.glb"
        house.write_bytes(b"Existing house data")
        self.assertEqual(self.library.catalogue(), {"version": 1, "packs": []})
        self.assertFalse(self.library.root.exists())
        self.library.import_pack(self.raw)
        self.assertEqual(house.read_bytes(), b"Existing house data")

    def test_import_persists_exact_archive_assets_and_supplied_identity(self):
        result = self.library.import_pack(self.raw)
        self.assertTrue(result["imported"])
        record = result["pack"]
        self.assertEqual(record["pack_id"], hashlib.sha256(self.raw).hexdigest())
        self.assertEqual(record["manifest"]["id"], "test-furniture")
        self.assertNotEqual(record["manifest"]["id"], record["pack_id"])
        self.assertEqual(record["logical_sha256"], fixture.pack.validate_furniture_pack(self.raw)["sha256"])
        self.assertEqual(self.library.archive(record["pack_id"]), self.raw)
        item = record["items"][0]
        self.assertEqual(self.library.asset(item["sha256"]), fixture.glb())
        self.assertNotIn("data", item)
        self.assertEqual(item["asset_url"], f"/api/taylors3d/furniture/assets/{item['sha256']}.glb")
        self.assertEqual(item["pack_id"], record["pack_id"])
        self.assertEqual(self.library.catalogue()["packs"], [record])
        reloaded = furniture.FurnitureLibrary(self.library.root)
        self.assertEqual(reloaded.catalogue()["packs"], [record])

    def test_only_generated_filenames_are_written(self):
        self.library.import_pack(self.raw)
        names = {path.name for path in self.library.root.rglob("*") if path.is_file()}
        self.assertEqual(len(names), 4)
        self.assertIn("catalogue.json", names)
        for name in names - {"catalogue.json"}:
            self.assertRegex(name, r"^[0-9a-f]{64}\.(json|zip|glb)$")
        self.assertFalse((self.library.root / "assets/triangle.glb").exists())
        self.assertFalse((self.library.root / "LICENSE.txt").exists())

    def test_exact_reimport_idempotent_and_does_not_rewrite_any_file(self):
        first = self.library.import_pack(self.raw)
        before = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in self.library.root.rglob("*") if path.is_file()}
        with patch.object(self.library, "_atomic_write", side_effect=AssertionError("No idempotent writes")):
            second = self.library.import_pack(self.raw)
        self.assertFalse(second["imported"])
        self.assertEqual(first["pack"], second["pack"])
        self.assertEqual(before, {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in before})

    def test_same_logical_pack_different_original_archives_keep_both(self):
        entries = [("pack.json", json.dumps(fixture.manifest()).encode()), ("LICENSE.txt", b"A licence.\n"), ("assets/triangle.glb", fixture.glb())]
        one = fixture.archive(entries)
        two = fixture.archive(list(reversed(entries)), fixture.zipfile.ZIP_DEFLATED)
        a, b = self.library.import_pack(one)["pack"], self.library.import_pack(two)["pack"]
        self.assertEqual(a["logical_sha256"], b["logical_sha256"])
        self.assertNotEqual(a["pack_id"], b["pack_id"])
        self.assertEqual(self.library.archive(a["pack_id"]), one)
        self.assertEqual(self.library.archive(b["pack_id"]), two)
        self.assertEqual(len(list((self.library.root / "assets").glob("*.glb"))), 1)
        self.assertEqual(len(self.library.catalogue()["packs"]), 2)

    def test_per_item_licences_credits_and_anchors_survive_asset_deduplication(self):
        value = fixture.manifest()
        value["credits"] = {"source": "https://example.test/original", "artist": "Supplied artist"}
        value["items"][0]["credits"] = {"note": "First creator"}
        value["items"].append({**value["items"][0], "id": "second", "anchor": [2, 0, 3],
                               "credits": {"note": "Second creator"}, "license": {"id": "LicenseRef-Second", "file": "SECOND.txt", "extra": "retained"}})
        raw = fixture.bundle(value, extra=[("SECOND.txt", b"Second licence\r\nCopyright artist.\r\n")])
        record = self.library.import_pack(raw)["pack"]
        self.assertEqual(record["manifest"], value)
        self.assertEqual(record["items"][0]["sha256"], record["items"][1]["sha256"])
        self.assertEqual(record["items"][1]["license"]["text"], "Second licence\r\nCopyright artist.\r\n")
        self.assertEqual(record["items"][1]["license"]["id"], "LicenseRef-Second")
        self.assertEqual(record["items"][1]["anchor"], [2, 0, 3])
        self.assertEqual(record["items"][0]["metadata"]["credits"], {"note": "First creator"})
        self.assertEqual(record["items"][1]["metadata"], value["items"][1])
        self.assertEqual(record["licenses"]["SECOND.txt"], record["items"][1]["license"])
        self.assertEqual(self.library.archive(record["pack_id"]), raw)

    def test_returned_metadata_mutation_cannot_change_stored_records(self):
        result = self.library.import_pack(self.raw)
        expected = copy.deepcopy(result["pack"])
        result["pack"]["license"]["text"] = "Changed caller copy"
        catalogue = self.library.catalogue()
        catalogue["packs"][0]["manifest"]["author"] = "Changed catalogue copy"
        self.assertEqual(self.library.catalogue()["packs"][0], expected)

    def test_invalid_archive_is_rejected_without_creating_library(self):
        with self.assertRaises(fixture.pack.FurniturePackError):
            self.library.import_pack(b"Not a ZIP")
        self.assertFalse(self.library.root.exists())

    def test_invalid_glb_rejected_without_changing_published_catalogue(self):
        self.library.import_pack(self.raw)
        before = (self.library.root / "catalogue.json").read_bytes()
        with self.assertRaises(fixture.pack.FurniturePackError):
            self.library.import_pack(fixture.bundle(asset=b"Not GLB"))
        self.assertEqual((self.library.root / "catalogue.json").read_bytes(), before)

    def test_catalogue_is_atomic_visible_commit_and_orphans_are_not_readable(self):
        pack_id = hashlib.sha256(self.raw).hexdigest()
        asset_id = hashlib.sha256(fixture.glb()).hexdigest()
        original = self.library._atomic_write

        def crash_at_catalogue(path, data):
            if path.name == "catalogue.json":
                self.assertEqual(self.library.catalogue(), {"version": 1, "packs": []})
                self.error(lambda: self.library.asset(asset_id), "not_found")
                self.error(lambda: self.library.archive(pack_id), "not_found")
                raise OSError("Simulated disk failure at publication")
            return original(path, data)

        with patch.object(self.library, "_atomic_write", side_effect=crash_at_catalogue):
            with self.assertRaises(OSError):
                self.library.import_pack(self.raw)
        self.assertTrue((self.library.root / "assets" / f"{asset_id}.glb").is_file())
        self.assertEqual(self.library.catalogue()["packs"], [])
        self.assertTrue(self.library.import_pack(self.raw)["imported"])
        self.assertEqual(len(self.library.catalogue()["packs"]), 1)

    def test_failed_second_commit_retains_first_pack_and_old_undo_assets(self):
        first = self.library.import_pack(self.raw)["pack"]
        value = fixture.manifest()
        value["author"] = "New author"
        raw2 = fixture.bundle(value)
        index_before = (self.library.root / "catalogue.json").read_bytes()
        original = self.library._atomic_write

        def fail_commit(path, data):
            if path.name == "catalogue.json":
                raise OSError("Simulated failed second commit")
            return original(path, data)

        with patch.object(self.library, "_atomic_write", side_effect=fail_commit):
            with self.assertRaises(OSError):
                self.library.import_pack(raw2)
        self.assertEqual((self.library.root / "catalogue.json").read_bytes(), index_before)
        self.assertEqual(self.library.catalogue()["packs"], [first])
        self.assertEqual(self.library.asset(first["items"][0]["sha256"]), fixture.glb())
        self.assertEqual(self.library.archive(first["pack_id"]), self.raw)

    def test_temporary_file_removed_on_replace_failure(self):
        with patch.object(furniture.os, "replace", side_effect=OSError("Simulated atomic replace failure")):
            with self.assertRaises(OSError):
                self.library.import_pack(self.raw)
        self.assertFalse(list(self.library.root.rglob(".staging-*")))
        self.assertEqual(self.library.catalogue()["packs"], [])

    def test_same_instance_parallel_imports_are_serialized_and_never_lose_pack(self):
        raw2 = fixture.bundle({**fixture.manifest(), "author": "Second author"})
        barrier = threading.Barrier(8)

        def run(index):
            barrier.wait()
            return self.library.import_pack(self.raw if index % 2 == 0 else raw2)

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(run, range(8)))
        self.assertEqual(sum(result["imported"] for result in results), 2)
        self.assertEqual(len(self.library.catalogue()["packs"]), 2)
        self.assertFalse(list(self.library.root.rglob(".staging-*")))

    def test_corrupt_asset_rejected_on_get_and_identical_reimport(self):
        record = self.library.import_pack(self.raw)["pack"]
        digest = record["items"][0]["sha256"]
        path = self.library.root / "assets" / f"{digest}.glb"
        path.write_bytes(b"Corrupt GLB")
        before = (self.library.root / "catalogue.json").read_bytes()
        self.error(lambda: self.library.asset(digest), "corrupt_storage")
        self.error(lambda: self.library.import_pack(self.raw), "corrupt_storage")
        self.assertEqual(path.read_bytes(), b"Corrupt GLB")
        self.assertEqual((self.library.root / "catalogue.json").read_bytes(), before)

    def test_corrupt_deduplicated_asset_blocks_new_pack_publication(self):
        record = self.library.import_pack(self.raw)["pack"]
        digest = record["items"][0]["sha256"]
        (self.library.root / "assets" / f"{digest}.glb").write_bytes(b"Corrupt")
        raw2 = fixture.bundle({**fixture.manifest(), "author": "Different author"})
        self.error(lambda: self.library.import_pack(raw2), "corrupt_storage")
        self.assertEqual(len(self.library.catalogue()["packs"]), 1)
        self.assertFalse((self.library.root / "archives" / f"{hashlib.sha256(raw2).hexdigest()}.zip").exists())

    def test_missing_published_asset_is_not_repaired_by_any_import(self):
        record = self.library.import_pack(self.raw)["pack"]
        digest = record["items"][0]["sha256"]
        path = self.library.root / "assets" / f"{digest}.glb"
        path.unlink()
        self.error(lambda: self.library.import_pack(self.raw), "corrupt_storage")
        self.error(lambda: self.library.import_pack(fixture.bundle({**fixture.manifest(), "author": "New credit"})), "corrupt_storage")
        self.assertFalse(path.exists())
        self.assertEqual(self.library.catalogue()["packs"], [record])

    def test_corrupt_or_missing_original_pack_does_not_get_silently_repaired(self):
        record = self.library.import_pack(self.raw)["pack"]
        path = self.library.root / "archives" / f"{record['pack_id']}.zip"
        path.write_bytes(b"Changed original ZIP")
        self.error(lambda: self.library.archive(record["pack_id"]), "corrupt_storage")
        self.error(lambda: self.library.import_pack(self.raw), "corrupt_storage")
        path.unlink()
        self.error(lambda: self.library.archive(record["pack_id"]), "corrupt_storage")
        self.error(lambda: self.library.import_pack(self.raw), "corrupt_storage")
        self.assertFalse(path.exists())

    def test_corrupt_metadata_blocks_catalogue_and_import_without_replacing_it(self):
        record = self.library.import_pack(self.raw)["pack"]
        path = self.library.root / "packs" / f"{record['pack_id']}.json"
        path.write_text('{"pack_id":"changed"}', encoding="utf-8")
        self.error(self.library.catalogue, "corrupt_storage")
        self.error(lambda: self.library.import_pack(self.raw), "corrupt_storage")

    def test_checksummed_but_invalid_metadata_cannot_publish_paths_or_duplicates(self):
        record = self.library.import_pack(self.raw)["pack"]
        record_path = self.library.root / "packs" / f"{record['pack_id']}.json"
        index_path = self.library.root / "catalogue.json"
        original_index = json.loads(index_path.read_bytes())
        for mutate in (lambda value: value.update(pack_id="../../models/default"),
                       lambda value: value.update(archive_bytes=True),
                       lambda value: value["items"][0].update(sha256="../../secrets"),
                       lambda value: value["items"].append(copy.deepcopy(value["items"][0]))):
            broken = copy.deepcopy(record)
            mutate(broken)
            body = furniture._encode(broken)
            record_path.write_bytes(body)
            index = copy.deepcopy(original_index)
            index["packs"][0]["metadata_sha256"] = hashlib.sha256(body).hexdigest()
            index_path.write_bytes(furniture._encode(index))
            self.error(self.library.catalogue, "corrupt_catalogue")

    def test_duplicate_published_index_identity_rejected_even_when_record_exists(self):
        self.library.import_pack(self.raw)
        path = self.library.root / "catalogue.json"
        index = json.loads(path.read_bytes())
        index["packs"].append(copy.deepcopy(index["packs"][0]))
        path.write_bytes(furniture._encode(index))
        self.error(self.library.catalogue, "corrupt_catalogue")

    def test_bad_catalogue_shapes_duplicates_and_traversal_fail_closed(self):
        self.library.root.mkdir(parents=True)
        for value in ({"version": True, "packs": []}, {"version": 2, "packs": []}, {"version": 1, "packs": {}},
                      {"version": 1, "packs": [{"pack_id": "../../models/default", "metadata_sha256": "a" * 64}]},
                      {"version": 1, "packs": [{"pack_id": "a" * 64, "metadata_sha256": "b" * 64}] * 2}):
            with self.subTest(value=value):
                (self.library.root / "catalogue.json").write_text(json.dumps(value), encoding="utf-8")
                with self.assertRaises(furniture.FurnitureStorageError):
                    self.library.catalogue()
        for text in ('{"version":1,"version":1,"packs":[]}', '{"version":1,"packs":[],"value":NaN}',
                     '{"version":1,"packs":[],"value":1e999}', '{"version":1,"packs":[],"value":"\\ud800"}', "Not JSON"):
            (self.library.root / "catalogue.json").write_text(text, encoding="utf-8")
            self.error(self.library.catalogue, "corrupt_catalogue")

    def test_asset_and_pack_routes_reject_unsafe_or_unpublished_identifiers(self):
        for identity in ("../models/default", "a" * 63, "A" * 64, "a" * 64 + "/", 1, None):
            for method in (self.library.asset, self.library.archive):
                self.error(lambda: method(identity), "identifier")
        self.error(lambda: self.library.asset("a" * 64), "not_found")
        self.error(lambda: self.library.archive("a" * 64), "not_found")

    def test_library_capacity_blocks_new_pack_but_allows_verified_reimport(self):
        self.library.import_pack(self.raw)
        raw2 = fixture.bundle({**fixture.manifest(), "author": "Second author"})
        with patch.object(furniture, "MAX_PACKS", 1):
            self.assertFalse(self.library.import_pack(self.raw)["imported"])
            self.error(lambda: self.library.import_pack(raw2), "library_budget")
        self.assertEqual(len(self.library.catalogue()["packs"]), 1)

    def test_index_record_and_regular_file_budgets_fail_closed(self):
        record = self.library.import_pack(self.raw)["pack"]
        with patch.object(furniture, "MAX_INDEX_BYTES", 8):
            self.error(self.library.catalogue, "corrupt_storage")
        with patch.object(furniture, "MAX_RECORD_BYTES", 8):
            self.error(self.library.catalogue, "corrupt_storage")
        asset = self.library.root / "assets" / f"{record['items'][0]['sha256']}.glb"
        asset.unlink()
        asset.mkdir()
        self.error(lambda: self.library.asset(record["items"][0]["sha256"]), "corrupt_storage")

    def test_combined_metadata_budget_blocks_publication_and_bounds_reload(self):
        first = self.library.import_pack(self.raw)["pack"]
        raw2 = fixture.bundle({**fixture.manifest(), "author": "New author"})
        limit = len(furniture._encode(first)) + 10
        with patch.object(furniture, "MAX_CATALOGUE_BYTES", limit):
            self.assertFalse(self.library.import_pack(self.raw)["imported"])
            self.error(lambda: self.library.import_pack(raw2), "library_budget")
        self.assertEqual(self.library.catalogue()["packs"], [first])
        self.library.import_pack(raw2)
        with patch.object(furniture, "MAX_CATALOGUE_BYTES", limit):
            self.error(self.library.catalogue, "corrupt_storage")

    def test_known_metadata_cap_rejection_does_not_leave_new_immutable_files(self):
        first = self.library.import_pack(self.raw)["pack"]
        document, _binary = fixture.fixture()
        document["accessors"][0]["max"] = [2, 0, 1]
        asset = fixture.glb(document, fixture.struct.pack("<9f", 0, 0, 0, 2, 0, 0, 0, 0, 1))
        raw2 = fixture.bundle({**fixture.manifest(), "author": "Distinct asset and credit"}, asset=asset)
        before = {path: path.read_bytes() for path in self.library.root.rglob("*") if path.is_file()}
        with patch.object(furniture, "MAX_CATALOGUE_BYTES", len(furniture._encode(first)) + 10):
            self.error(lambda: self.library.import_pack(raw2), "library_budget")
        self.assertEqual(before, {path: path.read_bytes() for path in self.library.root.rglob("*") if path.is_file()})
        self.assertEqual(self.library.catalogue()["packs"], [first])

    def test_known_record_or_index_budget_rejection_does_not_create_library(self):
        for budget in ("MAX_RECORD_BYTES", "MAX_INDEX_BYTES"):
            with self.subTest(budget=budget), patch.object(furniture, budget, 1):
                self.error(lambda: self.library.import_pack(self.raw), "library_budget")
                self.assertFalse(self.library.root.exists())

    def test_existing_non_directory_library_root_is_not_overwritten(self):
        self.library.root.parent.mkdir(parents=True)
        self.library.root.write_bytes(b"Existing unrelated file")
        self.error(lambda: self.library.import_pack(self.raw), "unsafe_storage")
        self.assertEqual(self.library.root.read_bytes(), b"Existing unrelated file")

    def test_tampered_immutable_directory_is_not_written_into(self):
        record = self.library.import_pack(self.raw)["pack"]
        asset_dir = self.library.root / "assets"
        asset = asset_dir / f"{record['items'][0]['sha256']}.glb"
        asset.unlink()
        asset_dir.rmdir()
        asset_dir.write_bytes(b"Unrelated file")
        self.error(lambda: self.library.import_pack(self.raw), "unsafe_storage")
        self.assertEqual(asset_dir.read_bytes(), b"Unrelated file")

    def test_symlink_storage_is_rejected_where_supported(self):
        target = self.config / "outside"
        target.mkdir()
        self.library.root.parent.mkdir(parents=True)
        try:
            self.library.root.symlink_to(target, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("This host does not permit test symlinks")
        self.error(lambda: self.library.import_pack(self.raw), "unsafe_storage")
        self.assertEqual(list(target.iterdir()), [])


class StreamTest(unittest.IsolatedAsyncioTestCase):
    def field(self, chunks, name="file"):
        class Field:
            def __init__(self):
                self.name, self.calls = name, 0
            async def read_chunk(self, amount):
                self.calls += 1
                self.asserted_chunk_size = amount
                return chunks.pop(0) if chunks else b""
        return Field()

    async def test_actual_chunks_not_claimed_content_length_define_limit(self):
        field = self.field([b"1234", b"5678", b"9", b"never-read"])
        field.content_length = 1
        with self.assertRaises(furniture.FurnitureStorageError) as caught:
            await furniture.read_furniture_upload(field, 8)
        self.assertEqual(caught.exception.code, "archive_size")
        self.assertEqual(field.calls, 3)
        self.assertEqual(field.asserted_chunk_size, 64 * 1024)

    async def test_exact_limit_allowed_and_original_bytes_preserved(self):
        field = self.field([b"12", b"345", b"678"])
        field.content_length = 999999999
        self.assertEqual(await furniture.read_furniture_upload(field, 8), b"12345678")

    async def test_empty_missing_wrong_field_and_nonbinary_are_rejected(self):
        for field in (None, self.field([], "other"), self.field([]), self.field(["not bytes"])):
            with self.subTest(field=field):
                with self.assertRaises(furniture.FurnitureStorageError):
                    await furniture.read_furniture_upload(field)


class Response:
    def __init__(self, body=None, headers=None, status=200, payload=None):
        self.body, self.headers, self.status, self.payload = body, headers or {}, status, payload


class ViewContractTest(unittest.IsolatedAsyncioTestCase):
    """Exercise actual registered view methods using small explicit HA doubles."""

    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.views = []
        self.executor_calls = 0
        self.sessions = {}
        self.users = {}
        self.session_serial = 0

        async def current_user(user_id):
            return self.users.get(user_id)

        async def executor(function, *args):
            self.executor_calls += 1
            return function(*args)

        self.hass = SimpleNamespace(data={}, config=SimpleNamespace(path=lambda name: str(Path(self.directory.name) / name)),
                                    http=SimpleNamespace(register_view=self.views.append), async_add_executor_job=executor,
                                    auth=SimpleNamespace(async_get_refresh_token=self.sessions.get, async_get_user=current_user))

        class HAView:
            def json(self, value, status_code=200):
                return Response(status=status_code, payload=value)
            def json_message(self, text, status_code=200):
                return self.json({"message": text}, status_code)

        def require_admin(function):
            async def wrapped(view, request, *args):
                user = request.get("hass_user")
                if user is None or not user.is_admin:
                    return view.json_message("Administrator required", 401)
                return await function(view, request, *args)
            return wrapped

        http = ModuleType("homeassistant.components.http")
        http.HomeAssistantView, http.require_admin = HAView, require_admin
        http_const = ModuleType("homeassistant.components.http.const")
        http_const.KEY_HASS_USER = "hass_user"
        http_const.KEY_HASS_REFRESH_TOKEN_ID = "hass_refresh_token_id"
        aiohttp = ModuleType("aiohttp")
        aiohttp.web = SimpleNamespace(Response=Response)
        self.modules = patch.dict(sys.modules, {"aiohttp": aiohttp, "homeassistant": ModuleType("homeassistant"),
                                               "homeassistant.components": ModuleType("homeassistant.components"), "homeassistant.components.http": http,
                                               "homeassistant.components.http.const": http_const})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.library = await furniture.async_register_furniture(self.hass)
        self.catalogue, self.asset, self.archive = self.views

    def request(self, raw=None, *, admin=True, active=True, extra=False, multipart_error=False, demote=False, deactivate=False, field_name="file", during_chunk=None):
        self.session_serial += 1
        user = SimpleNamespace(id=f"synthetic-admin-{self.session_serial}", is_admin=admin, is_active=active)
        class Request(dict):
            async def multipart(self):
                if multipart_error:
                    raise ValueError("Not multipart")
                field = SimpleNamespace(name=field_name)
                remaining = [raw or b""]
                async def chunk(amount):
                    if demote:
                        user.is_admin = False
                    if deactivate:
                        user.is_active = False
                    if during_chunk is not None:
                        during_chunk(self, user)
                    return remaining.pop(0) if remaining else b""
                field.read_chunk = chunk
                fields = [field, SimpleNamespace(name="other")] if extra else [field]
                async def next_field():
                    return fields.pop(0) if fields else None
                return SimpleNamespace(next=next_field)
        session_id = f"synthetic-session-{self.session_serial}"
        self.sessions[session_id] = SimpleNamespace(user=user)
        self.users[user.id] = user
        return Request(hass_user=user, hass_refresh_token_id=session_id)

    async def test_registration_is_once_and_all_routes_require_authentication(self):
        self.assertEqual(len(self.views), 3)
        self.assertIs(await furniture.async_register_furniture(self.hass), self.library)
        self.assertEqual(len(self.views), 3)
        self.assertTrue(all(view.requires_auth for view in self.views))
        self.assertEqual([view.url for view in self.views], ["/api/taylors3d/furniture", "/api/taylors3d/furniture/assets/{digest}.glb", "/api/taylors3d/furniture/packs/{pack_id}.zip"])
        self.assertTrue(all(not hasattr(view, "delete") for view in self.views))

    async def test_nonadmin_and_missing_user_cannot_upload_or_read_body(self):
        for request in (self.request(fixture.bundle(), admin=False), {}):
            response = await self.catalogue.post(request)
            self.assertEqual(response.status, 401)
        self.assertEqual(self.library.catalogue()["packs"], [])
        self.assertEqual(self.executor_calls, 0)

    async def test_admin_demoted_during_stream_cannot_publish(self):
        response = await self.catalogue.post(self.request(fixture.bundle(), demote=True))
        self.assertEqual(response.status, 401)
        self.assertEqual(self.library.catalogue()["packs"], [])
        self.assertEqual(self.executor_calls, 0)

    async def test_admin_deactivated_during_stream_cannot_publish(self):
        response = await self.catalogue.post(self.request(fixture.bundle(), deactivate=True))
        self.assertEqual(response.status, 401)
        self.assertEqual(self.library.catalogue()["packs"], [])
        self.assertEqual(self.executor_calls, 0)

    async def test_inactive_admin_cannot_begin_import(self):
        response = await self.catalogue.post(self.request(fixture.bundle(), active=False))
        self.assertEqual(response.status, 401)
        self.assertEqual(self.library.catalogue()["packs"], [])
        self.assertEqual(self.executor_calls, 0)

    async def test_session_revoked_or_authenticated_user_changed_during_stream_is_denied(self):
        for mutate in (lambda request, user: self.sessions.pop(request["hass_refresh_token_id"], None),
                       lambda request, user: request.update(hass_user=SimpleNamespace(id="another-admin", is_admin=True, is_active=True)),
                       lambda request, user: request.update(hass_refresh_token_id="replacement-session")):
            with self.subTest(mutate=mutate):
                response = await self.catalogue.post(self.request(fixture.bundle(), during_chunk=mutate))
                self.assertEqual(response.status, 401)
                self.assertEqual(self.library.catalogue()["packs"], [])
        self.assertEqual(self.executor_calls, 0)

    async def test_active_admin_and_session_rechecked_after_awaited_validation(self):
        original = self.hass.async_add_executor_job
        for revoke in (lambda request: setattr(request["hass_user"], "is_active", False),
                       lambda request: setattr(request["hass_user"], "is_admin", False),
                       lambda request: self.sessions.pop(request["hass_refresh_token_id"], None)):
            request = self.request(fixture.bundle())
            async def during_validation(function, *args):
                result = await original(function, *args)
                if function is furniture.validate_furniture_pack:
                    revoke(request)
                return result
            with self.subTest(revoke=revoke), patch.object(self.hass, "async_add_executor_job", side_effect=during_validation):
                response = await self.catalogue.post(request)
                self.assertEqual(response.status, 401)
                self.assertFalse(self.library.root.exists())
                self.assertEqual(self.library.catalogue()["packs"], [])

    async def test_absent_or_foreign_session_denied_but_trusted_supervisor_context_supported(self):
        request = self.request(fixture.bundle())
        self.sessions[request["hass_refresh_token_id"]] = SimpleNamespace(user=SimpleNamespace(id="other", is_admin=True, is_active=True))
        self.assertEqual((await self.catalogue.post(request)).status, 401)
        request = self.request(fixture.bundle())
        request.pop("hass_refresh_token_id")
        self.assertEqual((await self.catalogue.post(request)).status, 401)
        request["ha_supervisor_unix_socket"] = True
        self.assertEqual((await self.catalogue.post(request)).status, 200)

    async def test_removed_or_replaced_current_user_during_stream_cannot_publish(self):
        for tokenless in (False, True):
            for replace in (False, True):
                def remove_or_replace(request, user):
                    if replace:
                        self.users[user.id] = SimpleNamespace(id=user.id, is_admin=True, is_active=True)
                    else:
                        self.users.pop(user.id, None)
                request = self.request(fixture.bundle(), during_chunk=remove_or_replace)
                if tokenless:
                    request.pop("hass_refresh_token_id")
                    request["ha_supervisor_unix_socket"] = True
                with self.subTest(tokenless=tokenless, replace=replace):
                    response = await self.catalogue.post(request)
                    self.assertEqual(response.status, 401)
                    self.assertEqual(self.library.catalogue()["packs"], [])
                    self.assertFalse(self.library.root.exists())
        self.assertEqual(self.executor_calls, 0)

    async def test_removed_or_replaced_current_user_after_validation_cannot_stage_files(self):
        original = self.hass.async_add_executor_job
        for tokenless in (False, True):
            for replace in (False, True):
                request = self.request(fixture.bundle())
                if tokenless:
                    request.pop("hass_refresh_token_id")
                    request["ha_supervisor_unix_socket"] = True

                async def during_validation(function, *args):
                    result = await original(function, *args)
                    if function is furniture.validate_furniture_pack:
                        user = request["hass_user"]
                        if replace:
                            self.users[user.id] = SimpleNamespace(id=user.id, is_admin=True, is_active=True)
                        else:
                            self.users.pop(user.id, None)
                    return result

                with self.subTest(tokenless=tokenless, replace=replace), patch.object(self.hass, "async_add_executor_job", side_effect=during_validation):
                    response = await self.catalogue.post(request)
                    self.assertEqual(response.status, 401)
                    self.assertFalse(self.library.root.exists())
                    self.assertEqual(self.library.catalogue()["packs"], [])

    async def test_admin_requires_nonblank_current_auth_user_id_before_reading_body(self):
        for invalid in (None, "", " ", 3):
            request = self.request(fixture.bundle())
            request["hass_user"].id = invalid
            with self.subTest(invalid=invalid):
                response = await self.catalogue.post(request)
                self.assertEqual(response.status, 401)
                self.assertEqual(self.executor_calls, 0)
                self.assertFalse(self.library.root.exists())

    async def test_admin_import_then_authenticated_readers_receive_verified_bytes(self):
        raw = fixture.bundle()
        imported = await self.catalogue.post(self.request(raw))
        self.assertEqual(imported.status, 200)
        record = imported.payload["pack"]
        reader = self.request(admin=False)
        catalogue = await self.catalogue.get(reader)
        self.assertEqual(catalogue.payload["packs"], [record])
        self.assertEqual(catalogue.headers["Cache-Control"], "private, no-store")
        asset = await self.asset.get(reader, record["items"][0]["sha256"])
        self.assertEqual(asset.body, fixture.glb())
        self.assertEqual(asset.headers["Content-Type"], "model/gltf-binary")
        self.assertEqual(asset.headers["X-Content-Type-Options"], "nosniff")
        original = await self.archive.get(reader, record["pack_id"])
        self.assertEqual(original.body, raw)
        self.assertEqual(original.headers["Content-Type"], "application/zip")
        self.assertIn(record["pack_id"] + ".zip", original.headers["Content-Disposition"])
        self.assertTrue(original.headers["Cache-Control"].startswith("private"))

    async def test_malformed_extra_and_oversized_uploads_never_publish(self):
        for request in (self.request(fixture.bundle(), extra=True), self.request(multipart_error=True),
                        self.request(b"Bad ZIP"), self.request(fixture.bundle(), field_name="house")):
            with self.subTest(request=request):
                response = await self.catalogue.post(request)
                self.assertEqual(response.status, 400)
        # Exercise the actual stream path with its default maximum, without a 64MiB fixture.
        original = furniture.read_furniture_upload
        async def bounded(field):
            return await original(field, 8)
        with patch.object(furniture, "read_furniture_upload", side_effect=bounded):
            response = await self.catalogue.post(self.request(b"123456789"))
        self.assertEqual(response.status, 413)
        self.assertEqual(response.payload["error"], "archive_size")
        self.assertEqual(self.library.catalogue()["packs"], [])

    async def test_corrupt_reads_return_clear_conflict_and_missing_returns_not_found(self):
        record = self.library.import_pack(fixture.bundle())["pack"]
        digest = record["items"][0]["sha256"]
        (self.library.root / "assets" / f"{digest}.glb").write_bytes(b"Corrupt")
        response = await self.asset.get(self.request(), digest)
        self.assertEqual(response.status, 409)
        self.assertEqual(response.payload["error"], "corrupt_storage")
        self.assertNotIn(self.directory.name, response.payload["message"])
        self.assertEqual((await self.asset.get(self.request(), "a" * 64)).status, 404)
        self.assertEqual((await self.archive.get(self.request(), "../secret")).status, 400)

    async def test_io_error_returns_safe_message_without_host_details(self):
        with patch.object(self.library, "catalogue", side_effect=OSError("C:/config/secrets.yaml inaccessible")):
            response = await self.catalogue.get(self.request())
        self.assertEqual(response.status, 500)
        self.assertNotIn("secrets", response.payload["message"])

    async def test_import_response_idempotence_and_validation_failure_keep_clear_codes(self):
        request = lambda: self.request(fixture.bundle())
        self.assertTrue((await self.catalogue.post(request())).payload["imported"])
        self.assertFalse((await self.catalogue.post(request())).payload["imported"])
        response = await self.catalogue.post(self.request(fixture.bundle(asset=b"Bad GLB")))
        self.assertEqual(response.status, 400)
        self.assertTrue(response.payload["error"])
        self.assertTrue(response.payload["path"])
        self.assertEqual(len(self.library.catalogue()["packs"]), 1)


if __name__ == "__main__":
    unittest.main()
