import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { tg } from "../lib/tg";

/** Shows Telegram's BackButton on every route except "/" and wires it to router history. */
export function useBackButton(): void {
  const { pathname, key } = useLocation();
  const navigate = useNavigate();
  const isRoot = pathname === "/";
  useEffect(() => {
    if (isRoot) {
      tg.BackButton.hide();
      return;
    }
    tg.BackButton.show();
    // "default" key = first entry of this session (e.g. opened via deep link): go home instead of leaving the app
    const off = tg.BackButton.onClick(() =>
      key === "default" ? navigate("/", { replace: true }) : navigate(-1),
    );
    return off;
  }, [isRoot, key, navigate]);
}

interface MainButtonOpts {
  text: string;
  onClick: () => void;
  visible?: boolean;
  disabled?: boolean;
  loading?: boolean;
}

/** Declarative Telegram MainButton. */
export function useMainButton({
  text,
  onClick,
  visible = true,
  disabled = false,
  loading = false,
}: MainButtonOpts): void {
  useEffect(() => {
    if (!visible) {
      tg.MainButton.hide();
      return;
    }
    tg.MainButton.setText(text);
    tg.MainButton.show();
    if (disabled) tg.MainButton.disable();
    else tg.MainButton.enable();
    if (loading) tg.MainButton.showProgress();
    else tg.MainButton.hideProgress();
    return tg.MainButton.onClick(onClick);
  }, [text, onClick, visible, disabled, loading]);
  useEffect(() => () => tg.MainButton.hide(), []);
}
