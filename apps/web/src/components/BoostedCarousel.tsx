import { Link } from "react-router-dom";
import type { ChainDTO } from "@storychain/shared/light";
import { useI18n } from "../lib/i18n";
import { useBoosted } from "../lib/queries";
import { tg } from "../lib/tg";
import { Skeleton } from "./ui";

/** "Sponsored" marker: paid placements are always labelled. */
export function SponsoredLabel() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center rounded-full bg-amber-300 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-black">
      {t("sponsored")}
    </span>
  );
}

/** Opens a channel link in Telegram. Only t.me links ever reach here (the API normalizes/validates them). */
export function ChannelButton({ url, className = "" }: { url: string; className?: string }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => tg.openTelegramLink(url)}
      data-testid="channel-button"
      className={`rounded-xl bg-tg-button px-3 py-2 text-sm font-semibold text-tg-button-text active:scale-[0.98] ${className}`}
    >
      📣 {t("openChannel")}
    </button>
  );
}

function Card({ chain }: { chain: ChainDTO }) {
  const { plural } = useI18n();
  return (
    <article
      data-testid="boosted-card"
      className="flex h-full w-60 shrink-0 snap-start flex-col justify-between gap-3 rounded-2xl bg-tg-secondary p-4 ring-1 ring-amber-300/60"
    >
      <Link to={`/chain/${chain.id}`} className="block space-y-2">
        <SponsoredLabel />
        <span className="flex items-start gap-3">
          <span className="text-3xl" aria-hidden>
            {chain.emoji ?? "🔥"}
          </span>
          <span className="min-w-0">
            <span className="line-clamp-2 block font-semibold">{chain.title}</span>
            <span className="block text-sm text-tg-hint">
              {plural("participants", chain.postsCount)}
            </span>
          </span>
        </span>
      </Link>
      {chain.channelUrl && <ChannelButton url={chain.channelUrl} />}
    </article>
  );
}

/**
 * "🔥 Hot / Sponsored Marathons": active boosts only (the server decides with boostedUntil > now).
 * Hidden entirely when there is nothing to show; a fixed-height skeleton avoids layout shift while loading.
 */
export function BoostedCarousel() {
  const { t } = useI18n();
  const q = useBoosted();
  if (q.isPending) {
    return (
      <div className="flex gap-3 overflow-hidden" aria-hidden>
        <Skeleton className="h-36 w-60 shrink-0" />
        <Skeleton className="h-36 w-60 shrink-0" />
      </div>
    );
  }
  if (q.isError || !q.data || q.data.length === 0) return null;
  return (
    <section aria-labelledby="hot-h" data-testid="boosted-carousel">
      <h2 id="hot-h" className="mb-3 text-lg font-semibold">
        🔥 {t("hotTitle")}
      </h2>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2">
        {q.data.map((c) => (
          <li key={c.id} className="flex">
            <Card chain={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}
