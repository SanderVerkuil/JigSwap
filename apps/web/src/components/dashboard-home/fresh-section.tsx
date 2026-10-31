"use client";

import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useTranslations } from "use-intl";
import { SectionHead } from "./section-head";
import { MY_SHELF_SIZE, shelfBoxCount } from "./shelf-section";
import { useCurrentMember } from "./use-current-member";

// "Fresh on the Shelf": the member's most recently added copies as a
// horizontal scroller of puzzle cards. It only appears once the library holds
// more copies than the shelf shows on this device: until then the shelf above
// already shows every one of them (and with an empty library the shelf owns the
// first-puzzle invitation). Once shown it still starts at the newest copy, so
// it overlaps the shelf's boxes; it is only guaranteed to add at least one
// puzzle the shelf does not show.
export function FreshSection() {
  const t = useTranslations("dashboard.fresh");
  const isMobile = useIsMobile();
  const { member, isMemberLoading } = useCurrentMember();

  // Same arguments as the Shelf section above, so both share one subscription.
  const { data: shelf } = useQuery(
    convexQuery(
      gateway.library.myShelf,
      member?._id ? { limit: MY_SHELF_SIZE } : "skip",
    ),
  );

  const loading = isMemberLoading || (member != null && shelf === undefined);

  if (loading) {
    return (
      <section>
        <SectionHead title={t("title")} icon={Sparkles} />
        <div className="grid auto-cols-[214px] grid-flow-col gap-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full" />
          ))}
        </div>
      </section>
    );
  }

  // `total` counts the whole library; `recent` holds only the newest few.
  if ((shelf?.total ?? 0) <= shelfBoxCount(isMobile)) return null;
  // The shelf read is already newest-first; take the freshest six.
  const fresh = (shelf?.recent ?? []).slice(0, 6);

  return (
    <section>
      <SectionHead
        title={t("title")}
        icon={Sparkles}
        meta={t("meta")}
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/my-puzzles">{t("myPuzzles")}</Link>
          </Button>
        }
      />
      <div className="grid auto-cols-[214px] grid-flow-col gap-4 overflow-x-auto pb-2">
        {fresh.map((copy) => (
          // PuzzleCard reads its grid/list mode from context; each cell gets
          // its own single-card provider so the scroller owns the layout. The
          // one-track grid keeps the card at the cell's full width and height
          // (the provider's default grid is two columns on phones). The cover's
          // width is the rail's fixed 214px column (auto-cols-[214px]).
          <PuzzleViewProvider key={copy._id} viewMode="grid" className="grid">
            <PuzzleCard puzzle={copy} showActions={false} imageSizes="214px" />
          </PuzzleViewProvider>
        ))}
      </div>
    </section>
  );
}
