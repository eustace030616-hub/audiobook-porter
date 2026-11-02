<!-- nuvio-cli-template: 1 -->
# nuvio agent instructions

This project uses [nuvio](https://www.npmjs.com/org/nuvio) (dev-only visual editor).

When the user asks to make UI editable or wire nuvio:

1. Do **not** change unrelated files.
2. Prefer **Make Editable** in the browser for new hosts (click-to-tag) — no manual id required for basic flow.
3. When adding ids by hand: **string literal** `data-nuvio-id="region.name"` on the JSX host they should click.
4. `className` may be a string literal, `cn("a", "b")`, or `cn("base", cond && "token")` on supported hosts.
5. Never use `{condition ? "id" : undefined}` for `data-nuvio-id` — use a string literal on the branch they edit.

**Card pattern:**
- `metric.orders.card` (container)
- `metric.orders.label`
- `metric.orders.value`

**Table pattern:**
- `orders.section`, `orders.title`
- `orders.header.products` (column headers)
- `orders.row.${id}.nameText` (row text — template literal id is OK for rows)

**Libraries:** shadcn (`components/ui/`), TailAdmin, DaisyUI — see https://github.com/ehah/Nuvio/tree/main/docs/libraries

**After instrumentation:** user runs `pnpm dev`, Edit on, Preview Changes, Apply to Code.

If Vite or shell wiring is missing, see `nuvio/SETUP_TODO.md` or run `pnpm dlx @nuvio/cli init`.

Human quick path: `nuvio/START_HERE.md`.
