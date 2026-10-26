"""porter: download, convert, port. Three commands and a shelf at the end."""

from __future__ import annotations

import contextlib
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

import click

from . import __version__
from .audible import Audible, audible_version
from .config import Config, default_config_path, default_home
from .convert import build_all, build_one, convert_local
from .pi import deploy_ui, ui_status
from .state import State
from .transfer import discover_books, library_stats, port_books
from .util import (
    FileLock,
    PorterError,
    ensure_dir,
    human_size,
    is_interactive,
    require,
    run_ssh,
)


CONTEXT_SETTINGS = dict(help_option_names=["-h", "--help"])
_DEBUG = False


def _config() -> Config:
    config = Config.load()
    config.ensure_dirs()
    return config


@contextlib.contextmanager
def _runtime(config: Config, lock: bool = True):
    if lock:
        with FileLock(config.lock_path):
            state = State(config.db_path)
            try:
                yield config, state
            finally:
                state.close()
    else:
        state = State(config.db_path)
        try:
            yield config, state
        finally:
            state.close()


def _audible(config: Config) -> Audible:
    return Audible(profile=config.audible_profile, quality=config.audible_quality, mode=config.download_mode)


def _select(items: List[Dict], query: str) -> Dict:
    if not items:
        raise PorterError(f"No Audible book matched {query!r}. Check the Audible library first.")
    if len(items) == 1:
        return items[0]
    if not is_interactive():
        listing = "\n".join(f"  {item['asin']}  {item['title']}" for item in items[:20])
        raise PorterError(f"More than one book matched {query!r}:\n{listing}\nPass an ASIN.")
    click.echo(f"\n{len(items)} matches:")
    for index, item in enumerate(items[:20], start=1):
        click.echo(f"  {index:>2}. {item['asin']}  {item['title']} — {', '.join(item.get('authors') or [])}")
    choice = click.prompt("Choose", type=click.IntRange(1, min(len(items), 20)), default=1)
    return items[choice - 1]


def _stage(label: str, message: str) -> None:
    click.echo(f"{label:<10} {message}")


def _ok(message: str) -> None:
    click.secho(f"✓ {message}", fg="green")


def _warn(message: str) -> None:
    click.secho(f"! {message}", fg="yellow")


def _fail(message: str) -> None:
    click.secho(f"✗ {message}", fg="red")


@click.group(context_settings=CONTEXT_SETTINGS)
@click.version_option(__version__, prog_name="porter")
@click.option("--debug", is_flag=True, help="show tracebacks")
@click.pass_context
def cli(ctx, debug: bool) -> None:
    """Download, convert, and port audiobooks to berry.

    \b
    porter download <book>     Audible → incoming/
    porter convert [<book>]    incoming/ or a local file → Author/Title/Title.m4b
    porter port                berry receives it, then the Mac copy is removed
    """
    global _DEBUG
    _DEBUG = debug
    ctx.ensure_object(dict)


@cli.command()
@click.option("--force", is_flag=True, help="replace an existing config")
@click.option("--yes", is_flag=True, help="accept defaults, no prompts")
def init(force: bool, yes: bool) -> None:
    """Create the one config file and the local working folders."""
    path = default_config_path()
    if path.exists() and not force:
        raise PorterError(f"Config already exists at {path}. Use --force to replace it.")
    initial = default_home()
    if yes or not is_interactive():
        home = initial
        host = "eustace@berry"
        app = "/home/eustace/shelf"
        library = f"{app}/library"
        url = "http://berry:13378"
    else:
        click.echo("Three answers. Enter accepts the default.\n")
        home = Path(click.prompt("Local audiobook folder", default=str(initial))).expanduser()
        host = click.prompt("Pi SSH destination", default="eustace@berry")
        app = click.prompt("Shelf directory on the Pi", default="/home/eustace/shelf")
        library = click.prompt("Library path on the Pi", default=f"{app}/library")
        url = click.prompt("Shelf URL", default="http://berry:13378")
    config = Config(
        home=home,
        config_path=path,
        library=home / "library",
        incoming=home / "incoming",
        state_dir=home / ".porter",
        pi_host=host,
        pi_app=app,
        pi_library=library,
        pi_url=url,
    )
    config.ensure_dirs()
    config.save()
    _ok(f"config {path}")
    _say = click.echo
    _say(f"  library  {config.library}")
    _say(f"  incoming {config.incoming}")
    _say(f"  Pi       {config.pi_host}:{config.pi_library}")
    _say("")
    _say("Next: porter ui deploy")


