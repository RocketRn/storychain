# StoryChain

Telegram Mini App — "Add Yours" for Telegram Stories. (README is expanded each phase.)

## Setup

```bash
pnpm install
cp .env.example .env
pnpm --filter @storychain/api db:deploy   # apply migrations (SQLite file apps/api/prisma/dev.db)
pnpm --filter @storychain/api db:seed     # demo users, featured chains, sample posts
pnpm dev        # api :3000, web :5173
pnpm typecheck && pnpm lint
```

## Mock mode (plain desktop browser, no Telegram)

```bash
cp .env.example .env   # DEV_MODE=true, VITE_DEV_MOCK=true by default
pnpm --filter @storychain/api db:deploy && pnpm --filter @storychain/api db:seed
pnpm dev               # open http://localhost:5173
```

- Identity & context via query params: `?mock_user=2` (1..4 are seeded demo users), `?mock_premium=1`,
  `?mock_platform=tdesktop|ios|android`, `?mock_lang=en`, `?mock_start_param=chain_cat00001`.
- The **🛠 Dev** button (bottom right) switches user, toggles PRO, expires PRO in 1 minute, resets today's usage,
  toggles Telegram Premium / language / platform.
- Telegram's Back/Main buttons are rendered as DOM elements; haptics are logged to the console.
- Safety: the API refuses `DEV_MODE=true` with `NODE_ENV=production`; `vite build` fails if `VITE_DEV_MOCK=true`;
  the mock code is not part of production bundles.

## Tests

```bash
pnpm test        # shared + api + web unit tests (Vitest; API tests use a temp SQLite DB with the real migrations)
pnpm e2e         # Playwright (desktop Chromium, mock mode; spins up its own API + web with a fresh DB)
```

## Database

SQLite in dev (`DATABASE_URL=file:./dev.db`, relative to `apps/api/prisma`). For PostgreSQL in production:

1. In `apps/api/prisma/schema.prisma` change `provider = "sqlite"` to `"postgresql"`.
2. Delete `apps/api/prisma/migrations`, set `DATABASE_URL=postgresql://...`, run
   `pnpm --filter @storychain/api db:migrate -- --name init` (migrations are provider-specific).
3. Deploy with `db:deploy`.

The schema uses no enums or provider-specific features, so no other changes are needed.

## API quick reference (Phase 1)

`/api/health`, `/api/chains/:id/public` are public; everything else needs `Authorization: tma <initData>`.
Errors are `{ "error": { "code", "message" } }` with codes from `packages/shared/src/errors.ts`.
With `DEV_MODE=true`, `POST /api/dev/init-data {"userId":1000001}` returns signed initData for curl testing.
