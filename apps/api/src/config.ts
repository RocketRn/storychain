import { z } from "zod";
import { toUnits } from "@storychain/shared";

const bool = z.enum(["true", "false"]).default("false");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DEV_MODE: bool,
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
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
  GRM_PRO_30D_PRICE: z.string().default("100"),
  TON_MERCHANT_ADDRESS: z.string().default(""),
  TON_NETWORK: z.enum(["mainnet", "testnet"]).default("mainnet"),
  TONAPI_KEY: z.string().default(""),
  TONCONNECT_MANIFEST_URL: z.string().default(""),
  TON_PAYMENTS_ALL_PLATFORMS: bool,
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = schema.parse(env);
  const devMode = e.DEV_MODE === "true";
  const isProd = e.NODE_ENV === "production";
  if (devMode && isProd) {
    throw new Error("Refusing to start: DEV_MODE=true is not allowed with NODE_ENV=production");
  }
  if (isProd) {
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
  }
  let grmPriceUnits: bigint;
  try {
    grmPriceUnits = toUnits(e.GRM_PRO_30D_PRICE, e.GRM_DECIMALS);
  } catch (err) {
    throw new Error(`Invalid GRM_PRO_30D_PRICE: ${(err as Error).message}`);
  }
  return {
    nodeEnv: e.NODE_ENV,
    isProd,
    port: e.PORT,
    devMode,
    corsOrigins: e.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    databaseUrl: e.DATABASE_URL,
    botToken: e.BOT_TOKEN || (devMode ? "000000:dev-token-change-me" : ""),
    botUsername: e.BOT_USERNAME,
    appShortName: e.APP_SHORT_NAME,
    // The bot is started only when explicitly enabled (default: on in production, off in dev/mock)
    botEnabled: (e.BOT_ENABLED ?? (isProd ? "true" : "false")) === "true",
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
    ton: {
      jettonMaster: e.GRM_JETTON_MASTER,
      decimals: e.GRM_DECIMALS,
      symbol: e.GRM_SYMBOL,
      priceHuman: e.GRM_PRO_30D_PRICE,
      priceUnits: grmPriceUnits,
      merchantAddress: e.TON_MERCHANT_ADDRESS,
      network: e.TON_NETWORK,
      apiKey: e.TONAPI_KEY,
      manifestUrl: e.TONCONNECT_MANIFEST_URL,
      allPlatforms: e.TON_PAYMENTS_ALL_PLATFORMS === "true",
    },
  };
}
