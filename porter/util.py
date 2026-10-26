"""Small shared helpers: errors, sizes, sanitising, locking, process output.

Nothing here is allowed to print a credential.  Callers that handle one must
pass it through `redact()` before a line reaches the terminal or a log file.
"""

from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from typing import Iterable, List, Optional, Sequence


class PorterError(Exception):
    """An expected failure with a message meant for the user."""


def which(name: str) -> Optional[str]:
    return shutil.which(name)


def require(name: str, hint: str = "") -> str:
    path = which(name)
    if path is None:
        extra = f" {hint}" if hint else ""
        raise PorterError(f"{name!r} is not installed or not on PATH.{extra}")
    return path


def human_size(count: Optional[int]) -> str:
    if count is None:
        return "—"
    size = float(count)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            if unit == "B":
                return f"{int(size)} B"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def human_duration(seconds: Optional[int]) -> str:
    """`27h 14m` for audiobook runtimes, not `1630 minutes`."""
    if seconds is None:
        return "—"
    seconds = max(0, int(seconds))
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    if minutes:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


def human_age(timestamp: Optional[float]) -> str:
    if timestamp is None:
        return "never"
    delta = max(0, int(time.time() - timestamp))
    if delta < 60:
        return f"{delta}s ago"
    if delta < 3600:
        return f"{delta // 60}m ago"
    if delta < 86400:
        return f"{delta // 3600}h ago"
    return f"{delta // 86400}d ago"


def sanitize_component(value: str, fallback: str = "Unknown", limit: int = 120) -> str:
    """A safe single path component, preserving Unicode and readability.

    Keeps the title recognisable for Audiobookshelf's folder parser.  The
    filesystem-invalid characters are removed rather than replaced with
    underscores; punctuation that remains is meaningful in a title.
    """
    value = unicodedata.normalize("NFC", value or "").strip()
    value = re.sub(r"[\x00-\x1f\x7f/\\:*?\"<>|]", "", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    if not value:
        value = fallback
    if len(value) > limit:
        value = value[:limit].rstrip(" .")
    # Keep the UTF-8 filename under a conservative byte budget so a title of
    # emoji or CJK characters cannot exceed the filesystem component limit.
    while len(value.encode("utf-8")) > 180:
        value = value[:-1].rstrip(" .")
    return value or fallback


def unique_path(base: Path, suffix: str = "") -> Path:
    """Append ` (2)`, ` (3)` … when a target already exists."""
    candidate = base.with_name(base.name + suffix)
    if not candidate.exists():
        return candidate
    counter = 2
    while True:
        candidate = base.with_name(f"{base.name} ({counter}){suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def sha1_text(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


def sha1_file(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def atomic_write(path: Path, content: str, mode: int = 0o644) -> None:
    """Write next to the target and rename, so a crash never leaves half a file."""
    ensure_dir(path.parent)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def atomic_copy(source: Path, target: Path, mode: int = 0o644) -> None:
    ensure_dir(target.parent)
    temporary = target.with_name(f".{target.name}.tmp-{os.getpid()}")
    try:
        shutil.copyfile(source, temporary)
        os.chmod(temporary, mode)
        os.replace(temporary, target)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def load_json(path: Path, default=None):
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PorterError(f"Could not read {path}: {error}") from error


def write_json(path: Path, payload, mode: int = 0o644) -> None:
    atomic_write(path, json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n", mode)


def run(
    command: Sequence[str],
    *,
    cwd: Optional[Path] = None,
    env: Optional[dict] = None,
    input_text: Optional[str] = None,
    check: bool = True,
    capture: bool = True,
    timeout: Optional[int] = None,
    display: Optional[str] = None,
) -> subprocess.CompletedProcess:
    """Run a command without putting it through a shell.

    `display` is what is safe to print if the real argv contains a secret.
    ffmpeg's activation bytes and AAXC key go in argv, so no caller may print
    the raw command.
    """
    try:
        completed = subprocess.run(
            list(command),
            cwd=str(cwd) if cwd else None,
            env=env,
            input=input_text,
            text=True,
            stdout=subprocess.PIPE if capture else None,
            stderr=subprocess.PIPE if capture else None,
            timeout=timeout,
        )
    except FileNotFoundError as error:
        raise PorterError(f"Command not found: {command[0]}") from error
    except subprocess.TimeoutExpired as error:
        raise PorterError(f"Command timed out after {timeout}s: {display or command[0]}") from error
    if check and completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()
        detail = stderr or stdout or f"exit {completed.returncode}"
        raise PorterError(f"{display or command[0]} failed: {detail[-1200:]}")
    return completed


def run_ssh(
    host: str,
    script: str,
    *,
    check: bool = True,
    timeout: Optional[int] = None,
    capture: bool = True,
    ssh_options: Optional[Iterable[str]] = None,
) -> subprocess.CompletedProcess:
    command = ["ssh"]
    command.extend(ssh_options or ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"])
    command.extend([host, script])
    return run(command, check=check, timeout=timeout, capture=capture, display=f"ssh {host}")


def shell_quote(value: str) -> str:
    import shlex

    return shlex.quote(value)


def redact(value: str, secrets: Iterable[str]) -> str:
    result = value
    for secret in secrets:
        if secret and len(secret) >= 4:
            result = result.replace(secret, "[redacted]")
    # Common accidental shapes in tool output.
    result = re.sub(r"(?i)(activation[_ -]?bytes)[=: ]+[0-9a-f]{6,}", r"\1=[redacted]", result)
    result = re.sub(r"(?i)(audible_(?:key|iv))[=: ]+[0-9a-f]{16,}", r"\1=[redacted]", result)
    return result


class FileLock:
    """An advisory lock held for the duration of one CLI operation."""

    def __init__(self, path: Path):
        self.path = path
        self.handle = None

    def __enter__(self):
        ensure_dir(self.path.parent)
        self.handle = self.path.open("a+")
        try:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self.handle.seek(0)
            owner = self.handle.read().strip() or "another process"
            self.handle.close()
            self.handle = None
            raise PorterError(f"Another porter run is already active ({owner}).") from error
        self.handle.seek(0)
        self.handle.truncate()
        self.handle.write(f"pid {os.getpid()} since {int(time.time())}\n")
        self.handle.flush()
        return self

    def __exit__(self, *exc_info):
        if self.handle is not None:
            with contextlib.suppress(OSError):
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()
            self.handle = None


@contextlib.contextmanager
def prepend_path(path: Path):
    old = os.environ.get("PATH", "")
    os.environ["PATH"] = f"{path}{os.pathsep}{old}" if old else str(path)
    try:
        yield
    finally:
        os.environ["PATH"] = old


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def is_interactive() -> bool:
    return sys.stdin.isatty() and sys.stdout.isatty()
