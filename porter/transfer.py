"""Port built books to berry and delete the Mac copy after verification.

The definition of "received everything full" here is:

* rsync exits successfully;
* every local file in the book folder exists remotely with the same byte size;
* the remote .m4b has the same SHA-256 as the local .m4b.

Only then is the local book folder (and the staged Audible download) removed.
"""

from __future__ import annotations

import hashlib
import json
import os
import shlex
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .util import PorterError, human_size, require, run, run_ssh


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def discover_books(root: Path) -> List[Dict]:
    books = []
    if not root.is_dir():
        return books
    for metadata_path in root.rglob("metadata.json"):
        if any(part.startswith(".") for part in metadata_path.parts):
            continue
        folder = metadata_path.parent
        audio_files = sorted(folder.glob("*.m4b"))
        if not audio_files:
            audio_files = sorted(folder.glob("*.m4a")) + sorted(folder.glob("*.mp3"))
        if not audio_files:
            continue
        try:
            meta = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        try:
            relative = folder.relative_to(root)
        except ValueError:
            continue
        books.append(
            {
                "dir": folder,
                "relative": relative,
                "audio": audio_files[0],
                "meta": meta,
                "size": sum(path.stat().st_size for path in folder.rglob("*") if path.is_file()),
            }
        )
    books.sort(key=lambda book: str(book["relative"]))
    return books


def library_stats(root: Path) -> Dict:
    books = discover_books(root)
    return {"books": len(books), "bytes": sum(book["size"] for book in books)}


def _ssh(config, script: str, check: bool = True, timeout: Optional[int] = None):
    return run_ssh(config.pi_host, script, check=check, timeout=timeout)


def _remote_snapshot(config) -> Tuple[Dict[str, int], Dict[str, str]]:
    root = config.pi_library.rstrip("/")
    script = f"""set -euo pipefail
cd {shlex.quote(root)}
find . -type f -printf '%P\\t%s\\n'
echo '---HASHES---'
find . -type f -name '*.m4b' -exec sha256sum {{}} \\;
"""
    completed = _ssh(config, script, timeout=120)
    sizes: Dict[str, int] = {}
    hashes: Dict[str, str] = {}
    section = "sizes"
    for line in (completed.stdout or "").splitlines():
        if line.strip() == "---HASHES---":
            section = "hashes"
            continue
        if not line.strip():
            continue
        if section == "sizes":
            relative, _, size = line.rpartition("\t")
            if relative:
                try:
                    sizes[relative.lstrip("./")] = int(size)
                except ValueError:
                    pass
        else:
            digest, _, path = line.partition("  ")
            if digest and path:
                hashes[path.lstrip("./")] = digest
    return sizes, hashes


def port_books(config, *, dry_run: bool = False, keep: bool = False) -> Dict:
    require("ssh")
    rsync = require("rsync")
    books = discover_books(config.library)
    if not books:
        raise PorterError(f"No books to port in {config.library}")

    host = config.pi_host
    remote_root = config.pi_library.rstrip("/")
    _ssh(config, f"mkdir -p {shlex.quote(remote_root)}", timeout=20)

    command = [
        rsync,
        "-a",
        "--partial",
        "--human-readable",
        "--itemize-changes",
        "--exclude=.DS_Store",
        "--exclude=.porter-*",
    ]
    if dry_run:
        command.append("--dry-run")
    command.extend([f"{config.library}/", f"{host}:{remote_root}/"])
    completed = run(command, check=False, capture=False, display="rsync port")
    if completed.returncode != 0:
        raise PorterError(
            "rsync to berry failed. The Mac copies were kept. "
            f"Check `ssh {host} true`."
        )

    if dry_run:
        return {"books": len(books), "bytes": sum(book["size"] for book in books), "dry_run": True, "results": []}

    sizes, hashes = _remote_snapshot(config)
    results = []
    for book in books:
        relative = book["relative"].as_posix()
        missing = []
        mismatched = []
        for path in book["dir"].rglob("*"):
            if not path.is_file() or path.name == ".DS_Store":
                continue
            rel = f"{relative}/{path.relative_to(book['dir']).as_posix()}"
            remote_size = sizes.get(rel)
            if remote_size is None:
                missing.append(rel)
            elif remote_size != path.stat().st_size:
                mismatched.append(rel)
        local_hash = sha256_file(book["audio"])
        remote_hash = hashes.get(f"{relative}/{book['audio'].name}")
        verified = not missing and not mismatched and local_hash == remote_hash
        result = {
            "title": book["meta"].get("title") or book["dir"].name,
            "relative": relative,
            "bytes": book["size"],
            "verified": verified,
            "removed": False,
            "missing": missing,
            "mismatched": mismatched,
            "hash_match": local_hash == remote_hash,
        }
        if verified and not keep:
            _remove_local(config, book)
            result["removed"] = True
        results.append(result)

    return {
        "books": len(books),
        "bytes": sum(book["size"] for book in books),
        "dry_run": False,
        "keep": keep,
        "results": results,
    }


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return path.resolve() != root.resolve()
    except ValueError:
        return False


def _remove_local(config, book: Dict) -> None:
    folder = book["dir"]
    if not _inside(folder, config.library):
        raise PorterError(f"Refusing to delete outside the library: {folder}")
    shutil.rmtree(folder)
    parent = folder.parent
    while _inside(parent, config.library) and not any(parent.iterdir()):
        parent.rmdir()
        parent = parent.parent

    asin = str(book["meta"].get("asin") or "").strip().upper()
    if len(asin) == 10 and asin.isalnum():
        incoming = config.incoming / asin
        if incoming.is_dir() and _inside(incoming, config.incoming):
            shutil.rmtree(incoming)
