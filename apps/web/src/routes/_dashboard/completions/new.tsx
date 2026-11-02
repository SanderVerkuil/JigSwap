import { useUser } from "@/compat/clerk";
import { useRouter } from "@/compat/navigation";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { PickerCapNote } from "@/components/library/picker-cap-note";
import { FinishSolveDialog } from "@/components/solving/finish-solve-dialog";
import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
import { SolvePicker } from "@/components/solving/solve-picker";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import {
  buildSolvePickerSections,
  type SolvePickerItem,
} from "@/lib/solve-picker";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
  const displayName = useMemberDisplayName();
  // The picked puzzle; null while the picker shows.
  const [picked, setPicked] = useState<SolvePickerItem | null>(null);
  // The dialogs have no Radix trigger, so focus returns to the row they were opened from.
  const pickedFromRef = useReturnFocus(picked !== null);

  const { data: convexUser, isPending: convexUserPending } = useQuery(
    convexQuery(
      gateway.identity.byClerkId,
      user?.id ? { clerkId: user.id } : "skip",
    ),
  );
  const signedIn = !!convexUser?._id;

  // Everything the member may log a solve for (solving/solvableCopy.ts): their own copies, the
  // copies they hold on loan and their household's copies, plus the solves they have in progress.
  const { data: ownedPuzzles } = useQuery(
    convexQuery(
      gateway.library.ownedByOwner,
      convexUser?._id
        ? { ownerId: convexUser._id as Id<"users">, includeUnavailable: true }
        : "skip",
    ),
  );
  const { data: borrowed } = useQuery(
    convexQuery(gateway.lending.borrowed, signedIn ? {} : "skip"),
  );
  const { data: householdCopies } = useQuery(
    convexQuery(gateway.household.copies, signedIn ? {} : "skip"),
  );
  const { data: inProgress } = useQuery(
    convexQuery(gateway.solving.myInProgress, signedIn ? {} : "skip"),
  );

  usePageHeader(
    () => ({
      title: t("new.title"),
      crumbs: [
        { label: tShell("groups.library.label"), href: "/library" },
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

  // Wait for every list: until the in-progress solves are known, a copy with one would be offered
  // as a new solve instead of the solve to finish.
  if (
    !user ||
    convexUserPending ||
    convexUser === undefined ||
    ownedPuzzles === undefined ||
    borrowed === undefined ||
    householdCopies === undefined ||
    inProgress === undefined
  ) {
    return <PageLoading message={tCommon("loading")} />;
  }

  const sections = buildSolvePickerSections({
    inProgress,
    owned: ownedPuzzles,
    borrowed,
    household: householdCopies,
    nameOf: displayName,
  });
  const pickedTitle = picked?.title ?? t("new.untitled");
  const close = (open: boolean) => {
    if (!open) setPicked(null);
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <p className="text-muted-foreground text-sm">{t("new.subtitle")}</p>
      <PickerCapNote
        shown={Math.max(ownedPuzzles.length, householdCopies.length)}
      />

      <SolvePicker
        sections={sections}
        onPick={(item, trigger) => {
          pickedFromRef.current = trigger;
          setPicked(item);
        }}
      />

      {picked?.target.kind === "log" && (
        <LogSolveDialog
          open
          onOpenChange={close}
          copyId={picked.target.copyId}
          puzzleTitle={pickedTitle}
          viewerIsOwner={picked.target.viewerIsOwner}
          onSuccess={() => router.push("/completions")}
        />
      )}

      {picked?.target.kind === "finish" && (
        <FinishSolveDialog
          open
          onOpenChange={close}
          completionId={picked.target.completionId}
          minEndDate={picked.target.startDate}
          puzzleTitle={pickedTitle}
          onSuccess={() => router.push("/completions")}
        />
      )}
    </div>
  );
}
