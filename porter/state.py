"""SQLite state: the Audible library cache and the per-book build/transfer record.

This is deliberately not a copy of the audiobooks.  The files under
`incoming/` and `library/` are the truth; the database only records what has
already been fetched and built so a second run can skip the expensive work.
"""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .util import PorterError, ensure_dir


SCHEMA = """
CREATE TABLE IF NOT EXISTS library_cache (
    asin       TEXT PRIMARY KEY,
    title      TEXT,
    author     TEXT,
    payload    TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
    asin           TEXT PRIMARY KEY,
    title          TEXT,
    author         TEXT,
    series         TEXT,
    source_path    TEXT,
    output_path    TEXT,
    source_size    INTEGER,
    source_mtime   REAL,
    build_key      TEXT,
    built_at       INTEGER,
    published_at   INTEGER,
    remote_path    TEXT,
    last_error     TEXT
);

CREATE TABLE IF NOT EXISTS runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    command    TEXT NOT NULL,
    asin       TEXT,
    status     TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at   INTEGER,
    detail     TEXT
);

CREATE INDEX IF NOT EXISTS books_output_idx ON books(output_path);
CREATE INDEX IF NOT EXISTS runs_started_idx ON runs(started_at DESC);
"""


class State:
    def __init__(self, path: Path):
        self.path = path
        ensure_dir(path.parent)
        self.connection = sqlite3.connect(str(path))
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(SCHEMA)
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA busy_timeout=5000")
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()

    @contextmanager
    def transaction(self):
        try:
            yield self.connection
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise

    # ---- Audible library cache -------------------------------------------------

    def cache_library(self, items: Iterable[Dict]) -> None:
        now = int(time.time())
        with self.transaction() as connection:
            connection.execute("DELETE FROM library_cache")
            rows = []
            for item in items:
                if not item.get("asin"):
                    continue
                authors = item.get("authors") or item.get("author") or ""
                if isinstance(authors, list):
                    first = authors[0] if authors else ""
                    if isinstance(first, dict):
                        first = first.get("name", "")
                    author = str(first)
                else:
                    author = str(authors).split(",")[0].strip()
                rows.append(
                    (
                        item.get("asin", ""),
                        item.get("title", ""),
                        author,
                        json.dumps(item, ensure_ascii=False),
                        now,
                    )
                )
            connection.executemany(
                "INSERT OR REPLACE INTO library_cache(asin, title, author, payload, fetched_at)"
                " VALUES (?, ?, ?, ?, ?)",
                rows,
            )

    def library_items(self) -> List[Dict]:
        rows = self.connection.execute("SELECT payload FROM library_cache ORDER BY title COLLATE NOCASE").fetchall()
        result = []
        for row in rows:
            try:
                result.append(json.loads(row["payload"]))
            except json.JSONDecodeError:
                continue
        return result

    def library_fetched_at(self) -> Optional[int]:
        row = self.connection.execute("SELECT MAX(fetched_at) AS stamp FROM library_cache").fetchone()
        return int(row["stamp"]) if row and row["stamp"] else None

    def find_library_item(self, asin: str) -> Optional[Dict]:
        row = self.connection.execute("SELECT payload FROM library_cache WHERE asin = ?", (asin,)).fetchone()
        return json.loads(row["payload"]) if row else None

    # ---- build/transfer state --------------------------------------------------

    def book(self, asin: str) -> Optional[sqlite3.Row]:
        return self.connection.execute("SELECT * FROM books WHERE asin = ?", (asin,)).fetchone()

    def upsert_book(self, **fields) -> None:
        asin = fields.get("asin")
        if not asin:
            raise PorterError("state.upsert_book requires an asin")
        existing = self.book(asin)
        columns = [key for key, value in fields.items()]
        if existing is None:
            placeholders = ", ".join("?" for _ in columns)
            self.connection.execute(
                f"INSERT INTO books({', '.join(columns)}) VALUES ({placeholders})",
                [fields[column] for column in columns],
            )
        else:
            assignments = ", ".join(f"{column} = ?" for column in columns if column != "asin")
            values = [fields[column] for column in columns if column != "asin"]
            if assignments:
                self.connection.execute(f"UPDATE books SET {assignments} WHERE asin = ?", values + [asin])
        self.connection.commit()

    def set_error(self, asin: Optional[str], message: str) -> None:
        if asin:
            self.upsert_book(asin=asin, last_error=message[:2000])
        with self.transaction() as connection:
            connection.execute(
                "INSERT INTO runs(command, asin, status, started_at, ended_at, detail) VALUES (?, ?, ?, ?, ?, ?)",
                ("error", asin, "failed", int(time.time()), int(time.time()), message[:2000]),
            )

    def start_run(self, command: str, asin: Optional[str] = None) -> int:
        with self.transaction() as connection:
            cursor = connection.execute(
                "INSERT INTO runs(command, asin, status, started_at) VALUES (?, ?, ?, ?)",
                (command, asin, "running", int(time.time())),
            )
            return int(cursor.lastrowid)

    def finish_run(self, run_id: int, status: str, detail: str = "") -> None:
        with self.transaction() as connection:
            connection.execute(
                "UPDATE runs SET status = ?, ended_at = ?, detail = ? WHERE id = ?",
                (status, int(time.time()), detail[:2000], run_id),
            )

    def recent_runs(self, limit: int = 10) -> List[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM runs ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()

    def all_books(self) -> List[sqlite3.Row]:
        return self.connection.execute("SELECT * FROM books ORDER BY author COLLATE NOCASE, title COLLATE NOCASE").fetchall()

    def mark_all_published(self, stamp: int) -> None:
        """The rsync succeeded; mark every local book that is present."""
        with self.transaction() as connection:
            connection.execute("UPDATE books SET published_at = ? WHERE output_path IS NOT NULL", (stamp,))
