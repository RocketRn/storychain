import { PrismaClient } from "@prisma/client";

export type Db = PrismaClient;

/**
 * SQLite allows a single writer; with several pooled connections concurrent write transactions
 * fail with SQLITE_BUSY. Force a single connection for file: URLs so writes queue up instead.
 */
export function createDb(url: string): Db {
  let u = url;
  if (u.startsWith("file:") && !u.includes("connection_limit")) {
    u += `${u.includes("?") ? "&" : "?"}connection_limit=1`;
  }
  return new PrismaClient({ datasourceUrl: u });
}

const TRANSIENT = new Set(["P2002", "P2034", "P1008"]);

/** Retries a DB transaction on transient conflicts (unique race on upsert, write conflicts, timeouts). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (i >= attempts || !code || !TRANSIENT.has(code)) throw e;
    }
  }
}
