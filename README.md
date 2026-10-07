# StoryChain

A Telegram **Mini App**: the "Add Yours" sticker for Telegram Stories.

1. Pick or create a challenge ("Show your cat", "Your desk right now", …).
2. Add a photo — the app composes a 1080×1920 story card with a "Your turn" sticker and a `#N` badge.
3. One tap publishes it to Telegram Stories with a deep link `https://t.me/<bot>?startapp=chain_<id>`.
4. Friends tap the link, land on the chain, see the gallery, join and re-share. 🔁

Russian (default) and English. Free plan: 3 publications/day with a watermark. PRO (30 days): no limit, no watermark,
premium templates and fonts — paid with **Telegram Stars** or **GRM** (Gram jetton on TON).

```
apps/web      Vite + React 18 + TS + Tailwind — the Mini App (+ canvas card editor, mock mode)
apps/api      Fastify + Prisma + grammY bot + payments (Stars, TON verifier)
packages/shared   zod schemas, DTOs, plans, templates, money helpers (toUnits/fromUnits)
e2e/          Playwright tests (desktop Chromium, mock mode)
scripts/      setup + single-origin smoke test
DECISIONS.md  every assumption and why      CHECKLIST.md  manual checks in real Telegram
```

## Quick start (≈ 5 minutes, no Telegram needed)

Requirements: **Node ≥ 20** and **pnpm ≥ 9** (`corepack enable` gets you pnpm).

```bash
pnpm install
pnpm setup        # creates .env (mock mode), generates the Prisma client, migrates + seeds the SQLite DB
pnpm dev          # api http://localhost:3000, web http://localhost:5173
```

Open <http://localhost:5173>. You are "Anna" (demo user 1) in **mock mode** — a desktop-browser stand-in for Telegram.

### Mock mode

`DEV_MODE=true` (API) + `VITE_DEV_MOCK=true` (web) — both are on in the default `.env`.

- Switch identity/context with query params: `?mock_user=2` (1–4 are seeded demo users, any number works),
  `?mock_premium=1`, `?mock_platform=tdesktop|ios|android`, `?mock_lang=en`, `?mock_legacy=1`,
  `?mock_start_param=chain_cat00001`.
- The **🛠 Dev** button (bottom right) switches user, toggles PRO, expires PRO in 1 minute, resets today's usage,
  toggles Telegram Premium / language / platform / "legacy client (<7.8)".
- `shareToStory` opens a **fake story composer** showing exactly what Telegram would receive (image, caption with link,
  widget link for Premium users, "Download PNG", "open the link as User N").
- Stars: a fake payment dialog (Pay / Cancel / Fail). GRM: a "Simulate GRM payment" panel. Both run the **real**
  server-side order → ledger → PRO path via `POST /api/dev/payments/:reference/complete`.
- Telegram's Back/Main buttons are rendered as DOM elements; haptics are logged to the console.
- No `TONAPI_KEY`, `TON_MERCHANT_ADDRESS`, bot token or network access is needed; the TON startup self-check is skipped.
- Safety: the API **refuses to start** with `DEV_MODE=true` and `NODE_ENV=production`; `vite build` fails if
  `VITE_DEV_MOCK=true`; the web `build` script forces it off; the mock code is not in production bundles (verified in CI-style
  tests/greps).

### Walk through the viral loop

1. As Anna: **Create chain** → open it → **Join** → pick any photo → choose a template → **Publish to Story**.
2. The fake story composer opens. Click **User 2** → the app reloads as Boris, directly on that chain (start_param routing).
3. **Join** as Boris, publish, close the preview → **Open chain**: 2 participants. 🎉
4. Hit the free limit (3/day) → paywall → pay → keep going without a watermark.

## Real Telegram (bot + tunnel)

Telegram needs **HTTPS**, and `shareToStory` needs a **publicly reachable HTTPS media URL** (a blob/data URL does not work).
Vite proxies `/api` and `/uploads` to the API, so **one tunnel to the web dev server is enough**:

