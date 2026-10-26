"""Configuration for porter.

One small JSON file, because the Mac has Python 3.9 and `tomllib` arrived in
3.11.  Environment variables override the file, which is what the tests use.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional

from .util import PorterError, atomic_write, ensure_dir


APP_NAME = "porter"
DEFAULT_PI_APP = "/home/eustace/shelf"
DEFAULT_PI_LIBRARY = f"{DEFAULT_PI_APP}/library"
DEFAULT_PI_HOST = "eustace@berry"
DEFAULT_PI_URL = "http://berry:13378"


def _xdg_config_home() -> Path:
    return Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))


def default_config_path() -> Path:
    override = os.environ.get("PORTER_CONFIG")
    if override:
        return Path(override).expanduser()
    return _xdg_config_home() / APP_NAME / "config.json"


def default_home() -> Path:
    return Path(os.environ.get("PORTER_HOME", str(Path.home() / "Audiobooks"))).expanduser()


@dataclass
class Config:
    home: Path
    config_path: Path
    library: Path
    incoming: Path
    state_dir: Path
    pi_host: str = DEFAULT_PI_HOST
    pi_library: str = DEFAULT_PI_LIBRARY
    pi_app: str = DEFAULT_PI_APP
    pi_url: str = DEFAULT_PI_URL
    pi_port: int = 13378
    timezone: str = "Europe/Dublin"
    audible_profile: Optional[str] = None
    audible_quality: str = "best"
    download_mode: str = "aax-fallback"
    audio_bitrate: str = "copy"
    keep_sources: bool = True
    node_bin: str = "/usr/local/bin/node"
    npm_bin: str = "/usr/local/bin/npm"
    ssh_options: List[str] = field(default_factory=lambda: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"])

    @property
    def lock_path(self) -> Path:
        return self.state_dir / "lock"

    @property
    def db_path(self) -> Path:
        return self.state_dir / "state.sqlite3"

    @property
    def log_dir(self) -> Path:
        return self.state_dir / "logs"

    def ensure_dirs(self) -> None:
        for path in (self.library, self.incoming, self.state_dir, self.log_dir):
            ensure_dir(path)

    def public(self) -> Dict:
        payload = asdict(self)
        payload["home"] = str(self.home)
        payload["config_path"] = str(self.config_path)
        payload["library"] = str(self.library)
        payload["incoming"] = str(self.incoming)
        payload["state_dir"] = str(self.state_dir)
        return payload

    def save(self) -> None:
        payload = self.public()
        atomic_write(
            self.config_path,
            json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            mode=0o600,
        )

    @classmethod
    def load(cls) -> "Config":
        path = default_config_path()
        home = default_home()
        data: Dict = {}
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                raise PorterError(f"Could not read config {path}: {error}") from error

        home = Path(os.environ.get("PORTER_HOME", data.get("home", str(home)))).expanduser()
        library = Path(os.environ.get("PORTER_LIBRARY", data.get("library", str(home / "library")))).expanduser()
        incoming = Path(os.environ.get("PORTER_INCOMING", data.get("incoming", str(home / "incoming")))).expanduser()
        state_dir = Path(os.environ.get("PORTER_STATE", data.get("state_dir", str(home / ".porter")))).expanduser()

        config = cls(
            home=home,
            config_path=path,
            library=library,
            incoming=incoming,
            state_dir=state_dir,
        )
        for key in (
            "pi_host",
            "pi_library",
            "pi_app",
            "pi_url",
            "timezone",
            "audible_profile",
            "audible_quality",
            "download_mode",
            "audio_bitrate",
            "node_bin",
            "npm_bin",
        ):
            env_name = "PORTER_" + key.upper()
            if env_name in os.environ:
                setattr(config, key, os.environ[env_name])
            elif key in data and data[key] is not None:
                setattr(config, key, data[key])
        for env_name, key in (("PORTER_PI_PORT", "pi_port"),):
            if env_name in os.environ:
                try:
                    setattr(config, key, int(os.environ[env_name]))
                except ValueError as error:
                    raise PorterError(f"{env_name} must be an integer") from error
            elif key in data:
                setattr(config, key, int(data[key]))
        if "keep_sources" in data:
            config.keep_sources = bool(data["keep_sources"])
        if os.environ.get("PORTER_KEEP_SOURCES", "").lower() in ("0", "false", "no"):
            config.keep_sources = False

        if config.download_mode not in ("aax-fallback", "aax", "aaxc"):
            raise PorterError("download_mode must be aax-fallback, aax, or aaxc")
        if config.audible_quality not in ("best", "high", "normal"):
            raise PorterError("audible_quality must be best, high, or normal")
        return config


def create_default(home: Optional[Path] = None) -> Config:
    path = default_config_path()
    home = (home or default_home()).expanduser()
    config = Config(
        home=home,
        config_path=path,
        library=home / "library",
        incoming=home / "incoming",
        state_dir=home / ".porter",
    )
    config.ensure_dirs()
    config.save()
    return config
