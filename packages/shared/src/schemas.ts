import { z } from "zod";
import {
  CHAIN_DESCRIPTION_MAX,
  CHAIN_EMOJI_MAX,
  CHAIN_TITLE_MAX,
  CHAIN_TITLE_MIN,
} from "./helpers";

export const chainIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const createChainSchema = z.object({
  title: z.string().trim().min(CHAIN_TITLE_MIN).max(CHAIN_TITLE_MAX),
  description: z.string().trim().max(CHAIN_DESCRIPTION_MAX).optional(),
  emoji: z.string().trim().max(CHAIN_EMOJI_MAX).optional(),
});
export type CreateChainInput = z.infer<typeof createChainSchema>;

export const listChainsQuerySchema = z.object({
  sort: z.enum(["trending", "new", "featured"]).default("trending"),
  cursor: z.string().max(64).optional(),
});

export const listPostsQuerySchema = z.object({
  cursor: z.string().max(64).optional(),
});

/** Non-file fields of POST /chains/:id/posts */
export const createPostFieldsSchema = z.object({
  templateId: z.string().min(1).max(64),
  caption: z.string().trim().max(200).optional(),
  /** Font used on the card (premium fonts require PRO; the card itself is rendered client-side). */
  fontFamily: z.string().max(40).optional(),
});
export type CreatePostFields = z.infer<typeof createPostFieldsSchema>;

export const reportSchema = z
  .object({
    chainId: chainIdSchema.optional(),
    postId: z.string().min(1).max(64).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => v.chainId || v.postId, { message: "chainId or postId required" });

export const planIdSchema = z.enum(["pro_30d"]);
export const createPaymentSchema = z.object({ planId: planIdSchema });
export const tonConfirmSchema = z.object({
  reference: z.string().regex(/^[A-Za-z0-9]{8,32}$/),
  /** optional BOC returned by the wallet; informational only (never trusted for verification) */
  boc: z.string().max(8192).optional(),
});
