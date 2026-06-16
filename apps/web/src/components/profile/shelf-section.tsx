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
import { BookOpen, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { ArrangeShelfDialog } from "./arrange-shelf-dialog";
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
  // Prefer the copy's resolved cover (a user-uploaded/pinned photo) over the
  // catalogue image so a copy with its own cover shows it, not placeholder art.
  const cover =
    copy.coverUrl ?? copy.puzzle?.images?.[0] ?? copy.snapshot?.thumbnail;
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
// When the viewer is the owner, an "Arrange shelf" button opens a dialog to
// curate and reorder up to 6 copies (sub-project ④).
export function ProfileShelfSection({ member }: { member: Member }) {
  const t = useTranslations("profile.shelf");
  const tDashboardShelf = useTranslations("dashboard.shelf");

  const [arrangeOpen, setArrangeOpen] = useState(false);

  // Determine whether the signed-in user is the profile owner.
  const me = useQuery(gateway.identity.currentUser);
  const isOwner = me?._id === member._id;

  const copies = useQuery(gateway.library.ownedByOwner, {
    ownerId: member._id as Id<"users">,
    includeUnavailable: true,
  });

  // The curated shelf — empty list means uncurated (fall back to recent-6 below).
  const featuredCopies = useQuery(gateway.social.featuredShelf, {
    userId: member._id as Id<"users">,
  });

  const firstName = member.name?.split(/\s+/)[0] ?? member.name;
  const title = t("title", { name: firstName });

  // Current featured copy ids for seeding the arrange dialog.
  const currentFeaturedIds = useMemo(
    () => (featuredCopies ?? []).map((c) => c._id as Id<"ownedPuzzles">),
    [featuredCopies],
  );

  // Memoized so the 3D plank's color-resolution effect doesn't re-run on every
  // reactive re-render (only when the copies change). Use curated order when
  // available; fall back to the most-recent 6.
  const boxes = useMemo(() => {
    if (featuredCopies !== undefined && featuredCopies.length > 0) {
      return featuredCopies.slice(0, 6).map(toPlankBox);
    }
    return (copies ?? []).slice(0, 6).map(toPlankBox);
  }, [copies, featuredCopies]);

  if (copies === undefined || featuredCopies === undefined) {
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
        action={
          isOwner ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setArrangeOpen(true)}
              className="gap-1.5"
            >
              <Settings2 className="size-4" />
              {t("arrangeShelf")}
            </Button>
          ) : undefined
        }
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
          <PuzzlePlank3D boxes={boxes} interactive />
        </div>
      )}

      {isOwner && arrangeOpen && (
        <ArrangeShelfDialog
          ownerId={member._id as Id<"users">}
          currentFeaturedIds={currentFeaturedIds}
          onClose={() => setArrangeOpen(false)}
        />
      )}
    </section>
  );
}
