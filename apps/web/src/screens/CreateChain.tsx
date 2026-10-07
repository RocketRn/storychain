import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeChainInput, parseChannelUrl } from "@storychain/shared/light";
import { useI18n } from "../lib/i18n";
import { ApiError } from "../lib/api";
import { tg } from "../lib/tg";
import { useCreateChain } from "../lib/queries";
import { Button } from "../components/ui";

export function CreateChain() {
  const { t, err } = useI18n();
  const navigate = useNavigate();
  const create = useCreateChain();
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("");
  const [description, setDescription] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!parseChannelUrl(channelUrl).ok) {
      setError(t("channelInvalid"));
      return;
    }
    const input = normalizeChainInput({ title, emoji, description, channelUrl });
    if (!input) {
      setError(t("titleHint"));
      return;
    }
    try {
      const chain = await create.mutateAsync(input);
      tg.HapticFeedback.notification("success");
      navigate(`/chain/${chain.id}`, { replace: true });
    } catch (e2) {
      tg.HapticFeedback.notification("error");
      setError(err(e2 instanceof ApiError ? e2.code : "INTERNAL"));
    }
  };

  const input =
    "w-full rounded-xl bg-tg-secondary px-4 py-3 text-base outline-none focus:ring-2 focus:ring-tg-button";
  return (
    <main className="p-4">
      <h1 className="mb-4 text-2xl font-bold">{t("createTitle")}</h1>
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <label className="block space-y-1">
          <span className="text-sm text-tg-hint">{t("fieldTitle")}</span>
          <input
            className={input}
            value={title}
            maxLength={80}
            placeholder={t("placeholderTitle")}
            onChange={(e) => setTitle(e.target.value)}
            aria-describedby="title-hint"
            required
          />
          <span id="title-hint" className="text-xs text-tg-hint">
            {t("titleHint")}
          </span>
        </label>
        <div className="flex flex-wrap gap-2" aria-label={t("ideas")}>
          {(["idea1", "idea2", "idea3"] as const).map((k) => (
            <button
              type="button"
              key={k}
              className="rounded-full bg-tg-secondary px-3 py-1 text-sm"
              onClick={() => setTitle(t(k))}
            >
              {t(k)}
            </button>
          ))}
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-tg-hint">{t("fieldEmoji")}</span>
          <input
            className={input}
            value={emoji}
            maxLength={8}
            placeholder="🐱"
            onChange={(e) => setEmoji(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-tg-hint">{t("fieldDescription")}</span>
          <textarea
            className={input}
            rows={3}
            maxLength={300}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-tg-hint">{t("channelLabel")}</span>
          <input
            className={input}
            value={channelUrl}
            maxLength={100}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t("channelPlaceholder")}
            aria-describedby="channel-hint"
            data-testid="create-channel-input"
            onChange={(e) => setChannelUrl(e.target.value)}
          />
          <span id="channel-hint" className="block text-xs text-tg-hint">
            {t("channelHint")}
          </span>
        </label>
        {error && (
          <p role="alert" className="text-tg-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={create.isPending}>
          {create.isPending ? t("creating") : t("create")}
        </Button>
      </form>
    </main>
  );
}
