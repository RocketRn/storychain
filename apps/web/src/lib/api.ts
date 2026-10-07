import type { ApiErrorBody, ErrorCode } from "@storychain/shared/light";
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-TG-Platform": tg.platform };
  if (tg.initData) headers.Authorization = `tma ${tg.initData}`;
  const init: RequestInit = { method, headers };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError("NETWORK", "Network error", 0);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(j?.error.code ?? "INTERNAL", j?.error.message ?? res.statusText, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
};
