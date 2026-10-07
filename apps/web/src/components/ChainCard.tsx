import { Link } from "react-router-dom";
import type { ChainDTO } from "@storychain/shared/light";
import { useI18n } from "../lib/i18n";
import { SponsoredLabel } from "./BoostedCarousel";

export function ChainCard({ chain, compact = false }: { chain: ChainDTO; compact?: boolean }) {
  const { plural } = useI18n();
  return (
    <Link
      to={`/chain/${chain.id}`}
      className={`flex shrink-0 gap-3 rounded-2xl bg-tg-secondary p-4 transition active:scale-[0.98] ${
        compact ? "w-44 flex-col" : "items-center"
      }`}
    >
      <span className="text-3xl" aria-hidden>
        {chain.emoji ?? "🔗"}
      </span>
      <span className="min-w-0">
        {chain.isBoosted && <SponsoredLabel />}
        <span className="line-clamp-2 block font-semibold">{chain.title}</span>
        <span className="block text-sm text-tg-hint">
          {plural("participants", chain.postsCount)}
        </span>
      </span>
    </Link>
  );
}

export function ChainCardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-2xl bg-tg-secondary ${compact ? "h-28 w-44 shrink-0" : "h-20"}`}
    />
  );
}
