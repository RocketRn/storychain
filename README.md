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

## Tests

```bash
pnpm test        # shared + api (Vitest; API tests use a temp SQLite DB with the real migrations)
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
