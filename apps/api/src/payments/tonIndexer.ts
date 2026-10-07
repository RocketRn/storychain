import { z } from "zod";

/** A successful-or-not incoming Jetton transfer as seen by the indexer, independent of provider. */
export interface JettonTransferEvent {
  /** unique id of the transfer: TonAPI event id (hash of the trace's root transaction) */
  txHash: string;
  /** unix seconds */
  timestamp: number;
  success: boolean;
  jettonMaster: string;
  /** owner address of the recipient (the merchant), not its Jetton wallet */
  recipient: string;
  sender?: string;
  /** smallest units */
  amount: bigint;
  comment: string | null;
}

export interface JettonInfo {
  decimals: number;
  symbol: string;
}

/** Swappable indexer. TonAPI is the default implementation. */
export interface TonIndexer {
  getRecentJettonTransfers(args: {
    account: string;
    jettonMaster: string;
    limit: number;
    /** unix seconds: do not look further back than this */
    since?: number;
  }): Promise<JettonTransferEvent[]>;
  /** The owner's Jetton wallet address for `master`, or null if the owner has none. */
  getJettonWallet(owner: string, master: string): Promise<string | null>;
  getJettonInfo(master: string): Promise<JettonInfo>;
}

export class TonIndexerError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const addrObj = z.object({ address: z.string() }).passthrough();
const eventsSchema = z
  .object({
    events: z.array(
      z
        .object({
          event_id: z.string(),
          timestamp: z.number(),
          lt: z.number().optional(),
          in_progress: z.boolean().optional(),
          actions: z.array(
            z
              .object({
                type: z.string(),
                status: z.string(),
                JettonTransfer: z
                  .object({
                    sender: addrObj.optional(),
                    recipient: addrObj.optional(),
                    amount: z.string(),
                    comment: z.string().optional(),
                    jetton: z.object({ address: z.string() }).passthrough(),
                  })
                  .passthrough()
                  .optional(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** Maps TonAPI AccountEvents to transfer events. Unfinished (in_progress) events are skipped and picked up on a later poll. */
export function parseTonApiEvents(json: unknown): {
  events: JettonTransferEvent[];
  lastLt: number | undefined;
  count: number;
} {
  const parsed = eventsSchema.parse(json);
  const out: JettonTransferEvent[] = [];
  for (const ev of parsed.events) {
    if (ev.in_progress) continue;
    for (const a of ev.actions) {
      const t = a.JettonTransfer;
      if (a.type !== "JettonTransfer" || !t?.recipient) continue;
      out.push({
        txHash: ev.event_id,
        timestamp: ev.timestamp,
        success: a.status === "ok",
        jettonMaster: t.jetton.address,
        recipient: t.recipient.address,
        ...(t.sender ? { sender: t.sender.address } : {}),
        amount: BigInt(t.amount),
        comment: t.comment ?? null,
      });
    }
  }
  const lts = parsed.events.map((e) => e.lt).filter((x): x is number => typeof x === "number");
  return {
    events: out,
    lastLt: lts.length ? Math.min(...lts) : undefined,
    count: parsed.events.length,
  };
}

/**
 * TonAPI (https://tonapi.io). Endpoints used (assumption: confirm against current TonAPI docs):
 *  - GET /v2/accounts/{account}/jettons/{jetton}/history?limit&start_date&before_lt  -> AccountEvents
 *  - GET /v2/accounts/{owner}/jettons/{jetton}                                       -> { wallet_address: { address } }
 *  - GET /v2/jettons/{jetton}                                                        -> { metadata: { decimals, symbol } }
 */
export class TonApiIndexer implements TonIndexer {
  constructor(
    private readonly opts: {
      apiKey: string;
      network: "mainnet" | "testnet";
      fetchImpl?: typeof fetch;
    },
  ) {}

  private get base(): string {
    return this.opts.network === "testnet" ? "https://testnet.tonapi.io" : "https://tonapi.io";
  }

  private async get(path: string): Promise<unknown> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`${this.base}${path}`, {
      headers: {
        Accept: "application/json",
        ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) throw new TonIndexerError("not found", 404);
    if (!res.ok) throw new TonIndexerError(`TonAPI ${res.status}`, res.status);
    return res.json();
  }

  async getRecentJettonTransfers(args: {
    account: string;
    jettonMaster: string;
    limit: number;
    since?: number;
  }) {
    const all: JettonTransferEvent[] = [];
    let beforeLt: number | undefined;
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({ limit: String(args.limit) });
      if (args.since) q.set("start_date", String(args.since));
      if (beforeLt !== undefined) q.set("before_lt", String(beforeLt));
      const json = await this.get(
        `/v2/accounts/${encodeURIComponent(args.account)}/jettons/${encodeURIComponent(args.jettonMaster)}/history?${q}`,
      );
      const { events, lastLt, count } = parseTonApiEvents(json);
      all.push(...events);
      if (count < args.limit || lastLt === undefined) break;
      beforeLt = lastLt;
    }
    return all;
  }

  async getJettonWallet(owner: string, master: string): Promise<string | null> {
    try {
      const j = z
        .object({ wallet_address: addrObj })
        .passthrough()
        .parse(
          await this.get(
            `/v2/accounts/${encodeURIComponent(owner)}/jettons/${encodeURIComponent(master)}`,
          ),
        );
      return j.wallet_address.address;
    } catch (e) {
      if (e instanceof TonIndexerError && e.status === 404) return null;
      throw e;
    }
  }

  async getJettonInfo(master: string): Promise<JettonInfo> {
    const j = z
      .object({
        metadata: z
          .object({ decimals: z.union([z.string(), z.number()]), symbol: z.string() })
          .passthrough(),
      })
      .passthrough()
      .parse(await this.get(`/v2/jettons/${encodeURIComponent(master)}`));
    return { decimals: Number(j.metadata.decimals), symbol: j.metadata.symbol };
  }
}
