import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app";
import { signInitData } from "../auth/initData";
import { errors } from "../errors";
import { settlePayment } from "../payments/ledger";
import { handleSuccessfulPayment } from "../payments/stars";
import { nanoid } from "nanoid";

/** Matches prisma/seed.ts so names do not flip when the profile is refreshed on auth. */
const DEMO_NAMES = ["Anna", "Boris", "Clara", "Dmitri"];

/** Registered only when NODE_ENV !== "production" AND DEV_MODE=true. */
export function registerDevRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps;

  app.post("/api/dev/init-data", async (req) => {
    const body = z
      .object({
        userId: z.number().int().positive(),
        isTgPremium: z.boolean().default(false),
        languageCode: z.string().default("ru"),
        startParam: z.string().max(64).optional(),
      })
      .parse(req.body);
    const initData = signInitData(
      {
        id: body.userId,
        first_name: DEMO_NAMES[body.userId - 1_000_001] ?? `User ${body.userId}`,
        username: `demo_user_${body.userId}`,
        language_code: body.languageCode,
        is_premium: body.isTgPremium,
      },
      config.botToken,
      body.startParam ? { startParam: body.startParam } : {},
    );
    return { initData };
  });

  const clock = (): Date => deps.now?.() ?? new Date();

  /** Boosts a chain for N hours right away (mock DevTools). Writes a real ChainBoost row so refunds/history stay consistent. */
  app.post("/api/dev/boost-chain", async (req) => {
    const body = z
      .object({
        chainId: z.string().min(1).max(64),
        hours: z
          .number()
          .int()
          .min(1)
          .max(24 * 30),
      })
      .parse(req.body);
    const chain = await db.chain.findUnique({ where: { id: body.chainId } });
    if (!chain) throw errors.chainNotFound();
    const now = clock();
    const start = chain.boostedUntil && chain.boostedUntil > now ? chain.boostedUntil : now;
    const end = new Date(start.getTime() + body.hours * 3_600_000);
    await db.$transaction([
      db.chain.update({ where: { id: chain.id }, data: { boostedUntil: end, isBoosted: true } }),
      db.chainBoost.create({
        data: {
          chainId: chain.id,
          userId: chain.creatorId,
          planId: body.hours >= 24 * 7 ? "boost_7d" : "boost_24h",
          startsAt: start,
          endsAt: end,
          txId: `dev_${nanoid(16)}`,
        },
      }),
    ]);
    return { boostedUntil: end.toISOString() };
  });

  /**
   * Ends a boost "in the past". The cached `isBoosted` flag is deliberately left untouched so the UI/API are
   * proven to rely on `boostedUntil > now` (the sweeper cleans the cache later).
   */
  app.post("/api/dev/expire-boost", async (req) => {
    const body = z.object({ chainId: z.string().min(1).max(64) }).parse(req.body);
    const chain = await db.chain.findUnique({ where: { id: body.chainId } });
    if (!chain) throw errors.chainNotFound();
    const past = new Date(clock().getTime() - 60_000);
    await db.chain.update({ where: { id: chain.id }, data: { boostedUntil: past } });
    return { boostedUntil: past.toISOString() };
  });

  /**
   * Simulates the provider confirming a payment so the whole server-side grant path runs without Telegram/TON:
   *  - stars: goes through the same handler as the bot's `successful_payment` (amount/user validation included)
   *  - ton_grm: settles like the verifier would after matching an on-chain transfer
   * Both end in `applyBoost`.
   */
  app.post<{ Params: { reference: string } }>(
    "/api/dev/payments/:reference/complete",
    async (req) => {
      const tx = await db.transaction.findUnique({
        where: { reference: req.params.reference },
        include: { user: true },
      });
      if (!tx) throw errors.paymentNotFound();
      if (tx.provider === "stars") {
        const res = await handleSuccessfulPayment(
          db,
          Number(tx.user.telegramId),
          {
            currency: tx.currency,
            total_amount: Number(tx.amount),
            invoice_payload: tx.reference,
            // one charge id per order: completing twice behaves like Telegram redelivering the same update
            telegram_payment_charge_id: `dev_charge_${tx.reference}`,
          },
          clock(),
        );
        return { outcome: res.outcome };
      }
      const res = await settlePayment(db, {
        reference: tx.reference,
        externalId: `dev_tx_${nanoid(16)}`,
        rawJson: { dev: true },
        now: clock(),
        allowExpired: false,
      });
      return { outcome: res.outcome };
    },
  );
}
