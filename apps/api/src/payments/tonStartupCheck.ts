import type { Config } from "../config";
import { rawAddress } from "./address";
import type { TonIndexer } from "./tonIndexer";

interface Logger {
  info(o: unknown, msg?: string): void;
  warn(o: unknown, msg?: string): void;
}

/** TON payments are on when a merchant address is configured (required in production). */
export const tonPaymentsEnabled = (config: Config): boolean => !!config.ton.merchantAddress;

/**
 * Startup self-check. Skipped in mock/dev mode and when TON payments are off.
 *  - addresses must parse with @ton/core (compared in raw form everywhere)
 *  - jetton decimals from TonAPI MUST equal GRM_DECIMALS, otherwise we refuse to start (prices would be wrong)
 *  - symbol mismatch only warns
 */
export async function runTonStartupCheck(deps: {
  config: Config;
  indexer: TonIndexer;
  logger: Logger;
}): Promise<"skipped" | "ok"> {
  const { config, indexer, logger } = deps;
  if (config.devMode || !tonPaymentsEnabled(config)) return "skipped";

  let master: string;
  let merchant: string;
  try {
    master = rawAddress(config.ton.jettonMaster);
    merchant = rawAddress(config.ton.merchantAddress);
  } catch (e) {
    throw new Error(`TON startup check: invalid address in env (${(e as Error).message})`);
  }
  const info = await indexer.getJettonInfo(config.ton.jettonMaster);
  if (info.decimals !== config.ton.decimals) {
    throw new Error(
      `TON startup check: GRM_DECIMALS=${config.ton.decimals} but the jetton ${master} reports decimals=${info.decimals}. Refusing to start.`,
    );
  }
  if (info.symbol !== config.ton.symbol) {
    logger.warn(
      { expected: config.ton.symbol, actual: info.symbol },
      "TON startup check: jetton symbol mismatch",
    );
  }
  logger.info(
    { master, merchant, decimals: info.decimals, symbol: info.symbol },
    "TON startup check passed",
  );
  return "ok";
}
