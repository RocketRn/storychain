import type { ApiErrorBody, ErrorCode } from "@storychain/shared/light";
import { markSessionExpired } from "./auth";
import { tg } from "./tg";

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode | "NETWORK",
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const BASE = import.meta.env.VITE_API_URL ?? "";

/** A request that has not answered by now never will (mobile networks drop instead of failing). */
export const REQUEST_TIMEOUT_MS = 15_000;
/** Card uploads are a couple of MB over a possibly slow connection. */
export const UPLOAD_TIMEOUT_MS = 60_000;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-TG-Platform": tg.platform };
  if (tg.initData) headers.Authorization = `tma ${tg.initData}`;
  const init: RequestInit = { method, headers };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  // AbortController + timer rather than AbortSignal.timeout: older Telegram WebViews lack the latter.
  // The timer covers reading the body too, so a stalled response cannot hang a screen forever.
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(),
    body instanceof FormData ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
  );
  try {
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal });
    } catch {
      throw new ApiError("NETWORK", "Network error", 0);
    }
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      const err = (j as ApiErrorBody | null)?.error;
      if (res.status === 401 && tg.initData) markSessionExpired();
      throw new ApiError(err?.code ?? "INTERNAL", err?.message ?? res.statusText, res.status);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError(
        ctrl.signal.aborted ? "NETWORK" : "INTERNAL",
        "Unreadable response",
        res.status,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
};
