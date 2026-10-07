import { errors } from "./errors";

/**
 * Keyset ("seek") cursors. A cursor holds the sort key of the last item the client has, so the next page is
 * "everything strictly after that key". Unlike OFFSET this stays correct while rows are added or re-ranked
 * (no duplicates or gaps from shifting positions) and costs O(page) instead of O(offset) on a deep page.
 *
 *   newest-first lists   <createdAtMs>.<id>
 *   trending             <postsCount>.<createdAtMs>.<id>
 *
 * Cursors are parsed strictly: anything else is a 400, never a query.
 */
const ID = "[A-Za-z0-9_-]{1,64}";
const NEWEST = new RegExp(`^(\\d{1,15})\\.(${ID})$`);
const TRENDING = new RegExp(`^(\\d{1,9})\\.(\\d{1,15})\\.(${ID})$`);

export interface NewestKey {
  createdAt: Date;
  id: string;
}
export interface TrendingKey extends NewestKey {
  postsCount: number;
}

export const encodeNewest = (k: NewestKey): string => `${k.createdAt.getTime()}.${k.id}`;
export const encodeTrending = (k: TrendingKey): string =>
  `${k.postsCount}.${k.createdAt.getTime()}.${k.id}`;

export function decodeNewest(raw: string): NewestKey {
  const m = NEWEST.exec(raw);
  if (!m) throw errors.badRequest("Bad cursor");
  return { createdAt: new Date(Number(m[1])), id: m[2] as string };
}

export function decodeTrending(raw: string): TrendingKey {
  const m = TRENDING.exec(raw);
  if (!m) throw errors.badRequest("Bad cursor");
  return { postsCount: Number(m[1]), createdAt: new Date(Number(m[2])), id: m[3] as string };
}

type AfterNewest = {
  OR: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }];
};
type AfterTrending = {
  OR: [{ postsCount: { lt: number } }, { postsCount: number; OR: AfterNewest["OR"] }];
};

/** Rows strictly after `k` in `ORDER BY createdAt DESC, id DESC` (usable in any model with those columns). */
export const afterNewest = (k: NewestKey): AfterNewest => ({
  OR: [{ createdAt: { lt: k.createdAt } }, { createdAt: k.createdAt, id: { lt: k.id } }],
});

/** Rows strictly after `k` in `ORDER BY postsCount DESC, createdAt DESC, id DESC`. */
export const afterTrending = (k: TrendingKey): AfterTrending => ({
  OR: [{ postsCount: { lt: k.postsCount } }, { postsCount: k.postsCount, OR: afterNewest(k).OR }],
});
