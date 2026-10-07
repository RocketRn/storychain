import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app";
import { signInitData } from "../auth/initData";
import { errors } from "../errors";
import { utcDay } from "../services/users";
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
        isPremium: z.boolean().default(false),
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
        is_premium: body.isPremium,
      },
      config.botToken,
      body.startParam ? { startParam: body.startParam } : {},
    );
    return { initData };
  });

  const target = z.object({ telegramId: z.number().int().positive() });

  app.post("/api/dev/grant-pro", async (req) => {
    const body = target
      .extend({
        days: z.number().int().min(-3650).max(3650).default(30),
        /** "fast-forward": set proUntil to now + N minutes (overrides days) */
        expireInMinutes: z.number().int().min(1).max(525_600).optional(),
      })
      .parse(req.body);
    const user = await db.user.findUnique({ where: { telegramId: BigInt(body.telegramId) } });
    if (!user) throw errors.notFound("User not found");
    const base = user.proUntil && user.proUntil > new Date() ? user.proUntil : new Date();
    // days <= 0 with "revoke" semantic: set proUntil relative to now
    const proUntil =
      body.expireInMinutes !== undefined
        ? new Date(Date.now() + body.expireInMinutes * 60_000)
        : body.days > 0
          ? new Date(base.getTime() + body.days * 86_400_000)
          : body.days === 0
            ? null
            : new Date(Date.now() + body.days * 86_400_000);
    await db.user.update({ where: { id: user.id }, data: { proUntil } });
    return { proUntil: proUntil?.toISOString() ?? null };
  });

  /**
   * Simulates the provider confirming a payment so the whole server-side grant path runs without Telegram/TON:
   *  - stars: goes through the same handler as the bot's `successful_payment` (amount/user validation included)
   *  - ton_grm: settles like the verifier would after matching an on-chain transfer
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
        const res = await handleSuccessfulPayment(db, Number(tx.user.telegramId), {
          currency: tx.currency,
          total_amount: Number(tx.amount),
          invoice_payload: tx.reference,
          telegram_payment_charge_id: `dev_charge_${nanoid(12)}`,
        });
        return { outcome: res.outcome };
      }
      const res = await settlePayment(db, {
        reference: tx.reference,
        externalId: `dev_tx_${nanoid(16)}`,
        rawJson: { dev: true },
        allowExpired: false,
      });
      return { outcome: res.outcome };
    },
  );

  app.post("/api/dev/reset-usage", async (req) => {
    const body = target.parse(req.body);
    const user = await db.user.findUnique({ where: { telegramId: BigInt(body.telegramId) } });
    if (!user) throw errors.notFound("User not found");
    await db.dailyUsage.deleteMany({ where: { userId: user.id, day: utcDay() } });
    return { ok: true };
  });
}
