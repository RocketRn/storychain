import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInitData } from "../src/auth/initData";
import {
  authHeader,
  BOT_TOKEN,
  createChain,
  createCtx,
  newTgId,
  postImage,
  solidImage,
  type TestCtx,
} from "./helpers";

describe("single-origin mode (API serves the built web app)", () => {
  let ctx: TestCtx;
  let dist: string;
  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "storychain-dist-"));
    mkdirSync(join(dist, "assets"));
    mkdirSync(join(dist, "fonts"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>SPA</title><div id=root></div>");
    writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log(1)");
    writeFileSync(join(dist, "fonts", "x.woff2"), "font");
    writeFileSync(
      join(dist, "tonconnect-manifest.json"),
      '{"url":"https://x","name":"S","iconUrl":"https://x/i.png"}',
    );
    ctx = await createCtx({ SERVE_WEB: "true", WEB_DIST_DIR: dist });
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.$disconnect();
  });

  it("serves index.html at / and for client-side routes (SPA fallback), uncached", async () => {
    for (const url of ["/", "/chain/abc12345", "/pro", "/chain/abc12345/join"]) {
      const res = await ctx.app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toContain("<title>SPA</title>");
      expect(res.headers["cache-control"]).toBe("no-cache");
    }
  });

  it("serves hashed assets as immutable and fonts with a day of caching", async () => {
    const a = await ctx.app.inject({ url: "/assets/index-abc123.js" });
    expect(a.statusCode).toBe(200);
    expect(a.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const f = await ctx.app.inject({ url: "/fonts/x.woff2" });
    expect(f.headers["cache-control"]).toBe("public, max-age=86400");
  });

  it("keeps API routes JSON: unknown /api paths are a JSON 404, not the SPA", async () => {
    const res = await ctx.app.inject({ url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    expect((await ctx.app.inject({ url: "/api/health" })).json()).toEqual({ ok: true });
    expect((await ctx.app.inject({ url: "/uploads/missing.jpg" })).statusCode).toBe(404);
  });

  it("serves uploads from the same origin", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    const post = (await postImage(ctx, a, chain, await solidImage())).json().post;
    expect(post.imageUrl).toMatch(/^http:\/\/test\.local\/posts\//); // MemoryStorage URL in tests
  });

  it("sets a CSP that allows Telegram's script and embedding in Telegram Web, and no X-Frame-Options", async () => {
    const res = await ctx.app.inject({ url: "/" });
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self' https://telegram.org");
    expect(csp).toContain("frame-ancestors 'self' https://web.telegram.org https://*.telegram.org");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers["x-frame-options"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("lets wallets fetch the TonConnect manifest cross-origin", async () => {
    const res = await ctx.app.inject({ url: "/tonconnect-manifest.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("does not rate limit static assets, only the API", async () => {
    for (let i = 0; i < 300; i++) {
      const res = await ctx.app.inject({ url: "/assets/index-abc123.js" });
      if (res.statusCode !== 200) throw new Error(`asset request ${i} got ${res.statusCode}`);
    }
  });

  it("refuses to start when the web build is missing", async () => {
    await expect(
      createCtx({ SERVE_WEB: "true", WEB_DIST_DIR: join(dist, "nope") }),
    ).rejects.toThrow(/pnpm build/);
  });
});

describe("API-only mode", () => {
  it("does not serve the SPA", async () => {
    const ctx = await createCtx();
    const res = await ctx.app.inject({ url: "/chain/abc12345" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    await ctx.app.close();
  });
});

describe("initData freshness window", () => {
  it("accepts a 2h-old session by default (Telegram never refreshes initData) but not a 3-day-old one", async () => {
    const ctx = await createCtx();
    const user = { id: newTgId(), first_name: "Old" };
    const at = (hoursAgo: number) =>
      `tma ${signInitData(user, BOT_TOKEN, { authDate: Math.floor(Date.now() / 1000) - hoursAgo * 3600 })}`;
    expect(
      (await ctx.app.inject({ url: "/api/me", headers: { authorization: at(2) } })).statusCode,
    ).toBe(200);
    expect(
      (await ctx.app.inject({ url: "/api/me", headers: { authorization: at(72) } })).statusCode,
    ).toBe(401);
    await ctx.app.close();
  });

  it("is configurable (INITDATA_MAX_AGE_SEC)", async () => {
    const ctx = await createCtx({ INITDATA_MAX_AGE_SEC: "3600" });
    const user = { id: newTgId(), first_name: "Old" };
    const raw = signInitData(user, BOT_TOKEN, { authDate: Math.floor(Date.now() / 1000) - 7200 });
    expect(
      (await ctx.app.inject({ url: "/api/me", headers: { authorization: `tma ${raw}` } }))
        .statusCode,
    ).toBe(401);
    await ctx.app.close();
  });
});

describe("secrets never reach the logs", () => {
  it("does not log initData, the bot token or authorization headers (including on 4xx/5xx paths)", async () => {
    const lines: string[] = [];
    const ctx = await createCtx({}, { logStream: { write: (m) => void lines.push(m) } });
    const tgId = newTgId();
    const headers = authHeader(tgId);
    await ctx.app.inject({ url: "/api/me", headers });
    await ctx.app.inject({ url: "/api/chains/does-not-exist", headers });
    await ctx.app.inject({ method: "POST", url: "/api/chains", headers, payload: { title: "x" } }); // 400
    await ctx.app.inject({
      url: "/api/me",
      headers: { authorization: "tma hash=deadbeef&user=%7B%7D" },
    }); // 401
    const logs = lines.join("\n");
    expect(logs.length).toBeGreaterThan(0); // logging really was on
    const initData = headers.authorization.slice(4);
    expect(logs).not.toContain(initData);
    expect(logs).not.toContain(BOT_TOKEN);
    expect(logs).not.toContain("deadbeef");
    expect(logs.toLowerCase()).not.toContain("authorization");
    await ctx.app.close();
  });
});

describe("GET /api/me/posts", () => {
  it("lists my visible posts with their chain, newest first, and paginates", async () => {
    const ctx = await createCtx();
    const me = newTgId();
    const img = await solidImage();
    const chains: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await createChain(ctx, newTgId(), `Profile chain ${i}`);
      chains.push(c);
      await postImage(ctx, me, c, img);
    }
    const res = await ctx.app.inject({ url: "/api/me/posts", headers: authHeader(me) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((p: { chain: { id: string } }) => p.chain.id)).toEqual(
      [...chains].reverse(),
    );
    expect(body.items[0]).toMatchObject({
      isMine: true,
      chain: { title: "Profile chain 2", emoji: null },
    });
    expect(body.nextCursor).toBeNull();

    // hidden chain / hidden post are excluded; other users' posts never show
    await ctx.db.chain.update({ where: { id: chains[0] as string }, data: { isHidden: true } });
    await ctx.db.post.updateMany({
      where: {
        chainId: chains[1] as string,
        userId: (await ctx.db.user.findFirstOrThrow({ where: { telegramId: BigInt(me) } })).id,
      },
      data: { isHidden: true },
    });
    const after = (await ctx.app.inject({ url: "/api/me/posts", headers: authHeader(me) })).json();
    expect(after.items).toHaveLength(1);
    const other = (
      await ctx.app.inject({ url: "/api/me/posts", headers: authHeader(newTgId()) })
    ).json();
    expect(other.items).toHaveLength(0);
    expect(
      (await ctx.app.inject({ url: "/api/me/posts?cursor=abc", headers: authHeader(me) }))
        .statusCode,
    ).toBe(400);
    expect((await ctx.app.inject({ url: "/api/me/posts" })).statusCode).toBe(401);
    await ctx.app.close();
  });
});
