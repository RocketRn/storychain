# Pivot audit (temporary — deleted in Phase 7)

Worklist for PRO/limits → paid Marathon Boosts. Found with ripgrep for: `isPro`, `proUntil`, `DAILY_LIMIT_REACHED`,
`PRO_REQUIRED`, `dailyLimit`, `usedToday`, `DailyUsage`, `isPremium`, `pro_30d`, `GRM_PRO_30D_PRICE`, `grant-pro`,
`reset-usage`, `Subscription`, `watermark`, `Paywall`, `PRO`, `quota`.

**Gotchas for the final grep rule (substring matches):**
- `isProd` contains `isPro` → rename `config.isProd` / locals to `inProduction` (config.ts, app.ts, payments/stars.ts).
- `isPremiumFont` and `Template.isPremium` contain `isPremium` → remove premium/locked concept entirely (`isPremiumFont`, `PREMIUM_FONTS`).
- `isTgPremium` stays (Telegram Premium flag, story widget_link logic). It does not match the rule.

## packages/shared
- [ ] `plans.ts` — drop `PLANS`/`pro_30d`/`FREE_DAILY_LIMIT`/`grmPriceUnits(PRO)`; add `BOOST_PLANS`; keep `allowedMethods`.
- [ ] `templates.ts` — remove `isPremium` from type + 8 templates, `PREMIUM_FONTS`, `isPremiumFont`; fonts are all free.
- [ ] `errors.ts` — remove `DAILY_LIMIT_REACHED`, `PRO_REQUIRED`; add `INVALID_CHANNEL_URL`, `INVALID_BOOST_PLAN`, `CHAIN_NOT_FOUND`, `CHAIN_NOT_BOOSTABLE`, `BOOST_HORIZON_EXCEEDED`.
- [ ] `dto.ts` — `SessionDTO`/`UsageDTO` lose `isPro/proUntil/dailyLimit/usedToday`; `ChainDTO` + `isBoosted/boostedUntil/channelUrl`; `PlansDTO` → boost plans; `PaymentStatusDTO` → `chainId/planId/boostedUntil`; `TonIntentDTO` + `chainId/planId`.
- [ ] `schemas.ts` — `createPaymentSchema` → `{chainId, planId}`; `channelUrl` schema; `createChainSchema.channelUrl`; `patchChainSchema`; `createPostFieldsSchema.fontFamily` (premium check goes away).
- [ ] `helpers.ts` — add `normalizeChannelUrl` (+ client mirror use).
- [ ] tests: `units.test.ts` stays; add `channelUrl.test.ts`.

