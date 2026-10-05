"""Standalone CLI pack-maker proofs, no Home Assistant harness or network.

Run: python tests/test_create_furniture_pack.py
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile


ROOT = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tool = load("local_create_furniture_pack", ROOT / "tools" / "create-furniture-pack.py")
fixture = load("local_create_pack_source_fixtures", ROOT / "tests" / "test_furniture_pack.py")


class CreateFurniturePackTest(unittest.TestCase):
    def setUp(self):
        self.scope = tempfile.TemporaryDirectory(prefix="taylors3d-create-pack-")
        self.addCleanup(self.scope.cleanup)
        self.folder = Path(self.scope.name)
        self.glb = self.folder / "my original chair.glb"
        self.licence = self.folder / "original licence.txt"
        self.output = self.folder / "my chair.zip"
        self.original = fixture.glb()
        self.credit = "Original UTF-8 licence supplied by Taylor.\r\nCopyright © 2026 Taylor.\r\n".encode("utf-8")
        self.glb.write_bytes(self.original)
        self.licence.write_bytes(self.credit)
        self.arguments = {"glb": self.glb, "license_file": self.licence, "output": self.output,
                          "pack_id": "my-chair-pack", "pack_name": "My chair pack", "item_id": "chair", "item_name": "Original chair",
                          "author": "Taylor original author", "license_id": "LicenseRef-Original", "unit": "m"}

    def create(self, **changes):
        return tool.create_furniture_pack(**{**self.arguments, **changes})

    def failed(self, **changes):
        before = {self.glb: self.glb.read_bytes(), self.licence: self.licence.read_bytes()}
        with self.assertRaises((tool.PackCreationError, tool.validator.FurniturePackError)):
            self.create(**changes)
        self.assertFalse(self.output.exists())
        for path, body in before.items():
            self.assertEqual(path.read_bytes(), body)

    def test_valid_zip_preserves_original_bytes_names_and_complete_identities(self):
        result = self.create(anchor=(.2, .3, -.4))
        raw = self.output.read_bytes()
        validated = tool.validator.validate_furniture_pack(raw)
        self.assertEqual(result["pack_id"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result["logical_sha256"], validated["sha256"])
        self.assertEqual(result["asset_sha256"], hashlib.sha256(self.original).hexdigest())
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            self.assertEqual(archive.namelist(), ["pack.json", "LICENSE.txt", "assets/chair.glb"])
            self.assertEqual(archive.read("assets/chair.glb"), self.original)
            self.assertEqual(archive.read("LICENSE.txt"), self.credit)
            manifest = json.loads(archive.read("pack.json"))
        self.assertEqual(manifest["id"], "my-chair-pack")
        self.assertEqual(manifest["author"], "Taylor original author")
        self.assertEqual(manifest["license"], {"id": "LicenseRef-Original", "file": "LICENSE.txt"})
        self.assertEqual(manifest["items"][0]["anchor"], [.2, .3, -.4])
        self.assertEqual(manifest["items"][0]["unit"], "m")
        self.assertEqual(self.glb.read_bytes(), self.original)
        self.assertEqual(self.licence.read_bytes(), self.credit)

    def test_repeated_identical_inputs_have_reproducible_original_archive_hash(self):
        first = self.create()
        second = self.create(output=self.folder / "second.zip")
        self.assertEqual(first["pack_id"], second["pack_id"])
        self.assertEqual(self.output.read_bytes(), (self.folder / "second.zip").read_bytes())

    def test_real_embedded_png_model_is_kept_and_validated_without_reencoding(self):
        doc, binary = fixture.textured()
        original = fixture.glb(doc, binary)
        self.glb.write_bytes(original)
        self.create()
        report = tool.validator.validate_furniture_pack(self.output.read_bytes())
        self.assertEqual(report["items"][0]["data"], original)
        self.assertEqual(report["items"][0]["stats"]["images"], [{"width": 1, "height": 1, "mime_type": "image/png"}])

    def test_overwrite_is_refused_and_all_existing_bytes_are_untouched(self):
        self.output.write_bytes(b"Existing pack must remain unchanged")
        with self.assertRaisesRegex(tool.PackCreationError, "never overwrites"):
            self.create()
        self.assertEqual(self.output.read_bytes(), b"Existing pack must remain unchanged")
        self.assertEqual(self.glb.read_bytes(), self.original)
        self.assertEqual(self.licence.read_bytes(), self.credit)

    def test_concurrent_output_creation_is_still_exclusive(self):
        original_validate = tool.validator.validate_furniture_pack
        def validate(raw):
            result = original_validate(raw)
            self.output.write_bytes(b"Concurrent user's file")
            return result
        with patch.object(tool.validator, "validate_furniture_pack", side_effect=validate):
            with self.assertRaisesRegex(tool.PackCreationError, "never overwrites"):
                self.create()
        self.assertEqual(self.output.read_bytes(), b"Concurrent user's file")

    def test_output_cannot_overwrite_original_input_or_a_hardlink_alias(self):
        with self.assertRaises(tool.PackCreationError):
            self.create(output=self.glb)
        os.link(self.glb, self.output)
        with self.assertRaisesRegex(tool.PackCreationError, "never overwrites"):
            self.create()
        self.assertEqual(self.glb.read_bytes(), self.original)
        self.assertEqual(self.output.read_bytes(), self.original)

    def test_output_symlink_alias_and_broken_symlink_are_never_followed(self):
        try:
            self.output.symlink_to(self.glb)
        except OSError as error:
            self.skipTest(f"This platform does not permit unprivileged symlinks: {error}")
        with self.assertRaises(tool.PackCreationError):
            self.create()
        self.assertEqual(self.glb.read_bytes(), self.original)
        self.output.unlink()
        self.output.symlink_to(self.folder / "missing.glb")
        with self.assertRaises(tool.PackCreationError):
            self.create()
        self.assertFalse((self.folder / "missing.glb").exists())

    def test_units_are_an_explicit_declaration_never_automatic_conversion(self):
        for unit in (None, "cm", "mm", "", True):
            with self.subTest(unit=unit):
                self.failed(unit=unit)

    def test_identifiers_are_explicit_safe_and_no_filename_is_sanitized(self):
        for key in ("pack_id", "item_id"):
            for value in ("", "Chair", "../chair", "folder/chair", "chair.glb", "a" * 65, 3):
                with self.subTest(key=key, value=value):
                    self.failed(**{key: value})

    def test_missing_and_empty_author_names_or_licence_id_fail_before_output(self):
        for key in ("pack_name", "item_name", "author", "license_id"):
            for value in ("", " ", None, 3):
                with self.subTest(key=key, value=value):
                    self.failed(**{key: value})

    def test_malformed_anchor_and_nonfinite_json_do_not_create_output(self):
        for anchor in (None, (), (1, 2), (1, 2, 3, 4), (True, 0, 0), (float("nan"), 0, 0), (float("inf"), 0, 0), (10001, 0, 0)):
            with self.subTest(anchor=anchor):
                self.failed(anchor=anchor)

    def test_missing_licence_is_not_fabricated(self):
        self.failed(license_file=self.folder / "missing.txt")

    def test_empty_nonutf8_or_nul_licence_does_not_create_output(self):
        for credit in (b"", b" ", b"\xff\xfe", b"A supplied licence\0bad"):
            with self.subTest(credit=credit):
                self.licence.write_bytes(credit)
                self.failed()

    def test_missing_empty_invalid_or_nonstatic_model_does_not_create_output(self):
        self.failed(glb=self.folder / "missing.glb")
        for body in (b"", b"glTF invalid", b"OBJ is not GLB"):
            with self.subTest(body=body):
                self.glb.write_bytes(body)
                self.failed()
        doc, binary = fixture.fixture()
        doc["animations"] = [{"channels": [], "samplers": []}]
        self.glb.write_bytes(fixture.glb(doc, binary))
        self.failed()

    def test_external_model_or_texture_source_is_rejected_without_fetch(self):
        doc, binary = fixture.fixture()
        for resource in ("https://example.test/furniture.bin", "../other.bin", "data:application/octet-stream;base64,AAAA"):
            with self.subTest(resource=resource):
                copied = copy.deepcopy(doc)
                copied["buffers"][0]["uri"] = resource
                self.glb.write_bytes(fixture.glb(copied, binary))
                self.failed()
        textured, texture_binary = fixture.textured()
        textured["images"][0] = {"uri": "https://example.test/texture.png"}
        self.glb.write_bytes(fixture.glb(textured, texture_binary))
        self.failed()

    def test_asset_and_licence_input_budgets_are_bounded_before_output(self):
        self.glb.write_bytes(b"x" * (tool.validator.MAX_ASSET_BYTES + 1))
        self.failed()
        self.glb.write_bytes(self.original)
        self.licence.write_bytes(b"x" * (tool.validator.MAX_LICENSE_BYTES + 1))
        self.failed()

    def test_actual_stream_growth_cannot_bypass_the_input_budget(self):
        # Real bounded reader with deliberately smaller metadata simulates a
        # file growing after fstat; no parser or filesystem writer is replaced.
        original_stat = os.fstat
        def small_stat(descriptor):
            info = original_stat(descriptor)
            class Small:
                st_mode = info.st_mode
                st_size = 0
            return Small()
        with patch.object(tool.os, "fstat", side_effect=small_stat):
            with self.assertRaisesRegex(tool.PackCreationError, "input limit"):
                tool._read_file(self.glb, 20, "GLB")
        self.assertFalse(self.output.exists())

    def test_a_directory_is_not_read_as_a_model_or_licence(self):
        self.failed(glb=self.folder)
        self.failed(license_file=self.folder)

    def test_output_extension_or_missing_parent_fails_without_creating_other_files(self):
        with self.assertRaises(tool.PackCreationError):
            self.create(output=self.folder / "not-a-zip.txt")
        with self.assertRaises(tool.PackCreationError):
            self.create(output=self.folder / "missing-parent" / "pack.zip")
        self.assertEqual(sorted(path.name for path in self.folder.iterdir()), [self.glb.name, self.licence.name])

    def test_cli_requires_explicit_metadata_and_units_and_runs_without_a_shell(self):
        script = ROOT / "tools" / "create-furniture-pack.py"
        command = [sys.executable, str(script), "--glb", str(self.glb), "--license", str(self.licence), "--output", str(self.output),
                   "--pack-id", "my-chair-pack", "--pack-name", "My chair pack", "--item-id", "chair", "--item-name", "Original chair",
                   "--author", "Taylor", "--license-id", "LicenseRef-Original", "--unit", "m", "--anchor", ".2", ".3", "-.4"]
        result = subprocess.run(command, shell=False, check=False, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Created validated ZIP", result.stdout)
        self.assertIn(hashlib.sha256(self.output.read_bytes()).hexdigest(), result.stdout)
        self.assertIn("not changed", result.stdout)
        rejected = subprocess.run(command, shell=False, check=False, capture_output=True, text=True)
        self.assertEqual(rejected.returncode, 1)
        self.assertIn("never overwrites", rejected.stderr)
        self.assertEqual(tool.validator.validate_furniture_pack(self.output.read_bytes())["manifest"]["author"], "Taylor")

    def test_cli_missing_explicit_unit_or_identity_returns_parse_error_without_output(self):
        script = ROOT / "tools" / "create-furniture-pack.py"
        result = subprocess.run([sys.executable, str(script), "--glb", str(self.glb), "--license", str(self.licence), "--output", str(self.output)],
                                shell=False, check=False, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("--unit", result.stderr)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
