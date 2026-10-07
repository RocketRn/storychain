import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { webhookCallback, type Bot } from "grammy";
import { ZodError } from "zod";
import type { ApiErrorBody } from "@storychain/shared";
import type { Config } from "./config";
import type { Db } from "./db";
import { AppError, errors } from "./errors";
import { authContext } from "./auth/plugin";
import type { Storage } from "./storage";
import { LocalDiskStorage } from "./storage/local";
import { registerChainRoutes } from "./routes/chains";
import { registerMiscRoutes } from "./routes/misc";
import { registerDevRoutes } from "./routes/dev";
import { registerPaymentRoutes } from "./routes/payments";
import type { TonIndexer } from "./payments/tonIndexer";
import type { TonVerifier } from "./payments/tonVerifier";
import type { CreateInvoiceLink } from "./payments/stars";

export interface Deps {
  config: Config;
  db: Db;
  storage: Storage;
  /** Telegram bot; when present and BOT_MODE=webhook, updates are accepted on /api/telegram/webhook */
  bot?: Bot;
  /** TON indexer (TonAPI by default); absent in mock mode */
  indexer?: TonIndexer;
  verifier?: TonVerifier;
  /** override of the Stars invoice-link creator (tests) */
  createInvoiceLink?: CreateInvoiceLink;
  /** destination for the structured log (tests); default stdout */
  logStream?: { write(msg: string): void };
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const { config, db, storage } = deps;
  const webIndex = config.serveWeb ? join(config.webDistDir, "index.html") : null;
  if (webIndex && !existsSync(webIndex)) {
    throw new Error(
      `SERVE_WEB is on but ${webIndex} does not exist. Run "pnpm build" first (or set SERVE_WEB=false).`,
    );
  }
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "test" && !deps.logStream ? "silent" : "info",
      // never log credentials: initData lives in Authorization, bot token / keys only in env
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.botToken",
        "*.apiKey",
        "*.initData",
      ],
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
    bodyLimit: 256 * 1024,
    trustProxy: config.trustProxy,
  });

  await app.register(
    helmet,
    config.serveWeb
      ? {
          crossOriginResourcePolicy: { policy: "cross-origin" },
          // Telegram Web embeds Mini Apps in an iframe: allow it via CSP frame-ancestors instead of X-Frame-Options
          frameguard: false,
          contentSecurityPolicy: {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "https://telegram.org"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "blob:", "https:"],
              // TonConnect talks to wallet bridges / lists over https and event streams
              connectSrc: ["'self'", "https:", "wss:"],
              fontSrc: ["'self'"],
              frameAncestors: ["'self'", "https://web.telegram.org", "https://*.telegram.org"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              upgradeInsecureRequests: config.inProduction ? [] : null,
            },
          },
        }
      : { crossOriginResourcePolicy: { policy: "cross-origin" } },
  );
  await app.register(cors, {
    origin: config.corsOrigins,
    allowedHeaders: ["Authorization", "Content-Type", "X-TG-Platform"],
  });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  await app.register(authContext(config, db));
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimits.globalPerMin,
    timeWindow: "1 minute",
    keyGenerator: (req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`),
    // only the API is rate limited; static assets (many files per page load, shared NAT IPs) are not
    allowList: (req) => !req.url.startsWith("/api/"),
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
      // channelUrl failures carry their own stable code
      if (err.issues.some((i) => i.message === "INVALID_CHANNEL_URL")) {
        return send(400, "INVALID_CHANNEL_URL", errors.invalidChannelUrl().message);
      }
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
    // anti-abuse only: never worded or shaped like a quota or a paywall
    if (e.statusCode === 429)
      return send(
        429,
        "RATE_LIMITED",
        "You're going a bit fast. Please wait a moment and try again.",
      );
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return send(e.statusCode, "BAD_REQUEST", e.message);
    }
    req.log.error({ err }, "unhandled error");
    return send(500, "INTERNAL", "Internal server error");
  });
  const indexHtml = webIndex ? readFileSync(webIndex, "utf8") : null;
  app.setNotFoundHandler((req, reply) => {
    // Single-origin mode: client-side routes (/chain/abc, /pro, ...) get the SPA shell
    if (
      indexHtml &&
      req.method === "GET" &&
      !req.url.startsWith("/api/") &&
      !req.url.startsWith("/uploads/")
    ) {
      return reply
        .code(200)
        .header("cache-control", "no-cache")
        .type("text/html; charset=utf-8")
        .send(indexHtml);
    }
    return reply
      .code(404)
      .send({ error: { code: "NOT_FOUND", message: "Route not found" } } satisfies ApiErrorBody);
  });

  if (config.serveWeb) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      prefix: "/",
      decorateReply: false, // the uploads registration above owns sendFile
      index: ["index.html"],
      cacheControl: false,
      setHeaders(res, path) {
        // hashed build assets never change; everything else (index.html, manifest, icons) must revalidate
        res.setHeader(
          "cache-control",
          /[\\/]assets[\\/]/.test(path)
            ? "public, max-age=31536000, immutable"
            : path.includes("fonts")
              ? "public, max-age=86400"
              : "no-cache",
        );
        // wallets fetch the TonConnect manifest cross-origin
        if (path.endsWith("tonconnect-manifest.json"))
          res.setHeader("access-control-allow-origin", "*");
      },
    });
  }

  registerMiscRoutes(app, deps);
  registerChainRoutes(app, deps);
  registerPaymentRoutes(app, deps);
  if (config.devMode && !config.inProduction) registerDevRoutes(app, deps);
  if (deps.bot && config.botMode === "webhook") {
    // grammY verifies the X-Telegram-Bot-Api-Secret-Token header against `secretToken`
    app.post(
      "/api/telegram/webhook",
      { config: { rateLimit: false } },
      webhookCallback(deps.bot, "fastify", { secretToken: config.webhookSecret }),
    );
  }
  return app;
}
