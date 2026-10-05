"""Pure pack tests, runnable without the HA harness: python tests/test_furniture_pack.py.

Pytest also collects these unittest cases. File loading deliberately avoids the
integration __init__ (which imports HA); these tests make no live HA claims.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import struct
import unittest
from unittest.mock import patch
import warnings
import zipfile
import zlib

MODULE_PATH = Path(__file__).resolve().parents[1] / "custom_components" / "taylors3d" / "furniture_pack.py"
SPEC = importlib.util.spec_from_file_location("pure_furniture_pack", MODULE_PATH)
assert SPEC and SPEC.loader
pack = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pack)


def fixture() -> tuple[dict, bytes]:
    binary = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 0, 1)
    doc = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}],
           "nodes": [{"mesh": 0}], "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "material": 0}]}],
           "materials": [{"pbrMetallicRoughness": {"roughnessFactor": 1}}],
           "buffers": [{"byteLength": len(binary)}], "bufferViews": [{"buffer": 0, "byteLength": len(binary)}],
           "accessors": [{"bufferView": 0, "componentType": 5126, "type": "VEC3", "count": 3, "min": [0, 0, 0], "max": [1, 0, 1]}]}
    return doc, binary


def glb(doc: dict | None = None, binary: bytes | None = None, *, json_bytes: bytes | None = None) -> bytes:
    default_doc, default_binary = fixture()
    doc = default_doc if doc is None else doc
    binary = default_binary if binary is None else binary
    text = json.dumps(doc, separators=(",", ":")).encode() if json_bytes is None else json_bytes
    text += b" " * (-len(text) % 4)
    body = struct.pack("<II", len(text), 0x4E4F534A) + text
    if binary:
        padded = binary + b"\0" * (-len(binary) % 4)
        body += struct.pack("<II", len(padded), 0x004E4942) + padded
    return b"glTF" + struct.pack("<II", 2, len(body) + 12) + body


def png(width: int = 1, height: int = 1) -> bytes:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\0\xff\xff\xff\xff")) + chunk(b"IEND", b"")


def textured(image: bytes | None = None) -> tuple[dict, bytes]:
    doc, binary = fixture()
    uv = struct.pack("<6f", 0, 0, 1, 0, 0, 1)
    image = png() if image is None else image
    doc["bufferViews"] += [{"buffer": 0, "byteOffset": len(binary), "byteLength": len(uv)},
                           {"buffer": 0, "byteOffset": len(binary) + len(uv), "byteLength": len(image)}]
    doc["accessors"].append({"bufferView": 1, "componentType": 5126, "type": "VEC2", "count": 3})
    doc["meshes"][0]["primitives"][0]["attributes"]["TEXCOORD_0"] = 1
    doc["images"] = [{"bufferView": 2, "mimeType": "image/png"}]
    doc["textures"] = [{"source": 0}]
    doc["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"] = {"index": 0}
    binary += uv + image
    doc["buffers"][0]["byteLength"] = len(binary)
    return doc, binary


def manifest() -> dict:
    return {"version": 1, "id": "test-furniture", "name": "Explicit synthetic test furniture", "author": "Taylor test fixture",
            "license": {"id": "LicenseRef-Test", "file": "LICENSE.txt"},
            "items": [{"id": "triangle", "name": "Synthetic triangle", "file": "assets/triangle.glb", "unit": "m", "anchor": [0, 0, 0]}]}


def archive(entries: list[tuple[str | zipfile.ZipInfo, bytes]], compression: int = zipfile.ZIP_STORED) -> bytes:
    out = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(out, "w", compression=compression) as container:
            for name, body in entries:
                container.writestr(name, body)
    return out.getvalue()


def bundle(value: dict | None = None, *, asset: bytes | None = None, extra: list | None = None, text: bytes = b"Supplied synthetic licence.\r\nCopyright Taylor test fixture.\r\n") -> bytes:
    return archive([("pack.json", json.dumps(manifest() if value is None else value).encode()),
                    ("LICENSE.txt", text), ("assets/triangle.glb", glb() if asset is None else asset), *(extra or [])])


class ValidatorTest(unittest.TestCase):
    def rejected(self, call, code: str | None = None):
        with self.assertRaises(pack.FurniturePackError) as caught:
            call()
        self.assertTrue(caught.exception.path)
        self.assertTrue(caught.exception.message)
        if code:
            self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_valid_pack_preserves_unknown_metadata_bytes_and_full_identities(self):
        value = manifest()
        value["extensions"] = {"future": {"edition": 4}}
        value["items"][0]["credits"] = {"artist": "A supplied author", "url": "https://example.test/source"}
        original = copy.deepcopy(value)
        raw = bundle(value)
        report = pack.validate_furniture_pack(raw)
        self.assertEqual(report["manifest"], original)
        self.assertEqual(value, original)
        self.assertEqual(report["items"][0]["data"], glb())
        self.assertEqual(report["items"][0]["sha256"], hashlib.sha256(glb()).hexdigest())
        self.assertEqual(report["license"]["text"], "Supplied synthetic licence.\r\nCopyright Taylor test fixture.\r\n")
        self.assertEqual(report["archive_sha256"], hashlib.sha256(raw).hexdigest())
        self.assertRegex(report["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(report["stats"]["unique_assets"], 1)
        self.assertEqual(report["stats"]["triangles"], 1)

    def test_logical_identity_ignores_zip_order_and_compression_but_not_credits(self):
        value = manifest()
        entries = [("pack.json", json.dumps(value, indent=2).encode()), ("LICENSE.txt", b"Exact supplied licence.\n"), ("assets/triangle.glb", glb())]
        first = pack.validate_furniture_pack(archive(entries))
        second = pack.validate_furniture_pack(archive(list(reversed(entries)), zipfile.ZIP_DEFLATED))
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertNotEqual(first["archive_sha256"], second["archive_sha256"])
        value["author"] = "Different credited author"
        third = pack.validate_furniture_pack(bundle(value, text=b"Exact supplied licence.\n"))
        self.assertNotEqual(first["sha256"], third["sha256"])
        fourth = pack.validate_furniture_pack(bundle(manifest(), text=b"Changed licence.\n"))
        self.assertNotEqual(first["sha256"], fourth["sha256"])

    def test_same_glb_keeps_separate_item_licences_and_anchors(self):
        value = manifest()
        value["items"].append({**value["items"][0], "id": "other-triangle", "anchor": [1, 0, 2],
                               "license": {"id": "LicenseRef-Other", "file": "OTHER.txt", "retained": True}})
        report = pack.validate_furniture_pack(bundle(value, extra=[("OTHER.txt", b"A distinct supplied credit.\n")]))
        self.assertEqual(report["stats"]["items"], 2)
        self.assertEqual(report["stats"]["unique_assets"], 1)
        self.assertEqual(report["items"][0]["license"]["id"], "LicenseRef-Test")
        self.assertEqual(report["items"][1]["license"]["id"], "LicenseRef-Other")
        self.assertEqual(report["items"][1]["license"]["text"], "A distinct supplied credit.\n")
        self.assertEqual(report["items"][1]["anchor"], [1, 0, 2])
        self.assertTrue(report["manifest"]["items"][1]["license"]["retained"])

    def test_validation_never_extracts_writes_or_calls_network(self):
        raw = bundle()
        with patch("builtins.open", side_effect=AssertionError("filesystem access")), \
             patch.object(zipfile.ZipFile, "extract", side_effect=AssertionError("extraction")), \
             patch.object(zipfile.ZipFile, "extractall", side_effect=AssertionError("extraction")), \
             patch("socket.socket", side_effect=AssertionError("network access")):
            self.assertEqual(pack.validate_furniture_pack(raw)["manifest"]["id"], "test-furniture")

    def test_directory_entries_are_optional_and_have_no_effect_on_asset_identity(self):
        first = pack.validate_furniture_pack(bundle())
        second = pack.validate_furniture_pack(bundle(extra=[("assets/", b"")]))
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertEqual(second["stats"]["members"], 4)

    def test_archive_requires_bytes_and_a_real_zip(self):
        for value in (None, "", bytearray(bundle()), b"", b"not a zip"):
            with self.subTest(value=type(value).__name__):
                self.rejected(lambda: pack.validate_furniture_pack(value))

    def test_portable_paths_reject_escape_reserved_platform_and_unicode_aliases(self):
        for name in ("../escape", "/absolute", "C:/asset.glb", "assets//bad", "assets/./bad",
                     "assets/bad.", "assets/bad ", "assets/CON.glb", "assets/COM1.txt", "assets/LPT².txt",
                     "assets/a:b", "assets/a?b", "assets/\x01bad", "assets/cafe\u0301.glb"):
            with self.subTest(name=name):
                self.rejected(lambda: pack.validate_furniture_pack(bundle(extra=[(name, b"x")])), "archive_path")
        # ZipFile's writer normalizes Windows separators. Put the invalid name
        # into both actual ZIP headers to test incoming portable-path validation.
        raw = bundle(extra=[("assets/bad.glb", b"x")]).replace(b"assets/bad.glb", b"assets\\bad.glb")
        self.rejected(lambda: pack.validate_furniture_pack(raw), "archive_path")

    def test_duplicate_casefold_and_file_parent_collisions_are_rejected(self):
        for extra in ([("LICENSE.txt", b"another")], [("license.TXT", b"another")],
                      [("assets", b"parent file")], [("LICENSE.txt/", b"")]):
            with self.subTest(extra=extra):
                self.rejected(lambda: pack.validate_furniture_pack(bundle(extra=extra)))

    def test_symlink_and_special_members_are_rejected(self):
        for kind in (stat.S_IFLNK, stat.S_IFIFO, stat.S_IFCHR):
            info = zipfile.ZipInfo("assets/link")
            info.create_system = 3
            info.external_attr = (kind | 0o644) << 16
            with self.subTest(kind=kind):
                self.rejected(lambda: pack.validate_furniture_pack(bundle(extra=[(info, b"target")])), "archive_type")

    def test_unsupported_compression_is_rejected(self):
        value = archive([("pack.json", b"{}")], zipfile.ZIP_BZIP2)
        self.rejected(lambda: pack.validate_furniture_pack(value), "archive_format")

    def test_encrypted_member_flag_is_rejected_before_opening(self):
        value = bytearray(bundle())
        for signature, flag_offset in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
            offset = value.index(signature)
            flags, = struct.unpack_from("<H", value, offset + flag_offset)
            struct.pack_into("<H", value, offset + flag_offset, flags | 1)
        self.rejected(lambda: pack.validate_furniture_pack(bytes(value)), "archive_format")

    def test_crc_corruption_rejects_the_entire_pack(self):
        value = bytearray(bundle())
        value[value.index(b"glTF") + 25] ^= 1
        self.rejected(lambda: pack.validate_furniture_pack(bytes(value)), "archive_integrity")

    def test_invalid_utf8_zip_member_name_fails_readably(self):
        value = bytearray(bundle())
        with zipfile.ZipFile(io.BytesIO(value)) as container:
            local = container.getinfo("LICENSE.txt").header_offset
        flags, = struct.unpack_from("<H", value, local + 6)
        struct.pack_into("<H", value, local + 6, flags | 0x800)
        value[local + 30] = 0xFF
        central = value.find(b"PK\x01\x02")
        while value[central + 46:central + 57] != b"LICENSE.txt":
            central = value.find(b"PK\x01\x02", central + 4)
            self.assertNotEqual(central, -1)
        flags, = struct.unpack_from("<H", value, central + 8)
        struct.pack_into("<H", value, central + 8, flags | 0x800)
        value[central + 46] = 0xFF
        self.rejected(lambda: pack.validate_furniture_pack(bytes(value)), "archive_integrity")

    def test_forged_short_member_size_cannot_hide_extra_stored_or_deflated_bytes(self):
        prefix = b"Supplied licence.\n"
        for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            value = bytearray(archive([("pack.json", json.dumps(manifest()).encode()),
                                       ("LICENSE.txt", prefix + b"Hidden bytes." * 10_000),
                                       ("assets/triangle.glb", glb())], compression))
            with zipfile.ZipFile(io.BytesIO(value)) as container:
                local = container.getinfo("LICENSE.txt").header_offset
            struct.pack_into("<I", value, local + 14, zlib.crc32(prefix))
            struct.pack_into("<I", value, local + 22, len(prefix))
            central = value.find(b"PK\x01\x02")
            while value[central + 46:central + 46 + 11] != b"LICENSE.txt":
                central = value.find(b"PK\x01\x02", central + 4)
                self.assertNotEqual(central, -1)
            struct.pack_into("<I", value, central + 16, zlib.crc32(prefix))
            struct.pack_into("<I", value, central + 24, len(prefix))
            with self.subTest(compression=compression):
                self.rejected(lambda: pack.validate_furniture_pack(bytes(value)), "archive_integrity")

    def test_complete_deflate_output_crosses_bounded_read_chunks(self):
        doc, binary = fixture()
        binary += b"\0" * (pack.READ_CHUNK * 3)
        doc["buffers"][0]["byteLength"] = len(binary)
        asset = glb(doc, binary)
        raw = archive([("pack.json", json.dumps(manifest()).encode()), ("LICENSE.txt", b"Supplied licence.\n"),
                       ("assets/", b""), ("assets/triangle.glb", asset)], zipfile.ZIP_DEFLATED)
        report = pack.validate_furniture_pack(raw)
        self.assertEqual(report["items"][0]["data"], asset)
        self.assertEqual(report["assets"][hashlib.sha256(asset).hexdigest()]["stats"]["triangles"], 1)

    def test_standard_streaming_zip_data_descriptors_are_supported(self):
        class NonSeekingBuffer(io.BytesIO):
            def seek(self, *_args):
                raise io.UnsupportedOperation("Streaming fixture cannot seek")

        output = NonSeekingBuffer()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as container:
            for name, body in (("pack.json", json.dumps(manifest()).encode()), ("LICENSE.txt", b"Supplied licence.\n"),
                               ("assets/triangle.glb", glb())):
                container.writestr(name, body)
        raw = output.getvalue()
        with zipfile.ZipFile(io.BytesIO(raw)) as container:
            self.assertTrue(all(info.flag_bits & 8 for info in container.infolist()))
        self.assertEqual(pack.validate_furniture_pack(raw)["items"][0]["data"], glb())

    def test_archive_and_member_budgets_fail_before_unbounded_expansion(self):
        raw = bundle()
        for constant, limit, code in (("MAX_ARCHIVE_BYTES", 10, "archive_size"), ("MAX_MEMBERS", 2, "member_budget"),
                                      ("MAX_ASSET_BYTES", 100, "file_budget"), ("MAX_EXPANDED_BYTES", 10, "expanded_budget")):
            with self.subTest(constant=constant), patch.object(pack, constant, limit):
                self.rejected(lambda: pack.validate_furniture_pack(raw), code)

    def test_missing_root_manifest_or_unreferenced_files_fail(self):
        self.rejected(lambda: pack.validate_furniture_pack(archive([("nested/pack.json", b"{}")])), "manifest")
        self.rejected(lambda: pack.validate_furniture_pack(bundle(extra=[("unused.glb", glb())])), "unreferenced_file")

    def test_manifest_known_fields_are_strict_and_never_coerced(self):
        for key, invalid in (("version", True), ("version", "1"), ("id", "Upper case"), ("name", ""),
                             ("author", ["Unknown"]), ("license", None), ("items", []), ("items", {})):
            value = manifest()
            value[key] = invalid
            with self.subTest(key=key, value=invalid):
                self.rejected(lambda: pack.validate_furniture_pack(bundle(value)))

    def test_item_fields_units_anchors_and_ids_are_strict(self):
        for key, invalid in (("id", ""), ("name", False), ("file", "../outside.glb"), ("file", "assets/missing.glb"),
                             ("unit", "cm"), ("unit", True), ("anchor", [0, False, 0]), ("anchor", [0, "", 0]),
                             ("anchor", [0, None, 0]), ("anchor", [0, 0]), ("anchor", [0, float("inf"), 0]),
                             ("anchor", [0, 10 ** 400, 0])):
            value = manifest()
            value["items"][0][key] = invalid
            with self.subTest(key=key, value=invalid):
                self.rejected(lambda: pack.validate_furniture_pack(bundle(value)))
        value = manifest()
        value["items"].append(copy.deepcopy(value["items"][0]))
        self.rejected(lambda: pack.validate_furniture_pack(bundle(value)), "duplicate_item")

    def test_licence_must_be_nonblank_utf8_exact_file(self):
        for text in (b"", b" \r\n", b"bad\0text", b"\xff"):
            with self.subTest(text=text):
                self.rejected(lambda: pack.validate_furniture_pack(bundle(text=text)), "license")
        value = manifest()
        value["license"]["file"] = "missing.txt"
        self.rejected(lambda: pack.validate_furniture_pack(bundle(value)), "license")
        with patch.object(pack, "MAX_LICENSE_BYTES", 2):
            self.rejected(lambda: pack.validate_furniture_pack(bundle()), "license")

    def test_licence_must_not_alias_the_manifest_or_geometry_file(self):
        value = manifest()
        value["license"]["file"] = "pack.json"
        raw = archive([("pack.json", json.dumps(value).encode()), ("assets/triangle.glb", glb())])
        self.rejected(lambda: pack.validate_furniture_pack(raw), "license")

    def test_duplicate_nonfinite_invalid_and_excessive_json_fail_readably(self):
        for raw in (b'{"version":1,"version":1}', b'{"unknown":NaN}', b'{"unknown":1e999}', b"\xff", b"[]",
                    b'{"unknown":"\\ud800"}', b'{"unknown":' + b"[" * 40 + b"0" + b"]" * 40 + b"}"):
            with self.subTest(raw=raw[:40]):
                value = archive([("pack.json", raw), ("LICENSE.txt", b"Supplied text"), ("assets/triangle.glb", glb())])
                self.rejected(lambda: pack.validate_furniture_pack(value))
        with patch.object(pack, "MAX_MANIFEST_BYTES", 10):
            self.rejected(lambda: pack.validate_furniture_pack(bundle()), "json_size")

    def test_item_and_unique_asset_pack_budgets(self):
        value = manifest()
        value["items"].append({**value["items"][0], "id": "second", "file": "assets/second.glb"})
        doc, binary = fixture()
        doc["asset"]["generator"] = "Distinct synthetic bytes"
        raw = bundle(value, extra=[("assets/second.glb", glb(doc, binary))])
        with patch.object(pack, "MAX_ITEMS", 1):
            self.rejected(lambda: pack.validate_furniture_pack(raw), "shape")
        with patch.object(pack, "MAX_PACK_TRIANGLES", 1):
            self.rejected(lambda: pack.validate_furniture_pack(raw), "pack_budget")
        same = manifest()
        same["items"].append({**same["items"][0], "id": "second"})
        with patch.object(pack, "MAX_PACK_TRIANGLES", 1):
            self.assertEqual(pack.validate_furniture_pack(bundle(same))["stats"]["triangles"], 1)

    def test_actual_static_glb_has_full_sha_and_geometry_stats(self):
        raw = glb()
        result = pack.validate_furniture_glb(raw)
        self.assertEqual(result["sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result["bytes"], len(raw))
        self.assertEqual(result["stats"]["triangles"], 1)
        self.assertEqual(result["stats"]["mesh_uses"], 1)
        self.assertEqual(result["stats"]["materials"], 1)

    def test_glb_header_and_chunks_must_match_actual_bytes(self):
        for location, value, code in ((4, 1, "glb_header"), (8, 12, "glb_header"), (12, 3, "glb_chunk"),
                                      (16, 0x004E4942, "glb_chunk")):
            raw = bytearray(glb())
            struct.pack_into("<I", raw, location, value)
            with self.subTest(location=location):
                self.rejected(lambda: pack.validate_furniture_glb(bytes(raw)), code)
        self.rejected(lambda: pack.validate_furniture_glb(b"gltf" + glb()[4:]), "glb_header")
        raw = bytearray(glb() + b"\0\0\0\0")
        struct.pack_into("<I", raw, 8, len(raw))
        self.rejected(lambda: pack.validate_furniture_glb(bytes(raw)), "glb_chunk")

    def test_central_directory_count_is_bounded_before_constructing_zip_reader(self):
        raw = bytearray(bundle())
        eocd = raw.rindex(b"PK\x05\x06")
        struct.pack_into("<HH", raw, eocd + 8, 500, 500)
        with patch.object(zipfile, "ZipFile", side_effect=AssertionError("unbounded ZIP directory parsing")):
            self.rejected(lambda: pack.validate_furniture_pack(bytes(raw)), "member_budget")

    def test_forged_small_central_count_and_multidisk_zip_are_rejected(self):
        for count, disk in ((1, 0), (3, 1)):
            raw = bytearray(bundle())
            eocd = raw.rindex(b"PK\x05\x06")
            struct.pack_into("<H", raw, eocd + 4, disk)
            struct.pack_into("<HH", raw, eocd + 8, count, count)
            self.rejected(lambda: pack.validate_furniture_pack(bytes(raw)), "archive_integrity")

    def test_static_contract_rejects_animations_skins_cameras_lights_and_codecs(self):
        for field in ("animations", "skins", "cameras"):
            doc, binary = fixture()
            doc[field] = [{}]
            with self.subTest(field=field):
                self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "static_only")
        for extension in ("KHR_lights_punctual", "KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu", "arbitrary_shader"):
            doc, binary = fixture()
            doc["extensionsUsed"] = [extension]
            with self.subTest(extension=extension):
                self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "extension")
        doc, binary = fixture()
        doc["nodes"][0]["extensions"] = {"KHR_lights_punctual": {"light": 0}}
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "extension")

    def test_external_and_data_buffer_or_image_uris_are_never_accepted(self):
        for uri in ("https://example.test/asset", "file:///config/secrets", "data:application/octet-stream;base64,AAAA", None):
            for field in ("buffers", "images"):
                doc, binary = fixture()
                if field == "images":
                    doc["images"] = [{"uri": uri}]
                else:
                    doc["buffers"][0]["uri"] = uri
                with self.subTest(uri=uri, field=field):
                    self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "external_resource")

    def test_buffer_view_and_accessor_ranges_are_checked_against_bin(self):
        for owner, key, value, code in (("buffer", "byteLength", 99, "buffer_bounds"),
                                       ("view", "byteLength", 99, "buffer_bounds"), ("view", "byteOffset", 4, "buffer_bounds"),
                                       ("view", "byteStride", 4, "accessor_bounds"), ("view", "byteStride", 7, "accessor_bounds"),
                                       ("accessor", "count", 4, "accessor_bounds"), ("accessor", "byteOffset", 1, "accessor_bounds"),
                                       ("accessor", "bufferView", True, "integer"), ("accessor", "componentType", True, "accessor")):
            doc, binary = fixture()
            container = doc[{"buffer": "buffers", "view": "bufferViews", "accessor": "accessors"}[owner]][0]
            container[key] = value
            with self.subTest(owner=owner, key=key, value=value):
                self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), code)

    def test_actual_nonfinite_positions_and_false_declared_bounds_are_rejected(self):
        doc, binary = fixture()
        for value in (float("nan"), float("inf"), float("-inf")):
            body = struct.pack("<f", value) + binary[4:]
            with self.subTest(value=value):
                self.rejected(lambda: pack.validate_furniture_glb(glb(doc, body)), "accessor_number")
        doc["accessors"][0]["max"] = [0, 0, 0]
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "position_bounds")

    def test_unsigned_indices_are_checked_against_actual_vertex_count(self):
        doc, binary = fixture()
        doc["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": 6})
        doc["accessors"].append({"bufferView": 1, "componentType": 5123, "type": "SCALAR", "count": 3})
        doc["meshes"][0]["primitives"][0]["indices"] = 1
        body = binary + struct.pack("<3H", 0, 1, 2)
        doc["buffers"][0]["byteLength"] = len(body)
        self.assertEqual(pack.validate_furniture_glb(glb(doc, body))["stats"]["triangles"], 1)
        bad = binary + struct.pack("<3H", 0, 1, 3)
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, bad)), "indices")
        doc["accessors"][1]["normalized"] = True
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, body)), "indices")

    def test_accessor_relative_offset_must_align_for_actual_gltf_loader(self):
        doc, binary = fixture()
        binary = b"\0" * 4 + binary
        doc["buffers"][0]["byteLength"] = len(binary)
        doc["bufferViews"][0].update(byteOffset=1, byteLength=len(binary) - 1)
        doc["accessors"][0]["byteOffset"] = 3
        # Global byte four is aligned, but GLTFLoader copies the view and then
        # constructs Float32Array at its relative offset three, which is invalid.
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "accessor_bounds")

    def test_interleaved_positions_have_real_stride_bounds(self):
        doc, _ = fixture()
        binary = struct.pack("<12f", 0, 0, 0, 99, 1, 0, 0, 99, 0, 0, 1, 99)
        doc["buffers"][0]["byteLength"] = len(binary)
        doc["bufferViews"][0].update(byteLength=len(binary), byteStride=16)
        self.assertEqual(pack.validate_furniture_glb(glb(doc, binary))["stats"]["triangles"], 1)
        doc["accessors"][0]["byteOffset"] = 4
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "position_bounds")

    def test_interleaved_accessor_keeps_full_stride_tail_for_installed_loader(self):
        doc, _ = fixture()
        binary = struct.pack("<11f", 0, 0, 0, 99, 1, 0, 0, 99, 0, 0, 1)
        doc["buffers"][0]["byteLength"] = len(binary)
        doc["bufferViews"][0].update(byteLength=len(binary), byteStride=16)
        # All positions fit, but GLTFLoader needs three full 16-byte records.
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "accessor_bounds")

    def test_interleaved_attribute_cannot_cross_its_record(self):
        doc, _ = fixture()
        binary = struct.pack("<16f", 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0)
        doc["buffers"][0]["byteLength"] = len(binary)
        doc["bufferViews"][0].update(byteLength=len(binary), byteStride=16)
        doc["accessors"][0]["byteOffset"] = 12
        # Absolute bytes fit; the resulting three-record typed-array slice does
        # not include the final two components of the crossing attribute.
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "accessor_bounds")

    def test_embedded_png_and_material_uv_reports_are_actual_header_evidence(self):
        doc, binary = textured()
        result = pack.validate_furniture_glb(glb(doc, binary))
        self.assertEqual(result["stats"]["images"], [{"width": 1, "height": 1, "mime_type": "image/png"}])
        self.assertEqual(result["stats"]["texture_pixels"], 1)
        self.assertEqual(result["stats"]["textures"], 1)
        del doc["meshes"][0]["primitives"][0]["attributes"]["TEXCOORD_0"]
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "texture_coordinates")

    def test_texture_transform_and_unlit_are_explicit_supported_features(self):
        doc, binary = textured()
        doc["extensionsUsed"] = ["KHR_texture_transform", "KHR_materials_unlit"]
        doc["extensionsRequired"] = ["KHR_materials_unlit"]
        doc["materials"][0]["extensions"] = {"KHR_materials_unlit": {}}
        info = doc["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]
        info["extensions"] = {"KHR_texture_transform": {"offset": [0, 0], "scale": [1, 1], "rotation": 0, "texCoord": 0}}
        self.assertEqual(pack.validate_furniture_glb(glb(doc, binary))["stats"]["texture_pixels"], 1)
        info["extensions"]["KHR_texture_transform"]["texCoord"] = True
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "integer")

    def test_image_framing_crc_bounds_mime_and_pixels_fail_before_renderer(self):
        bad_crc = bytearray(png())
        bad_crc[20] ^= 1
        for image, code in ((bytes(bad_crc), "image"), (png()[:-1], "image"), (png(2049), "image_budget")):
            doc, binary = textured(image)
            with self.subTest(code=code):
                self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), code)
        doc, binary = textured()
        doc["images"][0]["mimeType"] = "image/webp"
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "image")
        doc, binary = textured()
        doc["images"][0]["bufferView"] = 999
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "integer")
        with patch.object(pack, "MAX_ASSET_TEXTURE_PIXELS", 0):
            doc, binary = textured()
            self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "texture_budget")
        with patch.object(pack, "MAX_PACK_TEXTURE_PIXELS", 0):
            self.rejected(lambda: pack.validate_furniture_pack(bundle(asset=glb(doc, binary))), "pack_budget")

    def test_jpeg_frame_and_scan_headers_must_fit_inside_image_bytes(self):
        # Synthetic framing fixture only; pixel decoding remains the renderer's job.
        frame = b"\xff\xc0" + struct.pack(">H", 11) + b"\x08\0\x01\0\x01\x01\x01\x11\0"
        scan = b"\xff\xda" + struct.pack(">H", 8) + b"\x01\x01\0\0\x3f\0"
        image = b"\xff\xd8" + frame + scan + b"\0\xff\xd9"
        doc, binary = textured(image)
        doc["images"][0]["mimeType"] = "image/jpeg"
        self.assertEqual(pack.validate_furniture_glb(glb(doc, binary))["stats"]["images"][0],
                         {"width": 1, "height": 1, "mime_type": "image/jpeg"})
        for image in (b"\xff\xd8" + frame + b"\xff\xd9",
                      b"\xff\xd8" + frame + b"\xff\xda\xff\xff\0\xff\xd9",
                      b"\xff\xd8" + frame + frame + scan + b"\0\xff\xd9"):
            doc, binary = textured(image)
            doc["images"][0]["mimeType"] = "image/jpeg"
            with self.subTest(image=image):
                self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "image")

    def test_material_and_sampler_known_values_cannot_be_coerced(self):
        for target, key, value in (("pbr", "roughnessFactor", "0.5"), ("pbr", "metallicFactor", True),
                                    ("material", "doubleSided", 1), ("material", "alphaMode", "glass"),
                                    ("material", "alphaCutoff", -1)):
            doc, binary = fixture()
            owner = doc["materials"][0] if target == "material" else doc["materials"][0]["pbrMetallicRoughness"]
            owner[key] = value
            with self.subTest(key=key):
                self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)))
        doc, binary = textured()
        doc["samplers"] = [{"magFilter": "9729"}]
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "sampler")

    def test_named_gltf_objects_do_not_allow_loader_crashing_nontext_names(self):
        for owner in ("nodes", "materials", "meshes", "bufferViews", "accessors", "scenes"):
            doc, binary = fixture()
            doc[owner][0]["name"] = {"malformed": True}
            with self.subTest(owner=owner):
                self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "gltf_name")

    def test_vertex_colours_and_duplicate_required_extensions_are_strict(self):
        doc, binary = fixture()
        doc["meshes"][0]["primitives"][0]["attributes"]["COLOR_0"] = 1
        doc["accessors"].append({"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC2"})
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "attribute")
        doc, binary = fixture()
        doc["extensionsUsed"] = ["KHR_materials_unlit"]
        doc["extensionsRequired"] = ["KHR_materials_unlit", "KHR_materials_unlit"]
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "extension")

    def test_node_tree_rejects_cycles_duplicate_parents_and_invalid_scene_roots(self):
        for nodes, roots in (([{"mesh": 0, "children": [0]}], [0]),
                             ([{"mesh": 0, "children": [1]}, {"children": [0]}], [0]),
                             ([{"mesh": 0, "children": [2]}, {"children": [2]}, {}], [0, 1]),
                             ([{"mesh": 0, "children": [1, 1]}, {}], [0]),
                             ([{"mesh": 0}], [0, 0]),
                             ([{"mesh": 0}], [True]),
                             ([{"mesh": 0}], [[]])):
            doc, binary = fixture()
            doc["nodes"], doc["scenes"][0]["nodes"] = nodes, roots
            with self.subTest(nodes=nodes, roots=roots):
                self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)))

    def test_transforms_static_mesh_modes_and_known_shapes_are_strict(self):
        for key, value in (("translation", [0, False, 0]), ("rotation", [0, 0, 0, 0]),
                           ("scale", [1, 0, 1]), ("matrix", [1] * 16), ("camera", 0), ("weights", [])):
            doc, binary = fixture()
            doc["nodes"][0][key] = value
            with self.subTest(key=key):
                self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)))
        doc, binary = fixture()
        doc["meshes"][0]["primitives"][0]["mode"] = 5
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "static_only")
        doc["meshes"][0]["primitives"][0]["mode"] = True
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "static_only")
        doc, binary = fixture()
        doc["accessors"][0]["sparse"] = None
        self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "accessor")

    def test_matrix_transform_must_decompose_to_finite_nonzero_trs(self):
        for matrix in ([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                       [1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                       [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]):
            doc, binary = fixture()
            doc["nodes"][0]["matrix"] = matrix
            with self.subTest(matrix=matrix):
                self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "transform")
        # Authored reflected/rotated nonzero scale remains valid.
        doc, binary = fixture()
        doc["nodes"][0]["matrix"] = [0, -2, 0, 0, -1, 0, 0, 0, 0, 0, 3, 0, 4, 5, 6, 1]
        self.assertEqual(pack.validate_furniture_glb(glb(doc, binary))["stats"]["triangles"], 1)

    def test_repeated_mesh_nodes_count_against_triangle_budget(self):
        doc, binary = fixture()
        doc["nodes"] = [{"mesh": 0}, {"mesh": 0}]
        doc["scenes"][0]["nodes"] = [0, 1]
        self.assertEqual(pack.validate_furniture_glb(glb(doc, binary))["stats"]["triangles"], 2)
        with patch.object(pack, "MAX_ASSET_TRIANGLES", 1):
            self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "triangle_budget")

    def test_accessor_work_and_named_resource_budgets_are_bounded(self):
        doc, binary = fixture()
        doc["accessors"] *= 4
        with patch.object(pack, "MAX_ACCESSOR_VALUES", 10):
            self.rejected(lambda: pack.validate_furniture_glb(glb(doc, binary)), "accessor_budget")
        for constant in ("MAX_NODES", "MAX_MESHES", "MAX_MATERIALS", "MAX_ACCESSORS", "MAX_PRIMITIVES", "MAX_ASSET_BYTES", "MAX_GLB_JSON_BYTES"):
            with self.subTest(constant=constant), patch.object(pack, constant, 0):
                self.rejected(lambda: pack.validate_furniture_glb(glb()))


if __name__ == "__main__":
    unittest.main()
