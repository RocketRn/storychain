import { resolve } from "node:path";
import { z } from "zod";
import { BOOST_PLANS, toUnits, type BoostPlanId } from "@storychain/shared";

const bool = z.enum(["true", "false"]).default("false");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DEV_MODE: bool,
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  /** Serve the built web app (apps/web/dist) from this process: single-origin mode. Default: on in production. */
  SERVE_WEB: z.enum(["true", "false"]).optional(),
  WEB_DIST_DIR: z.string().default(""),
  /** Behind a reverse proxy / tunnel: trust X-Forwarded-* so rate limits see the real client IP */
  TRUST_PROXY: bool,
  /** DEV_MODE exposes /api/dev/* and a public signing key: it is refused on non-local URLs unless this is set */
  ALLOW_REMOTE_DEV_MODE: bool,
  /** How long Telegram initData is accepted after its auth_date (seconds) */
  INITDATA_MAX_AGE_SEC: z.coerce
    .number()
    .int()
    .min(60)
    .max(7 * 86400)
    .default(86400),
  DATABASE_URL: z.string().default("file:./dev.db"),
  BOT_TOKEN: z.string().default(""),
  BOT_USERNAME: z.string().default("storychain_bot"),
  APP_SHORT_NAME: z.string().default(""),
  BOT_ENABLED: z.enum(["true", "false"]).optional(),
  BOT_MODE: z.enum(["polling", "webhook"]).default("polling"),
  WEBHOOK_URL: z.string().default(""),
  WEBHOOK_SECRET: z.string().default(""),
  WEBAPP_URL: z.string().default("http://localhost:5173"),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  UPLOAD_DIR: z.string().default("./uploads"),
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_PUBLIC_URL: z.string().default(""),
  GRM_JETTON_MASTER: z.string().default("EQC47093oX5Xhb0xuk2lCr2RhS8rj-vul61u4W2UH5ORmG_O"),
  GRM_DECIMALS: z.coerce.number().int().min(0).max(18).default(9),
  GRM_SYMBOL: z.string().default("GRAM"),
  /** PLACEHOLDER prices: the owner must set the real ones. GRM amounts are human-readable strings (no floats). */
  GRM_BOOST_24H_PRICE: z.string().default("50"),
  GRM_BOOST_7D_PRICE: z.string().default("250"),
  STARS_BOOST_24H_PRICE: z.coerce
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(BOOST_PLANS.boost_24h.starsPrice),
  STARS_BOOST_7D_PRICE: z.coerce
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(BOOST_PLANS.boost_7d.starsPrice),
  /** A boost may never extend further than this many days into the future (stacking guard) */
  BOOST_MAX_HORIZON_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Anti-abuse rate limits (NOT business quotas). Per authenticated user, per window. */
  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().min(1).default(240),
  RATE_LIMIT_POSTS_PER_MIN: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_CHAINS_PER_HOUR: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_REPORTS_PER_HOUR: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_PAYMENTS_PER_MIN: z.coerce.number().int().min(1).default(10),
  TON_MERCHANT_ADDRESS: z.string().default(""),
  TON_NETWORK: z.enum(["mainnet", "testnet"]).default("mainnet"),
  TONAPI_KEY: z.string().default(""),
  TONCONNECT_MANIFEST_URL: z.string().default(""),
  TON_PAYMENTS_ALL_PLATFORMS: bool,
});

export type Config = ReturnType<typeof loadConfig>;

/** What a BotFather token looks like: `<bot id>:<35 url-safe chars>`. The shipped placeholders do not match. */
const BOT_TOKEN_SHAPE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const LOCAL_HOSTNAME = /^(localhost|127\.0\.0\.1|\[::1\]|[^.]+\.localhost)$/i;

