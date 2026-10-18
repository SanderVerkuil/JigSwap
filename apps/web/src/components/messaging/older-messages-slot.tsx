"use client";

// Top slot of the thread's message list: the infinite-scroll sentinel the
// thread view observes, plus a subtle "Load earlier messages" button as the
// keyboard / assistive-tech path (WCAG 2.1.1). The button stays mounted while
// a page loads (spinner, aria-disabled) so a keyboard user's focus survives.
import type { PaginationStatus } from "convex/react";
import { Loader2 } from "lucide-react";
import type { Ref } from "react";
import { useTranslations } from "use-intl";

export function OlderMessagesSlot({
  status,
  onLoadMore,
  sentinelRef,
}: {
  status: PaginationStatus;
  onLoadMore: () => void;
  sentinelRef?: Ref<HTMLLIElement>;
}) {
  const t = useTranslations("messages");
  if (status === "LoadingFirstPage") return null;
  if (status === "Exhausted") {
    return (
      <li className="text-muted-foreground py-1 text-center text-xs">
        {t("startOfConversation")}
      </li>
    );
  }
  const loading = status === "LoadingMore";
  return (
    <li ref={sentinelRef} className="flex justify-center">
      <button
        type="button"
        onClick={loading ? undefined : onLoadMore}
        aria-disabled={loading || undefined}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs outline-none transition-colors focus-visible:ring-2 aria-disabled:cursor-default aria-disabled:hover:text-muted-foreground"
      >
        {loading && (
          <Loader2
            className="size-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        )}
        {loading ? t("loadingEarlier") : t("loadEarlier")}
      </button>
    </li>
  );
}
