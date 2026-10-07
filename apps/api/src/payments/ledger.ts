import { customAlphabet } from "nanoid";
import { PLANS } from "@storychain/shared";
import type { Transaction } from "@prisma/client";
import { withRetry, type Db } from "../db";
import { extendProUntil, shrinkProUntil } from "../services/pro";

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
  | { outcome: "paid"; tx: Transaction; proUntil: Date }
  | { outcome: "already_paid"; tx: Transaction }
  | { outcome: "rejected"; reason: "not_found" | "bad_state" | "replay" };

/**
 * Idempotently marks a transaction paid and grants PRO, all in ONE DB transaction:
 * claim (conditional update pending|expired -> paid) + extend proUntil + Subscription row.
 * `externalId` (telegram charge id / TON tx hash) is unique: a replay on another reference is rejected.
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
  const now = args.now ?? new Date();
  return withRetry(() =>
    db.$transaction(async (tx): Promise<SettleResult> => {
      const row = await tx.transaction.findUnique({ where: { reference: args.reference } });
      if (!row) return { outcome: "rejected", reason: "not_found" };
      if (row.status === "paid") return { outcome: "already_paid", tx: row };
      if (row.status === "refunded" || row.status === "failed")
        return { outcome: "rejected", reason: "bad_state" };
      if (row.status === "expired" && !args.allowExpired)
        return { outcome: "rejected", reason: "bad_state" };

      const used = await tx.transaction.findUnique({ where: { externalId: args.externalId } });
      if (used && used.id !== row.id) return { outcome: "rejected", reason: "replay" };

      const claim = await tx.transaction.updateMany({
        where: { id: row.id, status: { in: ["pending", "expired"] } },
        data: {
          status: "paid",
          externalId: args.externalId,
          paidAt: now,
          rawJson: args.rawJson === undefined ? null : JSON.stringify(args.rawJson),
        },
      });
      if (claim.count === 0) {
        const fresh = await tx.transaction.findUniqueOrThrow({ where: { id: row.id } });
        return { outcome: "already_paid", tx: fresh };
      }

      const plan = PLANS[row.planId];
      if (!plan) throw new Error(`Unknown plan on transaction ${row.id}: ${row.planId}`);
      const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId } });
      const proUntil = extendProUntil(now, user.proUntil, plan.durationDays);
      const startsAt = user.proUntil && user.proUntil > now ? user.proUntil : now;
      await tx.user.update({ where: { id: user.id }, data: { proUntil } });
      await tx.subscription.create({
        data: { userId: user.id, planId: row.planId, startsAt, endsAt: proUntil, txId: row.id },
      });
      return {
        outcome: "paid",
        tx: { ...row, status: "paid", externalId: args.externalId, paidAt: now },
        proUntil,
      };
    }),
  );
}

export type RefundResult =
  | { outcome: "refunded"; proUntil: Date | null }
  | { outcome: "noop"; reason: "not_found" | "not_paid" };

/** Marks a paid transaction refunded and revokes the PRO period it granted. Idempotent. */
export async function refundPayment(
  db: Db,
  by: { externalId: string } | { reference: string },
): Promise<RefundResult> {
  return withRetry(() =>
    db.$transaction(async (tx): Promise<RefundResult> => {
      const row = await tx.transaction.findUnique({ where: by });
      if (!row) return { outcome: "noop", reason: "not_found" };
      const claim = await tx.transaction.updateMany({
        where: { id: row.id, status: "paid" },
        data: { status: "refunded" },
      });
      if (claim.count === 0) return { outcome: "noop", reason: "not_paid" };
      const plan = PLANS[row.planId];
      const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId } });
      const proUntil = plan ? shrinkProUntil(user.proUntil, plan.durationDays) : user.proUntil;
      await tx.user.update({ where: { id: user.id }, data: { proUntil } });
      await tx.subscription.deleteMany({ where: { txId: row.id } });
      return { outcome: "refunded", proUntil };
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
