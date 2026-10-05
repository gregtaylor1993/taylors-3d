"""Pure validation of portable, static, locally supplied furniture packs.

No Home Assistant imports, writes, extraction, downloads or device actions occur.
The conservative v1 budgets bound parser/resource work; they are not a claim that
every tablet can render the maximum. The later renderer must budget instances too.
Declared metre units and supplied licence text do not prove scale or ownership.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import re
import stat
import struct
import unicodedata
import zipfile
import zlib
from typing import Any

MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_EXPANDED_BYTES = 50 * 1024 * 1024
MAX_MEMBERS = 128
MAX_ITEMS = 32
MAX_PATH_LENGTH = 240
MAX_MANIFEST_BYTES = 256 * 1024
MAX_LICENSE_BYTES = 128 * 1024
MAX_ASSET_BYTES = 10 * 1024 * 1024
MAX_GLB_JSON_BYTES = 512 * 1024
MAX_JSON_DEPTH = 32
MAX_JSON_VALUES = 50_000
MAX_NODES = 512
MAX_MESHES = 256
MAX_PRIMITIVES = 512
MAX_MATERIALS = 128
MAX_TEXTURES = 64
MAX_IMAGES = 32
MAX_ACCESSORS = 2048
MAX_ACCESSOR_COUNT = 300_000
MAX_ACCESSOR_VALUES = 2_000_000
MAX_ASSET_TRIANGLES = 100_000
MAX_PACK_TRIANGLES = 250_000
MAX_IMAGE_SIDE = 2048
MAX_ASSET_TEXTURE_PIXELS = 16 * 1024 * 1024
MAX_PACK_TEXTURE_PIXELS = 32 * 1024 * 1024
MAX_COORDINATE = 10_000
READ_CHUNK = 64 * 1024
MAX_ZIP_METADATA_BYTES = 4096

_ID = re.compile(r"^[a-z0-9_-]{1,64}$")
_RESERVED = re.compile(r"^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$", re.IGNORECASE)
_COMPONENTS = {5120: (1, "b"), 5121: (1, "B"), 5122: (2, "h"), 5123: (2, "H"), 5125: (4, "I"), 5126: (4, "f")}
_TYPES = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
# Draco/Meshopt/Basis and imported lights need separate ownership/decoder contracts.
SUPPORTED_EXTENSIONS = frozenset({"KHR_materials_unlit", "KHR_texture_transform"})


class FurniturePackError(ValueError):
    """A readable validation failure with a stable code and exact input path."""

    def __init__(self, code: str, path: str, message: str) -> None:
        self.code = code
        self.path = path
        self.message = message
        super().__init__(f"{path}: {message}")


def _fail(code: str, path: str, message: str) -> None:
    raise FurniturePackError(code, path, message)


def _object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail("shape", path, "Expected an object.")
    return value


def _array(value: Any, path: str, maximum: int = MAX_JSON_VALUES) -> list[Any]:
    if not isinstance(value, list) or len(value) > maximum:
        _fail("shape", path, f"Expected an array with at most {maximum} entries.")
    return value


def _text(value: Any, path: str, maximum: int = 128) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(c) < 32 for c in value):
        _fail("text", path, f"Expected nonblank text, at most {maximum} characters, without control characters.")
    return value


def _id(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        _fail("identifier", path, "Use 1–64 lowercase letters, digits, underscores or hyphens.")
    return value


def _integer(value: Any, path: str, minimum: int = 0, maximum: int = MAX_EXPANDED_BYTES) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        _fail("integer", path, f"Expected an integer from {minimum} to {maximum}.")
    return value


def _number(value: Any, path: str, minimum: float = -MAX_COORDINATE, maximum: float = MAX_COORDINATE) -> float:
    if type(value) not in (int, float) or not minimum <= value <= maximum or not math.isfinite(value):
        _fail("number", path, f"Expected a finite number from {minimum} to {maximum}.")
    return value


def _vector(value: Any, size: int, path: str, minimum: float = -MAX_COORDINATE, maximum: float = MAX_COORDINATE) -> list[Any]:
    if not isinstance(value, list) or len(value) != size:
        _fail("vector", path, f"Expected exactly {size} numeric coordinates.")
    for index, number in enumerate(value):
        _number(number, f"{path}[{index}]", minimum, maximum)
    return value


def _index(value: Any, entries: list[Any], path: str) -> int:
    return _integer(value, path, 0, len(entries) - 1)


def _boolean(value: Any, path: str) -> None:
    if type(value) is not bool:
        _fail("boolean", path, "Expected true or false.")


def _json(data: bytes, path: str, maximum: int) -> dict[str, Any]:
    if len(data) > maximum:
        _fail("json_size", path, f"JSON exceeds {maximum} bytes.")

    def pairs(values: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in values:
            if key in result:
                _fail("duplicate_json_key", path, f"Duplicate JSON key: {key}.")
            result[key] = value
        return result

    def constant(value: str) -> None:
        _fail("json_number", path, f"Nonfinite JSON number {value} is not supported.")

    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
        if isinstance(error, FurniturePackError):
            raise
        _fail("json", path, "Expected bounded UTF-8 JSON.")
    pending = [(value, 0)]
    count = 0
    while pending:
        item, depth = pending.pop()
        count += 1
        if depth > MAX_JSON_DEPTH or count > MAX_JSON_VALUES:
            _fail("json_complexity", path, "JSON is too deeply nested or contains too many values.")
        if isinstance(item, dict):
            pending.extend((child, depth + 1) for child in (*item.keys(), *item.values()))
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
        elif isinstance(item, float) and not math.isfinite(item):
            _fail("json_number", path, "Nonfinite JSON numbers are not supported.")
        elif isinstance(item, str):
            try:
                item.encode("utf-8")
            except UnicodeEncodeError:
                _fail("json_text", path, "JSON strings must be valid Unicode text.")
    return _object(value, path)


def _portable_path(value: Any, path: str, *, directory: bool = False) -> str:
    if not isinstance(value, str) or not value or len(value) > MAX_PATH_LENGTH or unicodedata.normalize("NFC", value) != value:
        _fail("archive_path", path, "Expected a bounded portable relative path.")
    name = value[:-1] if directory and value.endswith("/") else value
    for part in name.split("/"):
        if not part or part in (".", "..") or len(part) > 120 or part[-1] in (".", " "):
            _fail("archive_path", path, "Empty, parent, trailing-space or trailing-dot paths are not portable.")
        if any(ord(c) < 32 or ord(c) == 127 or c in '\\:*?"<>|' for c in part) or _RESERVED.fullmatch(part.split(".")[0]):
            _fail("archive_path", path, "Absolute, reserved or platform-specific paths are not supported.")
    return value


def _zip_preflight(data: bytes) -> None:
    """Bound actual central records before ZipFile allocates ZipInfo objects.

    Small v1 packs do not need ZIP64, multidisk or executable-prefixed archives.
    Check actual records too: a forged small EOCD count must not bypass the cap.
    """
    end = data.rfind(b"PK\x05\x06", max(0, len(data) - 65_557))
    if end < 0 or end + 22 > len(data) or not data.startswith(b"PK\x03\x04"):
        _fail("archive_integrity", "pack", "Expected a standard, complete local ZIP archive.")
    disk, central_disk, disk_count, count, size, offset, comment = struct.unpack_from("<HHHHIIH", data, end + 4)
    if count > MAX_MEMBERS:
        _fail("member_budget", "pack", f"Use at most {MAX_MEMBERS} ZIP members.")
    if disk or central_disk or disk_count != count or not count or offset + size != end or end + 22 + comment != len(data):
        _fail("archive_integrity", "pack", "ZIP directory, disk count or final length is inconsistent.")
    if comment > MAX_ZIP_METADATA_BYTES:
        _fail("archive_format", "pack", "ZIP comments exceed the metadata budget.")
    actual = 0
    while offset < end:
        if offset + 46 > end or data[offset:offset + 4] != b"PK\x01\x02":
            _fail("archive_integrity", "pack", "Invalid ZIP central-directory framing.")
        name, extra, entry_comment = struct.unpack_from("<HHH", data, offset + 28)
        if not name or name > MAX_PATH_LENGTH * 4 or extra > MAX_ZIP_METADATA_BYTES or entry_comment > MAX_ZIP_METADATA_BYTES:
            _fail("archive_format", "pack", "ZIP member names or metadata exceed their budgets.")
        offset += 46 + name + extra + entry_comment
        actual += 1
        if actual > MAX_MEMBERS:
            _fail("member_budget", "pack", "Actual ZIP directory exceeds the member budget.")
        if offset > end:
            _fail("archive_integrity", "pack", "ZIP metadata is outside the central directory.")
    if actual != count:
        _fail("archive_integrity", "pack", "Actual ZIP member count does not match its declaration.")


def _image_size(data: bytes, mime: Any, path: str) -> tuple[int, int]:
    """Check bounded PNG/JPEG framing and dimensions; not a pixel decoder."""
    width = height = 0
    if mime == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        offset = 8
        ihdr = idat = ended = False
        while offset < len(data):
            if offset + 12 > len(data):
                _fail("image", path, "Truncated PNG chunk.")
            length, = struct.unpack_from(">I", data, offset)
            end = offset + 12 + length
            if end > len(data):
                _fail("image", path, "PNG chunk is outside its image buffer.")
            kind = data[offset + 4:offset + 8]
            body = data[offset + 8:end - 4]
            crc, = struct.unpack_from(">I", data, end - 4)
            if zlib.crc32(kind + body) & 0xFFFFFFFF != crc:
                _fail("image", path, "PNG chunk CRC does not match.")
            if not ihdr and kind != b"IHDR":
                _fail("image", path, "PNG must begin with IHDR.")
            if kind == b"IHDR":
                if ihdr or length != 13:
                    _fail("image", path, "Invalid PNG header.")
                width, height, depth, colour, compression, filtering, interlace = struct.unpack(">IIBBBBB", body)
                depths = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}
                if depth not in depths.get(colour, set()) or compression != 0 or filtering != 0 or interlace not in (0, 1):
                    _fail("image", path, "Unsupported PNG header values.")
                ihdr = True
            if kind == b"IDAT":
                idat = True
            if kind == b"IEND":
                if length or end != len(data) or not idat:
                    _fail("image", path, "Invalid PNG ending.")
                ended = True
            offset = end
        if not ihdr or not ended:
            _fail("image", path, "Incomplete PNG image.")
    elif mime == "image/jpeg" and data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9"):
        offset = 2
        frames = {0xC0, 0xC1, 0xC2}
        components: set[int] = set()
        saw_scan = False
        while offset + 4 <= len(data):
            if data[offset] != 0xFF:
                _fail("image", path, "Invalid JPEG marker framing.")
            while offset < len(data) and data[offset] == 0xFF:
                offset += 1
            if offset >= len(data):
                break
            marker = data[offset]
            offset += 1
            if marker == 0xD9:
                break
            if marker in (0x01, *range(0xD0, 0xD8)):
                continue
            if offset + 2 > len(data):
                _fail("image", path, "Truncated JPEG segment.")
            length, = struct.unpack_from(">H", data, offset)
            end = offset + length
            if length < 2 or end > len(data):
                _fail("image", path, "JPEG segment is outside its image buffer.")
            if marker in frames:
                if components or length < 8 or data[offset + 2] != 8:
                    _fail("image", path, "Unsupported JPEG frame.")
                height, width = struct.unpack_from(">HH", data, offset + 3)
                count = data[offset + 7]
                if not 1 <= count <= 4 or length != 8 + count * 3:
                    _fail("image", path, "JPEG frame components exceed their actual header.")
                for index in range(count):
                    component, sampling, table = data[offset + 8 + index * 3:offset + 11 + index * 3]
                    if component in components or not 1 <= sampling >> 4 <= 4 or not 1 <= sampling & 15 <= 4 or table > 3:
                        _fail("image", path, "Invalid JPEG frame component.")
                    components.add(component)
            elif marker in set(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}:
                _fail("image", path, "Unsupported JPEG coding frame.")
            elif marker == 0xDA:
                if not components or length < 6:
                    _fail("image", path, "JPEG scan needs a complete preceding frame.")
                count = data[offset + 2]
                if not 1 <= count <= len(components) or length != 6 + count * 2 or end >= len(data) - 2:
                    _fail("image", path, "JPEG scan header or data is outside its image buffer.")
                scan_components: set[int] = set()
                for index in range(count):
                    component, table = data[offset + 3 + index * 2:offset + 5 + index * 2]
                    if component not in components or component in scan_components or table >> 4 > 3 or table & 15 > 3:
                        _fail("image", path, "Invalid JPEG scan component.")
                    scan_components.add(component)
                saw_scan = True
                break
            offset = end
        if not width or not height or not saw_scan:
            _fail("image", path, "JPEG has no complete supported frame and scan.")
    else:
        _fail("image", path, "Use embedded PNG or JPEG images with their matching MIME type.")
    if not 1 <= width <= MAX_IMAGE_SIDE or not 1 <= height <= MAX_IMAGE_SIDE:
        _fail("image_budget", path, f"Image dimensions must be from 1 to {MAX_IMAGE_SIDE} pixels per side.")
    return width, height


def _read_member(data: bytes, info: zipfile.ZipInfo) -> bytes:
    """Verify actual output and deflate EOF, not ZipExtFile's truncated prefix.

    ZipExtFile stops at its declared file_size. A forged shorter size and matching
    prefix CRC can otherwise conceal more stored/deflated data. Each decode call
    is capped, and at most one excess byte is needed to reject a false size.
    """
    offset = info.header_offset
    if offset < 0 or offset + 30 > len(data) or data[offset:offset + 4] != b"PK\x03\x04":
        _fail("archive_integrity", info.filename, "Invalid local ZIP member header.")
    flags, compression = struct.unpack_from("<HH", data, offset + 6)
    crc, compressed, expanded = struct.unpack_from("<III", data, offset + 14)
    name, extra = struct.unpack_from("<HH", data, offset + 26)
    start = offset + 30 + name + extra
    end = start + info.compress_size
    if flags != info.flag_bits or compression != info.compress_type or name > MAX_PATH_LENGTH * 4 or extra > MAX_ZIP_METADATA_BYTES or end > len(data):
        _fail("archive_integrity", info.filename, "Local ZIP member metadata or compressed range is invalid.")
    if not flags & 8 and (crc, compressed, expanded) != (info.CRC, info.compress_size, info.file_size):
        _fail("archive_integrity", info.filename, "Local and central ZIP sizes or CRC disagree.")
    if compression == zipfile.ZIP_STORED:
        if info.compress_size != info.file_size:
            _fail("archive_integrity", info.filename, "Stored ZIP data must match its full declared size.")
        body = data[start:end]
        if zlib.crc32(body) & 0xFFFFFFFF != info.CRC:
            _fail("archive_integrity", info.filename, "Actual ZIP member CRC does not match.")
        return body
    decoder = zlib.decompressobj(-15)
    body = bytearray()
    actual_crc = 0
    while start < end:
        chunk = data[start:min(end, start + READ_CHUNK)]
        start += len(chunk)
        while chunk:
            output = decoder.decompress(chunk, min(READ_CHUNK, info.file_size - len(body) + 1))
            if len(body) + len(output) > info.file_size:
                _fail("archive_integrity", info.filename, "Actual ZIP output exceeds its declared size.")
            body.extend(output)
            actual_crc = zlib.crc32(output, actual_crc)
            chunk = decoder.unconsumed_tail
            if decoder.unused_data:
                _fail("archive_integrity", info.filename, "Trailing bytes follow the complete deflate stream.")
    if not decoder.eof or len(body) != info.file_size or actual_crc & 0xFFFFFFFF != info.CRC:
        _fail("archive_integrity", info.filename, "Complete ZIP output, length or CRC is invalid.")
    return bytes(body)


def validate_furniture_glb(data: bytes, path: str = "asset.glb") -> dict[str, Any]:
    """Return full SHA/stats for a bounded static GLB; keep caller bytes intact."""
    if not isinstance(data, bytes) or not 20 <= len(data) <= MAX_ASSET_BYTES:
        _fail("asset_size", path, f"Expected GLB bytes, from 20 to {MAX_ASSET_BYTES} bytes.")
    magic, version, declared = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or declared != len(data):
        _fail("glb_header", path, "Expected binary glTF 2 with its exact actual file length.")
    chunks: list[tuple[int, bytes]] = []
    offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            _fail("glb_chunk", path, "Truncated GLB chunk header.")
        length, kind = struct.unpack_from("<II", data, offset)
        end = offset + 8 + length
        if length % 4 or end > len(data):
            _fail("glb_chunk", path, "GLB chunks must be aligned and stay inside the file.")
        chunks.append((kind, data[offset + 8:end]))
        if len(chunks) > 2:
            _fail("glb_chunk", path, "Furniture v1 accepts at most one JSON and one BIN chunk.")
        offset = end
    if not chunks or chunks[0][0] != 0x4E4F534A or len(chunks) > 2 or len(chunks) == 2 and chunks[1][0] != 0x004E4942:
        _fail("glb_chunk", path, "Use one JSON chunk followed by at most one embedded BIN chunk.")
    gltf = _json(chunks[0][1], path + ":JSON", MAX_GLB_JSON_BYTES)
    asset = _object(gltf.get("asset"), path + ":asset")
    if asset.get("version") != "2.0" or "minVersion" in asset and asset["minVersion"] != "2.0":
        _fail("gltf_version", path, "Only glTF asset version 2.0 is supported.")
    # GLTFLoader uses these names as text. Unknown user extras remain untouched.
    for field in ("buffers", "bufferViews", "accessors", "nodes", "materials", "meshes", "images", "textures", "samplers", "scenes"):
        for i, raw in enumerate(_array(gltf.get(field, []), path + ":" + field)):
            if isinstance(raw, dict) and "name" in raw:
                name = raw["name"]
                if not isinstance(name, str) or len(name) > 512 or any(ord(c) < 32 for c in name):
                    _fail("gltf_name", f"{path}:{field}[{i}].name", "Model names must be bounded text without control characters.")
    for feature in ("animations", "skins", "cameras"):
        if _array(gltf.get(feature, []), path + ":" + feature):
            _fail("static_only", path + ":" + feature, "Furniture v1 accepts static meshes without animations, skins or cameras.")
    used = _array(gltf.get("extensionsUsed", []), path + ":extensionsUsed", 16)
    required = _array(gltf.get("extensionsRequired", []), path + ":extensionsRequired", 16)
    if any(not isinstance(name, str) or name not in SUPPORTED_EXTENSIONS for name in used + required) or len(set(used)) != len(used) or len(set(required)) != len(required) or not set(required).issubset(used):
        _fail("extension", path, "Unsupported or undeclared extension; use static baseline materials and embedded PNG/JPEG textures.")
    pending = [gltf]
    while pending:
        value = pending.pop()
        if isinstance(value, dict):
            if "extensions" in value:
                extensions = _object(value["extensions"], path + ":extensions")
                for name, extension in extensions.items():
                    if name not in SUPPORTED_EXTENSIONS or name not in used:
                        _fail("extension", path, f"Unsupported or undeclared extension {name}.")
                    _object(extension, path + ":" + name)
                    if name == "KHR_texture_transform":
                        for field in ("offset", "scale"):
                            if field in extension:
                                _vector(extension[field], 2, path + ":" + name + "." + field)
                        if "rotation" in extension:
                            _number(extension["rotation"], path + ":texture rotation")
                        if "texCoord" in extension:
                            _integer(extension["texCoord"], path + ":texture texCoord", 0, 7)
            pending.extend(child for key, child in value.items() if key != "extras")
        elif isinstance(value, list):
            pending.extend(value)
    bin_data = chunks[1][1] if len(chunks) == 2 else b""
    buffers = _array(gltf.get("buffers", []), path + ":buffers", 1)
    buffer_length = 0
    if buffers:
        buffer = _object(buffers[0], path + ":buffers[0]")
        if "uri" in buffer:
            _fail("external_resource", path, "Buffer URIs, including data URIs, are not accepted; embed the buffer in GLB.")
        buffer_length = _integer(buffer.get("byteLength"), path + ":buffer.byteLength")
        if not buffer_length <= len(bin_data) <= buffer_length + 3 or any(bin_data[buffer_length:]):
            _fail("buffer_bounds", path, "Embedded BIN length/padding does not match the declared buffer.")
    elif bin_data:
        _fail("buffer_bounds", path, "An embedded BIN must have its declared buffer.")
    views = _array(gltf.get("bufferViews", []), path + ":bufferViews", MAX_ACCESSORS + MAX_IMAGES)
    for i, raw in enumerate(views):
        view = _object(raw, f"{path}:bufferViews[{i}]")
        _index(view.get("buffer"), buffers, path + ":bufferView.buffer")
        start = _integer(view.get("byteOffset", 0), path + ":bufferView.byteOffset")
        length = _integer(view.get("byteLength"), path + ":bufferView.byteLength", 1)
        if start + length > buffer_length:
            _fail("buffer_bounds", path, "A buffer view is outside the embedded buffer.")
        if "byteStride" in view:
            stride = _integer(view["byteStride"], path + ":byteStride", 4, 252)
            if stride % 4:
                _fail("accessor_bounds", path, "Vertex byte stride must be a multiple of four.")
        if "target" in view and (type(view["target"]) is not int or view["target"] not in (34962, 34963)):
            _fail("buffer_target", path, "Unsupported buffer view target.")
    accessors = _array(gltf.get("accessors", []), path + ":accessors", MAX_ACCESSORS)
    readers: list[tuple[dict[str, Any], int, int, str]] = []
    accessor_values = 0
    for i, raw in enumerate(accessors):
        acc = _object(raw, f"{path}:accessors[{i}]")
        if "sparse" in acc:
            _fail("accessor", path, "Sparse accessors are not supported by furniture v1.")
        component, kind = acc.get("componentType"), acc.get("type")
        if type(component) is not int or component not in _COMPONENTS or not isinstance(kind, str) or kind not in _TYPES:
            _fail("accessor", path, "Unsupported static accessor component/type.")
        if "normalized" in acc:
            _boolean(acc["normalized"], path + ":normalized")
            if acc["normalized"] and component == 5126:
                _fail("accessor", path, "Float accessors cannot be normalized.")
        count = _integer(acc.get("count"), path + ":accessor.count", 1, MAX_ACCESSOR_COUNT)
        accessor_values += count * _TYPES[kind]
        if accessor_values > MAX_ACCESSOR_VALUES:
            _fail("accessor_budget", path, "Accessors exceed the total decoded-value work budget.")
        view = views[_index(acc.get("bufferView"), views, path + ":accessor.bufferView")]
        size, code = _COMPONENTS[component]
        element = size * _TYPES[kind]
        relative = _integer(acc.get("byteOffset", 0), path + ":accessor.byteOffset")
        stride = view.get("byteStride", element)
        start = view.get("byteOffset", 0) + relative
        if stride < element or start % size or relative % size or relative + (count - 1) * stride + element > view["byteLength"]:
            _fail("accessor_bounds", path, "Accessor alignment, stride or data range is invalid.")
        if stride != element and (relative % stride + element > stride or (relative // stride + count) * stride > view["byteLength"]):
            _fail("accessor_bounds", path, "Interleaved attributes need complete, noncrossing stride records for the model loader.")
        for field in ("min", "max"):
            if field in acc:
                _vector(acc[field], _TYPES[kind], path + ":accessor." + field, -3.5e38, 3.5e38)
        if "min" in acc and "max" in acc and any(a > b for a, b in zip(acc["min"], acc["max"], strict=True)):
            _fail("accessor_bounds", path, "Accessor minimum exceeds its maximum.")
        fmt = "<" + code * _TYPES[kind]
        readers.append((acc, start, stride, fmt))
        if component == 5126:
            for n in range(count):
                if not all(math.isfinite(value) for value in struct.unpack_from(fmt, bin_data, start + n * stride)):
                    _fail("accessor_number", path, "Accessor data contains nonfinite values.")
    images = _array(gltf.get("images", []), path + ":images", MAX_IMAGES)
    image_reports = []
    for i, raw in enumerate(images):
        image = _object(raw, f"{path}:images[{i}]")
        if "uri" in image:
            _fail("external_resource", path, "Image URIs are not accepted; embed PNG/JPEG bytes in the GLB.")
        view = views[_index(image.get("bufferView"), views, path + ":image.bufferView")]
        if "byteStride" in view or "target" in view:
            _fail("image", path, "Image buffer views must contain plain contiguous image bytes.")
        start = view.get("byteOffset", 0)
        width, height = _image_size(bin_data[start:start + view["byteLength"]], image.get("mimeType"), f"{path}:images[{i}]")
        image_reports.append({"width": width, "height": height, "mime_type": image["mimeType"]})
    pixels = sum(image["width"] * image["height"] for image in image_reports)
    if pixels > MAX_ASSET_TEXTURE_PIXELS:
        _fail("texture_budget", path, "Embedded images exceed the asset decoded-pixel budget.")
    samplers = _array(gltf.get("samplers", []), path + ":samplers", MAX_TEXTURES)
    for raw in samplers:
        sampler = _object(raw, path + ":sampler")
        for field, options in (("magFilter", (9728, 9729)), ("minFilter", (9728, 9729, 9984, 9985, 9986, 9987)), ("wrapS", (33071, 33648, 10497)), ("wrapT", (33071, 33648, 10497))):
            if field in sampler and (type(sampler[field]) is not int or sampler[field] not in options):
                _fail("sampler", path, "Unsupported texture sampler value.")
    textures = _array(gltf.get("textures", []), path + ":textures", MAX_TEXTURES)
    for raw in textures:
        texture = _object(raw, path + ":texture")
        _index(texture.get("source"), images, path + ":texture.source")
        if "sampler" in texture:
            _index(texture["sampler"], samplers, path + ":texture.sampler")
    materials = _array(gltf.get("materials", []), path + ":materials", MAX_MATERIALS)
    material_uvs: list[set[int]] = []
    for raw in materials:
        material = _object(raw, path + ":material")
        uvs: set[int] = set()
        pbr = _object(material.get("pbrMetallicRoughness", {}), path + ":pbrMetallicRoughness")
        if "baseColorFactor" in pbr:
            _vector(pbr["baseColorFactor"], 4, path + ":baseColorFactor", 0, 1)
        for field in ("metallicFactor", "roughnessFactor"):
            if field in pbr:
                _number(pbr[field], path + ":" + field, 0, 1)
        if "emissiveFactor" in material:
            _vector(material["emissiveFactor"], 3, path + ":emissiveFactor", 0, 1)
        if "doubleSided" in material:
            _boolean(material["doubleSided"], path + ":doubleSided")
        if "alphaMode" in material and material["alphaMode"] not in ("OPAQUE", "MASK", "BLEND"):
            _fail("material", path, "Unsupported alpha mode.")
        if "alphaCutoff" in material:
            _number(material["alphaCutoff"], path + ":alphaCutoff", 0, 1)
        for owner, fields in ((pbr, ("baseColorTexture", "metallicRoughnessTexture")), (material, ("normalTexture", "occlusionTexture", "emissiveTexture"))):
            for field in fields:
                if field not in owner:
                    continue
                info = _object(owner[field], path + ":" + field)
                _index(info.get("index"), textures, path + ":texture index")
                uv = _integer(info.get("texCoord", 0), path + ":texCoord", 0, 7)
                uv = info.get("extensions", {}).get("KHR_texture_transform", {}).get("texCoord", uv)
                uvs.add(uv)
                if "scale" in info:
                    _number(info["scale"], path + ":normal scale")
                if "strength" in info:
                    _number(info["strength"], path + ":occlusion strength", 0, 1)
        material_uvs.append(uvs)
    meshes = _array(gltf.get("meshes", []), path + ":meshes", MAX_MESHES)
    mesh_triangles = []
    primitive_count = 0
    source_triangle_count = 0
    checked_positions: set[int] = set()
    checked_indices: set[tuple[int, int]] = set()
    for raw in meshes:
        mesh = _object(raw, path + ":mesh")
        if "weights" in mesh:
            _fail("static_only", path, "Morph weights are not supported.")
        primitives = _array(mesh.get("primitives"), path + ":primitives", 32)
        if not primitives:
            _fail("mesh", path, "Furniture meshes need triangle primitives.")
        triangles = 0
        for raw_primitive in primitives:
            primitive = _object(raw_primitive, path + ":primitive")
            primitive_count += 1
            if primitive_count > MAX_PRIMITIVES:
                _fail("mesh_budget", path, "Too many mesh primitives.")
            if "targets" in primitive or primitive.get("mode", 4) != 4 or type(primitive.get("mode", 4)) is not int:
                _fail("static_only", path, "Use static triangle-list primitives without morph targets.")
            attributes = _object(primitive.get("attributes"), path + ":attributes")
            pos_index = _index(attributes.get("POSITION"), accessors, path + ":POSITION")
            pos = accessors[pos_index]
            if pos["componentType"] != 5126 or pos["type"] != "VEC3" or "min" not in pos or "max" not in pos:
                _fail("position", path, "POSITION needs float VEC3 data and finite minimum/maximum bounds.")
            for semantic, index in attributes.items():
                acc = accessors[_index(index, accessors, path + ":" + semantic)]
                if acc["count"] != pos["count"]:
                    _fail("accessor_bounds", path, "Vertex attributes must have the same count as POSITION.")
                if semantic.startswith(("JOINTS_", "WEIGHTS_")):
                    _fail("static_only", path, "Skinning attributes are not supported.")
                if semantic in ("NORMAL", "TANGENT") and (acc["componentType"] != 5126 or acc["type"] != ("VEC3" if semantic == "NORMAL" else "VEC4")):
                    _fail("attribute", path, "Normals/tangents need matching float vectors.")
                if semantic.startswith("TEXCOORD_") and (acc["type"] != "VEC2" or acc["componentType"] not in (5121, 5123, 5126) or acc["componentType"] != 5126 and acc.get("normalized") is not True):
                    _fail("attribute", path, "Texture coordinates need float or normalized unsigned VEC2 data.")
                if semantic.startswith("COLOR_") and (acc["type"] not in ("VEC3", "VEC4") or acc["componentType"] not in (5121, 5123, 5126) or acc["componentType"] != 5126 and acc.get("normalized") is not True):
                    _fail("attribute", path, "Vertex colours need float or normalized unsigned VEC3/VEC4 data.")
            if "material" in primitive:
                material_index = _index(primitive["material"], materials, path + ":material index")
                if any(f"TEXCOORD_{uv}" not in attributes for uv in material_uvs[material_index]):
                    _fail("texture_coordinates", path, "A textured material is missing its required vertex UV coordinates.")
            if pos_index not in checked_positions:
                acc, start, stride, fmt = readers[pos_index]
                for n in range(pos["count"]):
                    for axis, coordinate in enumerate(struct.unpack_from(fmt, bin_data, start + n * stride)):
                        if abs(coordinate) > MAX_COORDINATE or coordinate < pos["min"][axis] - .00001 * max(1, abs(coordinate)) or coordinate > pos["max"][axis] + .00001 * max(1, abs(coordinate)):
                            _fail("position_bounds", path, "Actual POSITION data is outside its declared bounds or coordinate budget.")
                checked_positions.add(pos_index)
            count = pos["count"]
            if "indices" in primitive:
                idx = _index(primitive["indices"], accessors, path + ":indices")
                acc, start, stride, fmt = readers[idx]
                if acc["type"] != "SCALAR" or acc["componentType"] not in (5121, 5123, 5125) or acc.get("normalized", False):
                    _fail("indices", path, "Indices need non-normalized unsigned scalar data.")
                count = acc["count"]
                if count > MAX_ASSET_TRIANGLES * 3:
                    _fail("triangle_budget", path, "Triangle indices exceed the asset budget.")
                if (idx, pos["count"]) not in checked_indices:
                    for n in range(count):
                        if struct.unpack_from(fmt, bin_data, start + n * stride)[0] >= pos["count"]:
                            _fail("indices", path, "A triangle index is outside POSITION data.")
                    checked_indices.add((idx, pos["count"]))
            if count % 3:
                _fail("triangles", path, "Triangle-list vertex/index count must be divisible by three.")
            triangles += count // 3
            source_triangle_count += count // 3
            if source_triangle_count > MAX_ASSET_TRIANGLES:
                _fail("triangle_budget", path, "Mesh primitives exceed the asset triangle budget.")
        mesh_triangles.append(triangles)
    nodes = _array(gltf.get("nodes", []), path + ":nodes", MAX_NODES)
    parents: dict[int, int] = {}
    for i, raw in enumerate(nodes):
        node = _object(raw, f"{path}:nodes[{i}]")
        if any(field in node for field in ("skin", "camera", "weights")):
            _fail("static_only", path, "Node skins, cameras and morph weights are not supported.")
        if "matrix" in node:
            _vector(node["matrix"], 16, path + ":matrix")
            if any(field in node for field in ("translation", "rotation", "scale")) or [node["matrix"][n] for n in (3, 7, 11, 15)] != [0, 0, 0, 1]:
                _fail("transform", path, "Use an affine matrix or TRS, not both.")
            # GLTFLoader decomposes a matrix into TRS. Zero-length columns cause
            # NaN quaternions, and shear/singular bases are not authored TRS.
            columns = [node["matrix"][start:start + 3] for start in (0, 4, 8)]
            lengths = [math.sqrt(sum(value * value for value in column)) for column in columns]
            if any(length == 0 for length in lengths):
                _fail("transform", path, "Matrix scale must decompose to finite nonzero axes.")
            for first, second in ((0, 1), (0, 2), (1, 2)):
                cosine = sum(a * b for a, b in zip(columns[first], columns[second], strict=True)) / lengths[first] / lengths[second]
                if abs(cosine) > .00001:
                    _fail("transform", path, "Matrix transforms must decompose to orthogonal translation/rotation/scale without shear.")
        for field, size in (("translation", 3), ("rotation", 4), ("scale", 3)):
            if field in node:
                _vector(node[field], size, path + ":" + field)
        if "rotation" in node and abs(sum(v * v for v in node["rotation"]) - 1) > .001:
            _fail("transform", path, "Quaternion rotations must have unit length.")
        if "scale" in node and any(value == 0 for value in node["scale"]):
            _fail("transform", path, "Node scale cannot be zero.")
        if "mesh" in node:
            _index(node["mesh"], meshes, path + ":node.mesh")
        child_list = _array(node.get("children", []), path + ":children", MAX_NODES)
        for child in child_list:
            _index(child, nodes, path + ":child")
            if child in parents:
                _fail("node_tree", path, "A node has multiple parents or repeated child links.")
            parents[child] = i
    for start in range(len(nodes)):
        visited: set[int] = set()
        current = start
        while current in parents:
            if current in visited:
                _fail("node_tree", path, "Cyclic node references are not supported.")
            visited.add(current)
            current = parents[current]
    scenes = _array(gltf.get("scenes"), path + ":scenes", 1)
    if len(scenes) != 1:
        _fail("scene", path, "Furniture v1 needs one explicit scene.")
    if "scene" in gltf:
        _index(gltf["scene"], scenes, path + ":scene")
    roots = _array(_object(scenes[0], path + ":scene").get("nodes"), path + ":scene.nodes", MAX_NODES)
    for root in roots:
        _index(root, nodes, path + ":scene root")
    if not roots or len(set(roots)) != len(roots):
        _fail("node_tree", path, "Scene roots must be nonempty and unique.")
    for root in roots:
        if root in parents:
            _fail("node_tree", path, "A scene root cannot also be another node's child.")
    triangles = mesh_uses = 0
    todo = roots.copy()
    while todo:
        node = nodes[todo.pop()]
        if "mesh" in node:
            mesh_uses += 1
            triangles += mesh_triangles[node["mesh"]]
        todo.extend(node.get("children", []))
    source_triangles = sum(mesh_triangles)
    if not mesh_uses or not triangles:
        _fail("mesh", path, "The selected scene must contain triangle geometry.")
    if triangles > MAX_ASSET_TRIANGLES or source_triangles > MAX_ASSET_TRIANGLES:
        _fail("triangle_budget", path, f"Asset exceeds {MAX_ASSET_TRIANGLES} triangles, including repeated mesh uses.")
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "stats": {
        "nodes": len(nodes), "meshes": len(meshes), "mesh_uses": mesh_uses, "primitives": primitive_count,
        "triangles": triangles, "source_triangles": source_triangles, "materials": len(materials),
        "textures": len(textures), "images": image_reports, "texture_pixels": pixels,
    }}


def validate_furniture_pack(data: bytes) -> dict[str, Any]:
    """Return raw manifest, per-entry licences/assets and full content hashes.

    sha256 hashes canonical manifest plus named licence/asset content hashes;
    ZIP timestamps/order/compression do not change this logical identity. Licence
    identity stays per entry even when asset bytes are shared. archive_sha256
    separately identifies the exact supplied archive. No returned bytes are saved.
    """
    if not isinstance(data, bytes) or not data or len(data) > MAX_ARCHIVE_BYTES:
        _fail("archive_size", "pack", f"Expected a ZIP no larger than {MAX_ARCHIVE_BYTES} bytes.")
    _zip_preflight(data)
    files: dict[str, bytes] = {}
    total = 0
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if not infos or len(infos) > MAX_MEMBERS:
                _fail("member_budget", "pack", f"Use 1–{MAX_MEMBERS} ZIP members.")
            names: set[str] = set()
            file_names: set[str] = set()
            for info in infos:
                name = _portable_path(info.orig_filename, "pack member", directory=info.is_dir())
                folded = name.rstrip("/").casefold()
                if name != info.filename or folded in names:
                    _fail("duplicate_path", name, "Duplicate, case-folding or truncated ZIP paths are not supported.")
                names.add(folded)
                if not info.is_dir():
                    file_names.add(folded)
                if info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    _fail("archive_format", name, "Encrypted or nonstandard-compression ZIP members are not supported.")
                kind = stat.S_IFMT(info.external_attr >> 16)
                if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or kind == stat.S_IFDIR and not info.is_dir() or info.is_dir() and kind not in (0, stat.S_IFDIR):
                    _fail("archive_type", name, "Symlinks, devices and inconsistent directories are not supported.")
                if info.is_dir() and (info.file_size or info.CRC):
                    _fail("archive_type", name, "Directory entries must be empty with an empty CRC.")
                if info.file_size > MAX_ASSET_BYTES:
                    _fail("file_budget", name, f"A member exceeds {MAX_ASSET_BYTES} bytes.")
                total += info.file_size
                if total > MAX_EXPANDED_BYTES:
                    _fail("expanded_budget", "pack", "Expanded archive exceeds the total byte budget.")
                if info.compress_size > len(data):
                    _fail("archive_integrity", name, "A compressed member is outside the actual archive.")
            for name in names:
                parts = name.split("/")
                if any("/".join(parts[:index]) in file_names for index in range(1, len(parts))):
                    _fail("archive_path", name, "A file cannot also be a parent directory.")
            for info in infos:
                # ZipFile checks matching names and overlapping member framing;
                # our reader additionally checks full bounded output and EOF.
                with archive.open(info):
                    body = _read_member(data, info)
                if not info.is_dir():
                    files[info.filename] = body
    except (zipfile.BadZipFile, UnicodeDecodeError, OSError, RuntimeError, NotImplementedError, EOFError, zlib.error):
        _fail("archive_integrity", "pack", "ZIP data, member framing or CRC is invalid.")
    if "pack.json" not in files:
        _fail("manifest", "pack", "The archive needs pack.json at its root.")
    manifest = _json(files["pack.json"], "pack.json", MAX_MANIFEST_BYTES)
    if type(manifest.get("version")) is not int or manifest["version"] != 1:
        _fail("manifest_version", "pack.json", "Only furniture manifest version 1 is supported.")
    _id(manifest.get("id"), "pack.id")
    _text(manifest.get("name"), "pack.name")
    _text(manifest.get("author"), "pack.author", 256)
    referenced = {"pack.json"}
    licences: dict[str, dict[str, Any]] = {}

    def licence(raw: Any, path: str) -> dict[str, Any]:
        value = _object(raw, path)
        _text(value.get("id"), path + ".id")
        name = _portable_path(value.get("file"), path + ".file")
        if name == "pack.json" or name.lower().endswith(".glb"):
            _fail("license", path, "Use a separate licence text file, not the manifest or geometry bytes.")
        if name not in files or not 1 <= len(files[name]) <= MAX_LICENSE_BYTES:
            _fail("license", path, "Provide a bounded licence text file in the archive.")
        try:
            text = files[name].decode("utf-8")
        except UnicodeDecodeError:
            _fail("license", path, "Licence text must be UTF-8.")
        if not text.strip() or "\x00" in text:
            _fail("license", path, "Licence text must be nonblank and contain no NUL characters.")
        referenced.add(name)
        report = {"id": value["id"], "file": name, "text": text, "sha256": hashlib.sha256(files[name]).hexdigest()}
        licences[name] = report
        return report

    pack_licence = licence(manifest.get("license"), "pack.license")
    items = _array(manifest.get("items"), "pack.items", MAX_ITEMS)
    if not items:
        _fail("items", "pack.items", "A pack needs at least one furniture item.")
    ids: set[str] = set()
    asset_reports: dict[str, dict[str, Any]] = {}
    reports = []
    for index, raw in enumerate(items):
        item = _object(raw, f"pack.items[{index}]")
        item_id = _id(item.get("id"), f"pack.items[{index}].id")
        if item_id in ids:
            _fail("duplicate_item", "pack.items", "Furniture item IDs must be unique.")
        ids.add(item_id)
        _text(item.get("name"), f"pack.items[{index}].name")
        if item.get("unit") != "m":
            _fail("unit", f"pack.items[{index}].unit", "Declare metre units exactly as m; this declaration is not a scale measurement.")
        _vector(item.get("anchor"), 3, f"pack.items[{index}].anchor")
        name = _portable_path(item.get("file"), f"pack.items[{index}].file")
        if not name.lower().endswith(".glb") or name not in files:
            _fail("asset", name, "Provide the exact named .glb file inside the archive.")
        referenced.add(name)
        digest = hashlib.sha256(files[name]).hexdigest()
        if digest not in asset_reports:
            asset_reports[digest] = {**validate_furniture_glb(files[name], name), "data": files[name]}
        reports.append({"id": item_id, "name": item["name"], "file": name, "unit": "m", "anchor": item["anchor"].copy(),
                        "sha256": digest, "data": files[name], "stats": asset_reports[digest]["stats"],
                        "license": licence(item["license"], f"pack.items[{index}].license") if "license" in item else pack_licence.copy()})
    if set(files) != referenced:
        _fail("unreferenced_file", "pack", "Every file must be pack.json, a declared GLB or a declared licence file.")
    triangles = sum(report["stats"]["triangles"] for report in asset_reports.values())
    pixels = sum(report["stats"]["texture_pixels"] for report in asset_reports.values())
    if triangles > MAX_PACK_TRIANGLES or pixels > MAX_PACK_TEXTURE_PIXELS:
        _fail("pack_budget", "pack", "Unique assets exceed the pack triangle/decoded-texture budget.")
    canonical = json.dumps({"manifest": manifest, "files": {name: hashlib.sha256(body).hexdigest() for name, body in sorted(files.items()) if name != "pack.json"}},
                           ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {"manifest": manifest, "sha256": hashlib.sha256(canonical).hexdigest(), "archive_sha256": hashlib.sha256(data).hexdigest(),
            "license": pack_licence, "licenses": licences, "items": reports, "assets": asset_reports,
            "stats": {"archive_bytes": len(data), "expanded_bytes": total, "members": len(infos), "items": len(items),
                      "unique_assets": len(asset_reports), "asset_bytes": sum(report["bytes"] for report in asset_reports.values()),
                      "triangles": triangles, "texture_pixels": pixels}}
