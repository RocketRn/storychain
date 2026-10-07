import { copyFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeNewest, decodeTrending, encodeNewest, encodeTrending } from "../src/pagination";
import { authHeader, createCtx, ensureUser, newTgId, type TestCtx } from "./helpers";

describe("cursor codec", () => {
  it("round-trips", () => {
    const k = { createdAt: new Date("2026-10-07T12:34:56.789Z"), id: "AbC_-123" };
    expect(decodeNewest(encodeNewest(k))).toEqual(k);
    expect(decodeTrending(encodeTrending({ ...k, postsCount: 42 }))).toEqual({
      ...k,
      postsCount: 42,
    });
  });

  it("rejects everything that is not exactly one of our cursors", () => {
    const bad = [
      "",
      "abc",
      "1",
      "1.",
      ".abc",
      "20", // an old OFFSET cursor
      "1.a b",
      "1.a/b",
      "1.a;DROP TABLE Chain",
      "-5.abc",
      "1.2.3.4",
      "1.2.3.4.5",
      "9999999999999999.abc", // 16 digits
      `1.${"a".repeat(65)}`,
      "１２.abc", // full-width digits
      "1e3.abc",
      "0x10.abc",
    ];
    for (const raw of bad) expect(() => decodeNewest(raw), raw).toThrow(/Bad cursor/);
    for (const raw of [...bad, "1.abc", "12.1700000000000"])
      expect(() => decodeTrending(raw), raw).toThrow(/Bad cursor/);
    // each endpoint family has its own shape
    expect(() => decodeNewest("5.1700000000000.abc")).toThrow(/Bad cursor/);
  });
});

