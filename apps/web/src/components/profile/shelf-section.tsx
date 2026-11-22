"use client";

import { Link } from "@/compat/link";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { MY_SHELF_SIZE } from "@/components/dashboard-home/shelf-section";
import { copyShelfBox } from "@/components/shelf/copy-box";
import { Shelf, ShelfLedge } from "@/components/shelf/shelf";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { ArrangeShelfDialog } from "./arrange-shelf-dialog";
import type { Member } from "./member-view";

// "{FirstName}'s Shelf": the member's real copies on the shelf (components/shelf) on their profile,
// capped at six boxes so it stays a display shelf rather than a catalogue (My Puzzles is the
// catalogue). When the viewer is the owner, an "Arrange shelf" button opens a dialog to curate and
// reorder up to 6 copies (sub-project ④).
// Rendered only on the signed-in member's own profile (routes/_dashboard/profile.tsx): the
// uncurated fallback reads library.myShelf, which is always the caller's own shelf. Another
// member's profile has its own shelf (members/profile-body.tsx).
export function ProfileShelfSection({ member }: { member: Member }) {
  const t = useTranslations("profile.shelf");
  const displayName = useMemberDisplayName();
  const tDashboardShelf = useTranslations("dashboard.shelf");

  const [arrangeOpen, setArrangeOpen] = useState(false);

  // Determine whether the signed-in user is the profile owner.
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  const isOwner = me?._id === member._id;

  // Only the newest copies, for the uncurated fallback: the whole library is
  // read by the arrange dialog, and only while it is open.
  const { data: shelf } = useQuery(
    convexQuery(gateway.library.myShelf, { limit: MY_SHELF_SIZE }),
  );

  // The curated shelf — empty list means uncurated (fall back to recent-6 below).
  const { data: featuredCopies } = useQuery(
    convexQuery(gateway.social.featuredShelf, {
      userId: member._id as Id<"users">,
    }),
  );

  const name = displayName(member);
  const firstName = name.split(/\s+/)[0] || name;
  const title = t("title", { name: firstName });

  // Current featured copy ids for seeding the arrange dialog.
  const currentFeaturedIds = useMemo(
    () => (featuredCopies ?? []).map((c) => c._id as Id<"ownedPuzzles">),
    [featuredCopies],
  );

  // The curated order when there is one; else the most recent six. Each box opens as the member's
  // own copy.
  const copies =
    featuredCopies !== undefined && featuredCopies.length > 0
      ? featuredCopies
      : (shelf?.recent ?? []);
  const boxes = copies
    .slice(0, 6)
    .map((copy) => copyShelfBox(copy, `/my-puzzles/${copy._id}`));

  if (shelf === undefined || featuredCopies === undefined) {
    return (
      <section>
        <SectionHead title={title} icon={BookOpen} />
        <Skeleton className="h-36 w-full" />
        <ShelfLedge />
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
        // The empty shelf: the invitation stands where the boxes will.
        <div>
          <div className="flex flex-col items-start gap-3 pt-2 pb-5">
            <p className="text-muted-foreground max-w-md text-sm">
              {tDashboardShelf("empty")}
            </p>
            <Button asChild>
              <Link href="/my-puzzles/add">{tDashboardShelf("addFirst")}</Link>
            </Button>
          </div>
          <ShelfLedge />
        </div>
      ) : (
        <Shelf boxes={boxes} label={title} />
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
