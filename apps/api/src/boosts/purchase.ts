import type { Chain } from "@prisma/client";
import { BOOST_PLANS, isBoostPlanId, type BoostPlanId } from "@storychain/shared";
import type { Config } from "../config";
import type { Db } from "../db";
import { errors } from "../errors";
import { assertBoostHorizon } from "./core";

export interface BoostPurchase {
  chain: Chain;
  planId: BoostPlanId;
  durationMs: number;
}

/** Plan validation shared by the Stars and TON entry points. */
export function parsePlan(planId: string): BoostPlanId {
  if (!isBoostPlanId(planId)) throw errors.invalidBoostPlan();
  return planId;
}

/**
 * Everything that must hold to START a boost purchase:
 * known plan, chain exists and is visible, the buyer is the creator, and the horizon guard passes.
 */
export async function validateBoostPurchase(
  db: Db,
  config: Pick<Config, "boost">,
  args: { chainId: string; planId: string; userId: string; now: Date },
): Promise<BoostPurchase> {
  const planId = parsePlan(args.planId);
  const chain = await db.chain.findUnique({ where: { id: args.chainId } });
  if (!chain) throw errors.chainNotFound();
  if (chain.isHidden) throw errors.chainNotBoostable();
  if (chain.creatorId !== args.userId)
    throw errors.forbidden("Only the creator of a marathon can boost it");
  assertBoostHorizon(chain, planId, args.now, config.boost.maxHorizonMs);
  return { chain, planId, durationMs: BOOST_PLANS[planId].durationMs };
}
