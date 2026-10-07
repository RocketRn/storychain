# Security, performance and code-quality audit

Scope: TON payment verification, Telegram `initData` validation, database queries, UX responsiveness, plus the code and
dependencies around them. Each finding was established by reading the code and, wherever possible, reproduced by a failing
test or a measurement before it was fixed; every fix has a regression test, and the important ones were mutation-checked
(the fix was broken on purpose to confirm a test fails). The exception is anything that depends on the real network or the
real GRM Jetton contract (the gas buffer, TonAPI response shapes): those are marked and listed under "What the owner still
has to do".

How to read the tables: **Sev** is the severity I would assign in a production deployment, **Status** is what this
audit did. Decisions and trade-offs are recorded in [`DECISIONS.md`](./DECISIONS.md) ("Security & performance audit").

## Summary

| Area                     | Verdict                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Telegram `initData`      | **Correct** (matches Telegram's algorithm). Config around it had real holes; fixed. Now unit-tested.                    |
| TON payment verification | Sound core (conditional claim, unique transfer id, bigint math). Robustness and cost issues fixed.                      |
| Stars payments           | One money bug (second charge for a paid order swallowed silently); fixed.                                               |
| Database                 | Four hot queries did full scans; OFFSET paging was unstable and O(n). Fixed, measured.                                  |
| UX responsiveness        | Request waterfall, no timeouts, 4xx retried, canvas repaint per keystroke. Fixed.                                       |
| Dependencies             | 19 advisories (4 critical, 4 high, 11 moderate) → 3 left (2 high, 1 moderate), all dev tooling without an upstream fix. |
| Tests                    | API 192 → **260**, web 64 → **95**, shared 77 (unchanged) unit tests; e2e 30 → **33**; all green.                       |

## Findings

### Security

| #   | Sev  | Finding                                                                                                                                                                                                                                                                                 | Status                                                                                          |
| --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| S1  | High | **Production accepted the public placeholder `BOT_TOKEN`.** `initData` is verified with an HMAC keyed by the bot token; `.env.example` ships a known one. Unless the bot is enabled (Telegram rejects the token at start-up) nothing notices → anyone could forge a login for any user. | Fixed: production requires the `<id>:<35 chars>` shape.                                         |
| S2  | High | **`DEV_MODE` on a public host.** Its dev endpoints mint valid `initData` for any user id. It was only refused with `NODE_ENV=production`, so a host that forgot that variable was fully open.                                                                                           | Fixed: refused on non-local `WEBAPP_URL`/`PUBLIC_BASE_URL` unless `ALLOW_REMOTE_DEV_MODE=true`. |
| S3  | High | **Webhook mode without a secret** (allowed outside production) accepts forged Telegram updates, including `successful_payment` → free boosts.                                                                                                                                           | Fixed: secret required whenever the bot is enabled; the route refuses to register without it.   |
| S4  | High | Vulnerable production dependencies: `@fastify/static` 8.3 (path traversal / route-guard bypass), `react-router` 6.30 (open redirect).                                                                                                                                                   | Fixed: 10.1.5 and 7.18.                                                                         |
| S5  | Med  | Vulnerable dev tooling: vitest < 3.2.6 (UI server file read/exec), tinypool 1.x (prototype-pollution gadget → RCE), vite 5 / esbuild 0.21 (dev server), `shell-quote` 1.9 (command injection via `concurrently`).                                                                       | Fixed: vitest 4.1.11 (also clears vite 5 / esbuild 0.21), `shell-quote` pinned ≥ 1.11.          |
| S6  | Med  | **Slow-body DoS.** Fastify sets `requestTimeout: 0`, which overrides Node's 5-minute default: a client can send headers and dribble the body forever.                                                                                                                                   | Fixed: 120 s limit.                                                                             |
| S7  | Med  | **A replaced card stayed public forever** (and storage grew without bound; failed writes leaked files). A card replaced because it showed something it should not have remained reachable by URL.                                                                                       | Fixed: replaced/orphaned files are deleted.                                                     |
| S8  | Med  | **Process ignored `SIGTERM`.** The handlers only stopped timers, which removes Node's default "terminate": the server kept answering (verified 4 s later) until the orchestrator SIGKILLed it, cutting uploads and payment webhooks.                                                    | Fixed: graceful, drained shutdown.                                                              |
| S9  | Low  | A stale `localhost` TonConnect manifest (web build without `WEBAPP_URL`) makes every wallet reject GRM payments with no server-side symptom.                                                                                                                                            | Fixed: production refuses to start on a mismatch; the generator warns.                          |
| S10 | Info | `initData` validation: HMAC-SHA256 keyed by `HMAC("WebAppData", token)`, all fields but `hash` (incl. newer ones like `signature`) in the check string, constant-time compare, strict `auth_date` window. **No defect found.** 10 direct tests added.                                   | Verified.                                                                                       |

### TON payment verification

| #   | Sev  | Finding                                                                                                                                                                                                                                                                         | Status                                                                                                                                                                                                                |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | High | **One odd event stalled every payment.** A TonAPI page was parsed with one schema; any malformed event/action (anyone can send GRM to the merchant address) threw for the whole page, on every poll, until it aged out of the window.                                           | Fixed: per-event/per-action parsing, skipped events counted and logged.                                                                                                                                               |
| T2  | High | **Head-of-line blocking.** One transfer whose processing threw (DB blip, unexpected data) aborted the loop, so every transfer behind it was skipped on every later poll.                                                                                                        | Fixed: per-transfer isolation.                                                                                                                                                                                        |
| T3  | High | **`tick()` could reject** (a DB error outside the indexer `try`). The interval calls `void tick()` → unhandled rejection → the API process crashes.                                                                                                                             | Fixed: never rejects.                                                                                                                                                                                                 |
| T4  | Med  | **Gas buffer.** 0.05 TON is attached to the Jetton transfer with a 0.01 TON forward amount; the reference Jetton wallet bounces (exit 709) unless the attached value exceeds forward + fees + 2×gas + storage reserve (≈ 0.041 or 0.051 TON depending on the contract version). | Changed to 0.1 TON (the unused part returns to the payer). **Needs a testnet check.**                                                                                                                                 |
| T5  | Med  | **Client could show "failed" for a transfer already sent.** A failing `/confirm` (rate limit, network) after the wallet signed surfaced as an error → the user pays again.                                                                                                      | Fixed: confirm is a swallowed hint; status is polled either way.                                                                                                                                                      |
| T6  | Med  | **Orphan orders.** The order was created before the payer's Jetton wallet was looked up, so users with no GRM left pending orders, each keeping the verifier polling TonAPI for the whole 24 h grace window.                                                                    | Fixed: lookup first.                                                                                                                                                                                                  |
| T7  | Med  | **Cost under spam.** One DB query per event (up to 500 per poll), random free-text comments included; grace-window orders polled every 10 s; every `confirm` forced an indexer call; 8 s timer leaked per `confirm`; wallet cache unbounded (keys are caller-chosen).           | Fixed: bulk lookup of reference-shaped comments only, 1/min grace polling, throttled `nudge()`, bounded cache.                                                                                                        |
| T8  | Med  | **Truncation was silent.** If all 5 pages are full (spam newer than a real payment) older transfers are never examined.                                                                                                                                                         | Fixed: warning logged.                                                                                                                                                                                                |
| T9  | Low  | **Wrong-network wallets.** A transfer on the other network is never seen by the verifier; the user just waits.                                                                                                                                                                  | Fixed: network reported by the server, checked before ordering, demanded in the TonConnect request.                                                                                                                   |
| T10 | Info | Core design reviewed and sound: conditional `pending                                                                                                                                                                                                                            | expired → paid` claim and unique transfer id in one DB transaction, optimistic stacking, addresses compared in raw form, bigint amounts, jetton master and recipient checked, late-payment grace, refund bookkeeping. | Verified. |

### Stars payments

| #   | Sev  | Finding                                                                                                                                                                     | Status                                                                                                                         |
| --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| P1  | High | **A second, different charge for an already-paid order was swallowed** (invoice open in two clients): the user paid twice for one boost and nothing was logged or refunded. | Fixed: detected, logged, refunded automatically (`refundStarPayment`), user told; a manual-refund log line if that call fails. |

### Database

Measured on SQLite with 50 000 chains and 100 000 posts (average of 5 runs). "Before" is shown as _without / with_ planner
statistics (`ANALYZE`): a fresh production SQLite has none. "After" is the same either way.

| Query                                | Before                           | After               |
| ------------------------------------ | -------------------------------- | ------------------- |
| Trending feed, first page            | 7.9 / 10.7 ms, full scan + sort  | 0.1 ms, index range |
| Newest feed, first page              | 24.8 / 30.1 ms, full scan + sort | 0.1 ms              |
| Trending, page 1000 (`OFFSET 20000`) | 47.5 / 78.3 ms                   | keyset: 0.2 ms      |
| My marathons                         | 3.9 / 4.6 ms, full scan + sort   | 0.1 ms              |
| My posts                             | 7.4 / 9.3 ms, full scan + sort   | 0.1 ms              |
| Hot carousel                         | 5.1 / 0.1 ms                     | 0.1 ms              |
| Featured                             | 0.1 ms                           | 0.1 ms (unchanged)  |

| #   | Sev | Finding                                                                                                                                            | Status                                                                                                                                        |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Med | No index served the feed orderings, `creatorId`, `boostedUntil` or `Post.userId`; cost grew linearly with the table.                               | Fixed: migration `20261008120000_audit_indexes` (the predicate columns are part of the indexes so the planner picks them without statistics). |
| D2  | Med | **OFFSET pagination** repeated items whenever a row was added or overtook the scroll position (duplicate React keys in the UI) and cost O(offset). | Fixed: strict keyset cursors; client also de-duplicates.                                                                                      |
| D3  | Low | `GET /api/chains/:id` ran independent queries one after another; payment status polling ran two queries per poll.                                  | Fixed.                                                                                                                                        |

### UX responsiveness

| #   | Sev | Finding                                                                                                                                                            | Status                                                                               |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| U1  | Med | **Request waterfall.** Nothing rendered until `POST /auth/session` returned, although every API call authenticates by itself → one full round trip before content. | Fixed (e2e proves content shows while a 4 s session call is pending).                |
| U2  | Med | **No request timeouts**: a dropped mobile connection left an endless skeleton.                                                                                     | Fixed: 15 s (60 s uploads, including the body).                                      |
| U3  | Med | **4xx were retried 3×** (a 429 made things worse, errors appeared seconds late).                                                                                   | Fixed: only network errors and 5xx, twice.                                           |
| U4  | Med | **Expired Telegram session** produced a different error in every section, with no way out.                                                                         | Fixed: one "reopen the app" screen with a Close button.                              |
| U5  | Med | **Canvas repainted after every render** of the editor (each caption keystroke redrew the 540×960 preview).                                                         | Fixed.                                                                               |
| U6  | Low | Payment polling every 1.5 s for 150 s (100 requests); session refreshed (a write) every 30 s; plans fetched on every sheet open.                                   | Fixed: back-off to 6 s (~30 requests), 10 min caches, plans prefetched for creators. |
| U7  | Low | Every deploy invalidated the whole 147 kB (gzip) entry bundle.                                                                                                     | Fixed: stable `vendor` chunk; app entry is 17 kB.                                    |

## What the owner still has to do

1. **Verify the GRM transfer on testnet, then with a small mainnet payment** ([`CHECKLIST.md`](./CHECKLIST.md) section 4): that
   the 0.1 TON buffer is enough for the real Jetton wallet, that the transfer notification carries the comment, and that
   TonAPI's response shapes still match `payments/tonIndexer.ts`. None of this can be proven without the real network.
2. Set the real boost prices (`GRM_BOOST_*_PRICE`, `STARS_BOOST_*_PRICE`; the defaults are placeholders).
3. Re-check Telegram's current rules for digital goods and promoted placements (Stars-only on iOS/Android is a policy hint,
   not a security boundary: `X-TG-Platform` is client-controlled).
