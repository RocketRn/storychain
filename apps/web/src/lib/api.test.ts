import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tgState = vi.hoisted(() => ({ initData: "signed-init-data" }));
vi.mock("./tg", () => ({
  tg: {
    platform: "tdesktop",
    get initData() {
      return tgState.initData;
    },
  },
}));

import { api, ApiError, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from "./api";
import { isSessionExpired, resetSessionExpired } from "./auth";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** a fetch that never answers on its own but honors the abort signal, like the real thing */
const hang = (_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  tgState.initData = "signed-init-data";
  resetSessionExpired();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("sends the Telegram credentials and platform, and parses JSON", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    expect(await api.post("/api/x", { a: 1 })).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/x");
    expect(init.headers).toMatchObject({
      Authorization: "tma signed-init-data",
      "X-TG-Platform": "tdesktop",
      "Content-Type": "application/json",
    });
    expect(init.body).toBe('{"a":1}');
  });

  it("maps the server's error body to ApiError", async () => {
    fetchMock.mockResolvedValue(
      json(409, { error: { code: "BOOST_HORIZON_EXCEEDED", message: "far" } }),
    );
    await expect(api.get("/api/x")).rejects.toMatchObject({
      code: "BOOST_HORIZON_EXCEEDED",
      message: "far",
      status: 409,
    });
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(api.get("/api/x")).rejects.toMatchObject({ code: "INTERNAL", status: 502 });
  });

  it("a network failure is a NETWORK error with status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const err = await api.get("/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "NETWORK", status: 0 });
  });

  describe("session expiry", () => {
    it("a 401 on an authenticated call marks the session expired (screens show one clear message)", async () => {
      fetchMock.mockResolvedValue(json(401, { error: { code: "UNAUTHORIZED", message: "no" } }));
      await expect(api.get("/api/me")).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
      expect(isSessionExpired()).toBe(true);
    });

    it("other 4xx errors do not", async () => {
      for (const [status, code] of [
        [403, "FORBIDDEN"],
        [404, "NOT_FOUND"],
        [429, "RATE_LIMITED"],
      ] as const) {
        fetchMock.mockResolvedValue(json(status, { error: { code, message: "x" } }));
        await expect(api.get("/api/x")).rejects.toMatchObject({ status });
      }
      expect(isSessionExpired()).toBe(false);
    });

    it("without any credentials a 401 is not 'expired' (nothing was ever valid)", async () => {
      tgState.initData = "";
      fetchMock.mockResolvedValue(json(401, { error: { code: "UNAUTHORIZED", message: "no" } }));
      await expect(api.get("/api/me")).rejects.toMatchObject({ status: 401 });
      expect(isSessionExpired()).toBe(false);
    });
  });

  describe("timeouts", () => {
    it("gives up on a request that never answers", async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(hang);
      const result = api.get("/api/x").catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({ code: "NETWORK", status: 0 });
    });

    it("also gives up when the response starts but the body stalls", async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async (_url: unknown, init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
      }));
      const result = api.get("/api/x").catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      expect(await result).toMatchObject({ code: "NETWORK" });
    });

    it("uploads get a longer budget than ordinary calls", async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(hang);
      let settled = false;
      const result = api
        .post("/api/chains/x/posts", new FormData())
        .catch((e: unknown) => e)
        .finally(() => (settled = true));
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);
      expect(await result).toMatchObject({ code: "NETWORK" });
    });

    it("a fast answer cancels the timer (nothing fires later)", async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(json(200, {}));
      await api.get("/api/x");
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
