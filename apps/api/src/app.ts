import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { Config } from "./config";

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "test" ? "silent" : "info",
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    bodyLimit: 1024 * 1024,
  });
  await app.register(helmet);
  await app.register(cors, { origin: config.corsOrigins, credentials: false });

  app.get("/api/health", async () => ({ ok: true }));
  return app;
}
