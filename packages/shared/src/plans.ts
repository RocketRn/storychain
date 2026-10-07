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

export type Platform = "ios" | "android" | "tdesktop" | "macos" | "weba" | "web" | "unknown";

/**
 * Telegram requires Stars for digital goods in app-store builds (ios/android).
 * Owner must verify against current Telegram rules (see DECISIONS.md).
 */
export function allowedMethods(platform: string | undefined, allPlatforms: boolean): PaymentProvider[] {
  if (allPlatforms) return ["stars", "ton_grm"];
  return platform === "ios" || platform === "android" ? ["stars"] : ["stars", "ton_grm"];
}
