import type { Transaction } from "@prisma/client";
import type { Db } from "../db";
import { sameAddress } from "./address";
import { expirePending, settlePayment, type SettleResult } from "./ledger";
import type { JettonTransferEvent, TonIndexer } from "./tonIndexer";

export const CLOCK_SKEW_MS = 5 * 60 * 1000;
/**
 * Late payments: a transfer that lands after `expiresAt` (+ skew) but within this grace is still honored and
 * logged. The user paid real money; refusing would strand it. Beyond the grace we leave the tx `expired`
 * and log it for manual handling.
 */
export const LATE_GRACE_MS = 24 * 60 * 60 * 1000;
/**
 * While only already-expired orders are waiting (the buyer gave up, a late transfer is merely possible) the
 * indexer is asked this rarely instead of every poll. A live order always gets the fast cadence.
 */
export const GRACE_POLL_INTERVAL_MS = 60_000;
/** The confirm endpoint triggers at most one extra poll per this interval, however many users press it. */
export const NUDGE_MIN_INTERVAL_MS = 3_000;
/** Shape of the references we issue (see ledger.newReference). Anything else cannot be one of our orders. */
const REFERENCE_SHAPE = /^[A-Za-z0-9]{8,32}$/;
const LOOKUP_CHUNK = 200;

export interface VerifierConfig {
  jettonMaster: string;
  merchantAddress: string;
}

export type MatchResult =
  | { ok: true; late: boolean }
  | {
      ok: false;
      reason:
        | "failed"
        | "wrong_jetton"
        | "wrong_recipient"
        | "amount_too_low"
        | "before_creation"
        | "expired";
    };

/** Pure decision: does this transfer pay this transaction? Addresses compared in RAW form. */
export function matchEvent(
  ev: JettonTransferEvent,
  tx: Pick<Transaction, "amount" | "createdAt" | "expiresAt">,
  cfg: VerifierConfig,
): MatchResult {
  if (!ev.success) return { ok: false, reason: "failed" };
  if (!sameAddress(ev.jettonMaster, cfg.jettonMaster)) return { ok: false, reason: "wrong_jetton" };
  if (!sameAddress(ev.recipient, cfg.merchantAddress))
    return { ok: false, reason: "wrong_recipient" };
  if (ev.amount < BigInt(tx.amount)) return { ok: false, reason: "amount_too_low" };
  const t = ev.timestamp * 1000;
  if (t < tx.createdAt.getTime() - CLOCK_SKEW_MS) return { ok: false, reason: "before_creation" };
  const deadline = tx.expiresAt.getTime() + CLOCK_SKEW_MS;
  if (t <= deadline) return { ok: true, late: false };
  if (t <= tx.expiresAt.getTime() + LATE_GRACE_MS) return { ok: true, late: true };
  return { ok: false, reason: "expired" };
}

export type ProcessResult =
  | { txHash: string; reference: string; status: "paid"; late: boolean }
  | { txHash: string; reference: string; status: "already_paid" }
  | { txHash: string; reference: string; status: "paid_no_boost"; reason: string }
  | { txHash: string; reference: string | null; status: "ignored"; reason: string };

interface Logger {
  info(o: unknown, msg?: string): void;
  warn(o: unknown, msg?: string): void;
  error(o: unknown, msg?: string): void;
}
const consoleLogger: Logger = {
  info: (o, m) => console.info("[ton]", m ?? "", o),
  warn: (o, m) => console.warn("[ton]", m ?? "", o),
  error: (o, m) => console.error("[ton]", m ?? "", o),
};

export class TonVerifier {
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** wall-clock start of the last poll (throttles `nudge`, independent of the injectable business clock) */
  private lastRunStartedAt: number | null = null;
  /** business-clock time of the last grace-only poll */
  private lastGraceScanAt: number | null = null;

  constructor(
    private readonly deps: {
      db: Db;
      indexer: TonIndexer;
      config: VerifierConfig;
      now?: () => Date;
      logger?: Logger;
      /** minimum gap between polls triggered through `nudge` (tests pass 0) */
      nudgeMinIntervalMs?: number;
    },
  ) {}

  private get log(): Logger {
    return this.deps.logger ?? consoleLogger;
  }
  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** One query (per 200 references) for every plausible order in the batch instead of one per event. */
  private async loadOrders(events: JettonTransferEvent[]): Promise<Map<string, Transaction>> {
    const refs = [
      ...new Set(events.map((e) => e.comment?.trim() ?? "").filter((r) => REFERENCE_SHAPE.test(r))),
    ];
    const orders = new Map<string, Transaction>();
    for (let i = 0; i < refs.length; i += LOOKUP_CHUNK) {
      const rows = await this.deps.db.transaction.findMany({
        where: { provider: "ton_grm", reference: { in: refs.slice(i, i + LOOKUP_CHUNK) } },
      });
      for (const row of rows) orders.set(row.reference, row);
    }
    return orders;
  }

  /** Applies fetched transfers to pending (or recently expired) TON transactions. Idempotent. */
  async processEvents(events: JettonTransferEvent[]): Promise<ProcessResult[]> {
    const orders = await this.loadOrders(events);
    const results: ProcessResult[] = [];
    for (const ev of events) {
      // One failing event (DB hiccup, unexpected data) must not block the events behind it on every future poll.
      try {
        results.push(await this.processOne(ev, orders));
      } catch (e) {
        this.log.error(
          { txHash: ev.txHash, err: (e as Error).message },
          "processing a transfer failed; continuing with the next one",
        );
        results.push({
          txHash: ev.txHash,
          reference: ev.comment?.trim() || null,
          status: "ignored",
          reason: "processing_error",
        });
      }
    }
    return results;
  }

