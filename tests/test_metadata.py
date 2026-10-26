from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from porter.metadata import (
    ffmetadata,
    normalize,
    opf,
    parse_chapters,
    source_metadata_from_ffprobe,
)


class NormalizeTests(unittest.TestCase):
    def test_export_style_strings(self):
        meta = normalize(
            {
                "asin": "b0abc12345",
                "title": "A Book",
                "subtitle": "A Subtitle",
                "authors": "Jane Doe, John Roe",
                "narrators": "Reader One",
                "series_title": "The Series",
                "series_sequence": "3",
                "runtime_length_min": "481",
                "cover_url": "https://example.invalid/cover.jpg",
            }
        )
        self.assertEqual(meta["asin"], "B0ABC12345")
        self.assertEqual(meta["authors"], ["Jane Doe", "John Roe"])
        self.assertEqual(meta["narrators"], ["Reader One"])
        self.assertEqual(meta["series_title"], "The Series")
        self.assertEqual(meta["series_sequence"], "3")
        self.assertEqual(meta["runtime_minutes"], 481)

    def test_native_nested_style(self):
        meta = normalize(
            {
                "asin": "B0ABC12345",
                "title": "A Book",
                "authors": [{"name": "Jane Doe"}],
                "narrators": [{"name": "Reader One"}],
                "series": [{"title": "The Series", "sequence": "1"}],
                "product_images": {"500": "small.jpg", "882": "large.jpg"},
            }
        )
        self.assertEqual(meta["authors"], ["Jane Doe"])
        self.assertEqual(meta["cover_url"], "large.jpg")

    def test_missing_author_has_a_safe_default(self):
        meta = normalize({"title": "Orphan"})
        self.assertEqual(meta["authors"], ["Unknown Author"])


class ChapterTests(unittest.TestCase):
    def test_ms_and_seconds(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "chapters.json"
            path.write_text(
                json.dumps(
                    {
                        "chapter_info": {
                            "chapters": [
                                {"title": "One", "start_offset_ms": 0, "length_ms": 3000},
                                {"title": "Two", "start_offset_sec": 3, "length_sec": 2},
                                {"title": "Three", "start_offset_ms": 5000, "length_ms": 1000},
                            ]
                        }
                    }
                )
            )
            chapters = parse_chapters(path, 6000)
            self.assertEqual([chapter["start"] for chapter in chapters], [0, 3000, 5000])
            self.assertEqual(chapters[-1]["end"], 6000)
            self.assertEqual(chapters[1]["title"], "Two")

    def test_no_chapters_becomes_one(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "chapters.json"
            path.write_text("{}")
            chapters = parse_chapters(path, 9000)
            self.assertEqual(len(chapters), 1)
            self.assertEqual(chapters[0]["end"], 9000)

    def test_ffmetadata_escapes_reserved_characters(self):
        text = ffmetadata(
            {
                "title": "A=B;C#D",
                "authors": ["Jane"],
                "asin": "B0ABC12345",
                "description": "line one\nline two",
            },
            [{"title": "One=Two", "start": 0, "end": 1000}],
        )
        self.assertIn("title=A\\=B\\;C\\#D", text)
        self.assertIn("title=One\\=Two", text)
        self.assertIn("[CHAPTER]", text)
        self.assertIn("END=1000", text)

    def test_opf_carries_series_and_narrator(self):
        xml = opf(
            {
                "asin": "B0ABC12345",
                "title": "A Book",
                "authors": ["Jane Doe"],
                "narrators": ["Reader One"],
                "series_title": "The Series",
                "series_sequence": "2",
                "description": "Description & more",
            }
        )
        self.assertIn('opf:role="nrt">Reader One', xml)
        self.assertIn('name="calibre:series" content="The Series"', xml)
        self.assertIn("Description &amp; more", xml)


class ImportMetadataTests(unittest.TestCase):
    def test_tags_are_normalised(self):
        meta = source_metadata_from_ffprobe(
            {
                "streams": [
                    {
                        "codec_type": "audio",
                        "tags": {
                            "title": "Tagged Book",
                            "artist": "Tag Author",
                            "narrator": "Tag Narrator",
                            "series": "Tag Series",
                        },
                    }
                ],
                "format": {"duration": "3600", "tags": {}},
            }
        )
        self.assertEqual(meta["title"], "Tagged Book")
        self.assertEqual(meta["authors"], ["Tag Author"])
        self.assertEqual(meta["narrators"], ["Tag Narrator"])
        self.assertEqual(meta["series_title"], "Tag Series")


if __name__ == "__main__":
    unittest.main()
