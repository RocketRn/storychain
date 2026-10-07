import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Transaction } from "@prisma/client";
import {
  allowedMethods,
  createPaymentSchema,
  PLANS,
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
import { isPro } from "../services/users";

const TON_INTENT_TTL_MS = 30 * 60 * 1000;
/** 0.01 TON forwarded so the merchant wallet gets a transfer notification carrying the comment */
const FORWARD_TON_NANO = "10000000";
/** 0.05 TON attached for gas on the message to the user's Jetton wallet (unused part is returned) */
const GAS_TON_NANO = "50000000";

const WALLET_TTL_MS = 10 * 60 * 1000;

export function registerPaymentRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps;
  const limit = { rateLimit: { max: 10, timeWindow: "1 minute" } };
  const walletCache = new Map<string, { value: string; expires: number }>();

  async function statusDto(tx: Transaction): Promise<PaymentStatusDTO> {
    const u = await db.user.findUniqueOrThrow({ where: { id: tx.userId } });
    const expiredNow = tx.status === "pending" && tx.expiresAt.getTime() < Date.now();
    return {
      reference: tx.reference,
      provider: tx.provider,
      planId: tx.planId,
      status: expiredNow ? "expired" : (tx.status as PaymentStatusDTO["status"]),
      amount: tx.amount,
      currency: tx.currency,
      expiresAt: tx.expiresAt.toISOString(),
      paidAt: tx.paidAt?.toISOString() ?? null,
      isPro: isPro(u),
      proUntil: u.proUntil?.toISOString() ?? null,
    };
  }

  async function ownTx(reference: string, userId: string): Promise<Transaction> {
    const tx = await db.transaction.findUnique({ where: { reference } });
    // not found and not-yours look identical: references are not enumerable
    if (!tx || tx.userId !== userId) throw errors.paymentNotFound();
    return tx;
  }

  app.post(
    "/api/payments/stars/invoice",
    { preHandler: requireAuth, config: limit },
    async (req): Promise<StarsInvoiceDTO> => {
      const { planId } = createPaymentSchema.parse(req.body);
      return createStarsInvoice({
        db,
        config,
        create: deps.createInvoiceLink ?? invoiceLinkCreator(deps.bot, config),
        user: user(req),
        planId,
      });
    },
  );

  app.post(
    "/api/payments/ton/intent",
    { preHandler: requireAuth, config: limit },
    async (req): Promise<TonIntentDTO> => {
      const { planId } = createPaymentSchema.parse(req.body);
      if (!allowedMethods(req.platform, config.ton.allPlatforms).includes("ton_grm"))
        throw errors.methodNotAllowed();
      // Mock/dev mode needs no merchant address; real mode must have one (enforced at startup in production)
      if (!config.ton.merchantAddress && !config.devMode)
        throw errors.methodUnavailable("TON payments are not configured");
      if (!PLANS[planId]) throw errors.badRequest("Unknown plan");
      const expiresAt = new Date(Date.now() + TON_INTENT_TTL_MS);
      const tx = await createPending(db, {
        userId: user(req).id,
        provider: "ton_grm",
        planId,
        amount: config.ton.priceUnits.toString(),
        currency: "GRM",
        expiresAt,
      });
      return {
        reference: tx.reference,
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
        // Immediate verification attempt. The BOC is informational only: payment is proven on-chain, never by the client.
        await Promise.race([deps.verifier.tick(), new Promise((r) => setTimeout(r, 8000))]);
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
      if (hit && hit.expires > Date.now()) return { owner: ownerRaw, jettonWallet: hit.value };
      const wallet = await deps.indexer.getJettonWallet(ownerRaw, config.ton.jettonMaster);
      if (!wallet)
        throw errors.notFound("No Jetton wallet for this owner: the account holds no GRM");
      walletCache.set(ownerRaw, { value: wallet, expires: Date.now() + WALLET_TTL_MS });
      return { owner: ownerRaw, jettonWallet: wallet };
    },
  );
}
