import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { createBot } from "../src/bot";
import { DAY_MS } from "../src/services/pro";
import { createPending, refundPayment, settlePayment } from "../src/payments/ledger";
import {
  handleSuccessfulPayment,
  validatePreCheckout,
  type CreateInvoiceLink,
  type InvoiceLinkArgs,
} from "../src/payments/stars";
import {
  authHeader,
  createChain,
  createCtx,
  newTgId,
  postImage,
  solidImage,
  type TestCtx,
} from "./helpers";

let ctx: TestCtx;
const invoiceCalls: InvoiceLinkArgs[] = [];
const stubCreate: CreateInvoiceLink = async (a) => {
  invoiceCalls.push(a);
  return `https://t.me/$invoice_${a.payload}`;
};

beforeAll(async () => {
  ctx = await createCtx({}, { createInvoiceLink: stubCreate });
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.db.$disconnect();
});

async function newUser() {
  const tgId = newTgId();
  await ctx.app.inject({ url: "/api/me", headers: authHeader(tgId) });
  const user = await ctx.db.user.findUniqueOrThrow({ where: { telegramId: BigInt(tgId) } });
  return { tgId, user };
}

async function invoice(tgId: number) {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/payments/stars/invoice",
    headers: authHeader(tgId),
    payload: { planId: "pro_30d" },
  });
  return res;
}

const sp = (reference: string, charge: string, over: Record<string, unknown> = {}) => ({
  currency: "XTR",
  total_amount: 150,
  invoice_payload: reference,
  telegram_payment_charge_id: charge,
  ...over,
});

