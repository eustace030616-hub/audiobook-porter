"""Install and operate the Shelf web UI on berry.

No Docker: a dependency-free Node server, a systemd user unit, and the library
as plain files.  The old Audiobookshelf service is stopped and disabled so its
configuration pages are not exposed.
"""

from __future__ import annotations

import base64
import json
import shlex
import subprocess
import time
from pathlib import Path
from typing import Dict, Optional

from .util import PorterError, human_size, require, run, run_ssh


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SHELF_SOURCE = PROJECT_ROOT / "shelf"
FFMPEG_TARBALL = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz"


def remote_paths(config) -> Dict[str, str]:
    root = config.pi_app.rstrip("/")
    return {
        "root": root,
        "app": f"{root}/app",
        "data": f"{root}/data",
        "bin": f"{root}/bin",
        "library": config.pi_library.rstrip("/"),
    }


def _ssh(config, script: str, *, check: bool = True, timeout: Optional[int] = None):
    return run_ssh(config.pi_host, script, check=check, timeout=timeout)


def _rsync(config, source: Path, destination: str) -> None:
    rsync = require("rsync")
    command = [
        rsync, "-az", "--delete", "--human-readable", "--itemize-changes",
        f"{source}/", f"{config.pi_host}:{destination}/",
    ]
    completed = run(command, check=False, capture=False, display="rsync shelf")
    if completed.returncode != 0:
        raise PorterError("Could not copy the Shelf app to berry. Check SSH and rsync.")


def ensure_ffmpeg(config) -> Dict[str, str]:
    paths = remote_paths(config)
    script = f"""set -euo pipefail
mkdir -p {shlex.quote(paths['bin'])}
FF=""
FP=""
if [ -x {shlex.quote(paths['bin'])}/ffmpeg ] && [ -x {shlex.quote(paths['bin'])}/ffprobe ]; then
  FF={shlex.quote(paths['bin'])}/ffmpeg
  FP={shlex.quote(paths['bin'])}/ffprobe
elif [ -x /home/eustace/audiobookshelf/bin/ffmpeg ] && [ -x /home/eustace/audiobookshelf/bin/ffprobe ]; then
  install -m 0755 /home/eustace/audiobookshelf/bin/ffmpeg {shlex.quote(paths['bin'])}/ffmpeg
  install -m 0755 /home/eustace/audiobookshelf/bin/ffprobe {shlex.quote(paths['bin'])}/ffprobe
  FF={shlex.quote(paths['bin'])}/ffmpeg
  FP={shlex.quote(paths['bin'])}/ffprobe
elif command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null; then
  FF=$(command -v ffmpeg)
  FP=$(command -v ffprobe)
else
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  echo "downloading static ffmpeg for arm64" >&2
  curl -fsSL {shlex.quote(FFMPEG_TARBALL)} -o "$TMP/ffmpeg.tar.xz"
  tar -xJf "$TMP/ffmpeg.tar.xz" -C "$TMP"
  SRC=$(find "$TMP" -maxdepth 2 -type f -name ffmpeg | head -1)
  SRC_PROBE=$(find "$TMP" -maxdepth 2 -type f -name ffprobe | head -1)
  [ -n "$SRC" ] && [ -n "$SRC_PROBE" ]
  install -m 0755 "$SRC" {shlex.quote(paths['bin'])}/ffmpeg
  install -m 0755 "$SRC_PROBE" {shlex.quote(paths['bin'])}/ffprobe
  FF={shlex.quote(paths['bin'])}/ffmpeg
  FP={shlex.quote(paths['bin'])}/ffprobe
fi
printf '%s\\n%s\\n' "$FF" "$FP"
"""
    completed = _ssh(config, script, timeout=300)
    lines = [line.strip() for line in (completed.stdout or "").splitlines() if line.strip()]
    if len(lines) < 2:
        raise PorterError("Could not locate or install ffmpeg/ffprobe on the Pi.")
    return {"ffmpeg": lines[-2], "ffprobe": lines[-1]}


def _unit(config, ffmpeg: str, ffprobe: str) -> str:
    paths = remote_paths(config)
    return f"""[Unit]
Description=Shelf (one login, one library, one audio player)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={paths['app']}
ExecStart=/usr/local/bin/node server.mjs
Environment=SHELF_LIBRARY={paths['library']}
Environment=SHELF_DATA={paths['data']}
Environment=SHELF_PORT={config.pi_port}
Environment=SHELF_HOST=0.0.0.0
Environment=SHELF_FFMPEG={ffmpeg}
Environment=SHELF_FFPROBE={ffprobe}
Environment=TZ={config.timezone}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
"""


