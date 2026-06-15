"use client";

import { Link } from "@/compat/link";
import { PuzzlePlankBox } from "@/components/common/puzzle-plank";
import { PuzzlePlank3D } from "@/components/common/puzzle-plank-3d";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BookOpen } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "use-intl";
import type { Member } from "./member-view";

type OwnedCopy = FunctionReturnType<
  typeof gateway.library.ownedByOwner
>[number];

// Same warm gradient fallbacks as the dashboard shelf — never an empty gray box.
const BOX_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ["#6048e8", "#494e92"],
  ["#3fae3c", "#157a13"],
  ["#ec4899", "#b22d6e"],
  ["#f5a623", "#cf7911"],
];

// Varied box heights so the shelf reads like a real, lived-in collection.
const BOX_HEIGHTS = [148, 130, 156, 126, 142];

function toPlankBox(copy: OwnedCopy, index: number): PuzzlePlankBox {
  const cover = copy.puzzle?.images?.[0] ?? copy.snapshot?.thumbnail;
  const [c1, c2] = BOX_GRADIENTS[index % BOX_GRADIENTS.length];
  return {
    title: copy.puzzle?.title ?? copy.snapshot?.title,
    series: copy.puzzle?.brand ?? copy.snapshot?.brand,
    pieceCount: copy.puzzle?.pieceCount ?? copy.snapshot?.pieceCount,
    cover,
    c1,
    c2,
    height: cover ? undefined : BOX_HEIGHTS[index % BOX_HEIGHTS.length],
  };
}

// "{FirstName}'s Shelf": the signature puzzle plank rendering the member's
// real copies on their profile, capped at six boxes so the plank stays a
// display shelf rather than a catalogue (My Puzzles is the catalogue).
export function ProfileShelfSection({ member }: { member: Member }) {
  const t = useTranslations("profile.shelf");
  const tDashboardShelf = useTranslations("dashboard.shelf");

  const copies = useQuery(gateway.library.ownedByOwner, {
    ownerId: member._id as Id<"users">,
    includeUnavailable: true,
  });

  const firstName = member.name?.split(/\s+/)[0] ?? member.name;
  const title = t("title", { name: firstName });

  // Memoized so the 3D plank's color-resolution effect doesn't re-run on every
  // reactive re-render (only when the copies change).
  const boxes = useMemo(
    () => (copies ?? []).slice(0, 6).map(toPlankBox),
    [copies],
  );

  if (copies === undefined) {
    return (
      <section>
        <SectionHead title={title} icon={BookOpen} />
        <Skeleton className="h-44 w-full" />
      </section>
    );
  }

  return (
    <section>
      <SectionHead
        title={title}
        icon={BookOpen}
        meta={boxes.length > 0 ? t("meta", { count: boxes.length }) : undefined}
      />
      {boxes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-muted-foreground max-w-md text-sm">
            {tDashboardShelf("empty")}
          </p>
          <Button asChild>
            <Link href="/my-puzzles/add">{tDashboardShelf("addFirst")}</Link>
          </Button>
        </div>
      ) : (
        <div className="h-[300px] min-w-0 md:h-[360px]">
          <PuzzlePlank3D boxes={boxes} />
        </div>
      )}
    </section>
  );
}