@cli.command()
@click.argument("queries", nargs=-1)
@click.option("--force", is_flag=True, help="download again even if the file exists")
@click.option("--refresh", is_flag=True, help="refresh the Audible library cache")
def download(queries, force: bool, refresh: bool) -> None:
    """Download from Audible, using audible-cli's own API and auth.

    QUERIES may be ASINs or title/author substrings.
    """
    if not queries:
        raise PorterError("Pass an ASIN or a title.")
    config = _config()
    audible = _audible(config)
    with _runtime(config) as (config, state):
        if refresh:
            audible.cached_or_fetch(state, force=True)
        chosen = []
        seen = set()
        for query in queries:
            item = _select(audible.resolve(query, state), query)
            if item["asin"] in seen:
                continue
            seen.add(item["asin"])
            chosen.append(item)
        for item in chosen:
            click.echo("")
            _stage("download", f"{item['title']} — {', '.join(item.get('authors') or [])}")
            meta, _base = audible.download(item["asin"], config.incoming / item["asin"], force=force)
            _stage("download", f"ASIN {item['asin']} → {config.incoming / item['asin']}")
        click.echo("")
        _ok(f"{len(chosen)} downloaded. Next: porter convert")


@cli.command()
@click.argument("sources", nargs=-1)
@click.option("--force", is_flag=True, help="convert again even if the output exists")
@click.option("--title", help="override the title (local files)")
@click.option("--author", help="override the author (local files)")
@click.option("--series", help="override the series shelf (local files)")
@click.option("--sequence", help="series number (local files)")
def convert(sources, force: bool, title: Optional[str], author: Optional[str], series: Optional[str], sequence: Optional[str]) -> None:
    """Convert downloads, or a local m4b, into the shelf library.

    With no arguments, converts everything waiting in incoming/.
    A source may be an ASIN, a title from the cached Audible library, or a path
    to a local m4b/m4a/mp3/mp4.
    """
    config = _config()
    audible = _audible(config)
    with _runtime(config) as (config, state):
        results = []
        if not sources:
            if any((title, author, series, sequence)):
                raise PorterError("--title/--author/--series/--sequence need a local file.")
            results = build_all(config, state, force=force, audible=audible)
            if not results:
                _warn("nothing waiting in incoming/")
                return
        else:
            for source in sources:
                path = Path(source).expanduser()
                if path.is_file():
                    _stage("convert", f"{path.name}")
                    results.append(
                        convert_local(
                            config, state, path, title=title, author=author,
                            series=series, sequence=sequence, force=force,
                        )
                    )
                    continue
                if any((title, author, series, sequence)):
                    raise PorterError("Metadata overrides only apply to a local file.")
                asin = source.strip().upper()
                if len(asin) != 10 or not asin.isalnum():
                    item = _select(audible.resolve(source, state), source)
                    asin = item["asin"]
                _stage("convert", asin)
                results.append(build_one(config, state, asin, force=force, audible=audible))
        for result in results:
            if result.get("status") == "skipped":
                _stage("convert", f"already built {result['output']}")
            else:
                chapters = result.get("chapters", 0)
                _stage("convert", f"{result['output']} · {chapters} chapters")
        click.echo("")
        _ok(f"{len(results)} converted. Next: porter port")


@cli.command()
@click.option("--dry-run", is_flag=True, help="show what would be sent, change nothing")
@click.option("--keep", is_flag=True, help="verify on berry but keep the Mac copies")
@click.pass_context
def port(ctx, dry_run: bool, keep: bool) -> None:
    """Send the library to berry; delete the Mac copy only after verification."""
    config = _config()
    with _runtime(config) as (config, state):
        result = port_books(config, dry_run=dry_run, keep=keep)
        click.echo("")
        if dry_run:
            _ok(f"{result['books']} books / {human_size(result['bytes'])} would be sent")
            return
        failed = False
        for item in result["results"]:
            if item["verified"]:
                if item["removed"]:
                    _stage("port", f"✓ {item['relative']} · verified · Mac copy removed")
                else:
                    _stage("port", f"✓ {item['relative']} · verified · kept")
            else:
                failed = True
                reasons = []
                if item["missing"]:
                    reasons.append(f"{len(item['missing'])} missing")
                if item["mismatched"]:
                    reasons.append(f"{len(item['mismatched'])} size mismatches")
                if not item["hash_match"]:
                    reasons.append("sha256 mismatch")
                _stage("port", f"✗ {item['relative']} · {', '.join(reasons) or 'not verified'} · kept")
        click.echo("")
        if failed:
            _fail("some books were not verified; their Mac copies are still here")
            raise click.exceptions.Exit(1)
        _ok(f"{result['books']} verified · {human_size(result['bytes'])} · shelf updated")


