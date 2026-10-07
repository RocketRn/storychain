import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { LocalDiskStorage } from "../src/storage/local";
import { S3Storage } from "../src/storage/s3";
import { publishPost } from "../src/services/posts";
import {
  authHeader,
  createChain,
  createCtx,
  ensureUser,
  MemoryStorage,
  newTgId,
  postImage,
  solidImage,
  type TestCtx,
} from "./helpers";

const BASE = "https://api.example.com";

describe("LocalDiskStorage.remove", () => {
  const dir = mkdtempSync(join(tmpdir(), "storychain-storage-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("deletes by public URL, ignores foreign URLs, missing files and path traversal", async () => {
    const root = join(dir, "uploads");
    const outside = join(dir, "secret.txt");
    writeFileSync(outside, "keep me");
    const storage = new LocalDiskStorage(root, BASE);
    const a = await storage.put("posts/c1/a.jpg", Buffer.from("a"), "image/jpeg");
    const b = await storage.put("posts/c1/b.jpg", Buffer.from("b"), "image/jpeg");
    expect(existsSync(join(root, "posts/c1/a.jpg"))).toBe(true);

    await storage.remove([
      a.url,
      `${BASE}/uploads/posts/c1/never-existed.jpg`, // idempotent
      "https://elsewhere.example.com/uploads/posts/c1/b.jpg", // not ours
      `${BASE}/uploads/../secret.txt`, // traversal
      `${BASE}/uploads/posts/../../secret.txt`,
    ]);
    expect(existsSync(join(root, "posts/c1/a.jpg"))).toBe(false);
    expect(existsSync(join(root, "posts/c1/b.jpg"))).toBe(true);
    expect(readFileSync(outside, "utf8")).toBe("keep me");
    await storage.remove([b.url]);
    expect(existsSync(join(root, "posts/c1/b.jpg"))).toBe(false);
  });
});

