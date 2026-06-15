"use client";

import {
  AvailabilityChips,
  availabilityToSharing,
  CONDITION_OPTIONS,
  SegmentedPills,
  type ConditionValue,
} from "@/components/add-puzzle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, ImageOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type CopyInstanceView = NonNullable<
  FunctionReturnType<typeof gateway.library.getCopyInstanceView>
>;

// Owner-only inline editor for a single owned copy. Each field maps to a granular Library
// mutation; on save we diff against the loaded snapshot and fire only the mutations whose value
// actually changed. The page query (getCopyInstanceView) reads the same tables, so Convex
// reactivity refreshes the page after the dialog closes — no manual refetch needed.
//
// ID rule: condition / sharing / details target the Copy `aggregateId`; cover selection targets
// the copy's Convex `_id` (copyId). When `aggregateId` is null (rows predating the backfill) the
// domain-keyed fields cannot be written, so those controls are disabled.
export function EditCopyDialog({
  open,
  onOpenChange,
  copy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: CopyInstanceView;
}) {
  const t = useTranslations("copyInstance");
  const tPuzzles = useTranslations("puzzles");

  const changeCondition = useMutation(gateway.library.changeCondition);
  const updateSharing = useMutation(gateway.library.updateSharing);
  const updateDetails = useMutation(gateway.library.updateDetails);
  const setCopyCover = useMutation(gateway.library.setCopyCover);

  const { snapshot, gallery } = copy;
  const aggregateId = copy.aggregateId;
  const domainEditable = aggregateId != null;

  const [condition, setCondition] = useState<ConditionValue>(
    snapshot.condition as ConditionValue,
  );
  const [availability, setAvailability] = useState(snapshot.availability);
  const [notes, setNotes] = useState(snapshot.notes ?? "");
  // `null` => catalogue/global image; otherwise a gallery image id.
  const [coverImageId, setCoverImageId] = useState<string | null>(
    snapshot.coverImageId,
  );
  const [saving, setSaving] = useState(false);

  const conditionOptions = CONDITION_OPTIONS.map((o) => ({
    value: o.value,
    label: tPuzzles(`condition_${o.value}`),
  }));

  const save = async () => {
    setSaving(true);
    try {
      const ops: Array<Promise<unknown>> = [];

      if (domainEditable && condition !== snapshot.condition) {
        ops.push(changeCondition({ copyId: aggregateId, condition }));
      }

      const availabilityChanged =
        availability.forTrade !== snapshot.availability.forTrade ||
        availability.forLend !== snapshot.availability.forLend ||
        availability.forSale !== snapshot.availability.forSale;
      if (domainEditable && availabilityChanged) {
        ops.push(
          updateSharing(availabilityToSharing(aggregateId, availability)),
        );
      }

      const trimmedNotes = notes.trim();
      if (domainEditable && trimmedNotes !== (snapshot.notes ?? "")) {
        ops.push(updateDetails({ copyId: aggregateId, notes: trimmedNotes }));
      }

      if (coverImageId !== snapshot.coverImageId) {
        ops.push(
          setCopyCover({
            copyId: copy.copyId as Id<"ownedPuzzles">,
            ...(coverImageId
              ? { coverImageId: coverImageId as Id<"ownedPuzzleImages"> }
              : {}),
          }),
        );
      }

      await Promise.all(ops);
      if (ops.length > 0) toast.success(t("editCopy.saved"));
      onOpenChange(false);
    } catch {
      toast.error(t("editCopy.editFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("editCopy.title")}</DialogTitle>
          <DialogDescription>{snapshot.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Condition */}
          <div className="space-y-2">
            <Label>{t("condition")}</Label>
            <SegmentedPills
              options={conditionOptions}
              value={condition}
              onChange={(v) => setCondition(v)}
              ariaLabel={t("condition")}
            />
          </div>

          {/* Availability */}
          <div className="space-y-2">
            <Label>{t("availability")}</Label>
            <AvailabilityChips
              value={availability}
              onChange={setAvailability}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="edit-copy-notes">{t("notes")}</Label>
            <Textarea
              id="edit-copy-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("editCopy.notesPlaceholder")}
              rows={3}
            />
          </div>

          {/* Cover picker */}
          <div className="space-y-2">
            <Label>{t("editCopy.cover")}</Label>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => setCoverImageId(null)}
                aria-pressed={coverImageId === null}
                className={cn(
                  "bg-muted relative flex aspect-square w-[84px] shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border-2 text-center text-[11px] font-semibold",
                  coverImageId === null
                    ? "border-jigsaw-primary"
                    : "border-transparent",
                )}
              >
                {snapshot.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={snapshot.image}
                    alt={t("editCopy.useCatalogueImage")}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageOff className="text-muted-foreground h-5 w-5" />
                )}
                <span className="bg-background/80 absolute inset-x-0 bottom-0 px-1 py-0.5 leading-tight">
                  {t("editCopy.useCatalogueImage")}
                </span>
                {coverImageId === null && (
                  <span className="bg-jigsaw-primary absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-white">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>

              {gallery.map((photo) => {
                const active = coverImageId === photo.id;
                return (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setCoverImageId(photo.id)}
                    aria-pressed={active}
                    aria-label={photo.caption ?? t("editCopy.cover")}
                    className={cn(
                      "bg-muted relative aspect-square w-[84px] shrink-0 overflow-hidden rounded-lg border-2",
                      active ? "border-jigsaw-primary" : "border-transparent",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.url}
                      alt={photo.caption ?? ""}
                      className="h-full w-full object-cover"
                    />
                    {active && (
                      <span className="bg-jigsaw-primary absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {gallery.length === 0 && (
              <p className="text-muted-foreground text-xs">
                {t("editCopy.noPhotosForCover")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("editCopy.cancel")}
          </Button>
          <Button variant="brand" onClick={() => void save()} disabled={saving}>
            {saving ? t("editCopy.saving") : t("editCopy.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