describe("POST /api/payments/stars/invoice", () => {
  it("creates a pending XTR transaction and an invoice link with the reference as payload", async () => {
    const { tgId, user } = await newUser();
    const res = await invoice(tgId);
    expect(res.statusCode).toBe(200);
    const { invoiceUrl, reference } = res.json();
    expect(invoiceUrl).toBe(`https://t.me/$invoice_${reference}`);
    const call = invoiceCalls.at(-1) as InvoiceLinkArgs;
    expect(call).toMatchObject({
      currency: "XTR",
      payload: reference,
      prices: [{ label: "PRO", amount: 150 }],
    });
    expect(call.prices).toHaveLength(1); // exactly one price item
    const tx = await ctx.db.transaction.findUniqueOrThrow({ where: { reference } });
    expect(tx).toMatchObject({
      userId: user.id,
      provider: "stars",
      status: "pending",
      amount: "150",
      currency: "XTR",
    });
    expect(tx.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("validates the plan and requires auth", async () => {
    const { tgId } = await newUser();
    const bad = await ctx.app.inject({
      method: "POST",
      url: "/api/payments/stars/invoice",
      headers: authHeader(tgId),
      payload: { planId: "gold" },
    });
    expect(bad.statusCode).toBe(400);
    const anon = await ctx.app.inject({
      method: "POST",
      url: "/api/payments/stars/invoice",
      payload: { planId: "pro_30d" },
    });
    expect(anon.statusCode).toBe(401);
  });

  it("falls back to a mock invoice URL in DEV_MODE without a bot, and is unavailable otherwise", async () => {
    const dev = await createCtx();
    const tgId = newTgId();
    const res = await dev.app.inject({
      method: "POST",
      url: "/api/payments/stars/invoice",
      headers: authHeader(tgId),
      payload: { planId: "pro_30d" },
    });
    expect(res.json().invoiceUrl).toBe(`mock-invoice://${res.json().reference}`);
    await dev.app.close();

    const prodLike = await createCtx({ DEV_MODE: "false" });
    const res2 = await prodLike.app.inject({
      method: "POST",
      url: "/api/payments/stars/invoice",
      headers: authHeader(tgId),
      payload: { planId: "pro_30d" },
    });
    expect(res2.statusCode).toBe(503);
    expect(res2.json().error.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
    await prodLike.app.close();
  });
});

describe("pre_checkout validation", () => {
  async function pending(over: { expiresAt?: Date } = {}) {
    const { tgId, user } = await newUser();
    const tx = await createPending(ctx.db, {
      userId: user.id,
      provider: "stars",
      planId: "pro_30d",
      amount: "150",
      currency: "XTR",
      expiresAt: over.expiresAt ?? new Date(Date.now() + 3600_000),
    });
    return { tgId, tx };
  }
  const q = (tgId: number, ref: string, over: Record<string, unknown> = {}) => ({
    from: { id: tgId },
    currency: "XTR",
    total_amount: 150,
    invoice_payload: ref,
    ...over,
  });

  it("accepts a matching pending order", async () => {
    const { tgId, tx } = await pending();
    expect(await validatePreCheckout(ctx.db, q(tgId, tx.reference))).toEqual({ ok: true });
  });
  it("rejects wrong amount, currency, unknown payload, other user, expired and non-pending orders", async () => {
    const { tgId, tx } = await pending();
    for (const bad of [
      q(tgId, tx.reference, { total_amount: 1 }),
      q(tgId, tx.reference, { currency: "USD" }),
      q(tgId, "nope"),
      q(tgId + 1, tx.reference),
    ]) {
      expect((await validatePreCheckout(ctx.db, bad)).ok).toBe(false);
    }
    const expired = await pending({ expiresAt: new Date(Date.now() - 1000) });
    expect((await validatePreCheckout(ctx.db, q(expired.tgId, expired.tx.reference))).ok).toBe(
      false,
    );
    await settlePayment(ctx.db, { reference: tx.reference, externalId: "c-pre-1" });
    expect((await validatePreCheckout(ctx.db, q(tgId, tx.reference))).ok).toBe(false); // already paid
  });
});

describe("bot wiring (pre_checkout_query / successful_payment / refunded_payment)", () => {
  const botInfo = {
    id: 99,
    is_bot: true,
    first_name: "B",
    username: "storychain_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } as unknown as UserFromGetMe;
  let bot: Bot;
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  beforeAll(() => {
    bot = createBot(ctx.config, { db: ctx.db, botInfo });
    bot.api.config.use(async (_p, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return { ok: true, result: true } as never;
    });
  });

  it("answers pre_checkout_query true/false", async () => {
    const { tgId, user } = await newUser();
    const tx = await createPending(ctx.db, {
      userId: user.id,
      provider: "stars",
      planId: "pro_30d",
      amount: "150",
      currency: "XTR",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const upd = (payload: string, amount = 150) => ({
      update_id: 1,
      pre_checkout_query: {
        id: "q1",
        from: { id: tgId, is_bot: false, first_name: "A" },
        currency: "XTR",
        total_amount: amount,
        invoice_payload: payload,
      },
    });
    await bot.handleUpdate(upd(tx.reference) as never);
    expect(calls.at(-1)).toMatchObject({
      method: "answerPreCheckoutQuery",
      payload: { pre_checkout_query_id: "q1", ok: true },
    });
    await bot.handleUpdate(upd(tx.reference, 999) as never);
    expect(calls.at(-1)?.payload).toMatchObject({ ok: false, error_message: expect.any(String) });
  });

  it("successful_payment grants PRO once even if Telegram redelivers the update", async () => {
    const { tgId, user } = await newUser();
    const tx = await createPending(ctx.db, {
      userId: user.id,
      provider: "stars",
      planId: "pro_30d",
      amount: "150",
      currency: "XTR",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const upd = {
      update_id: 2,
      message: {
        message_id: 5,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgId, type: "private", first_name: "A" },
        from: { id: tgId, is_bot: false, first_name: "A", language_code: "en" },
        successful_payment: sp(tx.reference, "charge-bot-1"),
      },
    };
    await bot.handleUpdate(upd as never);
    const after1 = await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after1.proUntil).not.toBeNull();
    expect(calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text).toContain(
      "PRO is active",
    );
    await bot.handleUpdate(upd as never); // redelivery
    const after2 = await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after2.proUntil).toEqual(after1.proUntil);
    expect(await ctx.db.subscription.count({ where: { userId: user.id } })).toBe(1);
  });

  it("refunded_payment marks refunded and revokes the period (idempotent)", async () => {
    const { tgId, user } = await newUser();
    const tx = await createPending(ctx.db, {
      userId: user.id,
      provider: "stars",
      planId: "pro_30d",
      amount: "150",
      currency: "XTR",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await handleSuccessfulPayment(ctx.db, tgId, sp(tx.reference, "charge-refund-1"));
    expect(
      (await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } })).proUntil!.getTime(),
    ).toBeGreaterThan(Date.now() + 29 * DAY_MS);
    const upd = {
      update_id: 3,
      message: {
        message_id: 6,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgId, type: "private", first_name: "A" },
        from: { id: tgId, is_bot: false, first_name: "A" },
        refunded_payment: {
          currency: "XTR",
          total_amount: 150,
          invoice_payload: tx.reference,
          telegram_payment_charge_id: "charge-refund-1",
        },
      },
    };
    await bot.handleUpdate(upd as never);
    await bot.handleUpdate(upd as never);
    const u = await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u.proUntil!.getTime()).toBeLessThanOrEqual(Date.now() + 1000); // period revoked exactly once
    expect((await ctx.db.transaction.findUniqueOrThrow({ where: { id: tx.id } })).status).toBe(
      "refunded",
    );
    expect(await ctx.db.subscription.count({ where: { txId: tx.id } })).toBe(0);
  });
});

describe("ledger idempotency & PRO math", () => {
  const mk = async (userId: string) =>
    createPending(ctx.db, {
      userId,
      provider: "stars",
      planId: "pro_30d",
      amount: "150",
      currency: "XTR",
      expiresAt: new Date(Date.now() + 3600_000),
    });

  it("double successful_payment (same charge) -> one grant", async () => {
    const { tgId, user } = await newUser();
    const tx = await mk(user.id);
    const a = await handleSuccessfulPayment(ctx.db, tgId, sp(tx.reference, "dup-1"));
    const b = await handleSuccessfulPayment(ctx.db, tgId, sp(tx.reference, "dup-1"));
    expect([a.outcome, b.outcome]).toEqual(["paid", "already_paid"]);
    expect(await ctx.db.subscription.count({ where: { userId: user.id } })).toBe(1);
  });

  it("concurrent deliveries still grant exactly once", async () => {
    const { tgId, user } = await newUser();
    const tx = await mk(user.id);
    const rs = await Promise.all(
      Array.from({ length: 4 }, () =>
        handleSuccessfulPayment(ctx.db, tgId, sp(tx.reference, "race-1")),
      ),
    );
    expect(rs.filter((r) => r.outcome === "paid")).toHaveLength(1);
    expect(await ctx.db.subscription.count({ where: { userId: user.id } })).toBe(1);
    const u = await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u.proUntil!.getTime() - Date.now()).toBeLessThan(30 * DAY_MS + 5000);
  });

  it("a replayed charge id on another transaction is rejected", async () => {
    const { tgId, user } = await newUser();
    const [t1, t2] = [await mk(user.id), await mk(user.id)];
    await handleSuccessfulPayment(ctx.db, tgId, sp(t1.reference, "replay-1"));
    const r = await handleSuccessfulPayment(ctx.db, tgId, sp(t2.reference, "replay-1"));
    expect(r).toEqual({ outcome: "rejected", reason: "replay" });
    expect((await ctx.db.transaction.findUniqueOrThrow({ where: { id: t2.id } })).status).toBe(
      "pending",
    );
  });

  it("mismatching amount / user is NOT granted", async () => {
    const { tgId, user } = await newUser();
    const tx = await mk(user.id);
    expect(
      (await handleSuccessfulPayment(ctx.db, tgId, sp(tx.reference, "mm-1", { total_amount: 50 })))
        .outcome,
    ).toBe("mismatch");
    expect(
      (await handleSuccessfulPayment(ctx.db, tgId + 1, sp(tx.reference, "mm-2"))).outcome,
    ).toBe("mismatch");
    expect((await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } })).proUntil).toBeNull();
  });

  it("two purchases extend from the previous end (60 days), refund revokes only one period", async () => {
    const { tgId, user } = await newUser();
    const [t1, t2] = [await mk(user.id), await mk(user.id)];
    await handleSuccessfulPayment(ctx.db, tgId, sp(t1.reference, "ext-1"));
    await handleSuccessfulPayment(ctx.db, tgId, sp(t2.reference, "ext-2"));
    const days =
      ((await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } })).proUntil!.getTime() -
        Date.now()) /
      DAY_MS;
    expect(days).toBeGreaterThan(59.9);
    expect(days).toBeLessThan(60.1);
    await refundPayment(ctx.db, { externalId: "ext-1" });
    const left =
      ((await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } })).proUntil!.getTime() -
        Date.now()) /
      DAY_MS;
    expect(left).toBeGreaterThan(29.9);
    expect(left).toBeLessThan(30.1);
    expect(await refundPayment(ctx.db, { externalId: "ext-1" })).toEqual({
      outcome: "noop",
      reason: "not_paid",
    });
    expect(await refundPayment(ctx.db, { externalId: "nope" })).toEqual({
      outcome: "noop",
      reason: "not_found",
    });
  });

  it("an expired order can still be settled by a real payment (user paid), but not by default", async () => {
    const { tgId, user } = await newUser();
    const tx = await createPending(ctx.db, {
      userId: user.id,
      provider: "stars",
      planId: "pro_30d",
      amount: "150",
      currency: "XTR",
      expiresAt: new Date(Date.now() - 1000),
    });
    await ctx.db.transaction.update({ where: { id: tx.id }, data: { status: "expired" } });
    expect(await settlePayment(ctx.db, { reference: tx.reference, externalId: "exp-0" })).toEqual({
      outcome: "rejected",
      reason: "bad_state",
    });
    expect((await handleSuccessfulPayment(ctx.db, tgId, sp(tx.reference, "exp-1"))).outcome).toBe(
      "paid",
    );
  });
});

