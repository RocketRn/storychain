/** Stable machine-readable error codes shared by API and web. */
export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "CHAIN_NOT_FOUND",
  "CHAIN_NOT_BOOSTABLE",
  "INVALID_BOOST_PLAN",
  "BOOST_HORIZON_EXCEEDED",
  "INVALID_CHANNEL_URL",
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
