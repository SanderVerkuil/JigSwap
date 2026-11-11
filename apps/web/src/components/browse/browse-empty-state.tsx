import { EmptyState } from "@/components/community/primitives";
import { Button } from "@/components/ui/button";
import { gateway, type Id } from "@/gateway";
import { useFavorites } from "@/hooks/use-favorites";
import { browseEmptyState, type BrowseSearch } from "@/lib/browse-search";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { useTranslations } from "use-intl";

// What an empty Browse says, picked by browseEmptyState: a plain search is named as one, only a set
// filter is blamed, and every message offers the next step. A search or filter leads on to the
// catalogue, carrying the text, since it lists puzzles nobody offers yet. The way to clear them is
// the toolbar's Clear All, on screen whenever one is set, so it isn't repeated here.
export function BrowseEmptyState({ search }: { search: BrowseSearch }) {
  const t = useTranslations("browse");
  const kind = browseEmptyState(search);

  if (kind === "searched" || kind === "filtered") {
    return (
      <EmptyState
        // The member's own text may be one long word: let it wrap inside the column.
        className={kind === "searched" ? "wrap-anywhere" : undefined}
        title={
          kind === "searched"
            ? t("empty.searchedTitle", { query: search.q ?? "" })
            : t("empty.filteredTitle")
        }
        sub={
          kind === "searched"
            ? t("empty.searchedHint")
            : t("tryDifferentFilters")
        }
        action={
          <Button asChild variant="outline" className="text-foreground">
            <Link to="/puzzles" search={{ q: search.q }}>
              {t("empty.openCatalogue")}
            </Link>
          </Button>
        }
      />
    );
  }

  if (kind === "puzzleNotOffered" && search.puzzle) {
    return <PuzzleNotOffered puzzleId={search.puzzle} />;
  }

  return (
    <EmptyState
      title={t("empty.noOffersTitle")}
      sub={t("empty.noOffersHint")}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/puzzles">{t("empty.openCatalogue")}</Link>
          </Button>
          <Button asChild variant="outline" className="text-foreground">
            <Link to="/people" search={{ tab: "find" }}>
              {t("empty.findPeople")}
            </Link>
          </Button>
        </div>
      }
    />
  );
}

// Arrived from "Find a copy" and nobody offers it: favouriting keeps the puzzle within reach (the
// catalogue's Favorites filter). Shares the filter chip's read of the puzzle, and offers no
// favourite while it is unknown (a malformed or removed id).
function PuzzleNotOffered({ puzzleId }: { puzzleId: string }) {
  const t = useTranslations("browse");
  const tCatalog = useTranslations("puzzles.puzzles");
  const { isFavorite, toggleFavorite } = useFavorites();
  const { data: puzzle } = useQuery(
    convexQuery(gateway.catalog.puzzleById, {
      puzzleId: puzzleId as Id<"puzzles">,
    }),
  );
  const favorited = isFavorite(puzzleId);

  return (
    <EmptyState
      title={t("empty.puzzleNotOfferedTitle")}
      sub={puzzle ? t("empty.puzzleNotOfferedHint") : undefined}
      action={
        puzzle && (
          <Button
            variant="outline"
            onClick={() => void toggleFavorite(puzzleId)}
            className="text-foreground"
          >
            <Heart
              className={cn(
                "h-4 w-4",
                favorited && "fill-red-500 text-red-500",
              )}
              aria-hidden
            />
            {favorited
              ? tCatalog("removeFromFavorites")
              : tCatalog("addToFavorites")}
          </Button>
        )
      }
    />
  );
}
