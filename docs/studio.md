# Clam UI Studio

Puck is embedded as a **development-only design surface**, not a production CMS.

```bash
cd clam-web
pnpm dev
open http://127.0.0.1:5173/studio
```

The editor is served from `studio.html`; production `pnpm build` does not emit it
and the main PWA bundle does not contain Puck.

## Live cooperation

There is no export/import step. Every Puck change is written after 250 ms to:

```text
clam-web/ui/studio.json
```

The file is the shared state. A person edits in the browser; the agent reads the
same file and can change the real components/CSS while Vite HMR updates the
editor. Screenshots of `/studio` and the production app are still the acceptance
evidence.

## Components

The first registry is deliberately small:

```text
Hero        heading/body rhythm
Shelf       series rail with mock covers
Player      dark player dock
Transcript  transcript row
Note        design note
```

These are design blocks, not live app data. The production app's routing,
player state, auth and progress are untouched.

## Guardrails

- `/studio` is not in the production build.
- No backend; state is a local file.
- Do not let Puck own the app shell or interactive player state.
- When a change is accepted, port it into the real React/CSS and capture
  before/after screenshots under `ui/`.
