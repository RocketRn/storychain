import { useCallback, useEffect, useRef, useState } from "react";
import type { PaymentStatusDTO } from "@storychain/shared/light";
import { api, ApiError } from "../lib/api";
import { useInvalidateChains } from "../lib/queries";

export type PollState = "idle" | "polling" | "paid" | "failed" | "expired" | "timeout";

const POLL_START_MS = 1_500;
const POLL_MAX_MS = 6_000;

/** Starts quick (the Stars result is usually there within seconds), then eases off: the server itself only
 * looks at the chain every ~10 s, so asking every 1.5 s for minutes is pure load. */
export const nextPollDelay = (current: number): number =>
  Math.min(POLL_MAX_MS, Math.round(current * 1.4));

/** A 4xx other than "slow down / timeout" will not start succeeding by asking again. */
export const isPermanentPollError = (e: unknown): boolean =>
  e instanceof ApiError &&
  e.status >= 400 &&
  e.status < 500 &&
  e.status !== 408 &&
  e.status !== 429;

/**
 * Never trust the client-side payment result: ask the SERVER until it marks the transaction paid.
 * `timeout` means "still processing" (not failed): the user can re-check.
 */
export function usePaymentPolling() {
  const invalidate = useInvalidateChains();
  const [state, setState] = useState<PollState>("idle");
  const [status, setStatus] = useState<PaymentStatusDTO | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = useRef(0);

  const stop = useCallback(() => {
    run.current++;
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback(
    (reference: string, timeoutMs: number, intervalMs = POLL_START_MS) => {
      stop();
      const id = run.current;
      const deadline = Date.now() + timeoutMs;
      let delay = intervalMs;
      setState("polling");
      const tick = async () => {
        if (id !== run.current) return;
        try {
          const s = await api.get<PaymentStatusDTO>(`/api/payments/${reference}`);
          if (id !== run.current) return;
          setStatus(s);
          if (s.status === "paid") {
            setState("paid");
            void invalidate(); // the chain is now boosted: carousel, lists and detail change
            return;
          }
          if (s.status === "failed" || s.status === "refunded") return setState("failed");
          if (s.status === "expired") return setState("expired");
        } catch (e) {
          if (id !== run.current) return;
          if (isPermanentPollError(e)) return setState("failed");
          /* transient network error: keep polling until the deadline */
        }
        if (Date.now() >= deadline) return setState("timeout");
        timer.current = setTimeout(() => void tick(), delay);
        delay = nextPollDelay(delay);
      };
      void tick();
    },
    [invalidate, stop],
  );

  return { state, status, start, reset: () => (stop(), setState("idle")) };
}
