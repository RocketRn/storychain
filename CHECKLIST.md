# Manual verification in real Telegram

Automated tests cover the logic and the whole flow in mock mode. Things that **only a real Telegram client or the real
chain can prove** are listed here. Do this before a public launch. Setup: see "Real Telegram" in the README.

Legend: ☐ to do. Run each item on **Android**, **iOS** and **Desktop** unless noted.

## 0. Preparation

- ☐ Bot created in @BotFather, Mini App URL set (`/newapp` or menu button) to the **https** URL of the app.
- ☐ `.env`: `DEV_MODE=false`, `VITE_DEV_MOCK=false`, `BOT_ENABLED=true`, real `BOT_TOKEN`/`BOT_USERNAME`, `WEBAPP_URL` and
  `PUBLIC_BASE_URL` = the same public https origin.
- ☐ Two Telegram accounts: **A = Telegram Premium**, **B = not Premium**. A third, older client (< 7.8) if you can find one.
- ☐ API log shows `bot: polling as @…` (or `webhook set`) and no startup errors.

## 1. Launch & shell

| ☐                                                                                   | Android | iOS | Desktop |
| ----------------------------------------------------------------------------------- | :-----: | :-: | :-----: |
| `/start` → button opens the Mini App                                                |    ☐    |  ☐  |    ☐    |
| Menu button / `t.me/<bot>/<short>` opens the app                                    |    ☐    |  ☐  |    ☐    |
| Fullscreen/expanded, no horizontal scroll, safe areas respected (notch, home bar)   |    ☐    |  ☐  |    ☐    |
| Light **and** dark Telegram theme follow (colors, contrast of hint text/buttons)    |    ☐    |  ☐  |    ☐    |
| Native **BackButton** appears on inner screens and goes back; Home hides it         |    ☐    |  ☐  |    ☐    |
| Language: Russian client → Russian UI; English client → English UI; other → Russian |    ☐    |  ☐  |    ☐    |
| Session still works after the app has been open > 1 h (initData window is 24 h)     |    ☐    |  ☐  |    ☐    |

## 2. Editor

| ☐                                                                                                                                                   | Android | iOS | Desktop |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | :-----: | :-: | :-----: |
| "Choose photo" opens the gallery; "Take a photo" opens the camera                                                                                   |    ☐    |  ☐  |   n/a   |
| A portrait photo from the phone camera (EXIF-rotated) appears upright in the preview and the result                                                 |    ☐    |  ☐  |    ☐    |
| Pinch-zoom and drag work in the preview; the page does not scroll under the canvas                                                                  |    ☐    |  ☐  |   n/a   |
| Mouse wheel zoom + drag work                                                                                                                        |   n/a   | n/a |    ☐    |
| Cyrillic and long chain titles render in every font (Unbounded, Oswald, Playfair, Pacifico)                                                         |    ☐    |  ☐  |    ☐    |
| MainButton shows "Next" → "Publish to Story" with progress while uploading                                                                          |    ☐    |  ☐  |    ☐    |
| Every card (any user) shows the small "StoryChain" badge in the preview and in the stored image; every template and font is selectable with no lock |    ☐    |  ☐  |    ☐    |

## 3. Stories & deep links (the viral loop)

> `shareToStory` needs a **public https media URL** and Telegram ≥ 7.8.

| ☐                                                                                                                                                            | Android | iOS | Desktop |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-----: | :-: | :-----: |
| **Account B (non-Premium)**: publish → Telegram's story composer opens with the card; the caption contains `🔗 Join: https://t.me/<bot>?startapp=chain_<id>` |    ☐    |  ☐  |    ☐    |
| B: **no** widget link is attached (expected; widget links are Premium-only) and nothing breaks                                                               |    ☐    |  ☐  |    ☐    |
| **Account A (Premium)**: the "Join the chain" **widget link** sticker is attached AND the link is still in the caption                                       |    ☐    |  ☐  |    ☐    |
| If Telegram rejects the widget link for A, the app retries without it (story still opens)                                                                    |    ☐    |  ☐  |    ☐    |
| Post the story; from another account tap the link in the story/caption → Mini App opens **on that chain**                                                    |    ☐    |  ☐  |    ☐    |
| Same via `t.me/<bot>?startapp=chain_<id>` pasted in a chat                                                                                                   |    ☐    |  ☐  |    ☐    |
| Unknown / hidden chain id → friendly "Chain not found" screen with a way back                                                                                |    ☐    |  ☐  |    ☐    |
| "Share again" and "Send to chat" (share sheet with link + text) work from the done screen and the chain page                                                 |    ☐    |  ☐  |    ☐    |
| Old client (< 7.8): fallback alert, image opened/saved, link copied                                                                                          |    ☐    |  ☐  |    ☐    |
| `/start chain_<id>` in the bot → button opens that chain                                                                                                     |    ☐    |  ☐  |    ☐    |
| Joined user can re-post (replaces the card, keeps `#N`)                                                                                                      |    ☐    |  ☐  |    ☐    |

## 4. Free posting & Marathon Boosts

### Free and unlimited

