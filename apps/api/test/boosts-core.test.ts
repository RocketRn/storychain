import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import type { Config } from "../src/config";
import { createDb, type Db } from "../src/db";
import {
  applyBoost,
  assertBoostHorizon,
  boostWindow,
  isBoostActive,
  revokeBoost,
  startBoostSweeper,
  sweepExpiredBoosts,
  validateBoostPurchase,
} from "../src/boosts";
import { AppError } from "../src/errors";

const H = 3_600_000;
const D = 24 * H;
let db: Db;

beforeAll(() => {
  db = createDb(process.env.TEST_DATABASE_URL as string);
});
afterAll(async () => {
  await db.$disconnect();
});

let n = 0;
async function setup(chainOver: Record<string, unknown> = {}) {
  const user = await db.user.create({
    data: {
      telegramId: BigInt(9_000_000 + Math.floor(Math.random() * 1e9) + ++n),
      firstName: "Owner",
    },
  });
  const chain = await db.chain.create({
    data: {
      id: nanoid(8).replace(/[^A-Za-z0-9]/g, "x"),
      title: "Boost me",
      creatorId: user.id,
      ...chainOver,
    },
  });
  return { user, chain };
}

async function order(
  userId: string,
  chainId: string | null,
  planId = "boost_24h",
  over: Record<string, unknown> = {},
) {
  return db.transaction.create({
    data: {
      userId,
      chainId,
      provider: "stars",
      planId,
      status: "pending",
      amount: "100",
      currency: "XTR",
      reference: nanoid(16).replace(/[^A-Za-z0-9]/g, "a"),
      expiresAt: new Date(Date.now() + H),
      ...over,
    },
  });
}

const apply = (transactionId: string, now: Date, extra: Record<string, unknown> = {}) =>
  db.$transaction((tx) => applyBoost(tx, { transactionId, now, ...extra }));
const revoke = (transactionId: string, now: Date) =>
  db.$transaction((tx) => revokeBoost(tx, { transactionId, now }));
const chainOf = (id: string) => db.chain.findUniqueOrThrow({ where: { id } });
const T0 = new Date("2026-03-01T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("isBoostActive / boostWindow (pure)", () => {
  it("active iff boostedUntil > now (the boundary is exclusive)", () => {
    expect(isBoostActive({ boostedUntil: null }, T0)).toBe(false);
    expect(isBoostActive({ boostedUntil: at(1) }, T0)).toBe(true);
    expect(isBoostActive({ boostedUntil: T0 }, T0)).toBe(false);
    expect(isBoostActive({ boostedUntil: at(-1) }, T0)).toBe(false);
  });
  it("starts now when idle/expired, from the current end when running", () => {
    expect(boostWindow(T0, null, "boost_24h")).toEqual({ start: T0, end: at(D) });
    expect(boostWindow(T0, at(-H), "boost_7d")).toEqual({ start: T0, end: at(7 * D) });
    expect(boostWindow(T0, at(3 * H), "boost_24h")).toEqual({
      start: at(3 * H),
      end: at(3 * H + D),
    });
  });
});

