export const DAY_MS = 86_400_000;

/** PRO is extended from max(now, current proUntil), never from the past. */
export function extendProUntil(now: Date, current: Date | null, days: number): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + days * DAY_MS);
}

/** Revokes one purchased period (refund). May land in the past, which simply means "not PRO". */
export function shrinkProUntil(current: Date | null, days: number): Date | null {
  return current ? new Date(current.getTime() - days * DAY_MS) : null;
}
