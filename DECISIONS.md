# Decisions

One line per decision: decision — reason.

- pnpm workspaces + Node 20+ (dev machine runs 22) — boring, as requested.
- ESLint 9 flat config at repo root — single lint entry point for all packages.
- Shared package is consumed from source (`main` points to `src/index.ts`) — no build step needed in dev; API runs via `tsx`, web via Vite.
- Money is always bigint/string smallest units — no float math.
- API runs in prod via `tsx` (no emit) — shared package is TS source; avoids a bundling step. `build` = typecheck.
