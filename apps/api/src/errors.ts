import type { ErrorCode } from "@storychain/shared";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export const errors = {
  badRequest: (m = "Bad request") => new AppError("BAD_REQUEST", m, 400),
  unauthorized: (m = "Unauthorized") => new AppError("UNAUTHORIZED", m, 401),
  forbidden: (m = "Forbidden") => new AppError("FORBIDDEN", m, 403),
  notFound: (m = "Not found") => new AppError("NOT_FOUND", m, 404),
  chainNotFound: () => new AppError("CHAIN_NOT_FOUND", "Chain not found", 404),
  chainNotBoostable: () =>
    new AppError("CHAIN_NOT_BOOSTABLE", "This marathon cannot be boosted", 409),
  invalidBoostPlan: () => new AppError("INVALID_BOOST_PLAN", "Unknown boost plan", 400),
  boostHorizon: () =>
    new AppError(
      "BOOST_HORIZON_EXCEEDED",
      "This marathon is already boosted far enough ahead",
      409,
    ),
  invalidChannelUrl: () =>
    new AppError("INVALID_CHANNEL_URL", "Use a t.me link or @username of a Telegram channel", 400),
  invalidImage: (m = "Invalid image") => new AppError("INVALID_IMAGE", m, 400),
  tooLarge: () => new AppError("PAYLOAD_TOO_LARGE", "File too large", 413),
  methodUnavailable: (m = "Payment method unavailable") =>
    new AppError("PAYMENT_METHOD_UNAVAILABLE", m, 503),
  methodNotAllowed: (m = "Payment method not available on this platform") =>
    new AppError("PAYMENT_METHOD_UNAVAILABLE", m, 403),
  paymentNotFound: () => new AppError("PAYMENT_NOT_FOUND", "Payment not found", 404),
  blocked: () => new AppError("BLOCKED_CONTENT", "Content not allowed", 400),
};
