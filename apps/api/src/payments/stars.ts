import type { Bot } from "grammy";
import { PLANS } from "@storychain/shared";
import type { User } from "@prisma/client";
import type { Config } from "../config";
import type { Db } from "../db";
import { errors } from "../errors";
import { createPending, refundPayment, settlePayment, type SettleResult } from "./ledger";

const STARS_INVOICE_TTL_MS = 60 * 60 * 1000;

export interface InvoiceLinkArgs {
  title: string;
  description: string;
  payload: string;
  currency: "XTR";
  prices: Array<{ label: string; amount: number }>;
}
export type CreateInvoiceLink = (args: InvoiceLinkArgs) => Promise<string>;

/** Real Bot API when a bot is running; a local fake URL in DEV_MODE (the mock web client recognises it); otherwise unavailable. */
export function invoiceLinkCreator(
  bot: Bot | undefined,
  config: Config,
): CreateInvoiceLink | undefined {
  if (bot) {
    // For Telegram Stars: empty provider_token, currency XTR, exactly one price item
    return (a) =>
      bot.api.createInvoiceLink(a.title, a.description, a.payload, "", a.currency, a.prices);
  }
  if (config.devMode && !config.isProd) return async (a) => `mock-invoice://${a.payload}`;
  return undefined;
}

export async function createStarsInvoice(args: {
  db: Db;
  config: Config;
  create: CreateInvoiceLink | undefined;
  user: User;
  planId: string;
}): Promise<{ invoiceUrl: string; reference: string }> {
  const plan = PLANS[args.planId];
  if (!plan) throw errors.badRequest("Unknown plan");
  if (!args.create) throw errors.methodUnavailable();
  const ru = !args.user.languageCode?.toLowerCase().startsWith("en");
  const tx = await createPending(args.db, {
    userId: args.user.id,
    provider: "stars",
    planId: plan.id,
    amount: String(plan.starsPrice),
    currency: "XTR",
    expiresAt: new Date(Date.now() + STARS_INVOICE_TTL_MS),
  });
  const invoiceUrl = await args.create({
    title: ru
      ? `StoryChain PRO — ${plan.durationDays} дней`
      : `StoryChain PRO — ${plan.durationDays} days`,
    description: ru
      ? "Без лимита публикаций и водяного знака, премиум-шаблоны и шрифты."
      : "No publication limit or watermark, premium templates and fonts.",
    payload: tx.reference,
    currency: "XTR",
    prices: [{ label: "PRO", amount: plan.starsPrice }],
  });
  return { invoiceUrl, reference: tx.reference };
}

export interface PreCheckout {
  from: { id: number };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export type PreCheckoutVerdict = { ok: true } | { ok: false; message: string };

/** pre_checkout_query must be answered within 10 s: one indexed lookup, no network. */
export async function validatePreCheckout(
  db: Db,
  q: PreCheckout,
  now = new Date(),
): Promise<PreCheckoutVerdict> {
  const tx = await db.transaction.findUnique({
    where: { reference: q.invoice_payload },
    include: { user: true },
  });
  if (!tx || tx.provider !== "stars") return { ok: false, message: "Unknown order" };
  if (tx.status !== "pending") return { ok: false, message: "This order is no longer payable" };
  if (tx.expiresAt < now) return { ok: false, message: "This order has expired" };
  if (q.currency !== "XTR" || String(q.total_amount) !== tx.amount)
    return { ok: false, message: "Price mismatch" };
  if (tx.user.telegramId !== BigInt(q.from.id))
    return { ok: false, message: "This order belongs to another user" };
  return { ok: true };
}

export interface SuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
}

/**
 * Idempotent (unique externalId = telegram_payment_charge_id): safe against duplicate/redelivered updates.
 * A mismatching payment is NOT granted and is logged loudly (money moved: needs manual review/refund).
 */
export async function handleSuccessfulPayment(
  db: Db,
  fromTelegramId: number,
  sp: SuccessfulPayment,
  now = new Date(),
): Promise<SettleResult | { outcome: "mismatch" }> {
  const tx = await db.transaction.findUnique({
    where: { reference: sp.invoice_payload },
    include: { user: true },
  });
  if (
    !tx ||
    tx.provider !== "stars" ||
    sp.currency !== "XTR" ||
    String(sp.total_amount) !== tx.amount ||
    tx.user.telegramId !== BigInt(fromTelegramId)
  ) {
    console.error("[payments] MISMATCHED successful_payment, not granted", {
      charge: sp.telegram_payment_charge_id,
      payload: sp.invoice_payload,
      from: fromTelegramId,
    });
    return { outcome: "mismatch" };
  }
  return settlePayment(db, {
    reference: tx.reference,
    externalId: sp.telegram_payment_charge_id,
    rawJson: sp,
    now,
    allowExpired: true, // the user did pay; honor it even if the link expired meanwhile
  });
}

export function registerPaymentHandlers(bot: Bot, deps: { db: Db; config: Config }): void {
  const { db } = deps;

  bot.on("pre_checkout_query", async (ctx) => {
    const verdict = await validatePreCheckout(db, ctx.preCheckoutQuery).catch((e: unknown) => {
      console.error("[payments] pre_checkout error", e);
      return { ok: false, message: "Temporary error, please try again" } as const;
    });
    if (verdict.ok) await ctx.answerPreCheckoutQuery(true);
    else await ctx.answerPreCheckoutQuery(false, { error_message: verdict.message });
  });

  bot.on("message:successful_payment", async (ctx) => {
    const res = await handleSuccessfulPayment(db, ctx.from.id, ctx.message.successful_payment);
    if (res.outcome === "paid") {
      const ru = !ctx.from.language_code?.toLowerCase().startsWith("en");
      const until = res.proUntil.toISOString().slice(0, 10);
      await ctx.reply(
        ru ? `⭐ PRO активен до ${until}. Спасибо!` : `⭐ PRO is active until ${until}. Thank you!`,
      );
    }
  });

  // Service message sent when a Stars payment is refunded (e.g. via refundStarPayment)
  bot.on("message:refunded_payment", async (ctx) => {
    const r = await refundPayment(db, {
      externalId: ctx.message.refunded_payment.telegram_payment_charge_id,
    });
    if (r.outcome === "noop" && r.reason === "not_found") {
      console.error(
        "[payments] refund for unknown charge",
        ctx.message.refunded_payment.telegram_payment_charge_id,
      );
    }
  });
}