function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTNAME.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env) {
  // `KEY=` in a .env file means "not set": fall back to the default instead of failing validation
  const env = Object.fromEntries(Object.entries(rawEnv).filter(([, v]) => v !== ""));
  const e = schema.parse(env);
  const devMode = e.DEV_MODE === "true";
  const inProduction = e.NODE_ENV === "production";
  if (devMode && inProduction) {
    throw new Error("Refusing to start: DEV_MODE=true is not allowed with NODE_ENV=production");
  }
  // Mock mode has dev-only endpoints that mint valid initData, and a placeholder bot token whose HMAC key is
  // public. That is fine on a laptop and catastrophic on a public host that merely forgot NODE_ENV=production.
  if (devMode && e.NODE_ENV !== "test" && e.ALLOW_REMOTE_DEV_MODE !== "true") {
    for (const [key, value] of [
      ["WEBAPP_URL", e.WEBAPP_URL],
      ["PUBLIC_BASE_URL", e.PUBLIC_BASE_URL],
    ] as const) {
      if (!isLocalUrl(value)) {
        throw new Error(
          `Refusing to start: DEV_MODE=true enables unauthenticated /api/dev/* endpoints, but ${key} (${value}) is not a local address. Use DEV_MODE=false for anything reachable from outside, or set ALLOW_REMOTE_DEV_MODE=true to override.`,
        );
      }
    }
  }
  const botEnabled = (e.BOT_ENABLED ?? (inProduction ? "true" : "false")) === "true";
  if (inProduction) {
    const missing: string[] = [];
    const required: Array<keyof typeof e> = [
      "BOT_TOKEN",
      "BOT_USERNAME",
      "TON_MERCHANT_ADDRESS",
      "GRM_JETTON_MASTER",
      "TONAPI_KEY",
      "TONCONNECT_MANIFEST_URL",
      "WEBAPP_URL",
    ];
    for (const k of required) if (!e[k]) missing.push(k);
    if (e.BOT_MODE === "webhook") {
      for (const k of ["WEBHOOK_URL", "WEBHOOK_SECRET"] as const) if (!e[k]) missing.push(k);
    }
    if (e.STORAGE_DRIVER === "s3") {
      for (const k of [
        "S3_BUCKET",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "S3_PUBLIC_URL",
      ] as const) {
        if (!e[k]) missing.push(k);
      }
    }
    if (missing.length)
      throw new Error(`Missing required env in production: ${missing.join(", ")}`);
    if (!e.PUBLIC_BASE_URL.startsWith("https://")) {
      throw new Error("PUBLIC_BASE_URL must be a public HTTPS URL in production");
    }
    // Telegram only opens https web_app buttons and wallets only fetch an https TonConnect manifest
    for (const k of ["WEBAPP_URL", "TONCONNECT_MANIFEST_URL"] as const) {
      if (!e[k].startsWith("https://")) throw new Error(`${k} must be an HTTPS URL in production`);
    }
    // initData is verified with an HMAC keyed by the bot token: a placeholder token means anyone can forge logins
    if (!BOT_TOKEN_SHAPE.test(e.BOT_TOKEN)) {
      throw new Error(
        "BOT_TOKEN does not look like a BotFather token (<id>:<35 characters>). Refusing to start with a placeholder: its signing key would be public.",
      );
    }
  }
  // An update endpoint without a secret would let anyone forge Telegram updates, including successful_payment
  if (botEnabled && e.BOT_MODE === "webhook") {
    for (const k of ["WEBHOOK_URL", "WEBHOOK_SECRET"] as const) {
      if (!e[k]) throw new Error(`BOT_MODE=webhook requires ${k}`);
    }
  }
  const grmHuman: Record<BoostPlanId, string> = {
    boost_24h: e.GRM_BOOST_24H_PRICE,
    boost_7d: e.GRM_BOOST_7D_PRICE,
  };
  const grmUnits = {} as Record<BoostPlanId, bigint>;
  for (const [id, human] of Object.entries(grmHuman) as Array<[BoostPlanId, string]>) {
    try {
      grmUnits[id] = toUnits(human, e.GRM_DECIMALS);
    } catch (err) {
      throw new Error(`Invalid GRM_${id.toUpperCase()}_PRICE: ${(err as Error).message}`);
    }
    if (grmUnits[id] <= 0n)
      throw new Error(`GRM_${id.toUpperCase()}_PRICE must be greater than zero`);
  }
  return {
    nodeEnv: e.NODE_ENV,
    inProduction,
    port: e.PORT,
    devMode,
    corsOrigins: e.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    serveWeb: (e.SERVE_WEB ?? (inProduction ? "true" : "false")) === "true",
    webDistDir: resolve(e.WEB_DIST_DIR || "../web/dist"),
    trustProxy: e.TRUST_PROXY === "true",
    initDataMaxAgeSec: e.INITDATA_MAX_AGE_SEC,
    databaseUrl: e.DATABASE_URL,
    botToken: e.BOT_TOKEN || (devMode ? "000000:dev-token-change-me" : ""),
    botUsername: e.BOT_USERNAME,
    appShortName: e.APP_SHORT_NAME,
    // The bot is started only when explicitly enabled (default: on in production, off in dev/mock)
    botEnabled,
    botMode: e.BOT_MODE,
    webhookUrl: e.WEBHOOK_URL,
    webhookSecret: e.WEBHOOK_SECRET,
    webappUrl: e.WEBAPP_URL,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/$/, ""),
    storage: {
      driver: e.STORAGE_DRIVER,
      uploadDir: e.UPLOAD_DIR,
      s3: {
        endpoint: e.S3_ENDPOINT,
        region: e.S3_REGION,
        bucket: e.S3_BUCKET,
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
        publicUrl: e.S3_PUBLIC_URL.replace(/\/$/, ""),
      },
    },
    boost: {
      starsPrice: {
        boost_24h: e.STARS_BOOST_24H_PRICE,
        boost_7d: e.STARS_BOOST_7D_PRICE,
      } as Record<BoostPlanId, number>,
      grmHuman,
      grmUnits,
      maxHorizonMs: e.BOOST_MAX_HORIZON_DAYS * 86_400_000,
    },
    rateLimits: {
      globalPerMin: e.RATE_LIMIT_GLOBAL_PER_MIN,
      postsPerMin: e.RATE_LIMIT_POSTS_PER_MIN,
      chainsPerHour: e.RATE_LIMIT_CHAINS_PER_HOUR,
      reportsPerHour: e.RATE_LIMIT_REPORTS_PER_HOUR,
      paymentsPerMin: e.RATE_LIMIT_PAYMENTS_PER_MIN,
    },
    ton: {
      jettonMaster: e.GRM_JETTON_MASTER,
      decimals: e.GRM_DECIMALS,
      symbol: e.GRM_SYMBOL,
      merchantAddress: e.TON_MERCHANT_ADDRESS,
      network: e.TON_NETWORK,
      apiKey: e.TONAPI_KEY,
      manifestUrl: e.TONCONNECT_MANIFEST_URL,
      allPlatforms: e.TON_PAYMENTS_ALL_PLATFORMS === "true",
    },
  };
}
