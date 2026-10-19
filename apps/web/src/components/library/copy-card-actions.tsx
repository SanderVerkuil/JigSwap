import { useRouter } from "@/compat/navigation";
import { FinishSolveDialog } from "@/components/solving/finish-solve-dialog";
import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
import { StartSolveDialog } from "@/components/solving/start-solve-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { gateway, Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import type { HouseholdCopyPermission } from "@jigswap/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

export interface SolveState {
  inProgress: boolean;
  completed: boolean;
  inProgressCompletionId?: string;
  inProgressStartDate?: number;
}

// The member's solve log keyed by the copy's ownedPuzzles _id: whether each copy has a solve in
// progress (and the newest one to finish) or a completed one.
export function useSolveStateByCopyId(
  enabled: boolean,
): Map<string, SolveState> {
  const { data: completions } = useQuery(
    convexQuery(gateway.solving.myCompletions, enabled ? {} : "skip"),
  );
  return useMemo(() => {
    const map = new Map<string, SolveState>();
    for (const completion of completions ?? []) {
      if (!completion.ownedPuzzleId) continue;
      const state = map.get(completion.ownedPuzzleId) ?? {
        inProgress: false,
        completed: false,
      };
      if (completion.isCompleted) state.completed = true;
      else {
        state.inProgress = true;
        // Retain the newest in-progress completion so the card's Finish action targets it.
        if (
          completion.aggregateId &&
          (state.inProgressStartDate === undefined ||
            completion.startDate > state.inProgressStartDate)
        ) {
          state.inProgressCompletionId = completion.aggregateId;
          state.inProgressStartDate = completion.startDate;
        }
      }
      map.set(completion.ownedPuzzleId, state);
    }
    return map;
  }, [completions]);
}

interface ActionableCopy {
  _id: string;
  aggregateId?: string;
  puzzle?: { title?: string } | null;
}

