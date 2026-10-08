import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteUploads, findOrphanUploads } from "../src/storage/gc";
import { createChain, createCtx, ensureUser, newTgId, type TestCtx } from "./helpers";

const DAY = 86_400_000;
let ctx: TestCtx;
const root = mkdtempSync(join(tmpdir(), "storychain-gc-"));
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(async () => {
  rmSync(root, { recursive: true, force: true });
  await ctx.app.close();
  await ctx.db.$disconnect();
});

function file(key: string, ageMs: number): string {
  const full = join(root, key);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, "x".repeat(100));
  const t = (Date.now() - ageMs) / 1000;
  utimesSync(full, t, t);
  return full;
}

describe("orphaned upload sweep", () => {
  it("finds only old files no post references; in-flight and referenced files are safe", async () => {
    const tg = newTgId();
    const user = await ensureUser(ctx, tg);
    const chainId = await createChain(ctx, tg);
    // a post stored under an OLD public base URL: matching is by key, so a domain change keeps it safe
    await ctx.db.post.create({
      data: {
        chainId,
        userId: user.id,
        position: 1,
        imageUrl: `https://old-domain.example.com/uploads/posts/${chainId}/kept.jpg`,
        thumbUrl: `http://localhost:3000/uploads/posts/${chainId}/kept_t.jpg`,
        templateId: "sunset",
        watermarked: true,
      },
    });
    const kept = file(`posts/${chainId}/kept.jpg`, 10 * DAY);
    const keptThumb = file(`posts/${chainId}/kept_t.jpg`, 10 * DAY);
    const orphan = file(`posts/${chainId}/crashed.jpg`, 2 * DAY);
    const inFlight = file(`posts/${chainId}/uploading.jpg`, 60_000);
    const elsewhere = file("other/not-ours.bin", 10 * DAY);

    const found = await findOrphanUploads({ db: ctx.db, root, minAgeMs: DAY });
    expect(found).toEqual([{ key: `posts/${chainId}/crashed.jpg`, bytes: 100 }]);

    await deleteUploads(
      root,
      found.map((f) => f.key),
    );
    expect(existsSync(orphan)).toBe(false);
    for (const f of [kept, keptThumb, inFlight, elsewhere]) expect(existsSync(f), f).toBe(true);
  });

  it("an empty or missing upload directory is not an error; deletion never leaves the root", async () => {
    expect(await findOrphanUploads({ db: ctx.db, root: join(root, "nope"), minAgeMs: 0 })).toEqual(
      [],
    );
    const outside = join(root, "..", `gc-outside-${Date.now()}.txt`);
    writeFileSync(outside, "keep");
    await deleteUploads(root, [`../${outside.split("/").pop()}`]);
    expect(existsSync(outside)).toBe(true);
    rmSync(outside);
  });
});
