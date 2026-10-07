import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const PROD = {
  NODE_ENV: "production",
  BOT_TOKEN: "123456789:AAH_test_token_for_unit_tests_01234",
  BOT_USERNAME: "storychain_bot",
  TON_MERCHANT_ADDRESS: "UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG",
  TONAPI_KEY: "key",
  TONCONNECT_MANIFEST_URL: "https://app.example.com/tonconnect-manifest.json",
  WEBAPP_URL: "https://app.example.com",
  PUBLIC_BASE_URL: "https://api.example.com",
};
const prod = (extra: Record<string, string> = {}) =>
  loadConfig({ ...PROD, ...extra } as NodeJS.ProcessEnv);

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

  describe("hardening", () => {
    it("accepts a complete production env", () => {
      expect(prod().inProduction).toBe(true);
    });

    it("refuses placeholder or malformed bot tokens in production (their HMAC key would be public)", () => {
      for (const BOT_TOKEN of [
        "000000:dev-token-change-me", // .env.example
        "123456:test-bot-token",
        "not-a-token",
        "123456789:short",
        "123456789:AAH test token with spaces 0123456789",
      ]) {
        expect(() => prod({ BOT_TOKEN }), BOT_TOKEN).toThrow(/BOT_TOKEN/);
      }
    });

    it("requires https for the Mini App and the TonConnect manifest in production", () => {
      expect(() => prod({ WEBAPP_URL: "http://app.example.com" })).toThrow(/WEBAPP_URL/);
      expect(() => prod({ TONCONNECT_MANIFEST_URL: "http://app.example.com/m.json" })).toThrow(
        /TONCONNECT_MANIFEST_URL/,
      );
    });

    it("refuses DEV_MODE on a non-local address unless explicitly overridden", () => {
      const dev = (extra: Record<string, string>) =>
        loadConfig({ NODE_ENV: "development", DEV_MODE: "true", ...extra } as NodeJS.ProcessEnv);
      expect(() => dev({ PUBLIC_BASE_URL: "https://api.example.com" })).toThrow(/PUBLIC_BASE_URL/);
      expect(() => dev({ WEBAPP_URL: "https://xyz.trycloudflare.com" })).toThrow(/WEBAPP_URL/);
      expect(() => dev({ PUBLIC_BASE_URL: "http://localhost.evil.com" })).toThrow(/DEV_MODE/);
      // a host that merely starts with "localhost" or contains it as a label is not local
      expect(() => dev({ PUBLIC_BASE_URL: "http://127.0.0.1.nip.io:3000" })).toThrow(/DEV_MODE/);
      // the real local spellings keep working
      for (const url of [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
        "http://app.localhost:3000",
      ]) {
        expect(() => dev({ PUBLIC_BASE_URL: url, WEBAPP_URL: url }), url).not.toThrow();
      }
      // explicit opt-in, and the test environment (fake hosts) is exempt
      expect(() =>
        dev({ PUBLIC_BASE_URL: "https://api.example.com", ALLOW_REMOTE_DEV_MODE: "true" }),
      ).not.toThrow();
      expect(() =>
        loadConfig({
          NODE_ENV: "test",
          DEV_MODE: "true",
          PUBLIC_BASE_URL: "http://test.local",
        } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });

    it("webhook mode needs a secret and a URL whenever the bot is enabled (any environment)", () => {
      const hook = (extra: Record<string, string>) =>
        loadConfig({ BOT_ENABLED: "true", BOT_MODE: "webhook", ...extra } as NodeJS.ProcessEnv);
      expect(() => hook({ WEBHOOK_URL: "https://api.example.com/hook" })).toThrow(/WEBHOOK_SECRET/);
      expect(() => hook({ WEBHOOK_SECRET: "s3cret" })).toThrow(/WEBHOOK_URL/);
      expect(() =>
        hook({ WEBHOOK_URL: "https://api.example.com/hook", WEBHOOK_SECRET: "s3cret" }),
      ).not.toThrow();
      // bot off: nothing is exposed, nothing is required
      expect(() =>
        loadConfig({ BOT_ENABLED: "false", BOT_MODE: "webhook" } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });
  });
});
