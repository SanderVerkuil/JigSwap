import { useShortcutHint } from "@/components/dashboard-layout/shortcut-hint";
import { Search } from "lucide-react";
import { useTranslations } from "use-intl";

// Opens the docs search; the docs route's key handler also opens it on Cmd+K and Ctrl+K.
export function DocsSearchPill({ onOpenSearch }: { onOpenSearch: () => void }) {
  const t = useTranslations("marketing.docs");
  const shortcut = useShortcutHint();

  return (
    <button
      type="button"
      onClick={onOpenSearch}
      aria-keyshortcuts="Meta+K Control+K"
      className="flex items-center gap-2.5 w-full h-10 px-3 mb-2 rounded-[10px] bg-mk-card border border-mk-border text-mk-text-muted text-[14px] text-left transition-colors hover:border-mk-violet-300 hover:text-mk-text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mk-ring"
    >
      <Search className="size-4 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate">{t("searchTrigger")}</span>
      {/* Known only after mount; touch screens have no keyboard to press it with. */}
      {shortcut && (
        <kbd className="shrink-0 font-mono text-[11px] text-mk-text-body px-1.5 py-0.5 rounded-[5px] bg-mk-muted border border-mk-border pointer-coarse:hidden">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
