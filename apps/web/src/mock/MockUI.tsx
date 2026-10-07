/** DOM mocks of Telegram chrome + DevTools drawer. Loaded only when VITE_DEV_MOCK=true. */
import { useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import {
  getMockState,
  MOCK_USER_BASE,
  mockUi,
  updateMockState,
  type MockUiState,
} from "../lib/tgMock";
import { tg } from "../lib/tg";
import { useSession } from "../lib/queries";

const base = import.meta.env.VITE_API_URL ?? "";
async function dev(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${base}/api/dev/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`dev/${path} failed: ${res.status}`);
}

export default function MockUI() {
  const ui = useSyncExternalStore(mockUi.subscribe, mockUi.getSnapshot);
  return (
    <>
      {ui.back.visible && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] mx-auto max-w-[480px] p-2">
          <button
            onClick={mockUi.clickBack}
            className="pointer-events-auto rounded-full bg-black/70 px-3 py-1 text-sm text-white"
            aria-label="Telegram BackButton (mock)"
          >
            ← Back
          </button>
        </div>
      )}
      {ui.main.visible && (
        <div className="fixed inset-x-0 bottom-0 z-[60] mx-auto max-w-[480px] bg-tg-bg p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.15)]">
          <button
            onClick={mockUi.clickMain}
            disabled={!ui.main.enabled || ui.main.progress}
            className="w-full rounded-xl bg-tg-button py-3 text-base font-semibold text-tg-button-text disabled:opacity-50"
          >
            {ui.main.progress ? "⏳ " : ""}
            {ui.main.text}
          </button>
        </div>
      )}
      {ui.story && <StoryPreview story={ui.story} />}
      {ui.tgLink && <TgLinkModal url={ui.tgLink} />}
      {ui.invoice && <InvoiceDialog invoice={ui.invoice} />}
      {ui.dialog && <DialogModal dialog={ui.dialog} />}
      <DevTools />
    </>
  );
}

