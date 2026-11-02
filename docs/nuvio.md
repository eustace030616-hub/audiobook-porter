# Nuvio

Nuvio is the current visual-editor trial. It edits real React/TSX and Tailwind
classes in this repo, works only in `vite dev`, and needs no AI subscription.

Puck and Onlook are not part of the running setup.

## Run

```bash
cd clam-web
pnpm dev
```

Open the printed localhost URL, then use the **nuvio** chip:

1. Click the chip to open the panel.
2. Choose the **Edit** tab (Element). The panel opens on Brand Kit by default.
3. Click a tagged element → **Preview Changes** → **Apply to Code**.

At phone widths the nuvio panel covers the page, so click-to-select only works when the browser window is wide enough (use the Mac at ~1000px+). Element hosts currently tagged: `login.title`, `login.body`, `login.submit`, `page.title`, `shelf.title`, `book.title`, `player.chapter`.

- **Make Editable** tags an element that has no `data-nuvio-id` yet
- **Brand Kit** applies category-level styles across a page

The Vite dev proxy points at `https://clam.flowwing.uk`, so sign in inside the
canvas; the session cookie stays local to the canvas.

## Cooperation

Nuvio writes actual source patches. There is no JSON export or separate design
document:

```text
you edit the canvas
      ↓
Nuvio applies TSX/Tailwind changes
      ↓
git diff is the shared record
      ↓
I review the diff and continue from the same source
```

The overlay is dynamically imported only when `import.meta.env.DEV` is true;
production builds do not load it.

## Safety

- Do not commit the generated overlay bundle; it is dev-only.
- Keep player, transcript and auth interactions read-only; edit presentation.
- Run `pnpm check && pnpm build && pnpm test` after a batch of edits.
- Opt out of anonymous telemetry with `NUVIO_TELEMETRY=0` and
  `localStorage.setItem("nuvio.telemetry", "0")` in the browser.
