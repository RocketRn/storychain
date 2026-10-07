import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { createBot } from "../src/bot";
import { createPending, refundPayment, settlePayment } from "../src/payments/ledger";
import {
  handleSuccessfulPayment,
  invoiceDescription,
  invoiceTitle,
  validatePreCheckout,
  type CreateInvoiceLink,
  type InvoiceLinkArgs,
} from "../src/payments/stars";
import { LEGACY } from "./legacy";
import { authHeader, createChain, createCtx, ensureUser, newTgId, type TestCtx } from "./helpers";

const H = 3_600_000;
const D = 24 * H;
let ctx: TestCtx;
const nowMs = Date.now();
const clock = () => new Date(nowMs);
const invoiceCalls: InvoiceLinkArgs[] = [];
const stubCreate: CreateInvoiceLink = async (a) => {
  invoiceCalls.push(a);
  return `https://t.me/$invoice_${a.payload}`;
};

beforeAll(async () => {
  ctx = await createCtx({}, { createInvoiceLink: stubCreate, now: clock });
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.db.$disconnect();
});

/** a creator with one chain */
async function creator(title = "Show your cat") {
  const tgId = newTgId();
  const user = await ensureUser(ctx, tgId);
  const chainId = await createChain(ctx, tgId, title);
  return { tgId, user, chainId };
}

const invoice = (tgId: number, body: Record<string, unknown>) =>
  ctx.app.inject({
    method: "POST",
    url: "/api/payments/stars/invoice",
    headers: authHeader(tgId),
    payload: body,
  });

const sp = (reference: string, charge: string, over: Record<string, unknown> = {}) => ({
  currency: "XTR",
  total_amount: 100,
  invoice_payload: reference,
  telegram_payment_charge_id: charge,
  ...over,
});

const chainRow = (id: string) => ctx.db.chain.findUniqueOrThrow({ where: { id } });

async function pendingOrder(planId = "boost_24h", amount = "100") {
  const c = await creator();
  const tx = await createPending(ctx.db, {
    userId: c.user.id,
    provider: "stars",
    planId,
    chainId: c.chainId,
    amount,
    currency: "XTR",
    expiresAt: new Date(Date.now() + H),
  });
  return { ...c, tx };
}