## apps/api
- [ ] `prisma/schema.prisma` — remove `User.proUntil/subscriptions/usage`, `Subscription`, `DailyUsage`; add `Chain.channelUrl/isBoosted/boostedUntil/boosts/transactions`, `ChainBoost`, `Transaction.chainId`; new migration `boosts_pivot` (+ expire legacy pending `pro_30d`).
- [ ] `prisma/seed.ts` — 2 boosted + 1 expired-boost demo chains; drop `dailyUsage` cleanup.
- [ ] `src/config.ts` — `isProd` → `inProduction`; `GRM_PRO_30D_PRICE` → `GRM_BOOST_24H_PRICE/GRM_BOOST_7D_PRICE`; `STARS_BOOST_*`, `BOOST_MAX_HORIZON_DAYS`, rate-limit env vars.
- [ ] `src/app.ts` — `isProd`; per-route rate limits from config; start sweeper (index.ts).
- [ ] `src/errors.ts` — remove `dailyLimit()`/`proRequired()`; add boost errors.
- [ ] `src/services/posts.ts` — remove limit/pro/template-lock/font-lock; watermark always.
- [ ] `src/services/users.ts` — remove `isPro`, `getUsage`, `utcDay`, session usage.
- [ ] `src/services/pro.ts` (+ `pro.test.ts`) — delete; move extension math into `boosts/`.
- [ ] `src/services/image.ts` — watermark naming stays (attribution badge) but unconditional (callers).
- [ ] `src/routes/misc.ts` — `/api/me`, `/api/auth/session`, `/api/plans` (boost plans), my posts.
- [ ] `src/routes/chains.ts` — `channelUrl` on create, `PATCH /api/chains/:id`, `GET /api/chains/boosted`, DTO mapper (visibility rule, computed `isBoosted`), creator-only fields.
- [ ] `src/routes/payments.ts` — `{chainId, planId}`, validation, horizon guard, status DTO.
- [ ] `src/routes/dev.ts` — remove `grant-pro`, `reset-usage`; add `boost-chain`, `expire-boost`; `payments/:ref/complete` via `applyBoost`.
- [ ] `src/payments/ledger.ts` — `settlePayment` grants boost (`applyBoost`), `refundPayment` → `revokeBoost`; remove PRO math/Subscription.
- [ ] `src/payments/stars.ts` — invoice per chain/plan, pre_checkout validation, notification message.
- [ ] `src/payments/tonVerifier.ts` — grant via `applyBoost`; chain-not-boostable edge case.
- [ ] `src/boosts/*` — new: `isBoostActive`, `applyBoost`, `revokeBoost`, `sweepExpiredBoosts`, horizon guard.
- [ ] `scripts/refund.ts` — uses `revokeBoost` path.
- [ ] `src/index.ts` — start boost sweeper (60 s, overlap guard).
- [ ] tests to rewrite: `posts.test.ts` (20 hits), `payments-stars.test.ts` (29), `payments-ton.test.ts` (17), `config.test.ts`, `auth.test.ts`, `production.test.ts`; delete `services/pro.test.ts`; add boosts tests.

## apps/web
- [ ] `screens/Paywall.tsx` — delete + route `/pro` + `PayPanelProps` consumers; payment code moves into `BoostModal`.
- [ ] `screens/Home.tsx` — remove PRO/free chip; add Hot/Sponsored carousel (new `components/BoostedCarousel.tsx`).
- [ ] `screens/Chain.tsx` — Sponsored badge, channel button, Boost button/“Boosted until · Extend”.
- [ ] `screens/CreateChain.tsx` — channel link field.
- [ ] `screens/Profile.tsx` — remove PRO/usage; “My marathons” with boost chip/action.
- [ ] `screens/Editor.tsx` — remove limit screen, PRO gating, `isPro` watermark logic (always show badge preview).
- [ ] `editor/TemplatePicker.tsx`, `editor/CardPreview.tsx`, `editor/renderCard.ts` — locks/PRO badges removed; badge overlay always.
- [ ] `lib/i18n.ts` — delete ~30 PRO/limit keys (RU+EN), add boost keys.
- [ ] `lib/queries.ts` — boosted/plans/chain mutations; `lib/share.ts` text mentions? (only `isPremium` hits are `isTgPremium`-free check).
- [ ] `lib/tgMock.ts`, `mock/MockUI.tsx` (DevTools: boost/expire), `mock/MockGrmPanel.tsx`, `ton/TonPay.tsx` — re-route to `{chainId, planId}`.
- [ ] `App.tsx` — remove `/pro` route.
- [ ] `vite.config.ts` — only a comment hit (`isPro`d?) check.
- [ ] tests: `layout.test.ts` (templates `isPremium`), `share.test.ts`/`share.ts` (`isPremium` param of `buildStoryParams` → rename `isTgPremium`).

## e2e
- [ ] `phase2.spec.ts` (free chip), `phase3.spec.ts` (PRO tests/limit), `phase5.spec.ts` (paywall → delete/replace), `phase6.spec.ts` (journey/profile/a11y paywall), `playwright.config.ts` (comments).

## Docs
- [ ] `README.md`, `CHECKLIST.md`, `DECISIONS.md`, `.env.example` — monetization, env table, checks, decisions; delete this file last.
