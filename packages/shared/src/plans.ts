import { toUnits } from "./units";

export type PaymentProvider = "stars" | "ton_grm";

export interface PlanDef {
  id: string;
  durationDays: number;
  starsPrice: number; // integer Stars (XTR)
}

/** Plans are data. GRM price comes from env at runtime (see `grmPriceUnits`). */
export const PLANS: Record<string, PlanDef> = {
  pro_30d: { id: "pro_30d", durationDays: 30, starsPrice: 150 },
};

export const FREE_DAILY_LIMIT = 3;

export function grmPriceUnits(humanPrice: string, decimals: number): bigint {
  return toUnits(humanPrice, decimals);
}
