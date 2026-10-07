import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authHeader, createCtx, newTgId, type TestCtx } from "./helpers";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.db.$disconnect();
});

describe("auth", () => {
  it("health is public", async () => {
    const res = await ctx.app.inject({ url: "/api/health" });
    expect(res.statusCode).toBe(200);
  });

  it("session upserts the user and returns usage", async () => {
    const id = newTgId();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/session",
      headers: authHeader(id, { premium: true }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.telegramId).toBe(String(id));
    expect(body.user.isTgPremium).toBe(true);
    expect(body).toMatchObject({ isPro: false, dailyLimit: 3, usedToday: 0 });
  });

  it("refreshes isTgPremium on each auth", async () => {
    const id = newTgId();
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/session",
      headers: authHeader(id, { premium: true }),
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/session",
      headers: authHeader(id),
    });
    expect(res.json().user.isTgPremium).toBe(false);
  });

  it("rejects missing, tampered and expired credentials with a stable error", async () => {
    const id = newTgId();
    const missing = await ctx.app.inject({ url: "/api/me" });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: expect.any(String) },
    });

    const good = authHeader(id).authorization;
    const tampered = await ctx.app.inject({
      url: "/api/me",
      headers: {
        authorization: good.replace("first_name%22%3A%22User", "first_name%22%3A%22Evil"),
      },
    });
    expect(tampered.statusCode).toBe(401);

    const expired = await ctx.app.inject({
      url: "/api/me",
      headers: authHeader(id, { authDate: Math.floor(Date.now() / 1000) - 10_000 }),
    });
    expect(expired.statusCode).toBe(401);
  });

  it("dev endpoints work in dev mode and are absent otherwise", async () => {
    const dev = await ctx.app.inject({
      method: "POST",
      url: "/api/dev/init-data",
      payload: { userId: 7 },
    });
    expect(dev.statusCode).toBe(200);
    const me = await ctx.app.inject({
      url: "/api/me",
      headers: { authorization: `tma ${dev.json().initData}` },
    });
    expect(me.statusCode).toBe(200);

    const prod = await createCtx({ DEV_MODE: "false" });
    const res = await prod.app.inject({
      method: "POST",
      url: "/api/dev/init-data",
      payload: { userId: 7 },
    });
    expect(res.statusCode).toBe(404);
    await prod.app.close();
    await prod.db.$disconnect();
  });
});
