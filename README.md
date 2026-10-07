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

## Real Telegram (bot + tunnel)

Telegram needs **HTTPS**, and `shareToStory` needs a **publicly reachable HTTPS media URL**, so use a tunnel.
Vite proxies `/api` and `/uploads` to the API, so **one tunnel to the web dev server is enough**:

1. Talk to [@BotFather](https://t.me/BotFather): `/newbot` -> copy the token and username.
2. Start a tunnel to the web port, e.g. `cloudflared tunnel --url http://localhost:5173` (or `ngrok http 5173`) and copy the `https://…` URL.
3. In `.env`:
   ```
   BOT_TOKEN=<token>          BOT_USERNAME=<bot username without @>
   BOT_ENABLED=true           BOT_MODE=polling
   WEBAPP_URL=<tunnel url>    PUBLIC_BASE_URL=<tunnel url>
   CORS_ORIGINS=<tunnel url>
   DEV_MODE=false             VITE_DEV_MOCK=false
   ```
4. BotFather: `/newapp` (pick the bot, set the Web App URL to the tunnel URL, remember the short name -> optional
   `APP_SHORT_NAME`) and/or `/setmenubutton` with the same URL. Links then look like
   `https://t.me/<bot>?startapp=chain_<id>` (or `https://t.me/<bot>/<short>?startapp=…` when `APP_SHORT_NAME` is set).
5. `pnpm dev`, open the bot in Telegram, send `/start`, tap the button.
6. Verify: create a chain, publish a card — Telegram's story editor opens with your image and the caption containing the link;
   Premium accounts additionally get the "Join the chain" widget. Open the link from a second account: the Mini App opens on that chain.

On Telegram clients older than 7.8 the app falls back to opening the image + copying the link.
The manual checks per platform are listed in `CHECKLIST.md` (added in Phase 6).

## Card editor

`/chain/:id/join` opens the editor: pick/take a photo, pan/pinch/scroll to frame it, choose a template and font
(PRO items are badged and open the paywall), add an optional caption and publish. The client renders the
1080x1920 JPEG on a native canvas (`apps/web/src/editor/renderCard.ts`) and uploads it; free users get the
watermark added **server-side**. Templates live in `packages/shared/src/templates.ts` (data, not code);
fonts in `apps/web/public/fonts` (OFL, see `LICENSES.txt`).

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
