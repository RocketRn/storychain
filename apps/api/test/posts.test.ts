import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authHeader,
  createChain,
  createCtx,
  newTgId,
  postImage,
  regionDiff,
  solidImage,
  type TestCtx,
} from "./helpers";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.db.$disconnect();
});

async function makePro(tgId: number) {
  await ctx.app.inject({ url: "/api/me", headers: authHeader(tgId) }); // ensure user exists
  await ctx.app.inject({
    method: "POST",
    url: "/api/dev/grant-pro",
    payload: { telegramId: tgId, days: 30 },
  });
}

describe("joining chains", () => {
  it("creates a post, assigns positions and share link", async () => {
    const [a, b] = [newTgId(), newTgId()];
    const chain = await createChain(ctx, a);
    const img = await solidImage();

    const r1 = await postImage(ctx, a, chain, img);
    expect(r1.statusCode).toBe(201);
    const j1 = r1.json();
    expect(j1.post.position).toBe(1);
    expect(j1.post.watermarked).toBe(true);
    expect(j1.publicImageUrl).toBe(j1.post.imageUrl);
    expect(j1.shareLink).toBe(`https://t.me/storychain_bot?startapp=chain_${chain}`);
    expect(j1.post.isMine).toBe(true);

    const r2 = await postImage(ctx, b, chain, img);
    expect(r2.json().post.position).toBe(2);

    const detail = (
      await ctx.app.inject({ url: `/api/chains/${chain}`, headers: authHeader(a) })
    ).json();
    expect(detail.chain.postsCount).toBe(2);
    expect(detail.hasJoined).toBe(true);
    expect(detail.posts.items.map((p: { position: number }) => p.position)).toEqual([2, 1]);
    expect(detail.posts.items[0].isMine).toBe(false);
    expect(detail.posts.items[0].user.telegramId).toBeUndefined();
  });

  it("stores a 1080x1920 image and a ~360px thumbnail", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    const res = (
      await postImage(ctx, a, chain, await solidImage({ format: "png" }), undefined, {
        mime: "image/png",
      })
    ).json();
    const sharp = (await import("sharp")).default;
    const full = await sharp(ctx.storage.get(res.post.imageUrl)).metadata();
    const thumb = await sharp(ctx.storage.get(res.post.thumbUrl)).metadata();
    expect([full.format, full.width, full.height]).toEqual(["jpeg", 1080, 1920]);
    expect([thumb.format, thumb.width, thumb.height]).toEqual(["jpeg", 360, 640]);
  });

  it("re-posting replaces the previous post and keeps position / count", async () => {
    const [a, b] = [newTgId(), newTgId()];
    const chain = await createChain(ctx, a);
    await postImage(ctx, a, chain, await solidImage());
    const first = (await postImage(ctx, b, chain, await solidImage({ color: "#0000ff" }))).json()
      .post;
    const second = (
      await postImage(ctx, b, chain, await solidImage({ color: "#00ff00" }), {
        templateId: "ocean",
        caption: "v2",
      })
    ).json().post;
    expect(second.id).toBe(first.id);
    expect(second.position).toBe(first.position);
    expect(second.imageUrl).not.toBe(first.imageUrl);
    expect(second.caption).toBe("v2");
    const detail = (
      await ctx.app.inject({ url: `/api/chains/${chain}`, headers: authHeader(a) })
    ).json();
    expect(detail.chain.postsCount).toBe(2);
    expect(await ctx.db.post.count({ where: { chainId: chain } })).toBe(2);
  });

  it("enforces the daily limit (4th publication -> DAILY_LIMIT_REACHED)", async () => {
    const a = newTgId();
    const img = await solidImage();
    const chains: string[] = [];
    for (let i = 0; i < 4; i++) chains.push(await createChain(ctx, newTgId(), `Limit chain ${i}`));
    for (let i = 0; i < 3; i++)
      expect((await postImage(ctx, a, chains[i] as string, img)).statusCode).toBe(201);
    const res = await postImage(ctx, a, chains[3] as string, img);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("DAILY_LIMIT_REACHED");
    const me = (await ctx.app.inject({ url: "/api/me", headers: authHeader(a) })).json();
    expect(me).toMatchObject({ usedToday: 3, dailyLimit: 3 });
    // nothing was joined
    expect(await ctx.db.post.count({ where: { chainId: chains[3] as string } })).toBe(0);
  });

  it("is atomic under concurrent posts (no over-limit, distinct positions)", async () => {
    const chain = await createChain(ctx, newTgId());
    const img = await solidImage();
    const users = Array.from({ length: 5 }, () => newTgId());
    const results = await Promise.all(users.map((u) => postImage(ctx, u, chain, img)));
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const positions = results.map((r) => r.json().post.position).sort();
    expect(positions).toEqual([1, 2, 3, 4, 5]);

    const solo = newTgId();
    const chains = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createChain(ctx, newTgId(), `Race chain ${i}`)),
    );
    const rs = await Promise.all(chains.map((c) => postImage(ctx, solo, c, img)));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(3);
    expect(rs.filter((r) => r.statusCode === 429)).toHaveLength(2);
  });

  it("rejects premium templates for non-PRO (PRO_REQUIRED) and accepts them for PRO", async () => {
    const [free, pro] = [newTgId(), newTgId()];
    const chain = await createChain(ctx, free);
    const img = await solidImage();
    const denied = await postImage(ctx, free, chain, img, { templateId: "neon" });
    expect(denied.statusCode).toBe(402);
    expect(denied.json().error.code).toBe("PRO_REQUIRED");

    await makePro(pro);
    const ok = await postImage(ctx, pro, chain, img, { templateId: "neon" });
    expect(ok.statusCode).toBe(201);
  });

  it("rejects premium fonts for non-PRO", async () => {
    const [free, pro] = [newTgId(), newTgId()];
    await makePro(pro);
    const chain = await createChain(ctx, free);
    const img = await solidImage();
    const denied = await postImage(ctx, free, chain, img, {
      templateId: "sunset",
      fontFamily: "Pacifico",
    });
    expect(denied.statusCode).toBe(402);
    expect(denied.json().error.code).toBe("PRO_REQUIRED");
    expect(
      (await postImage(ctx, free, chain, img, { templateId: "sunset", fontFamily: "Manrope" }))
        .statusCode,
    ).toBe(201);
    expect(
      (await postImage(ctx, pro, chain, img, { templateId: "sunset", fontFamily: "Pacifico" }))
        .statusCode,
    ).toBe(201);
  });

  it("exposes myPosition for re-posting", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    const before = (
      await ctx.app.inject({ url: `/api/chains/${chain}`, headers: authHeader(a) })
    ).json();
    expect(before.myPosition).toBeNull();
    await postImage(ctx, newTgId(), chain, await solidImage());
    await postImage(ctx, a, chain, await solidImage());
    const after = (
      await ctx.app.inject({ url: `/api/chains/${chain}`, headers: authHeader(a) })
    ).json();
    expect(after.myPosition).toBe(2);
    expect(after.myPost).toMatchObject({ position: 2, isMine: true, chainId: chain });
    expect(after.shareLink).toBe(`https://t.me/storychain_bot?startapp=chain_${chain}`);
    expect(before.myPost).toBeNull();
  });

  it("PRO has no daily limit", async () => {
    const pro = newTgId();
    await makePro(pro);
    const img = await solidImage();
    for (let i = 0; i < 5; i++) {
      const c = await createChain(ctx, newTgId(), `Pro chain ${i}`);
      expect((await postImage(ctx, pro, c, img)).statusCode).toBe(201);
    }
    const me = (await ctx.app.inject({ url: "/api/me", headers: authHeader(pro) })).json();
    expect(me).toMatchObject({ isPro: true, dailyLimit: null, usedToday: 5 });
  });

  it("applies the watermark server-side only for non-PRO (pixel comparison)", async () => {
    const [free, pro] = [newTgId(), newTgId()];
    await makePro(pro);
    const chain = await createChain(ctx, free);
    const src = await solidImage();
    const f = (await postImage(ctx, free, chain, src)).json().post;
    const p = (await postImage(ctx, pro, chain, src)).json().post;
    expect(f.watermarked).toBe(true);
    expect(p.watermarked).toBe(false);

    const bottomRight = { left: 600, top: 1500, width: 480, height: 420 };
    const topLeft = { left: 0, top: 0, width: 480, height: 420 };
    const freeImg = ctx.storage.get(f.imageUrl);
    const proImg = ctx.storage.get(p.imageUrl);
    expect(await regionDiff(freeImg, src, bottomRight)).toBeGreaterThan(1);
    expect(await regionDiff(proImg, src, bottomRight)).toBeLessThan(1);
    expect(await regionDiff(freeImg, src, topLeft)).toBeLessThan(1);
  });

  it("ignores a client-supplied watermark flag", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    const r = await postImage(ctx, a, chain, await solidImage(), {
      templateId: "sunset",
      watermarked: "false",
    });
    expect(r.json().post.watermarked).toBe(true);
  });
});

