import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Chain, Transaction } from "@prisma/client";
import {
  allowedMethods,
  createPaymentSchema,
  tonConfirmSchema,
  type PaymentStatusDTO,
  type StarsInvoiceDTO,
  type TonIntentDTO,
} from "@storychain/shared";
import type { Deps } from "../app";
import { requireAuth, user } from "../auth/plugin";
import { errors } from "../errors";
import { rawAddress } from "../payments/address";
import { createPending } from "../payments/ledger";
import { createStarsInvoice, invoiceLinkCreator } from "../payments/stars";
import { isBoostActive } from "../boosts/core";
import { validateBoostPurchase } from "../boosts/purchase";
import { TtlCache } from "../ttlCache";

const TON_INTENT_TTL_MS = 30 * 60 * 1000;
/** 0.01 TON forwarded so the merchant wallet gets a transfer notification carrying the comment */
const FORWARD_TON_NANO = "10000000";
/**
 * 0.1 TON attached to the message to the user's Jetton wallet; whatever is not used comes back to the payer
 * (response_destination). The reference Jetton wallet bounces a transfer (exit 709) unless the attached value
 * exceeds forward_ton_amount + 2 forward fees + 2 * gas + storage reserve, which with a 0.01 TON forward amount
 * is already ~0.05 TON: 0.05 attached left no margin at all, and other implementations reserve more.
 */
const GAS_TON_NANO = "100000000";

const WALLET_TTL_MS = 10 * 60 * 1000;
/** Owners are caller-supplied, so the cache is bounded: it can neither grow without limit nor be flushed cheaply */
const WALLET_CACHE_MAX = 1000;

type OrderWithChain = Transaction & { chain: Chain | null };

export function registerPaymentRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps;
  const limit = { rateLimit: { max: config.rateLimits.paymentsPerMin, timeWindow: "1 minute" } };
  const now = (): Date => deps.now?.() ?? new Date();
  const walletCache = new TtlCache<string>({ maxEntries: WALLET_CACHE_MAX, ttlMs: WALLET_TTL_MS });

  // The client polls this while a payment is in flight: one query (order + chain), not two
  function statusDto(tx: OrderWithChain): PaymentStatusDTO {
    const chain = tx.chain;
    const t = now();
    const expiredNow = tx.status === "pending" && tx.expiresAt.getTime() < t.getTime();
    return {
      reference: tx.reference,
      provider: tx.provider,
      planId: tx.planId,
      status: expiredNow ? "expired" : (tx.status as PaymentStatusDTO["status"]),
      amount: tx.amount,
      currency: tx.currency,
      expiresAt: tx.expiresAt.toISOString(),
      paidAt: tx.paidAt?.toISOString() ?? null,
      chainId: tx.chainId,
      // only the buyer (= the creator) can read their own order
      boostedUntil:
        chain && isBoostActive(chain, t) ? (chain.boostedUntil as Date).toISOString() : null,
    };
  }

  async function ownTx(reference: string, userId: string): Promise<OrderWithChain> {
    const tx = await db.transaction.findUnique({ where: { reference }, include: { chain: true } });
    // not found and not-yours look identical: references are not enumerable
    if (!tx || tx.userId !== userId) throw errors.paymentNotFound();
    return tx;
  }

  app.post(
    "/api/payments/stars/invoice",
    { preHandler: requireAuth, config: limit },
    async (req): Promise<StarsInvoiceDTO> => {
      const { chainId, planId } = createPaymentSchema.parse(req.body);
      return createStarsInvoice({
        db,
        config,
        create: deps.createInvoiceLink ?? invoiceLinkCreator(deps.bot, config),
        user: user(req),
        chainId,
        planId,
        now: now(),
      });
    },
  );

  app.post(
    "/api/payments/ton/intent",
    { preHandler: requireAuth, config: limit },
    async (req): Promise<TonIntentDTO> => {
      const { chainId, planId } = createPaymentSchema.parse(req.body);
      if (!allowedMethods(req.platform, config.ton.allPlatforms).includes("ton_grm"))
        throw errors.methodNotAllowed();
      // Mock/dev mode needs no merchant address; real mode must have one (enforced at startup in production)
      if (!config.ton.merchantAddress && !config.devMode)
        throw errors.methodUnavailable("TON payments are not configured");
      const at = now();
      const purchase = await validateBoostPurchase(db, config, {
        chainId,
        planId,
        userId: user(req).id,
        now: at,
      });
      const expiresAt = new Date(at.getTime() + TON_INTENT_TTL_MS);
      const tx = await createPending(db, {
        userId: user(req).id,
        provider: "ton_grm",
        planId: purchase.planId,
        chainId: purchase.chain.id,
        amount: config.boost.grmUnits[purchase.planId].toString(),
        currency: "GRM",
        expiresAt,
      });
      return {
        reference: tx.reference,
        chainId: purchase.chain.id,
        planId: purchase.planId,
        jettonMaster: config.ton.jettonMaster,
        merchantAddress: config.ton.merchantAddress,
        amount: tx.amount,
        decimals: config.ton.decimals,
        forwardTonAmount: FORWARD_TON_NANO,
        gasAmount: GAS_TON_NANO,
        expiresAt: expiresAt.toISOString(),
      };
    },
  );

  app.post(
    "/api/payments/ton/confirm",
    { preHandler: requireAuth, config: limit },
    async (req): Promise<PaymentStatusDTO> => {
      const body = tonConfirmSchema.parse(req.body);
      const tx = await ownTx(body.reference, user(req).id);
      if (tx.provider !== "ton_grm") throw errors.badRequest("Not a TON payment");
      if (tx.status === "pending" && deps.verifier) {
        // Immediate verification attempt (rate-bounded by the verifier). The BOC is informational only:
        // payment is proven on-chain, never by the client.
        await deps.verifier.nudge();
      }
      return statusDto(await ownTx(body.reference, user(req).id));
    },
  );

  app.get<{ Params: { reference: string } }>(
    "/api/payments/:reference",
    { preHandler: requireAuth },
    async (req): Promise<PaymentStatusDTO> =>
      statusDto(await ownTx(req.params.reference, user(req).id)),
  );

  app.get(
    "/api/ton/jetton-wallet",
    { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      const { owner } = z.object({ owner: z.string().min(10).max(80) }).parse(req.query);
      let ownerRaw: string;
      try {
        ownerRaw = rawAddress(owner);
      } catch {
        throw errors.badRequest("Invalid TON address");
      }
      if (!deps.indexer) throw errors.methodUnavailable("TON indexer is not configured");
      const hit = walletCache.get(ownerRaw);
      if (hit) return { owner: ownerRaw, jettonWallet: hit };
      const wallet = await deps.indexer.getJettonWallet(ownerRaw, config.ton.jettonMaster);
      if (!wallet)
        throw errors.notFound("No Jetton wallet for this owner: the account holds no GRM");
      walletCache.set(ownerRaw, wallet);
      return { owner: ownerRaw, jettonWallet: wallet };
    },
  );
}