// The ⋯ menu actions a puzzle card offers, for the viewer's own copies and their housemates'
// alike (My Puzzles and the household's Puzzles tab). What a card offers follows the viewer's
// access: the owner gets everything; a housemate gets solving, plus Edit only when the owner left
// the copy at "manage", and never Delete or personal collections. The server enforces the same
// rules on every action; this only hides what would be refused. Render `dialogs` once on the page.
export function useCopyCardActions({
  copies,
  householdAccessById,
  solveStateByCopyId,
}: {
  copies: readonly ActionableCopy[];
  // A housemate's copy maps to the viewer's access; the viewer's own copies are absent.
  householdAccessById: ReadonlyMap<
    string,
    { viewerAccess: HouseholdCopyPermission }
  >;
  solveStateByCopyId: ReadonlyMap<string, SolveState>;
}): {
  cardActions: (copyId: string) => {
    onEdit?: (id: Id<"ownedPuzzles">) => void;
    onDelete?: (id: Id<"ownedPuzzles">) => void;
    onLogSolve: (id: Id<"ownedPuzzles">) => void;
    onStartSolve: (id: Id<"ownedPuzzles">) => void;
    solveInProgress: boolean;
    showCollectionDropdown: boolean;
  };
  dialogs: ReactNode;
} {
  const router = useRouter();
  const t = useTranslations("puzzles");
  const tCommon = useTranslations("common");
  // The copy a solve is being logged against; null when the dialog is closed.
  const [solveTarget, setSolveTarget] = useState<{
    copyId: string;
    title: string;
    canManage: boolean;
  } | null>(null);
  // The copy a solve is being started on; null when the dialog is closed.
  const [startTarget, setStartTarget] = useState<{
    copyId: string;
    title: string;
  } | null>(null);
  // The in-progress completion being finished; null when the dialog is closed.
  const [finishTarget, setFinishTarget] = useState<{
    completionId: string;
    startDate: number;
  } | null>(null);
  // The copy awaiting the destructive delete confirm; null when the dialog is closed.
  const [deleteTarget, setDeleteTarget] = useState<{
    copyId: string;
    title: string;
  } | null>(null);

  const deletePuzzle = useMutation({
    mutationFn: useConvexMutation(gateway.library.deleteOwned),
  });

  const handleDeletePuzzle = (ownedPuzzleId: Id<"ownedPuzzles">) => {
    // The domain delete takes the Copy aggregateId; resolve it from the loaded row. Guard rows
    // that predate the backfill (no aggregateId) rather than send an unresolvable id.
    const copy = copies.find((p) => p._id === ownedPuzzleId);
    if (!copy?.aggregateId) {
      console.error("Cannot delete: copy is missing its aggregateId.");
      return;
    }
    setDeleteTarget({
      copyId: copy.aggregateId,
      title: copy.puzzle?.title ?? "",
    });
  };

  const confirmDeletePuzzle = async (copyId: string) => {
    try {
      await deletePuzzle.mutateAsync({ copyId });
    } catch (error) {
      console.error("Failed to delete puzzle:", error);
    }
  };

  const handleEditPuzzle = (ownedPuzzleId: Id<"ownedPuzzles">) => {
    router.push(`/my-puzzles/${ownedPuzzleId}/edit`);
  };

  const handleLogSolve = (ownedPuzzleId: Id<"ownedPuzzles">) => {
    // Solves are logged against the Copy aggregateId; guard rows predating the backfill rather
    // than open a dialog that can't persist.
    const copy = copies.find((p) => p._id === ownedPuzzleId);
    if (!copy?.aggregateId) {
      console.error("Cannot log a solve: copy is missing its aggregateId.");
      return;
    }
    setSolveTarget({
      copyId: copy.aggregateId,
      title: copy.puzzle?.title ?? "",
      // Only someone who may manage the copy is offered to update its missing-pieces count.
      canManage: householdAccessById.get(copy._id)?.viewerAccess !== "view",
    });
  };

  const handleStartSolve = (ownedPuzzleId: Id<"ownedPuzzles">) => {
    // Starting a solve takes the Copy aggregateId; guard rows predating the backfill rather
    // than open a dialog that can't persist.
    const copy = copies.find((p) => p._id === ownedPuzzleId);
    if (!copy?.aggregateId) {
      console.error("Cannot start a solve: copy is missing its aggregateId.");
      return;
    }
    // With an in-progress solve on the copy, the action flips to finishing that solve.
    const state = solveStateByCopyId.get(ownedPuzzleId);
    if (
      state?.inProgressCompletionId &&
      state.inProgressStartDate !== undefined
    ) {
      setFinishTarget({
        completionId: state.inProgressCompletionId,
        startDate: state.inProgressStartDate,
      });
    } else {
      setStartTarget({
        copyId: copy.aggregateId,
        title: copy.puzzle?.title ?? "",
      });
    }
  };

  const cardActions = (copyId: string) => {
    // A household copy: owner-only actions (delete, personal collections) are hidden, and
    // edit is offered only when the owner left it at "manage".
    const household = householdAccessById.get(copyId);
    const canManage = household?.viewerAccess !== "view";
    return {
      onEdit: canManage ? handleEditPuzzle : undefined,
      onDelete: household ? undefined : handleDeletePuzzle,
      onLogSolve: handleLogSolve,
      onStartSolve: handleStartSolve,
      // Matches handleStartSolve's finish predicate (not `inProgress`): a legacy in-progress row
      // without an aggregateId can't be finished, so its card must keep showing "Start puzzle"
      // rather than a Finish label that opens Start.
      solveInProgress:
        solveStateByCopyId.get(copyId)?.inProgressCompletionId != null,
      showCollectionDropdown: !household,
    };
  };

  const dialogs = (
    <>
      {solveTarget && (
        <LogSolveDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setSolveTarget(null);
          }}
          copyId={solveTarget.copyId}
          puzzleTitle={solveTarget.title}
          viewerIsOwner={solveTarget.canManage}
        />
      )}

      {startTarget && (
        <StartSolveDialog
          open
          onOpenChange={(open) => !open && setStartTarget(null)}
          copyId={startTarget.copyId}
          puzzleTitle={startTarget.title}
        />
      )}

      {finishTarget && (
        <FinishSolveDialog
          open
          onOpenChange={(open) => !open && setFinishTarget(null)}
          completionId={finishTarget.completionId}
          minEndDate={finishTarget.startDate}
        />
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deleteConfirmTitle", { title: deleteTarget?.title ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (deleteTarget) {
                  void confirmDeletePuzzle(deleteTarget.copyId);
                }
                setDeleteTarget(null);
              }}
            >
              {t("deleteConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return { cardActions, dialogs };
}
