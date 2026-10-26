"""Adapter around audible-cli's own Python API.

This is intentionally a thin layer, not a reimplementation:

* `Session` supplies the profile and auth file the user already configured.
* `Library.from_api_full_sync` supplies the library with the same response
  groups the `audible library export` command uses.
* `download_aax`, `download_aaxc`, `download_cover`, and `download_chapters`
  are the actual functions behind `audible download`, including resume,
  voucher handling, and AAXC fallback.

Only the internals of audible-cli 0.3.x are supported.  `doctor` checks the
version and the adapter fails with a clear message rather than trying to guess
around a changed API.
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from .metadata import normalize
from .util import PorterError, atomic_write, ensure_dir


RESPONSE_GROUPS = (
    "contributors, media, price, product_attrs, product_desc, "
    "product_extended_attrs, product_plan_details, product_plans, "
    "rating, sample, sku, series, reviews, ws4v, origin, "
    "relationships, review_attrs, categories, badge_types, "
    "category_ladders, claim_code_url, is_downloaded, is_finished, "
    "is_returnable, origin_asin, pdf_url, percent_complete, provided_review"
)

LIBRARY_TTL_SECONDS = 12 * 3600
AUDIO_EXTENSIONS = (".aax", ".aaxc", ".m4b", ".m4a", ".mp3", ".mp4")


def _imports():
    try:
        from audible_cli.config import Session
        from audible_cli.models import Library
        from audible_cli.cmds.cmd_download import (
            download_aax,
            download_aaxc,
            download_chapters,
            download_cover,
        )
    except ImportError as error:
        raise PorterError(
            "audible-cli is not installed for this Python. "
            "Install it with `python3 -m pip install --user audible-cli`."
        ) from error
    return Session, Library, download_aax, download_aaxc, download_chapters, download_cover


def audible_version() -> str:
    try:
        import audible_cli

        return getattr(audible_cli, "__version__", "unknown")
    except ImportError:
        return "not installed"


class Audible:
    def __init__(self, profile: Optional[str] = None, quality: str = "best", mode: str = "aax-fallback"):
        self.profile = profile
        self.quality = quality
        self.mode = mode
        self._session = None

    # ---- session ---------------------------------------------------------------

    def session(self):
        Session, _, _, _, _, _ = _imports()
        if self._session is None:
            session = Session()
            if self.profile:
                session.params["profile"] = self.profile
            self._session = session
        return self._session

    def profile_name(self) -> str:
        return self.session().selected_profile

    # ---- library ---------------------------------------------------------------

    async def _fetch_library_async(self):
        _, Library, _, _, _, _ = _imports()
        client = self.session().get_client()
        async with client.session:
            library = await Library.from_api_full_sync(
                api_client=client,
                response_groups=RESPONSE_GROUPS,
                bunch_size=1000,
            )
        return [normalize(item) for item in library]

    def fetch_library(self) -> List[Dict]:
        try:
            return asyncio.run(self._fetch_library_async())
        except PorterError:
            raise
        except Exception as error:
            raise PorterError(f"Could not read the Audible library: {error}") from error

    def cached_or_fetch(self, state, force: bool = False, ttl: int = LIBRARY_TTL_SECONDS) -> Tuple[List[Dict], bool]:
        fetched_at = state.library_fetched_at()
        if not force and fetched_at and time.time() - fetched_at < ttl:
            items = state.library_items()
            if items:
                return items, False
        items = self.fetch_library()
        if not items:
            raise PorterError(
                "Audible returned no books for this profile. "
                "Check `audible library list` and the profile in ~/.audible/config.toml."
            )
        state.cache_library(items)
        return items, True

    def resolve(self, query: str, state, force_refresh: bool = False) -> List[Dict]:
        query = query.strip()
        if not query:
            return []
        if len(query) == 10 and query.isalnum():
            asin = query.upper()
            cached = state.find_library_item(asin)
            if cached:
                return [cached]
            items, _ = self.cached_or_fetch(state, force=force_refresh)
            return [item for item in items if item.get("asin") == asin]

        items, _ = self.cached_or_fetch(state, force=force_refresh)
        needle = query.casefold()
        exact = [
            item
            for item in items
            if needle == str(item.get("title", "")).casefold()
            or needle == str(item.get("asin", "")).casefold()
        ]
        if exact:
            return exact
        return [
            item
            for item in items
            if needle in str(item.get("title", "")).casefold()
            or needle in " ".join(item.get("authors") or []).casefold()
            or needle in str(item.get("asin", "")).casefold()
        ]

    # ---- download --------------------------------------------------------------

    async def _download_async(self, asin: str, output_dir: Path, force: bool) -> Tuple[Dict, str]:
        _, Library, download_aax, download_aaxc, download_chapters, download_cover = _imports()
        client = self.session().get_client()
        async with client.session:
            library = await Library.from_api_full_sync(
                api_client=client,
                response_groups=RESPONSE_GROUPS,
                bunch_size=1000,
            )
            item = None
            for candidate in library:
                if candidate.asin.upper() == asin.upper():
                    item = candidate
                    break
            if item is None:
                raise PorterError(f"ASIN {asin} is not in this Audible library. Run `porter library --refresh`.")
            base = item.create_base_filename("asin_ascii")
            metadata = normalize(item)
            ensure_dir(output_dir)

            if self.mode == "aaxc":
                await download_aaxc(
                    client=client,
                    output_dir=output_dir,
                    base_filename=base,
                    item=item,
                    quality=self.quality,
                    overwrite_existing=force,
                    filename_mode="asin_ascii",
                )
            else:
                await download_aax(
                    client=client,
                    output_dir=output_dir,
                    base_filename=base,
                    item=item,
                    quality=self.quality,
                    overwrite_existing=force,
                    aax_fallback=(self.mode == "aax-fallback"),
                    filename_mode="asin_ascii",
                )
            # Chapters and cover improve the result but are not reasons to
            # throw away a successfully downloaded book.
            try:
                await download_chapters(
                    output_dir=output_dir,
                    base_filename=base,
                    item=item,
                    quality=self.quality,
                    overwrite_existing=force,
                )
            except Exception:
                pass
            try:
                await download_cover(
                    client=client,
                    output_dir=output_dir,
                    base_filename=base,
                    item=item,
                    res=882,
                    overwrite_existing=force,
                )
            except Exception:
                pass
            return metadata, base

    def download(self, asin: str, output_dir: Path, force: bool = False) -> Tuple[Dict, str]:
        asin = asin.strip().upper()
        if len(asin) != 10 or not asin.isalnum():
            raise PorterError(f"Not a valid ASIN: {asin!r}")
        ensure_dir(output_dir)
        try:
            metadata, base = asyncio.run(self._download_async(asin, output_dir, force))
        except PorterError:
            raise
        except Exception as error:
            message = str(error) or error.__class__.__name__
            raise PorterError(f"Audible download failed for {asin}: {message}") from error

        audio = find_audio(output_dir)
        if audio is None:
            raise PorterError(
                f"Audible reported a download for {asin}, but no single audio file is present. "
                "This is usually a multi-part book, which this version does not assemble."
            )
        atomic_write(
            output_dir / "metadata.json",
            json.dumps(metadata, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        )
        return metadata, base

    # ---- activation bytes ------------------------------------------------------

    def activation_bytes(self) -> str:
        """Fetch the AAX activation bytes.  Never display or persist the result."""
        try:
            value = self.session().auth.get_activation_bytes()
        except Exception as error:
            raise PorterError(f"Could not obtain Audible activation bytes: {error}") from error
        value = str(value or "").strip()
        if not value:
            raise PorterError("Audible returned empty activation bytes.")
        return value


def find_audio(folder: Path) -> Optional[Path]:
    candidates = sorted(
        path for path in folder.iterdir() if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS
    )
    if not candidates:
        return None
    # Prefer the decrypted/remuxable formats in the order audible-cli writes them.
    for extension in (".aaxc", ".aax", ".m4b", ".m4a", ".mp3", ".mp4"):
        matching = [path for path in candidates if path.suffix.lower() == extension]
        if matching:
            return max(matching, key=lambda path: path.stat().st_size)
    return candidates[0]


def find_chapter_file(folder: Path) -> Optional[Path]:
    candidates = sorted(folder.glob("*-chapters.json"))
    return candidates[0] if candidates else None


def find_cover(folder: Path) -> Optional[Path]:
    candidates = [
        path
        for path in folder.iterdir()
        if path.is_file() and path.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")
    ]
    if not candidates:
        return None
    # Prefer the 882px cover, then the largest.
    for candidate in candidates:
        if "882" in candidate.name:
            return candidate
    return max(candidates, key=lambda path: path.stat().st_size)


def find_voucher(audio: Path) -> Optional[Path]:
    voucher = audio.with_suffix(".voucher")
    if voucher.is_file():
        return voucher
    candidates = list(audio.parent.glob("*.voucher"))
    return candidates[0] if candidates else None
