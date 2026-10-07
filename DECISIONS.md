# Decisions

One line per decision: decision — reason.

- pnpm workspaces + Node 20+ (dev machine runs 22) — boring, as requested.
- ESLint 9 flat config at repo root — single lint entry point for all packages.
- Shared package is consumed from source (`main` points to `src/index.ts`) — no build step needed in dev; API runs via `tsx`, web via Vite.
- Money is always bigint/string smallest units — no float math.
- API runs in prod via `tsx` (no emit) — shared package is TS source; avoids a bundling step. `build` = typecheck.
- Prisma 6 (not 7) — 7 changes client/config setup; 6 is stable and works with both SQLite and PostgreSQL.
- No Prisma enums; enum-like columns are Strings validated by zod — keeps SQLite/PostgreSQL parity.
- SQLite files get `connection_limit=1` appended automatically — SQLite has a single writer; pooled connections cause SQLITE_BUSY under concurrency.
- Postgres migrations are provider-specific: when switching provider, delete `prisma/migrations` and run `prisma migrate dev --name init` against Postgres (documented in README).
- Auth is two-layer: a global `onRequest` hook sets `request.user` (so rate limits can key on user id), `requireAuth` preHandler enforces — avoids unauthenticated requests being keyed per user.
- Users are auto-created on first authenticated request (not only via /auth/session) — concurrent first requests are handled (P2002 re-read).
- Chain lists use offset cursors (opaque number) — simple and fine at this scale; gallery uses keyset cursor on `position`. "trending" = postsCount desc, then newest.
- Gallery order is newest first (position desc).
- Re-posting to a chain counts as a publication for the daily limit (conservative) and keeps the original position; it never un-hides a moderated post.
- Daily limit: cheap pre-flight check before image processing, authoritative atomic conditional increment inside the DB transaction; failed validations never consume quota. Orphaned uploaded files after a lost race are accepted (unique keys, harmless).
- Server watermark is a text pill rendered with a bundled OFL font (Inter Bold, `apps/api/assets/fonts`) placed 220px above the bottom edge — sits above the ~250px bottom band so the Telegram story UI does not cover it.
- Uploads accepted: JPEG/PNG only, exactly 1080x1920, re-encoded to JPEG q90 (metadata stripped); thumbnail 360px wide.
- Demo/dev identities: telegramId 1000000+N = `?mock_user=N`; seed creates users 1000001..1000004. Seeded chains have fixed ids (cat00001, desk0002, trk00003).
- Platform method flag lives in `packages/shared/src/plans.ts` (`allowedMethods`): Stars only on ios/android unless `TON_PAYMENTS_ALL_PLATFORMS=true`. Owner must verify against current Telegram rules.
- Web uses `react-router-dom` v6 (BrowserRouter) + TanStack Query v5; no Zustand — server state lives in Query, the little UI state is local/hooks.
- `tg` facade is a Proxy over the real/mock implementation chosen once in `initTelegram()`; components never touch `window.Telegram`.
- Mock is selected by the build-time constant `import.meta.env.VITE_DEV_MOCK === "true"` and loaded through dynamic `import()` — Vite drops it (and MockUI/DevTools) from production bundles (verified by grepping `dist`); `vite.config.ts` additionally fails any production-mode build with the flag on.
- Mock identity (`mock_user`, `mock_premium`, `mock_platform`, `mock_lang`) is persisted in localStorage so SPA navigation and DevTools switches survive reloads; query params override it when present.
- Greeting/name displayed in UI comes from the server session (authoritative), not from client-side initDataUnsafe.
- Mock initData is signed at page load and is valid for 1h (server maxAge); the mock does not auto-refresh — reload the page after an hour.
- API base in the web app is same-origin `/api` (Vite proxy in dev, Fastify single-origin in prod); `VITE_API_URL` is optional.
- E2E uses its own SQLite file + upload dir, API on :3100 and web on :5273 (single origin via the Vite proxy), recreated on every run. The sandbox's preinstalled Chromium is used via `executablePath` (override with `PW_CHROMIUM`).
- Seed removes the demo users' DailyUsage rows so seeding never consumes their daily quota.
