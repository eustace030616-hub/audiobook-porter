#!/usr/bin/env python3
"""Split one book into one small M4B per chapter.

The source M4B's chapter offsets are used; audio is copied, not re-encoded.
Each output is written with +faststart so the browser can start immediately.
The original full-file M4B is removed only after every chapter file has been
probed successfully and metadata.json has been updated.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path


def run(command):
    subprocess.run(command, check=True)


def duration_ms(path: Path, ffprobe: str) -> int:
    completed = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return round(float(completed.stdout.strip()) * 1000)


def probe_chapters(path: Path, ffprobe: str):
    completed = subprocess.run(
        [ffprobe, "-v", "error", "-print_format", "json", "-show_chapters", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    data = json.loads(completed.stdout or "{}")
    return [
        {
            "title": chapter.get("tags", {}).get("title") or f"Chapter {index + 1}",
            "start": round(float(chapter.get("start_time") or 0) * 1000),
            "end": round(float(chapter.get("end_time") or 0) * 1000),
        }
        for index, chapter in enumerate(data.get("chapters") or [])
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--library", required=True, help="library root")
    parser.add_argument("--book", required=True, help="book folder containing metadata.json")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--keep-source", action="store_true")
    args = parser.parse_args()

    library = Path(args.library).resolve()
    book_dir = Path(args.book).resolve()
    metadata_path = book_dir / "metadata.json"
    meta = json.loads(metadata_path.read_text(encoding="utf-8"))
    chapters = meta.get("chapters") or []
    if chapters and all(chapter.get("file") for chapter in chapters):
        print("already split")
        return 0

    audio_files = sorted(
        path for path in book_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".m4b", ".m4a", ".mp3"}
    )
    if not audio_files:
        raise SystemExit("no full-book .m4b/.m4a/.mp3 found")
    if len(audio_files) > 1:
        raise SystemExit("multiple source audio files found; refusing to guess which one is the book")
    source = audio_files[0]
    if not chapters:
        chapters = probe_chapters(source, args.ffprobe)
        if not chapters:
            raise SystemExit("no chapters in metadata.json or embedded in the source")
        print(f"using {len(chapters)} embedded chapters from {source.name}")
    if not args.keep_source and any((book_dir / chapter["file"]).exists() for chapter in chapters if chapter.get("file")):
        raise SystemExit("chapter files exist but metadata is not marked split; refusing to overwrite")

    relative_audio = source.relative_to(library).as_posix()
    book_id = meta.get("id") or hashlib.sha1(relative_audio.encode("utf-8")).hexdigest()[:12]
    total = len(chapters)
    out_dir = book_dir / "chapters"
    out_dir.mkdir(parents=True, exist_ok=True)
    output_extension = ".mp3" if source.suffix.lower() == ".mp3" else ".m4b"

    title = meta.get("title") or book_dir.name
    artist = ", ".join(meta.get("authors") or [])
    album = title

    prepared = []
    for index, chapter in enumerate(chapters, start=1):
        start_ms = max(0, int(chapter.get("start") or 0))
        end_ms = int(chapter.get("end") or 0)
        if end_ms <= start_ms:
            if index < total:
                end_ms = int(chapters[index].get("start") or start_ms)
            else:
                end_ms = int(meta.get("duration_ms") or (start_ms + 1))
        length = max(1, end_ms - start_ms)
        out = out_dir / f"{index:02d}{output_extension}"
        print(f"[{index:02d}/{total}] {chapter.get('title')} · {length / 1000:.1f}s", flush=True)
        command = [
            args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{start_ms / 1000:.3f}",
            "-i", str(source),
            "-t", f"{length / 1000:.3f}",
            "-map", "0:a:0",
            "-c:a", "copy",
            "-map_metadata", "-1",
            "-metadata", f"title={chapter.get('title') or f'Chapter {index}'}",
            "-metadata", f"album={album}",
            "-metadata", f"artist={artist}",
            "-metadata", f"track={index}/{total}",
        ]
        if output_extension == ".mp3":
            command.extend(["-id3v2_version", "3", "-f", "mp3"])
        else:
            command.extend(["-movflags", "+faststart", "-f", "ipod"])
        command.append(str(out))
        run(command)
        actual = duration_ms(out, args.ffprobe)
        if actual <= 0:
            raise SystemExit(f"chapter {index} has no duration")
        prepared.append({
            "title": chapter.get("title") or f"Chapter {index}",
            "start": start_ms,
            "end": end_ms,
            "duration_ms": actual,
            "file": out.relative_to(book_dir).as_posix(),
        })

    meta["id"] = book_id
    meta["split"] = True
    meta["chapters"] = prepared
    temporary = metadata_path.with_name(f".{metadata_path.name}.tmp")
    temporary.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, metadata_path)

    verified = 0
    for chapter in prepared:
        path = book_dir / chapter["file"]
        if path.is_file() and duration_ms(path, args.ffprobe) > 0:
            verified += 1
    if verified != total:
        raise SystemExit(f"only {verified}/{total} chapter files verified; keeping source")

    if not args.keep_source:
        source.unlink()
        print(f"removed full source: {source.name}")

    print(f"split complete: {total} chapters · id {book_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
