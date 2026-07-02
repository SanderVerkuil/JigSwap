"use client";

import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useTranslations } from "use-intl";
import { SectionHead } from "./section-head";
import { useCurrentMember } from "./use-current-member";

// "Fresh on the Shelf": the member's most recently added copies as a
// horizontal scroller of puzzle cards. With an empty library it renders
// nothing at all — the Shelf section already owns the first-puzzle invitation.
export function FreshSection() {
  const t = useTranslations("dashboard.fresh");
  const { member, isMemberLoading } = useCurrentMember();

  const { data: copies } = useQuery(
    convexQuery(
      gateway.library.ownedByOwner,
      member?._id
        ? { ownerId: member._id as Id<"users">, includeUnavailable: true }
        : "skip",
    ),
  );

  const loading = isMemberLoading || (member != null && copies === undefined);

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

  // The library read is already newest-first; take the freshest six.
  const fresh = (copies ?? []).slice(0, 6);
  if (fresh.length === 0) return null;

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
          // its own single-card provider so the scroller owns the layout.
          <PuzzleViewProvider key={copy._id} viewMode="grid">
            <PuzzleCard puzzle={copy} showActions={false} />
          </PuzzleViewProvider>
        ))}
      </div>
    </section>
  );
}
