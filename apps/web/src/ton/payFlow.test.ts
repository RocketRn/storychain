import { describe, expect, it, vi } from "vitest";
import { Address } from "@ton/core";
import { startGrmPayment, type PayFlowDeps } from "./payFlow";

const merchant = new Address(0, Buffer.alloc(32, 1));
const payer = new Address(0, Buffer.alloc(32, 2)).toRawString();
const jettonWallet = new Address(0, Buffer.alloc(32, 3)).toRawString();
const intent = {
  reference: "aB3dE5fG7hJ9kL1m",
  chainId: "chain001",
  planId: "boost_24h",
  jettonMaster: "EQ...",
  merchantAddress: merchant.toString(),
  amount: "100000000000",
  decimals: 9,
  forwardTonAmount: "10000000",
  gasAmount: "100000000",
  network: "mainnet",
  expiresAt: "2030-01-01T00:00:00.000Z",
};
const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function setup(
  over: Partial<{
    wallet: () => Promise<unknown>;
    intent: () => Promise<unknown>;
    send: PayFlowDeps["send"];
    confirm: () => Promise<unknown>;
  }> = {},
) {
  const calls: string[] = [];
  const get = vi.fn(async (path: string) => {
    calls.push(`GET ${path.split("?")[0]}`);
    return (await (over.wallet ?? (async () => ({ jettonWallet, network: "mainnet" })))()) as never;
  });
  const post = vi.fn(async (path: string, _body?: unknown) => {
    calls.push(`POST ${path}`);
    if (path.endsWith("/intent")) return (await (over.intent ?? (async () => intent))()) as never;
    return (await (over.confirm ?? (async () => ({})))()) as never;
  });
  const send = vi.fn(
    over.send ??
      (async (request) => {
        calls.push("WALLET sign");
        expect(request.messages).toHaveLength(1);
        return { boc: "te6ccgEB..." };
      }),
  );
  const deps: PayFlowDeps = {
    api: { get, post },
    send,
    wallet: { address: payer, chain: "-239" },
  };
  return { deps, calls, get, post, send };
}
const args = { chainId: "chain001", planId: "boost_24h" };

