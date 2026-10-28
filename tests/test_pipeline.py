from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from porter.config import Config
from porter.convert import build_one, ffprobe_json, voucher_keys
from porter.state import State


HAS_FFMPEG = shutil.which("ffmpeg") and shutil.which("ffprobe")


class VoucherTests(unittest.TestCase):
    def test_key_and_iv_are_found_nested(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "book.voucher"
            path.write_text(
                json.dumps(
                    {
                        "content_license": {
                            "license_response": {
                                "key": "00112233445566778899aabbccddeeff",
                                "iv": "ffeeddccbbaa99887766554433221100",
                            }
                        }
                    }
                )
            )
            key, iv = voucher_keys(path)
            self.assertEqual(key, "00112233445566778899aabbccddeeff")
            self.assertEqual(iv, "ffeeddccbbaa99887766554433221100")

    def test_bad_key_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "book.voucher"
            path.write_text(json.dumps({"key": "not-hex", "iv": "0011"}))
            with self.assertRaises(Exception):
                voucher_keys(path)


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg and ffprobe are required")
class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.home = self.root / "Audiobooks"
        self.config = Config(
            home=self.home,
            config_path=self.root / "config.json",
            library=self.home / "library",
            incoming=self.home / "incoming",
            state_dir=self.home / ".porter",
            pi_host="local",
            pi_library=str(self.root / "remote"),
        )
        self.config.ensure_dirs()
        self.state = State(self.config.db_path)
        self.asin = "B0TEST1234"
        self.source_dir = self.config.incoming / self.asin
        self.source_dir.mkdir(parents=True)

    def tearDown(self):
        self.state.close()
        self.temp.cleanup()

    def make_book(self):
        source = self.source_dir / f"{self.asin}_Fixture.m4b"
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=330:duration=8",
                "-c:a",
                "aac",
                "-b:a",
                "64k",
                str(source),
            ],
            check=True,
        )
        cover = self.source_dir / f"{self.asin}_Fixture_(882).jpg"
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=#222222:s=300x300:d=1",
                "-frames:v",
                "1",
                str(cover),
            ],
            check=True,
        )
        (self.source_dir / f"{self.asin}_Fixture-chapters.json").write_text(
            json.dumps(
                {
                    "chapters": [
                        {"title": "One", "start_offset_ms": 0, "length_ms": 4000},
                        {"title": "Two", "start_offset_ms": 4000, "length_ms": 4000},
                    ]
                }
            )
        )
        (self.source_dir / "metadata.json").write_text(
            json.dumps(
                {
                    "asin": self.asin,
                    "title": "Fixture Book",
                    "authors": ["Fixture Author"],
                    "narrators": ["Fixture Narrator"],
                    "series": [{"title": "Fixture Series", "sequence": "1"}],
                    "runtime_minutes": 1,
                    "description": "Synthetic.",
                }
            )
        )

    def test_build_is_valid_and_idempotent(self):
        self.make_book()
        result = build_one(self.config, self.state, self.asin)
        self.assertEqual(result["status"], "built")
        output = Path(result["output"])
        self.assertTrue(output.is_file())
        self.assertTrue((output.parent / "metadata.opf").is_file())
        self.assertTrue((output.parent / "cover.jpg").is_file())
        probe = ffprobe_json(output)
        self.assertEqual(len(probe.get("chapters") or []), 2)
        self.assertGreater(float(probe["format"]["duration"]), 7)

        again = build_one(self.config, self.state, self.asin)
        self.assertEqual(again["status"], "skipped")

        forced = build_one(self.config, self.state, self.asin, force=True)
        self.assertEqual(forced["status"], "built")

        # A changed source invalidates the build cache even without --force.
        source = next(self.source_dir.glob("*.m4b"))
        os.utime(source, (source.stat().st_atime + 5, source.stat().st_mtime + 5))
        changed = build_one(self.config, self.state, self.asin)
        self.assertEqual(changed["status"], "built")

    def test_embedded_cover_is_extracted(self):
        source = self.source_dir / f"{self.asin}_Embedded.m4b"
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=330:duration=4",
                "-f",
                "lavfi",
                "-i",
                "color=c=#884422:s=200x200:d=1",
                "-map",
                "0:a",
                "-map",
                "1:v",
                "-c:a",
                "aac",
                "-b:a",
                "64k",
                "-c:v",
                "mjpeg",
                "-disposition:v",
                "attached_pic",
                "-shortest",
                str(source),
            ],
            check=True,
        )
        (self.source_dir / "metadata.json").write_text(
            json.dumps(
                {
                    "asin": self.asin,
                    "title": "Embedded Cover",
                    "authors": ["Fixture Author"],
                    "runtime_minutes": 1,
                }
            )
        )
        result = build_one(self.config, self.state, self.asin)
        self.assertTrue((Path(result["output"]).parent / "cover.jpg").is_file())


if __name__ == "__main__":
    unittest.main()
