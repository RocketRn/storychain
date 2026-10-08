import type { Chain, ChainBoost, Prisma } from "@prisma/client";
import { BOOST_PLANS, isBoostPlanId, type BoostPlanId } from "@storychain/shared";
import { errors } from "../errors";

/** The ONLY definition of "boosted": `boostedUntil > now`. The `isBoosted` column is just a cache. */
export function isBoostActive(chain: Pick<Chain, "boostedUntil">, now: Date): boolean {
  return chain.boostedUntil !== null && chain.boostedUntil.getTime() > now.getTime();
}

/** Stacking: a new boost starts when the current one ends (or now, if none is running). */
export function boostWindow(
  now: Date,
  currentUntil: Date | null,
  planId: BoostPlanId,
): { start: Date; end: Date } {
  const start = currentUntil && currentUntil.getTime() > now.getTime() ? currentUntil : now;
  return { start, end: new Date(start.getTime() + BOOST_PLANS[planId].durationMs) };
}

/** Rejects a purchase that would push the boost further than `maxHorizonMs` into the future. */
export function assertBoostHorizon(
  chain: Pick<Chain, "boostedUntil">,
  planId: BoostPlanId,
  now: Date,
  maxHorizonMs: number,
): void {
  const { end } = boostWindow(now, chain.boostedUntil, planId);
  if (end.getTime() - now.getTime() > maxHorizonMs) throw errors.boostHorizon();
}

export type ApplyBoostResult =
  | { outcome: "applied"; boost: ChainBoost; boostedUntil: Date }
  | { outcome: "already_applied"; boost: ChainBoost }
  /** money was received but nothing could be granted: needs a manual refund (see DECISIONS.md) */
  | { outcome: "paid_no_boost"; reason: "chain_not_boostable" | "unknown_plan" | "already_settled" }
  | { outcome: "rejected"; reason: "not_found" | "bad_state" | "replay" };

const MAX_STACK_RETRIES = 5;

function withNote(rawJson: string | null, extra: Record<string, unknown>): string {
  let base: Record<string, unknown> = {};
  if (rawJson) {
    try {
      const parsed: unknown = JSON.parse(rawJson);
      base =
        typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>)
          : { raw: parsed };
    } catch {
      base = { raw: rawJson };
    }
  }
  return JSON.stringify({ ...base, ...extra });
}

/**
 * Marks the transaction paid and grants its boost. MUST run inside the caller's DB transaction.
 * Idempotent: a ChainBoost row exists for `txId = transaction.id` at most once, so redelivered
 * payments / replayed on-chain transfers can never extend a chain twice.
 */
