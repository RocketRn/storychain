import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Address } from "@ton/core";
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config";
import { createPending } from "../src/payments/ledger";
import { rawAddress, sameAddress } from "../src/payments/address";
import {
  MAX_HISTORY_PAGES,
  parseTonApiEvents,
  TonApiIndexer,
  type JettonInfo,
  type JettonTransferEvent,
  type TonIndexer,
} from "../src/payments/tonIndexer";
import {
  CLOCK_SKEW_MS,
  GRACE_POLL_INTERVAL_MS,
  LATE_GRACE_MS,
  matchEvent,
  TonVerifier,
} from "../src/payments/tonVerifier";
import { runTonStartupCheck } from "../src/payments/tonStartupCheck";
import { authHeader, createChain, createCtx, newTgId, type TestCtx } from "./helpers";

const MASTER = new Address(0, Buffer.alloc(32, 7));
const OTHER_MASTER = new Address(0, Buffer.alloc(32, 8));
const MERCHANT = new Address(0, Buffer.alloc(32, 9));
const OTHER = new Address(0, Buffer.alloc(32, 10));
const PRICE = 100_000_000_000n; // 100 GRM, 9 decimals

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

class FakeIndexer implements TonIndexer {
  events: JettonTransferEvent[] = [];
  calls = 0;
  wallet: string | null = "0:" + "ab".repeat(32);
  walletCalls = 0;
  info: JettonInfo = { decimals: 9, symbol: "GRAM" };
  gate: Promise<void> | null = null;
  async getRecentJettonTransfers() {
    this.calls++;
    if (this.gate) await this.gate;
    return this.events;
  }
  async getJettonWallet() {
    this.walletCalls++;
    return this.wallet;
  }
  async getJettonInfo() {
    return this.info;
  }
}

let ctx: TestCtx;
let indexer: FakeIndexer;
let verifier: TonVerifier;
const nowMs = Date.now();

const cfg = { jettonMaster: MASTER.toString(), merchantAddress: MERCHANT.toString() };

beforeAll(async () => {
  indexer = new FakeIndexer();
  verifier = new TonVerifier({ db: undefined as never, indexer, config: cfg });
  ctx = await createCtx(
    {
      TON_MERCHANT_ADDRESS: cfg.merchantAddress,
      GRM_JETTON_MASTER: cfg.jettonMaster,
      GRM_BOOST_24H_PRICE: "100",
      GRM_BOOST_7D_PRICE: "500",
    },
    {},
  );
  verifier = new TonVerifier({
    db: ctx.db,
    indexer,
    config: cfg,
    now: () => new Date(nowMs),
    logger: quiet,
    nudgeMinIntervalMs: 0, // the throttle has its own test; here every confirm should poll
  });
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.db.$disconnect();
});

