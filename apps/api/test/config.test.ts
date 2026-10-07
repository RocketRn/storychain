import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("config", () => {
  it("refuses DEV_MODE=true in production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", DEV_MODE: "true" } as NodeJS.ProcessEnv),
    ).toThrow(/DEV_MODE/);
  });
  it("fails fast on missing production env", () => {
    expect(() => loadConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      /TON_MERCHANT_ADDRESS/,
    );
  });
  it("converts GRM price to bigint units", () => {
    const c = loadConfig({ GRM_PRO_30D_PRICE: "0.5", GRM_DECIMALS: "9" } as NodeJS.ProcessEnv);
    expect(c.ton.priceUnits).toBe(500000000n);
  });
  it("rejects a bad GRM price", () => {
    expect(() => loadConfig({ GRM_PRO_30D_PRICE: "abc" } as NodeJS.ProcessEnv)).toThrow(
      /GRM_PRO_30D_PRICE/,
    );
  });
});