function Overlay({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** Fake "story composer": shows exactly what shareToStory would receive. */
function StoryPreview({ story }: { story: NonNullable<MockUiState["story"]> }) {
  const { params, mediaUrl } = story;
  const link = /startapp=(chain_[A-Za-z0-9_-]+)/.exec(params?.text ?? "")?.[1];
  const me = getMockState().userN;
  const download = async () => {
    // Re-encode as PNG so the user can inspect the exact pixels
    const bmp = await createImageBitmap(await (await fetch(mediaUrl)).blob());
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")?.drawImage(bmp, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = "storychain-card.png";
      a.click();
    }, "image/png");
  };
  return (
    <Overlay label="Story preview (mock)">
      <div className="flex max-h-full w-full max-w-md gap-4 overflow-auto rounded-2xl bg-neutral-900 p-4 text-white">
        <div
          className="relative w-40 shrink-0 overflow-hidden rounded-xl bg-black"
          style={{ aspectRatio: "9 / 16" }}
        >
          <img
            src={mediaUrl}
            alt="story media"
            data-testid="story-image"
            className="h-full w-full object-cover"
          />
          <div
            data-testid="story-caption"
            className="absolute inset-x-0 bottom-0 whitespace-pre-wrap bg-gradient-to-t from-black/80 p-2 text-[9px] leading-tight"
          >
            {params?.text}
          </div>
          {params?.widget_link && (
            <div
              data-testid="story-widget"
              className="absolute left-2 top-10 rounded-full bg-white px-2 py-1 text-[9px] font-semibold text-black"
            >
              🔗 {params.widget_link.name ?? params.widget_link.url}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2 text-xs">
          <div className="text-sm font-semibold">shareToStory (mock)</div>
          <pre
            data-testid="story-args"
            className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2 text-[10px]"
          >
            {JSON.stringify({ media_url: mediaUrl, params }, null, 1)}
          </pre>
          {!params?.widget_link && (
            <div className="opacity-70">No widget_link: the author is not Telegram Premium.</div>
          )}
          <button
            className="w-full rounded-lg bg-white/15 px-2 py-1.5"
            onClick={() => void download()}
          >
            ⬇ Download PNG
          </button>
          {link && (
            <div>
              <div className="mb-1 opacity-70">Open the story link as…</div>
              <div className="flex flex-wrap gap-1">
                {[1, 2, 3, 4]
                  .filter((n) => n !== me)
                  .map((n) => (
                    <a
                      key={n}
                      className="rounded-lg bg-sky-600 px-2 py-1"
                      href={`/?mock_user=${n}&mock_start_param=${link}`}
                    >
                      User {n}
                    </a>
                  ))}
              </div>
            </div>
          )}
          <button
            className="w-full rounded-lg bg-white px-2 py-1.5 font-semibold text-black"
            onClick={mockUi.closeStory}
          >
            Close
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** Fake Telegram Stars checkout. "Pay" runs the REAL server-side grant path (dev completion -> successful_payment handler). */
function InvoiceDialog({ invoice }: { invoice: NonNullable<MockUiState["invoice"]> }) {
  const [busy, setBusy] = useState(false);
  const reference = invoice.url.replace("mock-invoice://", "");
  const pay = async () => {
    setBusy(true);
    try {
      await dev(`payments/${reference}/complete`, {});
      mockUi.resolveInvoice("paid");
    } catch {
      mockUi.resolveInvoice("failed");
    }
  };
  return (
    <Overlay label="Stars payment (mock)">
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-neutral-900 p-4 text-sm text-white">
        <div className="text-base font-semibold">⭐ Telegram Stars payment (mock)</div>
        <div className="break-all text-xs opacity-70">order {reference}</div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy}
            className="flex-1 rounded-lg bg-yellow-400 px-2 py-2 font-semibold text-black disabled:opacity-50"
            onClick={() => void pay()}
          >
            Pay
          </button>
          <button
            disabled={busy}
            className="flex-1 rounded-lg bg-white/15 px-2 py-2"
            onClick={() => mockUi.resolveInvoice("cancelled")}
          >
            Cancel
          </button>
          <button
            disabled={busy}
            className="flex-1 rounded-lg bg-red-600 px-2 py-2"
            onClick={() => mockUi.resolveInvoice("failed")}
          >
            Fail
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function TgLinkModal({ url }: { url: string }) {
  return (
    <Overlay label="openTelegramLink (mock)">
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-neutral-900 p-4 text-sm text-white">
        <div className="font-semibold">openTelegramLink (mock)</div>
        <a
          data-testid="tg-link"
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block break-all text-sky-400 underline"
        >
          {url}
        </a>
        <button
          className="w-full rounded-lg bg-white px-2 py-1.5 font-semibold text-black"
          onClick={mockUi.closeTgLink}
        >
          Close
        </button>
      </div>
    </Overlay>
  );
}

function DialogModal({ dialog }: { dialog: NonNullable<MockUiState["dialog"]> }) {
  return (
    <Overlay label={dialog.kind === "alert" ? "Alert (mock)" : "Confirm (mock)"}>
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-neutral-900 p-4 text-sm text-white">
        <p data-testid="mock-dialog-message">{dialog.message}</p>
        <div className="flex gap-2">
          {dialog.kind === "confirm" && (
            <button
              className="flex-1 rounded-lg bg-white/15 px-2 py-1.5"
              onClick={() => mockUi.answerDialog(false)}
            >
              Cancel
            </button>
          )}
          <button
            className="flex-1 rounded-lg bg-white px-2 py-1.5 font-semibold text-black"
            onClick={() => mockUi.answerDialog(true)}
          >
            OK
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function DevTools() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const session = useSession();
  const s = getMockState();
  const tgId = MOCK_USER_BASE + s.userN;
  const [userN, setUserN] = useState(String(s.userN));
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries();
    } finally {
      setBusy(false);
    }
  };
  // "this chain" = the chain page currently open
  const { pathname } = useLocation();
  const chainId = /^\/chain\/([A-Za-z0-9_-]+)/.exec(pathname)?.[1];
  const btn = "rounded-lg bg-white/15 px-2 py-1 text-xs hover:bg-white/25 disabled:opacity-50";

  return (
    <div className="fixed bottom-20 right-2 z-[70] text-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-black/80 px-3 py-2 text-sm shadow-lg"
        aria-expanded={open}
        aria-label="DevTools (mock)"
      >
        🛠 Dev
      </button>
      {open && (
        <div
          className="absolute bottom-12 right-0 w-72 space-y-3 rounded-2xl bg-black/90 p-3 text-sm shadow-xl"
          role="dialog"
          aria-label="DevTools"
        >
          <div>
            <div className="mb-1 opacity-70">
              User: {session.data?.user.firstName ?? tg.user?.first_name} (tg id {tgId})
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} className={btn} onClick={() => updateMockState({ userN: n })}>
                  User {n}
                </button>
              ))}
            </div>
            <div className="mt-1 flex gap-1">
              <input
                aria-label="mock user number"
                className="w-16 rounded bg-white/15 px-2 py-1 text-xs"
                value={userN}
                onChange={(e) => setUserN(e.target.value)}
                inputMode="numeric"
              />
              <button
                className={btn}
                onClick={() => updateMockState({ userN: Math.max(1, Number(userN) || 1) })}
              >
                Switch
              </button>
            </div>
          </div>
          <div>
            <div className="mb-1 opacity-70">Chain: {chainId ?? "(open a chain page)"}</div>
            <div className="flex flex-wrap gap-1">
              <button
                className={btn}
                disabled={busy || !chainId}
                onClick={() => void act(() => dev("boost-chain", { chainId, hours: 24 }))}
              >
                Boost this chain 24h
              </button>
              <button
                className={btn}
                disabled={busy || !chainId}
                onClick={() => void act(() => dev("boost-chain", { chainId, hours: 168 }))}
              >
                Boost this chain 7d
              </button>
              <button
                className={btn}
                disabled={busy || !chainId}
                onClick={() => void act(() => dev("expire-boost", { chainId }))}
              >
                Expire boost
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button className={btn} onClick={() => updateMockState({ premium: !s.premium })}>
              TG Premium: {s.premium ? "on" : "off"}
            </button>
            <button
              className={btn}
              onClick={() => updateMockState({ lang: s.lang === "ru" ? "en" : "ru" })}
            >
              Lang: {s.lang}
            </button>
          </div>
          <label className="flex items-center gap-2">
            Platform
            <select
              className="rounded bg-white/15 px-2 py-1 text-xs"
              value={s.platform}
              onChange={(e) => updateMockState({ platform: e.target.value })}
            >
              {["tdesktop", "macos", "weba", "web", "ios", "android", "unknown"].map((p) => (
                <option key={p} value={p} className="text-black">
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