describe("status endpoint + PRO propagation (dev completion)", () => {
  it("dev complete -> status paid -> PRO everywhere (limit lifted, premium template, no watermark)", async () => {
    const { tgId } = await newUser();
    const created = (await invoice(tgId)).json();
    const pend = await ctx.app.inject({
      url: `/api/payments/${created.reference}`,
      headers: authHeader(tgId),
    });
    expect(pend.json()).toMatchObject({
      status: "pending",
      isPro: false,
      provider: "stars",
      amount: "150",
      currency: "XTR",
    });

    const done = await ctx.app.inject({
      method: "POST",
      url: `/api/dev/payments/${created.reference}/complete`,
    });
    expect(done.json()).toEqual({ outcome: "paid" });
    const st = (
      await ctx.app.inject({ url: `/api/payments/${created.reference}`, headers: authHeader(tgId) })
    ).json();
    expect(st).toMatchObject({ status: "paid", isPro: true });
    expect(st.paidAt).toBeTruthy();

    const me = (await ctx.app.inject({ url: "/api/me", headers: authHeader(tgId) })).json();
    expect(me).toMatchObject({ isPro: true, dailyLimit: null });

    // premium template + 4 posts + no watermark
    const img = await solidImage();
    for (let i = 0; i < 4; i++) {
      const c = await createChain(ctx, newTgId(), `Pro propagation ${i}`);
      const r = await postImage(ctx, tgId, c, img, { templateId: "neon" });
      expect(r.statusCode).toBe(201);
      expect(r.json().post.watermarked).toBe(false);
    }
    // completing again is a no-op
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: `/api/dev/payments/${created.reference}/complete`,
        })
      ).json(),
    ).toEqual({ outcome: "already_paid" });
  });

  it("another user cannot read someone else's payment", async () => {
    const [a, b] = [await newUser(), await newUser()];
    const created = (await invoice(a.tgId)).json();
    const res = await ctx.app.inject({
      url: `/api/payments/${created.reference}`,
      headers: authHeader(b.tgId),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PAYMENT_NOT_FOUND");
  });

  it("dev completion endpoint does not exist without DEV_MODE", async () => {
    const prod = await createCtx({ DEV_MODE: "false" });
    const res = await prod.app.inject({ method: "POST", url: "/api/dev/payments/x/complete" });
    expect(res.statusCode).toBe(404);
    await prod.app.close();
  });
});
