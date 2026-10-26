"""Metadata normalisation, Audible chapter parsing, and ABS-friendly sidecars."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from xml.sax.saxutils import escape, quoteattr

from .util import PorterError, sanitize_component


def _mapping(item: Any) -> Dict:
    if isinstance(item, dict):
        return item
    try:
        return dict(item)
    except Exception:
        return {}


def _names(value: Any) -> List[str]:
    if not value:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, dict):
        value = [value]
    if isinstance(value, (list, tuple)):
        result = []
        for entry in value:
            if isinstance(entry, str):
                name = entry.strip()
            elif isinstance(entry, dict):
                name = str(entry.get("name") or entry.get("title") or "").strip()
            else:
                name = str(entry).strip()
            if name:
                result.append(name)
        return result
    return []


def _series(value: Any) -> List[Dict[str, str]]:
    if not value:
        return []
    if isinstance(value, dict):
        value = [value]
    result = []
    if isinstance(value, (list, tuple)):
        for entry in value:
            if isinstance(entry, dict):
                title = entry.get("title") or entry.get("name") or entry.get("series_title")
                sequence = entry.get("sequence") or entry.get("book_number") or entry.get("series_sequence")
            else:
                title, sequence = entry, None
            if title:
                result.append({"title": str(title).strip(), "sequence": str(sequence).strip() if sequence else ""})
    return result


def normalize(item: Any) -> Dict:
    """One metadata shape for Audible items, library JSON, and imports."""
    data = _mapping(item)

    authors = _names(data.get("authors") or data.get("author"))
    narrators = _names(data.get("narrators") or data.get("narrator"))
    series = _series(data.get("series"))
    if not series and data.get("series_title"):
        series = [{"title": str(data["series_title"]), "sequence": str(data.get("series_sequence") or "")}]

    title = str(data.get("title") or data.get("full_title") or data.get("name") or "").strip()
    subtitle = str(data.get("subtitle") or "").strip()
    description = (
        data.get("extended_product_description")
        or data.get("description")
        or data.get("publisher_summary")
        or data.get("summary")
        or ""
    )
    if isinstance(description, dict):
        description = description.get("text") or ""
    description = str(description).strip()

    genres = data.get("genres") or []
    if isinstance(genres, str):
        genres = [part.strip() for part in genres.split(",") if part.strip()]
    elif isinstance(genres, list):
        cleaned = []
        for genre in genres:
            if isinstance(genre, dict):
                genre = genre.get("name") or genre.get("title") or ""
            if genre:
                cleaned.append(str(genre).strip())
        genres = cleaned
    else:
        genres = []

    runtime = data.get("runtime_length_min") or data.get("runtime_minutes")
    try:
        runtime = int(runtime) if runtime is not None else None
    except (TypeError, ValueError):
        runtime = None

    cover_url = data.get("cover_url")
    if not cover_url and isinstance(data.get("product_images"), dict):
        images = data["product_images"]
        for size in ("882", "900", "500", "408", "315", "252"):
            if images.get(size):
                cover_url = images[size]
                break

    asin = str(data.get("asin") or "").strip().upper()
    return {
        "asin": asin,
        "title": title or asin or "Unknown Title",
        "subtitle": subtitle,
        "authors": authors or ["Unknown Author"],
        "narrators": narrators,
        "series": series,
        "series_title": series[0]["title"] if series else "",
        "series_sequence": series[0]["sequence"] if series else "",
        "publisher": str(data.get("publisher_name") or data.get("publisher") or "").strip(),
        "language": str(data.get("language") or "").strip(),
        "runtime_minutes": runtime,
        "release_date": str(data.get("release_date") or data.get("date") or "").strip(),
        "description": description,
        "genres": genres,
        "cover_url": cover_url or "",
        "date_added": str(data.get("date_added") or (data.get("library_status") or {}).get("date_added") or ""),
        "purchase_date": str(data.get("purchase_date") or ""),
    }


def source_metadata_from_ffprobe(probe: Dict, fallback_title: str = "") -> Dict:
    """Metadata for an imported file when no Audible record exists."""
    tags = {}
    for stream in probe.get("streams", []):
        if stream.get("codec_type") == "audio":
            tags = {str(k).lower(): v for k, v in (stream.get("tags") or {}).items()}
            break
    tags.update({str(k).lower(): v for k, v in (probe.get("format", {}).get("tags") or {}).items()})

    title = tags.get("title") or tags.get("album") or fallback_title
    author = tags.get("album_artist") or tags.get("artist") or tags.get("author") or "Unknown Author"
    narrators = tags.get("narrator") or tags.get("composer") or ""
    series = tags.get("series") or tags.get("series-part") or ""
    return normalize(
        {
            "title": title,
            "authors": [author] if isinstance(author, str) else author,
            "narrators": [narrators] if narrators else [],
            "series": [{"title": series, "sequence": tags.get("series-part") or ""}] if series else [],
            "description": tags.get("description") or tags.get("comment") or "",
            "language": tags.get("language") or "",
            "runtime_length_min": int(float(probe.get("format", {}).get("duration") or 0) // 60) or None,
            "release_date": tags.get("date") or "",
        }
    )


def book_folder(meta: Dict) -> str:
    return sanitize_component(meta.get("title") or "Unknown Title")


def author_folder(meta: Dict) -> str:
    authors = meta.get("authors") or ["Unknown Author"]
    return sanitize_component(authors[0] if authors else "Unknown Author", fallback="Unknown Author")


def _chapter_ms(chapter: Dict, start_key: str, value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0:
        return None
    key = start_key.lower()
    if "sec" in key and "ms" not in key:
        number *= 1000
    return int(round(number))


def _extract_chapter_list(data: Any) -> List[Dict]:
    if isinstance(data, dict):
        for key in ("chapters", "chapter_info", "chapterInfo"):
            value = data.get(key)
            if isinstance(value, list):
                return [entry for entry in value if isinstance(entry, dict)]
            if isinstance(value, dict):
                nested = _extract_chapter_list(value)
                if nested:
                    return nested
        items = data.get("items")
        if isinstance(items, list):
            return [entry for entry in items if isinstance(entry, dict)]
    if isinstance(data, list):
        return [entry for entry in data if isinstance(entry, dict)]
    return []


def parse_chapters(path: Path, duration_ms: int) -> List[Dict[str, Any]]:
    """Read audible-cli's `-chapters.json` regardless of ms/sec spelling."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PorterError(f"Could not read chapter file {path.name}: {error}") from error

    raw = _extract_chapter_list(data)
    chapters = []
    for entry in raw:
        title = entry.get("title") or entry.get("name") or entry.get("chapter_title")
        if not title:
            continue
        start = None
        length = None
        for key in (
            "start_offset_ms",
            "start_offset_sec",
            "start_ms",
            "start_sec",
            "start_time_ms",
            "start_time_sec",
            "start",
        ):
            if key in entry and entry[key] is not None:
                start = _chapter_ms(entry, key, entry[key])
                if start is not None:
                    break
        for key in (
            "length_ms",
            "length_sec",
            "duration_ms",
            "duration_sec",
            "end_offset_ms",
            "end_offset_sec",
            "length",
        ):
            if key in entry and entry[key] is not None:
                length = _chapter_ms(entry, key, entry[key])
                if length is not None:
                    break
        if start is None:
            continue
        chapters.append({"title": str(title).strip(), "start": start, "length": length})

    if not chapters:
        return one_chapter(duration_ms)

    chapters.sort(key=lambda chapter: chapter["start"])
    # If the caller could not determine the book duration, derive it from the
    # chapter offsets instead of truncating every chapter to zero.
    if duration_ms <= 0:
        duration_ms = max(
            chapter["start"] + (chapter.get("length") or 0) for chapter in chapters
        )
    for index, chapter in enumerate(chapters):
        next_start = chapters[index + 1]["start"] if index + 1 < len(chapters) else duration_ms
        own_end = chapter["start"] + chapter["length"] if chapter.get("length") else next_start
        end = min(next_start or duration_ms, own_end or duration_ms, duration_ms)
        if end <= chapter["start"]:
            end = next_start or duration_ms
        chapter["end"] = max(chapter["start"], end)
    chapters[-1]["end"] = max(chapters[-1]["start"], duration_ms)
    chapters[0]["start"] = 0
    return chapters


