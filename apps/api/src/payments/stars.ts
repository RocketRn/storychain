import type { Bot } from "grammy";
import type { BoostPlanId } from "@storychain/shared";
import type { Transaction, User } from "@prisma/client";
import { assertBoostHorizon } from "../boosts/core";
import { parsePlan, validateBoostPurchase } from "../boosts/purchase";
import type { Config } from "../config";
import type { Db } from "../db";
import { AppError, errors } from "../errors";
import { createPending, refundPayment, settlePayment, type SettleResult } from "./ledger";

const STARS_INVOICE_TTL_MS = 60 * 60 * 1000;
/** Telegram limits: title 1-32 chars, description 1-255 chars */
const TITLE_MAX = 32;
const DESCRIPTION_MAX = 255;

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
  if (config.devMode && !config.inProduction) return async (a) => `mock-invoice://${a.payload}`;
  return undefined;
}

const truncate = (s: string, max: number): string =>
  [...s].length <= max
    ? s
    : `${[...s]
        .slice(0, Math.max(0, max - 1))
        .join("")
        .trimEnd()}…`;

const duration = (planId: BoostPlanId, ru: boolean): string =>
  planId === "boost_24h" ? (ru ? "24 ч" : "24h") : ru ? "7 дн" : "7d";

/** `Boost "<chain title>" — 24h`, the chain title shortened so the whole title fits Telegram's 32 chars. */
export function invoiceTitle(chainTitle: string, planId: BoostPlanId, ru: boolean): string {
  const [open, close] = ru ? ["Буст «", "»"] : ['Boost "', '"'];
  const tail = `${close} — ${duration(planId, ru)}`;
  const room = TITLE_MAX - [...open].length - [...tail].length;
  return `${open}${truncate(chainTitle, Math.max(1, room))}${tail}`;
}

export function invoiceDescription(chainTitle: string, planId: BoostPlanId, ru: boolean): string {
  const text = ru
    ? `Марафон «${chainTitle}» будет закреплён в карусели «Горячие марафоны» на ${duration(planId, ru)}.`
    : `The marathon "${chainTitle}" will be pinned to the Hot Marathons carousel for ${duration(planId, ru)}.`;
  return truncate(text, DESCRIPTION_MAX);
}

export async function createStarsInvoice(args: {
  db: Db;
  config: Config;
  create: CreateInvoiceLink | undefined;
  user: User;
  chainId: string;
  planId: string;
  now?: Date;
}): Promise<{ invoiceUrl: string; reference: string; chainId: string; planId: string }> {
  const at = args.now ?? new Date();
  const { chain, planId } = await validateBoostPurchase(args.db, args.config, {
    chainId: args.chainId,
    planId: args.planId,
    userId: args.user.id,
    now: at,
  });
  if (!args.create) throw errors.methodUnavailable();
  const ru = !args.user.languageCode?.toLowerCase().startsWith("en");
  const amount = args.config.boost.starsPrice[planId];
  const tx = await createPending(args.db, {
    userId: args.user.id,
    provider: "stars",
    planId,
    chainId: chain.id,
    amount: String(amount),
    currency: "XTR",
    expiresAt: new Date(at.getTime() + STARS_INVOICE_TTL_MS),
  });
  const invoiceUrl = await args.create({
    title: invoiceTitle(chain.title, planId, ru),
    description: invoiceDescription(chain.title, planId, ru),
    payload: tx.reference,
    currency: "XTR",
    prices: [{ label: duration(planId, ru), amount }],
  });
  return { invoiceUrl, reference: tx.reference, chainId: chain.id, planId };
}

