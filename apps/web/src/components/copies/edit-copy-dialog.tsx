"use client";

import {
  AvailabilityChips,
  availabilityToSharing,
  SegmentedPills,
  type ConditionValue,
} from "@/components/add-puzzle";
import { convexErrorCode } from "@/components/exchange/request-trade";
import { useConditionOptions } from "@/components/library/condition";
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
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { Check, ImageOff, ImagePlus } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTimeZone, useTranslations } from "use-intl";
import { acquisitionMonthOf, acquisitionMonthStart } from "./acquisition-month";
import {
  CopyVisibilityControl,
  type CopyVisibility,
} from "./copy-visibility-control";

type CopyInstanceView = NonNullable<
  FunctionReturnType<typeof gateway.library.getCopyInstanceView>
>;
type AcquisitionSource = NonNullable<
  CopyInstanceView["snapshot"]["acquisitionSource"]
>;

const ACQUISITION_SOURCES: readonly AcquisitionSource[] = [
  "bought_new",
  "bought_used",
  "trade",
  "gift",
];
const FIRST_ACQUISITION_YEAR = 1950;
const selectClass =
  "bg-card focus:ring-primary h-10 w-full rounded-md border px-2 text-base focus:ring-2 focus:outline-none md:h-9 md:text-sm";

// Owner-only inline editor for a single owned copy. Each field maps to a granular Library
// mutation; on save we diff against the loaded snapshot and fire only the mutations whose value
// actually changed. The page query (getCopyInstanceView) reads the same tables, so Convex
// reactivity refreshes the page after the dialog closes — no manual refetch needed.
//
// ID rule: condition / sharing / details target the Copy `aggregateId`; cover selection targets
// the copy's Convex `_id` (copyId). When `aggregateId` is null (rows predating the backfill) the
// domain-keyed fields cannot be written, so those controls are disabled.
//
// "Acquired" is a month and year (stored as acquisition-month instants); "Source" how the copy was
// acquired. `focus="acquisition"` opens the dialog on those fields (the page's "Add details").
//
// Every opening starts from the copy as it is NOW: the page keeps this dialog mounted while its
// offer switches change the copy, and form state kept from page load would write those offers back
// on an unrelated save. So each opening remounts the form (a new key), while closing keeps it
// mounted for the exit animation.
type EditCopyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: CopyInstanceView;
  // Starts the page's photo upload. Offered when the copy has no photos to pick a cover from;
  // the dialog closes as it hands over.
  onAddPhotos?: () => void;
  focus?: "acquisition";
};

export function EditCopyDialog(props: EditCopyDialogProps) {
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpening((n) => n + 1);
  }
  return <EditCopyDialogForm key={opening} {...props} />;
}

