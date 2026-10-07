import { useCallback, useEffect, useRef, useState } from "react";
import type { PaymentStatusDTO } from "@storychain/shared/light";
import { api } from "../lib/api";
import { useInvalidateChains } from "../lib/queries";

export type PollState = "idle" | "polling" | "paid" | "failed" | "expired" | "timeout";

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
    (reference: string, timeoutMs: number, intervalMs = 1500) => {
      stop();
      const id = run.current;
      const deadline = Date.now() + timeoutMs;
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
        } catch {
          /* transient network error: keep polling until the deadline */
        }
        if (Date.now() >= deadline) return setState("timeout");
        timer.current = setTimeout(() => void tick(), intervalMs);
      };
      void tick();
    },
    [invalidate, stop],
  );

  return { state, status, start, reset: () => (stop(), setState("idle")) };
}
