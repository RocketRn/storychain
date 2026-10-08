/** Pure helpers and constants (no zod): safe for the web bundle. */

export const CHAIN_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
export const CHAIN_ID_LENGTH = 8;
export const CHAIN_TITLE_MIN = 3;
export const CHAIN_TITLE_MAX = 80;
export const CHAIN_DESCRIPTION_MAX = 300;
export const CHAIN_EMOJI_MAX = 8;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Characters that have no business in a title, caption or description:
 *  - C0/C1 control characters (tabs and line breaks are turned into spaces first)
 *  - bidi embeddings/overrides/isolates and direction marks: an RLO inside a title reverses everything after
 *    it, e.g. the "Join: <link>" that follows the title in a story caption or the text of a Stars invoice
 *  - zero-width space, word joiner and invisible operators, BOM, Mongolian vowel separator: a title made only
 *    of these passed the length check and rendered as nothing
 * Kept on purpose: ZWJ (U+200D, emoji sequences such as families), ZWNJ (U+200C, Persian/Indic spelling),
 * variation selectors and tag characters (emoji presentation, subdivision flags).
 */
/* eslint-disable no-control-regex -- matching control characters is the point of this pattern */
const INVISIBLE =
  /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
/* eslint-enable no-control-regex */

/** NFC-normalizes, strips invisible/direction-changing characters and collapses whitespace. */
export function sanitizeText(input: string, opts: { multiline?: boolean } = {}): string {
  let s = input.normalize("NFC").replace(/\r\n?/g, "\n");
  if (!opts.multiline) s = s.replace(/[\t\n\v\f]/g, " ");
  else s = s.replace(/[\t\v\f]/g, " ");
  s = s.replace(INVISIBLE, "");
  if (!opts.multiline) return s.replace(/ {2,}/g, " ").trim();
  return s
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ChainInput {
  title: string;
  description?: string;
  emoji?: string;
  channelUrl?: string | null;
}

/**
 * Client-side mirror of `createChainSchema` (same limits; the server stays authoritative).
 * Returns the trimmed input, or null when invalid. Empty optional fields are dropped.
 */
export function normalizeChainInput(raw: {
  title: string;
  description?: string;
  emoji?: string;
  channelUrl?: string;
}): ChainInput | null {
  const title = sanitizeText(raw.title);
  const description =
    raw.description === undefined ? undefined : sanitizeText(raw.description, { multiline: true });
  const emoji = raw.emoji === undefined ? undefined : sanitizeText(raw.emoji);
  if (title.length < CHAIN_TITLE_MIN || title.length > CHAIN_TITLE_MAX) return null;
  if (description && description.length > CHAIN_DESCRIPTION_MAX) return null;
  if (emoji && emoji.length > CHAIN_EMOJI_MAX) return null;
  let channelUrl: string | null = null;
  if (raw.channelUrl !== undefined) {
    const c = parseChannelUrl(raw.channelUrl);
    if (!c.ok) return null;
    channelUrl = c.value;
  }
  return {
    title,
    ...(description ? { description } : {}),
    ...(emoji ? { emoji } : {}),
    ...(channelUrl ? { channelUrl } : {}),
  };
}

export function parseStartParam(sp: string | undefined | null): string | null {
  const m = /^chain_([A-Za-z0-9_-]{1,64})$/.exec(sp ?? "");
  return m?.[1] ?? null;
}

export function buildShareLink(opts: {
  botUsername: string;
  appShortName?: string;
  chainId: string;
}): string {
  const path = opts.appShortName ? `${opts.botUsername}/${opts.appShortName}` : opts.botUsername;
  return `https://t.me/${path}?startapp=chain_${opts.chainId}`;
}

export const CHANNEL_URL_MAX = 100;
const CHANNEL_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const INVITE_HASH = /^[A-Za-z0-9_-]{8,64}$/;
/** single path segments on t.me that are features, not channels */
const RESERVED = new Set([
  "joinchat",
  "addstickers",
  "addemoji",
  "share",
  "proxy",
  "socks",
  "setlanguage",
  "login",
  "iv",
  "c",
  "s",
  "boost",
]);

export type ChannelUrlResult = { ok: true; value: string | null } | { ok: false };

/**
 * Validates and normalizes a Telegram channel link. Accepts ONLY:
 *   t.me/<name>, https://t.me/<name>, http://t.me/<name> (-> https), @<name>,
 *   https://t.me/+<hash>, https://t.me/joinchat/<hash>
 * <name> is 5-32 chars [A-Za-z0-9_] starting with a letter. Everything else is rejected (other hosts, other schemes,
 * userinfo tricks like https://t.me@evil.com, queries/fragments, extra path segments, inner whitespace, > 100 chars).
 * Surrounding whitespace is trimmed (mobile keyboards add it); an empty string means "no channel" (value: null).
 */
export function parseChannelUrl(input: string): ChannelUrlResult {
  const raw = input.trim();
  if (raw === "") return { ok: true, value: null };
  if (raw.length > CHANNEL_URL_MAX || /\s/.test(raw)) return { ok: false };

  let path: string;
  if (raw.startsWith("@")) {
    path = raw.slice(1);
  } else {
    const m = /^(?:https?:\/\/)?t\.me\/(.+)$/i.exec(raw);
    if (!m) return { ok: false }; // also rejects javascript:, data:, other hosts and "t.me@evil.com/…"
    path = m[1] as string;
  }
  if (/[?#\\@:]/.test(path)) return { ok: false };
  if (path.endsWith("/")) path = path.slice(0, -1);

  if (path.startsWith("+")) {
    const hash = path.slice(1);
    return INVITE_HASH.test(hash) ? { ok: true, value: `https://t.me/+${hash}` } : { ok: false };
  }
  if (path.startsWith("joinchat/")) {
    const hash = path.slice("joinchat/".length);
    return INVITE_HASH.test(hash)
      ? { ok: true, value: `https://t.me/joinchat/${hash}` }
      : { ok: false };
  }
  if (path.includes("/")) return { ok: false };
  if (!CHANNEL_USERNAME.test(path) || RESERVED.has(path.toLowerCase())) return { ok: false };
  return { ok: true, value: `https://t.me/${path}` };
}

/** Throwing variant: returns the normalized URL (or null for empty input), throws on invalid input. */
export function normalizeChannelUrl(input: string): string | null {
  const r = parseChannelUrl(input);
  if (!r.ok) throw new Error("INVALID_CHANNEL_URL");
  return r.value;
}