describe("applyBoost", () => {
  it("fresh purchase: boostedUntil = now + duration, cache on, ChainBoost created, transaction paid", async () => {
    const { user, chain } = await setup();
    const t = await order(user.id, chain.id);
    const r = await apply(t.id, T0, { externalId: "ext-fresh-1" });
    expect(r.outcome).toBe("applied");
    const c = await chainOf(chain.id);
    expect(c.boostedUntil).toEqual(at(D));
    expect(c.isBoosted).toBe(true);
    const boosts = await db.chainBoost.findMany({ where: { chainId: chain.id } });
    expect(boosts).toHaveLength(1);
    expect(boosts[0]).toMatchObject({ planId: "boost_24h", txId: t.id, userId: user.id });
    expect(boosts[0]?.startsAt).toEqual(T0);
    expect(boosts[0]?.endsAt).toEqual(at(D));
    const paid = await db.transaction.findUniqueOrThrow({ where: { id: t.id } });
    expect(paid).toMatchObject({ status: "paid", externalId: "ext-fresh-1" });
    expect(paid.paidAt).toEqual(T0);
  });

  it("7-day plan", async () => {
    const { user, chain } = await setup();
    await apply((await order(user.id, chain.id, "boost_7d")).id, T0);
    expect((await chainOf(chain.id)).boostedUntil).toEqual(at(7 * D));
  });

  it("stacking extends from the CURRENT end, not from now", async () => {
    const { user, chain } = await setup();
    await apply((await order(user.id, chain.id)).id, T0); // ends T0+24h
    await apply((await order(user.id, chain.id, "boost_7d")).id, at(H)); // bought 1h later
    const c = await chainOf(chain.id);
    expect(c.boostedUntil).toEqual(at(D + 7 * D));
    const second = await db.chainBoost.findMany({
      where: { chainId: chain.id },
      orderBy: { startsAt: "asc" },
    });
    expect(second[1]?.startsAt).toEqual(at(D));
  });

  it("after the previous boost ended, a new one starts from now", async () => {
    const { user, chain } = await setup();
    await apply((await order(user.id, chain.id)).id, T0);
    await apply((await order(user.id, chain.id)).id, at(3 * D));
    expect((await chainOf(chain.id)).boostedUntil).toEqual(at(3 * D + D));
  });

  it("is idempotent: applying the same transaction twice grants once", async () => {
    const { user, chain } = await setup();
    const t = await order(user.id, chain.id);
    const a = await apply(t.id, T0, { externalId: "ext-idem" });
    const b = await apply(t.id, at(H), { externalId: "ext-idem" });
    expect([a.outcome, b.outcome]).toEqual(["applied", "already_applied"]);
    expect((await chainOf(chain.id)).boostedUntil).toEqual(at(D));
    expect(await db.chainBoost.count({ where: { txId: t.id } })).toBe(1);
  });

  it("concurrent applies of the same transaction grant once", async () => {
    const { user, chain } = await setup();
    const t = await order(user.id, chain.id);
    const rs = await Promise.all(Array.from({ length: 4 }, () => apply(t.id, T0)));
    expect(rs.filter((r) => r.outcome === "applied")).toHaveLength(1);
    expect(await db.chainBoost.count({ where: { txId: t.id } })).toBe(1);
    expect((await chainOf(chain.id)).boostedUntil).toEqual(at(D));
  });

  it("concurrent DIFFERENT purchases for one chain both count (no lost update)", async () => {
    const { user, chain } = await setup();
    const [a, b] = [await order(user.id, chain.id), await order(user.id, chain.id)];
    await Promise.all([apply(a.id, T0), apply(b.id, T0)]);
    expect((await chainOf(chain.id)).boostedUntil).toEqual(at(2 * D));
  });

  it("rejects a replayed externalId on another transaction", async () => {
    const { user, chain } = await setup();
    const [a, b] = [await order(user.id, chain.id), await order(user.id, chain.id)];
    await apply(a.id, T0, { externalId: "ext-replay" });
    const r = await apply(b.id, T0, { externalId: "ext-replay" });
    expect(r).toEqual({ outcome: "rejected", reason: "replay" });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      "pending",
    );
    expect(await db.chainBoost.count({ where: { chainId: chain.id } })).toBe(1);
  });

  it("state checks: unknown, refunded, failed, expired (unless allowExpired)", async () => {
    const { user, chain } = await setup();
    expect(await apply("nope", T0)).toEqual({ outcome: "rejected", reason: "not_found" });
    for (const status of ["refunded", "failed", "expired"]) {
      const t = await order(user.id, chain.id, "boost_24h", { status });
      expect(await apply(t.id, T0)).toEqual({ outcome: "rejected", reason: "bad_state" });
    }
    const late = await order(user.id, chain.id, "boost_24h", { status: "expired" });
    expect((await apply(late.id, T0, { allowExpired: true })).outcome).toBe("applied");
  });

  it("chain hidden between payment and fulfilment: transaction paid, NO boost, note recorded", async () => {
    const { user, chain } = await setup({ isHidden: true });
    const t = await order(user.id, chain.id, "boost_24h", { rawJson: JSON.stringify({ hint: 1 }) });
    const r = await apply(t.id, T0, { externalId: "ext-hidden", rawJson: { provider: "x" } });
    expect(r).toEqual({ outcome: "paid_no_boost", reason: "chain_not_boostable" });
    const paid = await db.transaction.findUniqueOrThrow({ where: { id: t.id } });
    expect(paid.status).toBe("paid");
    expect(JSON.parse(paid.rawJson as string)).toMatchObject({
      provider: "x",
      note: "chain_not_boostable",
    });
    expect(await db.chainBoost.count({ where: { chainId: chain.id } })).toBe(0);
    expect((await chainOf(chain.id)).boostedUntil).toBeNull();
    // idempotent: the second delivery does not change anything
    expect((await apply(t.id, T0)).outcome).toBe("paid_no_boost");
  });

  it("missing chain / legacy plan: paid, no boost", async () => {
    const { user, chain } = await setup();
    const noChain = await order(user.id, null);
    expect(await apply(noChain.id, T0)).toEqual({
      outcome: "paid_no_boost",
      reason: "chain_not_boostable",
    });
    const legacy = await order(user.id, chain.id, "pro_30d");
    expect(await apply(legacy.id, T0)).toEqual({
      outcome: "paid_no_boost",
      reason: "unknown_plan",
    });
    expect((await chainOf(chain.id)).boostedUntil).toBeNull();
  });
});

