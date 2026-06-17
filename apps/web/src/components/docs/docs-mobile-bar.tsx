import { PanelLeft, Search } from "lucide-react";
import { useTranslations } from "use-intl";

export function DocsMobileBar({
  onOpenNav,
  onOpenSearch,
}: {
  onOpenNav: () => void;
  onOpenSearch: () => void;
}) {
  const t = useTranslations("marketing.docs");
  return (
    <div className="hidden max-[1000px]:flex sticky top-[70px] z-30 items-center gap-3 h-12 px-5 bg-[color-mix(in_oklab,var(--mk-card)_88%,transparent)] backdrop-blur-md border-b border-mk-border">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label={t("mobileOpenNav")}
        className="flex items-center gap-1.5 text-[14px] text-mk-text-body"
      >
        <PanelLeft className="size-4" /> {t("mobileDocs")}
      </button>
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label={t("mobileSearch")}
        className="ml-auto"
      >
        <Search className="size-4 text-mk-text-muted" />
      </button>
    </div>
  );
}
