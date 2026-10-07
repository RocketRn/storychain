import { Link, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { ApiError } from "../lib/api";
import { useChain, useChainPosts } from "../lib/queries";
import { Button, EmptyState, ErrorState, Skeleton } from "../components/ui";
import { useInfiniteSentinel } from "../hooks/useInfiniteSentinel";

export function ChainScreen() {
  const { id = "" } = useParams();
  const { t, plural, err } = useI18n();
  const navigate = useNavigate();
  const chain = useChain(id);
  const posts = useChainPosts(id, chain.isSuccess);
  const more = useInfiniteSentinel(
    () => void posts.fetchNextPage(),
    !!posts.hasNextPage && !posts.isFetchingNextPage,
  );

  if (chain.isPending) return <ChainSkeleton />;
  if (chain.isError) {
    const e = chain.error;
    if (e instanceof ApiError && e.status === 404) {
      return (
        <EmptyState
          emoji="🔍"
          title={t("chainNotFoundTitle")}
          text={t("chainNotFoundText")}
          action={
            <Link to="/">
              <Button>{t("browseChains")}</Button>
            </Link>
          }
        />
      );
    }
    return (
      <ErrorState
        message={err(e instanceof ApiError ? e.code : "INTERNAL")}
        onRetry={() => void chain.refetch()}
      />
    );
  }

  const { chain: c, hasJoined } = chain.data;
  // The first page comes with the chain detail; further pages via the infinite query
  const items = posts.data ? posts.data.pages.flatMap((p) => p.items) : chain.data.posts.items;

  return (
    <main className="pb-28">
      <header className="space-y-2 p-4">
        <div className="text-4xl" aria-hidden>
          {c.emoji ?? "🔗"}
        </div>
        <h1 className="text-2xl font-bold">{c.title}</h1>
        {c.description && <p className="text-tg-hint">{c.description}</p>}
        <p className="text-sm text-tg-hint">
          {plural("participants", c.postsCount)} · {t("by", { name: c.creator.firstName })}
        </p>
        <Button className="mt-2 w-full" onClick={() => navigate(`/chain/${c.id}/join`)}>
          {hasJoined ? `↗ ${t("joinedShare")}` : `✨ ${t("join")}`}
        </Button>
      </header>

      {items.length === 0 ? (
        <EmptyState emoji="📸" title={t("galleryEmpty")} />
      ) : (
        <ul className="grid grid-cols-3 gap-1.5 px-1.5" aria-label="gallery">
          {items.map((p) => (
            <li
              key={p.id}
              className="relative aspect-[9/16] overflow-hidden rounded-lg bg-tg-secondary"
            >
              <img
                src={p.thumbUrl}
                alt={`#${p.position} · ${p.user.firstName}`}
                loading="lazy"
                decoding="async"
                width={360}
                height={640}
                className="h-full w-full object-cover"
              />
              <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-2 py-0.5 text-xs font-semibold text-white">
                #{p.position}
              </span>
              {p.isMine && (
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-tg-button px-2 py-0.5 text-xs text-tg-button-text">
                  {t("you")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div ref={more} className="h-8" />
      {posts.isFetchingNextPage && (
        <p className="text-center text-sm text-tg-hint">{t("loading")}</p>
      )}
    </main>
  );
}

function ChainSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-busy="true">
      <Skeleton className="h-10 w-10" />
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-5 w-1/2" />
      <div className="grid grid-cols-3 gap-1.5 pt-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="aspect-[9/16]" />
        ))}
      </div>
    </div>
  );
}
