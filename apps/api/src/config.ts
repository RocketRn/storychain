import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DEV_MODE: z.enum(["true", "false"]).default("false"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = schema.parse(env);
  const devMode = e.DEV_MODE === "true";
  if (devMode && e.NODE_ENV === "production") {
    throw new Error("Refusing to start: DEV_MODE=true is not allowed with NODE_ENV=production");
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    devMode,
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  };
}
