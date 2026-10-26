#!/usr/bin/env python3
"""Build one continuous M4B per split book, without re-encoding.

iOS suspends JavaScript at a locked screen. A chapter transition driven by the
`ended` event therefore does not run until the phone is unlocked. A single
continuous file is handled by the OS media stack, so chapters keep playing.

The split files stay in place: the old client still uses them. The new client
uses `continuousUrl` from the API and maps the existing chapter start/end times
onto the one file.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path


def ffconcat_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def build(meta_path: Path, ffmpeg: str, force: bool) -> bool:
    try:
        meta = json.loads(meta_path.read_text())
    except Exception as exc:
        print(f"skip {meta_path}: {exc}")
        return False
    chapters = meta.get("chapters") or []
    if not chapters or not all(chapter.get("file") for chapter in chapters):
        return False

    root = meta_path.parent
    name = str(meta.get("continuous_file") or "book.m4b")
    output = (root / name).resolve()
    if root.resolve() not in output.parents:
        print(f"skip {meta_path}: output escapes the book directory")
        return False
    if output.exists() and not force:
        print(f"exists {output}")
        return False

    files = []
    for chapter in chapters:
        candidate = (root / str(chapter["file"])).resolve()
        if root.resolve() not in candidate.parents or not candidate.is_file():
            print(f"skip {meta_path}: missing {candidate}")
            return False
        files.append(candidate)

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as handle:
        list_path = Path(handle.name)
        for file in files:
            handle.write(f"file {ffconcat_quote(str(file))}\n")
    try:
        subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_path),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(output),
            ],
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        print(f"failed {meta_path}: {exc}")
        output.unlink(missing_ok=True)
        return False
    finally:
        list_path.unlink(missing_ok=True)

    meta["continuous_file"] = name
    tmp = meta_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, meta_path)
    print(f"built {output} ({output.stat().st_size} bytes)")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--library", default=os.environ.get("SHELF_LIBRARY", "library"))
    parser.add_argument("--ffmpeg", default=os.environ.get("SHELF_FFMPEG", "ffmpeg"))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = Path(args.library).expanduser().resolve()
    built = 0
    for meta_path in sorted(root.rglob("metadata.json")):
        if build(meta_path, args.ffmpeg, args.force):
            built += 1
    print(f"built {built} continuous file(s)")


if __name__ == "__main__":
    main()