async function pendingTx(
  opts: { amount?: bigint; createdAt?: Date; expiresAt?: Date; status?: string } = {},
) {
  const tgId = newTgId();
  await ctx.app.inject({ url: "/api/me", headers: authHeader(tgId) });
  const user = await ctx.db.user.findUniqueOrThrow({ where: { telegramId: BigInt(tgId) } });
  const chainId = await createChain(ctx, tgId);
  const tx = await createPending(ctx.db, {
    userId: user.id,
    provider: "ton_grm",
    planId: "boost_24h",
    chainId,
    amount: (opts.amount ?? PRICE).toString(),
    currency: "GRM",
    expiresAt: opts.expiresAt ?? new Date(nowMs + 30 * 60_000),
  });
  if (opts.createdAt || opts.status) {
    await ctx.db.transaction.update({
      where: { id: tx.id },
      data: {
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
    });
  }
  return {
    tgId,
    user,
    chainId,
    tx: await ctx.db.transaction.findUniqueOrThrow({ where: { id: tx.id } }),
  };
}

let hashN = 0;
const ev = (
  reference: string | null,
  over: Partial<JettonTransferEvent> = {},
): JettonTransferEvent => ({
  txHash: `hash-${++hashN}-${Math.random().toString(36).slice(2)}`,
  timestamp: Math.floor(nowMs / 1000),
  success: true,
  jettonMaster: MASTER.toString(),
  recipient: MERCHANT.toString(),
  amount: PRICE,
  comment: reference,
  ...over,
});

const chainOf = (id: string) => ctx.db.chain.findUniqueOrThrow({ where: { id } });
const txOf = (id: string) => ctx.db.transaction.findUniqueOrThrow({ where: { id } });

describe("raw address comparison", () => {
  it("treats bounceable, non-bounceable, testnet and raw spellings of one address as equal", () => {
    const forms = [
      MERCHANT.toString({ bounceable: true }),
      MERCHANT.toString({ bounceable: false }),
      MERCHANT.toString({ bounceable: true, testOnly: true }),
      MERCHANT.toRawString(),
    ];
    expect(new Set(forms).size).toBe(forms.length); // genuinely different strings
    for (const a of forms) for (const b of forms) expect(sameAddress(a, b)).toBe(true);
    expect(sameAddress(forms[0] as string, OTHER.toString())).toBe(false);
    expect(rawAddress(forms[1] as string)).toBe(MERCHANT.toRawString());
    expect(sameAddress("garbage", forms[0] as string)).toBe(false);
  });
});

describe("TonVerifier.processEvents", () => {
  it("matches by comment == reference and boosts the chain exactly once (idempotent)", async () => {
    const { tx, chainId } = await pendingTx();
    const e = ev(tx.reference);
    const r1 = await verifier.processEvents([e]);
    expect(r1[0]).toMatchObject({ status: "paid", reference: tx.reference, late: false });
    const paid = await txOf(tx.id);
    expect(paid).toMatchObject({ status: "paid", externalId: e.txHash });
    const boosted = await chainOf(chainId);
    expect(boosted.isBoosted).toBe(true);
    expect(boosted.boostedUntil).toEqual(new Date(nowMs + 24 * 3_600_000));
    const again = await verifier.processEvents([e, e]);
    expect(again.every((r) => r.status === "already_paid")).toBe(true);
    expect(await ctx.db.chainBoost.count({ where: { txId: tx.id } })).toBe(1);
  });

  it("7-day order boosts for 7 days; a second paid order stacks from the current end", async () => {
    const a = await pendingTx();
    await ctx.db.transaction.update({ where: { id: a.tx.id }, data: { planId: "boost_7d" } });
    await verifier.processEvents([ev(a.tx.reference)]);
    expect((await chainOf(a.chainId)).boostedUntil).toEqual(new Date(nowMs + 7 * 86_400_000));
    const second = await createPending(ctx.db, {
      userId: a.user.id,
      provider: "ton_grm",
      planId: "boost_24h",
      chainId: a.chainId,
      amount: PRICE.toString(),
      currency: "GRM",
      expiresAt: new Date(nowMs + 30 * 60_000),
    });
    await verifier.processEvents([ev(second.reference)]);
    expect((await chainOf(a.chainId)).boostedUntil).toEqual(new Date(nowMs + 8 * 86_400_000));
  });

  it("chain hidden after payment: order is paid, NO boost, a warning asks for a manual refund", async () => {
    const warnings: string[] = [];
    const warnVerifier = new TonVerifier({
      db: ctx.db,
      indexer,
      config: cfg,
      now: () => new Date(nowMs),
      logger: { ...quiet, warn: (_o, m) => void warnings.push(String(m)) },
    });
    const { tx, chainId } = await pendingTx();
    await ctx.db.chain.update({ where: { id: chainId }, data: { isHidden: true } });
    const e = ev(tx.reference);
    const r = await warnVerifier.processEvents([e]);
    expect(r[0]).toMatchObject({ status: "paid_no_boost", reason: "chain_not_boostable" });
    const paid = await txOf(tx.id);
    expect(paid.status).toBe("paid");
    expect(JSON.parse(paid.rawJson as string).note).toBe("chain_not_boostable");
    expect(await ctx.db.chainBoost.count({ where: { chainId } })).toBe(0);
    expect((await chainOf(chainId)).boostedUntil).toBeNull();
    expect(warnings.some((w) => w.includes("manual refund"))).toBe(true);
    // the same transfer seen on the next poll is a no-op
    expect((await warnVerifier.processEvents([e]))[0]?.status).toBe("already_paid");
  });

  it("matches when master / merchant arrive in a different (non-bounceable / raw) spelling", async () => {
    const { tx } = await pendingTx();
    const r = await verifier.processEvents([
      ev(tx.reference, {
        jettonMaster: MASTER.toRawString(),
        recipient: MERCHANT.toString({ bounceable: false }),
      }),
    ]);
    expect(r[0]?.status).toBe("paid");
  });

  it("accepts overpayment but leaves an underpayment pending", async () => {
    const low = await pendingTx();
    const lowChain = low.chainId;
    const r = await verifier.processEvents([ev(low.tx.reference, { amount: PRICE - 1n })]);
    expect(r[0]).toMatchObject({ status: "ignored", reason: "amount_too_low" });
    expect((await txOf(low.tx.id)).status).toBe("pending");
    expect((await chainOf(lowChain)).boostedUntil).toBeNull();
    // the user tops up with a second sufficient transfer using the same reference
    expect(
      (await verifier.processEvents([ev(low.tx.reference, { amount: PRICE * 2n })]))[0]?.status,
    ).toBe("paid");
  });

  it("ignores the wrong jetton, wrong recipient and failed transfers", async () => {
    const { tx, chainId } = await pendingTx();
    const rs = await verifier.processEvents([
      ev(tx.reference, { jettonMaster: OTHER_MASTER.toString() }),
      ev(tx.reference, { recipient: OTHER.toString() }),
      ev(tx.reference, { success: false }),
    ]);
    expect(rs.map((r) => (r.status === "ignored" ? r.reason : r.status))).toEqual([
      "wrong_jetton",
      "wrong_recipient",
      "failed",
    ]);
    expect((await txOf(tx.id)).status).toBe("pending");
    expect((await chainOf(chainId)).boostedUntil).toBeNull();
  });

  it("rejects a replay of the same on-chain transfer for another reference", async () => {
    const [a, b] = [await pendingTx(), await pendingTx()];
    const first = ev(a.tx.reference);
    await verifier.processEvents([first]);
    const replay = { ...first, comment: b.tx.reference }; // same tx hash, different comment
    const r = await verifier.processEvents([replay]);
    expect(r[0]).toMatchObject({ status: "ignored", reason: "replay" });
    expect((await txOf(b.tx.id)).status).toBe("pending");
  });

  it("ignores missing comments, unknown references and non-TON transactions", async () => {
    const tgId = newTgId();
    await ctx.app.inject({ url: "/api/me", headers: authHeader(tgId) });
    const user = await ctx.db.user.findUniqueOrThrow({ where: { telegramId: BigInt(tgId) } });
    const stars = await createPending(ctx.db, {
      userId: user.id,
      provider: "stars",
      planId: "boost_24h",
      chainId: await createChain(ctx, tgId),
      amount: "150",
      currency: "XTR",
      expiresAt: new Date(nowMs + 3600_000),
    });
    const rs = await verifier.processEvents([ev(null), ev("unknown-ref-123"), ev(stars.reference)]);
    expect(rs.every((r) => r.status === "ignored")).toBe(true);
    expect((await ctx.db.transaction.findUniqueOrThrow({ where: { id: stars.id } })).status).toBe(
      "pending",
    );
  });

  describe("expiry & late payments", () => {
    const expiresAt = () => new Date(nowMs - 60 * 60_000); // expired an hour ago
    const created = () => new Date(nowMs - 91 * 60_000);

    it("a transfer made BEFORE expiry is honored even if the tx was already marked expired", async () => {
      const { tx } = await pendingTx({
        createdAt: created(),
        expiresAt: expiresAt(),
        status: "expired",
      });
      const r = await verifier.processEvents([
        ev(tx.reference, { timestamp: Math.floor((expiresAt().getTime() - 5 * 60_000) / 1000) }),
      ]);
      expect(r[0]).toMatchObject({ status: "paid", late: false });
    });

    it("a late transfer within the grace window is honored (and flagged late)", async () => {
      const { tx } = await pendingTx({
        createdAt: created(),
        expiresAt: expiresAt(),
        status: "expired",
      });
      const r = await verifier.processEvents([
        ev(tx.reference, { timestamp: Math.floor(nowMs / 1000) }),
      ]);
      expect(r[0]).toMatchObject({ status: "paid", late: true });
    });

    it("a transfer beyond the grace window is NOT granted and stays expired", async () => {
      const exp = new Date(nowMs - LATE_GRACE_MS - 3_600_000);
      const { tx } = await pendingTx({
        createdAt: new Date(exp.getTime() - 30 * 60_000),
        expiresAt: exp,
        status: "expired",
      });
      const r = await verifier.processEvents([ev(tx.reference)]);
      expect(r[0]).toMatchObject({ status: "ignored", reason: "expired" });
      expect((await txOf(tx.id)).status).toBe("expired");
    });

    it("small clock skew after expiry is tolerated (not late)", () => {
      const tx = {
        amount: PRICE.toString(),
        createdAt: new Date(nowMs - 3_600_000),
        expiresAt: new Date(nowMs),
      };
      const m = matchEvent(
        ev("x", { timestamp: Math.floor((nowMs + CLOCK_SKEW_MS - 1000) / 1000) }),
        tx,
        cfg,
      );
      expect(m).toEqual({ ok: true, late: false });
    });

    it("a transfer from before the order existed is rejected", () => {
      const tx = {
        amount: PRICE.toString(),
        createdAt: new Date(nowMs),
        expiresAt: new Date(nowMs + 1_800_000),
      };
      expect(
        matchEvent(
          ev("x", { timestamp: Math.floor((nowMs - CLOCK_SKEW_MS - 10_000) / 1000) }),
          tx,
          cfg,
        ),
      ).toEqual({ ok: false, reason: "before_creation" });
    });
  });
});

describe("TonVerifier.tick (polling job)", () => {
  it("does not hit the indexer when there is nothing to wait for", async () => {
    await ctx.db.transaction.updateMany({
      where: { provider: "ton_grm", status: "pending" },
      data: { status: "failed" },
    });
    indexer.calls = 0;
    await verifier.tick();
    expect(indexer.calls).toBe(0);
  });

  it("expires old pendings, polls the indexer and applies transfers", async () => {
    const { tx } = await pendingTx();
    indexer.events = [ev(tx.reference)];
    indexer.calls = 0;
    await verifier.tick();
    expect(indexer.calls).toBe(1);
    expect((await txOf(tx.id)).status).toBe("paid");

    const old = await pendingTx({ expiresAt: new Date(nowMs - 60_000) });
    indexer.events = [];
    await verifier.tick();
    expect((await txOf(old.tx.id)).status).toBe("expired");
  });

  it("overlap guard: concurrent ticks share one run", async () => {
    await pendingTx();
    let release!: () => void;
    indexer.gate = new Promise<void>((r) => (release = r));
    indexer.calls = 0;
    const [a, b, c] = [verifier.tick(), verifier.tick(), verifier.tick()];
    release();
    await Promise.all([a, b, c]);
    indexer.gate = null;
    expect(indexer.calls).toBe(1);
  });

  it("an indexer outage is logged, not thrown", async () => {
    await pendingTx();
    const failing = new TonVerifier({
      db: ctx.db,
      indexer: {
        ...indexer,
        getRecentJettonTransfers: async () => Promise.reject(new Error("503")),
        getJettonWallet: indexer.getJettonWallet.bind(indexer),
        getJettonInfo: indexer.getJettonInfo.bind(indexer),
      },
      config: cfg,
      logger: quiet,
    });
    await expect(failing.tick()).resolves.toBeUndefined();
  });
});

describe("TonVerifier resilience", () => {
  /** a db whose first interactive transaction fails, like a dropped connection */
  const flakyOnce = () => {
    let failNext = true;
    return new Proxy(ctx.db, {
      get(target, prop) {
        if (prop === "$transaction") {
          return (...args: unknown[]) => {
            if (failNext) {
              failNext = false;
              return Promise.reject(new Error("db blip"));
            }
            return (target.$transaction as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as typeof ctx.db;
  };

  it("a transfer that fails to process does not block the ones behind it, nor itself on the next poll", async () => {
    const [a, b] = [await pendingTx(), await pendingTx()];
    const errors: string[] = [];
    const v = new TonVerifier({
      db: flakyOnce(),
      indexer,
      config: cfg,
      now: () => new Date(nowMs),
      logger: { ...quiet, error: (_o, m) => void errors.push(String(m)) },
    });
    const [ea, eb] = [ev(a.tx.reference), ev(b.tx.reference)];
    const first = await v.processEvents([ea, eb]);
    expect(first.map((r) => r.status)).toEqual(["ignored", "paid"]);
    expect(first[0]).toMatchObject({ reason: "processing_error", reference: a.tx.reference });
    expect(errors).toHaveLength(1);
    expect((await txOf(a.tx.id)).status).toBe("pending");
    // the next poll sees the same transfer again and now settles it
    expect((await v.processEvents([ea]))[0]?.status).toBe("paid");
    expect((await chainOf(a.chainId)).isBoosted).toBe(true);
  });

  it("tick() never rejects: a database failure is logged (an unhandled rejection would crash the API)", async () => {
    const errors: unknown[] = [];
    const broken = new Proxy(ctx.db, {
      get(target, prop) {
        if (prop === "transaction")
          return { updateMany: () => Promise.reject(new Error("connection reset")) };
        return Reflect.get(target, prop);
      },
    }) as typeof ctx.db;
    const v = new TonVerifier({
      db: broken,
      indexer,
      config: cfg,
      logger: { ...quiet, error: (o) => void errors.push(o) },
    });
    await expect(v.tick()).resolves.toBeUndefined();
    expect(errors).toEqual([{ err: "connection reset" }]);
    // and the overlap guard is released: a later tick runs again
    await expect(v.tick()).resolves.toBeUndefined();
    expect(errors).toHaveLength(2);
  });

  it("looks orders up in bulk, and not at all for comments that cannot be references", async () => {
    const queries: string[] = [];
    const logged = new PrismaClient({
      datasourceUrl: process.env.TEST_DATABASE_URL as string,
      log: [{ emit: "event", level: "query" }],
    });
    logged.$on("query", (e) => void queries.push(e.query));
    const v = new TonVerifier({
      db: logged as unknown as typeof ctx.db,
      indexer,
      config: cfg,
      now: () => new Date(nowMs),
      logger: quiet,
    });
    const lookups = () =>
      queries.filter((q) => /FROM .*Transaction/.test(q) && /reference.* IN \(/.test(q)).length;
    try {
      // free-text comments (what random senders write) never reach the database
      const noise = ["hello", "Thanks for the stream!", "x".repeat(200), "ref with spaces", "ab"];
      const quietRound = await v.processEvents(noise.map((c) => ev(c)));
      expect(quietRound.every((r) => r.status === "ignored")).toBe(true);
      expect(lookups()).toBe(0);

      // 250 reference-shaped comments: two queries (chunks of 200), not 250
      const mine = await pendingTx();
      const spam = Array.from({ length: 250 }, (_, i) =>
        ev(`spamreference${String(i).padStart(4, "0")}`),
      );
      const results = await v.processEvents([...spam, ev(mine.tx.reference)]);
      expect(lookups()).toBe(2);
      expect(results.filter((r) => r.status === "ignored")).toHaveLength(250);
      expect(results.at(-1)?.status).toBe("paid");
    } finally {
      await logged.$disconnect();
    }
  });

  it("two transfers for one order in the same batch: the second is seen as already paid", async () => {
    const { tx } = await pendingTx();
    const warnings: string[] = [];
    const v = new TonVerifier({
      db: ctx.db,
      indexer,
      config: cfg,
      now: () => new Date(nowMs),
      logger: { ...quiet, warn: (_o, m) => void warnings.push(String(m)) },
    });
    const rs = await v.processEvents([ev(tx.reference), ev(tx.reference)]);
    expect(rs.map((r) => r.status)).toEqual(["paid", "already_paid"]);
    expect(warnings).toContain("extra transfer for an already paid reference");
    expect(await ctx.db.chainBoost.count({ where: { txId: tx.id } })).toBe(1);
  });
});

describe("TonVerifier polling cadence", () => {
  const clearOpen = () =>
    ctx.db.transaction.updateMany({
      where: { provider: "ton_grm", status: { in: ["pending", "expired"] } },
      data: { status: "failed" },
    });

  it("polls every round while an order is live, but only once a minute for late-payment candidates", async () => {
    await clearOpen();
    let clock = nowMs;
    const probe = new FakeIndexer();
    const v = new TonVerifier({
      db: ctx.db,
      indexer: probe,
      config: cfg,
      now: () => new Date(clock),
      logger: quiet,
    });
    const live = await pendingTx();
    await v.tick();
    await v.tick();
    expect(probe.calls).toBe(2); // live order: every round

    // the buyer gave up an hour ago; a late transfer is still possible (grace window)
    await ctx.db.transaction.update({
      where: { id: live.tx.id },
      data: { status: "expired", expiresAt: new Date(nowMs - 3_600_000) },
    });
    probe.calls = 0;
    await v.tick();
    expect(probe.calls).toBe(1); // the first look is immediate
    clock += 30_000;
    await v.tick();
    await v.tick();
    expect(probe.calls).toBe(1); // then rate limited
    clock += GRACE_POLL_INTERVAL_MS;
    await v.tick();
    expect(probe.calls).toBe(2);

    // a new live order restores the fast cadence at once
    await pendingTx();
    await v.tick();
    expect(probe.calls).toBe(3);
    await clearOpen();
  });

  it("still honors a late transfer found by a grace-window poll", async () => {
    await clearOpen();
    const { tx } = await pendingTx({
      createdAt: new Date(nowMs - 91 * 60_000),
      expiresAt: new Date(nowMs - 60 * 60_000),
      status: "expired",
    });
    const probe = new FakeIndexer();
    probe.events = [ev(tx.reference)];
    const v = new TonVerifier({
      db: ctx.db,
      indexer: probe,
      config: cfg,
      now: () => new Date(nowMs),
      logger: quiet,
    });
    await v.tick();
    expect((await txOf(tx.id)).status).toBe("paid");
  });
});

describe("TonVerifier.nudge (the confirm endpoint's poll)", () => {
  it("polls at most once per interval however often it is pressed, and leaves no timer behind", async () => {
    await pendingTx();
    const probe = new FakeIndexer();
    const v = new TonVerifier({
      db: ctx.db,
      indexer: probe,
      config: cfg,
      now: () => new Date(nowMs),
      logger: quiet,
    }); // default throttle
    const clear = vi.spyOn(globalThis, "clearTimeout");
    try {
      await v.nudge();
      await v.nudge();
      await Promise.all([v.nudge(), v.nudge()]);
      expect(probe.calls).toBe(1);
      expect(clear).toHaveBeenCalled();
    } finally {
      clear.mockRestore();
    }
  });

  it("without throttling every call polls; it waits for a slow poll but never longer than waitMs", async () => {
    await pendingTx();
    const probe = new FakeIndexer();
    const v = new TonVerifier({
      db: ctx.db,
      indexer: probe,
      config: cfg,
      now: () => new Date(nowMs),
      logger: quiet,
      nudgeMinIntervalMs: 0,
    });
    await v.nudge();
    await v.nudge();
    expect(probe.calls).toBe(2);

    let release!: () => void;
    probe.gate = new Promise<void>((r) => (release = r));
    const t0 = Date.now();
    await v.nudge(40); // the indexer is "slow": give up waiting, keep the poll running
    expect(Date.now() - t0).toBeLessThan(2000);
    release();
    await v.tick(); // joins the running poll
    probe.gate = null;
  });
});

describe("TON HTTP endpoints", () => {
  const intent = async (tgId: number, platform = "tdesktop", over: Record<string, unknown> = {}) =>
    ctx.app.inject({
      method: "POST",
      url: "/api/payments/ton/intent",
      headers: { ...authHeader(tgId), "x-tg-platform": platform },
      payload: { chainId: await createChain(ctx, tgId), planId: "boost_24h", ...over },
    });

  it("intent returns everything needed for the Jetton transfer", async () => {
    const tgId = newTgId();
    const res = await intent(tgId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      planId: "boost_24h",
      jettonMaster: cfg.jettonMaster,
      merchantAddress: cfg.merchantAddress,
      amount: "100000000000",
      decimals: 9,
      forwardTonAmount: "10000000",
      gasAmount: "100000000",
      network: "mainnet",
    });
    expect(body.reference).toMatch(/^[A-Za-z0-9]{16}$/);
    // The reference Jetton wallet bounces (exit 709) unless the attached TON exceeds
    // forward + 2 forward fees + 2 * 0.015 gas + 0.01 storage reserve. Keep a clear margin above that.
    const needed = BigInt(body.forwardTonAmount) + 2_000_000n + 2n * 15_000_000n + 10_000_000n;
    expect(BigInt(body.gasAmount)).toBeGreaterThanOrEqual((needed * 3n) / 2n);
    const ttl = new Date(body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(29 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000);
    const tx = await ctx.db.transaction.findUniqueOrThrow({ where: { reference: body.reference } });
    expect(tx).toMatchObject({
      provider: "ton_grm",
      status: "pending",
      amount: "100000000000",
      currency: "GRM",
      chainId: body.chainId,
    });
  });

  it("the order expires 30 minutes after the (injectable) clock, not after the wall clock", async () => {
    const fixed = new Date("2030-01-01T00:00:00.000Z");
    const timed = await createCtx(
      { TON_MERCHANT_ADDRESS: cfg.merchantAddress, GRM_JETTON_MASTER: cfg.jettonMaster },
      { now: () => fixed },
    );
    const tgId = newTgId();
    const res = await timed.app.inject({
      method: "POST",
      url: "/api/payments/ton/intent",
      headers: authHeader(tgId),
      payload: { chainId: await createChain(timed, tgId), planId: "boost_24h" },
    });
    expect(res.json().expiresAt).toBe("2030-01-01T00:30:00.000Z");
    await timed.app.close();
  });

  it("the 7-day plan costs its own GRM price (bigint math, no floats)", async () => {
    const res = await intent(newTgId(), "tdesktop", { planId: "boost_7d" });
    expect(res.json()).toMatchObject({ planId: "boost_7d", amount: "500000000000" });
  });

  it("GRM prices come from env and keep fractional amounts exact", async () => {
    const frac = await createCtx({
      TON_MERCHANT_ADDRESS: cfg.merchantAddress,
      GRM_BOOST_24H_PRICE: "0.5",
      GRM_BOOST_7D_PRICE: "12.000000001",
    });
    const tgId = newTgId();
    const chainId = await createChain(frac, tgId);
    const r = await frac.app.inject({
      method: "POST",
      url: "/api/payments/ton/intent",
      headers: authHeader(tgId),
      payload: { chainId, planId: "boost_7d" },
    });
    expect(r.json().amount).toBe("12000000001");
    const r2 = await frac.app.inject({
      method: "POST",
      url: "/api/payments/ton/intent",
      headers: authHeader(tgId),
      payload: { chainId, planId: "boost_24h" },
    });
    expect(r2.json().amount).toBe("500000000");
    await frac.app.close();
  });

  it("validates like Stars: plan, creator, hidden chain, missing chain, horizon", async () => {
    const tgId = newTgId();
    const other = newTgId();
    const chainId = await createChain(ctx, tgId);
    await ctx.app.inject({ url: "/api/me", headers: authHeader(other) });
    const post = (id: number, body: Record<string, unknown>) =>
      ctx.app.inject({
        method: "POST",
        url: "/api/payments/ton/intent",
        headers: authHeader(id),
        payload: body,
      });
    const code = async (r: ReturnType<typeof post>) => (await r).json().error?.code;
    expect(await code(post(tgId, { chainId, planId: "gold" }))).toBe("INVALID_BOOST_PLAN");
    expect(await code(post(tgId, { chainId: "nope1234", planId: "boost_24h" }))).toBe(
      "CHAIN_NOT_FOUND",
    );
    expect(await code(post(other, { chainId, planId: "boost_24h" }))).toBe("FORBIDDEN");
    await ctx.db.chain.update({
      where: { id: chainId },
      data: { boostedUntil: new Date(Date.now() - 1000 + 29 * 24 * 3_600_000) },
    });
    expect(await code(post(tgId, { chainId, planId: "boost_24h" }))).toBeUndefined();
    expect(await code(post(tgId, { chainId, planId: "boost_7d" }))).toBe("BOOST_HORIZON_EXCEEDED");
    await ctx.db.chain.update({ where: { id: chainId }, data: { isHidden: true } });
    expect(await code(post(tgId, { chainId, planId: "boost_24h" }))).toBe("CHAIN_NOT_BOOSTABLE");
  });

  it("platform policy: not on iOS/Android unless TON_PAYMENTS_ALL_PLATFORMS=true", async () => {
    const tgId = newTgId();
    for (const p of ["ios", "android"]) {
      const res = await intent(tgId, p);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
    }
    expect((await intent(tgId, "macos")).statusCode).toBe(200);
    const open = await createCtx({
      TON_PAYMENTS_ALL_PLATFORMS: "true",
      TON_MERCHANT_ADDRESS: cfg.merchantAddress,
    });
    const ok = await open.app.inject({
      method: "POST",
      url: "/api/payments/ton/intent",
      headers: { ...authHeader(tgId), "x-tg-platform": "ios" },
      payload: { chainId: await createChain(open, tgId), planId: "boost_24h" },
    });
    expect(ok.statusCode).toBe(200);
    await open.app.close();
  });

  it("without a merchant address real mode refuses, mock mode still works", async () => {
    const tgId = newTgId();
    const real = await createCtx({ DEV_MODE: "false" });
    const r = await real.app.inject({
      method: "POST",
      url: "/api/payments/ton/intent",
      headers: authHeader(tgId),
      payload: { chainId: "abc12345", planId: "boost_24h" },
    });
    expect(r.statusCode).toBe(503);
    await real.app.close();
    const mock = await createCtx();
    const m = await mock.app.inject({
      method: "POST",
      url: "/api/payments/ton/intent",
      headers: authHeader(tgId),
      payload: { chainId: await createChain(mock, tgId), planId: "boost_24h" },
    });
    expect(m.statusCode).toBe(200);
    expect(m.json().merchantAddress).toBe("");
    await mock.app.close();
  });

  it("confirm triggers an immediate verification and returns the status", async () => {
    const confirmCtx = await createCtx(
      { TON_MERCHANT_ADDRESS: cfg.merchantAddress, GRM_JETTON_MASTER: cfg.jettonMaster },
      { indexer, verifier },
    );
    const tgId = newTgId();
    const it1 = (
      await confirmCtx.app.inject({
        method: "POST",
        url: "/api/payments/ton/intent",
        headers: authHeader(tgId),
        payload: { chainId: await createChain(confirmCtx, tgId), planId: "boost_24h" },
      })
    ).json();
    const confirm = (id: number, reference: string) =>
      confirmCtx.app.inject({
        method: "POST",
        url: "/api/payments/ton/confirm",
        headers: authHeader(id),
        payload: { reference, boc: "te6cc..." },
      });

    indexer.events = [];
    expect((await confirm(tgId, it1.reference)).json()).toMatchObject({
      status: "pending",
      boostedUntil: null,
      chainId: it1.chainId,
    });
    indexer.events = [ev(it1.reference)];
    const paid = (await confirm(tgId, it1.reference)).json();
    expect(paid).toMatchObject({ status: "paid", provider: "ton_grm", chainId: it1.chainId });
    expect(new Date(paid.boostedUntil).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(
      (
        await confirmCtx.app.inject({
          url: `/api/payments/${it1.reference}`,
          headers: authHeader(tgId),
        })
      ).json().status,
    ).toBe("paid");
    // other users cannot confirm / read it
    expect((await confirm(newTgId(), it1.reference)).statusCode).toBe(404);
    // bad input
    expect((await confirm(tgId, "x")).statusCode).toBe(400);
    await confirmCtx.app.close();
  });

  it("dev completion boosts the chain for a TON intent (mock mode path)", async () => {
    const mock = await createCtx();
    const tgId = newTgId();
    const i = (
      await mock.app.inject({
        method: "POST",
        url: "/api/payments/ton/intent",
        headers: authHeader(tgId),
        payload: { chainId: await createChain(mock, tgId), planId: "boost_24h" },
      })
    ).json();
    expect(
      (
        await mock.app.inject({ method: "POST", url: `/api/dev/payments/${i.reference}/complete` })
      ).json(),
    ).toEqual({ outcome: "paid" });
    const row = await mock.db.chain.findUniqueOrThrow({ where: { id: i.chainId } });
    expect(row.isBoosted).toBe(true);
    expect(row.boostedUntil!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    await mock.app.close();
  });

  describe("GET /api/ton/jetton-wallet", () => {
    it("resolves, caches per owner (any address spelling) and validates input", async () => {
      const walletCtx = await createCtx(
        { TON_MERCHANT_ADDRESS: cfg.merchantAddress, GRM_JETTON_MASTER: cfg.jettonMaster },
        { indexer },
      );
      const tgId = newTgId();
      const get = (owner: string) =>
        walletCtx.app.inject({
          url: `/api/ton/jetton-wallet?owner=${encodeURIComponent(owner)}`,
          headers: authHeader(tgId),
        });
      indexer.walletCalls = 0;
      const r1 = await get(OTHER.toString());
      expect(r1.statusCode).toBe(200);
      expect(r1.json()).toEqual({
        owner: OTHER.toRawString(),
        jettonWallet: indexer.wallet,
        network: "mainnet",
      });
      await get(OTHER.toString({ bounceable: false }));
      await get(OTHER.toRawString());
      expect(indexer.walletCalls).toBe(1);
      expect((await get("not-an-address-at-all")).statusCode).toBe(400);
      expect(
        (await walletCtx.app.inject({ url: `/api/ton/jetton-wallet?owner=${OTHER.toString()}` }))
          .statusCode,
      ).toBe(401);
      indexer.wallet = null;
      expect((await get(new Address(0, Buffer.alloc(32, 77)).toString())).statusCode).toBe(404);
      indexer.wallet = "0:" + "ab".repeat(32);
      await walletCtx.app.close();
    });
    it("is unavailable without an indexer (mock mode)", async () => {
      const mock = await createCtx();
      const res = await mock.app.inject({
        url: `/api/ton/jetton-wallet?owner=${OTHER.toString()}`,
        headers: authHeader(newTgId()),
      });
      expect(res.statusCode).toBe(503);
      await mock.app.close();
    });
  });
});

describe("TonAPI indexer adapter", () => {
  const fixture = {
    events: [
      {
        event_id: "aa11",
        timestamp: 1_700_000_100,
        lt: 500,
        in_progress: false,
        actions: [
          {
            type: "JettonTransfer",
            status: "ok",
            JettonTransfer: {
              sender: { address: OTHER.toRawString() },
              recipient: { address: MERCHANT.toRawString() },
              amount: "100000000000",
              comment: "ref0123456789abcd",
              jetton: { address: MASTER.toRawString(), symbol: "GRAM" },
            },
          },
          { type: "TonTransfer", status: "ok" },
        ],
      },
      {
        event_id: "bb22",
        timestamp: 1_700_000_050,
        lt: 400,
        in_progress: true,
        actions: [
          {
            type: "JettonTransfer",
            status: "ok",
            JettonTransfer: {
              recipient: { address: MERCHANT.toRawString() },
              amount: "1",
              jetton: { address: MASTER.toRawString() },
            },
          },
        ],
      },
      {
        event_id: "cc33",
        timestamp: 1_700_000_010,
        lt: 300,
        actions: [
          {
            type: "JettonTransfer",
            status: "failed",
            JettonTransfer: {
              recipient: { address: MERCHANT.toRawString() },
              amount: "5",
              jetton: { address: MASTER.toRawString() },
            },
          },
        ],
      },
    ],
    next_from: 300,
  };

  it("maps AccountEvents to transfers (skips non-jetton and in-progress events, keeps failures flagged)", () => {
    const { events } = parseTonApiEvents(fixture);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      txHash: "aa11",
      timestamp: 1_700_000_100,
      success: true,
      jettonMaster: MASTER.toRawString(),
      recipient: MERCHANT.toRawString(),
      sender: OTHER.toRawString(),
      amount: 100_000_000_000n,
      comment: "ref0123456789abcd",
    });
    expect(events[1]).toMatchObject({ txHash: "cc33", success: false, comment: null });
  });

  it("sends the API key, since/limit params, pages back and parses metadata", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const page2 = { events: [{ event_id: "dd44", timestamp: 1, lt: 100, actions: [] }] };
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
      const body = url.includes("before_lt")
        ? page2
        : url.includes("/history")
          ? fixture
          : url.includes("/v2/accounts/")
            ? { wallet_address: { address: "0:wallet" } }
            : { metadata: { decimals: "9", symbol: "GRAM" } };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const api = new TonApiIndexer({ apiKey: "KEY", network: "mainnet", fetchImpl });
    const events = await api.getRecentJettonTransfers({
      account: MERCHANT.toString(),
      jettonMaster: MASTER.toString(),
      limit: 3,
      since: 1234,
    });
    expect(events.map((e) => e.txHash)).toEqual(["aa11", "cc33"]);
    expect(seen).toHaveLength(2); // second page requested because the first was full
    expect(seen[0]?.url).toContain("https://tonapi.io/v2/accounts/");
    expect(seen[0]?.url).toContain("start_date=1234");
    expect(seen[1]?.url).toContain("before_lt=300");
    expect(seen.every((s) => s.auth === "Bearer KEY")).toBe(true);
    expect(await api.getJettonInfo(MASTER.toString())).toEqual({ decimals: 9, symbol: "GRAM" });
    expect(await api.getJettonWallet(OTHER.toString(), MASTER.toString())).toBe("0:wallet");
  });

  it("uses the testnet host and maps 404 to 'no wallet'", async () => {
    let url = "";
    const fetchImpl = (async (u: string) => {
      url = u;
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const api = new TonApiIndexer({ apiKey: "", network: "testnet", fetchImpl });
    expect(await api.getJettonWallet(OTHER.toString(), MASTER.toString())).toBeNull();
    expect(url.startsWith("https://testnet.tonapi.io/")).toBe(true);
  });

  describe("tolerance", () => {
    const good = {
      event_id: "ok1",
      timestamp: 10,
      lt: 90,
      actions: [
        {
          type: "JettonTransfer",
          status: "ok",
          JettonTransfer: {
            recipient: { address: MERCHANT.toRawString() },
            amount: "7",
            comment: null, // some indexers send null instead of omitting the field
            jetton: { address: MASTER.toRawString() },
          },
        },
      ],
    };

    it("keeps every understandable transfer when others in the same page are malformed", () => {
      const page = {
        events: [
          { nonsense: true },
          "a string",
          null,
          {
            event_id: "bad-amount",
            timestamp: 9,
            lt: 95,
            actions: [
              {
                type: "JettonTransfer",
                status: "ok",
                JettonTransfer: {
                  recipient: { address: "0:x" },
                  amount: "12e3",
                  jetton: { address: "0:y" },
                },
              },
            ],
          },
          {
            event_id: "no-jetton",
            timestamp: 9,
            lt: 94,
            actions: [
              {
                type: "JettonTransfer",
                status: "ok",
                JettonTransfer: { recipient: { address: "0:x" }, amount: "1" },
              },
            ],
          },
          {
            event_id: "odd-actions",
            timestamp: 9,
            lt: 93,
            actions: [42, { type: "Whatever" }, { type: "NftTransfer", status: 5 }],
          },
          good,
        ],
      };
      const r = parseTonApiEvents(page);
      expect(r.events.map((e) => e.txHash)).toEqual(["ok1"]);
      expect(r.events[0]).toMatchObject({ comment: null, amount: 7n });
      expect(r.count).toBe(7); // the raw page size drives paging
      expect(r.skipped).toBe(5); // 3 unreadable events + 2 unreadable jetton transfers; other action types do not count
      expect(r.lastLt).toBe(90);
    });

    it("still rejects a response that is not an event list at all", () => {
      expect(() => parseTonApiEvents({})).toThrow();
      expect(() => parseTonApiEvents({ events: "x" })).toThrow();
      expect(() => parseTonApiEvents(null)).toThrow();
    });

    const api = (
      page: (n: number) => unknown,
      logger: { warn: (o: unknown, m?: string) => void },
    ) => {
      let n = 0;
      const fetchImpl = (async () =>
        new Response(JSON.stringify(page(n++)))) as unknown as typeof fetch;
      return {
        indexer: new TonApiIndexer({ apiKey: "", network: "mainnet", fetchImpl, logger }),
        pages: () => n,
      };
    };
    const ask = (i: TonApiIndexer, limit = 2) =>
      i.getRecentJettonTransfers({
        account: MERCHANT.toString(),
        jettonMaster: MASTER.toString(),
        limit,
      });

    it("warns when the page cap cut the history window short (spam could hide a real payment)", async () => {
      const warns: Array<{ o: unknown; m?: string }> = [];
      let lt = 10_000;
      const { indexer: i, pages } = api(
        () => ({
          events: [0, 1].map(() => ({ event_id: `e${lt}`, timestamp: 1, lt: lt--, actions: [] })),
        }),
        { warn: (o, m) => void warns.push({ o, m }) },
      );
      await ask(i);
      expect(pages()).toBe(MAX_HISTORY_PAGES);
      expect(warns).toHaveLength(1);
      expect(warns[0]?.m).toMatch(/truncated/);
    });

    it("does not warn when the window was read to its start", async () => {
      const warns: unknown[] = [];
      const { indexer: i, pages } = api(
        (n) =>
          n === 0
            ? {
                events: [1, 2].map((k) => ({
                  event_id: `p${k}`,
                  timestamp: 1,
                  lt: 50 - k,
                  actions: [],
                })),
              }
            : { events: [{ event_id: "last", timestamp: 1, lt: 10, actions: [] }] },
        { warn: (o) => void warns.push(o) },
      );
      await ask(i);
      expect(pages()).toBe(2);
      expect(warns).toEqual([]);
    });

    it("reports events it had to skip, without failing the poll", async () => {
      const warns: Array<{ o: unknown; m?: string }> = [];
      const { indexer: i } = api(() => ({ events: [{ junk: 1 }, good] }), {
        warn: (o, m) => void warns.push({ o, m }),
      });
      const out = await ask(i, 100);
      expect(out.map((e) => e.txHash)).toEqual(["ok1"]);
      expect(warns).toHaveLength(1);
      expect(warns[0]).toMatchObject({ o: { skipped: 1 }, m: expect.stringMatching(/ignored/) });
    });
  });
});

describe("TON startup self-check", () => {
  const prod = (env: Record<string, string> = {}) =>
    loadConfig({
      NODE_ENV: "production",
      BOT_TOKEN: "123456789:AAH_test_token_for_unit_tests_01234",
      BOT_USERNAME: "b",
      TONAPI_KEY: "k",
      TONCONNECT_MANIFEST_URL: "https://x/m.json",
      WEBAPP_URL: "https://x",
      PUBLIC_BASE_URL: "https://x",
      TON_MERCHANT_ADDRESS: cfg.merchantAddress,
      GRM_JETTON_MASTER: cfg.jettonMaster,
      GRM_DECIMALS: "9",
      GRM_SYMBOL: "GRAM",
      ...env,
    } as NodeJS.ProcessEnv);

  it("passes when decimals match", async () => {
    const i = new FakeIndexer();
    expect(await runTonStartupCheck({ config: prod(), indexer: i, logger: quiet })).toBe("ok");
  });

  it("REFUSES to start on a decimals mismatch", async () => {
    const i = new FakeIndexer();
    i.info = { decimals: 6, symbol: "GRAM" };
    await expect(runTonStartupCheck({ config: prod(), indexer: i, logger: quiet })).rejects.toThrow(
      /decimals/,
    );
  });

  it("only warns on a symbol mismatch", async () => {
    const i = new FakeIndexer();
    i.info = { decimals: 9, symbol: "OTHER" };
    const warn = vi.fn();
    expect(
      await runTonStartupCheck({
        config: prod(),
        indexer: i,
        logger: { info: () => undefined, warn },
      }),
    ).toBe("ok");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("rejects unparsable addresses", async () => {
    await expect(
      runTonStartupCheck({
        config: prod({ GRM_JETTON_MASTER: "nope" }),
        indexer: new FakeIndexer(),
        logger: quiet,
      }),
    ).rejects.toThrow(/invalid address/);
    await expect(
      runTonStartupCheck({
        config: prod({ TON_MERCHANT_ADDRESS: "nope" }),
        indexer: new FakeIndexer(),
        logger: quiet,
      }),
    ).rejects.toThrow(/invalid address/);
  });

  it("is skipped in mock mode and when TON payments are off (no network, no env needed)", async () => {
    const i = new FakeIndexer();
    i.info = { decimals: 1, symbol: "X" };
    const dev = loadConfig({
      NODE_ENV: "development",
      DEV_MODE: "true",
      TON_MERCHANT_ADDRESS: cfg.merchantAddress,
    } as NodeJS.ProcessEnv);
    expect(await runTonStartupCheck({ config: dev, indexer: i, logger: quiet })).toBe("skipped");
    const off = loadConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(await runTonStartupCheck({ config: off, indexer: i, logger: quiet })).toBe("skipped");
  });
});