export async function applyBoost(
  tx: Prisma.TransactionClient,
  args: {
    transactionId: string;
    /** Telegram charge id / TON event id: unique, replays are rejected */
    externalId?: string;
    rawJson?: unknown;
    now?: Date;
    /** honor a payment that arrives after the order expired (the user did pay) */
    allowExpired?: boolean;
  },
): Promise<ApplyBoostResult> {
  const now = args.now ?? new Date();
  const row = await tx.transaction.findUnique({ where: { id: args.transactionId } });
  if (!row) return { outcome: "rejected", reason: "not_found" };

  const existing = await tx.chainBoost.findUnique({ where: { txId: row.id } });
  if (existing) return { outcome: "already_applied", boost: existing };

  if (row.status === "paid") return { outcome: "paid_no_boost", reason: "already_settled" };
  if (row.status === "refunded" || row.status === "failed")
    return { outcome: "rejected", reason: "bad_state" };
  if (row.status === "expired" && !args.allowExpired)
    return { outcome: "rejected", reason: "bad_state" };

  if (args.externalId) {
    const used = await tx.transaction.findUnique({ where: { externalId: args.externalId } });
    if (used && used.id !== row.id) return { outcome: "rejected", reason: "replay" };
  }

  // Claim: only one concurrent caller can move pending|expired -> paid
  const claim = await tx.transaction.updateMany({
    where: { id: row.id, status: { in: ["pending", "expired"] } },
    data: {
      status: "paid",
      paidAt: now,
      ...(args.externalId ? { externalId: args.externalId } : {}),
      rawJson: args.rawJson === undefined ? row.rawJson : JSON.stringify(args.rawJson),
    },
  });
  if (claim.count === 0) {
    const won = await tx.chainBoost.findUnique({ where: { txId: row.id } });
    return won
      ? { outcome: "already_applied", boost: won }
      : { outcome: "paid_no_boost", reason: "already_settled" };
  }

  const noBoost = async (
    reason: "chain_not_boostable" | "unknown_plan",
  ): Promise<ApplyBoostResult> => {
    console.warn(
      `[boosts] payment ${row.reference} received but no boost granted (${reason}): manual refund needed`,
    );
    const fresh = await tx.transaction.findUniqueOrThrow({ where: { id: row.id } });
    await tx.transaction.update({
      where: { id: row.id },
      data: { rawJson: withNote(fresh.rawJson, { note: reason }) },
    });
    return { outcome: "paid_no_boost", reason };
  };

  if (!isBoostPlanId(row.planId)) return noBoost("unknown_plan"); // e.g. a late payment of a legacy order
  const planId = row.planId;

  for (let attempt = 0; attempt < MAX_STACK_RETRIES; attempt++) {
    const chain = row.chainId ? await tx.chain.findUnique({ where: { id: row.chainId } }) : null;
    if (!chain || chain.isHidden) return noBoost("chain_not_boostable");
    const { start, end } = boostWindow(now, chain.boostedUntil, planId);
    // optimistic concurrency: only write if nobody changed boostedUntil since we read it
    const upd = await tx.chain.updateMany({
      where: { id: chain.id, boostedUntil: chain.boostedUntil },
      data: { boostedUntil: end, isBoosted: true },
    });
    if (upd.count === 0) continue;
    const boost = await tx.chainBoost.create({
      data: {
        chainId: chain.id,
        userId: row.userId,
        planId,
        startsAt: start,
        endsAt: end,
        txId: row.id,
      },
    });
    return { outcome: "applied", boost, boostedUntil: end };
  }
  throw new Error(`applyBoost: could not stack boost for transaction ${row.id} (contention)`);
}

export type RevokeBoostResult =
  | { outcome: "revoked"; boostedUntil: Date | null }
  | { outcome: "revoked_no_boost" }
  | { outcome: "noop"; reason: "not_found" | "not_paid" };

/**
 * Refund: marks the paid transaction refunded and takes exactly this boost's duration off the chain.
 * Idempotent (only a `paid` transaction can be revoked, once). MUST run inside a DB transaction.
 */
export async function revokeBoost(
  tx: Prisma.TransactionClient,
  args: { transactionId: string; now?: Date },
): Promise<RevokeBoostResult> {
  const now = args.now ?? new Date();
  const row = await tx.transaction.findUnique({ where: { id: args.transactionId } });
  if (!row) return { outcome: "noop", reason: "not_found" };
  const claim = await tx.transaction.updateMany({
    where: { id: row.id, status: "paid" },
    data: { status: "refunded" },
  });
  if (claim.count === 0) return { outcome: "noop", reason: "not_paid" };

  const boost = await tx.chainBoost.findUnique({ where: { txId: row.id } });
  if (!boost) return { outcome: "revoked_no_boost" }; // e.g. paid while the chain was hidden: nothing to take back

  // Take exactly this boost's duration off the chain's end, never below "now" (null = no boost left).
  // Compare-and-set like applyBoost: a plain read-then-write would erase a boost committed between the two
  // (READ COMMITTED on PostgreSQL), i.e. a purchase racing a refund would be paid and silently lost.
  let boostedUntil: Date | null = null;
  for (let attempt = 0; ; attempt++) {
    const chain = await tx.chain.findUnique({ where: { id: boost.chainId } });
    boostedUntil = null;
    if (!chain?.boostedUntil) break;
    const remaining = new Date(
      chain.boostedUntil.getTime() - (boost.endsAt.getTime() - boost.startsAt.getTime()),
    );
    boostedUntil = remaining.getTime() > now.getTime() ? remaining : null;
    const upd = await tx.chain.updateMany({
      where: { id: chain.id, boostedUntil: chain.boostedUntil },
      data: { boostedUntil, isBoosted: boostedUntil !== null },
    });
    if (upd.count === 1) break;
    if (attempt + 1 >= MAX_STACK_RETRIES)
      throw new Error(`revokeBoost: could not update chain ${chain.id} (contention)`);
  }
  await tx.chainBoost.delete({ where: { id: boost.id } });
  return { outcome: "revoked", boostedUntil };
}
