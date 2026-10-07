import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sweepExpiredBoosts } from "../src/boosts";
import { LEGACY } from "./legacy";
import { authHeader, createChain, createCtx, ensureUser, newTgId, type TestCtx } from "./helpers";

const H = 3_600_000;
const D = 24 * H;
let ctx: TestCtx;
let nowMs = Date.now();
const clock = () => new Date(nowMs);

beforeAll(async () => {
  ctx = await createCtx({}, { now: clock });
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.db.$disconnect();
});
beforeEach(async () => {
  nowMs = Date.now();
  // the carousel is global state: start every test from "nothing is boosted"
  await ctx.db.chain.updateMany({ data: { boostedUntil: null, isBoosted: false } });
});

const get = (tgId: number, url: string) => ctx.app.inject({ url, headers: authHeader(tgId) });
const send = (method: "POST" | "PATCH", tgId: number, url: string, payload: unknown) =>
  ctx.app.inject({
    method,
    url,
    headers: authHeader(tgId),
    payload: payload as Record<string, unknown>,
  });
const boostRow = (chainId: string, until: Date | null, over: Record<string, unknown> = {}) =>
  ctx.db.chain.update({
    where: { id: chainId },
    data: { boostedUntil: until, isBoosted: until !== null, ...over },
  });
const detail = async (tgId: number, id: string) =>
  (await get(tgId, `/api/chains/${id}`)).json().chain;

async function creatorWithChain(title = "Boost candidate", channelUrl?: string) {
  const tgId = newTgId();
  const user = await ensureUser(ctx, tgId);
  const res = await send("POST", tgId, "/api/chains", {
    title,
    ...(channelUrl ? { channelUrl } : {}),
  });
  expect(res.statusCode).toBe(201);
  return { tgId, user, id: res.json().id as string, created: res.json() };
}

describe("channelUrl on create", () => {
  it.each([
    ["t.me/catsclub", "https://t.me/catsclub"],
    ["https://t.me/catsclub", "https://t.me/catsclub"],
    ["http://t.me/catsclub", "https://t.me/catsclub"],
    ["@catsclub", "https://t.me/catsclub"],
    ["https://t.me/+AbCdEfGhIjKl", "https://t.me/+AbCdEfGhIjKl"],
    ["https://t.me/joinchat/AbCdEfGhIjKl", "https://t.me/joinchat/AbCdEfGhIjKl"],
  ])("accepts and normalizes %j", async (input, normalized) => {
    const c = await creatorWithChain("Valid channel", input);
    expect(c.created.channelUrl).toBe(normalized); // the creator sees their own link
    const row = await ctx.db.chain.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.channelUrl).toBe(normalized);
  });

  it("an empty string means no channel", async () => {
    const tgId = newTgId();
    const r = await send("POST", tgId, "/api/chains", { title: "No channel", channelUrl: "" });
    expect(r.statusCode).toBe(201);
    expect(r.json().channelUrl).toBeNull();
  });

  it.each([
    "https://evil.com/x",
    "javascript:alert(1)",
    "https://t.me@evil.com",
    "https://t.me/two words",
    "data:text/html,hi",
    "https://t.me/catsclub?start=1",
    "https://t.me/catsclub/123",
    `https://t.me/+${"A".repeat(120)}`,
    "x".repeat(400),
  ])("rejects %j with INVALID_CHANNEL_URL", async (bad) => {
    const tgId = newTgId();
    const r = await send("POST", tgId, "/api/chains", { title: "Bad channel", channelUrl: bad });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("INVALID_CHANNEL_URL");
    expect(await ctx.db.chain.count({ where: { title: "Bad channel", channelUrl: bad } })).toBe(0);
  });
});

