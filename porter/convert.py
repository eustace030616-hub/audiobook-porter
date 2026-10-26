"""Convert an Audible download into the one-file-per-book library tree."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .audible import find_audio, find_chapter_file, find_cover, find_voucher
from .metadata import (
    author_folder,
    book_folder,
    chapters_from_ffprobe,
    ffmetadata,
    normalize,
    parse_chapters,
    source_metadata_from_ffprobe,
    write_sidecars,
)
from .util import (
    PorterError,
    atomic_copy,
    atomic_write,
    ensure_dir,
    human_duration,
    redact,
    require,
    run,
    sha1_text,
)


BUILD_VERSION = "4"


def ffprobe_json(path: Path, decrypt: Optional[List[str]] = None) -> Dict:
    ffprobe = require("ffprobe", "Install ffmpeg.")
    command = [ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters"]
    command.extend(decrypt or [])
    command.extend(["-i", str(path)])
    completed = run(command, check=False, capture=True, display=f"ffprobe {path.name}")
    if completed.returncode != 0:
        raise PorterError(redact((completed.stderr or "ffprobe failed").strip(), decrypt or []))
    try:
        return json.loads(completed.stdout or "{}")
    except json.JSONDecodeError as error:
        raise PorterError(f"ffprobe returned invalid JSON for {path.name}") from error


def _recursive_find(node, wanted: str) -> Optional[str]:
    if isinstance(node, dict):
        value = node.get(wanted)
        if isinstance(value, str) and value.strip():
            return value.strip()
        for child in node.values():
            found = _recursive_find(child, wanted)
            if found:
                return found
    elif isinstance(node, list):
        for child in node:
            found = _recursive_find(child, wanted)
            if found:
                return found
    elif isinstance(node, str):
        text = node.strip()
        if text.startswith("{") or text.startswith("["):
            try:
                return _recursive_find(json.loads(text), wanted)
            except json.JSONDecodeError:
                return None
    return None


def voucher_keys(voucher: Path) -> Tuple[str, str]:
    """Return (key, iv) from audible-cli's voucher without logging either."""
    try:
        data = json.loads(voucher.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PorterError(f"Could not read the AAXC voucher: {error}") from error
    key = _recursive_find(data, "key")
    iv = _recursive_find(data, "iv")
    if not key or not iv:
        raise PorterError("The AAXC voucher does not contain a key and IV.")
    if not re.fullmatch(r"[0-9a-fA-F]{32,}", key) or not re.fullmatch(r"[0-9a-fA-F]{32,}", iv):
        raise PorterError("The AAXC voucher contains an unexpected key or IV format.")
    return key, iv


def decrypt_options(source: Path, audible, secrets: List[str]) -> List[str]:
    suffix = source.suffix.lower()
    if suffix == ".aax":
        activation = audible.activation_bytes()
        secrets.append(activation)
        return ["-activation_bytes", activation]
    if suffix == ".aaxc":
        voucher = find_voucher(source)
        if voucher is None:
            raise PorterError(f"No .voucher file next to {source.name}; cannot decrypt AAXC.")
        key, iv = voucher_keys(voucher)
        secrets.extend([key, iv])
        return ["-audible_key", key, "-audible_iv", iv]
    return []


def duration_ms_from_meta(meta: Dict, probe: Optional[Dict] = None) -> int:
    if probe:
        try:
            return int(round(float(probe.get("format", {}).get("duration", 0)) * 1000))
        except (TypeError, ValueError):
            pass
    minutes = meta.get("runtime_minutes")
    if minutes:
        return int(minutes) * 60 * 1000
    return 0


def choose_chapters(chapter_file: Optional[Path], probe: Dict, meta: Dict) -> List[Dict]:
    duration = duration_ms_from_meta(meta, probe)
    if chapter_file is not None:
        try:
            chapters = parse_chapters(chapter_file, duration)
            if chapters:
                return chapters
        except PorterError:
            if not probe.get("chapters"):
                raise
    chapters = chapters_from_ffprobe(probe, duration)
    if len(chapters) == 1 and duration:
        chapters[0]["end"] = duration
    return chapters


def output_paths(config, meta: Dict) -> Tuple[Path, Path]:
    author = author_folder(meta)
    title = book_folder(meta)
    folder = config.library / author / title

    # Same title and author, different book: make the ASIN visible rather than
    # silently replacing a different edition.
    existing_meta = folder / "metadata.json"
    if existing_meta.is_file():
        try:
            existing = json.loads(existing_meta.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = {}
        if existing.get("asin") and meta.get("asin") and existing["asin"] != meta["asin"]:
            folder = config.library / author / f"{title} ({meta['asin']})"
            title = f"{title} ({meta['asin']})"
    return folder, folder / f"{title}.m4b"


def _source_metadata(metadata_file: Optional[Path], probe: Dict, source: Path) -> Dict:
    if metadata_file and metadata_file.is_file():
        try:
            return normalize(json.loads(metadata_file.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            pass
    return source_metadata_from_ffprobe(probe, source.stem)


def build_one(config, state, asin: str, force: bool = False, audible=None) -> Dict:
    """Build one book from `incoming/<ASIN>/`. Returns a small result dict."""
    incoming = config.incoming / asin
    if not incoming.is_dir():
        raise PorterError(f"No incoming directory for {asin}: {incoming}")
    source = find_audio(incoming)
    if source is None:
        raise PorterError(f"No audio file in {incoming}")
    if len([p for p in incoming.iterdir() if p.is_file() and p.suffix.lower() in (".aax", ".aaxc", ".m4b", ".m4a", ".mp3", ".mp4")]) > 1:
        raise PorterError(
            f"More than one audio file exists in {incoming}. "
            "Multi-part assembly is not supported; remove or merge the parts first."
        )

    metadata_file = incoming / "metadata.json"
    probe = None
    secrets: List[str] = []
    try:
        # Probe with the DRM options when they exist, so duration and embedded
        # chapters are available even before conversion.
        if source.suffix.lower() in (".aax", ".aaxc"):
            if audible is None:
                raise PorterError("Audible authentication is required to decrypt this file.")
            decrypt = decrypt_options(source, audible, secrets)
        else:
            decrypt = []
        try:
            probe = ffprobe_json(source, decrypt)
        except PorterError:
            probe = None

        meta = _source_metadata(metadata_file, probe or {}, source)
        chapter_file = find_chapter_file(incoming)
        chapters = choose_chapters(chapter_file, probe or {}, meta)
        duration = duration_ms_from_meta(meta, probe)
        folder, target = output_paths(config, meta)
        bitrate_key = str(config.audio_bitrate or "copy").lower()
        current_key = f"{BUILD_VERSION}:{bitrate_key}:{source.stat().st_size}:{int(source.stat().st_mtime)}"
        row = state.book(asin)
        cache_matches = (
            row is not None
            and row["build_key"] == current_key
            and row["output_path"] == str(target)
        )

        if target.exists() and not force and cache_matches:
            return {"asin": asin, "status": "skipped", "output": target, "meta": meta, "chapters": len(chapters)}

        if target.exists():
            target.unlink()

        ensure_dir(folder)
        cover = find_cover(incoming)
        extracted_cover = None
        with tempfile.TemporaryDirectory(prefix=".porter-build-", dir=str(folder)) as temporary:
            temp = Path(temporary)
            metadata_path = temp / "chapters.ffmeta"
            atomic_write(metadata_path, ffmetadata(meta, chapters), mode=0o600)
            output = temp / target.name
            cover_input = cover
            if cover_input is None and source.suffix.lower() not in (".aax", ".aaxc"):
                candidate = temp / "source-cover.jpg"
                if extract_cover(source, candidate):
                    cover_input = candidate
                    extracted_cover = candidate

            bitrate = str(config.audio_bitrate or "copy").lower()
            codec = ""
            if probe:
                for stream in probe.get("streams", []):
                    if stream.get("codec_type") == "audio":
                        codec = str(stream.get("codec_name") or "")
                        break

            copy_audio = bitrate == "copy" and (codec in ("aac", "alac") or source.suffix.lower() in (".aax", ".aaxc"))

            def ffmpeg_command(copy_stream: bool) -> List[str]:
                parts = [require("ffmpeg", "Install ffmpeg."), "-hide_banner", "-nostdin", "-y"]
                parts.extend(decrypt)
                parts.extend(["-i", str(source)])
                next_index = 1
                local_cover_index = None
                if cover_input is not None:
                    parts.extend(["-i", str(cover_input)])
                    local_cover_index = next_index
                    next_index += 1
                local_metadata_index = next_index
                parts.extend(["-f", "ffmetadata", "-i", str(metadata_path)])
                parts.extend(["-map", "0:a:0"])
                if local_cover_index is not None:
                    parts.extend([
                        "-map", f"{local_cover_index}:v:0",
                        "-c:v", "mjpeg",
                        "-disposition:v:0", "attached_pic",
                    ])
                parts.extend(["-map_metadata", str(local_metadata_index), "-map_chapters", str(local_metadata_index)])
                if copy_stream:
                    parts.extend(["-c:a", "copy"])
                else:
                    encode_bitrate = "128k" if bitrate == "copy" else bitrate
                    parts.extend(["-c:a", "aac", "-b:a", encode_bitrate])
                if local_cover_index is not None:
                    parts.extend(["-metadata:s:v:0", "title=Cover"])
                parts.extend(["-movflags", "+faststart", "-f", "ipod", str(output)])
                return parts

            display = f"ffmpeg {source.name} → {target.name}"
            completed = run(ffmpeg_command(copy_audio), check=False, capture=True, display=display)
            if completed.returncode != 0 and copy_audio:
                # Some AAX streams carry parameters the MP4 muxer refuses to copy.
                completed = run(ffmpeg_command(False), check=False, capture=True, display=display)
            if completed.returncode != 0:
                detail = redact((completed.stderr or completed.stdout or "ffmpeg failed").strip(), secrets)
                raise PorterError(f"ffmpeg could not build {target.name}: {detail[-1600:]}")

            atomically_place = target.with_name(f".{target.name}.tmp-{os.getpid()}")
            shutil.copyfile(output, atomically_place)
            os.replace(atomically_place, target)

            # The extracted cover lives in this temporary directory; copy it
            # before the directory is removed.
            if cover is not None:
                write_cover(cover, folder / "cover.jpg")
            elif extracted_cover is not None:
                write_cover(extracted_cover, folder / "cover.jpg")
            else:
                extract_cover(target, folder / "cover.jpg")

        if source.suffix.lower() == ".aaxc":
            voucher = find_voucher(source)
            if voucher:
                try:
                    voucher.unlink()
                except OSError:
                    pass

        result_probe = ffprobe_json(target)
        output_chapters = len(result_probe.get("chapters") or [])
        output_duration = int(float(result_probe.get("format", {}).get("duration") or 0) * 1000)
        meta["chapters"] = [
            {"title": chapter.get("title", "Chapter"), "start": int(chapter.get("start") or 0), "end": int(chapter.get("end") or 0)}
            for chapter in chapters
        ]
        meta["duration_ms"] = output_duration or duration
        meta["ribbon"] = cover_color(folder / "cover.jpg") or meta.get("ribbon") or "#222222"
        write_sidecars(folder, meta)
        state.upsert_book(
            asin=asin,
            title=meta.get("title"),
            author=(meta.get("authors") or [""])[0],
            series=meta.get("series_title"),
            source_path=str(source),
            output_path=str(target),
            source_size=source.stat().st_size,
            source_mtime=source.stat().st_mtime,
            build_key=current_key,
            built_at=int(time.time()),
            last_error=None,
        )
        return {
            "asin": asin,
            "status": "built",
            "output": target,
            "meta": meta,
            "chapters": output_chapters or len(chapters),
            "duration_ms": output_duration or duration,
            "cover": (folder / "cover.jpg").exists(),
        }
    except Exception as error:
        if isinstance(error, PorterError):
            message = str(error)
        else:
            message = f"{error.__class__.__name__}: {error}"
        state.set_error(asin, message)
        raise


def cover_color(path: Path) -> Optional[str]:
    """Average the cover to one RGB pixel, for the shelf ribbon."""
    if not path.is_file():
        return None
    try:
        completed = subprocess.run(
            [
                require("ffmpeg", "Install ffmpeg."),
                "-v", "error", "-i", str(path),
                "-vf", "scale=1:1", "-frames:v", "1",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
        )
        if completed.returncode == 0 and len(completed.stdout) >= 3:
            return "#{:02x}{:02x}{:02x}".format(*completed.stdout[:3])
    except (OSError, subprocess.TimeoutExpired):
        pass
    return None


def convert_local(config, state, source: Path, *, title: Optional[str] = None,
                  author: Optional[str] = None, series: Optional[str] = None,
                  sequence: Optional[str] = None, force: bool = False) -> Dict:
    """Convert an existing audio file without copying it into the library twice.

    The source is exposed to the normal build path through a temporary symlink,
    so cover extraction, chapters, voucher handling, and cache checks stay in
    one place.  The original file is never modified or deleted.
    """
    source = source.expanduser().resolve()
    if not source.is_file():
        raise PorterError(f"Not a file: {source}")
    if source.suffix.lower() not in (".m4b", ".m4a", ".mp3", ".mp4"):
        raise PorterError("convert accepts an m4b, m4a, mp3, or mp4 file.")

    probe = ffprobe_json(source)
    meta = source_metadata_from_ffprobe(probe, source.stem)
    if title:
        meta["title"] = title
    if author:
        meta["authors"] = [author]
    if series is not None:
        meta["series"] = [{"title": series, "sequence": sequence or ""}] if series else []
        meta["series_title"] = series or ""
        meta["series_sequence"] = sequence or ""
    elif sequence:
        meta["series_sequence"] = sequence
        if meta.get("series"):
            meta["series"][0]["sequence"] = sequence

    identifier = "L" + sha1_text(f"{source}:{source.stat().st_size}:{source.stat().st_mtime}")[:9].upper()
    stage = config.incoming / identifier
    ensure_dir(stage)
    link = stage / source.name
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(source)
    write_metadata = stage / "metadata.json"
    atomic_write(write_metadata, json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
    try:
        result = build_one(config, state, identifier, force=force, audible=None)
    finally:
        if stage.is_dir():
            shutil.rmtree(stage, ignore_errors=True)
    return result


def write_cover(source: Path, destination: Path) -> None:
    """ABS expects cover.jpg; normalise a PNG/WebP cover before copying it."""
    if source.suffix.lower() in (".jpg", ".jpeg"):
        atomic_copy(source, destination)
        return
    completed = run(
        [
            require("ffmpeg", "Install ffmpeg."),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-c:v",
            "mjpeg",
            str(destination),
        ],
        check=False,
        capture=True,
        display=f"convert cover {source.name}",
    )
    if completed.returncode != 0 or not destination.exists():
        atomic_copy(source, destination)


def extract_cover(audio: Path, destination: Path) -> bool:
    """Pull an attached cover out of an existing m4b for ABS's cover.jpg."""
    ffmpeg = require("ffmpeg", "Install ffmpeg.")
    completed = run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            str(audio),
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-c:v",
            "mjpeg",
            str(destination),
        ],
        check=False,
        capture=True,
        display=f"extract cover from {audio.name}",
    )
    if completed.returncode != 0 and destination.exists():
        destination.unlink()
    return destination.exists()


def build_all(config, state, force: bool = False, audible=None) -> List[Dict]:
    results = []
    if not config.incoming.is_dir():
        return results
    for folder in sorted(config.incoming.iterdir()):
        if not folder.is_dir() or not re.fullmatch(r"[A-Z0-9]{10}", folder.name):
            continue
        asin = folder.name
        result = build_one(config, state, asin, force=force, audible=audible)
        results.append(result)
    return results


