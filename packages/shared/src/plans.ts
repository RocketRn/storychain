export type PaymentProvider = "stars" | "ton_grm";

/**
 * Marathon Boost plans. Star prices here are DEFAULTS (placeholders the owner must set);
 * the API can override them with STARS_BOOST_24H_PRICE / STARS_BOOST_7D_PRICE.
 * GRM prices come from env (GRM_BOOST_*_PRICE) and are converted with `toUnits`, never floats.
 */
export const BOOST_PLANS = {
  boost_24h: { id: "boost_24h", durationMs: 24 * 3600 * 1000, starsPrice: 100 },
  boost_7d: { id: "boost_7d", durationMs: 7 * 24 * 3600 * 1000, starsPrice: 500 },
} as const;

export type BoostPlanId = keyof typeof BOOST_PLANS;
export const BOOST_PLAN_IDS = Object.keys(BOOST_PLANS) as BoostPlanId[];

export function isBoostPlanId(id: string): id is BoostPlanId {
  return Object.prototype.hasOwnProperty.call(BOOST_PLANS, id);
}

export type TonNetwork = "mainnet" | "testnet";
/** TonConnect `CHAIN` ids: what a connected wallet reports as its network, and what a request may demand. */
export const TON_CHAIN_ID: Record<TonNetwork, string> = { mainnet: "-239", testnet: "-3" };

export type Platform = "ios" | "android" | "tdesktop" | "macos" | "weba" | "web" | "unknown";

/**
 * Telegram requires Stars for digital goods in app-store builds (ios/android).
 * Owner must verify against current Telegram rules (see DECISIONS.md).
 */
export function allowedMethods(
  platform: string | undefined,
  allPlatforms: boolean,
): PaymentProvider[] {
  if (allPlatforms) return ["stars", "ton_grm"];
  return platform === "ios" || platform === "android" ? ["stars"] : ["stars", "ton_grm"];
}
