import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const userSchema = z.object({
  id: z.number().int(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  is_premium: z.boolean().optional(),
});
export type TgUser = z.infer<typeof userSchema>;

export interface InitData {
  user: TgUser;
  authDate: number;
  startParam?: string;
}

export class InitDataError extends Error {}

function computeHash(params: URLSearchParams, botToken: string): string {
  const entries: Array<[string, string]> = [];
  for (const [k, v] of params.entries()) if (k !== "hash") entries.push([k, v]);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const pairs = entries.map(([k, v]) => `${k}=${v}`);
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
}

/** Validates Telegram Mini App initData per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
export function validateInitData(
  raw: string,
  botToken: string,
  maxAgeSec = 3600,
  now = Date.now(),
): InitData {
  if (!raw || !botToken) throw new InitDataError("missing initData");
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) throw new InitDataError("missing hash");
  const expected = Buffer.from(computeHash(params, botToken), "hex");
  const given = Buffer.from(hash, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new InitDataError("bad hash");
  }
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) throw new InitDataError("bad auth_date");
  const ageSec = now / 1000 - authDate;
  if (ageSec > maxAgeSec) throw new InitDataError("initData expired");
  if (ageSec < -60) throw new InitDataError("auth_date in the future");
  let userJson: unknown;
  try {
    userJson = JSON.parse(params.get("user") ?? "");
  } catch {
    throw new InitDataError("bad user");
  }
  const parsed = userSchema.safeParse(userJson);
  if (!parsed.success) throw new InitDataError("bad user");
  const startParam = params.get("start_param") ?? undefined;
  return { user: parsed.data, authDate, ...(startParam ? { startParam } : {}) };
}

/** Produces correctly signed initData. Used by tests and the dev-only /api/dev/init-data endpoint. */
export function signInitData(
  user: TgUser,
  botToken: string,
  opts: { authDate?: number; startParam?: string } = {},
): string {
  const params = new URLSearchParams();
  params.set("auth_date", String(opts.authDate ?? Math.floor(Date.now() / 1000)));
  params.set("query_id", "AAHdF6IQAAAAAN0XohDhrOrc");
  params.set("user", JSON.stringify(user));
  if (opts.startParam) params.set("start_param", opts.startParam);
  params.set("hash", computeHash(params, botToken));
  return params.toString();
}