describe("image validation", () => {
  it("rejects wrong dimensions", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    const res = await postImage(ctx, a, chain, await solidImage({ w: 800, h: 800 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_IMAGE");
  });

  it("does not trust the mime header (garbage labelled image/jpeg)", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    const res = await postImage(ctx, a, chain, Buffer.from("definitely not an image"), undefined, {
      mime: "image/jpeg",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_IMAGE");
  });

  it("rejects other formats even with the right size (GIF)", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    const res = await postImage(ctx, a, chain, await solidImage({ format: "gif" }), undefined, {
      mime: "image/jpeg",
    });
    expect(res.json().error.code).toBe("INVALID_IMAGE");
  });

  it("rejects files over 8 MB", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    const res = await postImage(ctx, a, chain, Buffer.alloc(9 * 1024 * 1024, 1));
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("requires the image, a valid template and multipart", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    expect((await postImage(ctx, a, chain, undefined)).statusCode).toBe(400);
    expect(
      (await postImage(ctx, a, chain, await solidImage(), { templateId: "nope" })).statusCode,
    ).toBe(400);
    expect((await postImage(ctx, a, chain, await solidImage(), {})).statusCode).toBe(400);
    const json = await ctx.app.inject({
      method: "POST",
      url: `/api/chains/${chain}/posts`,
      headers: authHeader(a),
      payload: {},
    });
    expect(json.statusCode).toBe(400);
  });

  it("failed validation does not consume the daily quota", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    await postImage(ctx, a, chain, Buffer.from("junk"));
    const me = (await ctx.app.inject({ url: "/api/me", headers: authHeader(a) })).json();
    expect(me.usedToday).toBe(0);
  });
});

describe("misc mutations", () => {
  it("marks a post as shared only for its owner", async () => {
    const [a, b] = [newTgId(), newTgId()];
    const chain = await createChain(ctx, a);
    const post = (await postImage(ctx, a, chain, await solidImage())).json().post;
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: `/api/posts/${post.id}/shared`,
          headers: authHeader(b),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: `/api/posts/${post.id}/shared`,
          headers: authHeader(a),
        })
      ).statusCode,
    ).toBe(200);
    expect((await ctx.db.post.findUniqueOrThrow({ where: { id: post.id } })).sharedToStory).toBe(
      true,
    );
  });

  it("excludes hidden posts from the gallery", async () => {
    const [a, b] = [newTgId(), newTgId()];
    const chain = await createChain(ctx, a);
    const post = (await postImage(ctx, a, chain, await solidImage())).json().post;
    await postImage(ctx, b, chain, await solidImage());
    await ctx.db.post.update({ where: { id: post.id }, data: { isHidden: true } });
    const g = (
      await ctx.app.inject({ url: `/api/chains/${chain}/posts`, headers: authHeader(b) })
    ).json();
    expect(g.items).toHaveLength(1);
  });

  it("accepts reports and validates them", async () => {
    const a = newTgId();
    const ok = await ctx.app.inject({
      method: "POST",
      url: "/api/reports",
      headers: authHeader(a),
      payload: { chainId: "abc12345", reason: "spam" },
    });
    expect(ok.statusCode).toBe(201);
    const bad = await ctx.app.inject({
      method: "POST",
      url: "/api/reports",
      headers: authHeader(a),
      payload: { reason: "spam" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("returns plans with per-platform methods", async () => {
    const a = newTgId();
    const ios = (
      await ctx.app.inject({
        url: "/api/plans",
        headers: { ...authHeader(a), "x-tg-platform": "ios" },
      })
    ).json();
    expect(ios.methods).toEqual(["stars"]);
    const desktop = (
      await ctx.app.inject({
        url: "/api/plans",
        headers: { ...authHeader(a), "x-tg-platform": "tdesktop" },
      })
    ).json();
    expect(desktop.methods).toEqual(["stars", "ton_grm"]);
    expect(desktop.plans[0]).toMatchObject({
      id: "pro_30d",
      stars: { amount: "150", currency: "XTR" },
      grm: { amount: "100000000000", human: "100" },
    });
  });
});