describe("startGrmPayment", () => {
  it("looks up the payer's Jetton wallet, creates the order, has the wallet sign, then nudges the server", async () => {
    const { deps, calls, send, post } = setup();
    const r = await startGrmPayment(deps, args);
    expect(r).toEqual({ ok: true, reference: intent.reference });
    expect(calls).toEqual([
      "GET /api/ton/jetton-wallet",
      "POST /api/payments/ton/intent",
      "WALLET sign",
      "POST /api/payments/ton/confirm",
    ]);
    expect(post).toHaveBeenCalledWith("/api/payments/ton/intent", args);
    expect(post).toHaveBeenCalledWith("/api/payments/ton/confirm", {
      reference: intent.reference,
      boc: "te6ccgEB...",
    });
    // the transfer targets the PAYER's own Jetton wallet and attaches the server-chosen gas
    const request = send.mock.calls[0]?.[0];
    expect(request?.messages[0]?.amount).toBe(intent.gasAmount);
    expect(Address.parse(request?.messages[0]?.address ?? "").toRawString()).toBe(jettonWallet);
  });

  it("someone with no GRM (no Jetton wallet) gets a clear outcome and NO order is created", async () => {
    const { deps, post, send } = setup({
      wallet: async () => {
        throw apiError(404);
      },
    });
    expect(await startGrmPayment(deps, args)).toEqual({ ok: false, reason: "no_grm" });
    expect(post).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("a failing lookup (not 404) or a refused order is an error and the wallet is never opened", async () => {
    const down = setup({
      wallet: async () => {
        throw apiError(503);
      },
    });
    await expect(startGrmPayment(down.deps, args)).rejects.toMatchObject({ status: 503 });
    expect(down.post).not.toHaveBeenCalled();

    const horizon = setup({
      intent: async () => {
        throw apiError(409);
      },
    });
    await expect(startGrmPayment(horizon.deps, args)).rejects.toMatchObject({ status: 409 });
    expect(horizon.send).not.toHaveBeenCalled();
    // a 404 from the ORDER endpoint (chain gone) is not "you hold no GRM"
    const gone = setup({
      intent: async () => {
        throw apiError(404);
      },
    });
    await expect(startGrmPayment(gone.deps, args)).rejects.toMatchObject({ status: 404 });
  });

  it("a wallet that refuses to sign is a normal outcome and nothing is confirmed", async () => {
    const { deps, post } = setup({
      send: async () => {
        throw new Error("User rejects the action");
      },
    });
    expect(await startGrmPayment(deps, args)).toEqual({ ok: false, reason: "rejected" });
    expect(post).not.toHaveBeenCalledWith("/api/payments/ton/confirm", expect.anything());
  });

  it("once the wallet has signed, a failing confirm can NOT turn into an error (the user would pay twice)", async () => {
    for (const status of [429, 500, 0]) {
      const { deps } = setup({
        confirm: async () => {
          throw apiError(status);
        },
      });
      expect(await startGrmPayment(deps, args)).toEqual({ ok: true, reference: intent.reference });
    }
  });

  it("does not wait for the confirm call: the UI starts watching the order immediately", async () => {
    const { deps } = setup({ confirm: () => new Promise(() => undefined) });
    await expect(startGrmPayment(deps, args)).resolves.toEqual({
      ok: true,
      reference: intent.reference,
    });
  });

  it("omits the BOC when the wallet returns none", async () => {
    const { deps, post } = setup({ send: async () => ({ boc: "" }) });
    await startGrmPayment(deps, args);
    expect(post).toHaveBeenCalledWith("/api/payments/ton/confirm", { reference: intent.reference });
  });

  describe("networks", () => {
    it("demands the server's network from the wallet (a wallet on another network refuses the request)", async () => {
      const { deps, send } = setup();
      await startGrmPayment(deps, args);
      expect(send.mock.calls[0]?.[0].network).toBe("-239");
      const address = send.mock.calls[0]?.[0].messages[0]?.address ?? "";
      expect(Address.parseFriendly(address).isTestOnly).toBe(false);
    });

    it("testnet server + testnet wallet: test-only address format and the testnet chain id", async () => {
      const { deps, send } = setup({
        wallet: async () => ({ jettonWallet, network: "testnet" }),
        intent: async () => ({ ...intent, network: "testnet" }),
      });
      await startGrmPayment({ ...deps, wallet: { address: payer, chain: "-3" } }, args);
      const req = send.mock.calls[0]?.[0];
      expect(req?.network).toBe("-3");
      expect(Address.parseFriendly(req?.messages[0]?.address ?? "").isTestOnly).toBe(true);
    });

    it("a wallet on the WRONG network is told so before anything is ordered or signed", async () => {
      const mainnetServer = setup();
      expect(
        await startGrmPayment(
          { ...mainnetServer.deps, wallet: { address: payer, chain: "-3" } },
          args,
        ),
      ).toEqual({ ok: false, reason: "wrong_network", expected: "mainnet" });
      expect(mainnetServer.post).not.toHaveBeenCalled();
      expect(mainnetServer.send).not.toHaveBeenCalled();

      const testnetServer = setup({ wallet: async () => ({ jettonWallet, network: "testnet" }) });
      expect(await startGrmPayment(testnetServer.deps, args)).toEqual({
        ok: false,
        reason: "wrong_network",
        expected: "testnet",
      });
      expect(testnetServer.post).not.toHaveBeenCalled();
    });

    it("an older server that does not report a network: no pre-check, no network demanded", async () => {
      const { deps, send } = setup({
        wallet: async () => ({ jettonWallet }),
        intent: async () => ({ ...intent, network: undefined }),
      });
      expect(
        await startGrmPayment({ ...deps, wallet: { address: payer, chain: "-3" } }, args),
      ).toMatchObject({
        ok: true,
      });
      expect(send.mock.calls[0]?.[0].network).toBeUndefined();
    });
  });
});
