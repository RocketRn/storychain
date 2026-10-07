import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEMPLATES } from "@storychain/shared";
import {
  authHeader,
  createChain,
  createCtx,
  ensureUser,
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

  it("is atomic under concurrent joins (distinct positions, exact count)", async () => {
    const chain = await createChain(ctx, newTgId());
    const img = await solidImage();
    const users = Array.from({ length: 5 }, () => newTgId());
    const results = await Promise.all(users.map((u) => postImage(ctx, u, chain, img)));
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    expect(results.map((r) => r.json().post.position).sort()).toEqual([1, 2, 3, 4, 5]);
    expect((await ctx.db.chain.findUniqueOrThrow({ where: { id: chain } })).postsCount).toBe(5);
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

  it("returns boost plans (Stars + GRM) with per-platform methods, and no PRO plan", async () => {
    const a = newTgId();
    const plans = (platform: string) =>
      ctx.app.inject({
        url: "/api/plans",
        headers: { ...authHeader(a), "x-tg-platform": platform },
      });
    const ios = (await plans("ios")).json();
    expect(ios.methods).toEqual(["stars"]);
    const desktop = (await plans("tdesktop")).json();
    expect(desktop.methods).toEqual(["stars", "ton_grm"]);
    expect(desktop.boostPlans).toEqual([
      {
        id: "boost_24h",
        durationHours: 24,
        prices: {
          stars: 100,
          grm: { amount: "50000000000", decimals: 9, symbol: "GRM", display: "50 GRM" },
        },
      },
      {
        id: "boost_7d",
        durationHours: 168,
        prices: {
          stars: 500,
          grm: { amount: "250000000000", decimals: 9, symbol: "GRM", display: "250 GRM" },
        },
      },
    ]);
    expect(Object.keys(desktop).sort()).toEqual(["boostPlans", "methods"]);
    expect((await ctx.app.inject({ url: "/api/plans" })).statusCode).toBe(401);
  });
});

describe("free and unlimited: no quota, no paywall, no locks", () => {
  it("one user posts to 10 different chains in one UTC day: all succeed", async () => {
    const me = newTgId();
    const img = await solidImage();
    for (let i = 0; i < 10; i++) {
      const c = await createChain(ctx, newTgId(), `Unlimited chain ${i}`);
      const r = await postImage(ctx, me, c, img);
      expect(r.statusCode, `post #${i + 1}`).toBe(201);
    }
    const rows = await ctx.db.post.count({ where: { user: { telegramId: BigInt(me) } } });
    expect(rows).toBe(10);
    // there is no quota state anywhere in the API surface
    const mine = (await ctx.app.inject({ url: "/api/me", headers: authHeader(me) })).json();
    expect(Object.keys(mine)).toEqual(["user"]);
  });

  it("re-posting replaces the post and does not change postsCount", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    const img = await solidImage();
    const first = (await postImage(ctx, a, chain, img)).json().post;
    for (let i = 0; i < 6; i++) expect((await postImage(ctx, a, chain, img)).statusCode).toBe(201);
    const last = (
      await postImage(ctx, a, chain, img, { templateId: "polaroid", caption: "v7" })
    ).json().post;
    expect(last.id).toBe(first.id);
    expect(last).toMatchObject({ position: 1, caption: "v7", templateId: "polaroid" });
    expect((await ctx.db.chain.findUniqueOrThrow({ where: { id: chain } })).postsCount).toBe(1);
    expect(await ctx.db.post.count({ where: { chainId: chain } })).toBe(1);
  });

  it("every template is accepted for a free user; an unknown template is a 400", async () => {
    const chain = await createChain(ctx, newTgId());
    const img = await solidImage();
    for (const t of TEMPLATES) {
      const r = await postImage(ctx, newTgId(), chain, img, { templateId: t.id });
      expect(r.statusCode, t.id).toBe(201);
    }
    const bad = await postImage(ctx, newTgId(), chain, img, { templateId: "no-such-template" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("BAD_REQUEST");
  });

  it("the font form field is ignored (fonts are a free visual choice)", async () => {
    const chain = await createChain(ctx, newTgId());
    const r = await postImage(ctx, newTgId(), chain, await solidImage(), {
      templateId: "sunset",
      fontFamily: "Pacifico",
    });
    expect(r.statusCode).toBe(201);
  });

  it("the attribution badge is composited server-side for EVERY user (pixel comparison)", async () => {
    const src = await solidImage();
    const plain = newTgId();
    const booster = newTgId(); // owns a chain with a running boost: must make no difference to the badge
    const boosterUser = await ensureUser(ctx, booster);
    const boostedChain = await ctx.db.chain.create({
      data: {
        id: "bdg00001",
        title: "Boosted chain",
        creatorId: boosterUser.id,
        isBoosted: true,
        boostedUntil: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    const plainChain = await createChain(ctx, plain);
    const posts = [
      (await postImage(ctx, plain, plainChain, src)).json().post,
      (await postImage(ctx, booster, plainChain, src)).json().post,
      (await postImage(ctx, booster, boostedChain.id, src)).json().post,
      (await postImage(ctx, plain, boostedChain.id, src, { templateId: "neon" })).json().post,
    ];
    const bottomRight = { left: 600, top: 1500, width: 480, height: 420 };
    const topLeft = { left: 0, top: 0, width: 480, height: 420 };
    for (const p of posts) {
      expect(p.watermarked).toBe(true);
      const img = ctx.storage.get(p.imageUrl);
      expect(await regionDiff(img, src, bottomRight)).toBeGreaterThan(1); // badge present
      expect(await regionDiff(img, src, topLeft)).toBeLessThan(1); // and nothing else touched
    }
  });

  it("a failed validation changes nothing (no post, no count)", async () => {
    const a = newTgId();
    const chain = await createChain(ctx, a);
    for (let i = 0; i < 4; i++) await postImage(ctx, a, chain, Buffer.from("junk"));
    expect(await ctx.db.post.count({ where: { chainId: chain } })).toBe(0);
    expect((await ctx.db.chain.findUniqueOrThrow({ where: { id: chain } })).postsCount).toBe(0);
    // ...and the user can still post right after
    expect((await postImage(ctx, a, chain, await solidImage())).statusCode).toBe(201);
  });
});

describe("anti-abuse rate limits (not quotas)", () => {
  const forbidden = /daily|limit reached|pro\b|premium|upgrade|pay|boost|stars|quota|subscribe/i;

  it("posting beyond the per-minute threshold returns RATE_LIMITED (429), never a paywall; other users are unaffected", async () => {
    const low = await createCtx({ RATE_LIMIT_POSTS_PER_MIN: "3" });
    const me = newTgId();
    const other = newTgId();
    const img = await solidImage();
    const chains: string[] = [];
    for (let i = 0; i < 5; i++) chains.push(await createChain(low, newTgId(), `Fast chain ${i}`));
    const codes: number[] = [];
    let blocked: { code: string; message: string } | undefined;
    for (const c of chains) {
      const r = await postImage(low, me, c, img);
      codes.push(r.statusCode);
      if (r.statusCode === 429) blocked ??= r.json().error;
    }
    expect(codes).toEqual([201, 201, 201, 429, 429]);
    expect(blocked?.code).toBe("RATE_LIMITED");
    expect(blocked?.message).not.toMatch(forbidden);
    expect(blocked?.message).toMatch(/wait|moment|fast/i);
    expect((await postImage(low, other, chains[0] as string, img)).statusCode).toBe(201); // keyed per user
    await low.app.close();
  });

  it("chain creation and reports have their own configurable thresholds", async () => {
    const low = await createCtx({
      RATE_LIMIT_CHAINS_PER_HOUR: "2",
      RATE_LIMIT_REPORTS_PER_HOUR: "2",
    });
    const me = newTgId();
    const create = (title: string) =>
      low.app.inject({
        method: "POST",
        url: "/api/chains",
        headers: authHeader(me),
        payload: { title },
      });
    expect([
      (await create("First one")).statusCode,
      (await create("Second one")).statusCode,
    ]).toEqual([201, 201]);
    const third = await create("Third one");
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe("RATE_LIMITED");
    expect(third.json().error.message).not.toMatch(forbidden);

    const report = () =>
      low.app.inject({
        method: "POST",
        url: "/api/reports",
        headers: authHeader(me),
        payload: { chainId: "abc12345", reason: "spam" },
      });
    expect([
      (await report()).statusCode,
      (await report()).statusCode,
      (await report()).statusCode,
    ]).toEqual([201, 201, 429]);
    await low.app.close();
  });

  it("the defaults are 20 posts/min, 10 chains/hour and 10 reports/hour", async () => {
    const { loadConfig } = await import("../src/config");
    expect(loadConfig({} as NodeJS.ProcessEnv).rateLimits).toMatchObject({
      postsPerMin: 20,
      chainsPerHour: 10,
      reportsPerHour: 10,
    });
  });
});
