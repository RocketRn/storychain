import type { TgFacade } from "./tg";

const MAP: Record<string, string> = {
  bg_color: "--tg-bg",
  text_color: "--tg-text",
  hint_color: "--tg-hint",
  link_color: "--tg-link",
  button_color: "--tg-button",
  button_text_color: "--tg-button-text",
  secondary_bg_color: "--tg-secondary-bg",
  section_bg_color: "--tg-section-bg",
  destructive_text_color: "--tg-destructive",
};

/** Applies Telegram themeParams as CSS variables (fallbacks live in index.css per color scheme). */
export function applyTheme(tg: Pick<TgFacade, "themeParams" | "colorScheme">): void {
  const root = document.documentElement;
  root.dataset.theme = tg.colorScheme;
  for (const [k, cssVar] of Object.entries(MAP)) {
    const v = tg.themeParams[k];
    if (v) root.style.setProperty(cssVar, v);
    else root.style.removeProperty(cssVar);
  }
}
