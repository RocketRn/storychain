import { nanoid } from "nanoid";
import type { Chain, Post, User } from "@prisma/client";
import {
  getTemplate,
  type CreatePostFields,
  type PostDTO,
  type PublicUserDTO,
} from "@storychain/shared";
import { withRetry, type Db } from "../db";
import type { Storage } from "../storage";
import { errors } from "../errors";
import { isTextAllowed } from "../moderation";
import { processUpload } from "./image";

export const toPublicUser = (u: Pick<User, "id" | "username" | "firstName">): PublicUserDTO => ({
  id: u.id,
  username: u.username,
  firstName: u.firstName,
});

export const toPostDTO = (p: Post & { user: User }, viewerId: string | null): PostDTO => ({
  id: p.id,
  chainId: p.chainId,
  position: p.position,
  imageUrl: p.imageUrl,
  thumbUrl: p.thumbUrl,
  templateId: p.templateId,
  caption: p.caption,
  watermarked: p.watermarked,
  sharedToStory: p.sharedToStory,
  createdAt: p.createdAt.toISOString(),
  user: toPublicUser(p.user),
  isMine: viewerId !== null && p.userId === viewerId,
});

export async function publishPost(
  deps: { db: Db; storage: Storage },
  args: { user: User; chain: Chain; image: Buffer; fields: CreatePostFields },
): Promise<Post & { user: User }> {
  const { db, storage } = deps;
  const { user, chain, fields } = args;

  if (!isTextAllowed(fields.caption)) throw errors.blocked();
  // Every template is free for everyone; only unknown ids are rejected.
  if (!getTemplate(fields.templateId)) throw errors.badRequest("Unknown template");

  // The clean "StoryChain" attribution badge is composited here, server side, for EVERY user
  // (the client must never bake it into the upload). There are no limits and no paid tiers on posting.
  const watermarked = true;
  const { image, thumb } = await processUpload(args.image, { watermark: watermarked });
  const id = nanoid(12);
  const [full, small] = await Promise.all([
    storage.put(`posts/${chain.id}/${id}.jpg`, image, "image/jpeg"),
    storage.put(`posts/${chain.id}/${id}_t.jpg`, thumb, "image/jpeg"),
  ]);

  return withRetry(() =>
    db.$transaction(async (tx) => {
      const data = {
        imageUrl: full.url,
        thumbUrl: small.url,
        templateId: fields.templateId,
        caption: fields.caption ?? null,
        watermarked,
        sharedToStory: false,
      };
      const existing = await tx.post.findUnique({
        where: { chainId_userId: { chainId: chain.id, userId: user.id } },
      });
      if (existing) {
        // Re-posting replaces the previous post and keeps its position.
        return tx.post.update({ where: { id: existing.id }, data, include: { user: true } });
      }
      // Increment first (takes the write lock) so concurrent joins get distinct positions.
      const updated = await tx.chain.update({
        where: { id: chain.id },
        data: { postsCount: { increment: 1 } },
        select: { postsCount: true },
      });
      return tx.post.create({
        data: { chainId: chain.id, userId: user.id, position: updated.postsCount, ...data },
        include: { user: true },
      });
    }),
  );
}
