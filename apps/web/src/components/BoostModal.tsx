import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  parseChannelUrl,
  type BoostPlanDTO,
  type ChainDTO,
  type StarsInvoiceDTO,
} from "@storychain/shared/light";
import { api, ApiError } from "../lib/api";
import { STARS_POLL_MS, TON_POLL_MS, type PayPanelProps } from "../lib/boostPay";
import { useI18n, type DictKey } from "../lib/i18n";
import { usePatchChain, usePlans } from "../lib/queries";
import { tg } from "../lib/tg";
import { usePaymentPolling, type PollState } from "../hooks/usePaymentPolling";
import { Button, Skeleton } from "./ui";

// Build-time branches: mock code never ships to production, TonConnect never loads in mock builds.
const MockGrmPanel: ComponentType<PayPanelProps> | null =
  import.meta.env.VITE_DEV_MOCK === "true" ? lazy(() => import("../mock/MockGrmPanel")) : null;
const TonPay: ComponentType<PayPanelProps> | null =
  import.meta.env.VITE_DEV_MOCK === "true" ? null : lazy(() => import("../ton/TonPay"));

// Warm the TonConnect chunk on hover/focus so the click feels instant (no-op in mock builds)
const preloadTon = () => {
  if (import.meta.env.VITE_DEV_MOCK !== "true") void import("../ton/TonPay");
};

/** The channel field: "" = no channel; returns the normalized URL, null for empty, undefined when invalid. */
export function readChannelInput(raw: string): string | null | undefined {
  const r = parseChannelUrl(raw);
  return r.ok ? r.value : undefined;
}

const PLAN_LABEL: Record<string, DictKey> = { boost_24h: "plan24h", boost_7d: "plan7d" };

export interface BoostFormProps {
  chain: Pick<ChainDTO, "title">;
  plans: BoostPlanDTO[];
  /** payment methods allowed on this platform (the server already filtered them) */
  methods: Array<"stars" | "ton_grm">;
  planId: string;
  onPlan: (id: string) => void;
  channel: string;
  onChannel: (v: string) => void;
  channelError: string | null;
  busy: boolean;
  onPayStars: () => void;
  /** the GRM payment UI (mock panel / real wallet flow), rendered only when GRM is allowed */
  grm: ReactNode;
}

