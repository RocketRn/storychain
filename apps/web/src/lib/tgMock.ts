/**
 * Mock Telegram.WebApp for plain desktop browsers (VITE_DEV_MOCK=true). Never part of production bundles.
 * Identity/context via query params (persisted in localStorage so SPA navigation keeps them):
 *   ?mock_user=2  ?mock_premium=1  ?mock_start_param=chain_abc12345  ?mock_platform=tdesktop|ios|android  ?mock_lang=en
 */
import { readStartParam, type InvoiceStatus, type StoryParams, type TgFacade } from "./tg";

export const MOCK_USER_BASE = 1_000_000;

export interface MockState {
  userN: number;
  premium: boolean;
  platform: string;
  lang: string;
}

const KEY = "storychain.mock";
const DEFAULTS: MockState = { userN: 1, premium: false, platform: "tdesktop", lang: "ru" };

function loadState(): MockState {
  let saved: Partial<MockState> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<MockState>;
  } catch {
    /* ignore corrupt storage */
  }
  const q = new URLSearchParams(window.location.search);
  const state: MockState = { ...DEFAULTS, ...saved };
  if (q.has("mock_user")) state.userN = Math.max(1, Number(q.get("mock_user")) || 1);
  if (q.has("mock_premium")) state.premium = q.get("mock_premium") === "1";
  if (q.has("mock_platform")) state.platform = q.get("mock_platform") ?? state.platform;
  if (q.has("mock_lang")) state.lang = q.get("mock_lang") ?? state.lang;
  saveState(state);
  return state;
}

export function saveState(s: MockState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: state is per page load only */
  }
}

export const getMockState = (): MockState => loadState();

/** Persist a change, drop identity query params so they don't override it, and reload. */
export function updateMockState(patch: Partial<MockState>): void {
  saveState({ ...loadState(), ...patch });
  const url = new URL(window.location.href);
  for (const k of ["mock_user", "mock_premium", "mock_platform", "mock_lang"])
    url.searchParams.delete(k);
  window.location.replace(url.toString());
}

// ---- tiny external store so DOM mocks of Main/Back buttons can render ----
export interface MockUiState {
  back: { visible: boolean };
  main: { visible: boolean; text: string; enabled: boolean; progress: boolean };
  story: { mediaUrl: string; params?: StoryParams } | null;
  invoice: { url: string; cb: (s: InvoiceStatus) => void } | null;
}
let ui: MockUiState = {
  back: { visible: false },
  main: { visible: false, text: "", enabled: true, progress: false },
  story: null,
  invoice: null,
};
const listeners = new Set<() => void>();
const backCbs = new Set<() => void>();
const mainCbs = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const patch = (p: Partial<MockUiState>) => {
  ui = { ...ui, ...p };
  emit();
};

export const mockUi = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  getSnapshot: () => ui,
  clickBack: () => backCbs.forEach((c) => c()),
  clickMain: () => {
    if (ui.main.enabled && !ui.main.progress) mainCbs.forEach((c) => c());
  },
  closeStory: () => patch({ story: null }),
  resolveInvoice(status: InvoiceStatus) {
    const inv = ui.invoice;
    patch({ invoice: null });
    inv?.cb(status);
  },
};

async function fetchInitData(s: MockState, startParam: string | null): Promise<string> {
  const base = import.meta.env.VITE_API_URL ?? "";
  const res = await fetch(`${base}/api/dev/init-data`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      userId: MOCK_USER_BASE + s.userN,
      isPremium: s.premium,
      languageCode: s.lang,
      ...(startParam ? { startParam } : {}),
    }),
  });
  if (!res.ok)
    throw new Error(
      `Mock: /api/dev/init-data failed (${res.status}). Is the API running with DEV_MODE=true?`,
    );
  return ((await res.json()) as { initData: string }).initData;
}

export async function createMockTg(): Promise<TgFacade> {
  const s = loadState();
  const qp = new URLSearchParams(window.location.search).get("mock_start_param");
  const startParam = qp ?? readStartParam(undefined);
  const initData = await fetchInitData(s, startParam);
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const themeParams = dark
    ? {
        bg_color: "#17212b",
        text_color: "#f5f5f5",
        hint_color: "#708499",
        link_color: "#6ab3f3",
        button_color: "#5288c1",
        button_text_color: "#ffffff",
        secondary_bg_color: "#232e3c",
      }
    : {
        bg_color: "#ffffff",
        text_color: "#000000",
        hint_color: "#707579",
        link_color: "#3390ec",
        button_color: "#3390ec",
        button_text_color: "#ffffff",
        secondary_bg_color: "#f4f4f5",
      };

  const sub = (set: Set<() => void>) => (cb: () => void) => {
    set.add(cb);
    return () => void set.delete(cb);
  };
  const log = (name: string, ...args: unknown[]) => console.info(`[tgMock] ${name}`, ...args);

  return {
    initData,
    startParam,
    user: {
      id: MOCK_USER_BASE + s.userN,
      first_name: `Mock ${s.userN}`,
      username: `demo_user_${MOCK_USER_BASE + s.userN}`,
      language_code: s.lang,
      is_premium: s.premium,
    },
    platform: s.platform,
    colorScheme: dark ? "dark" : "light",
    themeParams,
    version: "9.0",
    isVersionAtLeast: () => true,
    ready: () => log("ready"),
    expand: () => log("expand"),
    shareToStory(mediaUrl, params) {
      log("shareToStory", mediaUrl, params);
      patch({ story: { mediaUrl, ...(params ? { params } : {}) } });
    },
    openInvoice(url, cb) {
      log("openInvoice", url);
      patch({ invoice: { url, cb } });
    },
    openTelegramLink: (url) => log("openTelegramLink", url),
    openLink: (url) => void window.open(url, "_blank", "noopener"),
    showAlert: async (m) => void window.alert(m),
    showConfirm: async (m) => window.confirm(m),
    BackButton: {
      show: () => patch({ back: { visible: true } }),
      hide: () => patch({ back: { visible: false } }),
      onClick: sub(backCbs),
    },
    MainButton: {
      setText: (text) => patch({ main: { ...ui.main, text } }),
      show: () => patch({ main: { ...ui.main, visible: true } }),
      hide: () => patch({ main: { ...ui.main, visible: false } }),
      enable: () => patch({ main: { ...ui.main, enabled: true } }),
      disable: () => patch({ main: { ...ui.main, enabled: false } }),
      showProgress: () => patch({ main: { ...ui.main, progress: true } }),
      hideProgress: () => patch({ main: { ...ui.main, progress: false } }),
      onClick: sub(mainCbs),
    },
    HapticFeedback: {
      impact: (x) => log("haptic.impact", x),
      notification: (x) => log("haptic.notification", x),
      selection: () => log("haptic.selection"),
    },
  };
}
