import { WHATS_NEW_ENTRIES } from "@/components/whats-new/entries";
import { useWhatsNewState } from "@/components/whats-new/use-whats-new-state";
import { WhatsNewList } from "@/components/whats-new/whats-new-list";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { useConvexMutation } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

// The changelog: every bundled entry, newest first, grouped by month. The shell page head renders
// the "What's new" title (ROUTE_META), so there is no page h1 here.
export const Route = createFileRoute("/_dashboard/whats-new")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "whatsNew") }],
  }),
  component: WhatsNewPage,
});

// markWhatsNewSeen's batch cap. More unseen entries than this is unrealistic; any rest is
// cleared on the next visit.
const MAX_SEEN_BATCH = 50;

function WhatsNewPage() {
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

  // A #entry-{id} deep link (modal "Read more", W3's notification): bring the entry into view and
  // move focus to its title so screen readers start there (spec Part B §1.11).
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id.startsWith("entry-")) return;
    const article = document.getElementById(id);
    if (!article) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    article.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    article.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
  }, []);

  return (
    <WhatsNewList
      entries={WHATS_NEW_ENTRIES}
      unreadIds={snapshot}
      tours={tours}
    />
  );
}
