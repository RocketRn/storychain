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
  dailyLimit: () => new AppError("DAILY_LIMIT_REACHED", "Daily publication limit reached", 429),
  proRequired: () => new AppError("PRO_REQUIRED", "This feature requires PRO", 402),
  invalidImage: (m = "Invalid image") => new AppError("INVALID_IMAGE", m, 400),
  tooLarge: () => new AppError("PAYLOAD_TOO_LARGE", "File too large", 413),
  blocked: () => new AppError("BLOCKED_CONTENT", "Content not allowed", 400),
};