def _write_unit(config, ffmpeg: str, ffprobe: str) -> None:
    unit = _unit(config, ffmpeg, ffprobe)
    encoded = base64.b64encode(unit.encode("utf-8")).decode("ascii")
    script = f"""set -euo pipefail
mkdir -p ~/.config/systemd/user
printf '%s' {shlex.quote(encoded)} | base64 -d > ~/.config/systemd/user/shelf.service
systemctl --user daemon-reload
systemctl --user enable shelf.service >/dev/null
systemctl --user restart shelf.service
"""
    _ssh(config, script, timeout=60)


def deploy_ui(config) -> Dict:
    require("ssh")
    require("rsync")
    if not (SHELF_SOURCE / "server.mjs").is_file():
        raise PorterError(f"Shelf source is missing: {SHELF_SOURCE}")
    paths = remote_paths(config)
    check = _ssh(
        config,
        "uname -s; uname -m; /usr/local/bin/node --version 2>/dev/null || true",
        timeout=15,
    )
    facts = (check.stdout or "").strip()
    if "Linux" not in facts or "aarch64" not in facts or "v24." not in facts:
        raise PorterError("berry needs Linux arm64 and Node 24 at /usr/local/bin/node.")

    setup = f"""set -euo pipefail
mkdir -p {shlex.quote(paths['root'])} {shlex.quote(paths['app'])} {shlex.quote(paths['data'])} {shlex.quote(paths['library'])} {shlex.quote(paths['bin'])}
chmod 700 {shlex.quote(paths['data'])}
# The old Audiobookshelf UI exposed configuration pages; stop serving it.
systemctl --user disable --now audiobookshelf.service >/dev/null 2>&1 || true
sleep 1
"""
    _ssh(config, setup, timeout=30)
    _rsync(config, SHELF_SOURCE, paths["app"])
    ffmpeg = ensure_ffmpeg(config)
    _write_unit(config, ffmpeg["ffmpeg"], ffmpeg["ffprobe"])

    deadline = time.time() + 30
    last = ""
    while time.time() < deadline:
        probe = _ssh(
            config,
            f"curl -fsS -m 3 http://127.0.0.1:{config.pi_port}/health 2>/dev/null || true",
            check=False,
            timeout=10,
        )
        last = (probe.stdout or "").strip()
        if '"ok":true' in last.replace(" ", ""):
            return {
                "url": config.pi_url,
                "library": paths["library"],
                "ffmpeg": ffmpeg["ffmpeg"],
                "first_run": True,
            }
        time.sleep(2)

    logs = _ssh(
        config,
        "journalctl --user -u shelf.service -n 30 --no-pager 2>&1 || true",
        check=False,
        timeout=15,
    )
    raise PorterError(
        "Shelf did not become healthy. Last log lines:\n"
        + (logs.stdout or "")[-2500:]
        + (f"\nhealth: {last}" if last else "")
    )


def ui_status(config) -> Dict:
    paths = remote_paths(config)
    script = f"""set -euo pipefail
systemctl --user is-active shelf.service 2>/dev/null || true
curl -fsS -m 3 http://127.0.0.1:{config.pi_port}/health 2>/dev/null || true
echo
find {shlex.quote(paths['library'])} -type f -name '*.m4b' 2>/dev/null | wc -l
df -Pk {shlex.quote(paths['library'])} 2>/dev/null | awk 'NR==2 {{print $4}}'
"""
    completed = _ssh(config, script, check=False, timeout=30)
    if completed.returncode != 0:
        detail = (completed.stderr or "").strip().splitlines()
        raise PorterError(detail[-1] if detail else f"could not read status from {config.pi_host}")
    lines = (completed.stdout or "").splitlines()
    active = lines[0].strip() if lines else "unknown"
    health = lines[1].strip() if len(lines) > 1 else ""
    try:
        books = int((lines[2] or "0").strip())
    except (ValueError, IndexError):
        books = 0
    try:
        free_kb = int((lines[3] or "0").strip())
    except (ValueError, IndexError):
        free_kb = 0
    return {
        "active": active,
        "healthy": '"ok":true' in health.replace(" ", ""),
        "books": books,
        "free": human_size(free_kb * 1024) if free_kb else "unknown",
        "library": paths["library"],
        "url": config.pi_url,
    }
