import { describe, expect, it } from "vitest";
import { Address, Cell } from "@ton/core";
import {
  buildJettonTransferBody,
  buildTransferRequest,
  JETTON_TRANSFER_OP,
} from "./jettonTransfer";

const merchant = new Address(0, Buffer.alloc(32, 1));
const sender = new Address(0, Buffer.alloc(32, 2));
const jettonWallet = new Address(0, Buffer.alloc(32, 3));
const intent = {
  reference: "aB3dE5fG7hJ9kL1m",
  merchantAddress: merchant.toString(),
  amount: "100000000000",
  forwardTonAmount: "10000000",
  gasAmount: "50000000",
};

function decode(base64: string) {
  const s = Cell.fromBase64(base64).beginParse();
  const out = {
    op: s.loadUint(32),
    queryId: s.loadUintBig(64),
    amount: s.loadCoins(),
    destination: s.loadAddress(),
    responseDestination: s.loadAddress(),
    hasCustomPayload: s.loadBit(),
    forwardTon: s.loadCoins(),
    forwardInRef: s.loadBit(),
    comment: "",
    commentOp: -1,
    leftover: 0,
  };
  const ref = s.loadRef().beginParse();
  out.commentOp = ref.loadUint(32);
  out.comment = ref.loadStringTail();
  out.leftover = s.remainingBits + s.remainingRefs;
  return out;
}

describe("buildTransferRequest (TEP-74 jetton transfer)", () => {
  const req = buildTransferRequest({
    intent,
    sender: sender.toString(),
    jettonWallet: jettonWallet.toRawString(),
    now: 1_700_000_000,
    queryId: 42n,
  });

  it("sends ONE message to the sender's jetton wallet with the gas amount, valid for 10 minutes", () => {
    expect(req.validUntil).toBe(1_700_000_600);
    expect(req.messages).toHaveLength(1);
    const m = req.messages[0]!;
    expect(Address.parse(m.address).equals(jettonWallet)).toBe(true);
    expect(m.address).toBe(jettonWallet.toString({ bounceable: true })); // friendly, bounceable
    expect(m.amount).toBe("50000000");
  });

  it("encodes op, query id, amount, destination, response destination and forward amount", () => {
    const d = decode(req.messages[0]!.payload);
    expect(d.op).toBe(JETTON_TRANSFER_OP);
    expect(d.op).toBe(0x0f8a7ea5);
    expect(d.queryId).toBe(42n);
    expect(d.amount).toBe(100_000_000_000n);
    expect(d.destination?.equals(merchant)).toBe(true);
    expect(d.responseDestination?.equals(sender)).toBe(true);
    expect(d.hasCustomPayload).toBe(false);
    expect(d.forwardTon).toBe(10_000_000n);
  });

  it("carries the payment reference as an Either-ref text comment (op 0 + UTF-8)", () => {
    const d = decode(req.messages[0]!.payload);
    expect(d.forwardInRef).toBe(true);
    expect(d.commentOp).toBe(0);
    expect(d.comment).toBe(intent.reference);
    expect(d.leftover).toBe(0); // nothing trailing
  });

  it("works with raw and friendly spellings of the sender, and testnet flag only changes the friendly form", () => {
    const raw = buildTransferRequest({
      intent,
      sender: sender.toRawString(),
      jettonWallet: jettonWallet.toString(),
      queryId: 1n,
    });
    expect(decode(raw.messages[0]!.payload).responseDestination?.equals(sender)).toBe(true);
    const test = buildTransferRequest({
      intent,
      sender: sender.toString(),
      jettonWallet: jettonWallet.toString(),
      queryId: 1n,
      testOnly: true,
    });
    expect(Address.parseFriendly(test.messages[0]!.address).isTestOnly).toBe(true);
  });

  it("keeps large amounts exact (no float math)", () => {
    const big = buildTransferRequest({
      intent: { ...intent, amount: "123456789012345678901234" },
      sender: sender.toString(),
      jettonWallet: jettonWallet.toString(),
      queryId: 7n,
    });
    expect(decode(big.messages[0]!.payload).amount).toBe(123456789012345678901234n);
  });

  it("body builder: a long unicode reference survives round-trip", () => {
    const body = buildJettonTransferBody({
      queryId: 1n,
      amount: 1n,
      destination: merchant,
      responseDestination: sender,
      forwardTonAmount: 1n,
      comment: "ref-Привет-✓",
    });
    expect(decode(body.toBoc().toString("base64")).comment).toBe("ref-Привет-✓");
  });

  it("carries the demanded network so a wallet on another network refuses the request", () => {
    const req = buildTransferRequest({
      intent,
      sender: sender.toString(),
      jettonWallet: jettonWallet.toString(),
      network: "-239",
    });
    expect(req.network).toBe("-239");
    expect(
      buildTransferRequest({
        intent,
        sender: sender.toString(),
        jettonWallet: jettonWallet.toString(),
      }),
    ).not.toHaveProperty("network");
  });
});
