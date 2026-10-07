import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { User } from "@prisma/client";
import type { Config } from "../config";
import type { Db } from "../db";
import { errors } from "../errors";
import { upsertTgUser } from "../services/users";
import { InitDataError, validateInitData } from "./initData";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
    platform: string;
  }
}

/**
 * Global onRequest hook: if a valid `Authorization: tma <initData>` header is present, sets request.user.
 * Registered BEFORE the rate-limit plugin so limits can be keyed by user id.
 * Enforcement is done by the `requireAuth` preHandler on routes.
 */
export const authContext = (config: Config, db: Db) =>
  fp(async (app: FastifyInstance) => {
    app.decorateRequest("user", null);
    app.decorateRequest("platform", "unknown");
    app.addHook("onRequest", async (req) => {
      req.platform = String(req.headers["x-tg-platform"] ?? "unknown").slice(0, 16);
      const header = req.headers.authorization;
      if (!header?.startsWith("tma ")) return;
      try {
        const data = validateInitData(header.slice(4), config.botToken, config.initDataMaxAgeSec);
        req.user = await upsertTgUser(db, data.user, false);
      } catch (e) {
        if (!(e instanceof InitDataError)) throw e;
        req.user = null;
      }
    });
  });

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!req.user) throw errors.unauthorized("Invalid or missing initData");
}

export function user(req: FastifyRequest): User {
  if (!req.user) throw errors.unauthorized();
  return req.user;
}