describe("revokeBoost (refund)", () => {
  it("takes off exactly this boost's duration; the other boost stays", async () => {
    const { user, chain } = await setup();
    const a = await order(user.id, chain.id); // 24h
    const b = await order(user.id, chain.id, "boost_7d");
    await apply(a.id, T0);
    await apply(b.id, T0);
    expect((await chainOf(chain.id)).boostedUntil).toEqual(at(8 * D));
    const r = await revoke(a.id, at(H));
    expect(r).toEqual({ outcome: "revoked", boostedUntil: at(7 * D) });
    const c = await chainOf(chain.id);
    expect(c.boostedUntil).toEqual(at(7 * D));
    expect(c.isBoosted).toBe(true);
    expect((await db.transaction.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "refunded",
    );
    expect(await db.chainBoost.count({ where: { txId: a.id } })).toBe(0);
  });

  it("refunding the only boost clears boostedUntil and the cache", async () => {
    const { user, chain } = await setup();
    const t = await order(user.id, chain.id);
    await apply(t.id, T0);
    await revoke(t.id, at(H));
    const c = await chainOf(chain.id);
    expect(c).toMatchObject({ boostedUntil: null, isBoosted: false });
  });

  it("a boost that already ran out ends up as null", async () => {
    const { user, chain } = await setup();
    const t = await order(user.id, chain.id);
    await apply(t.id, T0);
    expect(await revoke(t.id, at(5 * D))).toEqual({ outcome: "revoked", boostedUntil: null });
  });

  it("is idempotent and tolerant", async () => {
    const { user, chain } = await setup();
    const t = await order(user.id, chain.id);
    await apply(t.id, T0);
    await revoke(t.id, at(H));
    expect(await revoke(t.id, at(H))).toEqual({ outcome: "noop", reason: "not_paid" });
    expect(await revoke("nope", at(H))).toEqual({ outcome: "noop", reason: "not_found" });
    const pending = await order(user.id, chain.id);
    expect(await revoke(pending.id, at(H))).toEqual({ outcome: "noop", reason: "not_paid" });
  });

  it("refunding a paid-without-boost transaction just marks it refunded", async () => {
    const { user, chain } = await setup({ isHidden: true });
    const t = await order(user.id, chain.id);
    await apply(t.id, T0);
    expect(await revoke(t.id, at(H))).toEqual({ outcome: "revoked_no_boost" });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: t.id } })).status).toBe(
      "refunded",
    );
  });

  it("a refunded transaction can never be applied again", async () => {
    const { user, chain } = await setup();
    const t = await order(user.id, chain.id);
    await apply(t.id, T0);
    await revoke(t.id, at(H));
    expect(await apply(t.id, at(2 * H))).toEqual({ outcome: "rejected", reason: "bad_state" });
  });
});

