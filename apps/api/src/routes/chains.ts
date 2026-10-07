import type { FastifyInstance } from "fastify";
import { customAlphabet } from "nanoid";
import type { Chain, User } from "@prisma/client";
import {
  CHAIN_ID_ALPHABET,
  CHAIN_ID_LENGTH,
  chainIdSchema,
  createChainSchema,
  createPostFieldsSchema,
  listChainsQuerySchema,
  listPostsQuerySchema,
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
import { publishPost, toPostDTO, toPublicUser } from "../services/posts";

const newChainId = customAlphabet(CHAIN_ID_ALPHABET, CHAIN_ID_LENGTH);
const PAGE = 20;

const toChainDTO = (c: Chain & { creator: User }): ChainDTO => ({
  id: c.id,
  title: c.title,
  description: c.description,
  emoji: c.emoji,
  isFeatured: c.isFeatured,
  postsCount: c.postsCount,
  createdAt: c.createdAt.toISOString(),
  creator: toPublicUser(c.creator),
});

export function shareLinkFor(deps: Deps, chainId: string): string {
  return buildShareLink({
    botUsername: deps.config.botUsername,
    ...(deps.config.appShortName ? { appShortName: deps.config.appShortName } : {}),
    chainId,
  });
}

export function registerChainRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, storage } = deps;

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

  app.get("/api/chains", { preHandler: requireAuth }, async (req): Promise<Page<ChainDTO>> => {
    const q = listChainsQuerySchema.parse(req.query);
    const offset = q.cursor ? Number(q.cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw errors.badRequest("Bad cursor");
    const orderBy =
      q.sort === "new"
        ? [{ createdAt: "desc" as const }, { id: "desc" as const }]
        : q.sort === "featured"
          ? [{ createdAt: "desc" as const }, { id: "desc" as const }]
          : [
              { postsCount: "desc" as const },
              { createdAt: "desc" as const },
              { id: "desc" as const },
            ];
    const rows = await db.chain.findMany({
      where: { isHidden: false, ...(q.sort === "featured" ? { isFeatured: true } : {}) },
      orderBy,
      skip: offset,
      take: PAGE + 1,
      include: { creator: true },
    });
    return {
      items: rows.slice(0, PAGE).map(toChainDTO),
      nextCursor: rows.length > PAGE ? String(offset + PAGE) : null,
    };
  });

  app.post(
    "/api/chains",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
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
          creatorId: me.id,
        },
        include: { creator: true },
      });
      reply.code(201);
      return toChainDTO(chain);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/chains/:id",
    { preHandler: requireAuth },
    async (req): Promise<ChainDetailDTO> => {
      const me = user(req);
      const chain = await visibleChain(req.params.id);
      const mine = await db.post.findUnique({
        where: { chainId_userId: { chainId: chain.id, userId: me.id } },
        select: { id: true },
      });
      return {
        chain: toChainDTO(chain),
        posts: await postsPage(chain.id, undefined, me.id),
        hasJoined: !!mine,
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
      config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
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