describe("POST /api/payments/stars/invoice", () => {
  it("creates a pending XTR order for the chain and an invoice link with the reference as payload", async () => {
    const { tgId, user, chainId } = await creator("Show your cat");
    const res = await invoice(tgId, { chainId, planId: "boost_24h" });
    expect(res.statusCode).toBe(200);
    const { invoiceUrl, reference } = res.json();
    expect(res.json()).toMatchObject({ chainId, planId: "boost_24h" });
    expect(invoiceUrl).toBe(`https://t.me/$invoice_${reference}`);
    const call = invoiceCalls.at(-1) as InvoiceLinkArgs;
    expect(call).toMatchObject({ currency: "XTR", payload: reference });
    expect(call.prices).toEqual([{ label: "24h", amount: 100 }]); // exactly one price item
    expect(call.title).toBe('Boost "Show your cat" — 24h');
    const tx = await ctx.db.transaction.findUniqueOrThrow({ where: { reference } });
    expect(tx).toMatchObject({
      userId: user.id,
      chainId,
      provider: "stars",
      planId: "boost_24h",
      status: "pending",
      amount: "100",
      currency: "XTR",
    });
    expect(tx.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("charges the 7-day price", async () => {
    const { tgId, chainId } = await creator();
    const res = await invoice(tgId, { chainId, planId: "boost_7d" });
    expect(invoiceCalls.at(-1)?.prices).toEqual([{ label: "7d", amount: 500 }]);
    expect(
      (await ctx.db.transaction.findUniqueOrThrow({ where: { reference: res.json().reference } }))
        .amount,
    ).toBe("500");
  });

  it("star prices are configurable by env", async () => {
    const custom = await createCtx(
      { STARS_BOOST_24H_PRICE: "7", STARS_BOOST_7D_PRICE: "70" },
      { createInvoiceLink: stubCreate },
    );
    const tgId = newTgId();
    const chainId = await createChain(custom, tgId);
    const res = await custom.app.inject({
      method: "POST",
      url: "/api/payments/stars/invoice",
      headers: authHeader(tgId),
      payload: { chainId, planId: "boost_7d" },
    });
    expect(invoiceCalls.at(-1)?.prices[0]?.amount).toBe(70);
    expect(res.statusCode).toBe(200);
    await custom.app.close();
  });

  it("validates: plan, chain, ownership, hidden chain, horizon", async () => {
    const { tgId, chainId } = await creator();
    const other = newTgId();
    await ensureUser(ctx, other);
    const code = async (r: ReturnType<typeof invoice>) => (await r).json().error?.code;
    expect(await code(invoice(tgId, { chainId, planId: "gold" }))).toBe("INVALID_BOOST_PLAN");
    expect(await code(invoice(tgId, { chainId, planId: LEGACY.plan }))).toBe("INVALID_BOOST_PLAN");
    expect(await code(invoice(tgId, { chainId: "nope1234", planId: "boost_24h" }))).toBe(
      "CHAIN_NOT_FOUND",
    );
    expect(await code(invoice(other, { chainId, planId: "boost_24h" }))).toBe("FORBIDDEN");
    expect((await invoice(other, { chainId, planId: "boost_24h" })).statusCode).toBe(403);
    expect((await invoice(tgId, { planId: "boost_24h" })).statusCode).toBe(400); // chainId is required
    expect((await invoice(tgId, { chainId, planId: 5 })).statusCode).toBe(400);

    await ctx.db.chain.update({
      where: { id: chainId },
      data: { boostedUntil: new Date(nowMs + 23 * D + 1) },
    });
    expect(await code(invoice(tgId, { chainId, planId: "boost_7d" }))).toBe(
      "BOOST_HORIZON_EXCEEDED",
    );
    expect((await invoice(tgId, { chainId, planId: "boost_24h" })).statusCode).toBe(200); // still inside 30 days
    await ctx.db.chain.update({ where: { id: chainId }, data: { isHidden: true } });
    expect(await code(invoice(tgId, { chainId, planId: "boost_24h" }))).toBe("CHAIN_NOT_BOOSTABLE");
    // nothing was created for the rejected attempts
    expect(await ctx.db.transaction.count({ where: { chainId, status: "pending" } })).toBe(1);
  });

  it("requires auth", async () => {
    const anon = await ctx.app.inject({
      method: "POST",
      url: "/api/payments/stars/invoice",
      payload: { chainId: "abc12345", planId: "boost_24h" },
    });
    expect(anon.statusCode).toBe(401);
  });

  it("falls back to a mock invoice URL in DEV_MODE without a bot, and is unavailable otherwise", async () => {
    const dev = await createCtx();
    const tgId = newTgId();
    const chainId = await createChain(dev, tgId);
    const res = await dev.app.inject({
      method: "POST",
      url: "/api/payments/stars/invoice",
      headers: authHeader(tgId),
      payload: { chainId, planId: "boost_24h" },
    });
    expect(res.json().invoiceUrl).toBe(`mock-invoice://${res.json().reference}`);
    await dev.app.close();

    const prodLike = await createCtx({ DEV_MODE: "false" });
    const t2 = newTgId();
    await ensureUser(prodLike, t2);
    const c2 = await prodLike.db.chain.create({
      data: {
        id: "prodlk01",
        title: "x chain",
        creatorId: (await prodLike.db.user.findUniqueOrThrow({ where: { telegramId: BigInt(t2) } }))
          .id,
      },
    });
    const res2 = await prodLike.app.inject({
      method: "POST",
      url: "/api/payments/stars/invoice",
      headers: authHeader(t2),
      payload: { chainId: c2.id, planId: "boost_24h" },
    });
    expect(res2.statusCode).toBe(503);
    expect(res2.json().error.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
    await prodLike.app.close();
  });

  it("invoice title/description respect Telegram limits (32 / 255) in both languages", () => {
    const long = "Очень длинное название марафона, которое точно не влезет в тридцать два символа";
    for (const ru of [true, false]) {
      for (const plan of ["boost_24h", "boost_7d"] as const) {
        const t = invoiceTitle(long, plan, ru);
        expect([...t].length).toBeLessThanOrEqual(32);
        expect(t).toContain("…");
        expect([...invoiceDescription(long.repeat(5), plan, ru)].length).toBeLessThanOrEqual(255);
      }
    }
    expect(invoiceTitle("Cats", "boost_7d", true)).toBe("Буст «Cats» — 7 дн");
    expect(invoiceTitle("🐱".repeat(40), "boost_24h", false).length).toBeGreaterThan(0);
  });
});

describe("pre_checkout validation", () => {
  const q = (tgId: number, ref: string, over: Record<string, unknown> = {}) => ({
    from: { id: tgId },
    currency: "XTR",
    total_amount: 100,
    invoice_payload: ref,
    ...over,
  });
  const check = (tgId: number, ref: string, over: Record<string, unknown> = {}) =>
    validatePreCheckout(ctx.db, ctx.config, q(tgId, ref, over), clock());

  it("accepts a matching pending order", async () => {
    const { tgId, tx } = await pendingOrder();
    expect(await check(tgId, tx.reference)).toEqual({ ok: true });
  });

  it("rejects amount/currency mismatch, unknown payload, other user, expired and settled orders", async () => {
    const { tgId, tx } = await pendingOrder();
    for (const bad of [
      check(tgId, tx.reference, { total_amount: 1 }),
      check(tgId, tx.reference, { currency: "USD" }),
      check(tgId, "nope"),
      check(tgId + 1, tx.reference),
    ]) {
      expect((await bad).ok).toBe(false);
    }
    const expired = await pendingOrder();
    await ctx.db.transaction.update({
      where: { id: expired.tx.id },
      data: { expiresAt: new Date(nowMs - 1000) },
    });
    expect((await check(expired.tgId, expired.tx.reference)).ok).toBe(false);
    await settlePayment(ctx.db, { reference: tx.reference, externalId: "c-pre-1" });
    expect((await check(tgId, tx.reference)).ok).toBe(false); // already paid
  });

  it("rejects when the chain is hidden, gone, or already boosted too far ahead", async () => {
    const hidden = await pendingOrder();
    await ctx.db.chain.update({ where: { id: hidden.chainId }, data: { isHidden: true } });
    const v = await check(hidden.tgId, hidden.tx.reference);
    expect(v).toEqual({ ok: false, message: "This marathon cannot be boosted" });

    const noChain = await pendingOrder();
    await ctx.db.transaction.update({ where: { id: noChain.tx.id }, data: { chainId: null } });
    expect((await check(noChain.tgId, noChain.tx.reference)).ok).toBe(false);

    const far = await pendingOrder("boost_7d", "500");
    await ctx.db.chain.update({
      where: { id: far.chainId },
      data: { boostedUntil: new Date(nowMs + 23 * D + 1) },
    });
    expect((await check(far.tgId, far.tx.reference, { total_amount: 500 })).ok).toBe(false);

    const badPlan = await pendingOrder(LEGACY.plan);
    expect((await check(badPlan.tgId, badPlan.tx.reference)).ok).toBe(false);
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
  let failReplies = false;
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  beforeAll(() => {
    bot = createBot(ctx.config, { db: ctx.db, botInfo });
    bot.api.config.use(async (_p, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      if (failReplies && method === "sendMessage") throw new Error("bot blocked by user");
      return { ok: true, result: true } as never;
    });
  });

  const message = (tgId: number, extra: Record<string, unknown>, lang = "en") => ({
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: 5,
      date: Math.floor(Date.now() / 1000),
      chat: { id: tgId, type: "private", first_name: "A" },
      from: { id: tgId, is_bot: false, first_name: "A", language_code: lang },
      ...extra,
    },
  });

  it("answers pre_checkout_query true/false", async () => {
    const { tgId, tx } = await pendingOrder();
    const upd = (payload: string, amount = 100) => ({
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

  it("answers false for a hidden chain", async () => {
    const { tgId, tx, chainId } = await pendingOrder();
    await ctx.db.chain.update({ where: { id: chainId }, data: { isHidden: true } });
    await bot.handleUpdate({
      update_id: 2,
      pre_checkout_query: {
        id: "q2",
        from: { id: tgId, is_bot: false, first_name: "A" },
        currency: "XTR",
        total_amount: 100,
        invoice_payload: tx.reference,
      },
    } as never);
    expect(calls.at(-1)?.payload).toMatchObject({ ok: false });
  });

  it("successful_payment boosts the chain for 24h and tells the creator (EN)", async () => {
    const { tgId, tx, chainId } = await pendingOrder();
    const before = Date.now();
    await bot.handleUpdate(
      message(tgId, { successful_payment: sp(tx.reference, "charge-bot-1") }) as never,
    );
    const chain = await chainRow(chainId);
    expect(chain.isBoosted).toBe(true);
    expect(chain.boostedUntil!.getTime()).toBeGreaterThanOrEqual(before + D - 1000);
    expect(chain.boostedUntil!.getTime()).toBeLessThanOrEqual(Date.now() + D + 1000);
    const sent = calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text as string;
    expect(sent).toContain("🔥 Your marathon «Show your cat» is boosted until");
    expect(await ctx.db.chainBoost.count({ where: { chainId } })).toBe(1);
    expect((await ctx.db.transaction.findUniqueOrThrow({ where: { id: tx.id } })).status).toBe(
      "paid",
    );
  });

  it("the notification is localized (RU)", async () => {
    const { tgId, tx } = await pendingOrder();
    await bot.handleUpdate(
      message(tgId, { successful_payment: sp(tx.reference, "charge-bot-ru") }, "ru") as never,
    );
    expect(calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text).toContain(
      "🔥 Ваш марафон «Show your cat» продвигается до",
    );
  });

  it("a double-delivered successful_payment does NOT extend twice", async () => {
    const { tgId, tx, chainId } = await pendingOrder();
    const upd = message(tgId, { successful_payment: sp(tx.reference, "charge-bot-dup") });
    await bot.handleUpdate(upd as never);
    const first = (await chainRow(chainId)).boostedUntil;
    await bot.handleUpdate(upd as never);
    await bot.handleUpdate(upd as never);
    expect((await chainRow(chainId)).boostedUntil).toEqual(first);
    expect(await ctx.db.chainBoost.count({ where: { chainId } })).toBe(1);
  });

  it("a failing notification never rolls the grant back", async () => {
    const { tgId, tx, chainId } = await pendingOrder();
    failReplies = true;
    try {
      await bot.handleUpdate(
        message(tgId, { successful_payment: sp(tx.reference, "charge-bot-fail") }) as never,
      );
    } finally {
      failReplies = false;
    }
    expect((await chainRow(chainId)).isBoosted).toBe(true);
    expect((await ctx.db.transaction.findUniqueOrThrow({ where: { id: tx.id } })).status).toBe(
      "paid",
    );
  });

  it("paid while the chain got hidden: order paid, no boost, the user is told", async () => {
    const { tgId, tx, chainId } = await pendingOrder();
    await ctx.db.chain.update({ where: { id: chainId }, data: { isHidden: true } });
    await bot.handleUpdate(
      message(tgId, { successful_payment: sp(tx.reference, "charge-bot-hid") }) as never,
    );
    expect((await chainRow(chainId)).boostedUntil).toBeNull();
    expect(await ctx.db.chainBoost.count({ where: { chainId } })).toBe(0);
    const paid = await ctx.db.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(paid.status).toBe("paid");
    expect(JSON.parse(paid.rawJson as string).note).toBe("chain_not_boostable");
    expect(calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text).toContain(
      "refund",
    );
  });

  it("refunded_payment revokes exactly that boost (idempotent)", async () => {
    const { tgId, tx, chainId } = await pendingOrder();
    await handleSuccessfulPayment(ctx.db, tgId, sp(tx.reference, "charge-refund-1"), clock());
    expect((await chainRow(chainId)).boostedUntil).not.toBeNull();
    const upd = message(tgId, {
      refunded_payment: {
        currency: "XTR",
        total_amount: 100,
        invoice_payload: tx.reference,
        telegram_payment_charge_id: "charge-refund-1",
      },
    });
    await bot.handleUpdate(upd as never);
    await bot.handleUpdate(upd as never);
    const c = await chainRow(chainId);
    expect(c).toMatchObject({ boostedUntil: null, isBoosted: false });
    expect((await ctx.db.transaction.findUniqueOrThrow({ where: { id: tx.id } })).status).toBe(
      "refunded",
    );
    expect(await ctx.db.chainBoost.count({ where: { txId: tx.id } })).toBe(0);
  });
});

describe("ledger idempotency & stacking math", () => {
  it("double successful_payment (same charge) -> one grant; concurrent deliveries too", async () => {
    const a = await pendingOrder();
    const [r1, r2] = [
      await handleSuccessfulPayment(ctx.db, a.tgId, sp(a.tx.reference, "dup-1"), clock()),
      await handleSuccessfulPayment(ctx.db, a.tgId, sp(a.tx.reference, "dup-1"), clock()),
    ];
    expect([r1.outcome, r2.outcome]).toEqual(["paid", "already_paid"]);

    const b = await pendingOrder();
    const rs = await Promise.all(
      Array.from({ length: 4 }, () =>
        handleSuccessfulPayment(ctx.db, b.tgId, sp(b.tx.reference, "race-1"), clock()),
      ),
    );
    expect(rs.filter((r) => r.outcome === "paid")).toHaveLength(1);
    expect(await ctx.db.chainBoost.count({ where: { chainId: b.chainId } })).toBe(1);
    expect((await chainRow(b.chainId)).boostedUntil).toEqual(new Date(nowMs + D));
  });

  it("a replayed charge id on another order is rejected", async () => {
    const a = await pendingOrder();
    const second = await createPending(ctx.db, {
      userId: a.user.id,
      provider: "stars",
      planId: "boost_24h",
      chainId: a.chainId,
      amount: "100",
      currency: "XTR",
      expiresAt: new Date(Date.now() + H),
    });
    await handleSuccessfulPayment(ctx.db, a.tgId, sp(a.tx.reference, "replay-1"), clock());
    const r = await handleSuccessfulPayment(
      ctx.db,
      a.tgId,
      sp(second.reference, "replay-1"),
      clock(),
    );
    expect(r).toEqual({ outcome: "rejected", reason: "replay" });
    expect((await ctx.db.transaction.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
      "pending",
    );
  });

  it("mismatching amount / user is NOT granted", async () => {
    const a = await pendingOrder();
    expect(
      (
        await handleSuccessfulPayment(
          ctx.db,
          a.tgId,
          sp(a.tx.reference, "mm-1", { total_amount: 50 }),
          clock(),
        )
      ).outcome,
    ).toBe("mismatch");
    expect(
      (await handleSuccessfulPayment(ctx.db, a.tgId + 1, sp(a.tx.reference, "mm-2"), clock()))
        .outcome,
    ).toBe("mismatch");
    expect((await chainRow(a.chainId)).boostedUntil).toBeNull();
  });

  it("a second purchase stacks from the current end; refunding the first removes only its 24h", async () => {
    const a = await pendingOrder();
    const second = await createPending(ctx.db, {
      userId: a.user.id,
      provider: "stars",
      planId: "boost_7d",
      chainId: a.chainId,
      amount: "500",
      currency: "XTR",
      expiresAt: new Date(Date.now() + H),
    });
    await handleSuccessfulPayment(ctx.db, a.tgId, sp(a.tx.reference, "stack-1"), clock());
    await handleSuccessfulPayment(
      ctx.db,
      a.tgId,
      sp(second.reference, "stack-2", { total_amount: 500 }),
      clock(),
    );
    expect((await chainRow(a.chainId)).boostedUntil).toEqual(new Date(nowMs + 8 * D));
    await refundPayment(ctx.db, { externalId: "stack-1" });
    expect((await chainRow(a.chainId)).boostedUntil).toEqual(new Date(nowMs + 7 * D));
    expect(await refundPayment(ctx.db, { externalId: "stack-1" })).toEqual({
      outcome: "noop",
      reason: "not_paid",
    });
    expect(await refundPayment(ctx.db, { externalId: "nope" })).toEqual({
      outcome: "noop",
      reason: "not_found",
    });
  });

  it("an expired order can still be settled by a real payment, but not by default", async () => {
    const a = await pendingOrder();
    await ctx.db.transaction.update({ where: { id: a.tx.id }, data: { status: "expired" } });
    expect(await settlePayment(ctx.db, { reference: a.tx.reference, externalId: "exp-0" })).toEqual(
      { outcome: "rejected", reason: "bad_state" },
    );
    expect(
      (await handleSuccessfulPayment(ctx.db, a.tgId, sp(a.tx.reference, "exp-1"), clock())).outcome,
    ).toBe("paid");
  });

  it("a legacy PRO order paid late is received but grants nothing", async () => {
    const a = await pendingOrder(LEGACY.plan, "150");
    const r = await handleSuccessfulPayment(
      ctx.db,
      a.tgId,
      sp(a.tx.reference, "legacy-1", { total_amount: 150 }),
      clock(),
    );
    expect(r.outcome).toBe("paid_no_boost");
    expect(await ctx.db.chainBoost.count({ where: { chainId: a.chainId } })).toBe(0);
  });
});

describe("status endpoint + dev completion (mock mode path)", () => {
  it("dev complete -> status paid with boostedUntil -> the chain is boosted for everyone", async () => {
    const c = await creator("Carousel candidate");
    const created = (await invoice(c.tgId, { chainId: c.chainId, planId: "boost_24h" })).json();
    const pend = await ctx.app.inject({
      url: `/api/payments/${created.reference}`,
      headers: authHeader(c.tgId),
    });
    expect(pend.json()).toMatchObject({
      status: "pending",
      chainId: c.chainId,
      planId: "boost_24h",
      boostedUntil: null,
      provider: "stars",
      amount: "100",
      currency: "XTR",
    });

    const done = await ctx.app.inject({
      method: "POST",
      url: `/api/dev/payments/${created.reference}/complete`,
    });
    expect(done.json()).toEqual({ outcome: "paid" });
    const st = (
      await ctx.app.inject({
        url: `/api/payments/${created.reference}`,
        headers: authHeader(c.tgId),
      })
    ).json();
    expect(st).toMatchObject({ status: "paid", chainId: c.chainId });
    expect(new Date(st.boostedUntil).getTime()).toBe(nowMs + D);
    const detail = (
      await ctx.app.inject({ url: `/api/chains/${c.chainId}`, headers: authHeader(newTgId()) })
    ).json();
    expect(detail.chain.isBoosted).toBe(true);
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
    const a = await creator();
    const b = newTgId();
    const created = (await invoice(a.tgId, { chainId: a.chainId, planId: "boost_24h" })).json();
    const res = await ctx.app.inject({
      url: `/api/payments/${created.reference}`,
      headers: authHeader(b),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PAYMENT_NOT_FOUND");
  });

  it("dev endpoints do not exist without DEV_MODE", async () => {
    const prod = await createCtx({ DEV_MODE: "false" });
    for (const url of [
      "/api/dev/payments/x/complete",
      "/api/dev/boost-chain",
      "/api/dev/expire-boost",
      "/api/dev/init-data",
    ]) {
      expect((await prod.app.inject({ method: "POST", url, payload: {} })).statusCode, url).toBe(
        404,
      );
    }
    await prod.app.close();
  });
});
