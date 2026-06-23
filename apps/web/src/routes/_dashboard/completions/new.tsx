import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
import { useRouter } from "@/compat/navigation";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { EmptyState } from "@/components/library/empty-state";
import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { gateway, Id } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/completions/new")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "completionNew") }],
  }),
  component: NewCompletionPage,
});

function NewCompletionPage() {
  const { user } = useUser();
  const router = useRouter();
  const t = useTranslations("solving.completions");
  const tShell = useTranslations("shell");
  const tCommon = useTranslations("common");
  const [searchTerm, setSearchTerm] = useState("");
  const [solveTarget, setSolveTarget] = useState<{
    copyId: string;
    title: string;
  } | null>(null);

  const convexUser = useQuery(
    gateway.identity.byClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const ownedPuzzles = useQuery(
    gateway.library.ownedByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id as Id<"users">, includeUnavailable: true }
      : "skip",
  );

  usePageHeader(
    () => ({
      title: t("new.title"),
      crumbs: [
        {
          label: tShell("pages.completions.title"),
          href: "/completions",
        },
      ],
      actions: (
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/completions")}
        >
          {tCommon("cancel")}
        </Button>
      ),
    }),
    [t, tShell, tCommon],
  );

  if (!user || convexUser === undefined || ownedPuzzles === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  const filteredPuzzles = ownedPuzzles.filter(
    (puzzle) =>
      !searchTerm ||
      puzzle.puzzle?.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (puzzle.puzzle?.brand &&
        puzzle.puzzle.brand.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  const handleSelect = (ownedPuzzleId: Id<"ownedPuzzles">) => {
    const copy = ownedPuzzles.find((p) => p._id === ownedPuzzleId);
    if (!copy?.aggregateId) {
      console.error("Cannot log a solve: copy is missing its aggregateId.");
      return;
    }
    setSolveTarget({
      copyId: copy.aggregateId,
      title: copy.puzzle?.title ?? "",
    });
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <p className="text-muted-foreground text-sm">{t("new.subtitle")}</p>

      {/* Search */}
      <div className="relative w-full max-w-sm">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          type="text"
          placeholder={tCommon("search")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9"
        />
      </div>

      {filteredPuzzles.length === 0 ? (
        <EmptyState title={t("new.noPuzzles")} sub={t("new.noPuzzlesHint")} />
      ) : (
        <PuzzleViewProvider viewMode="grid">
          {filteredPuzzles.map((puzzle) => (
            <PuzzleCard
              key={puzzle._id}
              puzzle={puzzle}
              variant="pick"
              onSelect={handleSelect}
            />
          ))}
        </PuzzleViewProvider>
      )}

      {solveTarget && (
        <LogSolveDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              setSolveTarget(null);
            }
          }}
          copyId={solveTarget.copyId}
          puzzleTitle={solveTarget.title}
          viewerIsOwner={true}
          onSuccess={() => router.push("/completions")}
        />
      )}
    </div>
  );
}
