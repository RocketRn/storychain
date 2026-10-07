/** Stable machine-readable error codes shared by API and web. */
export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "DAILY_LIMIT_REACHED",
  "PRO_REQUIRED",
  "INVALID_IMAGE",
  "PAYLOAD_TOO_LARGE",
  "BLOCKED_CONTENT",
  "PAYMENT_NOT_FOUND",
  "PAYMENT_METHOD_UNAVAILABLE",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}
