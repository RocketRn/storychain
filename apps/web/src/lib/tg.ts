/**
 * Typed facade over Telegram.WebApp. Components must import ONLY from here.
 * In production it delegates to window.Telegram.WebApp; with VITE_DEV_MOCK=true to ./tgMock.
 */
import { applyTheme } from "./theme";

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export type HapticImpact = "light" | "medium" | "heavy" | "rigid" | "soft";
export type HapticNotification = "error" | "success" | "warning";
export type InvoiceStatus = "paid" | "cancelled" | "failed" | "pending";

export interface StoryParams {
  text?: string;
  widget_link?: { url: string; name?: string };
}

export interface TgBackButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): () => void;
}

export interface TgMainButton {
  setText(text: string): void;
  show(): void;
  hide(): void;
  enable(): void;
  disable(): void;
  showProgress(): void;
  hideProgress(): void;
  onClick(cb: () => void): () => void;
}

export interface TgFacade {
  readonly initData: string;
  readonly startParam: string | null;
  readonly user: TgUser | null;
  readonly platform: string;
  readonly colorScheme: "light" | "dark";
  readonly themeParams: Readonly<Record<string, string>>;
  readonly version: string;
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  shareToStory(mediaUrl: string, params?: StoryParams): void;
  openInvoice(url: string, cb: (status: InvoiceStatus) => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  /** Optional: only on newer clients (Bot API 8.0+) */
  downloadFile?(params: { url: string; file_name: string }, cb?: (accepted: boolean) => void): void;
  showAlert(message: string): Promise<void>;
  showConfirm(message: string): Promise<boolean>;
  BackButton: TgBackButton;
  MainButton: TgMainButton;
  HapticFeedback: {
    impact(style: HapticImpact): void;
    notification(type: HapticNotification): void;
    selection(): void;
  };
}

// ---- minimal typing of the official SDK global (kept private to this file) ----
interface WebAppButton {
  setText(t: string): void;
  show(): void;
  hide(): void;
  enable(): void;
  disable(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}
interface WebApp {
  initData: string;
  initDataUnsafe: { user?: TgUser; start_param?: string };
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  version: string;
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  shareToStory(url: string, params?: StoryParams): void;
  openInvoice(url: string, cb: (s: InvoiceStatus) => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  downloadFile?(p: { url: string; file_name: string }, cb?: (a: boolean) => void): void;
  showAlert(m: string, cb?: () => void): void;
  showConfirm(m: string, cb?: (ok: boolean) => void): void;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  MainButton: WebAppButton;
  HapticFeedback: TgFacade["HapticFeedback"];
}
declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

/** start_param: initDataUnsafe first, then tgWebAppStartParam from the query or the hash. */
export function readStartParam(
  wa: { initDataUnsafe?: { start_param?: string } } | undefined,
): string | null {
  const fromSdk = wa?.initDataUnsafe?.start_param;
  if (fromSdk) return fromSdk;
  const q = new URLSearchParams(window.location.search).get("tgWebAppStartParam");
  if (q) return q;
  const h = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("tgWebAppStartParam");
  return h || null;
}

function createRealTg(): TgFacade {
  const wa = window.Telegram?.WebApp;
  if (!wa) throw new Error("Telegram.WebApp is not available. Open the app inside Telegram.");
  const btn = <T extends { onClick(cb: () => void): void; offClick(cb: () => void): void }>(
    b: T,
  ) => ({
    onClick(cb: () => void) {
      b.onClick(cb);
      return () => b.offClick(cb);
    },
  });
  const facade: TgFacade = {
    initData: wa.initData,
    startParam: readStartParam(wa),
    user: wa.initDataUnsafe.user ?? null,
    platform: wa.platform || "unknown",
    colorScheme: wa.colorScheme,
    themeParams: wa.themeParams,
    version: wa.version,
    isVersionAtLeast: (v) => wa.isVersionAtLeast(v),
    ready: () => wa.ready(),
    expand: () => wa.expand(),
    shareToStory: (u, p) => wa.shareToStory(u, p),
    openInvoice: (u, cb) => wa.openInvoice(u, cb),
    openTelegramLink: (u) => wa.openTelegramLink(u),
    openLink: (u) => wa.openLink(u),
    showAlert: (m) => new Promise((res) => wa.showAlert(m, () => res())),
    showConfirm: (m) => new Promise((res) => wa.showConfirm(m, (ok) => res(ok))),
    BackButton: {
      show: () => wa.BackButton.show(),
      hide: () => wa.BackButton.hide(),
      ...btn(wa.BackButton),
    },
    MainButton: {
      setText: (t) => wa.MainButton.setText(t),
      show: () => wa.MainButton.show(),
      hide: () => wa.MainButton.hide(),
      enable: () => wa.MainButton.enable(),
      disable: () => wa.MainButton.disable(),
      showProgress: () => wa.MainButton.showProgress(false),
      hideProgress: () => wa.MainButton.hideProgress(),
      ...btn(wa.MainButton),
    },
    HapticFeedback: wa.HapticFeedback,
  };
  if (wa.downloadFile) facade.downloadFile = (p, cb) => wa.downloadFile?.(p, cb);
  return facade;
}

let impl: TgFacade | undefined;

/** Components use this object; it forwards to the real or mock implementation chosen at startup. */
export const tg: TgFacade = new Proxy({} as TgFacade, {
  get(_t, key: string) {
    if (!impl) throw new Error("initTelegram() was not called");
    return (impl as unknown as Record<string, unknown>)[key];
  },
  has(_t, key: string) {
    return !!impl && key in impl;
  },
});

export async function initTelegram(): Promise<void> {
  if (import.meta.env.VITE_DEV_MOCK === "true") {
    // Statically replaced at build time: this branch (and ./tgMock) is dropped from production bundles.
    const { createMockTg } = await import("./tgMock");
    impl = await createMockTg();
  } else {
    impl = createRealTg();
  }
  impl.ready();
  impl.expand();
  applyTheme(impl);
}
