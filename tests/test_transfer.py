"""Exercise the supported port API without an SSH server or audio tooling."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from porter.config import Config
from porter.transfer import port_books, sha256_file


class PortTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.config = Config(home=root, config_path=root / "config.json",
                             library=root / "library", incoming=root / "incoming",
                             state_dir=root / "state")
        self.config.ensure_dirs()
        self.book = self.config.library / "Author" / "Book"
        self.book.mkdir(parents=True)
        (self.book / "book.m4b").write_bytes(b"fixture audio")
        (self.book / "metadata.json").write_text(json.dumps({"title": "Book"}))
        self.sizes = {f"Author/Book/{p.name}": p.stat().st_size for p in self.book.iterdir()}
        self.hashes = {"Author/Book/book.m4b": sha256_file(self.book / "book.m4b")}

    def port(self, *, keep=False):
        with patch("porter.transfer.require", side_effect=lambda name: name), \
             patch("porter.transfer._ssh"), \
             patch("porter.transfer.run", return_value=subprocess.CompletedProcess([], 0)), \
             patch("porter.transfer._remote_snapshot", return_value=(self.sizes, self.hashes)):
            return port_books(self.config, keep=keep)

    def test_verified_port_removes_local_book(self):
        result = self.port()
        self.assertTrue(result["results"][0]["verified"])
        self.assertTrue(result["results"][0]["removed"])
        self.assertFalse(self.book.exists())

    def test_hash_mismatch_preserves_local_book(self):
        self.hashes["Author/Book/book.m4b"] = "wrong"
        result = self.port()
        self.assertFalse(result["results"][0]["verified"])
        self.assertTrue(self.book.exists())

    def test_keep_preserves_verified_local_book(self):
        result = self.port(keep=True)
        self.assertTrue(result["results"][0]["verified"])
        self.assertFalse(result["results"][0]["removed"])
        self.assertTrue(self.book.exists())
