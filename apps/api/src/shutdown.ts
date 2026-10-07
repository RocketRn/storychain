/**
 * Graceful shutdown for SIGINT / SIGTERM.
 *
 * Registering a signal handler REMOVES Node's default "terminate", so a handler that only stops timers leaves
 * the HTTP server running: `docker stop` / a rolling deploy then waits out its grace period and SIGKILLs the
 * process, cutting uploads and payment webhooks mid-request. This stops new work, lets in-flight requests
 * finish, closes the database and exits - with a watchdog so a stuck connection cannot hold the process forever.
 */
export interface ShutdownOptions {
  /** background producers of new work (verifier, sweeper, bot polling): stopped first */
  stop: Array<() => void | Promise<void>>;
  /** resources closed in order once nothing new is starting (HTTP server first, database last) */
  close: Array<() => void | Promise<void>>;
  exit?: (code: number) => void;
  /** hard limit before forcing the exit (default 10 s) */
  timeoutMs?: number;
  log?: (message: string, detail?: unknown) => void;
}

export function createShutdown(opts: ShutdownOptions): (signal: string) => Promise<void> {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const log = opts.log ?? ((m, d) => console.info(m, d ?? ""));
  let running: Promise<void> | null = null;

  return (signal: string) => {
    if (running) return running; // a second signal while shutting down changes nothing
    running = (async () => {
      log(`[shutdown] ${signal}: stopping`);
      let failed = false;
      const watchdog = setTimeout(() => {
        log("[shutdown] timed out, forcing exit");
        exit(1);
      }, opts.timeoutMs ?? 10_000);
      watchdog.unref();
      for (const step of [...opts.stop, ...opts.close]) {
        try {
          await step();
        } catch (e) {
          failed = true; // keep going: the remaining resources still need closing
          log("[shutdown] step failed", (e as Error).message);
        }
      }
      clearTimeout(watchdog);
      log("[shutdown] done");
      exit(failed ? 1 : 0);
    })();
    return running;
  };
}

/**
 * `app.close()` stops accepting connections and waits for the open ones. Keep-alive connections that were busy
 * when it started are not closed once they go idle, so it would sit until their keep-alive timeout (72 s in
 * Fastify). Sweeping idle connections while it runs drains in milliseconds and still never cuts a request off.
 */
export async function closeAndDrain(app: {
  close(): Promise<unknown>;
  server: { closeIdleConnections?: () => void };
}): Promise<void> {
  const sweep = setInterval(() => app.server.closeIdleConnections?.(), 50);
  try {
    await app.close();
  } finally {
    clearInterval(sweep);
  }
}
