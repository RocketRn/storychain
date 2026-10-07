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
  it("converts GRM boost prices to bigint units (no floats)", () => {
    const c = loadConfig({
      GRM_BOOST_24H_PRICE: "0.5",
      GRM_BOOST_7D_PRICE: "12.000000001",
      GRM_DECIMALS: "9",
    } as NodeJS.ProcessEnv);
    expect(c.boost.grmUnits.boost_24h).toBe(500000000n);
    expect(c.boost.grmUnits.boost_7d).toBe(12000000001n);
  });
  it("has placeholder defaults (50 / 250 GRM, 100 / 500 Stars, 30 day horizon)", () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.boost.grmUnits).toEqual({ boost_24h: 50_000_000_000n, boost_7d: 250_000_000_000n });
    expect(c.boost.starsPrice).toEqual({ boost_24h: 100, boost_7d: 500 });
    expect(c.boost.maxHorizonMs).toBe(30 * 86_400_000);
    expect(c.rateLimits).toMatchObject({ postsPerMin: 20, chainsPerHour: 10, reportsPerHour: 10 });
  });
  it("prices and limits are configurable", () => {
    const c = loadConfig({
      STARS_BOOST_24H_PRICE: "7",
      STARS_BOOST_7D_PRICE: "70",
      BOOST_MAX_HORIZON_DAYS: "10",
      RATE_LIMIT_POSTS_PER_MIN: "3",
    } as NodeJS.ProcessEnv);
    expect(c.boost.starsPrice).toEqual({ boost_24h: 7, boost_7d: 70 });
    expect(c.boost.maxHorizonMs).toBe(10 * 86_400_000);
    expect(c.rateLimits.postsPerMin).toBe(3);
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
    expect(c.boost.grmUnits.boost_24h).toBe(50_000_000_000n);
    expect(
      loadConfig({ GRM_BOOST_7D_PRICE: "", BOT_ENABLED: "" } as NodeJS.ProcessEnv).boost.grmHuman
        .boost_7d,
    ).toBe("250");
  });

  it("rejects bad or zero GRM prices", () => {
    expect(() => loadConfig({ GRM_BOOST_24H_PRICE: "abc" } as NodeJS.ProcessEnv)).toThrow(
      /GRM_BOOST_24H_PRICE/,
    );
    expect(() => loadConfig({ GRM_BOOST_7D_PRICE: "0" } as NodeJS.ProcessEnv)).toThrow(
      /GRM_BOOST_7D_PRICE/,
    );
    expect(() => loadConfig({ GRM_BOOST_7D_PRICE: "1.0000000001" } as NodeJS.ProcessEnv)).toThrow(
      /GRM_BOOST_7D_PRICE/,
    );
    expect(() => loadConfig({ BOOST_MAX_HORIZON_DAYS: "0" } as NodeJS.ProcessEnv)).toThrow();
  });
});
