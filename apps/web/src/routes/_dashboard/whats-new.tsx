import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  StickyTabsBar,
  TAB_TRIGGER_CLASS,
  UNDERLINE_TABS_LIST_CLASS,
} from "@/components/ui/underline-tabs";
import { WHATS_NEW_ENTRIES } from "@/components/whats-new/entries";
import { GuidesList } from "@/components/whats-new/guides-list";
import { useWhatsNewState } from "@/components/whats-new/use-whats-new-state";
import { WhatsNewList } from "@/components/whats-new/whats-new-list";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { useConvexMutation } from "@convex-dev/react-query";
import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { Compass, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

// The changelog: every bundled entry, newest first, grouped by month, and (Guides tab) every tour.
// The shell page head renders the "What's new" title (ROUTE_META), so there is no page h1 here.
export const Route = createFileRoute("/_dashboard/whats-new")({
  // ?tab=guides opens the Guides tab; Updates is the default and keeps a clean /whats-new URL.
  validateSearch: (search: Record<string, unknown>): { tab?: "guides" } => ({
    tab: search.tab === "guides" ? "guides" : undefined,
  }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "whatsNew") }],
  }),
  component: WhatsNewPage,
});

// markWhatsNewSeen's batch cap. More unseen entries than this is unrealistic; any rest is
// cleared on the next visit.
const MAX_SEEN_BATCH = 50;

function WhatsNewPage() {
  const t = useTranslations("whatsNew.tabs");
  const { tab } = Route.useSearch();
  const activeTab = tab ?? "updates";
  const navigate = useNavigate({ from: Route.fullPath });
  const hash = useLocation({ select: (location) => location.hash });
  const { unreadIds, tours } = useWhatsNewState();
  const markSeen = useConvexMutation(gateway.whatsNew.markSeen);

  // Snapshot rule (spec Part B §1.5): keep the unread set captured when the state first loads, so
  // the "New" pills stay for the whole visit even though the visit marks them seen. Adjusting
  // state during render (not in an effect) is React's pattern for this.
  const [snapshot, setSnapshot] = useState<readonly string[]>();
  if (snapshot === undefined && unreadIds !== undefined) {
    setSnapshot(unreadIds);
  }

  // Mark the entries this page shows as seen, once per visit, after the first render with state.
  // Only bundled ids (the snapshot is already intersected), so an entry the backend knows but this
  // deploy cannot render yet stays unread until it is actually shown.
  const markedRef = useRef(false);
  useEffect(() => {
    if (snapshot === undefined || markedRef.current) return;
    markedRef.current = true;
    if (snapshot.length === 0) return;
    markSeen({ ids: snapshot.slice(0, MAX_SEEN_BATCH) }).catch(
      (error: unknown) => console.error("Failed to mark updates seen:", error),
    );
  }, [snapshot, markSeen]);

  // A #entry-{id} deep link (modal "Read more", W3's notification, a guide's "Introduced" link)
  // or a #guide-{tourId} one: bring the card into view and move focus to its title so screen
  // readers start there (spec Part B §1.11). A guide link without ?tab=guides switches tab first.
  useEffect(() => {
    const id = hash.replace(/^#/, "");
    if (!id.startsWith("entry-") && !id.startsWith("guide-")) return;
    if (id.startsWith("guide-") && activeTab !== "guides") {
      void navigate({
        search: { tab: "guides" },
        hash: id,
        replace: true,
        resetScroll: false,
      });
      return;
    }
    // A tab that was just switched to mounts its content a frame later (Radix Presence), so look
    // for the card for a few frames.
    let frame = 0;
    let request = 0;
    const reveal = () => {
      const article = document.getElementById(id);
      if (!article) {
        if (++frame < 10) request = requestAnimationFrame(reveal);
        return;
      }
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      article.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
      article.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
    };
    reveal();
    return () => cancelAnimationFrame(request);
  }, [hash, activeTab, navigate]);

  const handleTabChange = (value: string) => {
    void navigate({
      search: { tab: value === "guides" ? "guides" : undefined },
      replace: true,
      // A tab switch is a view change on the same page, not a new page: keep the scroll position.
      resetScroll: false,
    });
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="mx-auto w-full max-w-3xl"
    >
      <StickyTabsBar>
        <TabsList className={UNDERLINE_TABS_LIST_CLASS}>
          <TabsTrigger value="updates" className={TAB_TRIGGER_CLASS}>
            <Sparkles aria-hidden />
            {t("updates")}
          </TabsTrigger>
          <TabsTrigger value="guides" className={TAB_TRIGGER_CLASS}>
            <Compass aria-hidden />
            {t("guides")}
          </TabsTrigger>
        </TabsList>
      </StickyTabsBar>
      <TabsContent value="updates" className="mt-6">
        <WhatsNewList
          entries={WHATS_NEW_ENTRIES}
          unreadIds={snapshot}
          tours={tours}
        />
      </TabsContent>
      <TabsContent value="guides" className="mt-6">
        <GuidesList entries={WHATS_NEW_ENTRIES} tours={tours} />
      </TabsContent>
    </Tabs>
  );
}
