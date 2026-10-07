import type { FastifyInstance } from "fastify";
import {
  allowedMethods,
  FREE_DAILY_LIMIT,
  PLANS,
  reportSchema,
  type PlansDTO,
  type SessionDTO,
} from "@storychain/shared";
import { fromUnits } from "@storychain/shared";
import type { Deps } from "../app";
import { requireAuth, user } from "../auth/plugin";
import { errors } from "../errors";
import { upsertTgUser, buildSession } from "../services/users";
import { validateInitData } from "../auth/initData";

export function registerMiscRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps;

  app.get("/api/health", async () => ({ ok: true }));

  app.post("/api/auth/session", { preHandler: requireAuth }, async (req): Promise<SessionDTO> => {
    // Re-validate to refresh profile/premium flag and lastSeenAt
    const raw = (req.headers.authorization ?? "").slice(4);
    const data = validateInitData(raw, config.botToken);
    const me = await upsertTgUser(db, data.user, true);
    return buildSession(db, me);
  });

  app.get("/api/me", { preHandler: requireAuth }, async (req): Promise<SessionDTO> => {
    return buildSession(db, user(req));
  });

  app.get("/api/plans", { preHandler: requireAuth }, async (req): Promise<PlansDTO> => {
    return {
      plans: Object.values(PLANS).map((p) => ({
        id: p.id,
        durationDays: p.durationDays,
        stars: { amount: String(p.starsPrice), currency: "XTR" },
        grm: {
          amount: config.ton.priceUnits.toString(),
          human: fromUnits(config.ton.priceUnits, config.ton.decimals),
          decimals: config.ton.decimals,
          symbol: "GRM",
          currency: "GRM",
        },
      })),
      methods: allowedMethods(req.platform, config.ton.allPlatforms),
      features: {
        free: ["limit", "basic_templates", "watermark"],
        pro: ["unlimited", "premium_templates", "premium_fonts", "no_watermark"],
      },
      freeDailyLimit: FREE_DAILY_LIMIT,
    };
  });

  app.post<{ Params: { id: string } }>(
    "/api/posts/:id/shared",
    { preHandler: requireAuth },
    async (req) => {
      const me = user(req);
      const post = await db.post.findUnique({ where: { id: req.params.id } });
      if (!post || post.isHidden) throw errors.notFound("Post not found");
      if (post.userId !== me.id) throw errors.forbidden();
      await db.post.update({ where: { id: post.id }, data: { sharedToStory: true } });
      return { ok: true };
    },
  );

  app.post(
    "/api/reports",
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const me = user(req);
      const body = reportSchema.parse(req.body);
      await db.report.create({
        data: {
          reporterId: me.id,
          chainId: body.chainId ?? null,
          postId: body.postId ?? null,
          reason: body.reason,
        },
      });
      reply.code(201);
      return { ok: true };
    },
  );
}