def one_chapter(duration_ms: int) -> List[Dict[str, Any]]:
    return [{"title": "Chapter 1", "start": 0, "end": max(0, duration_ms)}]


def chapters_from_ffprobe(probe: Dict, duration_ms: int) -> List[Dict[str, Any]]:
    raw = probe.get("chapters") or []
    chapters = []
    for entry in raw:
        start = entry.get("start_time")
        end = entry.get("end_time")
        if start is None:
            continue
        try:
            start_ms = int(float(start) * 1000)
            end_ms = int(float(end) * 1000) if end is not None else duration_ms
        except (TypeError, ValueError):
            continue
        title = (entry.get("tags") or {}).get("title") or f"Chapter {len(chapters) + 1}"
        chapters.append({"title": title, "start": start_ms, "end": end_ms})
    return chapters or one_chapter(duration_ms)


def _ff_escape(value: str) -> str:
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("=", "\\=")
        .replace(";", "\\;")
        .replace("#", "\\#")
        .replace("\n", "\\\n")
    )


def ffmetadata(meta: Dict, chapters: List[Dict[str, Any]]) -> str:
    authors = ", ".join(meta.get("authors") or [])
    narrators = ", ".join(meta.get("narrators") or [])
    tags = {
        "title": meta.get("title", ""),
        "artist": authors,
        "album": meta.get("title", ""),
        "album_artist": authors,
        "genre": "Audiobook",
        "date": meta.get("release_date", "")[:10],
        "comment": " / ".join(
            part for part in (
                f"ASIN {meta['asin']}" if meta.get("asin") else "",
                f"Series: {meta['series_title']}" if meta.get("series_title") else "",
                f"Book {meta['series_sequence']}" if meta.get("series_sequence") else "",
            ) if part
        ),
        "description": meta.get("description", ""),
        "publisher": meta.get("publisher", ""),
        "language": meta.get("language", ""),
        "narrator": narrators,
        "asin": meta.get("asin", ""),
        "series": meta.get("series_title", ""),
        "series-part": meta.get("series_sequence", ""),
    }
    lines = [";FFMETADATA1"]
    for key, value in tags.items():
        if value:
            lines.append(f"{key}={_ff_escape(value)}")
    for chapter in chapters:
        start = int(chapter.get("start") or 0)
        end = int(chapter.get("end") or start)
        if end <= start:
            continue
        lines.extend(
            [
                "",
                "[CHAPTER]",
                "TIMEBASE=1/1000",
                f"START={start}",
                f"END={end}",
                f"title={_ff_escape(chapter.get('title') or 'Chapter')}",
            ]
        )
    return "\n".join(lines) + "\n"


