/**
 * Story sharing. Pure builders + a flow with injectable dependencies (unit tested without Telegram).
 *
 * Telegram facts this relies on (see DECISIONS.md):
 *  - shareToStory needs a PUBLIC HTTPS media URL and Telegram client >= 7.8.
 *  - widget_link in stories is Premium-only for the author, so the link is ALWAYS also in the text.
 */
import { sanitizeText } from "@storychain/shared/light";
import type { StoryParams, TgFacade } from "./tg";
import { translate, type Lang } from "./i18n";

export const STORY_TEXT_MAX = 200; // safe for non-Premium authors
export const WIDGET_NAME_MAX = 48;
export const STORY_MIN_VERSION = "7.8";

export interface ShareInfo {
  link: string;
  title: string;
  emoji?: string | null;
  lang: Lang;
}

/** Cuts on code points, never inside a surrogate pair (an emoji must not turn into "\uFFFD"). */
function truncate(s: string, max: number): string {
  const cps = Array.from(s);
  if (s.length <= max) return s;
  let out = "";
  for (const cp of cps) {
    if (out.length + cp.length > max - 1) break;
    out += cp;
  }
  return max <= 1 ? "" : `${out.trimEnd()}…`;
}

/** `🐱 «Title»\n🔗 Join: <link>`, never longer than STORY_TEXT_MAX (title is shortened first, link never cut). */
export function buildStoryText({ link, title: rawTitle, emoji, lang }: ShareInfo): string {
  // stored titles may predate sanitizing: a direction override here would visually reverse the link
  const title = sanitizeText(rawTitle);
  const tail = `🔗 ${translate(lang, "shareJoin")}: ${link}`;
  const prefix = emoji ? `${emoji} ` : "";
  const room = STORY_TEXT_MAX - tail.length - 1 - prefix.length - 2; // newline + «»
  if (room < 4) return tail;
  return `${prefix}«${truncate(title, room)}»\n${tail}`;
}

export function buildStoryParams(info: ShareInfo & { isTgPremium: boolean }): StoryParams {
  const params: StoryParams = { text: buildStoryText(info) };
  if (info.isTgPremium) {
    params.widget_link = {
      url: info.link,
      name: truncate(translate(info.lang, "widgetName"), WIDGET_NAME_MAX),
    };
  }
  return params;
}

/** https://t.me/share/url — Telegram appends `url` to `text` itself, so the text carries no link. */
export function buildSendToChatUrl({ link, title: rawTitle, emoji, lang }: ShareInfo): string {
  const title = sanitizeText(rawTitle);
  const prefix = emoji ? `${emoji} ` : "";
  const text = `${prefix}«${truncate(title, 120)}» — ${translate(lang, "shareJoin")}!`;
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}

export interface ShareDeps {
  tg: Pick<
    TgFacade,
    "user" | "isVersionAtLeast" | "shareToStory" | "downloadFile" | "openLink" | "showAlert"
  >;
  copy: (text: string) => Promise<void>;
  markShared: (postId: string) => Promise<void>;
}

export type ShareOutcome = "story" | "fallback";

/**
 * 1. Client too old (< 7.8)            -> fallback
 * 2. shareToStory(url, text [+widget]) -> on throw with widget, retry once without it; still failing -> fallback
 * 3. Success -> POST /posts/:id/shared (best effort)
 * Fallback = save/open the image + copy the link + explain with an alert.
 */
export async function shareToStoryFlow(
  args: ShareInfo & { postId: string; mediaUrl: string },
  deps: ShareDeps,
): Promise<ShareOutcome> {
  const { tg } = deps;
  const params = buildStoryParams({ ...args, isTgPremium: tg.user?.is_premium === true });
  let shared = false;
  if (tg.isVersionAtLeast(STORY_MIN_VERSION)) {
    try {
      tg.shareToStory(args.mediaUrl, params);
      shared = true;
    } catch {
      if (params.widget_link) {
        try {
          tg.shareToStory(args.mediaUrl, { text: params.text });
          shared = true;
        } catch {
          /* fall through to the manual fallback */
        }
      }
    }
  }
  if (shared) {
    void deps.markShared(args.postId).catch(() => undefined); // analytics only
    return "story";
  }
  if (tg.downloadFile) tg.downloadFile({ url: args.mediaUrl, file_name: "storychain-card.jpg" });
  else tg.openLink(args.mediaUrl);
  await deps.copy(args.link).catch(() => undefined);
  await tg.showAlert(translate(args.lang, "shareFallback"));
  return "fallback";
}
