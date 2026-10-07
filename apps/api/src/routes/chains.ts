import type { FastifyInstance } from "fastify";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import type { Chain, User } from "@prisma/client";
import {
  CHAIN_ID_ALPHABET,
  CHAIN_ID_LENGTH,
  chainIdSchema,
  createChainSchema,
  createPostFieldsSchema,
  listChainsQuerySchema,
  listPostsQuerySchema,
  patchChainSchema,
  MAX_UPLOAD_BYTES,
  buildShareLink,
  type ChainDetailDTO,
  type ChainDTO,
  type CreatePostResultDTO,
  type Page,
  type PostDTO,
} from "@storychain/shared";
import type { Deps } from "../app";
import { requireAuth, user } from "../auth/plugin";
import { errors } from "../errors";
import { isTextAllowed } from "../moderation";
import {
  afterNewest,
  afterTrending,
  decodeNewest,
  decodeTrending,
  encodeNewest,
  encodeTrending,
} from "../pagination";
import { publishPost, toPostDTO } from "../services/posts";
import { toChainDTO } from "../services/chains";

const newChainId = customAlphabet(CHAIN_ID_ALPHABET, CHAIN_ID_LENGTH);
const PAGE = 20;

export function shareLinkFor(deps: Deps, chainId: string): string {
  return buildShareLink({
    botUsername: deps.config.botUsername,
    ...(deps.config.appShortName ? { appShortName: deps.config.appShortName } : {}),
    chainId,
  });
}

