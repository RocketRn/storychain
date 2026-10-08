/**
 * Admin script: find (and with --delete remove) local upload files no post references.
 *   pnpm --filter @storychain/api gc-uploads            # dry run: lists what would go
 *   pnpm --filter @storychain/api gc-uploads --delete
 * Only for STORAGE_DRIVER=local. With S3, use a bucket lifecycle rule or an inventory-based job instead.
 */
import { resolve } from "node:path";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db";
import { deleteUploads, findOrphanUploads } from "../src/storage/gc";

const config = loadConfig();
if (config.storage.driver !== "local") {
  console.error("gc-uploads only handles STORAGE_DRIVER=local");
  process.exit(1);
}
const root = resolve(config.storage.uploadDir);
const db = createDb(config.databaseUrl);
const orphans = await findOrphanUploads({ db, root, minAgeMs: 24 * 3_600_000 });
const mb = (orphans.reduce((n, o) => n + o.bytes, 0) / 1_048_576).toFixed(1);
for (const o of orphans) console.log(o.key);
if (process.argv.includes("--delete")) {
  await deleteUploads(
    root,
    orphans.map((o) => o.key),
  );
  console.log(`deleted ${orphans.length} orphaned files (${mb} MB)`);
} else {
  console.log(`${orphans.length} orphaned files (${mb} MB); run with --delete to remove them`);
}
await db.$disconnect();
