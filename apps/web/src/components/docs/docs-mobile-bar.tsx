import { OnThisPageLink } from "@/components/docs/on-page-toc";
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
  // Shown where the docs layout hides its sidebar. The marketing header's nav
  // has folded into its burger by then, so this is never a second nav bar.
  // docs.css adds its height to the page's scroll-padding through data-docs-bar.
  // Sky like the header it sticks under, so the two read as one head storey with
  // a visible edge over what scrolls beneath, by day and at night. The controls
  // draw their focus ring inside, because the header covers the bar's top edge.
  return (
    <div
      data-docs-bar=""
      className="hidden max-[861px]:flex sticky top-16 z-30 items-center gap-3 h-12 px-5 bg-mk-sky"
    >
      {/* The name comes from the content, so it starts with the visible label
          (WCAG 2.5.3); the sr-only tail says what the button does. */}
      <button
        type="button"
        onClick={onOpenNav}
        aria-haspopup="dialog"
        className="-ml-2 inline-flex items-center gap-1.5 h-11 min-w-11 px-2 text-[14px] text-mk-text-body focus-visible:outline-offset-[-2px]"
      >
        <PanelLeft className="size-4" aria-hidden="true" />
        {t.rich("mobileNavButton", {
          sr: (chunks) => <span className="sr-only">{chunks}</span>,
        })}
      </button>
      <OnThisPageLink className="inline-flex items-center gap-1.5 h-11 min-w-11 px-2 text-[14px] text-mk-text-body whitespace-nowrap focus-visible:outline-offset-[-2px]" />
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label={t("mobileSearch")}
        aria-haspopup="dialog"
        className="ml-auto -mr-2 inline-flex items-center justify-center h-11 min-w-11 px-2 focus-visible:outline-offset-[-2px]"
      >
        <Search className="size-4 text-mk-text-muted" aria-hidden="true" />
      </button>
    </div>
  );
}