def opf(meta: Dict) -> str:
    """An OPF sidecar Audiobookshelf reads above file and folder metadata."""
    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">',
        '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">',
    ]
    identifier = meta.get("asin") or meta.get("title", "")
    lines.append(f"    <dc:identifier id=\"BookId\" opf:scheme=\"ASIN\">{escape(str(identifier))}</dc:identifier>")
    lines.append(f"    <dc:title>{escape(str(meta.get('title', '')))}</dc:title>")
    if meta.get("subtitle"):
        lines.append(f"    <dc:subtitle>{escape(str(meta['subtitle']))}</dc:subtitle>")
    for author in meta.get("authors") or []:
        lines.append(f"    <dc:creator opf:role=\"aut\">{escape(str(author))}</dc:creator>")
    for narrator in meta.get("narrators") or []:
        lines.append(f"    <dc:creator opf:role=\"nrt\">{escape(str(narrator))}</dc:creator>")
    if meta.get("description"):
        lines.append(f"    <dc:description>{escape(str(meta['description']))}</dc:description>")
    if meta.get("publisher"):
        lines.append(f"    <dc:publisher>{escape(str(meta['publisher']))}</dc:publisher>")
    if meta.get("release_date"):
        lines.append(f"    <dc:date>{escape(str(meta['release_date'])[:10])}</dc:date>")
    if meta.get("language"):
        lines.append(f"    <dc:language>{escape(str(meta['language']))}</dc:language>")
    for genre in meta.get("genres") or []:
        lines.append(f"    <dc:subject>{escape(str(genre))}</dc:subject>")
    if meta.get("series_title"):
        lines.append(
            f"    <meta name=\"calibre:series\" content={quoteattr(str(meta['series_title']))}/>"
        )
    if meta.get("series_sequence"):
        lines.append(
            f"    <meta name=\"calibre:series_index\" content={quoteattr(str(meta['series_sequence']))}/>"
        )
    lines.extend(["  </metadata>", "</package>", ""])
    return "\n".join(lines)


def write_sidecars(folder: Path, meta: Dict) -> None:
    """Write the files ABS actually consumes, plus an archival JSON record."""
    from .util import atomic_write

    atomic_write(folder / "metadata.opf", opf(meta))
    if meta.get("description"):
        atomic_write(folder / "desc.txt", str(meta["description"]).strip() + "\n")
    narrators = ", ".join(meta.get("narrators") or [])
    if narrators:
        atomic_write(folder / "reader.txt", narrators + "\n")
    atomic_write(
        folder / "metadata.json",
        json.dumps(meta, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
    )


def title_year(meta: Dict) -> str:
    release = meta.get("release_date") or ""
    match = re.match(r"(\d{4})", release)
    return match.group(1) if match else ""


def summary_line(meta: Dict) -> str:
    authors = ", ".join(meta.get("authors") or [])
    runtime = meta.get("runtime_minutes")
    pieces = [authors]
    if meta.get("series_title"):
        sequence = f" #{meta['series_sequence']}" if meta.get("series_sequence") else ""
        pieces.append(f"{meta['series_title']}{sequence}")
    if runtime:
        pieces.append(f"{runtime // 60}h {runtime % 60:02d}m")
    return " · ".join(piece for piece in pieces if piece)
