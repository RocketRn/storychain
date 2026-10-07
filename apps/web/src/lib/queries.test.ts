import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { createQueryClient, flattenPages, shouldRetry } from "./queries";
import { isSessionExpired, markSessionExpired, resetSessionExpired } from "./auth";
import { isPermanentPollError, nextPollDelay } from "../hooks/usePaymentPolling";

const err = (status: number) => new ApiError(status === 0 ? "NETWORK" : "INTERNAL", "x", status);

describe("shouldRetry", () => {
  it("retries network failures and 5xx twice, then gives up", () => {
    for (const status of [0, 500, 502, 503]) {
      expect(shouldRetry(0, err(status)), String(status)).toBe(true);
      expect(shouldRetry(1, err(status))).toBe(true);
      expect(shouldRetry(2, err(status))).toBe(false);
    }
  });

  it("never retries a 4xx: it is the server's answer (expired session, not found, slow down...)", () => {
    for (const status of [400, 401, 403, 404, 409, 429]) {
      expect(shouldRetry(0, err(status)), String(status)).toBe(false);
    }
  });

  it("retries errors it does not understand (a thrown TypeError is most likely transient)", () => {
    expect(shouldRetry(0, new TypeError("boom"))).toBe(true);
    expect(shouldRetry(2, new TypeError("boom"))).toBe(false);
  });

  it("is what the app's query client uses", () => {
    const defaults = createQueryClient().getDefaultOptions().queries;
    expect(defaults?.retry).toBe(shouldRetry);
    expect(defaults?.staleTime).toBe(15_000);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
  });
});

describe("flattenPages", () => {
  const page = (...ids: string[]) => ({ items: ids.map((id) => ({ id })) });
  it("concatenates pages in order", () => {
    expect(flattenPages([page("a", "b"), page("c")]).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(flattenPages(undefined)).toEqual([]);
    expect(flattenPages([])).toEqual([]);
  });
  it("drops repeats (rankings move while scrolling) and keeps the first occurrence", () => {
    const out = flattenPages([
      {
        items: [
          { id: "a", n: 1 },
          { id: "b", n: 1 },
        ],
      },
      {
        items: [
          { id: "b", n: 2 },
          { id: "c", n: 2 },
        ],
      },
    ]);
    expect(out).toEqual([
      { id: "a", n: 1 },
      { id: "b", n: 1 },
      { id: "c", n: 2 },
    ]);
  });
});

describe("payment polling schedule", () => {
  it("backs off from 1.5 s up to a 6 s ceiling", () => {
    const seq = [1500];
    for (let i = 0; i < 8; i++) seq.push(nextPollDelay(seq.at(-1) as number));
    expect(seq.slice(0, 4)).toEqual([1500, 2100, 2940, 4116]);
    expect(Math.max(...seq)).toBe(6000);
    expect(seq.at(-1)).toBe(6000);
    // 150 s of TON waiting costs ~30 requests instead of 100
    let t = 0;
    let n = 0;
    for (let d = 1500; t < 150_000; d = nextPollDelay(d)) {
      t += d;
      n++;
    }
    expect(n).toBeLessThan(35);
  });

  it("stops on answers that cannot change, keeps going on transient ones", () => {
    for (const status of [400, 401, 403, 404]) expect(isPermanentPollError(err(status))).toBe(true);
    for (const status of [0, 408, 429, 500, 503])
      expect(isPermanentPollError(err(status))).toBe(false);
    expect(isPermanentPollError(new Error("x"))).toBe(false);
  });
});

describe("session expiry store", () => {
  it("flips once and tells subscribers", () => {
    resetSessionExpired();
    expect(isSessionExpired()).toBe(false);
    markSessionExpired();
    markSessionExpired();
    expect(isSessionExpired()).toBe(true);
    resetSessionExpired();
    expect(isSessionExpired()).toBe(false);
  });
});
