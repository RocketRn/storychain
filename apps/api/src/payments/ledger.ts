import { customAlphabet } from "nanoid";
import type { Transaction } from "@prisma/client";
import { applyBoost, revokeBoost } from "../boosts/core";
import { withRetry, type Db } from "../db";

const newReference = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  16,
);

export type Provider = "stars" | "ton_grm";

export async function createPending(
  db: Db,
  args: {
    userId: string;
    provider: Provider;
    planId: string;
    /** the chain this purchase boosts */
    chainId: string;
    amount: string;
    currency: string;
    expiresAt: Date;
  },
): Promise<Transaction> {
  return db.transaction.create({
    data: { ...args, status: "pending", reference: newReference() },
  });
}

export type SettleResult =
  | { outcome: "paid"; tx: Transaction; chainId: string; boostedUntil: Date }
  | { outcome: "already_paid"; tx: Transaction }
  /** money received, nothing granted (chain hidden/deleted meanwhile): needs a manual refund */
  | { outcome: "paid_no_boost"; tx: Transaction; reason: "chain_not_boostable" | "unknown_plan" }
  | { outcome: "rejected"; reason: "not_found" | "bad_state" | "replay" };

/**
 * Idempotently marks an order paid and applies its boost, all in ONE DB transaction (see `applyBoost`).
 * `externalId` (Telegram charge id / TON event id) is unique: a replay on another order is rejected.
 */
export async function settlePayment(
  db: Db,
  args: {
    reference: string;
    externalId: string;
    rawJson?: unknown;
    now?: Date;
    allowExpired?: boolean;
  },
): Promise<SettleResult> {
  return withRetry(() =>
    db.$transaction(async (tx): Promise<SettleResult> => {
      const row = await tx.transaction.findUnique({ where: { reference: args.reference } });
      if (!row) return { outcome: "rejected", reason: "not_found" };
      const res = await applyBoost(tx, {
        transactionId: row.id,
        externalId: args.externalId,
        rawJson: args.rawJson,
        ...(args.now ? { now: args.now } : {}),
        ...(args.allowExpired ? { allowExpired: args.allowExpired } : {}),
      });
      const fresh = () => tx.transaction.findUniqueOrThrow({ where: { id: row.id } });
      switch (res.outcome) {
        case "applied":
          return {
            outcome: "paid",
            tx: await fresh(),
            chainId: res.boost.chainId,
            boostedUntil: res.boostedUntil,
          };
        case "already_applied":
          return { outcome: "already_paid", tx: await fresh() };
        case "paid_no_boost":
          return res.reason === "already_settled"
            ? { outcome: "already_paid", tx: await fresh() }
            : { outcome: "paid_no_boost", tx: await fresh(), reason: res.reason };
        case "rejected":
          return res;
      }
    }),
  );
}

export type RefundResult =
  | { outcome: "refunded"; boostedUntil: Date | null }
  | { outcome: "noop"; reason: "not_found" | "not_paid" };

/** Marks a paid order refunded and takes back exactly its boost. Idempotent. */
export async function refundPayment(
  db: Db,
  by: { externalId: string } | { reference: string },
): Promise<RefundResult> {
  return withRetry(() =>
    db.$transaction(async (tx): Promise<RefundResult> => {
      const row = await tx.transaction.findUnique({ where: by });
      if (!row) return { outcome: "noop", reason: "not_found" };
      const r = await revokeBoost(tx, { transactionId: row.id });
      if (r.outcome === "noop") return r;
      return { outcome: "refunded", boostedUntil: r.outcome === "revoked" ? r.boostedUntil : null };
    }),
  );
}

/** Pending transactions past `expiresAt` become `expired` (status only; late TON payments are still honored in the grace window). */
export async function expirePending(db: Db, now = new Date()): Promise<number> {
  const r = await db.transaction.updateMany({
    where: { status: "pending", expiresAt: { lt: now } },
    data: { status: "expired" },
  });
  return r.count;
}
