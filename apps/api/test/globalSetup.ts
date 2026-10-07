import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

/** Creates a fresh SQLite DB with the real migrations applied. */
export default function setup() {
  dir = mkdtempSync(join(tmpdir(), "storychain-test-"));
  const url = `file:${join(dir, "test.db")}`;
  execSync("pnpm exec prisma migrate deploy", {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  process.env.TEST_DATABASE_URL = url;
  return () => rmSync(dir, { recursive: true, force: true });
}
