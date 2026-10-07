import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config";
import { buildApp, type Deps } from "../src/app";
import { createDb, type Db } from "../src/db";
import { signInitData } from "../src/auth/initData";
import type { Storage } from "../src/storage";

export const BOT_TOKEN = "123456:test-bot-token";

export class MemoryStorage implements Storage {
  files = new Map<string, Buffer>();
  async put(key: string, buffer: Buffer): Promise<{ url: string }> {
    this.files.set(key, buffer);
    return { url: `http://test.local/${key}` };
  }
  get(url: string): Buffer {
    const b = this.files.get(url.replace("http://test.local/", ""));
    if (!b) throw new Error(`not stored: ${url}`);
    return b;
  }
}

export interface TestCtx {
  app: FastifyInstance;
  db: Db;
  storage: MemoryStorage;
  config: Deps["config"];
}

export async function createCtx(
  env: Record<string, string> = {},
  extra: Partial<Deps> = {},
): Promise<TestCtx> {
  const config = loadConfig({
    NODE_ENV: "test",
    DEV_MODE: "true",
    BOT_TOKEN,
    PUBLIC_BASE_URL: "http://test.local",
    // anti-abuse limits are high here so "many free posts" tests can never trip them;
    // a dedicated test lowers them on purpose
    RATE_LIMIT_GLOBAL_PER_MIN: "100000",
    RATE_LIMIT_POSTS_PER_MIN: "100000",
    RATE_LIMIT_CHAINS_PER_HOUR: "100000",
    RATE_LIMIT_REPORTS_PER_HOUR: "100000",
    RATE_LIMIT_PAYMENTS_PER_MIN: "100000",
    ...env,
  } as NodeJS.ProcessEnv);
  const db = createDb(process.env.TEST_DATABASE_URL as string);
  const storage = new MemoryStorage();
  const app = await buildApp({ config, db, storage, ...extra });
  await app.ready();
  return { app, db, storage, config };
}

let nextId = 5_000_000 + Math.floor(Math.random() * 1_000_000);
export const newTgId = (): number => nextId++;

export function authHeader(
  tgId: number,
  opts: { premium?: boolean; authDate?: number } = {},
): { authorization: string } {
  const raw = signInitData(
    {
      id: tgId,
      first_name: `User${tgId}`,
      username: `u${tgId}`,
      language_code: "en",
      is_premium: opts.premium ?? false,
    },
    BOT_TOKEN,
    opts.authDate !== undefined ? { authDate: opts.authDate } : {},
  );
  return { authorization: `tma ${raw}` };
}

export async function solidImage(
  opts: { w?: number; h?: number; format?: "jpeg" | "png" | "gif"; color?: string } = {},
): Promise<Buffer> {
  const img = sharp({
    create: {
      width: opts.w ?? 1080,
      height: opts.h ?? 1920,
      channels: 3,
      background: opts.color ?? "#c81e1e",
    },
  });
  if (opts.format === "png") return img.png().toBuffer();
  if (opts.format === "gif") return img.gif().toBuffer();
  return img.jpeg({ quality: 95 }).toBuffer();
}

export async function multipart(
  image: Buffer | undefined,
  fields: Record<string, string>,
  mime = "image/jpeg",
): Promise<{ payload: Buffer; headers: Record<string, string> }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (image) fd.append("image", new Blob([new Uint8Array(image)], { type: mime }), "card.jpg");
  const res = new Response(fd);
  return {
    payload: Buffer.from(await res.arrayBuffer()),
    headers: { "content-type": res.headers.get("content-type") as string },
  };
}

export async function createChain(
  ctx: TestCtx,
  tgId: number,
  title = "Show your cat",
): Promise<string> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/chains",
    headers: authHeader(tgId),
    payload: { title },
  });
  if (res.statusCode !== 201) throw new Error(`createChain failed: ${res.body}`);
  return res.json().id as string;
}

export async function postImage(
  ctx: TestCtx,
  tgId: number,
  chainId: string,
  image: Buffer | undefined,
  fields: Record<string, string> = { templateId: "sunset" },
  opts: { mime?: string; premium?: boolean } = {},
) {
  const { payload, headers } = await multipart(image, fields, opts.mime);
  return ctx.app.inject({
    method: "POST",
    url: `/api/chains/${chainId}/posts`,
    headers: { ...authHeader(tgId, opts.premium ? { premium: true } : {}), ...headers },
    payload,
  });
}

/** Mean absolute per-channel difference between two same-size images over a region. */
export async function regionDiff(
  a: Buffer,
  b: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const [ra, rb] = await Promise.all(
    [a, b].map((x) => sharp(x).extract(region).removeAlpha().raw().toBuffer()),
  );
  let sum = 0;
  for (let i = 0; i < (ra as Buffer).length; i++)
    sum += Math.abs((ra as Buffer)[i]! - (rb as Buffer)[i]!);
  return sum / (ra as Buffer).length;
}

/** A fresh user row (created through the real auth path) */
export async function ensureUser(ctx: TestCtx, tgId: number) {
  await ctx.app.inject({ url: "/api/me", headers: authHeader(tgId) });
  return ctx.db.user.findUniqueOrThrow({ where: { telegramId: BigInt(tgId) } });
}
