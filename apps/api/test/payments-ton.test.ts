import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Address } from "@ton/core";
import { loadConfig } from "../src/config";
import { createPending } from "../src/payments/ledger";
import { rawAddress, sameAddress } from "../src/payments/address";
import {
  parseTonApiEvents,
  TonApiIndexer,
  type JettonInfo,
  type JettonTransferEvent,
  type TonIndexer,
} from "../src/payments/tonIndexer";
import { CLOCK_SKEW_MS, LATE_GRACE_MS, matchEvent, TonVerifier } from "../src/payments/tonVerifier";
import { runTonStartupCheck } from "../src/payments/tonStartupCheck";
import { authHeader, createCtx, newTgId, type TestCtx } from "./helpers";

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
      GRM_PRO_30D_PRICE: "100",
    },
    {},
  );
  verifier = new TonVerifier({
    db: ctx.db,
    indexer,
    config: cfg,
    now: () => new Date(nowMs),
    logger: quiet,
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
  const tx = await createPending(ctx.db, {
    userId: user.id,
    provider: "ton_grm",
    planId: "pro_30d",
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
  return { tgId, user, tx: await ctx.db.transaction.findUniqueOrThrow({ where: { id: tx.id } }) };
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

const userOf = (id: string) => ctx.db.user.findUniqueOrThrow({ where: { id } });
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
  it("matches by comment == reference and grants PRO exactly once (idempotent)", async () => {
    const { tx, user } = await pendingTx();
    const e = ev(tx.reference);
    const r1 = await verifier.processEvents([e]);
    expect(r1[0]).toMatchObject({ status: "paid", reference: tx.reference, late: false });
    const paid = await txOf(tx.id);
    expect(paid).toMatchObject({ status: "paid", externalId: e.txHash });
    expect((await userOf(user.id)).proUntil!.getTime()).toBeGreaterThan(nowMs + 29 * 86_400_000);
    const again = await verifier.processEvents([e, e]);
    expect(again.every((r) => r.status === "already_paid")).toBe(true);
    expect(await ctx.db.subscription.count({ where: { txId: tx.id } })).toBe(1);
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
    const r = await verifier.processEvents([ev(low.tx.reference, { amount: PRICE - 1n })]);
    expect(r[0]).toMatchObject({ status: "ignored", reason: "amount_too_low" });
    expect((await txOf(low.tx.id)).status).toBe("pending");
    expect((await userOf(low.user.id)).proUntil).toBeNull();
    // the user tops up with a second sufficient transfer using the same reference
    expect(
      (await verifier.processEvents([ev(low.tx.reference, { amount: PRICE * 2n })]))[0]?.status,
    ).toBe("paid");
  });

  it("ignores the wrong jetton, wrong recipient and failed transfers", async () => {
    const { tx, user } = await pendingTx();
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
    expect((await userOf(user.id)).proUntil).toBeNull();
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
      planId: "pro_30d",
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

describe("TON HTTP endpoints", () => {
  const intent = (tgId: number, platform = "tdesktop") =>
    ctx.app.inject({
      method: "POST",
      url: "/api/payments/ton/intent",
      headers: { ...authHeader(tgId), "x-tg-platform": platform },
      payload: { planId: "pro_30d" },
    });

  it("intent returns everything needed for the Jetton transfer", async () => {
    const tgId = newTgId();
    const res = await intent(tgId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      jettonMaster: cfg.jettonMaster,
      merchantAddress: cfg.merchantAddress,
      amount: "100000000000",
      decimals: 9,
      forwardTonAmount: "10000000",
      gasAmount: "50000000",
    });
    expect(body.reference).toMatch(/^[A-Za-z0-9]{16}$/);
    const ttl = new Date(body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(29 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000);
    const tx = await ctx.db.transaction.findUniqueOrThrow({ where: { reference: body.reference } });
    expect(tx).toMatchObject({
      provider: "ton_grm",
      status: "pending",
      amount: "100000000000",
      currency: "GRM",
    });
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
      payload: { planId: "pro_30d" },
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
      payload: { planId: "pro_30d" },
    });
    expect(r.statusCode).toBe(503);
    await real.app.close();
    const mock = await createCtx();
    const m = await mock.app.inject({
      method: "POST",
      url: "/api/payments/ton/intent",
      headers: authHeader(tgId),
      payload: { planId: "pro_30d" },
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
        payload: { planId: "pro_30d" },
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
      isPro: false,
    });
    indexer.events = [ev(it1.reference)];
    const paid = (await confirm(tgId, it1.reference)).json();
    expect(paid).toMatchObject({ status: "paid", isPro: true, provider: "ton_grm" });
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

  it("dev completion grants PRO for a TON intent (mock mode path)", async () => {
    const mock = await createCtx();
    const tgId = newTgId();
    const i = (
      await mock.app.inject({
        method: "POST",
        url: "/api/payments/ton/intent",
        headers: authHeader(tgId),
        payload: { planId: "pro_30d" },
      })
    ).json();
    expect(
      (
        await mock.app.inject({ method: "POST", url: `/api/dev/payments/${i.reference}/complete` })
      ).json(),
    ).toEqual({ outcome: "paid" });
    expect(
      (await mock.app.inject({ url: "/api/me", headers: authHeader(tgId) })).json(),
    ).toMatchObject({ isPro: true, dailyLimit: null });
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
      expect(r1.json()).toEqual({ owner: OTHER.toRawString(), jettonWallet: indexer.wallet });
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
});

describe("TON startup self-check", () => {
  const prod = (env: Record<string, string> = {}) =>
    loadConfig({
      NODE_ENV: "production",
      BOT_TOKEN: "1:x",
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
