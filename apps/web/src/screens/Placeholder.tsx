import { useI18n } from "../lib/i18n";
import { EmptyState } from "../components/ui";

export function Placeholder({ emoji = "🚧" }: { emoji?: string }) {
  const { t } = useI18n();
  return <EmptyState emoji={emoji} title={t("editorSoon")} />;
}
