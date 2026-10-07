import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authHeader, createChain, createCtx, newTgId, type TestCtx } from "./helpers";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.db.$disconnect();
});

describe("chains", () => {
  it("creates a chain with a URL-safe 8-char id", async () => {
    const id = await createChain(ctx, newTgId(), "Your desk right now");
    expect(id).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });

  it("validates input", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/chains",
      headers: authHeader(newTgId()),
      payload: { title: "ab" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_REQUEST");
  });

  it("applies the blocklist hook", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/chains",
      headers: authHeader(newTgId()),
      payload: { title: "buy drugs here" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BLOCKED_CONTENT");
  });

  it("requires auth for mutation and listing", async () => {
    expect(
      (await ctx.app.inject({ method: "POST", url: "/api/chains", payload: { title: "Hello" } }))
        .statusCode,
    ).toBe(401);
    expect((await ctx.app.inject({ url: "/api/chains" })).statusCode).toBe(401);
  });

  it("lists new / trending / featured and paginates", async () => {
    const me = newTgId();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await createChain(ctx, me, `Chain number ${i}`));
    const res = await ctx.app.inject({ url: "/api/chains?sort=new", headers: authHeader(me) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    expect(body.items[0].creator.telegramId).toBeUndefined();

    await ctx.db.chain.update({ where: { id: ids[0] as string }, data: { isFeatured: true } });
    const f = await ctx.app.inject({ url: "/api/chains?sort=featured", headers: authHeader(me) });
    expect(f.json().items.every((c: { isFeatured: boolean }) => c.isFeatured)).toBe(true);

    // pagination: create > 20 chains total
    for (let i = 0; i < 20; i++)
      await ctx.db.chain.create({
        data: {
          id: `pg${String(i).padStart(6, "0")}`,
          title: `Paged ${i}`,
          creatorId: (await ctx.db.user.findFirstOrThrow()).id,
        },
      });
    const p1 = (
      await ctx.app.inject({ url: "/api/chains?sort=new", headers: authHeader(me) })
    ).json();
    expect(p1.items).toHaveLength(20);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (
      await ctx.app.inject({
        url: `/api/chains?sort=new&cursor=${p1.nextCursor}`,
        headers: authHeader(me),
      })
    ).json();
    expect(p2.items.length).toBeGreaterThan(0);
    const seen = new Set(p1.items.map((c: { id: string }) => c.id));
    expect(p2.items.some((c: { id: string }) => seen.has(c.id))).toBe(false);
  });

  it("gets chain detail and the public endpoint without auth", async () => {
    const me = newTgId();
    const id = await createChain(ctx, me, "Track of the day");
    const d = await ctx.app.inject({ url: `/api/chains/${id}`, headers: authHeader(me) });
    expect(d.json()).toMatchObject({
      hasJoined: false,
      chain: { id, postsCount: 0 },
      posts: { items: [] },
    });
    const pub = await ctx.app.inject({ url: `/api/chains/${id}/public` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toEqual({ id, title: "Track of the day", emoji: null, postsCount: 0 });
  });

  it("hides hidden and unknown chains everywhere", async () => {
    const me = newTgId();
    const id = await createChain(ctx, me, "Soon hidden");
    await ctx.db.chain.update({ where: { id }, data: { isHidden: true } });
    for (const url of [
      `/api/chains/${id}`,
      `/api/chains/${id}/posts`,
      `/api/chains/${id}/public`,
      "/api/chains/nope1234",
      "/api/chains/bad!id",
    ]) {
      const res = await ctx.app.inject({ url, headers: authHeader(me) });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    }
    const list = (
      await ctx.app.inject({ url: "/api/chains?sort=new", headers: authHeader(me) })
    ).json();
    expect(list.items.some((c: { id: string }) => c.id === id)).toBe(false);
  });
});
