import {
  TON_CHAIN_ID,
  type JettonWalletDTO,
  type TonIntentDTO,
  type TonNetwork,
} from "@storychain/shared/light";
import { buildTransferRequest, type TonConnectTransaction } from "./jettonTransfer";

export interface PayFlowDeps {
  api: {
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
  };
  /** TonConnect's sendTransaction: resolves with the BOC once the wallet has signed and broadcast */
  send(request: TonConnectTransaction): Promise<{ boc: string }>;
  /** the connected wallet: its address and the network it is on (TonConnect CHAIN id) */
  wallet: { address: string; chain: string };
}

export type PayFlowResult =
  | { ok: true; reference: string }
  | { ok: false; reason: "no_grm" | "rejected" }
  /** the wallet is on another network than the one the server watches: a transfer there would never be seen */
  | { ok: false; reason: "wrong_network"; expected: TonNetwork };

const hasStatus = (e: unknown, status: number): boolean =>
  typeof e === "object" && e !== null && (e as { status?: unknown }).status === status;

/**
 * The order of the steps is what keeps the user's money safe:
 *  1. find the payer's Jetton wallet FIRST - someone who holds no GRM, or whose wallet sits on the wrong
 *     network, must not leave an order behind
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
  let found: Pick<JettonWalletDTO, "jettonWallet"> & { network?: TonNetwork };
  try {
    found = await deps.api.get<typeof found>(
      `/api/ton/jetton-wallet?owner=${encodeURIComponent(deps.wallet.address)}`,
    );
  } catch (e) {
    if (hasStatus(e, 404)) return { ok: false, reason: "no_grm" };
    throw e;
  }
  const { jettonWallet, network } = found;
  if (network && deps.wallet.chain !== TON_CHAIN_ID[network])
    return { ok: false, reason: "wrong_network", expected: network };

  const intent = await deps.api.post<TonIntentDTO>("/api/payments/ton/intent", args);
  // the order is authoritative about the network; the lookup's answer only exists to fail before ordering
  const net = intent.network ?? network;
  const request = buildTransferRequest({
    intent,
    sender: deps.wallet.address,
    jettonWallet,
    testOnly: net === "testnet",
    ...(net ? { network: TON_CHAIN_ID[net] } : {}),
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