describe("PATCH /api/chains/:id (creator only)", () => {
  it("lets the creator change channelUrl / emoji / description, and clear them with null", async () => {
    const c = await creatorWithChain("Patch me");
    const r = await send("PATCH", c.tgId, `/api/chains/${c.id}`, {
      channelUrl: "@mynewchannel",
      emoji: "🏁",
      description: "Updated",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      channelUrl: "https://t.me/mynewchannel",
      emoji: "🏁",
      description: "Updated",
      title: "Patch me",
    });
    const cleared = await send("PATCH", c.tgId, `/api/chains/${c.id}`, {
      channelUrl: null,
      description: null,
    });
    expect(cleared.json()).toMatchObject({ channelUrl: null, description: null, emoji: "🏁" });
    expect(
      (await send("PATCH", c.tgId, `/api/chains/${c.id}`, { channelUrl: "" })).json().channelUrl,
    ).toBeNull();
  });

  it("is forbidden for everyone else and for anonymous callers", async () => {
    const c = await creatorWithChain("Mine only", "@originalchan");
    const other = newTgId();
    await ensureUser(ctx, other);
    const r = await send("PATCH", other, `/api/chains/${c.id}`, { channelUrl: "@hijacked1" });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("FORBIDDEN");
    expect((await ctx.db.chain.findUniqueOrThrow({ where: { id: c.id } })).channelUrl).toBe(
      "https://t.me/originalchan",
    );
    const anon = await ctx.app.inject({
      method: "PATCH",
      url: `/api/chains/${c.id}`,
      payload: { emoji: "x" },
    });
    expect(anon.statusCode).toBe(401);
  });

  it("validates: title is not editable, invalid links, empty body, unknown / hidden chain", async () => {
    const c = await creatorWithChain("Validate me");
    const patch = (body: unknown, id = c.id, who = c.tgId) =>
      send("PATCH", who, `/api/chains/${id}`, body);
    expect((await patch({ title: "New title" })).statusCode).toBe(400);
    expect((await patch({})).statusCode).toBe(400);
    const bad = await patch({ channelUrl: "https://evil.com" });
    expect([bad.statusCode, bad.json().error.code]).toEqual([400, "INVALID_CHANNEL_URL"]);
    expect((await patch({ channelUrl: "javascript:alert(1)" })).json().error.code).toBe(
      "INVALID_CHANNEL_URL",
    );
    expect((await patch({ emoji: "e".repeat(20) })).statusCode).toBe(400);
    expect((await patch({ emoji: "x" }, "nope1234")).statusCode).toBe(404);
    await ctx.db.chain.update({ where: { id: c.id }, data: { isHidden: true } });
    expect((await patch({ emoji: "x" })).statusCode).toBe(404);
    expect((await ctx.db.chain.findUniqueOrThrow({ where: { id: c.id } })).title).toBe(
      "Validate me",
    );
  });
});

describe("channelUrl visibility: public only while boosted", () => {
  it("hides it from everyone but the creator on a non-boosted chain, on every endpoint", async () => {
    const c = await creatorWithChain("Private channel", "@secretchan1");
    const viewer = newTgId();
    expect((await detail(viewer, c.id)).channelUrl).toBeNull();
    const list = (await get(viewer, "/api/chains?sort=new")).json().items as Array<{
      id: string;
      channelUrl: string | null;
    }>;
    expect(list.find((x) => x.id === c.id)?.channelUrl).toBeNull();
    expect((await get(viewer, "/api/chains/boosted")).json()).toEqual([]);
    expect((await detail(c.tgId, c.id)).channelUrl).toBe("https://t.me/secretchan1"); // the creator always sees it
    const mine = (await get(c.tgId, "/api/me/chains")).json().items as Array<{
      id: string;
      channelUrl: string | null;
    }>;
    expect(mine.find((x) => x.id === c.id)?.channelUrl).toBe("https://t.me/secretchan1");
    // the public landing endpoint never carries it either
    expect((await ctx.app.inject({ url: `/api/chains/${c.id}/public` })).body).not.toContain(
      "secretchan1",
    );
  });

  it("shows it to everyone while boosted, and hides it again once the boost is over (clock)", async () => {
    const c = await creatorWithChain("Visible while boosted", "@visiblechan");
    await boostRow(c.id, new Date(nowMs + D));
    const viewer = newTgId();
    const d = await detail(viewer, c.id);
    expect(d).toMatchObject({ isBoosted: true, channelUrl: "https://t.me/visiblechan" });
    expect(d.boostedUntil).toBeNull(); // the remaining time is for the creator only
    expect((await detail(c.tgId, c.id)).boostedUntil).toBe(new Date(nowMs + D).toISOString());
    const carousel = (await get(viewer, "/api/chains/boosted")).json();
    expect(carousel.find((x: { id: string }) => x.id === c.id)).toMatchObject({
      channelUrl: "https://t.me/visiblechan",
      isBoosted: true,
    });

    nowMs += D + 1; // the boost is over, the cached flag is still true
    expect((await ctx.db.chain.findUniqueOrThrow({ where: { id: c.id } })).isBoosted).toBe(true);
    expect(await detail(viewer, c.id)).toMatchObject({
      isBoosted: false,
      channelUrl: null,
      boostedUntil: null,
    });
    expect(await detail(c.tgId, c.id)).toMatchObject({
      isBoosted: false,
      channelUrl: "https://t.me/visiblechan",
      boostedUntil: null,
    });
  });
});

