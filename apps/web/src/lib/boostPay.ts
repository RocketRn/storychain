import type { BoostPlanDTO } from "@storychain/shared/light";

/** Props shared by the two GRM payment panels (real TonConnect flow / mock simulation). */
export interface PayPanelProps {
  plan: BoostPlanDTO;
  chainId: string;
  /** validates + saves the channel link first; resolves false when the user has to fix something */
  prepare: () => Promise<boolean>;
  /** called with the new order reference to start server-side polling */
  onStarted: (reference: string, timeoutMs: number) => void;
  onError: (message: string) => void;
  disabled: boolean;
}

export const STARS_POLL_MS = 20_000;
export const TON_POLL_MS = 150_000;
