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
  it("treats empty values (KEY=) as unset, so .env.example loads as-is", async () => {
    const { readFileSync } = await import("node:fs");
    const example = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    const env: Record<string, string> = {};
    for (const line of example.split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1] as string] = m[2] as string;
    }
    const c = loadConfig(env as NodeJS.ProcessEnv); // must not throw
    expect(c.devMode).toBe(true);
    expect(c.serveWeb).toBe(false); // SERVE_WEB= -> default (off outside production)
    expect(c.trustProxy).toBe(false);
    expect(c.ton.priceUnits).toBe(100_000_000_000n);
    expect(
      loadConfig({ GRM_PRO_30D_PRICE: "", BOT_ENABLED: "" } as NodeJS.ProcessEnv).ton.priceHuman,
    ).toBe("100");
  });

  it("rejects a bad GRM price", () => {
    expect(() => loadConfig({ GRM_PRO_30D_PRICE: "abc" } as NodeJS.ProcessEnv)).toThrow(
      /GRM_PRO_30D_PRICE/,
    );
  });
});