- ☐ A free user publishes **5+ cards in a row** (different chains, same day): no limit screen, no paywall, no PRO/lock UI anywhere.
- ☐ All 8 templates and all 6 fonts can be selected and published.
- ☐ Spamming the publish button eventually shows the friendly "you're going a bit fast" message (rate limit), never a payment prompt.

### Telegram Stars boost (all platforms)

- ☐ Create a chain with a channel link (`@yourchannel`). Only **the creator** sees **🔥 Boost marathon** on the chain page; another account does not.
- ☐ Boost → pick 24h → **Pay with Stars** opens the native invoice titled `Boost "<chain>" — 24h` (100 ⭐ unless you changed `STARS_BOOST_24H_PRICE`).
- ☐ After paying: the success message, the chain appears at the top of Home in **🔥 Hot Marathons** with a "Sponsored" label and an **Open channel** button; the bot sends "🔥 Your marathon … is boosted until …".
- ☐ **Open channel** opens the channel inside Telegram (`t.me` link).
- ☐ Cancel the invoice → "Payment cancelled", nothing changes.
- ☐ Buy again while boosted → the end date moves forward by the plan length (stacking), up to the 30-day horizon; beyond it the purchase is refused.
- ☐ A second account sees the chain as Sponsored with the channel link; after expiry (or a refund) the chain leaves the carousel and the link is no longer visible to others.
- ☐ Boost expiry: wait for a 24h boost (or set a tiny test duration in the DB) → the chain disappears from the carousel on its own.
- ☐ Refund: `pnpm --filter @storychain/api refund <reference|chargeId>` → Stars returned, the boost is taken back, transaction `refunded`.
- ☐ Hide the chain in the DB between "Pay" and payment confirmation → the bot answers pre-checkout with an error (no charge).
- ☐ The webhook/polling log shows no `MISMATCHED successful_payment` lines.

### GRM on TON (Desktop / web; **Android/iOS must hide it** unless `TON_PAYMENTS_ALL_PLATFORMS=true`)

- ☐ iOS & Android: only the Stars button is visible, and calling `POST /api/payments/ton/intent` from those platforms returns 403.
- ☐ Desktop: in the Boost sheet "Pay with GRM" → TonConnect wallet modal opens; after connecting, "Pay N GRM" is shown (plan price from `GRM_BOOST_*_PRICE`).
- ☐ **Small mainnet GRAM test transfer** (confirms the TEP-74 assumption in `DECISIONS.md`):
  1. Set `TON_MERCHANT_ADDRESS` (a wallet you control), `TONAPI_KEY`, `TON_NETWORK=mainnet`, keep the GRAM master from `.env.example`, and a **tiny price** (e.g. `GRM_BOOST_24H_PRICE=0.001`).
  2. Start the API: the log must say `TON startup check passed` with `decimals: 9`. (A decimals mismatch aborts startup: that is the safety net working.)
  3. Boost a chain you created and pay from a wallet that holds GRAM. Within ~10–60 s the sheet must flip to the success message and the chain must appear in the Hot carousel.
  4. Check the DB: the `Transaction` is `paid`, `externalId` is the TonAPI event id, `rawJson` shows the comment == `reference`.
  5. **If it never matches:** open the transfer in a TON explorer / TonAPI and check that (a) the merchant Jetton wallet emitted a _transfer notification_, (b) it carries the text comment. If GRAM does not forward the payload, comment-matching cannot work — switch the `TonIndexer` implementation or match by sender+amount instead.
  6. Also verify the TonAPI response shapes used by `payments/tonIndexer.ts` still match (events with `JettonTransfer` actions, `event_id`, `comment`).
- ☐ Pay a boost for a chain that gets hidden before confirmation → the order ends `paid` with `rawJson` note `chain_not_boostable`, no boost, a warning in the log → refund by hand.
- ☐ Underpay by a bit (send less than the price) → stays pending, no boost is applied.
- ☐ Reject the transaction in the wallet → friendly "rejected in the wallet" message.
- ☐ Wallet returns to the Mini App after signing (`twaReturnUrl`; set `VITE_BOT_USERNAME` / `VITE_APP_SHORT_NAME`).
- ☐ The manifest URL (`/tonconnect-manifest.json`) is reachable over https and shows the right name/icon in the wallet.

## 5. Operations

- ☐ Webhook mode: `BOT_MODE=webhook`, `WEBHOOK_URL=https://<host>/api/telegram/webhook`, `WEBHOOK_SECRET` set → `/start` works; a request without the secret header gets 401.
- ☐ `pnpm build && pnpm smoke` passes on the deployment host (single-origin mode).
- ☐ Production start refuses `DEV_MODE=true`, missing `TON_MERCHANT_ADDRESS`/`BOT_TOKEN`/…, and a non-https `PUBLIC_BASE_URL`.
- ☐ Uploads use S3 (or a persistent volume) and survive a restart; images are reachable by https from Telegram's servers.
- ☐ Moderation: set `Chain.isHidden` / `Post.isHidden` in the DB → disappears everywhere (reports are stored in `Report`; there is no admin UI yet).
- ☐ Platform policy: re-read Telegram's current rules for digital goods in Mini Apps and confirm the per-platform payment flag matches.
