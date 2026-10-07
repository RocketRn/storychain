import { lazy, Suspense, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { FREE_DAILY_LIMIT, type PlanPriceDTO, type StarsInvoiceDTO } from "@storychain/shared";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { usePlans, useSession } from "../lib/queries";
import { tg } from "../lib/tg";
import { usePaymentPolling, type PollState } from "../hooks/usePaymentPolling";
import { Button, ErrorState, Skeleton } from "../components/ui";

// Both are build-time branches: mock code never ships to production, TonConnect never loads in mock builds.
const MockGrmPanel: ComponentType<PayPanelProps> | null =
  import.meta.env.VITE_DEV_MOCK === "true" ? lazy(() => import("../mock/MockGrmPanel")) : null;
const TonPay: ComponentType<PayPanelProps> | null =
  import.meta.env.VITE_DEV_MOCK === "true" ? null : lazy(() => import("../ton/TonPay"));

export interface PayPanelProps {
  plan: PlanPriceDTO;
  /** called with the new transaction reference to start server-side polling */
  onStarted: (reference: string, timeoutMs: number) => void;
  onError: (message: string) => void;
  disabled: boolean;
}

export const STARS_POLL_MS = 20_000;
export const TON_POLL_MS = 150_000;

export function Paywall() {
  const { t, lang, err } = useI18n();
  const session = useSession();
  const plans = usePlans();
  const poll = usePaymentPolling();
  const [error, setError] = useState<string | null>(null);
  const [lastRef, setLastRef] = useState<string | null>(null);
  const [lastMs, setLastMs] = useState(STARS_POLL_MS);
  const [cancelled, setCancelled] = useState(false);

  if (plans.isPending || session.isPending) {
    return (
      <div className="space-y-3 p-4" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40" />
        <Skeleton className="h-12" />
      </div>
    );
  }
  if (plans.isError || !plans.data?.plans[0]) {
    return (
      <ErrorState
        message={err(plans.error instanceof ApiError ? plans.error.code : "INTERNAL")}
        onRetry={() => void plans.refetch()}
      />
    );
  }

  const plan = plans.data.plans[0];
  const methods = plans.data.methods;
  const s = session.data;
  const proUntil = s?.proUntil ? new Date(s.proUntil) : null;
  const busy = poll.state === "polling";

  const started = (reference: string, timeoutMs: number) => {
    setError(null);
    setCancelled(false);
    setLastRef(reference);
    setLastMs(timeoutMs);
    poll.start(reference, timeoutMs);
  };

  const payStars = async () => {
    setError(null);
    setCancelled(false);
    try {
      const inv = await api.post<StarsInvoiceDTO>("/api/payments/stars/invoice", {
        planId: plan.id,
      });
      tg.openInvoice(inv.invoiceUrl, (status) => {
        // The client-side status is only a hint: the SERVER decides (polling GET /api/payments/:reference)
        if (status === "paid" || status === "pending") started(inv.reference, STARS_POLL_MS);
        else if (status === "cancelled") setCancelled(true);
        else setError(t("payFailed"));
      });
    } catch (e) {
      setError(err(e instanceof ApiError ? e.code : "INTERNAL"));
    }
  };

  const panel: PayPanelProps = { plan, onStarted: started, onError: setError, disabled: busy };

  return (
    <main className="space-y-5 p-4 pb-24">
      <header className="text-center">
        <div className="text-5xl" aria-hidden>
          ⭐
        </div>
        <h1 className="mt-2 text-2xl font-bold">{t("paywallTitle")}</h1>
        <p className="text-tg-hint">{t("paywallSubtitle")}</p>
      </header>

      <ul className="space-y-2 rounded-2xl bg-tg-secondary p-4" aria-label="PRO">
        <li>♾️ {t("benefitUnlimited", { n: FREE_DAILY_LIMIT })}</li>
        <li>🚫 {t("benefitNoWatermark")}</li>
        <li>🎨 {t("benefitPremium")}</li>
      </ul>

      {s?.isPro && proUntil && (
        <div
          role="status"
          data-testid="pro-status"
          className="rounded-xl bg-amber-400/20 p-3 text-center font-semibold"
        >
          ✅ {t("proActiveUntil", { date: proUntil.toLocaleDateString(lang) })}
          <div className="text-sm font-normal text-tg-hint">{t("extendHint")}</div>
        </div>
      )}

      <p className="text-center font-semibold">{t("planName")}</p>

      {poll.state === "paid" ? (
        <div className="space-y-3 text-center" data-testid="pay-success">
          <p className="text-xl font-bold">🎉 {t("paySuccess")}</p>
          <Link to="/">
            <Button className="w-full">{t("backHome")}</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {methods.includes("stars") && (
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => void payStars()}
              data-testid="pay-stars"
            >
              {t("payStars", { amount: plan.stars.amount })}
            </Button>
          )}
          {methods.includes("ton_grm") ? (
            <Suspense fallback={<Skeleton className="h-12" />}>
              {MockGrmPanel ? <MockGrmPanel {...panel} /> : TonPay ? <TonPay {...panel} /> : null}
            </Suspense>
          ) : (
            <p className="text-center text-sm text-tg-hint">{t("grmUnavailableHere")}</p>
          )}
        </div>
      )}

      <PollMessage state={poll.state} onCheck={() => lastRef && poll.start(lastRef, lastMs)} />
      {cancelled && <p className="text-center text-tg-hint">{t("payCancelled")}</p>}
      {error && (
        <p role="alert" className="text-center text-tg-destructive">
          {error}
        </p>
      )}
    </main>
  );
}

function PollMessage({ state, onCheck }: { state: PollState; onCheck: () => void }) {
  const { t } = useI18n();
  if (state === "polling")
    return (
      <p role="status" className="text-center text-tg-hint" data-testid="pay-processing">
        ⏳ {t("payProcessing")}
      </p>
    );
  if (state === "timeout")
    return (
      <div role="status" className="space-y-2 text-center" data-testid="pay-slow">
        <p className="text-tg-hint">{t("paySlow")}</p>
        <Button variant="secondary" onClick={onCheck}>
          {t("checkAgain")}
        </Button>
      </div>
    );
  if (state === "failed")
    return (
      <p role="alert" className="text-center text-tg-destructive">
        {t("payFailed")}
      </p>
    );
  if (state === "expired")
    return (
      <p role="alert" className="text-center text-tg-destructive">
        {t("payExpired")}
      </p>
    );
  return null;
}
