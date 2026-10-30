#!/usr/bin/env python3
"""Package a Clam book's continuous audio as HLS fMP4 for lock-screen playback."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path


def build(book_dir: Path, ffmpeg: str, force: bool) -> bool:
    meta_path = book_dir / "metadata.json"
    try:
        meta = json.loads(meta_path.read_text())
    except Exception as exc:
        print(f"skip {book_dir}: {exc}")
        return False
    if not meta.get("chapters"):
        return False
    source_name = str(meta.get("continuous_file") or "book.m4b")
    source = (book_dir / source_name).resolve()
    if book_dir.resolve() not in source.parents or not source.is_file():
        print(f"skip {book_dir}: missing {source}")
        return False
    output = book_dir / "hls"
    if output.exists() and not force:
        print(f"exists {output}")
        return False
    temp = book_dir / ".hls.tmp"
    if temp.exists():
        shutil.rmtree(temp)
    temp.mkdir()
    try:
        subprocess.run(
            [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(source),
                "-map", "0:a:0",
                "-c:a", "copy",
                "-f", "hls",
                "-hls_time", "6",
                "-hls_playlist_type", "vod",
                "-hls_segment_type", "fmp4",
                "-hls_fmp4_init_filename", "init.mp4",
                "-hls_segment_filename", str(temp / "segment%05d.m4s"),
                str(temp / "book.m3u8"),
            ],
            check=True,
        )
        playlist = temp / "book.m3u8"
        if not playlist.is_file() or not any(temp.glob("*.m4s")):
            raise RuntimeError("ffmpeg produced no HLS segments")
        if output.exists():
            shutil.rmtree(output)
        temp.rename(output)
    except Exception as exc:
        print(f"failed {book_dir}: {exc}")
        shutil.rmtree(temp, ignore_errors=True)
        return False
    meta["hls_file"] = "hls/book.m3u8"
    tmp = meta_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, meta_path)
    print(f"built {output} ({sum(p.stat().st_size for p in output.iterdir())} bytes)")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--library", default=os.environ.get("SHELF_LIBRARY", "library"))
    parser.add_argument("--book")
    parser.add_argument("--ffmpeg", default=os.environ.get("SHELF_FFMPEG", "ffmpeg"))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    root = Path(args.library).expanduser().resolve()
    if args.book:
        target = Path(args.book).expanduser().resolve()
        print("ok" if build(target, args.ffmpeg, args.force) else "skipped")
        return
    for meta in sorted(root.rglob("metadata.json")):
        build(meta.parent, args.ffmpeg, args.force)


if __name__ == "__main__":
    main()