export function registerChainRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, storage, config } = deps;
  const now = (): Date => deps.now?.() ?? new Date();

  async function visibleChain(id: string): Promise<Chain & { creator: User }> {
    const parsed = chainIdSchema.safeParse(id);
    const chain = parsed.success
      ? await db.chain.findUnique({ where: { id }, include: { creator: true } })
      : null;
    if (!chain || chain.isHidden) throw errors.notFound("Chain not found");
    return chain;
  }

  async function postsPage(
    chainId: string,
    cursor: string | undefined,
    viewerId: string,
  ): Promise<Page<PostDTO>> {
    const before = cursor ? Number(cursor) : undefined;
    if (cursor !== undefined && !Number.isInteger(before)) throw errors.badRequest("Bad cursor");
    const rows = await db.post.findMany({
      where: {
        chainId,
        isHidden: false,
        ...(before !== undefined ? { position: { lt: before } } : {}),
      },
      orderBy: { position: "desc" },
      take: PAGE + 1,
      include: { user: true },
    });
    const items = rows.slice(0, PAGE).map((p) => toPostDTO(p, viewerId));
    return {
      items,
      nextCursor: rows.length > PAGE ? String(items[items.length - 1]?.position) : null,
    };
  }

  // Public (no auth): minimal info for link previews / landing.
  app.get<{ Params: { id: string } }>("/api/chains/:id/public", async (req) => {
    const c = await visibleChain(req.params.id);
    return { id: c.id, title: c.title, emoji: c.emoji, postsCount: c.postsCount };
  });

  // Home carousel: ACTIVE boosts only (boostedUntil > now), newest boost end first. Registered as a static
  // route so it never collides with /api/chains/:id.
  app.get("/api/chains/boosted", { preHandler: requireAuth }, async (req): Promise<ChainDTO[]> => {
    const me = user(req);
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(10).default(10) })
      .parse(req.query);
    const t = now();
    const rows = await db.chain.findMany({
      where: { isHidden: false, boostedUntil: { gt: t } },
      orderBy: [{ boostedUntil: "desc" }, { id: "desc" }],
      take: limit,
      include: { creator: true },
    });
    return rows.map((c) => toChainDTO(c, { now: t, viewerId: me.id }));
  });

  // Chains I created ("My marathons" on the profile): the creator sees channelUrl / boost end
  app.get("/api/me/chains", { preHandler: requireAuth }, async (req): Promise<Page<ChainDTO>> => {
    const me = user(req);
    const q = listPostsQuerySchema.parse(req.query);
    const rows = await db.chain.findMany({
      where: {
        creatorId: me.id,
        isHidden: false,
        ...(q.cursor ? afterNewest(decodeNewest(q.cursor)) : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE + 1,
      include: { creator: true },
    });
    const t = now();
    const items = rows.slice(0, PAGE);
    const last = items.at(-1);
    return {
      items: items.map((c) => toChainDTO(c, { now: t, viewerId: me.id })),
      nextCursor: rows.length > PAGE && last ? encodeNewest(last) : null,
    };
  });

  app.get("/api/chains", { preHandler: requireAuth }, async (req): Promise<Page<ChainDTO>> => {
    const me = user(req);
    const q = listChainsQuerySchema.parse(req.query);
    const trending = q.sort === "trending";
    const orderBy = trending
      ? [{ postsCount: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }]
      : [{ createdAt: "desc" as const }, { id: "desc" as const }];
    const after = q.cursor
      ? trending
        ? afterTrending(decodeTrending(q.cursor))
        : afterNewest(decodeNewest(q.cursor))
      : {};
    const rows = await db.chain.findMany({
      where: { isHidden: false, ...(q.sort === "featured" ? { isFeatured: true } : {}), ...after },
      orderBy,
      take: PAGE + 1,
      include: { creator: true },
    });
    const items = rows.slice(0, PAGE);
    const last = items.at(-1);
    return {
      items: items.map((c) => toChainDTO(c, { now: now(), viewerId: me.id })),
      nextCursor:
        rows.length > PAGE && last ? (trending ? encodeTrending(last) : encodeNewest(last)) : null,
    };
  });

  app.post(
    "/api/chains",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: config.rateLimits.chainsPerHour, timeWindow: "1 hour" } },
    },
    async (req, reply): Promise<ChainDTO> => {
      const me = user(req);
      const body = createChainSchema.parse(req.body);
      if (!isTextAllowed(body.title, body.description)) throw errors.blocked();
      const chain = await db.chain.create({
        data: {
          id: newChainId(),
          title: body.title,
          description: body.description ?? null,
          emoji: body.emoji ?? null,
          channelUrl: body.channelUrl ?? null, // already normalized by the schema; stored but private until boosted
          creatorId: me.id,
        },
        include: { creator: true },
      });
      reply.code(201);
      return toChainDTO(chain, { now: now(), viewerId: me.id });
    },
  );

  // Creator-only edit. The title is intentionally not editable (it is printed on cards already shared).
  app.patch<{ Params: { id: string } }>(
    "/api/chains/:id",
    { preHandler: requireAuth },
    async (req): Promise<ChainDTO> => {
      const me = user(req);
      const chain = await visibleChain(req.params.id);
      if (chain.creatorId !== me.id)
        throw errors.forbidden("Only the creator can edit this marathon");
      const body = patchChainSchema.parse(req.body);
      if (!isTextAllowed(body.description)) throw errors.blocked();
      const updated = await db.chain.update({
        where: { id: chain.id },
        data: {
          ...(body.channelUrl !== undefined ? { channelUrl: body.channelUrl } : {}),
          ...(body.emoji !== undefined ? { emoji: body.emoji || null } : {}),
          ...(body.description !== undefined ? { description: body.description || null } : {}),
        },
        include: { creator: true },
      });
      return toChainDTO(updated, { now: now(), viewerId: me.id });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/chains/:id",
    { preHandler: requireAuth },
    async (req): Promise<ChainDetailDTO> => {
      const me = user(req);
      const chain = await visibleChain(req.params.id);
      // independent of each other: run them together
      const [mine, posts] = await Promise.all([
        db.post.findUnique({
          where: { chainId_userId: { chainId: chain.id, userId: me.id } },
          include: { user: true },
        }),
        postsPage(chain.id, undefined, me.id),
      ]);
      return {
        chain: toChainDTO(chain, { now: now(), viewerId: me.id }),
        posts,
        hasJoined: !!mine,
        myPosition: mine?.position ?? null,
        myPost: mine && !mine.isHidden ? toPostDTO(mine, me.id) : null,
        shareLink: shareLinkFor(deps, chain.id),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/chains/:id/posts",
    { preHandler: requireAuth },
    async (req): Promise<Page<PostDTO>> => {
      const me = user(req);
      const chain = await visibleChain(req.params.id);
      const q = listPostsQuerySchema.parse(req.query);
      return postsPage(chain.id, q.cursor, me.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/chains/:id/posts",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: config.rateLimits.postsPerMin, timeWindow: "1 minute" } },
    },
    async (req, reply): Promise<CreatePostResultDTO> => {
      const me = user(req);
      const chain = await visibleChain(req.params.id);
      if (!req.isMultipart()) throw errors.badRequest("multipart/form-data required");

      const fields: Record<string, string> = {};
      let image: Buffer | undefined;
      for await (const part of req.parts({
        limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
      })) {
        if (part.type === "file") {
          if (part.fieldname !== "image") {
            part.file.resume();
            continue;
          }
          const buf = await part.toBuffer();
          if (part.file.truncated) throw errors.tooLarge();
          image = buf;
        } else if (typeof part.value === "string") {
          fields[part.fieldname] = part.value;
        }
      }
      if (!image) throw errors.badRequest("image is required");
      const parsed = createPostFieldsSchema.parse(fields);

      const post = await publishPost({ db, storage }, { user: me, chain, image, fields: parsed });
      reply.code(201);
      return {
        post: toPostDTO(post, me.id),
        publicImageUrl: post.imageUrl,
        shareLink: shareLinkFor(deps, chain.id),
      };
    },
  );
}
