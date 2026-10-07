import "./polyfill";
import { Address, beginCell, type Cell } from "@ton/core";
import type { TonIntentDTO } from "@storychain/shared/light";

/** TEP-74 `transfer` op code. */
export const JETTON_TRANSFER_OP = 0x0f8a7ea5;

export interface JettonTransferParams {
  queryId: bigint;
  /** Jetton smallest units */
  amount: bigint;
  /** the merchant's OWNER address (not its Jetton wallet) */
  destination: Address;
  /** gets the excess TON back: the sender */
  responseDestination: Address;
  /** nanoTON forwarded to the destination with the transfer notification */
  forwardTonAmount: bigint;
  /** our payment reference; ends up in the notification so the backend can match the payment */
  comment: string;
}

/**
 * transfer#0f8a7ea5 query_id:uint64 amount:(VarUInteger 16) destination:MsgAddress
 *   response_destination:MsgAddress custom_payload:(Maybe ^Cell) forward_ton_amount:(VarUInteger 16)
 *   forward_payload:(Either Cell ^Cell)
 * forward_payload = Either-encoded text comment: bit 1 + ref to a cell holding `op 0x00000000` + UTF-8 text.
 */
export function buildJettonTransferBody(p: JettonTransferParams): Cell {
  return beginCell()
    .storeUint(JETTON_TRANSFER_OP, 32)
    .storeUint(p.queryId, 64)
    .storeCoins(p.amount)
    .storeAddress(p.destination)
    .storeAddress(p.responseDestination)
    .storeBit(0) // custom_payload = null
    .storeCoins(p.forwardTonAmount)
    .storeBit(1) // forward_payload stored as a reference
    .storeRef(beginCell().storeUint(0, 32).storeStringTail(p.comment).endCell())
    .endCell();
}

export function randomQueryId(): bigint {
  const a = new BigUint64Array(1);
  crypto.getRandomValues(a);
  return a[0] as bigint;
}

export interface TonConnectTransaction {
  validUntil: number;
  messages: Array<{ address: string; amount: string; payload: string }>;
}

/**
 * The request for `tonConnectUI.sendTransaction`: ONE message to the sender's own Jetton wallet carrying
 * the gas and the transfer body (base64 BOC).
 */
export function buildTransferRequest(args: {
  intent: Pick<
    TonIntentDTO,
    "reference" | "merchantAddress" | "amount" | "forwardTonAmount" | "gasAmount"
  >;
  /** the connected wallet's address (raw or friendly) */
  sender: string;
  /** the sender's Jetton wallet for the GRM master (from /api/ton/jetton-wallet) */
  jettonWallet: string;
  testOnly?: boolean;
  /** unix seconds, default now */
  now?: number;
  /** default 10 minutes */
  validForSec?: number;
  queryId?: bigint;
}): TonConnectTransaction {
  const body = buildJettonTransferBody({
    queryId: args.queryId ?? randomQueryId(),
    amount: BigInt(args.intent.amount),
    destination: Address.parse(args.intent.merchantAddress),
    responseDestination: Address.parse(args.sender),
    forwardTonAmount: BigInt(args.intent.forwardTonAmount),
    comment: args.intent.reference,
  });
  return {
    validUntil: (args.now ?? Math.floor(Date.now() / 1000)) + (args.validForSec ?? 600),
    messages: [
      {
        address: Address.parse(args.jettonWallet).toString({
          bounceable: true,
          testOnly: args.testOnly ?? false,
        }),
        amount: args.intent.gasAmount,
        payload: body.toBoc().toString("base64"),
      },
    ],
  };
}
