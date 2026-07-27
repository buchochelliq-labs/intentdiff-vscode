"""Validate release media proof manifest metadata and screenshot dimensions."""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path
from typing import Any


REQUIRED_SURFACES = [
    "dashboard",
    "review",
    "intent",
    "risk",
    "evidence",
    "notes",
    "release-notes",
    "binary-image",
    "schema",
    "guardrails",
    "language-sweep",
    "narrow",
    "light-theme",
]

ALLOWED_STATUSES = {"approved", "needs_polish", "post_beta"}


def parse_capture_region(value: str) -> tuple[int, int] | None:
    if not value or value == "full-desktop":
        return None
    parts = [part.strip() for part in value.split(",")]
    if len(parts) != 4:
        raise ValueError(f"Visual proof manifest has invalid capture_region '{value}'.")
    try:
        _, _, width, height = map(int, parts)
    except ValueError as exc:
        raise ValueError(f"Visual proof manifest has invalid capture_region '{value}'.") from exc
    if width <= 0 or height <= 0:
        raise ValueError(f"Visual proof manifest has invalid capture_region '{value}'.")
    return width, height


def expected_dimensions(surface: str) -> tuple[int, int]:
    if surface == "narrow":
        return 760, 720
    return 1280, 720


def assert_dimensions(surface: str, width: int, height: int) -> None:
    expected_width, expected_height = expected_dimensions(surface)
    if width != expected_width or height != expected_height:
        raise AssertionError(
            f"Visual proof surface '{surface}' has unexpected dimensions "
            f"{width}x{height}; expected {expected_width}x{expected_height}."
        )


def parse_png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if len(data) < 24:
        raise ValueError(f"Visual proof surface screenshot is too small to parse PNG dimensions: {path}")
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Visual proof manifest expected screenshot file to be PNG: {path}")
    if data[12:16] != b"IHDR":
        raise ValueError(f"Visual proof manifest expected PNG IHDR chunk in: {path}")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def read_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Visual proof manifest not found: {path}")
    payload = path.read_text(encoding="utf-8-sig")
    if not payload.strip():
        raise ValueError(f"Visual proof manifest is empty: {path}")
    return json.loads(payload)


def resolve_screenshot_path(manifest_dir: Path, screenshot_path: str) -> Path:
    raw = Path(screenshot_path)
    if raw.is_absolute():
        return raw
    return manifest_dir / raw


def validate_manifest(
    manifest_path: Path,
    *,
    require_all_surfaces: bool = True,
    require_approved_required_surfaces: bool = True,
) -> int:
    manifest = read_manifest(manifest_path)
    screenshots = manifest.get("screenshots")
    if not isinstance(screenshots, list) or not screenshots:
        raise AssertionError(f"Visual proof manifest has no screenshots: {manifest_path}")

    seen: set[str] = set()
    for entry in screenshots:
        if not isinstance(entry, dict):
            raise TypeError("Visual proof manifest entries must be objects.")

        surface = entry.get("surface")
        if not surface:
            raise AssertionError("Visual proof manifest contains an entry without a surface.")
        if surface in seen:
            raise AssertionError(f"Visual proof manifest has duplicate surface entry: {surface}")
        seen.add(surface)

        status = entry.get("status")
        if status not in ALLOWED_STATUSES:
            raise AssertionError(
                f"Visual proof surface '{surface}' has invalid status '{status}'."
            )
        if (
            require_approved_required_surfaces
            and surface in REQUIRED_SURFACES
            and status != "approved"
        ):
            raise AssertionError(
                f"Visual proof surface '{surface}' must be approved for RC release; "
                f"found '{status}'."
            )

        screenshot_path = entry.get("screenshot_path")
        if not screenshot_path:
            raise AssertionError(f"Visual proof surface '{surface}' has no screenshot_path.")

        full_screenshot_path = resolve_screenshot_path(manifest_path.parent, str(screenshot_path))
        if not full_screenshot_path.exists():
            raise AssertionError(
                f"Visual proof surface '{surface}' references missing screenshot: {full_screenshot_path}"
            )

        capture_region = entry.get("capture_region")
        if not capture_region:
            raise AssertionError(f"Visual proof surface '{surface}' has no capture_region.")

        capture_command = entry.get("capture_command")
        if not capture_command:
            raise AssertionError(f"Visual proof surface '{surface}' has no capture_command.")
        if f"-Scene {surface} " not in str(capture_command) and f'-Scene "{surface}" ' not in str(capture_command):
            raise AssertionError(
                f"Visual proof surface '{surface}' capture_command does not match the surface."
            )

        captured_width = entry.get("captured_width")
        captured_height = entry.get("captured_height")
        if not isinstance(captured_width, int) or captured_width <= 0:
            raise AssertionError(
                f"Visual proof surface '{surface}' has invalid captured_width '{captured_width}'."
            )
        if not isinstance(captured_height, int) or captured_height <= 0:
            raise AssertionError(
                f"Visual proof surface '{surface}' has invalid captured_height '{captured_height}'."
            )

        filename = full_screenshot_path.name
        expected_prefix = f"intentdiff-vscode-{surface}"
        if not filename.startswith(expected_prefix) or not filename.lower().endswith(".png"):
            raise AssertionError(
                f"Visual proof surface '{surface}' has unexpected screenshot filename '{filename}'."
            )

        assert_dimensions(surface, int(captured_width), int(captured_height))

        parsed_region = parse_capture_region(str(capture_region))
        if parsed_region is not None:
            assert_dimensions(surface, parsed_region[0], parsed_region[1])

        image_dimensions = parse_png_dimensions(full_screenshot_path)
        assert_dimensions(surface, image_dimensions[0], image_dimensions[1])

    missing = [surface for surface in REQUIRED_SURFACES if surface not in seen]
    if require_all_surfaces and missing:
        raise AssertionError(
            f"Visual proof manifest is missing required surfaces: {', '.join(missing)}"
        )
    return len(seen)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "manifest",
        nargs="?",
        default="release-media/manifest.json",
        help="Path to the release media manifest JSON.",
    )
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Validate only the surfaces present in the manifest; useful for ad-hoc UX smoke captures.",
    )
    parser.add_argument(
        "--allow-unapproved-required",
        action="store_true",
        help="Allow required surfaces to remain needs_polish/post_beta; only for pre-RC review.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    manifest_path = Path(args.manifest)
    surface_count = validate_manifest(
        manifest_path,
        require_all_surfaces=not args.allow_partial,
        require_approved_required_surfaces=not args.allow_unapproved_required,
    )
    print("Visual proof manifest is valid:")
    print(f"  {manifest_path}")
    print(f"  surfaces: {surface_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
