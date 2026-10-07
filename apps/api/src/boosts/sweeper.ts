import type { Db } from "../db";

/**
 * Flips the cached `isBoosted` flag off for chains whose boost is over.
 * Purely housekeeping: correctness NEVER depends on it (everything reads `boostedUntil > now`).
 */
export async function sweepExpiredBoosts(db: Db, now: Date = new Date()): Promise<number> {
  const r = await db.chain.updateMany({
    where: { isBoosted: true, OR: [{ boostedUntil: null }, { boostedUntil: { lte: now } }] },
    data: { isBoosted: false },
  });
  return r.count;
}

/** Runs the sweep every `intervalMs` (default 60 s) with an overlap guard. Not started in tests unless asked. */
export function startBoostSweeper(
  db: Db,
  opts: { intervalMs?: number; now?: () => Date; onError?: (e: unknown) => void } = {},
): { stop(): void; tick(): Promise<number> } {
  let running: Promise<number> | null = null;
  const tick = (): Promise<number> => {
    if (running) return running;
    running = sweepExpiredBoosts(db, opts.now?.())
      .catch((e: unknown) => {
        (opts.onError ?? ((err) => console.error("[boosts] sweep failed", err)))(e);
        return 0;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 60_000);
  timer.unref();
  return { stop: () => clearInterval(timer), tick };
}