describe("expiry: the cache never decides", () => {
  it("sweepExpiredBoosts flips only expired (or inconsistent) caches", async () => {
    const live = await setup({ isBoosted: true, boostedUntil: at(D) });
    const dead = await setup({ isBoosted: true, boostedUntil: at(-H) });
    const edge = await setup({ isBoosted: true, boostedUntil: T0 });
    const broken = await setup({ isBoosted: true, boostedUntil: null });
    const idle = await setup();
    const swept = await sweepExpiredBoosts(db, T0);
    expect(swept).toBeGreaterThanOrEqual(3);
    expect((await chainOf(live.chain.id)).isBoosted).toBe(true);
    for (const x of [dead, edge, broken]) expect((await chainOf(x.chain.id)).isBoosted).toBe(false);
    expect((await chainOf(idle.chain.id)).isBoosted).toBe(false);
    expect((await chainOf(dead.chain.id)).boostedUntil).toEqual(at(-H)); // history untouched
    expect(await sweepExpiredBoosts(db, T0)).toBe(0); // idempotent
  });

  it("the sweeper has an overlap guard", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fake = {
      chain: {
        updateMany: async () => {
          calls++;
          await gate;
          return { count: 2 };
        },
      },
    } as unknown as Db;
    const sweeper = startBoostSweeper(fake, { intervalMs: 3_600_000 });
    const [a, b, c] = [sweeper.tick(), sweeper.tick(), sweeper.tick()];
    release();
    expect(await Promise.all([a, b, c])).toEqual([2, 2, 2]);
    expect(calls).toBe(1);
    expect(await sweeper.tick()).toBe(2); // a later tick runs again
    expect(calls).toBe(2);
    sweeper.stop();
  });

  it("the sweeper survives a database error", async () => {
    const fake = {
      chain: { updateMany: async () => Promise.reject(new Error("db down")) },
    } as unknown as Db;
    const errs: unknown[] = [];
    const s = startBoostSweeper(fake, { intervalMs: 3_600_000, onError: (e) => errs.push(e) });
    expect(await s.tick()).toBe(0);
    expect(errs).toHaveLength(1);
    s.stop();
  });
});

describe("horizon guard", () => {
  const max = 30 * D;
  it("allows up to exactly the horizon and rejects beyond it", () => {
    const code = (fn: () => void) => {
      try {
        fn();
        return "ok";
      } catch (e) {
        return (e as AppError).code;
      }
    };
    expect(code(() => assertBoostHorizon({ boostedUntil: null }, "boost_7d", T0, max))).toBe("ok");
    expect(code(() => assertBoostHorizon({ boostedUntil: at(23 * D) }, "boost_7d", T0, max))).toBe(
      "ok",
    ); // exactly 30 d
    expect(
      code(() => assertBoostHorizon({ boostedUntil: at(23 * D + 1) }, "boost_7d", T0, max)),
    ).toBe("BOOST_HORIZON_EXCEEDED");
    expect(code(() => assertBoostHorizon({ boostedUntil: at(-D) }, "boost_7d", T0, max))).toBe(
      "ok",
    ); // expired: from now
    expect(code(() => assertBoostHorizon({ boostedUntil: at(29 * D) }, "boost_24h", T0, max))).toBe(
      "ok",
    );
    expect(
      code(() => assertBoostHorizon({ boostedUntil: at(29 * D + 1) }, "boost_24h", T0, max)),
    ).toBe("BOOST_HORIZON_EXCEEDED");
  });
});

describe("validateBoostPurchase", () => {
  const cfg = { boost: { maxHorizonMs: 30 * D } } as Pick<Config, "boost">;
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return "ok";
    } catch (e) {
      return (e as AppError).code;
    }
  };

  it("checks plan, existence, visibility, ownership and horizon", async () => {
    const { user, chain } = await setup();
    const other = await db.user.create({
      data: { telegramId: BigInt(8_000_000_000 + ++n), firstName: "Other" },
    });
    const ok = (over: Partial<{ chainId: string; planId: string; userId: string }> = {}) =>
      validateBoostPurchase(db, cfg, {
        chainId: chain.id,
        planId: "boost_24h",
        userId: user.id,
        now: T0,
        ...over,
      });
    expect(await code(ok())).toBe("ok");
    expect(await code(ok({ planId: "gold" }))).toBe("INVALID_BOOST_PLAN");
    expect(await code(ok({ planId: "pro_30d" }))).toBe("INVALID_BOOST_PLAN");
    expect(await code(ok({ chainId: "missing1" }))).toBe("CHAIN_NOT_FOUND");
    expect(await code(ok({ userId: other.id }))).toBe("FORBIDDEN");
    await db.chain.update({ where: { id: chain.id }, data: { boostedUntil: at(29 * D + 1) } });
    expect(await code(ok())).toBe("BOOST_HORIZON_EXCEEDED");
    await db.chain.update({ where: { id: chain.id }, data: { isHidden: true } });
    expect(await code(ok())).toBe("CHAIN_NOT_BOOSTABLE");
  });
});
