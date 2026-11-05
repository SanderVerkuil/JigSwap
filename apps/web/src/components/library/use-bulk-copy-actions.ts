import { circleShareErrorKey } from "@/components/circles/circle-share";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import {
  BULK_OFFERS_BATCH,
  chunk,
  COLLECTION_ADD_CONCURRENCY,
  OFFER_CHANGES,
  planCircleShare,
  planCollectionAdd,
  planOfferAction,
  runWithConcurrency,
  shareInBatches,
  undoChanges,
  type BulkCopy,
  type BulkOfferAction,
  type Offers,
  type OfferSend,
} from "./bulk-selection";

// My Puzzles' bulk actions on the selected copies, each ending in one summary toast.
//
// Offer for swap / Offer to lend / Withdraw offers go through `library.updateOffers` in calls of at
// most 100 copies, with offers only (never a visibility or a price), so every copy keeps its owner's
// visibility choice; the server applies the single-copy rules (manager, loan, reservation) to each
// copy and reports what it skipped. The toast offers Undo, which puts back only the flags the action
// set, on the copies it changed. The server can refuse that as well: an offer withdrawn from a copy
// out on loan or now reserved can't go back on.
//
// Add to collection sends the member's own copies one `collections.addOwnedPuzzle` call each, four
// at a time; housemates' copies never go into personal collections.
//
// Share with circle sends the member's own copies through `sharing.shareCopiesToCircle` in calls of
// at most 100: only a copy's owner may share it, and the server checks that and the member's seat.
// The toast says what it left out, what failed and which shared copies members won't see yet.
export function useBulkCopyActions({
  isHousemateCopy,
}: {
  // Keyed by the copy's ownedPuzzles _id.
  isHousemateCopy: (copyDocId: string) => boolean;
}) {
  const t = useTranslations("puzzles.bulk.result");
  const tCollection = useTranslations("puzzles.bulk.collection");
  const tCircle = useTranslations("puzzles.bulk.circle");
  const tCircles = useTranslations("circles");
  const updateOffers = useConvexMutation(gateway.library.updateOffers);
  const addCopyToCollection = useConvexMutation(
    gateway.collections.addOwnedPuzzle,
  );
  const shareCopies = useConvexMutation(gateway.sharing.shareCopiesToCircle);
  const [busy, setBusy] = useState(false);

  const writeOffers = (copyIds: string[], change: Partial<Offers>) =>
    updateOffers({ copyIds, ...change });

  const undo = async (action: BulkOfferAction, changed: OfferSend[]) => {
    try {
      let refused = 0;
      for (const { copyIds, change } of undoChanges(action, changed))
        for (const ids of chunk(copyIds, BULK_OFFERS_BATCH))
          refused += (await writeOffers(ids, change)).skipped.length;
      if (refused > 0) toast.error(t("undoFailed"));
    } catch {
      toast.error(t("undoFailed"));
    }
  };

  const offer = async (
    action: BulkOfferAction,
    copies: readonly BulkCopy[],
  ) => {
    const plan = planOfferAction(copies, action);
    let updated = 0;
    let unchanged = plan.unchanged;
    let failed = 0;
    const skipped = { onLoan: 0, reserved: 0, notAllowed: 0 };
    const changed: OfferSend[] = [];

    setBusy(true);
    try {
      for (const batch of chunk(plan.send, BULK_OFFERS_BATCH)) {
        try {
          const result = await writeOffers(
            batch.map((copy) => copy.copyId),
            OFFER_CHANGES[action],
          );
          updated += result.updated;
          unchanged += result.unchanged;
          for (const { reason } of result.skipped) skipped[reason] += 1;
          const skippedIds = new Set(result.skipped.map((s) => s.copyId));
          changed.push(...batch.filter((copy) => !skippedIds.has(copy.copyId)));
        } catch {
          failed += batch.length;
        }
      }
    } finally {
      setBusy(false);
    }

    const nowVisible =
      action === "withdraw"
        ? 0
        : changed.filter((copy) => copy.wasPrivate).length;
    const notes = (includeFailed: boolean) =>
      [
        nowVisible > 0 && t("visibleWhileOffered", { count: nowVisible }),
        unchanged > 0 && t("unchanged", { count: unchanged }),
        skipped.onLoan > 0 && t("onLoan", { count: skipped.onLoan }),
        skipped.reserved > 0 && t("reserved", { count: skipped.reserved }),
        skipped.notAllowed > 0 &&
          t("notAllowed", { count: skipped.notAllowed }),
        includeFailed && failed > 0 && t("failed", { count: failed }),
      ]
        .filter(Boolean)
        .join(" ");
    const description = (includeFailed: boolean) => {
      const text = notes(includeFailed);
      return text ? { description: text } : {};
    };

    if (updated > 0) {
      toast.success(t(action, { count: updated }), {
        ...description(true),
        action: {
          label: t("undo"),
          onClick: () => void undo(action, changed),
        },
      });
    } else if (failed > 0) {
      toast.error(t("failed", { count: failed }), description(false));
    } else {
      toast.info(t("nothingChanged"), description(true));
    }
  };

  const addToCollection = async (
    collection: { aggregateId?: string; name: string },
    copies: readonly BulkCopy[],
  ) => {
    const plan = planCollectionAdd(copies, isHousemateCopy);
    const collectionId = collection.aggregateId;
    const housemates =
      plan.housemates > 0
        ? tCollection("housemates", { count: plan.housemates })
        : "";

    setBusy(true);
    let succeeded = 0;
    let failed = 0;
    try {
      if (collectionId) {
        const result = await runWithConcurrency(
          plan.copyIds,
          COLLECTION_ADD_CONCURRENCY,
          (copyId) => addCopyToCollection({ collectionId, copyId }),
        );
        succeeded = result.succeeded.length;
        failed = result.failed.length;
      } else {
        // A collection from before the domain backfill can't take copies.
        failed = plan.copyIds.length;
      }
    } finally {
      setBusy(false);
    }

    const description = [
      housemates,
      succeeded > 0 && failed > 0 && tCollection("failed", { count: failed }),
    ]
      .filter(Boolean)
      .join(" ");
    const options = description ? { description } : {};
    if (succeeded > 0) {
      toast.success(
        tCollection("added", { count: succeeded, name: collection.name }),
        options,
      );
    } else if (failed > 0) {
      toast.error(tCollection("failed", { count: failed }), options);
    } else {
      toast.info(tCollection("noneAdded", { name: collection.name }), options);
    }
  };

  const shareWithCircle = async (
    circle: { aggregateId: string; name: string },
    copies: readonly BulkCopy[],
  ) => {
    const plan = planCircleShare(copies, isHousemateCopy);

    setBusy(true);
    const outcome = await shareInBatches(
      plan.copyIds,
      (copyIds) => shareCopies({ circleId: circle.aggregateId, copyIds }),
      (error) => circleShareErrorKey(error) === "shareErrors.CopyNotFound",
    ).finally(() => setBusy(false));

    const done = new Set(outcome.done);
    const hidden = plan.hidden.filter((copyId) => done.has(copyId)).length;
    const gone = outcome.gone.length;
    const failed = outcome.failed.length;
    const notes = (skip?: "gone" | "failed") => {
      const text = [
        outcome.alreadyShared > 0 &&
          tCircle("alreadyShared", { count: outcome.alreadyShared }),
        plan.housemates > 0 &&
          tCircle("housemates", { count: plan.housemates }),
        hidden > 0 && tCircle("hidden", { count: hidden }),
        skip !== "gone" && gone > 0 && tCircle("gone", { count: gone }),
        skip !== "failed" && failed > 0 && tCircle("failed", { count: failed }),
      ]
        .filter(Boolean)
        .join(" ");
      return text ? { description: text } : {};
    };

    if (outcome.shared > 0) {
      toast.success(
        tCircles("share.sharedToast", {
          count: outcome.shared,
          circle: circle.name,
        }),
        notes(),
      );
    } else if (failed > 0) {
      // Everything refused for one reason (a View only seat, a circle that's gone) says that reason.
      const key = circleShareErrorKey(outcome.refusal);
      toast.error(
        key === "shareErrors.generic"
          ? tCircle("failed", { count: failed })
          : tCircles(key),
        notes("failed"),
      );
    } else if (gone > 0) {
      toast.error(tCircle("gone", { count: gone }), notes("gone"));
    } else {
      toast.info(tCircle("nothingShared", { name: circle.name }), notes());
    }
  };

  return { offer, addToCollection, shareWithCircle, busy };
}
