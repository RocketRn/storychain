import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { LEGACY } from "./legacy";

// Node's built-in SQLite (no CLI needed). Loaded through require so the bundler leaves "node:sqlite" alone.
interface Sqlite {
  exec(sql: string): void;
  prepare(sql: string): { all(): Array<Record<string, unknown>> };
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (file: string) => Sqlite;
};

const migrationsDir = join(new URL("..", import.meta.url).pathname, "prisma", "migrations");
const dir = mkdtempSync(join(tmpdir(), "storychain-migration-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const sqlOf = (name: string) => readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");

describe("boosts_pivot migration", () => {
  const names = readdirSync(migrationsDir)
    .filter((n) => /^\d+_/.test(n))
    .sort();
  const pivot = names.find((n) => n.endsWith("_boosts_pivot")) as string;

  it("exists and sorts after init", () => {
    expect(pivot).toBeDefined();
    expect(names.indexOf(pivot)).toBeGreaterThan(0);
  });

  it("expires legacy pending PRO orders, keeps paid ones as history, keeps users/chains/posts", () => {
    const db = new DatabaseSync(join(dir, "legacy.db"));
    const all = (q: string) => db.prepare(q).all();
    const one = (q: string) => Object.values(all(q)[0] ?? {}).join("|");
    // everything BEFORE the pivot
    for (const name of names.slice(0, names.indexOf(pivot))) db.exec(sqlOf(name));

    // a legacy world: a PRO user with a paid and a pending PRO order, plus a chain, a post and usage rows
    db.exec(
      `INSERT INTO "User"(id,telegramId,firstName,${LEGACY.userColumn}) VALUES ('u1',1,'Old', 4102444800000)`,
    );
    db.exec(`INSERT INTO "Chain"(id,title,creatorId) VALUES ('chain001','Old chain','u1')`);
    db.exec(
      `INSERT INTO "Post"(id,chainId,userId,position,imageUrl,thumbUrl,templateId,watermarked) VALUES ('p1','chain001','u1',1,'i','t','sunset',1)`,
    );
    const tx = (id: string, status: string, plan: string, ref: string) =>
      db.exec(
        `INSERT INTO "Transaction"(id,userId,provider,planId,status,amount,currency,reference,expiresAt) VALUES ('${id}','u1','stars','${plan}','${status}','150','XTR','${ref}',4102444800000)`,
      );
    tx("t_pending", "pending", LEGACY.plan, "ref-pending");
    tx("t_paid", "paid", LEGACY.plan, "ref-paid");
    tx("t_other", "pending", "boost_24h", "ref-other"); // not a legacy plan: untouched
    db.exec(
      `INSERT INTO "${LEGACY.usageTable}"(id,userId,day,count) VALUES ('d1','u1','2026-01-01',3)`,
    );
    expect(one(`SELECT status FROM "Transaction" WHERE id='t_pending'`)).toBe("pending"); // sanity: really legacy

    db.exec(sqlOf(pivot)); // the migration under test

    expect(one(`SELECT status FROM "Transaction" WHERE id='t_pending'`)).toBe("expired");
    expect(one(`SELECT status FROM "Transaction" WHERE id='t_paid'`)).toBe("paid");
    expect(one(`SELECT status FROM "Transaction" WHERE id='t_other'`)).toBe("pending");
    expect(one(`SELECT planId FROM "Transaction" WHERE id='t_paid'`)).toBe(LEGACY.plan); // history kept as is
    expect(one(`SELECT count(*) FROM "User"`)).toBe("1");
    expect(one(`SELECT count(*) FROM "Post"`)).toBe("1");
    expect(
      one(`SELECT title, isBoosted, boostedUntil IS NULL FROM "Chain" WHERE id='chain001'`),
    ).toBe("Old chain|0|1");
    expect(one(`SELECT chainId IS NULL FROM "Transaction" WHERE id='t_paid'`)).toBe("1"); // legacy rows: nullable chainId
    const userCols = all(`SELECT name FROM pragma_table_info('User')`).map((r) => r.name);
    expect(userCols).not.toContain(LEGACY.userColumn);
    expect(
      one(
        `SELECT count(*) FROM sqlite_master WHERE name IN ('${LEGACY.usageTable}','${LEGACY.subscriptionTable}')`,
      ),
    ).toBe("0");
    expect(one(`SELECT count(*) FROM sqlite_master WHERE name='ChainBoost'`)).toBe("1");
    expect(
      one(`SELECT count(*) FROM sqlite_master WHERE name='Chain_isBoosted_boostedUntil_idx'`),
    ).toBe("1");
    db.close();
  });

  it("is idempotent where it matters: re-running the legacy UPDATE changes nothing", () => {
    const db = new DatabaseSync(join(dir, "legacy.db"));
    const before = JSON.stringify(
      db.prepare(`SELECT id,status FROM "Transaction" ORDER BY id`).all(),
    );
    db.exec(
      `UPDATE "Transaction" SET "status" = 'expired' WHERE "status" = 'pending' AND "planId" = '${LEGACY.plan}';`,
    );
    expect(
      JSON.stringify(db.prepare(`SELECT id,status FROM "Transaction" ORDER BY id`).all()),
    ).toBe(before);
    db.close();
  });

  it("the migrated schema matches the Prisma schema (client works against it)", async () => {
    const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL as string });
    const chain = await db.chain.findFirst({
      select: { channelUrl: true, isBoosted: true, boostedUntil: true },
    });
    expect(chain === null || typeof chain.isBoosted === "boolean").toBe(true);
    await db.$disconnect();
  });
});
