export interface UserDTO {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
  languageCode: string | null;
  isTgPremium: boolean;
}

export interface PublicUserDTO {
  id: string;
  username: string | null;
  firstName: string;
}

export interface ChainDTO {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  isFeatured: boolean;
  postsCount: number;
  createdAt: string;
  creator: PublicUserDTO;
  /** computed server-side as `boostedUntil > now` (the cached DB flag is never trusted alone) */
  isBoosted: boolean;
  /** only meaningful to the creator in the UI; public clients must not show the remaining time */
  boostedUntil: string | null;
  /**
   * Normalized t.me link of the creator's channel. Public ONLY while the chain is boosted;
   * the creator always sees their own.
   */
  channelUrl: string | null;
}

export interface PostDTO {
  id: string;
  chainId: string;
  position: number;
  imageUrl: string;
  thumbUrl: string;
  templateId: string;
  caption: string | null;
  watermarked: boolean;
  sharedToStory: boolean;
  createdAt: string;
  user: PublicUserDTO;
  isMine: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SessionDTO {
  user: UserDTO;
}

export interface ChainDetailDTO {
  chain: ChainDTO;
  posts: Page<PostDTO>;
  hasJoined: boolean;
  /** position of the viewer's post in this chain (kept when re-posting), null if not joined */
  myPosition: number | null;
  /** the viewer's own post (to share again without re-posting), null if not joined */
  myPost: PostDTO | null;
  /** deep link `https://t.me/<bot>?startapp=chain_<id>` */
  shareLink: string;
}

export interface CreatePostResultDTO {
  post: PostDTO;
  publicImageUrl: string;
  shareLink: string;
}

export interface BoostPlanDTO {
  id: string;
  durationHours: number;
  prices: {
    stars: number;
    grm: { amount: string; decimals: number; symbol: string; display: string };
  };
}

export interface PlansDTO {
  boostPlans: BoostPlanDTO[];
  /** payment methods allowed for the caller's platform */
  methods: Array<"stars" | "ton_grm">;
}

export type PaymentStatus = "pending" | "paid" | "failed" | "expired" | "refunded";

export interface StarsInvoiceDTO {
  invoiceUrl: string;
  reference: string;
  chainId: string;
  planId: string;
}

/** Everything the client needs to build the TEP-74 Jetton transfer. Amounts are smallest-unit strings. */
export interface TonIntentDTO {
  reference: string;
  chainId: string;
  planId: string;
  jettonMaster: string;
  merchantAddress: string;
  amount: string;
  decimals: number;
  /** nanoTON forwarded with the transfer notification (so the merchant wallet sees the comment) */
  forwardTonAmount: string;
  /** nanoTON attached to the message sent to the user's Jetton wallet (gas) */
  gasAmount: string;
  expiresAt: string;
}

export interface PaymentStatusDTO {
  reference: string;
  provider: string;
  planId: string;
  status: PaymentStatus;
  amount: string;
  currency: string;
  expiresAt: string;
  paidAt: string | null;
  chainId: string | null;
  /** the chain's current `boostedUntil` (null if not boosted) */
  boostedUntil: string | null;
}

/** A post in "my posts" with its chain, for the Profile screen. */
export interface MyPostDTO extends PostDTO {
  chain: { id: string; title: string; emoji: string | null };
}
