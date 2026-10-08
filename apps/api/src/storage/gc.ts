import { readdir, rm, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Db } from "../db";

/**
 * Upload files that no post references. The request path already deletes replaced cards and files whose
 * database write failed; what is left are files of a process that died between writing them and committing
 * the post. Matched by storage KEY ("posts/<chain>/<file>"), not by full URL, so a change of
 * PUBLIC_BASE_URL can never make every file look orphaned. Files younger than `minAgeMs` are never touched:
 * an upload in progress writes its files a moment before its post exists.
 */
export async function findOrphanUploads(args: {
  db: Db;
  root: string;
  minAgeMs: number;
  now?: number;
}): Promise<Array<{ key: string; bytes: number }>> {
  const now = args.now ?? Date.now();
  const referenced = new Set<string>();
  const keyOf = (url: string) => {
    const i = url.indexOf("/uploads/");
    return i === -1 ? null : url.slice(i + "/uploads/".length);
  };
  // stream the references in pages so a large table does not have to fit in one query result
  let cursor: string | undefined;
  for (;;) {
    const page = await args.db.post.findMany({
      select: { id: true, imageUrl: true, thumbUrl: true },
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const p of page)
      for (const k of [keyOf(p.imageUrl), keyOf(p.thumbUrl)]) if (k) referenced.add(k);
    if (page.length < 1000) break;
    cursor = page[page.length - 1]?.id;
  }

  const orphans: Array<{ key: string; bytes: number }> = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // nothing uploaded yet
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        const key = relative(args.root, full).split(sep).join("/");
        if (referenced.has(key)) continue;
        const st = await stat(full);
        if (now - st.mtimeMs >= args.minAgeMs) orphans.push({ key, bytes: st.size });
      }
    }
  };
  await walk(join(args.root, "posts")); // only the area this app writes to
  return orphans;
}

export async function deleteUploads(root: string, keys: string[]): Promise<void> {
  for (const key of keys) {
    const target = join(root, key);
    if (!target.startsWith(root + sep)) continue;
    await rm(target, { force: true });
  }
}