function EditCopyDialogForm({
  open,
  onOpenChange,
  copy,
  onAddPhotos,
  focus,
}: EditCopyDialogProps) {
  const t = useTranslations("copyInstance");
  const format = useFormatter();
  const timeZone = useTimeZone() ?? "UTC";
  const acquiredMonthRef = useRef<HTMLSelectElement>(null);

  const changeCondition = useMutation({
    mutationFn: useConvexMutation(gateway.library.changeCondition),
  });
  const updateSharing = useMutation({
    mutationFn: useConvexMutation(gateway.library.updateSharing),
  });
  const updateDetails = useMutation({
    mutationFn: useConvexMutation(gateway.library.updateDetails),
  });
  const setCopyCover = useMutation({
    mutationFn: useConvexMutation(gateway.library.setCopyCover),
  });

  const { snapshot, gallery } = copy;
  const aggregateId = copy.aggregateId;
  const domainEditable = aggregateId != null;

  const [condition, setCondition] = useState<ConditionValue>(
    snapshot.condition as ConditionValue,
  );
  const [availability, setAvailability] = useState(snapshot.availability);
  // The owner's own choice, kept while the copy is offered (it is visible only while an offer is
  // on). A backend without visibilityPreference falls back to the effective visibility.
  const initialVisibility: CopyVisibility =
    snapshot.visibilityPreference ?? snapshot.visibility;
  const [visibility, setVisibility] =
    useState<CopyVisibility>(initialVisibility);
  const offered =
    availability.forTrade || availability.forLend || availability.forSale;
  // Lending a copy out withdraws its offers; it can't be offered again until it is back.
  const onLoan = copy.loans.some((loan) => loan.status === "open");
  const [notes, setNotes] = useState(snapshot.notes ?? "");
  // When and how it was acquired: month + year (both or neither) and a source; "" = not recorded.
  const stored =
    snapshot.acquisitionDate != null
      ? acquisitionMonthOf(snapshot.acquisitionDate, timeZone)
      : null;
  const storedMonth = stored ? String(stored.month) : "";
  const storedYear = stored ? String(stored.year) : "";
  const [acquiredMonth, setAcquiredMonth] = useState(storedMonth);
  const [acquiredYear, setAcquiredYear] = useState(storedYear);
  const [acquisitionSource, setAcquisitionSource] = useState<
    AcquisitionSource | ""
  >(snapshot.acquisitionSource ?? "");
  const acquiredIncomplete = (acquiredMonth === "") !== (acquiredYear === "");
  const [thisYear] = useState(() => new Date().getFullYear());
  const years = Array.from(
    {
      length:
        thisYear -
        Math.min(FIRST_ACQUISITION_YEAR, stored?.year ?? thisYear) +
        1,
    },
    (_, i) => thisYear - i,
  );
  // `null` => catalogue/global image; otherwise a gallery image id.
  const [coverImageId, setCoverImageId] = useState<string | null>(
    snapshot.coverImageId,
  );
  const saving =
    changeCondition.isPending ||
    updateSharing.isPending ||
    updateDetails.isPending ||
    setCopyCover.isPending;

  const conditionOptions = useConditionOptions();

  const save = async () => {
    try {
      const ops: Array<Promise<unknown>> = [];

      if (domainEditable && condition !== snapshot.condition) {
        ops.push(
          changeCondition.mutateAsync({ copyId: aggregateId, condition }),
        );
      }

      const availabilityChanged =
        availability.forTrade !== snapshot.availability.forTrade ||
        availability.forLend !== snapshot.availability.forLend ||
        availability.forSale !== snapshot.availability.forSale;
      // One write for the sharing setting: the offers plus the owner's own visibility choice,
      // which may stay "private" while an offer is on.
      if (
        domainEditable &&
        (availabilityChanged || visibility !== initialVisibility)
      ) {
        ops.push(
          updateSharing.mutateAsync(
            availabilityToSharing(aggregateId, availability, visibility),
          ),
        );
      }

      // One details write for the notes and the acquisition. An unchanged month keeps the stored
      // instant (it may carry an exact day from a received swap); a supplied acquisition always
      // carries both fields, since the backend replaces them as a pair.
      const details: {
        notes?: string;
        acquisition?: { date?: number; source?: AcquisitionSource };
      } = {};
      const trimmedNotes = notes.trim();
      if (trimmedNotes !== (snapshot.notes ?? "")) details.notes = trimmedNotes;
      const monthChanged =
        acquiredMonth !== storedMonth || acquiredYear !== storedYear;
      if (
        monthChanged ||
        acquisitionSource !== (snapshot.acquisitionSource ?? "")
      ) {
        const date = !monthChanged
          ? snapshot.acquisitionDate
          : acquiredYear
            ? acquisitionMonthStart(Number(acquiredYear), Number(acquiredMonth))
            : undefined;
        details.acquisition = {
          ...(date != null ? { date } : {}),
          ...(acquisitionSource ? { source: acquisitionSource } : {}),
        };
      }
      if (domainEditable && Object.keys(details).length > 0) {
        ops.push(
          updateDetails.mutateAsync({ copyId: aggregateId, ...details }),
        );
      }

      if (coverImageId !== snapshot.coverImageId) {
        ops.push(
          setCopyCover.mutateAsync({
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
    } catch (error) {
      // The Library refuses a sharing change while an exchange in progress reserves the copy or
      // it is out on loan; say so rather than "please try again".
      toast.error(
        t(
          convexErrorCode(error) === "CopyReserved"
            ? "editCopy.copyReserved"
            : "editCopy.editFailed",
        ),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          if (focus !== "acquisition") return;
          event.preventDefault();
          acquiredMonthRef.current?.focus();
        }}
      >
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
              disabled={onLoan}
            />
            {onLoan && (
              <p className="text-muted-foreground text-xs">
                {t("offers.lockedOnLoan")}
              </p>
            )}
          </div>

          {/* Visibility */}
          <div className="space-y-2">
            <Label>{t("editCopy.visibility.label")}</Label>
            <CopyVisibilityControl
              value={visibility}
              onChange={setVisibility}
              offered={offered}
              disabled={!domainEditable}
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

          {/* Acquired (month + year) and source */}
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label id="edit-copy-acquired">{t("acquired")}</Label>
              <div
                role="group"
                aria-labelledby="edit-copy-acquired"
                className="grid grid-cols-2 gap-2"
              >
                <select
                  ref={acquiredMonthRef}
                  aria-label={t("editCopy.acquiredMonth")}
                  value={acquiredMonth}
                  disabled={!domainEditable}
                  onChange={(e) => setAcquiredMonth(e.target.value)}
                  className={selectClass}
                >
                  <option value="">{t("editCopy.monthPlaceholder")}</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                    <option key={month} value={month}>
                      {format.dateTime(
                        new Date(acquisitionMonthStart(2000, month)),
                        { month: "long", timeZone: "UTC" },
                      )}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t("editCopy.acquiredYear")}
                  value={acquiredYear}
                  disabled={!domainEditable}
                  onChange={(e) => setAcquiredYear(e.target.value)}
                  className={selectClass}
                >
                  <option value="">{t("editCopy.yearPlaceholder")}</option>
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
              {acquiredIncomplete && (
                <p className="text-destructive text-xs">
                  {t("editCopy.acquiredIncomplete")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-copy-source">{t("source")}</Label>
              <select
                id="edit-copy-source"
                value={acquisitionSource}
                disabled={!domainEditable}
                onChange={(e) =>
                  setAcquisitionSource(e.target.value as AcquisitionSource | "")
                }
                className={selectClass}
              >
                <option value="">{t("editCopy.sourceUnknown")}</option>
                {ACQUISITION_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {t(`acquisitionSourceLabel.${source}`)}
                  </option>
                ))}
              </select>
            </div>
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
                    {/* An 84px tile: the photo's 480 px rendition once it has one. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.thumbUrl ?? photo.url}
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-muted-foreground text-xs">
                  {t("editCopy.noPhotosForCover")}
                </p>
                {onAddPhotos && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() => {
                      onAddPhotos();
                      onOpenChange(false);
                    }}
                  >
                    <ImagePlus className="h-4 w-4" />
                    {t("addPhoto")}
                  </Button>
                )}
              </div>
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
          <Button
            variant="brand"
            onClick={() => void save()}
            disabled={saving || acquiredIncomplete}
          >
            {saving ? t("editCopy.saving") : t("editCopy.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