describe("S3Storage.remove", () => {
  const make = () => {
    const storage = new S3Storage({
      endpoint: "",
      region: "auto",
      bucket: "bkt",
      accessKeyId: "id",
      secretAccessKey: "secret",
      publicUrl: "https://cdn.example.com",
    });
    const send = vi.fn().mockResolvedValue({});
    (storage as unknown as { client: { send: typeof send } }).client = { send };
    return { storage, send };
  };

  it("deletes our objects in one batch and skips URLs from other hosts", async () => {
    const { storage, send } = make();
    await storage.remove([
      "https://cdn.example.com/posts/c1/a.jpg",
      "https://cdn.example.com/posts/c1/a_t.jpg",
      "https://other.example.com/posts/c1/x.jpg",
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]?.[0] as DeleteObjectsCommand;
    expect(cmd).toBeInstanceOf(DeleteObjectsCommand);
    expect(cmd.input).toMatchObject({
      Bucket: "bkt",
      Delete: { Objects: [{ Key: "posts/c1/a.jpg" }, { Key: "posts/c1/a_t.jpg" }], Quiet: true },
    });
  });

  it("does not call S3 at all when nothing is ours", async () => {
    const { storage, send } = make();
    await storage.remove(["https://other.example.com/a.jpg"]);
    await storage.remove([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("publishPost keeps storage in step with the database", () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createCtx();
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.$disconnect();
  });
  const keys = () => [...ctx.storage.files.keys()];

  it("re-posting deletes the replaced card and its thumbnail (they are public otherwise, forever)", async () => {
    const tg = newTgId();
    const chainId = await createChain(ctx, tg);
    const first = await postImage(ctx, tg, chainId, await solidImage({ color: "#112233" }));
    expect(first.statusCode).toBe(201);
    const oldImage = first.json().post.imageUrl as string;
    const oldThumb = first.json().post.thumbUrl as string;
    expect(() => ctx.storage.get(oldImage)).not.toThrow();

    const second = await postImage(ctx, tg, chainId, await solidImage({ color: "#445566" }));
    expect(second.statusCode).toBe(201);
    const post = second.json().post;
    expect(post.position).toBe(first.json().post.position); // position kept
    expect(post.imageUrl).not.toBe(oldImage);
    expect(() => ctx.storage.get(oldImage)).toThrow(/not stored/);
    expect(() => ctx.storage.get(oldThumb)).toThrow(/not stored/);
    expect(() => ctx.storage.get(post.imageUrl)).not.toThrow();
    expect(() => ctx.storage.get(post.thumbUrl)).not.toThrow();
    expect(keys().filter((k) => k.startsWith(`posts/${chainId}/`))).toHaveLength(2);
  });

  it("a first post deletes nothing", async () => {
    const tg = newTgId();
    const chainId = await createChain(ctx, tg);
    const before = keys().length;
    await postImage(ctx, tg, chainId, await solidImage());
    expect(keys().length).toBe(before + 2);
  });

  it("files written for a post whose database write failed are removed again", async () => {
    const tg = newTgId();
    const user = await ensureUser(ctx, tg);
    const chain = await ctx.db.chain.findUniqueOrThrow({
      where: { id: await createChain(ctx, tg) },
    });
    const storage = new MemoryStorage();
    const failing = new Proxy(ctx.db, {
      get(target, prop) {
        if (prop === "$transaction") return () => Promise.reject(new Error("db down"));
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as typeof ctx.db;
    await expect(
      publishPost(
        { db: failing, storage },
        { user, chain, image: await solidImage(), fields: { templateId: "sunset" } },
      ),
    ).rejects.toThrow("db down");
    expect(storage.files.size).toBe(0);
  });

  it("a failing cleanup is logged but never fails the post", async () => {
    const tg = newTgId();
    const user = await ensureUser(ctx, tg);
    const chain = await ctx.db.chain.findUniqueOrThrow({
      where: { id: await createChain(ctx, tg) },
    });
    class BrokenCleanup extends MemoryStorage {
      override async remove(): Promise<void> {
        throw new Error("S3 503");
      }
    }
    const storage = new BrokenCleanup();
    const deps = { db: ctx.db, storage };
    const args = { user, chain, image: await solidImage(), fields: { templateId: "sunset" } };
    await publishPost(deps, args);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const again = await publishPost(deps, args); // replaces; cleanup throws
      expect(again.position).toBe(1);
      expect(warn.mock.calls.some((c) => String(c[0]).includes("[storage]"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("uploads served from local disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "storychain-uploads-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("are cacheable forever (names are unique and never rewritten), and a replaced card is really gone", async () => {
    const storage = new LocalDiskStorage(dir, "http://test.local");
    const ctx = await createCtx({}, { storage });
    try {
      const tg = newTgId();
      const chainId = await createChain(ctx, tg);
      const first = (await postImage(ctx, tg, chainId, await solidImage())).json().post;
      const path = (url: string) => new URL(url).pathname;

      const hit = await ctx.app.inject({ url: path(first.thumbUrl) });
      expect(hit.statusCode).toBe(200);
      expect(hit.headers["content-type"]).toBe("image/jpeg");
      expect(hit.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

      await postImage(ctx, tg, chainId, await solidImage({ color: "#00aa00" }));
      expect((await ctx.app.inject({ url: path(first.thumbUrl) })).statusCode).toBe(404);
      expect((await ctx.app.inject({ url: path(first.imageUrl) })).statusCode).toBe(404);
      // and the API still works for the current card
      const detail = await ctx.app.inject({
        url: `/api/chains/${chainId}`,
        headers: authHeader(tg),
      });
      const mine = detail.json().myPost;
      expect((await ctx.app.inject({ url: path(mine.thumbUrl) })).statusCode).toBe(200);
    } finally {
      await ctx.app.close();
      await ctx.db.$disconnect();
    }
  });
});
