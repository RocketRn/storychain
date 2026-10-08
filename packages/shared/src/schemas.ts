import { z } from "zod";
import {
  CHAIN_DESCRIPTION_MAX,
  CHAIN_EMOJI_MAX,
  CHAIN_TITLE_MAX,
  CHAIN_TITLE_MIN,
  CHANNEL_URL_MAX,
  parseChannelUrl,
  sanitizeText,
} from "./helpers";

/** Visible text: sanitized (see sanitizeText) BEFORE the length limits are checked. */
const line = (min: number, max: number) =>
  z
    .string()
    .transform((v) => sanitizeText(v))
    .pipe(z.string().min(min).max(max));
const block = (min: number, max: number) =>
  z
    .string()
    .transform((v) => sanitizeText(v, { multiline: true }))
    .pipe(z.string().min(min).max(max));

export const chainIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Raw string in, normalized `string | null` out ("" -> null). Failing issues carry the message INVALID_CHANNEL_URL. */
export const channelUrlSchema = z
  .string()
  .max(CHANNEL_URL_MAX + 20, "INVALID_CHANNEL_URL") // let the parser decide on the real limit after trimming
  .transform((v, ctx): string | null => {
    const r = parseChannelUrl(v);
    if (!r.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "INVALID_CHANNEL_URL" });
      return z.NEVER;
    }
    return r.value;
  });

export const createChainSchema = z.object({
  title: line(CHAIN_TITLE_MIN, CHAIN_TITLE_MAX),
  description: block(0, CHAIN_DESCRIPTION_MAX).optional(),
  emoji: line(0, CHAIN_EMOJI_MAX).optional(),
  channelUrl: channelUrlSchema.optional(),
});

/** Creator-only edit. The title is NOT editable: it is printed on already shared cards. */
export const patchChainSchema = z
  .object({
    channelUrl: channelUrlSchema.nullable().optional(),
    emoji: line(0, CHAIN_EMOJI_MAX).nullable().optional(),
    description: block(0, CHAIN_DESCRIPTION_MAX).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type PatchChainInput = z.infer<typeof patchChainSchema>;
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
  caption: line(0, 200).optional(),
});
export type CreatePostFields = z.infer<typeof createPostFieldsSchema>;

export const reportSchema = z
  .object({
    chainId: chainIdSchema.optional(),
    postId: z.string().min(1).max(64).optional(),
    reason: block(3, 500),
  })
  .refine((v) => v.chainId || v.postId, { message: "chainId or postId required" });

/** Boost purchase. `planId` is validated by the route against BOOST_PLANS (-> INVALID_BOOST_PLAN). */
export const createPaymentSchema = z.object({
  chainId: chainIdSchema,
  planId: z.string().min(1).max(32),
});
export const tonConfirmSchema = z.object({
  reference: z.string().regex(/^[A-Za-z0-9]{8,32}$/),
  /** optional BOC returned by the wallet; informational only (never trusted for verification) */
  boc: z.string().max(8192).optional(),
});