1. [@BotFather](https://t.me/BotFather): `/newbot` → token + username.
2. Tunnel: `cloudflared tunnel --url http://localhost:5173` (or `ngrok http 5173`) → copy the `https://…` URL.
3. `.env`:
   ```
   BOT_TOKEN=<token>          BOT_USERNAME=<username without @>     VITE_BOT_USERNAME=<same>
   BOT_ENABLED=true           BOT_MODE=polling
   WEBAPP_URL=<tunnel url>    PUBLIC_BASE_URL=<tunnel url>          CORS_ORIGINS=<tunnel url>
   DEV_MODE=false             VITE_DEV_MOCK=false                   TRUST_PROXY=true
   ```
4. BotFather `/newapp` (Web App URL = tunnel URL; remember the short name → optional `APP_SHORT_NAME` /
   `VITE_APP_SHORT_NAME`) and/or `/setmenubutton` with the same URL.
5. `pnpm dev`, open the bot, send `/start`, tap the button.
6. Verify the loop and the payment flows with [`CHECKLIST.md`](./CHECKLIST.md) on Android, iOS and Desktop.

Premium vs non-Premium: the story **caption always contains the link**; Premium authors additionally get the
`widget_link` sticker ("Join the chain"). Clients older than 7.8 fall back to opening the image + copying the link.

## Production (single origin)

`pnpm build` builds the web app; with `SERVE_WEB=true` (default when `NODE_ENV=production`) the API serves
`apps/web/dist` **and** `/api` **and** `/uploads` from one origin, with a CSP that allows Telegram's script and framing by
Telegram Web, immutable caching for hashed assets and `Access-Control-Allow-Origin: *` on the TonConnect manifest.

```bash
pnpm install --frozen-lockfile
pnpm build                                   # web build also writes the TonConnect manifest from WEBAPP_URL
NODE_ENV=production pnpm --filter @storychain/api db:deploy
NODE_ENV=production pnpm --filter @storychain/api start     # reads ../../.env; put TLS (Caddy/nginx/Cloudflare) in front
pnpm smoke                                   # boots a throw-away instance on :3200 and checks the whole stack
```

Production checklist: real `BOT_TOKEN`/`BOT_USERNAME`, `BOT_MODE=webhook` + `WEBHOOK_URL` + `WEBHOOK_SECRET`,
https `PUBLIC_BASE_URL`/`WEBAPP_URL`, `TON_MERCHANT_ADDRESS`, `TONAPI_KEY`, `TRUST_PROXY=true` behind a proxy,
`STORAGE_DRIVER=s3` (or a persistent volume), PostgreSQL. The API fails fast with a clear message when a required variable
is missing, `DEV_MODE=true` is set, or `PUBLIC_BASE_URL` is not https. Compression is left to the reverse proxy.

### Database

SQLite in dev (`DATABASE_URL=file:./dev.db`, relative to `apps/api/prisma`). PostgreSQL in production:

1. `apps/api/prisma/schema.prisma`: `provider = "sqlite"` → `"postgresql"`.
2. Delete `apps/api/prisma/migrations`, set `DATABASE_URL=postgresql://…`, run
   `pnpm --filter @storychain/api db:migrate -- --name init` (migrations are provider-specific), then `db:deploy` on servers.

The schema has no enums or provider-specific features (enum-like columns are strings validated by zod), so nothing else changes.

## Payments (PRO)

PRO = 30 days (`proUntil`): **150 Stars** or **`GRM_PRO_30D_PRICE` GRM** (placeholder `100` — _set the real price_).
Plans live in `packages/shared/src/plans.ts`; money is bigint/string in smallest units (`toUnits("0.5", 9) → 500000000n`).

- **Stars:** the bot answers `pre_checkout_query`, grants PRO on `successful_payment` (idempotent on
  `telegram_payment_charge_id`), revokes on `refunded_payment`. Refund: `pnpm --filter @storychain/api refund <reference|chargeId>`.
- **GRM on TON:** the user connects a wallet (TonConnect) and signs a TEP-74 Jetton transfer whose forward payload is the
  payment reference. A background job (every 10 s) matches incoming transfers to `TON_MERCHANT_ADDRESS` via TonAPI.
  Startup self-check: the jetton's on-chain decimals must equal `GRM_DECIMALS`, otherwise the API **refuses to start**.
  Addresses are always compared in raw form. Late payments (≤ 24 h after expiry) are honored.
- **Testnet:** the real GRAM jetton exists on mainnet only. For a testnet run set `TON_NETWORK=testnet`, deploy a standard
  TEP-74 jetton (e.g. with [Blueprint](https://github.com/ton-org/blueprint)), mint some to a testnet wallet, set
  `GRM_JETTON_MASTER` to it and `TON_MERCHANT_ADDRESS` to a testnet wallet. Mock mode covers everything else without a chain.
- **Platform policy:** by default GRM is hidden **and rejected by the API** on iOS/Android (Stars only);
  `TON_PAYMENTS_ALL_PLATFORMS=true` overrides. **Verify against Telegram's current rules for digital goods in Mini Apps.**

## Environment variables

Everything configurable is in `.env` (see [`.env.example`](./.env.example) for comments). Bold = required in production.

| Variable                                                                                                             | Default                          | Purpose                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                                           | `development`                    | `production` enables fail-fast checks and single-origin serving                                                      |
| `PORT`                                                                                                               | `3000`                           | API port                                                                                                             |
| `DEV_MODE`                                                                                                           | `false`                          | Enables `/api/dev/*` and mock helpers. **Refused in production**                                                     |
| `CORS_ORIGINS`                                                                                                       | `http://localhost:5173`          | Comma-separated allowlist                                                                                            |
| `SERVE_WEB` / `WEB_DIST_DIR`                                                                                         | on in prod / `../web/dist`       | Serve the built web app from the API                                                                                 |
| `TRUST_PROXY`                                                                                                        | `false`                          | Trust `X-Forwarded-For` (set behind a proxy/tunnel)                                                                  |
| `INITDATA_MAX_AGE_SEC`                                                                                               | `86400`                          | How long Telegram initData is accepted                                                                               |
| `DATABASE_URL`                                                                                                       | `file:./dev.db`                  | SQLite (dev) or PostgreSQL URL                                                                                       |
| **`BOT_TOKEN`**                                                                                                      | dev dummy                        | Bot token (used for initData validation and the bot)                                                                 |
| **`BOT_USERNAME`**                                                                                                   | `storychain_bot`                 | Builds `t.me/<bot>?startapp=…` links                                                                                 |
| `APP_SHORT_NAME`                                                                                                     | –                                | Use `t.me/<bot>/<short>?startapp=…` links                                                                            |
| `BOT_ENABLED`                                                                                                        | on in prod                       | Start the bot (needs a real token)                                                                                   |
| `BOT_MODE`                                                                                                           | `polling`                        | `polling` (dev) or `webhook` (prod)                                                                                  |
| **`WEBHOOK_URL`**, **`WEBHOOK_SECRET`**                                                                              | –                                | Required when `BOT_MODE=webhook` (secret-token header is verified)                                                   |
| **`WEBAPP_URL`**                                                                                                     | `http://localhost:5173`          | Public https URL of the Mini App (bot buttons, TonConnect manifest)                                                  |
| **`PUBLIC_BASE_URL`**                                                                                                | `http://localhost:3000`          | Public base of the API/uploads — **https in production**                                                             |
| `STORAGE_DRIVER`                                                                                                     | `local`                          | `local` or `s3`                                                                                                      |
| `UPLOAD_DIR`                                                                                                         | `./uploads`                      | Local storage directory                                                                                              |
| `S3_ENDPOINT`, `S3_REGION`, **`S3_BUCKET`**, **`S3_ACCESS_KEY_ID`**, **`S3_SECRET_ACCESS_KEY`**, **`S3_PUBLIC_URL`** | –                                | S3-compatible storage (bold ones when `s3`)                                                                          |
| **`GRM_JETTON_MASTER`**                                                                                              | GRAM master (see `.env.example`) | Jetton master address                                                                                                |
| `GRM_DECIMALS` / `GRM_SYMBOL`                                                                                        | `9` / `GRAM`                     | Verified on-chain at startup                                                                                         |
| `GRM_PRO_30D_PRICE`                                                                                                  | `100`                            | **Placeholder**, human amount; converted with bigint math                                                            |
| **`TON_MERCHANT_ADDRESS`**                                                                                           | –                                | Receives GRM (empty is fine in dev/mock)                                                                             |
| `TON_NETWORK`                                                                                                        | `mainnet`                        | `mainnet` / `testnet`                                                                                                |
| **`TONAPI_KEY`**                                                                                                     | –                                | TonAPI key (not needed in mock mode)                                                                                 |
| **`TONCONNECT_MANIFEST_URL`**                                                                                        | –                                | Production sanity check only; the web app uses `VITE_TONCONNECT_MANIFEST_URL` or `<origin>/tonconnect-manifest.json` |
| `TON_PAYMENTS_ALL_PLATFORMS`                                                                                         | `false`                          | Offer GRM on iOS/Android too                                                                                         |
| `VITE_DEV_MOCK`                                                                                                      | `true` in `.env.example`         | Mock Telegram in the browser (forced off by `pnpm build`)                                                            |
| `VITE_API_URL`                                                                                                       | empty                            | Same-origin `/api` by default                                                                                        |
| `VITE_BOT_USERNAME`, `VITE_APP_SHORT_NAME`                                                                           | –                                | TonConnect return URL                                                                                                |
| `VITE_TONCONNECT_MANIFEST_URL`                                                                                       | –                                | Override the manifest URL                                                                                            |

## Commands

|                                               |                                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                                    | API + web with reload                                                                                                                                                                      |
| `pnpm test`                                   | unit tests: shared, web (layout math, share flow, i18n, TON payload) and API (auth, chains, posts, watermark pixels, bot, payments, verifier, production mode)                             |
| `pnpm e2e`                                    | Playwright: viral loop, editor, both payment flows, mobile layout, axe accessibility (spins up its own API + web with a fresh DB; use `PW_CHROMIUM=/path/to/chrome` to point at a browser) |
| `pnpm lint` · `pnpm typecheck` · `pnpm build` | static checks and production build                                                                                                                                                         |
| `pnpm smoke`                                  | after `pnpm build`: boots the single-origin server and checks it over HTTP (incl. upload round-trip)                                                                                       |
| `pnpm --filter @storychain/web analyze`       | bundle treemap (`dist/stats.html`)                                                                                                                                                         |

## Known limitations

- **Unverified against the real world:** TonAPI response shapes/endpoints and GRAM's TEP-74 transfer notification (see
  `DECISIONS.md`; confirm with the small mainnet transfer in `CHECKLIST.md`), and real-client behavior of `shareToStory`/widget links.
- The TON poller and the in-memory rate limiter are per process: run one API instance (or move both to Redis/a leader lock).
- Local-disk storage is single-node; use S3 for anything else. Uploaded files orphaned by a lost race are not garbage-collected.
- Moderation is `isHidden` flags in the DB plus stored reports — there is no admin UI.
- Telegram never refreshes `initData`; sessions are accepted for `INITDATA_MAX_AGE_SEC` (24 h), after which the user must reopen the app.
- `sharedToStory` is best-effort analytics: Telegram gives no callback for a completed story.
- Premium fonts are enforced by the request (`fontFamily` field), not by the pixels of the uploaded card; templates are enforced the same way.
- "Trending" is "most participants"; lists use offset cursors (fine at this scale).
- The TonConnect chunk (≈ 215 kB gzip) is large but only loads after the user picks GRM; the main bundle is ≈ 145 kB gzip.

## Troubleshooting

- **Blank page / "Telegram.WebApp is not available"** → you opened the real build outside Telegram: use mock mode or Telegram.
- **`/api/dev/init-data failed`** in the browser → the API is not running or `DEV_MODE` is not `true`.
- **API won't start: "SERVE_WEB is on but … index.html does not exist"** → run `pnpm build` or set `SERVE_WEB=false`.
- **Bot button error `BUTTON_URL_INVALID`** → `WEBAPP_URL` must be https.
- **Story composer doesn't show the image** → `PUBLIC_BASE_URL` must be a public https URL Telegram can fetch.
- **Vite "Blocked request. This host is not allowed"** → already disabled for the dev server; restart `pnpm dev`.
