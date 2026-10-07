import { useEffect, useRef, useState } from "react";
import { CARD_HEIGHT, CARD_WIDTH } from "@storychain/shared";
import { drawCard, fontsNeeded, prepareFonts, type CardOptions } from "./renderCard";
import { MAX_ZOOM, panView, zoomView, type View } from "./layout";

const PREVIEW_SCALE = 0.5;

interface Props {
  options: CardOptions;
  onViewChange?: (v: View) => void;
  /** Free users: DOM-only watermark overlay (never exported; the server adds the real one) */
  showWatermark?: boolean;
  label: string;
  /** keep the preview within ~55% of the viewport height so pickers stay visible below it */
  compact?: boolean;
}

/** Live canvas preview. Drag = pan, pinch / wheel = zoom (when `onViewChange` is given). */
export function CardPreview({
  options,
  onViewChange,
  showWatermark = false,
  label,
  compact = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const key = `${fontsNeeded(options).join()}|${options.chainTitle}|${options.lang}|${options.participants}`;

  useEffect(() => {
    let live = true;
    void prepareFonts(options).then(() => live && setLoadedKey(key));
    return () => {
      live = false;
    };
    // options identity changes on every pan; only the font-relevant key matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || loadedKey !== key) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    drawCard(ctx, options, PREVIEW_SCALE);
  });

  // Gesture state lives in refs so handlers always see the latest view
  const latest = useRef({ options, onViewChange });
  latest.current = { options, onViewChange };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  const apply = (fn: (v: View, frameW: number, frameH: number, sw: number, sh: number) => View) => {
    const { options: o, onViewChange: cb } = latest.current;
    if (!cb) return;
    const f = o.template.photoFrame;
    cb(fn(o.view, f.w, f.h, o.photo.width, o.photo.height));
  };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !onViewChange) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      apply((v, fw, fh, sw, sh) => zoomView(sw, sh, fw, fh, v, Math.exp(-e.deltaY * 0.002)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onViewChange]);

  const interactive = !!onViewChange;
  const cardPerCss = () =>
    CARD_WIDTH / (canvasRef.current?.getBoundingClientRect().width || CARD_WIDTH);

  return (
    <div
      className="relative mx-auto w-full overflow-hidden rounded-2xl bg-tg-secondary shadow-lg"
      style={{
        aspectRatio: "9 / 16",
        containerType: "inline-size",
        maxWidth: compact ? "min(360px, calc(55dvh * 9 / 16))" : "360px",
      }}
    >
      <canvas
        ref={canvasRef}
        width={CARD_WIDTH * PREVIEW_SCALE}
        height={CARD_HEIGHT * PREVIEW_SCALE}
        role="img"
        aria-label={label}
        data-testid="card-preview"
        className={`h-full w-full ${interactive ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
        onPointerDown={(e) => {
          if (!interactive) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          pinch.current = null;
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId);
          if (!interactive || !prev) return;
          const next = { x: e.clientX, y: e.clientY };
          const k = cardPerCss();
          if (pointers.current.size === 1) {
            apply((v, fw, fh, sw, sh) =>
              panView(sw, sh, fw, fh, v, (next.x - prev.x) * k, (next.y - prev.y) * k),
            );
          } else if (pointers.current.size === 2) {
            pointers.current.set(e.pointerId, next);
            const [a, b] = [...pointers.current.values()] as [
              { x: number; y: number },
              { x: number; y: number },
            ];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinch.current) {
              const factor = dist / pinch.current;
              apply((v, fw, fh, sw, sh) => zoomView(sw, sh, fw, fh, v, factor));
            }
            pinch.current = dist;
          }
          pointers.current.set(e.pointerId, next);
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = null;
        }}
      />
      {showWatermark && (
        <div
          aria-hidden
          data-testid="watermark-overlay"
          className="pointer-events-none absolute rounded-full bg-black/45 font-bold text-white"
          style={{
            right: "3.7%",
            bottom: "11.4%",
            fontSize: "calc(34 * 100cqw / 1080)",
            padding: "calc(12 * 100cqw / 1080) calc(24 * 100cqw / 1080)",
            lineHeight: 1.2,
          }}
        >
          StoryChain
        </div>
      )}
    </div>
  );
}

export const ZOOM_RANGE = { min: 1, max: MAX_ZOOM };
