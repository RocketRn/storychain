import type { FastifyInstance } from "fastify";
import {
  allowedMethods,
  BOOST_PLANS,
  BOOST_PLAN_IDS,
  reportSchema,
  listPostsQuerySchema,
  type MyPostDTO,
  type Page,
  type PlansDTO,
  type SessionDTO,
} from "@storychain/shared";
import { fromUnits } from "@storychain/shared";
import type { Deps } from "../app";
import { requireAuth, user } from "../auth/plugin";
import { errors } from "../errors";
import { upsertTgUser, buildSession } from "../services/users";
import { toPostDTO } from "../services/posts";
import { validateInitData } from "../auth/initData";

export function registerMiscRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps;

  app.get("/api/health", async () => ({ ok: true }));

  app.post("/api/auth/session", { preHandler: requireAuth }, async (req): Promise<SessionDTO> => {
    // Re-validate to refresh profile/premium flag and lastSeenAt
    const raw = (req.headers.authorization ?? "").slice(4);
    const data = validateInitData(raw, config.botToken, config.initDataMaxAgeSec);
    const me = await upsertTgUser(db, data.user, true);
    return buildSession(me);
  });

  app.get("/api/me", { preHandler: requireAuth }, async (req): Promise<SessionDTO> => {
    return buildSession(user(req));
  });

  app.get("/api/me/posts", { preHandler: requireAuth }, async (req): Promise<Page<MyPostDTO>> => {
    const me = user(req);
    const q = listPostsQuerySchema.parse(req.query);
    const offset = q.cursor ? Number(q.cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw errors.badRequest("Bad cursor");
    const rows = await db.post.findMany({
      where: { userId: me.id, isHidden: false, chain: { isHidden: false } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: 31,
      include: { user: true, chain: true },
    });
    return {
      items: rows.slice(0, 30).map((p) => ({
        ...toPostDTO(p, me.id),
        chain: { id: p.chain.id, title: p.chain.title, emoji: p.chain.emoji },
      })),
      nextCursor: rows.length > 30 ? String(offset + 30) : null,
    };
  });

  app.get("/api/plans", { preHandler: requireAuth }, async (req): Promise<PlansDTO> => {
    return {
      boostPlans: BOOST_PLAN_IDS.map((id) => {
        const human = fromUnits(config.boost.grmUnits[id], config.ton.decimals);
        return {
          id,
          durationHours: BOOST_PLANS[id].durationMs / 3_600_000,
          prices: {
            stars: config.boost.starsPrice[id],
            // the product label stays "GRM"; GRM_SYMBOL is the on-chain symbol
            grm: {
              amount: config.boost.grmUnits[id].toString(),
              decimals: config.ton.decimals,
              symbol: "GRM",
              display: `${human} GRM`,
            },
          },
        };
      }),
      methods: allowedMethods(req.platform, config.ton.allPlatforms),
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
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: config.rateLimits.reportsPerHour, timeWindow: "1 hour" } },
    },
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