describe("GET /api/chains/boosted (the carousel)", () => {
  it("requires auth", async () => {
    expect((await ctx.app.inject({ url: "/api/chains/boosted" })).statusCode).toBe(401);
  });

  it("orders by boostedUntil desc, limits to 10, excludes hidden and expired chains", async () => {
    const viewer = newTgId();
    const made: Array<{ id: string; until: number }> = [];
    for (let i = 0; i < 12; i++) {
      const c = await creatorWithChain(`Carousel ${i}`);
      const until = nowMs + (i + 1) * H;
      await boostRow(c.id, new Date(until));
      made.push({ id: c.id, until });
    }
    const hidden = await creatorWithChain("Hidden boosted");
    await boostRow(hidden.id, new Date(nowMs + 100 * D), { isHidden: true });
    const expired = await creatorWithChain("Expired boosted");
    await boostRow(expired.id, new Date(nowMs - H));
    const staleCache = await creatorWithChain("Cache says boosted");
    await ctx.db.chain.update({
      where: { id: staleCache.id },
      data: { isBoosted: true, boostedUntil: null },
    });

    const res = (await get(viewer, "/api/chains/boosted")).json() as Array<{ id: string }>;
    expect(res).toHaveLength(10);
    const expected = [...made]
      .sort((a, b) => b.until - a.until)
      .slice(0, 10)
      .map((m) => m.id);
    expect(res.map((x) => x.id)).toEqual(expected);
    for (const bad of [hidden.id, expired.id, staleCache.id])
      expect(res.map((x) => x.id)).not.toContain(bad);

    expect(((await get(viewer, "/api/chains/boosted?limit=3")).json() as unknown[]).length).toBe(3);
    expect((await get(viewer, "/api/chains/boosted?limit=0")).statusCode).toBe(400);
    expect((await get(viewer, "/api/chains/boosted?limit=11")).statusCode).toBe(400);
  });

  it("a boosted chain that was hidden later disappears immediately", async () => {
    const c = await creatorWithChain("Hide me later");
    await boostRow(c.id, new Date(nowMs + D));
    const viewer = newTgId();
    expect(
      ((await get(viewer, "/api/chains/boosted")).json() as Array<{ id: string }>).map((x) => x.id),
    ).toContain(c.id);
    await ctx.db.chain.update({ where: { id: c.id }, data: { isHidden: true } });
    expect(
      ((await get(viewer, "/api/chains/boosted")).json() as Array<{ id: string }>).map((x) => x.id),
    ).not.toContain(c.id);
  });

  it("expiry with the injected clock: gone from the carousel, DTO says not boosted even though the cache is true, then the sweeper cleans the cache", async () => {
    const c = await creatorWithChain("Expires soon");
    await boostRow(c.id, new Date(nowMs + 2 * H));
    const viewer = newTgId();
    const ids = async () =>
      ((await get(viewer, "/api/chains/boosted")).json() as Array<{ id: string }>).map((x) => x.id);
    expect(await ids()).toContain(c.id);

    nowMs += 2 * H; // exactly at the end: not boosted any more (boostedUntil > now is exclusive)
    expect(await ids()).not.toContain(c.id);
    const inList = (await get(viewer, "/api/chains?sort=new")).json().items as Array<{
      id: string;
      isBoosted: boolean;
    }>;
    expect(inList.find((x) => x.id === c.id)?.isBoosted).toBe(false);
    expect((await ctx.db.chain.findUniqueOrThrow({ where: { id: c.id } })).isBoosted).toBe(true); // stale cache, harmless

    expect(await sweepExpiredBoosts(ctx.db, clock())).toBeGreaterThanOrEqual(1);
    expect((await ctx.db.chain.findUniqueOrThrow({ where: { id: c.id } })).isBoosted).toBe(false);
    expect(await ids()).not.toContain(c.id);
  });

  it("list items carry isBoosted (Home feed ordering is unchanged)", async () => {
    const plain = await creatorWithChain("Plain feed item");
    const boosted = await creatorWithChain("Boosted feed item");
    await boostRow(boosted.id, new Date(nowMs + D));
    const viewer = newTgId();
    const items = (await get(viewer, "/api/chains?sort=new")).json().items as Array<{
      id: string;
      isBoosted: boolean;
    }>;
    expect(items.find((x) => x.id === boosted.id)?.isBoosted).toBe(true);
    expect(items.find((x) => x.id === plain.id)?.isBoosted).toBe(false);
    const order = items.map((x) => x.id);
    expect(order.indexOf(boosted.id)).toBeLessThan(order.indexOf(plain.id)); // 'new' = newest first, not boost first
  });
});

