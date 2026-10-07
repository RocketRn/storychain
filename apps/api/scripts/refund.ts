/**
 * Admin script: refund a Telegram Stars payment and revoke the PRO period it granted.
 *   pnpm --filter @storychain/api refund <reference | telegram_payment_charge_id>
 * Needs BOT_TOKEN and DATABASE_URL (same .env as the API). Safe to re-run (idempotent).
 */
import { Bot } from "grammy";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db";
import { refundPayment } from "../src/payments/ledger";

const key = process.argv[2];
if (!key) {
  console.error("usage: refund <reference | telegram_payment_charge_id>");
  process.exit(1);
}

const config = loadConfig();
const db = createDb(config.databaseUrl);
const tx = await db.transaction.findFirst({
  where: { OR: [{ reference: key }, { externalId: key }] },
  include: { user: true },
});
if (!tx) {
  console.error("transaction not found");
  process.exit(1);
}
if (tx.provider !== "stars" || !tx.externalId) {
  console.error(
    `only paid Stars transactions can be refunded here (provider=${tx.provider}, status=${tx.status})`,
  );
  process.exit(1);
}
if (tx.status === "paid") {
  // Refund at Telegram first; only then revoke locally (a Bot API failure leaves PRO untouched)
  await new Bot(config.botToken).api.refundStarPayment(Number(tx.user.telegramId), tx.externalId);
}
const res = await refundPayment(db, { reference: tx.reference });
console.log(`refund ${tx.reference}:`, res);
await db.$disconnect();
