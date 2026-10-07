import "./polyfill";
import { useState } from "react";
import {
  TonConnectButton,
  TonConnectUIProvider,
  useTonConnectUI,
  useTonWallet,
} from "@tonconnect/ui-react";
import type { TonIntentDTO } from "@storychain/shared/light";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button } from "../components/ui";
import type { PayPanelProps } from "../screens/Paywall";
import { TON_POLL_MS } from "../screens/Paywall";
import { buildTransferRequest } from "./jettonTransfer";

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

function TonPayInner({ plan, onStarted, onError, disabled }: PayPanelProps) {
  const { t, err } = useI18n();
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  const [busy, setBusy] = useState(false);

  const pay = async () => {
    if (!wallet) return;
    setBusy(true);
    try {
      // 1. our server creates the order (reference + amounts + merchant)
      const intent = await api.post<TonIntentDTO>("/api/payments/ton/intent", { planId: plan.id });
      // 2. the sender's Jetton wallet is resolved server-side (no third-party API keys in the browser)
      const { jettonWallet } = await api.get<{ jettonWallet: string }>(
        `/api/ton/jetton-wallet?owner=${encodeURIComponent(wallet.account.address)}`,
      );
      // 3. TEP-74 transfer with our reference as the forward-payload comment
      const request = buildTransferRequest({
        intent,
        sender: wallet.account.address,
        jettonWallet,
        testOnly: wallet.account.chain === "-3",
      });
      let boc: string | undefined;
      try {
        boc = (await tonConnectUI.sendTransaction(request)).boc;
      } catch {
        onError(t("walletRejected"));
        return;
      }
      // 4. ask the server to look at the chain right away; then it is all server-side polling
      await api.post("/api/payments/ton/confirm", {
        reference: intent.reference,
        ...(boc ? { boc } : {}),
      });
      onStarted(intent.reference, TON_POLL_MS);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) onError(t("noGrm"));
      else onError(err(e instanceof ApiError ? e.code : "INTERNAL"));
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
        {t("payGrm", { amount: plan.grm.human })}
      </Button>
    </div>
  );
}