/** Presentational part of the modal: plan, channel link, payment buttons. */
export function BoostForm(p: BoostFormProps) {
  const { t } = useI18n();
  const selected = p.plans.find((x) => x.id === p.planId) ?? p.plans[0];
  return (
    <div className="space-y-4">
      <p className="text-sm text-tg-hint">{t("boostModalIntro", { title: p.chain.title })}</p>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">{t("boostPickPlan")}</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {p.plans.map((plan) => {
            const on = plan.id === p.planId;
            return (
              <label
                key={plan.id}
                className={`cursor-pointer rounded-xl p-3 text-center ${on ? "bg-tg-button text-tg-button-text" : "bg-tg-secondary"}`}
              >
                <input
                  type="radio"
                  name="boost-plan"
                  value={plan.id}
                  checked={on}
                  onChange={() => p.onPlan(plan.id)}
                  className="sr-only"
                  data-testid={`plan-${plan.id}`}
                />
                <span className="block font-semibold">{t(PLAN_LABEL[plan.id] ?? "plan24h")}</span>
                <span className={`block text-sm ${on ? "" : "text-tg-hint"}`}>
                  {plan.prices.stars} ⭐
                  {p.methods.includes("ton_grm") ? ` · ${plan.prices.grm.display}` : ""}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="block space-y-1">
        <span className="text-sm font-semibold">{t("channelLabel")}</span>
        <input
          className="w-full rounded-xl bg-tg-secondary px-4 py-3 outline-none focus:ring-2 focus:ring-tg-button"
          value={p.channel}
          maxLength={100}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("channelPlaceholder")}
          aria-invalid={p.channelError ? true : undefined}
          aria-describedby="channel-hint"
          data-testid="channel-input"
          onChange={(e) => p.onChannel(e.target.value)}
        />
        <span id="channel-hint" className="block text-xs text-tg-hint">
          {t("channelHint")}
        </span>
        {p.channelError && (
          <span role="alert" className="block text-sm text-tg-destructive">
            {p.channelError}
          </span>
        )}
      </label>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("payTitle")}</h3>
        {p.methods.includes("stars") && (
          <Button
            className="w-full"
            disabled={p.busy || !selected}
            onClick={p.onPayStars}
            data-testid="pay-stars"
          >
            {t("payStars", { amount: selected?.prices.stars ?? "" })}
          </Button>
        )}
        {p.methods.includes("ton_grm") ? (
          p.grm
        ) : (
          <p className="text-center text-sm text-tg-hint" data-testid="grm-unavailable">
            {t("grmUnavailableHere")}
          </p>
        )}
      </div>
    </div>
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

/**
 * Boost purchase flow for a chain the viewer created. Code-split (lazy from Chain / Profile) together with
 * the TonConnect bits. Stars: tg.openInvoice then SERVER polling; GRM: TonConnect Jetton transfer (real) or the
 * simulation panel (mock). The client-reported payment status is never trusted.
 */
export default function BoostModal({ chain, onClose }: { chain: ChainDTO; onClose: () => void }) {
  const { t, lang, err } = useI18n();
  const plans = usePlans();
  const patch = usePatchChain(chain.id);
  const poll = usePaymentPolling();
  const [planId, setPlanId] = useState("boost_24h");
  const [channel, setChannel] = useState(chain.channelUrl ?? "");
  const [channelError, setChannelError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [grmOpen, setGrmOpen] = useState(false);
  const [lastRef, setLastRef] = useState<{ ref: string; ms: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const busy = poll.state === "polling" || patch.isPending;
  const plan = plans.data?.boostPlans.find((p) => p.id === planId) ?? plans.data?.boostPlans[0];

  /** Validates the channel link and saves it BEFORE any payment starts (only when it changed). */
  const prepare = async (): Promise<boolean> => {
    setError(null);
    const value = readChannelInput(channel);
    if (value === undefined) {
      setChannelError(t("channelInvalid"));
      return false;
    }
    setChannelError(null);
    if (value !== (chain.channelUrl ?? null)) {
      try {
        await patch.mutateAsync({ channelUrl: value });
      } catch (e) {
        setChannelError(err(e instanceof ApiError ? e.code : "INTERNAL"));
        return false;
      }
    }
    return true;
  };

  const started = (reference: string, timeoutMs: number) => {
    setError(null);
    setCancelled(false);
    setLastRef({ ref: reference, ms: timeoutMs });
    poll.start(reference, timeoutMs);
  };

  const payStars = async () => {
    setCancelled(false);
    if (!plan || !(await prepare())) return;
    try {
      const inv = await api.post<StarsInvoiceDTO>("/api/payments/stars/invoice", {
        chainId: chain.id,
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

  const panel: PayPanelProps | null = plan
    ? { plan, chainId: chain.id, prepare, onStarted: started, onError: setError, disabled: busy }
    : null;

  const grm: ReactNode = !panel ? null : MockGrmPanel ? (
    <Suspense fallback={<Skeleton className="h-12" />}>
      <MockGrmPanel {...panel} />
    </Suspense>
  ) : grmOpen && TonPay ? (
    // TonConnect (~200 kB gz) is only downloaded once the user chooses GRM
    <Suspense fallback={<Skeleton className="h-12" />}>
      <TonPay {...panel} />
    </Suspense>
  ) : (
    <Button
      variant="secondary"
      className="w-full"
      onClick={() => setGrmOpen(true)}
      onPointerEnter={preloadTon}
      onFocus={preloadTon}
      data-testid="open-grm"
    >
      {t("payWithGrm")}
    </Button>
  );

  const boostedUntil = poll.status?.boostedUntil
    ? new Date(poll.status.boostedUntil).toLocaleString(lang, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="boost-title"
        data-testid="boost-modal"
        className="max-h-[92dvh] w-full max-w-[480px] space-y-4 overflow-y-auto rounded-t-3xl bg-tg-bg p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-tg-text"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3">
          <h2 id="boost-title" className="text-xl font-bold">
            🔥 {t("boostModalTitle")}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-full bg-tg-secondary px-3 py-1 text-lg leading-none"
          >
            ×
          </button>
        </header>

        {poll.state === "paid" ? (
          <div className="space-y-3 text-center" data-testid="boost-success">
            <p className="text-xl font-bold">🎉</p>
            <p className="font-semibold">{t("boostSuccess", { date: boostedUntil })}</p>
            <Button className="w-full" onClick={onClose}>
              {t("boostDone")}
            </Button>
          </div>
        ) : plans.isPending ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-20" />
            <Skeleton className="h-12" />
          </div>
        ) : plans.isError || !plans.data ? (
          <p role="alert" className="text-center text-tg-destructive">
            {err(plans.error instanceof ApiError ? plans.error.code : "INTERNAL")}
          </p>
        ) : (
          <BoostForm
            chain={chain}
            plans={plans.data.boostPlans}
            methods={plans.data.methods}
            planId={planId}
            onPlan={setPlanId}
            channel={channel}
            onChannel={(v) => {
              setChannel(v);
              setChannelError(null);
            }}
            channelError={channelError}
            busy={busy}
            onPayStars={() => void payStars()}
            grm={grm}
          />
        )}

        <PollMessage
          state={poll.state}
          onCheck={() => lastRef && poll.start(lastRef.ref, lastRef.ms || TON_POLL_MS)}
        />
        {cancelled && <p className="text-center text-tg-hint">{t("payCancelled")}</p>}
        {error && (
          <p role="alert" className="text-center text-tg-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
