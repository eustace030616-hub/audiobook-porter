# Continuous playback: HLS plan

## Problem

The library keeps one continuous `book.m4b` per book and one small M4B per
chapter. The web client originally streamed the single large MP4 to get iOS
lock-screen chapter advancement. Through the public Tailscale Funnel the Apple
player appears but does not play that 600 MB response. The small chapter files
play normally.

The immediate client change makes split chapters the default. This keeps audio
working on the public URL; the trade-off is that chapter advancement while the
phone is locked needs JavaScript.

## Status

HP1 (`Harry Potter und der Stein der Weisen`) is packaged and validated in
WebKit: HLS source selected, chapter 2 seeked to 41s, and playback advanced.
The client falls back to split chapters on Chromium, for books without HLS, and
when an HLS source errors: it loads the network split chapter at the same
chapter-relative position (or the cached chapter when offline).

## Target

HLS with fMP4/AAC segments:

```
book/
  hls/
    master.m3u8
    book.m3u8
    00000.m4s
    00001.m4s
    ...
```

- 6-second segments, one MP4 init segment.
- Chapter boundaries remain in `metadata.json`; progress stays chapter-relative.
- The playlist and segments are served as static files through the existing
  authenticated `/hls/<bookId>/...` route.
- Safari/iOS uses native HLS. Chromium uses `hls.js` only if native HLS is absent.
- Split chapter files remain the fallback and the offline cache source.

## Packaging

On the Pi:

```bash
python3 scripts/make_hls.py --library ~/shelf/library --book "<book-folder>" --force
```

The script reads `book.m4b` or the ordered chapter files, writes the HLS tree
next to the book, and records `hls_file` / `hls_playlist` in `metadata.json`.
Run one book first; verify from the public URL before packaging the rest.

## Client flow

1. `audioUrl` stays chapter-first.
2. An opt-in `hls` source is used only when `audio.canPlayType` (or hls.js)
   supports it and HLS is enabled for the book.
3. If the HLS manifest/segment fails, switch to the current split chapter at the
   same chapter-relative position.
4. The media session and chapter labels continue to come from `metadata.json`.
5. Offline playback continues to use the cached split chapters; HLS is online-only
   for the first release.

## Acceptance

- Public Funnel: play HP1 for 30 minutes without exit or silent player.
- Lock the iPhone; playback continues across a chapter boundary.
- Seek across a chapter boundary and resume at the expected position.
- Switch Wi-Fi to cellular and back; HLS falls back to split chapters if needed.
- Chapter cache and offline boot still work.
- `pnpm build`, client tests, server tests and Python tests pass.

## Rollout

1. Package HP1 only.
2. Test on iPhone Safari/PWA and desktop Chromium via the public URL.
3. Enable HLS per book through metadata; keep split chapters as default fallback.
4. Package the remaining library only after the HP1 acceptance run.
