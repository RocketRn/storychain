import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { tg } from "../lib/tg";
import { useChains, useSession } from "../lib/queries";
import { ApiError } from "../lib/api";
import { Button, Chip, EmptyState, ErrorState } from "../components/ui";
import { ChainCard, ChainCardSkeleton } from "../components/ChainCard";
import { useInfiniteSentinel } from "../hooks/useInfiniteSentinel";

export function Home() {
  const { t, err, lang } = useI18n();
  const session = useSession();
  const featured = useChains("featured");
  const trending = useChains("trending");
  const more = useInfiniteSentinel(
    () => void trending.fetchNextPage(),
    !!trending.hasNextPage && !trending.isFetchingNextPage,
  );

  const s = session.data;
  const date = s?.proUntil ? new Date(s.proUntil).toLocaleDateString(lang) : "";
  const left = s && s.dailyLimit !== null ? Math.max(0, s.dailyLimit - s.usedToday) : 0;
  const trendingItems = trending.data?.pages.flatMap((p) => p.items) ?? [];
  const featuredItems = featured.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <main className="space-y-6 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {t("homeHello", { name: s?.user.firstName ?? tg.user?.first_name ?? "" })}
          </h1>
          <p className="text-tg-hint">{t("homeSubtitle")}</p>
        </div>
        <Link
          to="/profile"
          aria-label={t("profileAria")}
          className="order-last flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tg-button text-lg font-bold text-tg-button-text"
        >
          {(s?.user.firstName ?? tg.user?.first_name ?? "?").slice(0, 1).toUpperCase()}
        </Link>
        {s && (
          <Link to="/pro" aria-label="PRO">
            {s.isPro ? (
              <Chip tone="pro">{t("proChip", { date })}</Chip>
            ) : (
              <Chip>{t("freeChip", { left })}</Chip>
            )}
          </Link>
        )}
      </header>

      <Link to="/create" className="block">
        <Button className="w-full">＋ {t("createChain")}</Button>
      </Link>

      <section aria-labelledby="featured-h">
        <h2 id="featured-h" className="mb-3 text-lg font-semibold">
          ⭐ {t("featured")}
        </h2>
        {featured.isError ? (
          <ErrorState
            message={err(featured.error instanceof ApiError ? featured.error.code : "INTERNAL")}
            onRetry={() => void featured.refetch()}
          />
        ) : (
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {featured.isPending
              ? [0, 1, 2].map((i) => <ChainCardSkeleton key={i} compact />)
              : featuredItems.map((c) => <ChainCard key={c.id} chain={c} compact />)}
          </div>
        )}
      </section>

      <section aria-labelledby="trending-h">
        <h2 id="trending-h" className="mb-3 text-lg font-semibold">
          🔥 {t("trending")}
        </h2>
        {trending.isError ? (
          <ErrorState
            message={err(trending.error instanceof ApiError ? trending.error.code : "INTERNAL")}
            onRetry={() => void trending.refetch()}
          />
        ) : trending.isPending ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <ChainCardSkeleton key={i} />
            ))}
          </div>
        ) : trendingItems.length === 0 ? (
          <EmptyState emoji="🪄" title={t("homeEmpty")} />
        ) : (
          <ul className="space-y-3">
            {trendingItems.map((c) => (
              <li key={c.id}>
                <ChainCard chain={c} />
              </li>
            ))}
          </ul>
        )}
        <div ref={more} className="h-8" />
        {trending.isFetchingNextPage && (
          <p className="text-center text-sm text-tg-hint">{t("loading")}</p>
        )}
      </section>
    </main>
  );
}
