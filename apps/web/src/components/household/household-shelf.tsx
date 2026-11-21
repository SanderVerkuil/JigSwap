import { SectionHead } from "@/components/dashboard-home/section-head";
import { copyShelfBox } from "@/components/shelf/copy-box";
import { Shelf } from "@/components/shelf/shelf";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";

// How many of the household's newest boxes stand on its shelf above the list.
const HOUSEHOLD_SHELF_SIZE = 6;

// The household's shared shelf: the newest boxes of everyone in the house, whatever the filters
// below narrow the list to, under its own name like every other shelf. The viewer's own open as
// theirs, a housemate's as that copy.
export function HouseholdShelf({
  viewerId,
  label,
}: {
  viewerId: string;
  label: string;
}) {
  const { data } = useQuery(
    convexQuery(gateway.library.myLibraryWindow, {
      limit: HOUSEHOLD_SHELF_SIZE,
    }),
  );
  const rows = data?.rows ?? [];
  if (rows.length === 0) return null;
  return (
    <section className="mb-3">
      <SectionHead title={label} icon={BookOpen} />
      <Shelf
        boxes={rows.map((copy) =>
          copyShelfBox(
            copy,
            copy.ownerId === viewerId
              ? `/my-puzzles/${copy._id}`
              : `/copies/${copy._id}`,
          ),
        )}
        label={label}
      />
    </section>
  );
}