4. Decide whether a leaked `initData` being valid for 24 h is acceptable (`INITDATA_MAX_AGE_SEC`, see `DECISIONS.md`).

## Residual risk and recommendations (not changed)

- **One trusted indexer.** The verifier believes TonAPI that a transfer of the right Jetton to the merchant happened.
  `TonIndexer` is an interface: a second source (or requiring N seconds of age before settling) would remove that single
  point of trust. Worth doing before large amounts flow through.
- **Per-process state**: the rate limiter and the TON poller are in memory. Run one API instance, or move both to Redis /
  a leader lock before scaling out. `TRUST_PROXY=true` trusts every `X-Forwarded-For`; only use it behind a proxy that sets it.
- **Housekeeping**: `expired`/`failed` rows in `Transaction` accumulate (paid and refunded rows are history; keep them).
  A periodic purge, and `PRAGMA optimize` on SQLite, are cheap. GRM refunds remain manual.
- **Dev-time advisories left** (no upstream fix, nothing ships): `deepmerge-ts` in the Prisma CLI config loader, `braces` and
  `postcss-selector-parser` inside Tailwind 3. Re-run `pnpm audit` when Prisma / Tailwind move.
- **CSP** keeps `style-src 'unsafe-inline'` (React emits inline style attributes); `script-src` is strict.
- **CI** (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, build and a production `pnpm audit` on every push and
  pull request; its first run on GitHub passed. It deliberately leaves out `pnpm e2e` / `pnpm smoke` (browser setup could
  not be validated here): run those by hand before a release.

## Reproducing the measurements

- Query plans and timings: build the schema from `apps/api/prisma/migrations` into an in-memory SQLite (`node:sqlite`),
  insert 50 000 chains / 100 000 posts, and compare `EXPLAIN QUERY PLAN` and wall time with and without the
  `audit_indexes` migration, with and without `ANALYZE`. The migration test replays the real SQL on a populated legacy DB.
- Bundle sizes: `VITE_DEV_MOCK=false pnpm --filter @storychain/web build` (before: one 147 kB gzip entry; after: 17 kB app +
  131 kB vendor).
- Shutdown: start `pnpm --filter @storychain/api start`, `kill -TERM <pid>`: it logs `[shutdown] done` and exits within
  a couple of seconds (the previous version was still serving 4 s later).
