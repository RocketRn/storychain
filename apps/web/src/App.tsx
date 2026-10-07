import { lazy, Suspense, useEffect, useMemo, useRef, type ComponentType } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseStartParam } from "@storychain/shared";
import { detectLang, I18nContext, makeI18n } from "./lib/i18n";
import { tg } from "./lib/tg";
import { Home } from "./screens/Home";
import { ChainScreen } from "./screens/Chain";
import { CreateChain } from "./screens/CreateChain";
import { Placeholder } from "./screens/Placeholder";
import { EmptyState, Skeleton } from "./components/ui";
import { useBackButton } from "./hooks/useTgButtons";
import { useSession } from "./lib/queries";

// Tree-shaken from production builds: the condition is a build-time constant.
const MockUI: ComponentType | null =
  import.meta.env.VITE_DEV_MOCK === "true" ? lazy(() => import("./mock/MockUI")) : null;

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } },
});

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

function Shell() {
  useBackButton();
  const session = useSession();
  const { pathname } = useLocation();
  // The mock BackButton is a DOM overlay; leave room for it (real Telegram renders it natively)
  const mockBackSpacer = MockUI !== null && pathname !== "/";
  return (
    <div
      className={`mx-auto min-h-dvh max-w-[480px] bg-tg-bg pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-tg-text`}
    >
      {mockBackSpacer && <div className="h-10" aria-hidden />}
      <StartParamRedirect />
      {session.isPending && !session.data ? (
        <div className="space-y-3 p-4" aria-busy="true">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-12" />
          <Skeleton className="h-28" />
        </div>
      ) : (
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreateChain />} />
          <Route path="/chain/:id" element={<ChainScreen />} />
          <Route path="/chain/:id/join" element={<Placeholder />} />
          <Route path="/pro" element={<Placeholder emoji="⭐" />} />
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
