import type { Chain, User } from "@prisma/client";
import type { ChainDTO } from "@storychain/shared";
import { isBoostActive } from "../boosts/core";
import { toPublicUser } from "./posts";

/**
 * Chain -> DTO. Boost state is derived from `boostedUntil > now` (never from the cached `isBoosted`).
 * Privacy: `channelUrl` is public ONLY while the chain is boosted (the creator always sees their own);
 * `boostedUntil` (the remaining time) is shown to the creator only.
 */
export function toChainDTO(
  c: Chain & { creator: User },
  opts: { now: Date; viewerId: string | null },
): ChainDTO {
  const boosted = isBoostActive(c, opts.now);
  const isCreator = opts.viewerId !== null && opts.viewerId === c.creatorId;
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    emoji: c.emoji,
    isFeatured: c.isFeatured,
    postsCount: c.postsCount,
    createdAt: c.createdAt.toISOString(),
    creator: toPublicUser(c.creator),
    isBoosted: boosted,
    boostedUntil: isCreator && boosted ? (c.boostedUntil as Date).toISOString() : null,
    channelUrl: boosted || isCreator ? c.channelUrl : null,
  };
}
