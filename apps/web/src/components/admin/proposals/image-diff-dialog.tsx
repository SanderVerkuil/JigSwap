"use client";

import { SegmentedPills } from "@/components/add-puzzle";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { wipePercentFromPointer } from "./image-compare";

type CompareMode = "side" | "overlay";

export function ImageDiffDialog({
  open,
  onOpenChange,
  currentUrl,
  proposedUrl,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUrl: string | null | undefined;
  proposedUrl: string | null | undefined;
  title: string;
}) {
  const t = useTranslations("admin.proposals");
  const [mode, setMode] = useState<CompareMode>("side");
  const [percent, setPercent] = useState(50);
  const [dragging, setDragging] = useState(false);
  const bothExist = Boolean(currentUrl) && Boolean(proposedUrl);

  const handlePointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
    active: boolean,
  ) => {
    if (!active) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setPercent(wipePercentFromPointer(e.clientX, rect.left, rect.width));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPercent(50);
          setMode("side");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("imageCompare.title")}</DialogTitle>
          <DialogDescription>{t("imageCompare.description")}</DialogDescription>
        </DialogHeader>

        {bothExist && (
          <SegmentedPills
            options={[
              { value: "side", label: t("imageCompare.sideBySide") },
              { value: "overlay", label: t("imageCompare.overlay") },
            ]}
            value={mode}
            onChange={setMode}
            ariaLabel={t("imageCompare.title")}
          />
        )}

        {mode === "side" || !bothExist ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <figure className="space-y-1">
              <figcaption className="text-muted-foreground text-xs">
                {t("current")}
              </figcaption>
              {currentUrl ? (
                <img
                  src={currentUrl}
                  alt=""
                  className="bg-muted max-h-[60vh] w-full rounded-lg border object-contain"
                />
              ) : (
                <div className="bg-muted aspect-[4/3] w-full rounded-lg border" />
              )}
            </figure>
            <figure className="space-y-1">
              <figcaption className="text-muted-foreground text-xs">
                {t("proposed")}
              </figcaption>
              {proposedUrl ? (
                <img
                  src={proposedUrl}
                  alt=""
                  className="bg-muted max-h-[60vh] w-full rounded-lg border object-contain"
                />
              ) : (
                <div className="bg-muted aspect-[4/3] w-full rounded-lg border" />
              )}
            </figure>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className="bg-muted relative aspect-[4/3] w-full touch-none overflow-hidden rounded-lg border select-none"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragging(true);
                handlePointerMove(e, true);
              }}
              onPointerMove={(e) => handlePointerMove(e, dragging)}
              onPointerUp={() => setDragging(false)}
              onPointerCancel={() => setDragging(false)}
            >
              <img
                src={currentUrl ?? undefined}
                alt=""
                className="absolute inset-0 h-full w-full object-contain"
              />
              <img
                src={proposedUrl ?? undefined}
                alt=""
                className="absolute inset-0 h-full w-full object-contain"
                style={{ clipPath: `inset(0 0 0 ${percent}%)` }}
              />
              <div
                className="bg-primary absolute inset-y-0 w-0.5"
                style={{ left: `${percent}%` }}
              >
                <div className="bg-primary absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" />
              </div>
              <span className="bg-background/80 absolute top-2 left-2 rounded px-1.5 py-0.5 text-xs">
                {t("current")}
              </span>
              <span className="bg-background/80 absolute top-2 right-2 rounded px-1.5 py-0.5 text-xs">
                {t("proposed")}
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[percent]}
              onValueChange={([v]) => setPercent(v)}
              aria-label={t("imageCompare.handleAria")}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
