/** Pure helpers and constants (no zod): safe for the web bundle. */

export const CHAIN_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
export const CHAIN_ID_LENGTH = 8;
export const CHAIN_TITLE_MIN = 3;
export const CHAIN_TITLE_MAX = 80;
export const CHAIN_DESCRIPTION_MAX = 300;
export const CHAIN_EMOJI_MAX = 8;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export interface ChainInput {
  title: string;
  description?: string;
  emoji?: string;
}

/**
 * Client-side mirror of `createChainSchema` (same limits; the server stays authoritative).
 * Returns the trimmed input, or null when invalid. Empty optional fields are dropped.
 */
export function normalizeChainInput(raw: {
  title: string;
  description?: string;
  emoji?: string;
}): ChainInput | null {
  const title = raw.title.trim();
  const description = raw.description?.trim();
  const emoji = raw.emoji?.trim();
  if (title.length < CHAIN_TITLE_MIN || title.length > CHAIN_TITLE_MAX) return null;
  if (description && description.length > CHAIN_DESCRIPTION_MAX) return null;
  if (emoji && emoji.length > CHAIN_EMOJI_MAX) return null;
  return { title, ...(description ? { description } : {}), ...(emoji ? { emoji } : {}) };
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