  private async processOne(
    ev: JettonTransferEvent,
    orders: Map<string, Transaction>,
  ): Promise<ProcessResult> {
    const reference = ev.comment?.trim() ?? "";
    const ignored = (reason: string): ProcessResult => ({
      txHash: ev.txHash,
      reference: reference || null,
      status: "ignored",
      reason,
    });
    if (!reference) return ignored("no_comment");
    const tx = orders.get(reference);
    if (!tx) return ignored("unknown_reference");
    if (tx.status === "paid") {
      // the same transfer seen again is normal (every poll); a DIFFERENT transfer for a paid reference is an overpay
      if (tx.externalId !== ev.txHash)
        this.log.warn(
          { reference, txHash: ev.txHash },
          "extra transfer for an already paid reference",
        );
      return { txHash: ev.txHash, reference, status: "already_paid" };
    }
    if (tx.status !== "pending" && tx.status !== "expired") return ignored(`status_${tx.status}`);
    const m = matchEvent(ev, tx, this.deps.config);
    if (!m.ok) {
      // underpayments / wrong token stay pending (or expire); never granted
      this.log.warn({ reference, txHash: ev.txHash, reason: m.reason }, "transfer rejected");
      return ignored(m.reason);
    }
    if (m.late)
      this.log.warn(
        { reference, txHash: ev.txHash },
        "late payment honored within the grace window",
      );
    const res: SettleResult = await settlePayment(this.deps.db, {
      reference,
      externalId: ev.txHash,
      rawJson: { ...ev, amount: ev.amount.toString() },
      now: this.now(),
      allowExpired: true,
    });
    if (res.outcome === "paid" || res.outcome === "paid_no_boost") {
      // later events for the same order in this batch must see it as settled
      orders.set(reference, { ...tx, status: "paid", externalId: ev.txHash });
    }
    if (res.outcome === "paid")
      return { txHash: ev.txHash, reference, status: "paid", late: m.late };
    if (res.outcome === "already_paid")
      return { txHash: ev.txHash, reference, status: "already_paid" };
    if (res.outcome === "paid_no_boost") {
      // The money arrived but the chain can no longer be boosted: the order is `paid` (noted in rawJson)
      // and NO boost exists. Needs a manual refund (scripts/refund.ts is for Stars; refund GRM by hand).
      this.log.warn(
        { reference, txHash: ev.txHash, reason: res.reason },
        "GRM payment received but no boost granted: manual refund needed",
      );
      return { txHash: ev.txHash, reference, status: "paid_no_boost", reason: res.reason };
    }
    this.log.warn({ reference, txHash: ev.txHash, reason: res.reason }, "settle rejected");
    return ignored(res.reason);
  }

  /** One polling round: expire old pendings, fetch recent transfers, apply them. Concurrent calls share one run. */
  tick(): Promise<void> {
    if (this.running) return this.running; // overlap guard
    this.lastRunStartedAt = Date.now();
    this.running = this.runOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /**
   * For the confirm endpoint (a user just paid): poll now, unless a poll started moments ago, and never wait
   * longer than `waitMs` for it. Bounds the indexer calls a client can provoke, and leaves no timer behind.
   */
  async nudge(waitMs = 8_000): Promise<void> {
    const minGap = this.deps.nudgeMinIntervalMs ?? NUDGE_MIN_INTERVAL_MS;
    if (
      !this.running &&
      this.lastRunStartedAt !== null &&
      Date.now() - this.lastRunStartedAt < minGap
    )
      return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.tick(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, waitMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Never rejects: the interval calls `void tick()`, so a transient DB error here would otherwise surface as an
   * unhandled rejection and take the whole API process down.
   */
  private async runOnce(): Promise<void> {
    try {
      await this.poll();
    } catch (e) {
      this.log.error({ err: (e as Error).message }, "TON poll failed");
    }
  }

  private async poll(): Promise<void> {
    const now = this.now();
    await expirePending(this.deps.db, now);
    const [pending, grace] = await Promise.all([
      this.deps.db.transaction.findFirst({
        where: { provider: "ton_grm", status: "pending" },
        orderBy: { createdAt: "asc" },
      }),
      this.deps.db.transaction.findFirst({
        where: {
          provider: "ton_grm",
          status: "expired",
          expiresAt: { gt: new Date(now.getTime() - LATE_GRACE_MS) },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const oldest = [pending, grace]
      .filter((t): t is Transaction => t !== null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!oldest) return; // nothing to wait for: don't spend indexer quota
    if (!pending) {
      // only late-payment candidates remain: check now and then, not on every 10 s round
      const last = this.lastGraceScanAt;
      if (last !== null && now.getTime() - last < GRACE_POLL_INTERVAL_MS) return;
      this.lastGraceScanAt = now.getTime();
    }
    try {
      const events = await this.deps.indexer.getRecentJettonTransfers({
        account: this.deps.config.merchantAddress,
        jettonMaster: this.deps.config.jettonMaster,
        limit: 100,
        since: Math.floor((oldest.createdAt.getTime() - CLOCK_SKEW_MS) / 1000),
      });
      await this.processEvents(events);
    } catch (e) {
      this.log.error({ err: (e as Error).message }, "indexer poll failed");
    }
  }

  start(intervalMs = 10_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