describe("GET /api/me/chains", () => {
  it("lists only my visible chains, newest first, with the creator view", async () => {
    const c = await creatorWithChain("Mine A", "@minechan1");
    const second = (await send("POST", c.tgId, "/api/chains", { title: "Mine B" })).json();
    const hidden = (await send("POST", c.tgId, "/api/chains", { title: "Mine hidden" })).json();
    await ctx.db.chain.update({ where: { id: hidden.id }, data: { isHidden: true } });
    await boostRow(c.id, new Date(nowMs + D));
    const items = (await get(c.tgId, "/api/me/chains")).json().items as Array<{
      id: string;
      isBoosted: boolean;
      boostedUntil: string | null;
    }>;
    expect(items.map((x) => x.id)).toEqual([second.id, c.id]);
    expect(items[1]).toMatchObject({
      isBoosted: true,
      boostedUntil: new Date(nowMs + D).toISOString(),
    });
    const other = (await get(newTgId(), "/api/me/chains")).json();
    expect(other.items).toEqual([]);
    expect((await get(c.tgId, "/api/me/chains?cursor=zz")).statusCode).toBe(400);
  });
});

describe("dev endpoints (mock mode)", () => {
  it("boost-chain puts a chain into the carousel; expire-boost takes it out without touching the cache", async () => {
    const c = await creatorWithChain("Dev boosted", "@devchannel1");
    const viewer = newTgId();
    const ids = async () =>
      ((await get(viewer, "/api/chains/boosted")).json() as Array<{ id: string }>).map((x) => x.id);

    const r = await ctx.app.inject({
      method: "POST",
      url: "/api/dev/boost-chain",
      payload: { chainId: c.id, hours: 24 },
    });
    expect(r.statusCode).toBe(200);
    expect(new Date(r.json().boostedUntil).getTime()).toBe(nowMs + D);
    expect(await ids()).toContain(c.id);
    expect(await ctx.db.chainBoost.count({ where: { chainId: c.id } })).toBe(1);
    // stacking from the running boost
    const again = await ctx.app.inject({
      method: "POST",
      url: "/api/dev/boost-chain",
      payload: { chainId: c.id, hours: 168 },
    });
    expect(new Date(again.json().boostedUntil).getTime()).toBe(nowMs + D + 7 * D);

    const ex = await ctx.app.inject({
      method: "POST",
      url: "/api/dev/expire-boost",
      payload: { chainId: c.id },
    });
    expect(ex.statusCode).toBe(200);
    expect(new Date(ex.json().boostedUntil).getTime()).toBeLessThan(nowMs);
    expect(await ids()).not.toContain(c.id);
    expect((await ctx.db.chain.findUniqueOrThrow({ where: { id: c.id } })).isBoosted).toBe(true); // proves nothing relies on the cache
    expect((await detail(viewer, c.id)).channelUrl).toBeNull();
  });

  it("validates input", async () => {
    const post = (url: string, payload: unknown) =>
      ctx.app.inject({ method: "POST", url, payload: payload as Record<string, unknown> });
    expect(
      (await post("/api/dev/boost-chain", { chainId: "nope1234", hours: 24 })).statusCode,
    ).toBe(404);
    expect((await post("/api/dev/boost-chain", { chainId: "nope1234", hours: 0 })).statusCode).toBe(
      400,
    );
    expect((await post("/api/dev/expire-boost", { chainId: "nope1234" })).statusCode).toBe(404);
    expect((await post("/api/dev/expire-boost", {})).statusCode).toBe(400);
  });

  it("the removed PRO/usage endpoints are gone", async () => {
    for (const url of [LEGACY.grantEndpoint, LEGACY.resetEndpoint]) {
      expect((await ctx.app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(404);
    }
  });
});

describe("a boosted chain is still an ordinary chain", () => {
  it("anyone can join it for free, with no paywall, and only the creator can boost", async () => {
    const c = await creatorWithChain("Join me");
    await boostRow(c.id, new Date(nowMs + D));
    const stranger = newTgId();
    await ensureUser(ctx, stranger);
    const inv = await send("POST", stranger, "/api/payments/stars/invoice", {
      chainId: c.id,
      planId: "boost_24h",
    });
    expect(inv.statusCode).toBe(403); // not the creator
    const d = await detail(stranger, c.id);
    expect(d.isBoosted).toBe(true);
    expect(await ctx.db.post.count({ where: { chainId: c.id } })).toBe(0);
    await createChain(ctx, stranger, "Stranger's own chain"); // creating chains is free too
  });
});
