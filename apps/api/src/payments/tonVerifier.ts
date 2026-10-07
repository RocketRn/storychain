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

  constructor(
    private readonly deps: {
      db: Db;
      indexer: TonIndexer;
      config: VerifierConfig;
      now?: () => Date;
      logger?: Logger;
    },
  ) {}

  private get log(): Logger {
    return this.deps.logger ?? consoleLogger;
  }
  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Applies fetched transfers to pending (or recently expired) TON transactions. Idempotent. */
  async processEvents(events: JettonTransferEvent[]): Promise<ProcessResult[]> {
    const results: ProcessResult[] = [];
    for (const ev of events) {
      const reference = ev.comment?.trim() ?? "";
      const ignore = (reason: string, ref: string | null = reference || null): ProcessResult => {
        const r: ProcessResult = { txHash: ev.txHash, reference: ref, status: "ignored", reason };
        results.push(r);
        return r;
      };
      if (!reference) {
        ignore("no_comment");
        continue;
      }
      const tx = await this.deps.db.transaction.findUnique({ where: { reference } });
      if (!tx || tx.provider !== "ton_grm") {
        ignore("unknown_reference");
        continue;
      }
      if (tx.status === "paid") {
        // the same transfer seen again is normal (every poll); a DIFFERENT transfer for a paid reference is an overpay
        if (tx.externalId !== ev.txHash)
          this.log.warn(
            { reference, txHash: ev.txHash },
            "extra transfer for an already paid reference",
          );
        results.push({ txHash: ev.txHash, reference, status: "already_paid" });
        continue;
      }
      if (tx.status !== "pending" && tx.status !== "expired") {
        ignore(`status_${tx.status}`);
        continue;
      }
      const m = matchEvent(ev, tx, this.deps.config);
      if (!m.ok) {
        // underpayments / wrong token stay pending (or expire); never granted
        this.log.warn({ reference, txHash: ev.txHash, reason: m.reason }, "transfer rejected");
        ignore(m.reason);
        continue;
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
      if (res.outcome === "paid")
        results.push({ txHash: ev.txHash, reference, status: "paid", late: m.late });
      else if (res.outcome === "already_paid")
        results.push({ txHash: ev.txHash, reference, status: "already_paid" });
      else if (res.outcome === "paid_no_boost") {
        // The money arrived but the chain can no longer be boosted: the order is `paid` (noted in rawJson)
        // and NO boost exists. Needs a manual refund (scripts/refund.ts is for Stars; refund GRM by hand).
        this.log.warn(
          { reference, txHash: ev.txHash, reason: res.reason },
          "GRM payment received but no boost granted: manual refund needed",
        );
        results.push({ txHash: ev.txHash, reference, status: "paid_no_boost", reason: res.reason });
      } else {
        this.log.warn({ reference, txHash: ev.txHash, reason: res.reason }, "settle rejected");
        ignore(res.reason);
      }
    }
    return results;
  }

  /** One polling round: expire old pendings, fetch recent transfers, apply them. Concurrent calls share one run. */
  tick(): Promise<void> {
    if (this.running) return this.running; // overlap guard
    this.running = this.runOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runOnce(): Promise<void> {
    const now = this.now();
    await expirePending(this.deps.db, now);
    const open = await this.deps.db.transaction.findMany({
      where: {
        provider: "ton_grm",
        OR: [
          { status: "pending" },
          { status: "expired", expiresAt: { gt: new Date(now.getTime() - LATE_GRACE_MS) } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 1,
    });
    const oldest = open[0];
    if (!oldest) return; // nothing to wait for: don't spend indexer quota
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
