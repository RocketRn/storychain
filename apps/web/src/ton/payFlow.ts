import type { TonIntentDTO } from "@storychain/shared/light";
import { buildTransferRequest, type TonConnectTransaction } from "./jettonTransfer";

export interface PayFlowDeps {
  api: {
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
  };
  /** TonConnect's sendTransaction: resolves with the BOC once the wallet has signed and broadcast */
  send(request: TonConnectTransaction): Promise<{ boc: string }>;
  wallet: { address: string; testnet: boolean };
}

export type PayFlowResult =
  { ok: true; reference: string } | { ok: false; reason: "no_grm" | "rejected" };

const hasStatus = (e: unknown, status: number): boolean =>
  typeof e === "object" && e !== null && (e as { status?: unknown }).status === status;

/**
 * The order of the steps is what keeps the user's money safe:
 *  1. find the payer's Jetton wallet FIRST - someone who holds no GRM must not leave an order behind
 *  2. create the order on our server, 3. let the wallet sign the transfer
 *  4. once the wallet has signed, the transfer is on its way: NOTHING after this point may report a failure,
 *     or the user would simply pay again. The confirm call is only a hint to the server to look at the chain
 *     sooner; the caller polls the order status either way.
 * API errors propagate to the caller (shown as a message); wallet refusal and "no GRM" are normal outcomes.
 */
export async function startGrmPayment(
  deps: PayFlowDeps,
  args: { chainId: string; planId: string },
): Promise<PayFlowResult> {
  let jettonWallet: string;
  try {
    ({ jettonWallet } = await deps.api.get<{ jettonWallet: string }>(
      `/api/ton/jetton-wallet?owner=${encodeURIComponent(deps.wallet.address)}`,
    ));
  } catch (e) {
    if (hasStatus(e, 404)) return { ok: false, reason: "no_grm" };
    throw e;
  }

  const intent = await deps.api.post<TonIntentDTO>("/api/payments/ton/intent", args);
  const request = buildTransferRequest({
    intent,
    sender: deps.wallet.address,
    jettonWallet,
    testOnly: deps.wallet.testnet,
  });

  let boc: string | undefined;
  try {
    boc = (await deps.send(request)).boc;
  } catch {
    return { ok: false, reason: "rejected" };
  }

  void deps.api
    .post("/api/payments/ton/confirm", { reference: intent.reference, ...(boc ? { boc } : {}) })
    .catch(() => undefined);
  return { ok: true, reference: intent.reference };
}
