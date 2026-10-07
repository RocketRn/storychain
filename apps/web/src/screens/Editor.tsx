import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { getTemplate, TEMPLATES, type CreatePostResultDTO } from "@storychain/shared/light";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { qk, useChain, useSession } from "../lib/queries";
import { tg } from "../lib/tg";
import { Button, EmptyState, ErrorState, Skeleton } from "../components/ui";
import { useMainButton } from "../hooks/useTgButtons";
import { useShare } from "../hooks/useShare";
import { CardPreview } from "../editor/CardPreview";
import { TemplatePicker } from "../editor/TemplatePicker";
import { DEFAULT_VIEW, zoomView, type View } from "../editor/layout";
import { loadPhoto, type Photo } from "../editor/photo";
import { renderCard, type CardOptions } from "../editor/renderCard";

if (import.meta.env.VITE_DEV_MOCK === "true") void import("../editor/testHook");

type Step = "photo" | "style" | "preview" | "done";
const STEPS: Array<{ id: Exclude<Step, "done">; key: "stepPhoto" | "stepStyle" | "stepPublish" }> =
  [
    { id: "photo", key: "stepPhoto" },
    { id: "style", key: "stepStyle" },
    { id: "preview", key: "stepPublish" },
  ];

export default function Editor() {
  const { id = "" } = useParams();
  const { t, err, lang } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const chain = useChain(id);
  const session = useSession();
  const { shareStory, sendToChat } = useShare();

  const [step, setStep] = useState<Step>("photo");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const [templateId, setTemplateId] = useState(TEMPLATES[0]?.id ?? "sunset");
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [caption, setCaption] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<{ code: ApiError["code"]; message: string } | null>(null);
  const [result, setResult] = useState<CreatePostResultDTO | null>(null);
  const photoRef = useRef<Photo | null>(null);

  // free the decoded bitmap when replaced / on unmount
  useEffect(() => {
    photoRef.current = photo;
  }, [photo]);
  useEffect(() => () => photoRef.current?.bitmap.close(), []);

  const isPro = session.data?.isPro ?? false;
  const template = getTemplate(templateId) ?? (TEMPLATES[0] as (typeof TEMPLATES)[number]);
  const position = chain.data ? (chain.data.myPosition ?? chain.data.chain.postsCount + 1) : 1;

  const options: CardOptions | null = useMemo(
    () =>
      photo && chain.data
        ? {
            photo,
            view,
            template,
            fontFamily,
            chainTitle: chain.data.chain.title,
            position,
            participants: position,
            lang,
          }
        : null,
    [photo, view, template, fontFamily, chain.data, position, lang],
  );

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoError(false);
    try {
      const p = await loadPhoto(file);
      setPhoto(p);
      setView(DEFAULT_VIEW);
      setStep("style");
    } catch {
      setPhotoError(true);
    }
  };

  const publish = useCallback(async () => {
    if (!options || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const blob = await renderCard(options);
      const fd = new FormData();
      fd.append("templateId", template.id);
      if (fontFamily) fd.append("fontFamily", fontFamily);
      if (caption.trim()) fd.append("caption", caption.trim());
      fd.append("image", blob, "card.jpg");
      const res = await api.post<CreatePostResultDTO>(`/api/chains/${id}/posts`, fd);
      tg.HapticFeedback.notification("success");
      setResult(res);
      setStep("done");
      // One tap = publish + open Telegram's story composer (falls back to manual sharing if unsupported)
      void shareStory({
        postId: res.post.id,
        mediaUrl: res.publicImageUrl,
        link: res.shareLink,
        title: options.chainTitle,
        emoji: chain.data?.chain.emoji ?? null,
      });
      void qc.invalidateQueries({ queryKey: qk.chain(id) });
      void qc.invalidateQueries({ queryKey: qk.posts(id) });
      void qc.invalidateQueries({ queryKey: ["chains"] });
      void qc.invalidateQueries({ queryKey: qk.session });
      void qc.invalidateQueries({ queryKey: qk.myPosts });
    } catch (e) {
      tg.HapticFeedback.notification("error");
      const code = e instanceof ApiError ? e.code : "INTERNAL";
      setError({ code, message: err(code) });
    } finally {
      setPublishing(false);
    }
  }, [
    options,
    publishing,
    template.id,
    fontFamily,
    caption,
    id,
    qc,
    err,
    shareStory,
    chain.data?.chain.emoji,
  ]);

  // One MainButton for the whole flow: "Next" on the style step, "Publish" on the preview step
  const onMain = useCallback(() => {
    if (step === "style") setStep("preview");
    else if (step === "preview") void publish();
  }, [step, publish]);
  useMainButton({
    text: step === "preview" ? (publishing ? t("publishing") : t("publish")) : t("next"),
    onClick: onMain,
    visible: step === "style" || step === "preview",
    loading: step === "preview" && publishing,
  });

  if (chain.isPending || session.isPending) {
    return (
      <div className="space-y-3 p-4" aria-busy="true">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="aspect-[9/16] w-full max-w-[360px]" />
      </div>
    );
  }
  if (chain.isError) {
    return chain.error instanceof ApiError && chain.error.status === 404 ? (
      <EmptyState
        emoji="🔍"
        title={t("chainNotFoundTitle")}
        action={
          <Link to="/">
            <Button>{t("browseChains")}</Button>
          </Link>
        }
      />
    ) : (
      <ErrorState message={err("INTERNAL")} onRetry={() => void chain.refetch()} />
    );
  }

  const s = session.data;
  const limitReached =
    !!s && s.dailyLimit !== null && s.usedToday >= s.dailyLimit && step !== "done";
  if (limitReached && s?.dailyLimit != null) {
    return (
      <EmptyState
        emoji="⏳"
        title={t("dailyLimitTitle")}
        text={t("dailyLimitText", { n: s.dailyLimit })}
        action={
          <Link to="/pro">
            <Button>⭐ {t("getPro")}</Button>
          </Link>
        }
      />
    );
  }

  const c = chain.data.chain;
  const stepIndex = STEPS.findIndex((x) => x.id === step);

  if (step === "done" && result) {
    return (
      <main className="space-y-4 p-4 text-center" data-testid="editor-done">
        <h1 className="text-2xl font-bold">🎉 {t("doneTitle")}</h1>
        <p className="text-tg-hint">{t("doneText", { n: result.post.position, title: c.title })}</p>
        <img
          src={result.publicImageUrl}
          alt=""
          className="mx-auto w-48 rounded-xl shadow-lg"
          width={1080}
          height={1920}
          style={{ aspectRatio: "9 / 16" }}
        />
        <div className="space-y-2">
          <Button
            className="w-full"
            onClick={() =>
              void shareStory({
                postId: result.post.id,
                mediaUrl: result.publicImageUrl,
                link: result.shareLink,
                title: c.title,
                emoji: c.emoji,
              })
            }
          >
            ↗ {t("shareAgain")}
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => sendToChat({ link: result.shareLink, title: c.title, emoji: c.emoji })}
          >
            ✉️ {t("sendToChat")}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => navigate(`/chain/${c.id}`, { replace: true })}
          >
            {t("openChain")}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-4 p-4 pb-28">
      <header>
        <h1 className="text-xl font-bold">
          {c.emoji ?? "🔗"} {c.title}
        </h1>
        <ol className="mt-2 flex gap-2 text-xs" aria-label={t("editorTitle")}>
          {STEPS.map((x, i) => (
            <li
              key={x.id}
              aria-current={i === stepIndex ? "step" : undefined}
              className={`rounded-full px-3 py-1 ${i === stepIndex ? "bg-tg-button text-tg-button-text" : i < stepIndex ? "bg-tg-secondary" : "bg-tg-secondary text-tg-hint"}`}
            >
              {i + 1}. {t(x.key)}
            </li>
          ))}
        </ol>
      </header>

      {step === "photo" && (
        <section className="space-y-3 text-center">
          <div className="py-10 text-6xl" aria-hidden>
            📸
          </div>
          <p className="text-tg-hint">{t("pickPhotoHint")}</p>
          <label className="block">
            <span className="inline-flex w-full cursor-pointer items-center justify-center rounded-xl bg-tg-button px-4 py-3 font-semibold text-tg-button-text">
              🖼 {t("pickPhoto")}
            </span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              data-testid="photo-input"
              onChange={(e) => void onFile(e)}
            />
          </label>
          <label className="block">
            <span className="inline-flex w-full cursor-pointer items-center justify-center rounded-xl bg-tg-secondary px-4 py-3 font-semibold">
              📷 {t("takePhoto")}
            </span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => void onFile(e)}
            />
          </label>
          {photoError && (
            <p role="alert" className="text-tg-destructive">
              {t("photoError")}
            </p>
          )}
        </section>
      )}

      {options && step === "style" && photo && (
        <section className="space-y-4">
          <CardPreview
            options={options}
            onViewChange={setView}
            compact
            showWatermark={!isPro}
            label={t("dragHint")}
          />
          <p className="text-center text-xs text-tg-hint">{t("dragHint")}</p>
          <label className="flex items-center gap-3 text-sm">
            <span className="text-tg-hint">{t("zoom")}</span>
            <input
              type="range"
              min={1}
              max={5}
              step={0.01}
              value={view.zoom}
              aria-label={t("zoom")}
              className="flex-1"
              onChange={(e) =>
                setView((v) =>
                  zoomView(
                    photo.width,
                    photo.height,
                    template.photoFrame.w,
                    template.photoFrame.h,
                    v,
                    Number(e.target.value) / v.zoom,
                  ),
                )
              }
            />
          </label>
          <TemplatePicker
            photo={photo}
            title={c.title}
            position={position}
            isPro={isPro}
            templateId={templateId}
            fontFamily={fontFamily}
            onTemplate={(tid) => {
              setTemplateId(tid);
              setFontFamily(null);
            }}
            onFont={setFontFamily}
            onLocked={() => navigate("/pro")}
          />
          <Button variant="ghost" onClick={() => setStep("photo")}>
            ↺ {t("changePhoto")}
          </Button>
        </section>
      )}

      {options && step === "preview" && (
        <section className="space-y-4">
          <CardPreview options={options} showWatermark={!isPro} label={c.title} />
          {!isPro && <p className="text-center text-xs text-tg-hint">{t("freeWatermark")}</p>}
          <label className="block space-y-1">
            <span className="text-sm text-tg-hint">{t("captionLabel")}</span>
            <input
              className="w-full rounded-xl bg-tg-secondary px-4 py-3 outline-none focus:ring-2 focus:ring-tg-button"
              value={caption}
              maxLength={200}
              placeholder={t("captionPlaceholder")}
              onChange={(e) => setCaption(e.target.value)}
            />
          </label>
          {error && (
            <div role="alert" className="space-y-2 text-center text-tg-destructive">
              <p>{error.message}</p>
              {(error.code === "PRO_REQUIRED" || error.code === "DAILY_LIMIT_REACHED") && (
                <Link to="/pro">
                  <Button variant="secondary">⭐ {t("getPro")}</Button>
                </Link>
              )}
            </div>
          )}
          <Button variant="ghost" onClick={() => setStep("style")} disabled={publishing}>
            ← {t("back2")}
          </Button>
        </section>
      )}
    </main>
  );
}
