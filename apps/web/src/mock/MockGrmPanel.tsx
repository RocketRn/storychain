/** Mock-only replacement for the TonConnect wallet flow. Exercises /payments/ton/intent, polling and the PRO grant. */
import { useState } from "react";
import type { TonIntentDTO } from "@storychain/shared";
import { fromUnits } from "@storychain/shared";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui";
import type { PayPanelProps } from "../screens/Paywall";
import { TON_POLL_MS } from "../screens/Paywall";

const base = import.meta.env.VITE_API_URL ?? "";

export default function MockGrmPanel({ plan, onStarted, onError, disabled }: PayPanelProps) {
  const [intent, setIntent] = useState<TonIntentDTO | null>(null);

  const create = async () => {
    try {
      setIntent(await api.post<TonIntentDTO>("/api/payments/ton/intent", { planId: plan.id }));
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "intent failed");
    }
  };

  const simulate = async () => {
    if (!intent) return;
    const res = await fetch(`${base}/api/dev/payments/${intent.reference}/complete`, {
      method: "POST",
    });
    if (!res.ok) return onError(`dev complete failed (${res.status})`);
    onStarted(intent.reference, TON_POLL_MS);
  };

  return (
    <section
      aria-label="Simulate GRM payment"
      className="space-y-2 rounded-2xl border border-dashed border-tg-hint p-3"
      data-testid="mock-grm"
    >
      <h2 className="text-sm font-semibold">🧪 Simulate GRM payment (mock)</h2>
      {!intent ? (
        <Button
          variant="secondary"
          className="w-full"
          disabled={disabled}
          onClick={() => void create()}
          data-testid="grm-create"
        >
          Pay {plan.grm.human} GRM
        </Button>
      ) : (
        <>
          <dl
            className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
            data-testid="grm-intent"
          >
            <dt className="text-tg-hint">reference</dt>
            <dd className="break-all font-mono">{intent.reference}</dd>
            <dt className="text-tg-hint">amount</dt>
            <dd>
              {fromUnits(intent.amount, intent.decimals)} GRM ({intent.amount} units)
            </dd>
            <dt className="text-tg-hint">merchant</dt>
            <dd className="break-all">
              {intent.merchantAddress || "(TON_MERCHANT_ADDRESS not needed in mock mode)"}
            </dd>
            <dt className="text-tg-hint">jetton</dt>
            <dd className="break-all">{intent.jettonMaster}</dd>
            <dt className="text-tg-hint">expires</dt>
            <dd>{new Date(intent.expiresAt).toLocaleTimeString()}</dd>
          </dl>
          <Button
            className="w-full"
            disabled={disabled}
            onClick={() => void simulate()}
            data-testid="grm-simulate"
          >
            Simulate GRM payment
          </Button>
        </>
      )}
    </section>
  );
}