export interface PreCheckout {
  from: { id: number };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export type PreCheckoutVerdict = { ok: true } | { ok: false; message: string };

/**
 * pre_checkout_query must be answered within 10 s: a couple of indexed lookups, no network.
 * Besides the order itself, the chain must still exist, be visible and still be boostable (horizon).
 */
export async function validatePreCheckout(
  db: Db,
  config: Pick<Config, "boost">,
  q: PreCheckout,
  now = new Date(),
): Promise<PreCheckoutVerdict> {
  const tx = await db.transaction.findUnique({
    where: { reference: q.invoice_payload },
    include: { user: true, chain: true },
  });
  if (!tx || tx.provider !== "stars") return { ok: false, message: "Unknown order" };
  if (tx.status !== "pending") return { ok: false, message: "This order is no longer payable" };
  if (tx.expiresAt < now) return { ok: false, message: "This order has expired" };
  if (q.currency !== "XTR" || String(q.total_amount) !== tx.amount)
    return { ok: false, message: "Price mismatch" };
  if (tx.user.telegramId !== BigInt(q.from.id))
    return { ok: false, message: "This order belongs to another user" };
  let planId: BoostPlanId;
  try {
    planId = parsePlan(tx.planId);
  } catch {
    return { ok: false, message: "Unknown plan" };
  }
  if (!tx.chain) return { ok: false, message: "This marathon no longer exists" };
  if (tx.chain.isHidden) return { ok: false, message: "This marathon cannot be boosted" };
  try {
    assertBoostHorizon(tx.chain, planId, now, config.boost.maxHorizonMs);
  } catch (e) {
    if (e instanceof AppError)
      return { ok: false, message: "This marathon is already boosted far enough ahead" };
    throw e;
  }
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
 * `duplicate_charge`: the order was already paid by a DIFFERENT charge (e.g. the invoice was open in two
 * clients and both went through). The second charge buys nothing and must be given back.
 */
export type SuccessfulPaymentResult =
  SettleResult | { outcome: "mismatch" } | { outcome: "duplicate_charge"; tx: Transaction };

/**
 * Idempotent (unique externalId = telegram_payment_charge_id): safe against duplicate/redelivered updates.
 * A mismatching payment is NOT granted and is logged loudly (money moved: needs manual review/refund).
 */
export async function handleSuccessfulPayment(
  db: Db,
  fromTelegramId: number,
  sp: SuccessfulPayment,
  now = new Date(),
): Promise<SuccessfulPaymentResult> {
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
  const res = await settlePayment(db, {
    reference: tx.reference,
    externalId: sp.telegram_payment_charge_id,
    rawJson: sp,
    now,
    allowExpired: true, // the user did pay; honor it even if the link expired meanwhile
  });
  // Same charge again = a redelivered update (normal, idempotent). A different charge = the user paid twice.
  if (res.outcome === "already_paid" && res.tx.externalId !== sp.telegram_payment_charge_id) {
    console.error("[payments] DUPLICATE charge for an already paid order", {
      charge: sp.telegram_payment_charge_id,
      paidWith: res.tx.externalId,
      reference: tx.reference,
      from: fromTelegramId,
    });
    return { outcome: "duplicate_charge", tx: res.tx };
  }
  return res;
}

const dateOf = (d: Date, ru: boolean): string =>
  d.toISOString().slice(0, 16).replace("T", " ") + (ru ? " UTC" : " UTC");

export function registerPaymentHandlers(bot: Bot, deps: { db: Db; config: Config }): void {
  const { db, config } = deps;

  bot.on("pre_checkout_query", async (ctx) => {
    const verdict = await validatePreCheckout(db, config, ctx.preCheckoutQuery).catch(
      (e: unknown) => {
        console.error("[payments] pre_checkout error", e);
        return { ok: false, message: "Temporary error, please try again" } as const;
      },
    );
    if (verdict.ok) await ctx.answerPreCheckoutQuery(true);
    else await ctx.answerPreCheckoutQuery(false, { error_message: verdict.message });
  });

  bot.on("message:successful_payment", async (ctx) => {
    const res = await handleSuccessfulPayment(db, ctx.from.id, ctx.message.successful_payment);
    const ru = !ctx.from.language_code?.toLowerCase().startsWith("en");
    // The grant is already committed; notification is best effort and must never undo or fail it.
    try {
      if (res.outcome === "paid") {
        const chain = await db.chain.findUnique({ where: { id: res.chainId } });
        const title = chain?.title ?? "";
        const until = dateOf(res.boostedUntil, ru);
        await ctx.reply(
          ru
            ? `🔥 Ваш марафон «${title}» продвигается до ${until}.`
            : `🔥 Your marathon «${title}» is boosted until ${until}.`,
        );
      } else if (res.outcome === "paid_no_boost") {
        await ctx.reply(
          ru
            ? "Платёж получен, но марафон больше недоступен для продвижения. Мы вернём оплату."
            : "Payment received, but the marathon can no longer be boosted. We will refund you.",
        );
      } else if (res.outcome === "duplicate_charge") {
        const charge = ctx.message.successful_payment.telegram_payment_charge_id;
        // Give the second charge back right away; if that fails the log line tells the operator what to do.
        const refunded = await ctx.api.refundStarPayment(ctx.from.id, charge).then(
          () => true,
          (e: unknown) => {
            console.error(
              "[payments] automatic refund of a duplicate charge FAILED: refund it manually",
              {
                charge,
                err: (e as Error).message,
              },
            );
            return false;
          },
        );
        await ctx.reply(
          ru
            ? refunded
              ? "Вы оплатили этот буст дважды. Повторный платёж возвращён."
              : "Вы оплатили этот буст дважды. Мы вернём повторный платёж."
            : refunded
              ? "You paid for this boost twice. The duplicate payment has been refunded."
              : "You paid for this boost twice. We will refund the duplicate payment.",
        );
      }
    } catch (e) {
      console.warn("[payments] could not send the boost notification", (e as Error).message);
    }
  });

  // Service message sent when a Stars payment is refunded (e.g. via refundStarPayment)
  bot.on("message:refunded_payment", async (ctx) => {
    const r = await refundPayment(db, {
      externalId: ctx.message.refunded_payment.telegram_payment_charge_id,
    });
    if (r.outcome === "noop" && r.reason === "not_found") {
      // expected for the automatic refund of a duplicate charge (it was never recorded as an order's payment)
      console.warn(
        "[payments] refund for a charge that is not an order's payment (duplicate charge refunded automatically?)",
        ctx.message.refunded_payment.telegram_payment_charge_id,
      );
    }
  });
}
