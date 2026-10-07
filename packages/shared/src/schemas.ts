import { z } from "zod";

export const CHAIN_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
export const CHAIN_ID_LENGTH = 8;
export const chainIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const createChainSchema = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300).optional(),
  emoji: z.string().trim().max(8).optional(),
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
});
export type CreatePostFields = z.infer<typeof createPostFieldsSchema>;

export const reportSchema = z
  .object({
    chainId: chainIdSchema.optional(),
    postId: z.string().min(1).max(64).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => v.chainId || v.postId, { message: "chainId or postId required" });

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function parseStartParam(sp: string | undefined | null): string | null {
  const m = /^chain_([A-Za-z0-9_-]{1,64})$/.exec(sp ?? "");
  return m?.[1] ?? null;
}

export function buildShareLink(opts: { botUsername: string; appShortName?: string; chainId: string }): string {
  const path = opts.appShortName ? `${opts.botUsername}/${opts.appShortName}` : opts.botUsername;
  return `https://t.me/${path}?startapp=chain_${opts.chainId}`;
}
