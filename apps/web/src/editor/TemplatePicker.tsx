import { useEffect, useRef, useState } from "react";
import { ALL_FONTS, TEMPLATES, type Template } from "@storychain/shared/light";
import { useI18n, type Lang } from "../lib/i18n";
import { ensureFonts } from "./fonts";
import { DEFAULT_VIEW } from "./layout";
import type { Photo } from "./photo";
import { drawCard } from "./renderCard";

const THUMB_SCALE = 0.1;

function Thumb({
  template,
  photo,
  title,
  position,
  lang,
  ready,
}: {
  template: Template;
  photo: Photo;
  title: string;
  position: number;
  lang: Lang;
  ready: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !ready) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    drawCard(
      ctx,
      {
        photo,
        view: DEFAULT_VIEW,
        template,
        chainTitle: title,
        position,
        participants: position,
        lang,
      },
      THUMB_SCALE,
    );
  }, [template, photo, title, position, lang, ready]);
  return <canvas ref={ref} width={108} height={192} className="h-full w-full" aria-hidden />;
}

interface Props {
  photo: Photo;
  title: string;
  position: number;
  templateId: string;
  fontFamily: string | null;
  onTemplate: (id: string) => void;
  onFont: (f: string | null) => void;
}

export function TemplatePicker({
  photo,
  title,
  position,
  templateId,
  fontFamily,
  onTemplate,
  onFont,
}: Props) {
  const { t, lang } = useI18n();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void ensureFonts([...new Set(TEMPLATES.map((x) => x.fontFamily))], title).then(
      () => live && setReady(true),
    );
    return () => {
      live = false;
    };
  }, [title]);

  // Every template and font is free for everyone: no locks, no badges, no modals.
  return (
    <div className="space-y-4">
      <section aria-label={t("templates")}>
        <h2 className="mb-2 text-sm font-semibold text-tg-hint">{t("templates")}</h2>
        <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
          {TEMPLATES.map((tpl) => {
            const selected = tpl.id === templateId;
            return (
              <li key={tpl.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onTemplate(tpl.id)}
                  aria-pressed={selected}
                  aria-label={tpl.name}
                  data-testid={`template-${tpl.id}`}
                  className={`relative block w-[72px] overflow-hidden rounded-xl bg-tg-secondary ${selected ? "ring-2 ring-tg-button" : ""}`}
                  style={{ aspectRatio: "9 / 16" }}
                >
                  <Thumb
                    template={tpl}
                    photo={photo}
                    title={title}
                    position={position}
                    lang={lang}
                    ready={ready}
                  />
                </button>
                <div className="mt-1 text-center text-xs text-tg-hint">{tpl.name}</div>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-label={t("fonts")}>
        <h2 className="mb-2 text-sm font-semibold text-tg-hint">{t("fonts")}</h2>
        <ul className="flex flex-wrap gap-2">
          {ALL_FONTS.map((f) => {
            const selected =
              (fontFamily ?? TEMPLATES.find((x) => x.id === templateId)?.fontFamily) === f;
            return (
              <li key={f}>
                <button
                  type="button"
                  onClick={() => onFont(f)}
                  aria-pressed={selected}
                  data-testid={`font-${f}`}
                  className={`rounded-full bg-tg-secondary px-3 py-1.5 text-sm ${selected ? "ring-2 ring-tg-button" : ""}`}
                  style={{ fontFamily: `"${f}", sans-serif` }}
                >
                  {f}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
