import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db";
import { closeAndDrain, createShutdown } from "../src/shutdown";
import { BOT_TOKEN, MemoryStorage } from "./helpers";

afterEach(() => vi.useRealTimers());
const quiet = () => undefined;

describe("createShutdown", () => {
  it("stops background work first, then closes resources in order, then exits 0", async () => {
    const order: string[] = [];
    const exit = vi.fn((code: number) => void order.push(`exit ${code}`));
    const shutdown = createShutdown({
      stop: [() => void order.push("verifier"), async () => void order.push("sweeper")],
      close: [async () => void order.push("http"), () => void order.push("db")],
      exit,
      log: quiet,
    });
    await shutdown("SIGTERM");
    expect(order).toEqual(["verifier", "sweeper", "http", "db", "exit 0"]);
  });

  it("a failing step does not skip the ones after it, and the exit code says so", async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const shutdown = createShutdown({
      stop: [
        () => {
          throw new Error("verifier stuck");
        },
      ],
      close: [
        async () => {
          order.push("http");
          throw new Error("close failed");
        },
        () => void order.push("db"),
      ],
      exit,
      log: quiet,
    });
    await shutdown("SIGINT");
    expect(order).toEqual(["http", "db"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("repeated signals share one shutdown", async () => {
    const closed = vi.fn();
    const exit = vi.fn();
    const shutdown = createShutdown({ stop: [], close: [closed], exit, log: quiet });
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT"), shutdown("SIGTERM")]);
    await shutdown("SIGTERM");
    expect(closed).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("forces the exit when a step hangs (a stuck connection must not hold the process forever)", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const shutdown = createShutdown({
      stop: [],
      close: [() => new Promise(() => undefined)],
      exit,
      timeoutMs: 5_000,
      log: quiet,
    });
    void shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("the watchdog is cancelled on a clean shutdown (no second exit)", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    await createShutdown({ stop: [], close: [], exit, timeoutMs: 1_000, log: quiet })("SIGTERM");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});

describe("with a real HTTP server", () => {
  it("finishes the request that is in flight, then stops accepting connections", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DEV_MODE: "true",
      BOT_TOKEN,
      PUBLIC_BASE_URL: "http://test.local",
    } as NodeJS.ProcessEnv);
    const db = createDb(process.env.TEST_DATABASE_URL as string);
    const app = await buildApp({ config, db, storage: new MemoryStorage() });
    app.get("/__slow", async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { done: true };
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

    const exit = vi.fn();
    const shutdown = createShutdown({
      stop: [],
      close: [() => closeAndDrain(app), () => db.$disconnect()],
      exit,
      log: quiet,
    });
    const inFlight = fetch(`${base}/__slow`).then((r) => r.json());
    await new Promise((r) => setTimeout(r, 50)); // the request is being served
    const finished = shutdown("SIGTERM");

    expect(await inFlight).toEqual({ done: true }); // not cut off
    await finished;
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    await expect(fetch(`${base}/api/health`)).rejects.toThrow(); // nothing listens any more
  });
});
