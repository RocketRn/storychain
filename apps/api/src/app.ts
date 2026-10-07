import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import type { ApiErrorBody } from "@storychain/shared";
import type { Config } from "./config";
import type { Db } from "./db";
import { AppError } from "./errors";
import { authContext } from "./auth/plugin";
import type { Storage } from "./storage";
import { LocalDiskStorage } from "./storage/local";
import { registerChainRoutes } from "./routes/chains";
import { registerMiscRoutes } from "./routes/misc";
import { registerDevRoutes } from "./routes/dev";

export interface Deps {
  config: Config;
  db: Db;
  storage: Storage;
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const { config, db, storage } = deps;
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "test" ? "silent" : "info",
      // never log credentials: initData lives in Authorization, bot token / keys only in env
      redact: ["req.headers.authorization", "req.headers.cookie", "*.botToken", "*.apiKey"],
    },
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet, { crossOriginResourcePolicy: { policy: "cross-origin" } });
  await app.register(cors, {
    origin: config.corsOrigins,
    allowedHeaders: ["Authorization", "Content-Type", "X-TG-Platform"],
  });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  await app.register(authContext(config, db));
  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: "1 minute",
    keyGenerator: (req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`),
  });

  if (storage instanceof LocalDiskStorage) {
    mkdirSync(storage.root, { recursive: true });
    await app.register(fastifyStatic, { root: resolve(storage.root), prefix: "/uploads/" });
  }

  app.setErrorHandler((err, req, reply) => {
    const send = (status: number, code: ApiErrorBody["error"]["code"], message: string) =>
      reply.code(status).send({ error: { code, message } } satisfies ApiErrorBody);
    if (err instanceof AppError) return send(err.status, err.code, err.message);
    if (err instanceof ZodError) {
      return send(
        400,
        "BAD_REQUEST",
        err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.code === "FST_REQ_FILE_TOO_LARGE" || e.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return send(413, "PAYLOAD_TOO_LARGE", "Payload too large");
    }
    if (e.statusCode === 429) return send(429, "RATE_LIMITED", "Too many requests");
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return send(e.statusCode, "BAD_REQUEST", e.message);
    }
    req.log.error({ err }, "unhandled error");
    return send(500, "INTERNAL", "Internal server error");
  });
  app.setNotFoundHandler((_req, reply) =>
    reply
      .code(404)
      .send({ error: { code: "NOT_FOUND", message: "Route not found" } } satisfies ApiErrorBody),
  );

  registerMiscRoutes(app, deps);
  registerChainRoutes(app, deps);
  if (config.devMode && !config.isProd) registerDevRoutes(app, deps);
  return app;
}
