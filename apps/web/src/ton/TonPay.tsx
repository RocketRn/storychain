import "./polyfill";
import { useState } from "react";
import {
  TonConnectButton,
  TonConnectUIProvider,
  useTonConnectUI,
  useTonWallet,
} from "@tonconnect/ui-react";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button } from "../components/ui";
import { TON_POLL_MS, type PayPanelProps } from "../lib/boostPay";
import { startGrmPayment } from "./payFlow";

const bot = import.meta.env.VITE_BOT_USERNAME ?? "";
const short = import.meta.env.VITE_APP_SHORT_NAME ?? "";
const manifestUrl =
  import.meta.env.VITE_TONCONNECT_MANIFEST_URL ||
  `${window.location.origin}/tonconnect-manifest.json`;
// Wallets send the user back to the Mini App after signing
const twaReturnUrl = (bot ? `https://t.me/${bot}${short ? `/${short}` : ""}` : undefined) as
  `${string}://${string}` | undefined;

/** Real GRM payment through TonConnect. Loaded lazily (own chunk) and never part of the mock build. */
export default function TonPay(props: PayPanelProps) {
  return (
    <TonConnectUIProvider
      manifestUrl={manifestUrl}
      actionsConfiguration={twaReturnUrl ? { twaReturnUrl } : {}}
    >
      <TonPayInner {...props} />
    </TonConnectUIProvider>
  );
}

function TonPayInner({ plan, chainId, prepare, onStarted, onError, disabled }: PayPanelProps) {
  const { t, err } = useI18n();
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  const [busy, setBusy] = useState(false);

  const pay = async () => {
    if (!wallet) return;
    if (!(await prepare())) return;
    setBusy(true);
    try {
      const result = await startGrmPayment(
        {
          api,
          send: (request) => tonConnectUI.sendTransaction(request),
          wallet: { address: wallet.account.address, testnet: wallet.account.chain === "-3" },
        },
        { chainId, planId: plan.id },
      );
      if (result.ok) onStarted(result.reference, TON_POLL_MS);
      else onError(t(result.reason === "no_grm" ? "noGrm" : "walletRejected"));
    } catch (e) {
      onError(err(e instanceof ApiError ? e.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  if (!wallet) {
    return (
      <div className="flex flex-col items-center gap-2" data-testid="ton-connect">
        <TonConnectButton />
        <span className="text-xs text-tg-hint">{t("connectWallet")}</span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        className="w-full"
        disabled={disabled || busy}
        onClick={() => void pay()}
        data-testid="pay-grm"
      >
        {t("payGrm", { amount: plan.prices.grm.display })}
      </Button>
    </div>
  );
}
