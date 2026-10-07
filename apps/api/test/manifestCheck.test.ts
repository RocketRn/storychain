import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assertManifestMatches } from "../src/manifestCheck";
import { createCtx } from "./helpers";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** a dist folder with an index.html and (optionally) a TonConnect manifest */
function dist(manifest?: string): string {
  const d = mkdtempSync(join(tmpdir(), "storychain-manifest-"));
  dirs.push(d);
  writeFileSync(join(d, "index.html"), "<!doctype html><title>x</title>");
  if (manifest !== undefined) writeFileSync(join(d, "tonconnect-manifest.json"), manifest);
  return d;
}
const manifest = (url: unknown) => JSON.stringify({ url, name: "StoryChain", iconUrl: "x" });

describe("assertManifestMatches", () => {
  it("accepts the same origin however the URL is spelled", () => {
    for (const [m, env] of [
      ["https://app.example.com", "https://app.example.com"],
      ["https://app.example.com", "https://app.example.com/"],
      ["https://app.example.com/", "https://app.example.com/app/index.html"],
      ["https://APP.example.com", "https://app.example.com"],
    ] as const)
      expect(() => assertManifestMatches(dist(manifest(m)), env), `${m} vs ${env}`).not.toThrow();
  });

  it("refuses the localhost manifest a build without WEBAPP_URL produces, naming both values and the fix", () => {
    const run = () =>
      assertManifestMatches(dist(manifest("http://localhost:5173")), "https://app.example.com");
    expect(run).toThrow(/localhost:5173/);
    expect(run).toThrow(/https:\/\/app\.example\.com/);
    expect(run).toThrow(/pnpm build/);
  });

  it("refuses a different scheme, host or port", () => {
    for (const m of [
      "http://app.example.com",
      "https://app.example.org",
      "https://app.example.com:8443",
      "https://evil.example.com",
    ])
      expect(
        () => assertManifestMatches(dist(manifest(m)), "https://app.example.com"),
        m,
      ).toThrow();
  });

  it("refuses a manifest that is not usable at all", () => {
    expect(() => assertManifestMatches(dist("{nope"), "https://app.example.com")).toThrow(
      /valid JSON/,
    );
    expect(() => assertManifestMatches(dist("{}"), "https://app.example.com")).toThrow();
    expect(() => assertManifestMatches(dist(manifest(42)), "https://app.example.com")).toThrow();
    expect(() =>
      assertManifestMatches(dist(manifest("not a url")), "https://app.example.com"),
    ).toThrow();
  });

  it("has nothing to check when the manifest is hosted elsewhere (no file in dist)", () => {
    expect(() => assertManifestMatches(dist(), "https://app.example.com")).not.toThrow();
  });
});

describe("startup with a real merchant (TON payments on, not mock mode)", () => {
  const MERCHANT = "UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG";
  const env = (d: string, extra: Record<string, string> = {}) => ({
    SERVE_WEB: "true",
    WEB_DIST_DIR: d,
    DEV_MODE: "false",
    TON_MERCHANT_ADDRESS: MERCHANT,
    WEBAPP_URL: "https://app.example.com",
    ...extra,
  });

  it("refuses to start when the served manifest belongs to another origin", async () => {
    await expect(createCtx(env(dist(manifest("http://localhost:5173"))))).rejects.toThrow(
      /TonConnect manifest/,
    );
  });

  it("starts when it matches", async () => {
    const ctx = await createCtx(env(dist(manifest("https://app.example.com"))));
    expect((await ctx.app.inject({ url: "/api/health" })).statusCode).toBe(200);
    await ctx.app.close();
    await ctx.db.$disconnect();
  });

  it("does not interfere with mock mode or with deployments without TON payments", async () => {
    const stale = dist(manifest("http://localhost:5173"));
    const cases: Array<Record<string, string>> = [
      { DEV_MODE: "true" },
      { TON_MERCHANT_ADDRESS: "" },
    ];
    for (const extra of cases) {
      const ctx = await createCtx(env(stale, extra));
      await ctx.app.close();
      await ctx.db.$disconnect();
    }
  });
});
