#!/usr/bin/env python3
"""Make one local, static, explicitly licensed furniture ZIP without conversion.

The repository's pure validator checks the complete generated archive before any
output is created. Original GLB/licence bytes are preserved. No HA imports,
network requests, extraction, deletion, file scanning or overwrite are performed.
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
from typing import Any, Sequence
import zipfile


VALIDATOR_PATH = Path(__file__).resolve().parents[1] / "custom_components" / "taylors3d" / "furniture_pack.py"
_SPEC = importlib.util.spec_from_file_location("taylors3d_local_pack_validator", VALIDATOR_PATH)
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError("The local Taylor's 3D furniture validator is missing.")
validator = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(validator)


class PackCreationError(ValueError):
    """A readable local input/output error; validation errors retain their path."""


def _read_file(filename: str | Path, maximum: int, label: str) -> bytes:
    """Bound actual bytes, not only a potentially changing filesystem size."""
    path = Path(filename)
    try:
        # On POSIX, NONBLOCK also prevents an explicitly supplied FIFO from
        # blocking before its non-regular type can be rejected. Windows has no
        # equivalent flag; ordinary local files are the only supported inputs.
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(descriptor, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise PackCreationError(f"{label}: choose one ordinary local file.")
            if info.st_size > maximum:
                raise PackCreationError(f"{label}: exceeds the {maximum:,}-byte input limit.")
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = source.read(min(64 * 1024, maximum - total + 1))
                if not chunk:
                    break
                total += len(chunk)
                if total > maximum:
                    raise PackCreationError(f"{label}: exceeds the {maximum:,}-byte input limit.")
                chunks.append(chunk)
            return b"".join(chunks)
    except OSError as error:
        raise PackCreationError(f"{label}: could not read the supplied local file ({error.strerror or type(error).__name__}).") from error


def _identity(value: str, label: str) -> None:
    if not isinstance(value, str) or re.fullmatch(r"[a-z0-9_-]{1,64}", value) is None:
        raise PackCreationError(f"{label}: use 1–64 lowercase letters, digits, underscores or hyphens.")


def _member(container: zipfile.ZipFile, name: str, original: bytes) -> None:
    # Canonical paths and a fixed timestamp make repeated identical inputs
    # reproducible. Nothing uses the original user's filename as a ZIP path.
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    info.compress_type = zipfile.ZIP_STORED
    container.writestr(info, original)


def create_furniture_pack(
    *,
    glb: str | Path,
    license_file: str | Path,
    output: str | Path,
    pack_id: str,
    pack_name: str,
    item_id: str,
    item_name: str,
    author: str,
    license_id: str,
    unit: str,
    anchor: Sequence[float] = (0, 0, 0),
) -> dict[str, Any]:
    """Validate a one-item ZIP, then create it exclusively (never overwrite).

    ``unit='m'`` is a caller declaration, not scale measurement or conversion.
    The return value contains identities and metadata, never original asset bytes.
    Existing files, including inputs/symlink aliases, are never modified.
    """
    _identity(pack_id, "Pack ID")
    _identity(item_id, "Item ID")
    if unit != "m":
        raise PackCreationError("Units: explicitly declare metres with --unit m. This tool cannot infer or convert the model's physical scale.")
    if not isinstance(anchor, (list, tuple)) or len(anchor) != 3 or any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in anchor
    ):
        raise PackCreationError("Anchor: supply three finite numbers in the original model's declared metre coordinates.")
    path = Path(output)
    if path.suffix.lower() != ".zip":
        raise PackCreationError("Output: choose a new filename ending in .zip.")
    if os.path.lexists(path):
        raise PackCreationError("Output already exists. Choose a different ZIP filename; this tool never overwrites files.")
    asset = _read_file(glb, validator.MAX_ASSET_BYTES, "GLB")
    licence = _read_file(license_file, validator.MAX_LICENSE_BYTES, "Licence")
    manifest = {
        "version": 1,
        "id": pack_id,
        "name": pack_name,
        "author": author,
        "license": {"id": license_id, "file": "LICENSE.txt"},
        "items": [{"id": item_id, "name": item_name, "file": f"assets/{item_id}.glb", "unit": "m", "anchor": list(anchor)}],
    }
    try:
        metadata = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeError) as error:
        raise PackCreationError("Metadata: supply valid UTF-8 text and finite JSON values.") from error
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as container:
        _member(container, "pack.json", metadata)
        _member(container, "LICENSE.txt", licence)
        _member(container, f"assets/{item_id}.glb", asset)
    original = archive.getvalue()
    # Every format/budget/licence/static-GLB failure happens before output open.
    report = validator.validate_furniture_pack(original)
    try:
        with path.open("xb") as destination:
            destination.write(original)
    except FileExistsError as error:
        # Covers a concurrent creator or dangling symlink after the preflight.
        raise PackCreationError("Output already exists. Choose a different ZIP filename; this tool never overwrites files.") from error
    except OSError as error:
        raise PackCreationError(f"Output: could not write the new ZIP ({error.strerror or type(error).__name__}).") from error
    return {"output": str(path), "pack_id": report["archive_sha256"], "logical_sha256": report["sha256"],
            "asset_sha256": report["items"][0]["sha256"], "bytes": len(original), "manifest": report["manifest"]}


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Create one locally licensed static furniture ZIP. Original GLB and UTF-8 licence bytes are kept; no conversion or overwrite.")
    result.add_argument("--glb", required=True, type=Path, help="One existing compatible static .glb model")
    result.add_argument("--license", required=True, type=Path, dest="license_file", help="The complete original UTF-8 licence file")
    result.add_argument("--output", required=True, type=Path, help="A NEW local .zip filename")
    result.add_argument("--pack-id", required=True, help="Your lowercase pack ID, such as my-chair-pack")
    result.add_argument("--pack-name", required=True, help="Your readable pack name")
    result.add_argument("--item-id", required=True, help="Your lowercase item ID, such as chair")
    result.add_argument("--item-name", required=True, help="Your readable item name")
    result.add_argument("--author", required=True, help="The actual supplied author/credit")
    result.add_argument("--license-id", required=True, help="The supplied licence identifier, such as MIT")
    result.add_argument("--unit", required=True, choices=("m",), help="Explicitly declare the model uses metres; the tool does not measure or convert scale")
    result.add_argument("--anchor", nargs=3, type=float, default=(0, 0, 0), metavar=("X", "Y", "Z"), help="Optional original model anchor, default 0 0 0")
    return result


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        result = create_furniture_pack(**vars(args))
    except (PackCreationError, validator.FurniturePackError) as error:
        print(f"Could not create furniture ZIP: {error}", file=sys.stderr)
        return 1
    print(f"Created validated ZIP: {result['output']}")
    print(f"Original ZIP SHA256: {result['pack_id']}")
    print(f"Original GLB SHA256: {result['asset_sha256']}")
    print("Metres are your declaration; the model and licence were not changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
