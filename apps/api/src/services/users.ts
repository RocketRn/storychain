import type { User } from "@prisma/client";
import { FREE_DAILY_LIMIT, type SessionDTO, type UserDTO, type UsageDTO } from "@storychain/shared";
import type { Db } from "../db";
import type { TgUser } from "../auth/initData";

export const isPro = (u: Pick<User, "proUntil">, now = new Date()): boolean =>
  !!u.proUntil && u.proUntil.getTime() > now.getTime();

export const utcDay = (d = new Date()): string => d.toISOString().slice(0, 10);

export const toUserDTO = (u: User): UserDTO => ({
  id: u.id,
  telegramId: u.telegramId.toString(),
  username: u.username,
  firstName: u.firstName,
  languageCode: u.languageCode,
  isTgPremium: u.isTgPremium,
});

/** Upserts the user from validated initData; refreshes premium flag and profile on each call. */
export async function upsertTgUser(db: Db, tg: TgUser, touch: boolean): Promise<User> {
  const telegramId = BigInt(tg.id);
  const existing = await db.user.findUnique({ where: { telegramId } });
  const profile = {
    username: tg.username ?? null,
    firstName: tg.first_name,
    languageCode: tg.language_code ?? null,
    isTgPremium: tg.is_premium ?? false,
  };
  if (!existing) {
    try {
      return await db.user.create({ data: { telegramId, ...profile } });
    } catch (e) {
      // Concurrent first requests from a new user: another request created the row first.
      if ((e as { code?: string }).code !== "P2002") throw e;
      return db.user.findUniqueOrThrow({ where: { telegramId } });
    }
  }
  const changed =
    existing.isTgPremium !== profile.isTgPremium ||
    existing.username !== profile.username ||
    existing.firstName !== profile.firstName ||
    existing.languageCode !== profile.languageCode;
  if (!changed && !touch) return existing;
  return db.user.update({
    where: { id: existing.id },
    data: { ...profile, ...(touch ? { lastSeenAt: new Date() } : {}) },
  });
}

export async function getUsage(db: Db, user: User, now = new Date()): Promise<UsageDTO> {
  const row = await db.dailyUsage.findUnique({
    where: { userId_day: { userId: user.id, day: utcDay(now) } },
  });
  return { dailyLimit: isPro(user, now) ? null : FREE_DAILY_LIMIT, usedToday: row?.count ?? 0 };
}

export async function buildSession(db: Db, user: User): Promise<SessionDTO> {
  return {
    user: toUserDTO(user),
    isPro: isPro(user),
    proUntil: user.proUntil?.toISOString() ?? null,
    ...(await getUsage(db, user)),
  };
}
