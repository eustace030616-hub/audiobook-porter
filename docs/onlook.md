# Onlook

Onlook is the current visual-editor trial. Puck and its studio route have been removed.

## Open the project

In Onlook, open this repository's `clam-web/` directory. It runs Vite against
`https://clam.flowwing.uk` by default:

```bash
pnpm dev
```

Override the API origin for local work:

```bash
CLAM_DEV_ORIGIN=http://127.0.0.1:13378 pnpm dev
```

Sign in inside the canvas; the Vite proxy keeps the cookie local to the canvas.

## Workflow

- Onlook edits real React/TSX and CSS in the repo, not JSON.
- Use Preview for auth, player state and navigation; use select/edit tools for
  layout and copy.
- Keep the player/transcript interaction surfaces read-only.
- Commit code changes; screenshots remain the acceptance evidence.
