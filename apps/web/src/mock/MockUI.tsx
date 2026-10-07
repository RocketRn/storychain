/** DOM mocks of Telegram chrome + DevTools drawer. Loaded only when VITE_DEV_MOCK=true. */
import { useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getMockState, MOCK_USER_BASE, mockUi, updateMockState } from "../lib/tgMock";
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
      <DevTools />
    </>
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
  const pro = session.data?.isPro ?? false;
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
              User: {session.data?.user.firstName ?? tg.user?.first_name} (tg id {tgId}) ·{" "}
              {pro ? "PRO" : "Free"}
              {session.data ? ` · used ${session.data.usedToday}` : ""}
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
          <div className="flex flex-wrap gap-1">
            <button
              className={btn}
              disabled={busy}
              onClick={() =>
                void act(() => dev("grant-pro", { telegramId: tgId, days: pro ? 0 : 30 }))
              }
            >
              PRO: {pro ? "turn off" : "turn on"}
            </button>
            <button
              className={btn}
              disabled={busy}
              onClick={() =>
                void act(() => dev("grant-pro", { telegramId: tgId, expireInMinutes: 1 }))
              }
            >
              PRO expires in 1 min
            </button>
            <button
              className={btn}
              disabled={busy}
              onClick={() => void act(() => dev("reset-usage", { telegramId: tgId }))}
            >
              Reset usage
            </button>
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
