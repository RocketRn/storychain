import { lazy, Suspense, useEffect, useMemo, useRef, type ComponentType } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { parseStartParam } from "@storychain/shared/light";
import { detectLang, I18nContext, makeI18n, useI18n } from "./lib/i18n";
import { tg } from "./lib/tg";
import { Home } from "./screens/Home";
import { ChainScreen } from "./screens/Chain";
import { CreateChain } from "./screens/CreateChain";
import { Profile } from "./screens/Profile";

// The editor (canvas, fonts, templates) is code-split: it is only needed when joining a chain
const Editor = lazy(() => import("./screens/Editor"));
import { Button, EmptyState, Skeleton } from "./components/ui";
import { useBackButton } from "./hooks/useTgButtons";
import { useSessionExpired } from "./lib/auth";
import { createQueryClient, useSession } from "./lib/queries";

// Tree-shaken from production builds: the condition is a build-time constant.
const MockUI: ComponentType | null =
  import.meta.env.VITE_DEV_MOCK === "true" ? lazy(() => import("./mock/MockUI")) : null;

const queryClient = createQueryClient();

/** Routes `start_param=chain_<id>` to /chain/:id exactly once per app launch. */
function StartParamRedirect() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const id = parseStartParam(tg.startParam);
    if (id && pathname === "/") navigate(`/chain/${id}`, { replace: true });
  }, [navigate, pathname]);
  return null;
}

/** The server no longer accepts our Telegram credentials; only reopening the app issues new ones. */
function SessionExpired() {
  const { t, err } = useI18n();
  return (
    <EmptyState
      emoji="🔒"
      title={t("errorTitle")}
      text={err("UNAUTHORIZED")}
      action={<Button onClick={() => tg.close()}>{t("close")}</Button>}
    />
  );
}

function Shell() {
  useBackButton();
  // Started here so it runs in PARALLEL with the screen's own requests. The screens only read it for the
  // user's name and the creator check, and every API call authenticates by itself, so nothing waits for it.
  useSession();
  const expired = useSessionExpired();
  const { pathname } = useLocation();
  // The mock BackButton is a DOM overlay; leave room for it (real Telegram renders it natively)
  const mockBackSpacer = MockUI !== null && pathname !== "/";
  return (
    <div
      className={`mx-auto min-h-dvh max-w-[480px] bg-tg-bg pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-tg-text`}
    >
      {mockBackSpacer && <div className="h-10" aria-hidden />}
      <StartParamRedirect />
      {expired ? (
        <SessionExpired />
      ) : (
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreateChain />} />
          <Route path="/chain/:id" element={<ChainScreen />} />
          <Route
            path="/chain/:id/join"
            element={
              <Suspense fallback={<Skeleton className="m-4 h-64" />}>
                <Editor />
              </Suspense>
            }
          />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
      {MockUI && (
        <Suspense fallback={null}>
          <MockUI />
        </Suspense>
      )}
    </div>
  );
}

export function App() {
  const i18n = useMemo(() => makeI18n(detectLang(tg.user?.language_code)), []);
  return (
    <I18nContext.Provider value={i18n}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </QueryClientProvider>
    </I18nContext.Provider>
  );
}

export function BootError({ message }: { message: string }) {
  return <EmptyState emoji="⚠️" title="StoryChain" text={message} />;
}
