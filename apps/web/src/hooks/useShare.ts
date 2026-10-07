import { useCallback } from "react";
import { useI18n } from "../lib/i18n";
import { api } from "../lib/api";
import { buildSendToChatUrl, shareToStoryFlow, type ShareOutcome } from "../lib/share";
import { tg } from "../lib/tg";

export interface ShareTarget {
  postId: string;
  mediaUrl: string;
  link: string;
  title: string;
  emoji: string | null;
}

/** The Clipboard API can hang while a permission prompt is pending, so never let it block the fallback UI. */
async function copyToClipboard(text: string): Promise<void> {
  await Promise.race([
    navigator.clipboard.writeText(text),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("clipboard timeout")), 1500),
    ),
  ]);
}

/** Story share (with fallbacks) and "send to chat" for a published post. */
export function useShare() {
  const { lang } = useI18n();
  const shareStory = useCallback(
    (t: ShareTarget): Promise<ShareOutcome> =>
      shareToStoryFlow(
        {
          postId: t.postId,
          mediaUrl: t.mediaUrl,
          link: t.link,
          title: t.title,
          emoji: t.emoji,
          lang,
        },
        {
          tg,
          copy: copyToClipboard,
          markShared: (id) => api.post(`/api/posts/${id}/shared`).then(() => undefined),
        },
      ),
    [lang],
  );
  const sendToChat = useCallback(
    (t: Pick<ShareTarget, "link" | "title" | "emoji">) => {
      tg.openTelegramLink(
        buildSendToChatUrl({ link: t.link, title: t.title, emoji: t.emoji, lang }),
      );
    },
    [lang],
  );
  return { shareStory, sendToChat };
}
