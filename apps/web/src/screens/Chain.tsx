import { lazy, Suspense, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { ApiError } from "../lib/api";
import { useChain, useChainPosts, useSession } from "../lib/queries";
import { Button, EmptyState, ErrorState, Skeleton } from "../components/ui";
import { useInfiniteSentinel } from "../hooks/useInfiniteSentinel";
import { useShare } from "../hooks/useShare";
import { ChannelButton, SponsoredLabel } from "../components/BoostedCarousel";

// The boost flow (and TonConnect inside it) is only downloaded when the creator opens it
const BoostModal = lazy(() => import("../components/BoostModal"));

export function ChainScreen() {
  const { id = "" } = useParams();
  const { t, plural, err, lang } = useI18n();
  const navigate = useNavigate();
  const { shareStory, sendToChat } = useShare();
  const session = useSession();
  const [boostOpen, setBoostOpen] = useState(false);
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

  const { chain: c, hasJoined, myPost, shareLink } = chain.data;
  // The first page comes with the chain detail; further pages via the infinite query
  const items = posts.data ? posts.data.pages.flatMap((p) => p.items) : chain.data.posts.items;
  // Only the creator of a marathon can boost it
  const isCreator = !!session.data && session.data.user.id === c.creator.id;
  const boostedUntil = c.boostedUntil
    ? new Date(c.boostedUntil).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" })
    : "";

  return (
    <main className="pb-28">
      <header className="space-y-2 p-4">
        <div className="text-4xl" aria-hidden>
          {c.emoji ?? "🔗"}
        </div>
        {c.isBoosted && <SponsoredLabel />}
        <h1 className="text-2xl font-bold">{c.title}</h1>
        {c.description && <p className="text-tg-hint">{c.description}</p>}
        <p className="text-sm text-tg-hint">
          {plural("participants", c.postsCount)} · {t("by", { name: c.creator.firstName })}
        </p>
        {c.isBoosted && c.channelUrl && (
          <ChannelButton url={c.channelUrl} className="w-full py-3" />
        )}
        {isCreator && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setBoostOpen(true)}
            data-testid="boost-button"
          >
            🔥{" "}
            {c.isBoosted && boostedUntil
              ? t("boostedUntilExtend", { date: boostedUntil })
              : t("boostMarathon")}
          </Button>
        )}
        {hasJoined && myPost ? (
          <div className="mt-2 space-y-2">
            <Button
              className="w-full"
              onClick={() =>
                void shareStory({
                  postId: myPost.id,
                  mediaUrl: myPost.imageUrl,
                  link: shareLink,
                  title: c.title,
                  emoji: c.emoji,
                })
              }
            >
              ↗ {t("joinedShare")}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => sendToChat({ link: shareLink, title: c.title, emoji: c.emoji })}
              >
                ✉️ {t("sendToChat")}
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => navigate(`/chain/${c.id}/join`)}
              >
                ✎ {t("updateCard")}
              </Button>
            </div>
          </div>
        ) : (
          <Button className="mt-2 w-full" onClick={() => navigate(`/chain/${c.id}/join`)}>
            ✨ {t("join")}
          </Button>
        )}
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
      {boostOpen && (
        <Suspense fallback={null}>
          <BoostModal chain={c} onClose={() => setBoostOpen(false)} />
        </Suspense>
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