@cli.group()
def ui() -> None:
    """The one-time web UI setup and its status."""


@ui.command("deploy")
def ui_deploy() -> None:
    """Install or update Shelf on berry (stops the old Audiobookshelf UI)."""
    config = _config()
    with _runtime(config) as (config, state):
        _stage("ui", "copying the app")
        result = deploy_ui(config)
        _ok(f"live at {result['url']}")
        _stage("ui", f"library {result['library']}")
        _stage("ui", "first visit: set the one password")


@ui.command("status")
def ui_status_command() -> None:
    """Show the Shelf service and the number of books on berry."""
    config = _config()
    remote = ui_status(config)
    click.echo(f"service   {remote['active']}")
    click.echo(f"health    {'ok' if remote['healthy'] else 'not answering'}")
    click.echo(f"books     {remote['books']}")
    click.echo(f"free      {remote['free']}")
    click.echo(f"library   {remote['library']}")
    click.echo(f"url       {remote['url']}")


@cli.command()
def doctor() -> None:
    """Check the few things this pipeline needs."""
    config = _config()
    failures = 0
    warnings = 0

    def check(label: str, function, fatal: bool = False) -> None:
        nonlocal failures, warnings
        try:
            detail = function()
            click.echo(f"  ✓ {label:<22} {detail or ''}")
        except Exception as error:
            if fatal:
                failures += 1
                click.echo(f"  ✗ {label:<22} {error}")
            else:
                warnings += 1
                click.echo(f"  ! {label:<22} {error}")

    click.echo("Local")
    click.echo(f"  · python {sys.version.split()[0]}")
    click.echo(f"  · config {config.config_path}")

    def audible_check():
        version = audible_version()
        if version == "not installed":
            raise PorterError("audible-cli is not installed for this Python")
        from audible_cli.config import Session

        session = Session()
        profile = session.config.primary_profile
        if not profile:
            raise PorterError("no primary profile")
        auth_file = session.config.get_profile_option(profile, "auth_file")
        if not (session.config.dirname / auth_file).is_file():
            raise PorterError(f"missing auth file for profile {profile}")
        return f"{version} · {profile}"

    check("audible-cli", audible_check, fatal=True)
    check("ffmpeg", lambda: require("ffmpeg"), fatal=True)
    check("ffprobe", lambda: require("ffprobe"), fatal=True)
    check("rsync", lambda: require("rsync"), fatal=True)
    check("local library", lambda: f"{library_stats(config.library)['books']} books")
    check("ssh to Pi", lambda: _ssh_check(config), fatal=False)

    try:
        remote = ui_status(config)
        click.echo("\nRemote")
        click.echo(f"  · service   {remote['active']}")
        click.echo(f"  · health    {'ok' if remote['healthy'] else 'not answering'}")
        click.echo(f"  · books     {remote['books']}")
        click.echo(f"  · free      {remote['free']}")
        click.echo(f"  · url       {remote['url']}")
        if not remote["healthy"]:
            warnings += 1
            click.echo("  ! run `porter ui deploy`")
    except PorterError as error:
        warnings += 1
        click.echo(f"\n  ! remote unavailable: {error}")

    click.echo("")
    if failures:
        _fail(f"{failures} blocking problem(s)")
        raise click.exceptions.Exit(1)
    if warnings:
        _warn(f"{warnings} warning(s)")
    else:
        _ok("ready")


def _ssh_check(config: Config) -> str:
    result = run_ssh(config.pi_host, "true", check=False, timeout=12)
    if result.returncode != 0:
        detail = (result.stderr or "").strip().splitlines()
        raise PorterError(detail[-1] if detail else f"ssh {config.pi_host} failed")
    return config.pi_host


def main() -> None:
    try:
        cli(prog_name="porter")
    except PorterError as error:
        _fail(str(error))
        raise SystemExit(1)
    except KeyboardInterrupt:
        _fail("interrupted")
        raise SystemExit(130)
    except Exception as error:
        if _DEBUG:
            raise
        _fail(f"{error.__class__.__name__}: {error}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
