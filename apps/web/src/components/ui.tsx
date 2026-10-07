import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useI18n } from "../lib/i18n";

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const v: Record<Variant, string> = {
    primary: "bg-tg-button text-tg-button-text",
    secondary: "bg-tg-secondary text-tg-text",
    ghost: "text-tg-link",
  };
  return <button className={`${base} ${v[variant]} ${className}`} {...props} />;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-tg-secondary ${className}`} />;
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "pro";
}) {
  const tones = { neutral: "bg-tg-secondary text-tg-hint", pro: "bg-amber-400 text-black" };
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  emoji,
  title,
  text,
  action,
}: {
  emoji: string;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center" role="status">
      <div className="text-5xl" aria-hidden>
        {emoji}
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {text && <p className="text-tg-hint">{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      emoji="⚠️"
      title={t("errorTitle")}
      text={message}
      action={
        onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            {t("retry")}
          </Button>
        )
      }
    />
  );
}
