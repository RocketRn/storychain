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
// Events and actions are validated ONE BY ONE: anyone can send GRM to the merchant address, so a single odd
// event must never make the whole page unreadable (that would stall every pending payment behind it).
const envelopeSchema = z.object({ events: z.array(z.unknown()) }).passthrough();
const eventSchema = z
  .object({
    event_id: z.string(),
    timestamp: z.number(),
    in_progress: z.boolean().optional(),
    actions: z.array(z.unknown()),
  })
  .passthrough();
const actionSchema = z
  .object({
    type: z.string(),
    status: z.string(),
    JettonTransfer: z
      .object({
        sender: addrObj.nullish(),
        recipient: addrObj.nullish(),
        amount: z.string(),
        comment: z.string().nullish(),
        jetton: z.object({ address: z.string() }).passthrough(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Maps TonAPI AccountEvents to transfer events. Unfinished (in_progress) events are skipped and picked up on a
 * later poll. Events / jetton actions that cannot be understood are counted in `skipped` (never thrown).
 * `count` and `lastLt` describe the raw page, so paging decisions do not depend on what was understood.
 */
export function parseTonApiEvents(json: unknown): {
  events: JettonTransferEvent[];
  lastLt: number | undefined;
  count: number;
  skipped: number;
} {
  const { events: raw } = envelopeSchema.parse(json);
  const out: JettonTransferEvent[] = [];
  const lts: number[] = [];
  let skipped = 0;
  for (const item of raw) {
    if (isObject(item) && typeof item.lt === "number") lts.push(item.lt);
    const ev = eventSchema.safeParse(item);
    if (!ev.success) {
      skipped++;
      continue;
    }
    if (ev.data.in_progress) continue;
    for (const rawAction of ev.data.actions) {
      const a = actionSchema.safeParse(rawAction);
      if (!a.success) {
        // only a malformed JettonTransfer matters; other action types are none of our business
        if (isObject(rawAction) && rawAction.type === "JettonTransfer") skipped++;
        continue;
      }
      const t = a.data.JettonTransfer;
      if (a.data.type !== "JettonTransfer" || !t?.recipient) continue;
      if (!/^\d{1,40}$/.test(t.amount)) {
        skipped++;
        continue;
      }
      out.push({
        txHash: ev.data.event_id,
        timestamp: ev.data.timestamp,
        success: a.data.status === "ok",
        jettonMaster: t.jetton.address,
        recipient: t.recipient.address,
        ...(t.sender ? { sender: t.sender.address } : {}),
        amount: BigInt(t.amount),
        comment: t.comment ?? null,
      });
    }
  }
  return {
    events: out,
    lastLt: lts.length ? Math.min(...lts) : undefined,
    count: raw.length,
    skipped,
  };
}

/** Pages fetched per poll. Exported so the truncation warning can be tested. */
export const MAX_HISTORY_PAGES = 5;

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
      /** receives data-quality warnings (skipped events, truncated history window) */
      logger?: { warn(o: unknown, msg?: string): void };
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
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const q = new URLSearchParams({ limit: String(args.limit) });
      if (args.since) q.set("start_date", String(args.since));
      if (beforeLt !== undefined) q.set("before_lt", String(beforeLt));
      const json = await this.get(
        `/v2/accounts/${encodeURIComponent(args.account)}/jettons/${encodeURIComponent(args.jettonMaster)}/history?${q}`,
      );
      const { events, lastLt, count, skipped } = parseTonApiEvents(json);
      if (skipped > 0)
        this.opts.logger?.warn(
          { skipped, page },
          "TonAPI: ignored events that could not be parsed",
        );
      all.push(...events);
      if (count < args.limit || lastLt === undefined) return all; // reached the start of the window
      beforeLt = lastLt;
    }
    // Every page was full: the oldest part of the window was never looked at. Spam to the merchant address could
    // push a real payment out of reach, so make it visible instead of silently missing it.
    this.opts.logger?.warn(
      { pages: MAX_HISTORY_PAGES, limit: args.limit, since: args.since },
      "TonAPI: history window truncated, older transfers were not examined",
    );
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