describe("keyset pagination over HTTP", () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    // a private copy of the migrated test DB: bulk fixtures must not leak into other suites
    const shared = (process.env.TEST_DATABASE_URL as string).replace(/^file:/, "");
    copyFileSync(shared, `${shared}.pagination`);
    ctx = await createCtx({}, {}, { databaseUrl: `file:${shared}.pagination` });
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.$disconnect();
  });

  type Item = { id: string };
  const get = (tgId: number, url: string) => ctx.app.inject({ url, headers: authHeader(tgId) });
  const page = async (tgId: number, url: string, cursor: string | null) => {
    const res = await get(
      tgId,
      cursor ? `${url}${url.includes("?") ? "&" : "?"}cursor=${cursor}` : url,
    );
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { items: Item[]; nextCursor: string | null };
  };
  const everything = async (tgId: number, url: string): Promise<Item[]> => {
    const out: Item[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 200; guard++) {
      const p = await page(tgId, url, cursor);
      out.push(...p.items);
      cursor = p.nextCursor;
      if (!cursor) return out;
    }
    throw new Error("pagination did not terminate");
  };
  const ids = (items: Item[]) => items.map((i) => i.id);

  const T = new Date("2099-01-01T00:00:00.000Z"); // newer than anything else in the DB
  const tied = (n: number, prefix: string, extra: Record<string, unknown> = {}) =>
    Array.from(
      { length: n },
      (_, i) => `${prefix}${String(i + 1).padStart(8 - prefix.length, "0")}`,
    ).map((id) => ({ id, ...extra }));

  it("walks a group of rows with IDENTICAL sort keys without duplicates or gaps, and survives inserts mid-scroll", async () => {
    const me = newTgId();
    const owner = await ensureUser(ctx, me);
    const rows = tied(45, "tie");
    await ctx.db.chain.createMany({
      data: rows.map((r) => ({
        id: r.id,
        title: `Tied ${r.id}`,
        creatorId: owner.id,
        createdAt: T,
      })),
    });
    const expected = rows
      .map((r) => r.id)
      .sort()
      .reverse(); // createdAt ties -> id DESC

    const p1 = await page(me, "/api/chains?sort=new", null);
    expect(ids(p1.items)).toEqual(expected.slice(0, 20));
    // five brand-new chains appear while the user is scrolling: they sort BEFORE the cursor...
    await ctx.db.chain.createMany({
      data: tied(5, "new").map((r) => ({
        id: r.id,
        title: `Fresh ${r.id}`,
        creatorId: owner.id,
        createdAt: new Date("2099-06-01T00:00:00.000Z"),
      })),
    });
    // ...so with OFFSET paging the next page would repeat five items the user already has
    const p2 = await page(me, "/api/chains?sort=new", p1.nextCursor);
    const p3 = await page(me, "/api/chains?sort=new", p2.nextCursor);
    expect(ids(p2.items)).toEqual(expected.slice(20, 40));
    expect(ids(p3.items).slice(0, 5)).toEqual(expected.slice(40, 45));
    const seen = [...p1.items, ...p2.items, ...p3.items];
    expect(new Set(ids(seen)).size).toBe(seen.length);
    expect(ids(seen).some((id) => id.startsWith("new"))).toBe(false);
  });

  it("trending: re-ranking mid-scroll never repeats an item the client already has", async () => {
    const me = newTgId();
    const owner = await ensureUser(ctx, me);
    const rows = tied(45, "hot");
    await ctx.db.chain.createMany({
      data: rows.map((r) => ({
        id: r.id,
        title: `Hot ${r.id}`,
        creatorId: owner.id,
        createdAt: T,
        postsCount: 99_999,
      })),
    });
    const expected = rows
      .map((r) => r.id)
      .sort()
      .reverse();

    const p1 = await page(me, "/api/chains?sort=trending", null);
    expect(ids(p1.items)).toEqual(expected.slice(0, 20));
    const cursorItem = expected[19] as string;
    const jumper = expected[44] as string;
    // the item the cursor points at gets another post (moves up), and an unseen one overtakes everything
    await ctx.db.chain.update({ where: { id: cursorItem }, data: { postsCount: 100_001 } });
    await ctx.db.chain.update({ where: { id: jumper }, data: { postsCount: 100_000 } });

    const p2 = await page(me, "/api/chains?sort=trending", p1.nextCursor);
    const p3 = await page(me, "/api/chains?sort=trending", p2.nextCursor);
    const later = [...p2.items, ...p3.items];
    expect(ids(later).slice(0, 24)).toEqual(expected.slice(20, 44)); // everything after the cursor, in order
    const seenBefore = new Set(ids(p1.items));
    expect(ids(later).some((id) => seenBefore.has(id))).toBe(false); // no repeats
    expect(ids(later)).not.toContain(jumper); // it moved ahead of the cursor: not part of "after"
    expect(new Set(ids(later)).size).toBe(later.length);
  });

  it("featured and trending use their own cursor shape; mixing them up is a 400", async () => {
    const me = newTgId();
    const trending = await page(me, "/api/chains?sort=trending", null);
    const newest = await page(me, "/api/chains?sort=new", null);
    expect(trending.nextCursor).toMatch(/^\d+\.\d+\.[A-Za-z0-9_-]+$/);
    expect(newest.nextCursor).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    expect(
      (await get(me, `/api/chains?sort=trending&cursor=${newest.nextCursor}`)).statusCode,
    ).toBe(400);
    expect((await get(me, `/api/chains?sort=new&cursor=${trending.nextCursor}`)).statusCode).toBe(
      400,
    );
    for (const bad of ["abc", "20", "1.2.3.4", "'; DROP TABLE Chain; --"])
      expect(
        (await get(me, `/api/chains?sort=new&cursor=${encodeURIComponent(bad)}`)).statusCode,
        bad,
      ).toBe(400);
    expect((await get(me, `/api/chains?cursor=${"1".repeat(65)}`)).statusCode).toBe(400);
  });

  it("My marathons: exact page boundaries, newest first, only mine and visible", async () => {
    const me = newTgId();
    const owner = await ensureUser(ctx, me);
    const stranger = await ensureUser(ctx, newTgId());
    await ctx.db.chain.createMany({
      data: tied(20, "mine").map((r) => ({
        id: r.id,
        title: `Mine ${r.id}`,
        creatorId: owner.id,
        createdAt: T,
      })),
    });
    await ctx.db.chain.createMany({
      data: [
        { id: "hidden01", title: "Hidden one", creatorId: owner.id, createdAt: T, isHidden: true },
        { id: "other001", title: "Not mine", creatorId: stranger.id, createdAt: T },
      ],
    });
    // exactly one full page: no cursor, no empty follow-up page
    const exact = await page(me, "/api/me/chains", null);
    expect(exact.items).toHaveLength(20);
    expect(exact.nextCursor).toBeNull();

    await ctx.db.chain.create({
      data: { id: "mine0021", title: "Mine 21", creatorId: owner.id, createdAt: T },
    });
    const all = await everything(me, "/api/me/chains");
    expect(all).toHaveLength(21);
    expect(ids(all)).toEqual(ids(all).slice().sort().reverse()); // same createdAt -> id DESC
    expect(ids(all)).not.toContain("hidden01");
    expect(ids(all)).not.toContain("other001");
    const p1 = await page(me, "/api/me/chains", null);
    expect(p1.items).toHaveLength(20);
    expect(p1.nextCursor).toBeTruthy();
    expect(ids((await page(me, "/api/me/chains", p1.nextCursor)).items)).toHaveLength(1);
    expect((await get(me, "/api/me/chains?cursor=zz")).statusCode).toBe(400);
  });

  it("My posts: pages of 30, skips hidden posts and posts in hidden chains", async () => {
    const me = newTgId();
    const owner = await ensureUser(ctx, me);
    const chains = tied(34, "pc");
    await ctx.db.chain.createMany({
      data: [...chains, { id: "pchid001" }, { id: "pchid002" }].map((c) => ({
        id: c.id,
        title: `Post chain ${c.id}`,
        creatorId: owner.id,
        createdAt: T,
        isHidden: c.id === "pchid001",
      })),
    });
    const mk = (chainId: string, n: number, isHidden = false) => ({
      id: `mp${String(n).padStart(6, "0")}`,
      chainId,
      userId: owner.id,
      position: 1,
      imageUrl: "http://x/i.jpg",
      thumbUrl: "http://x/t.jpg",
      templateId: "sunset",
      watermarked: true,
      createdAt: T,
      isHidden,
    });
    await ctx.db.post.createMany({
      data: [
        ...chains.map((c, i) => mk(c.id, i + 1)),
        mk("pchid001", 100), // chain hidden
        mk("pchid002", 101, true), // post hidden
      ],
    });
    const all = await everything(me, "/api/me/posts");
    expect(all).toHaveLength(34);
    expect(ids(all)).toEqual(ids(all).slice().sort().reverse());
    const p1 = await page(me, "/api/me/posts", null);
    expect(p1.items).toHaveLength(30);
    expect(p1.nextCursor).toBeTruthy();
    expect((await get(me, "/api/me/posts?cursor=abc")).statusCode).toBe(400);
  });
});
