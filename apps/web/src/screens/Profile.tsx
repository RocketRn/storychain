import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import type { ChainDTO } from "@storychain/shared/light";
import { useI18n } from "../lib/i18n";
import { ApiError } from "../lib/api";
import {
  flattenPages,
  useMyChains,
  useMyPosts,
  usePrefetchPlans,
  useSession,
} from "../lib/queries";
import { Button, Chip, EmptyState, ErrorState, Skeleton } from "../components/ui";
import { useInfiniteSentinel } from "../hooks/useInfiniteSentinel";

// The boost flow (and TonConnect inside it) is only downloaded when the creator opens it
const BoostModal = lazy(() => import("../components/BoostModal"));

/** Minimal profile: who I am, the marathons I created (with boost status) and the posts I published. */
export function Profile() {
  const { t, err, lang, plural } = useI18n();
  const session = useSession();
  const posts = useMyPosts();
  const chains = useMyChains();
  const [boosting, setBoosting] = useState<ChainDTO | null>(null);
  const more = useInfiniteSentinel(
    () => void posts.fetchNextPage(),
    !!posts.hasNextPage && !posts.isFetchingNextPage,
  );
  const s = session.data;
  const items = flattenPages(posts.data?.pages);
  const myChains = flattenPages(chains.data?.pages);
  usePrefetchPlans(myChains.length > 0); // each of them has a Boost button

  return (
    <main className="space-y-5 p-4">
      <header className="flex items-center gap-3">
        <div
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-full bg-tg-button text-2xl font-bold text-tg-button-text"
        >
          {(s?.user.firstName ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{s?.user.firstName ?? t("profileTitle")}</h1>
          {s?.user.username && <p className="truncate text-sm text-tg-hint">@{s.user.username}</p>}
        </div>
      </header>

      <section aria-labelledby="my-marathons-h">
        <h2 id="my-marathons-h" className="mb-3 text-lg font-semibold">
          {t("myMarathons")}
        </h2>
        {chains.isPending ? (
          <Skeleton className="h-20" />
        ) : chains.isError ? (
          <ErrorState
            message={err(chains.error instanceof ApiError ? chains.error.code : "INTERNAL")}
            onRetry={() => void chains.refetch()}
          />
        ) : myChains.length === 0 ? (
          <EmptyState
            emoji="🏁"
            title={t("noMarathons")}
            action={
              <Link to="/create">
                <Button>{t("createChain")}</Button>
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3" aria-label={t("myMarathons")}>
            {myChains.map((c) => (
              <li
                key={c.id}
                data-testid="my-marathon"
                className="flex items-center gap-3 rounded-2xl bg-tg-secondary p-3"
              >
                <Link to={`/chain/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="text-2xl" aria-hidden>
                    {c.emoji ?? "🔗"}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{c.title}</span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-tg-hint">
                      {plural("participants", c.postsCount)}
                      {c.isBoosted && <Chip tone="sponsored">🔥 {t("boostChip")}</Chip>}
                    </span>
                    {c.isBoosted && c.boostedUntil && (
                      <span className="block text-xs text-tg-hint">
                        {new Date(c.boostedUntil).toLocaleString(lang, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    )}
                  </span>
                </Link>
                <Button
                  variant="secondary"
                  className="shrink-0 px-3 py-2 text-sm"
                  onClick={() => setBoosting(c)}
                >
                  🔥 {t("boostAction")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="my-posts-h">
        <h2 id="my-posts-h" className="mb-3 text-lg font-semibold">
          {t("myPosts")}
        </h2>
        {posts.isPending ? (
          <div className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-[9/16]" />
            ))}
          </div>
        ) : posts.isError ? (
          <ErrorState
            message={err(posts.error instanceof ApiError ? posts.error.code : "INTERNAL")}
            onRetry={() => void posts.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            emoji="📷"
            title={t("noPostsYet")}
            action={
              <Link to="/">
                <Button>{t("browseChains")}</Button>
              </Link>
            }
          />
        ) : (
          <ul className="grid grid-cols-3 gap-1.5" aria-label={t("myPosts")}>
            {items.map((p) => (
              <li
                key={p.id}
                className="relative aspect-[9/16] overflow-hidden rounded-lg bg-tg-secondary"
              >
                <Link to={`/chain/${p.chain.id}`} aria-label={`${p.chain.title} #${p.position}`}>
                  <img
                    src={p.thumbUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={360}
                    height={640}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-1 text-[11px] text-white">
                    {p.chain.emoji ?? "🔗"} {p.chain.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div ref={more} className="h-8" />
      </section>

      {boosting && (
        <Suspense fallback={null}>
          <BoostModal chain={boosting} onClose={() => setBoosting(null)} />
        </Suspense>
      )}
    </main>
  );
}
