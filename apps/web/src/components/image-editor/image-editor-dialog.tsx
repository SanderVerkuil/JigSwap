"use client";

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
import { Slider } from "@/components/ui/slider";
import { canvasCanBeTrusted, sniffedType } from "@/lib/prepare-photo";
import { RotateCw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Cropper, type CropperRef } from "react-advanced-cropper";
import "react-advanced-cropper/dist/style.css";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { contentBoundingBox } from "./auto-crop";
import { rotateSize } from "./crop-math";
import { exportChoice } from "./export-choice";

// Reusable crop/rotate editor. `src` may be an object URL (fresh pick) or a CORS-served
// storage URL (re-editing the stored image); onApply receives the baked File. The user
// pans/zooms the image under a free-form, resizable crop stencil (react-advanced-cropper
// handles wheel/pinch/drag gestures natively) and Apply reads the result straight off the
// library's own canvas — no custom transform math. Where canvas read-back is
// scrambled (Firefox resistFingerprinting) that bake is noise: an unedited photo
// is handed back as the original file, and an edit is refused with an offer to
// use the original instead (export-choice).
export interface ImageEditorDialogProps {
  src: string | null; // null = closed
  fileName: string;
  onApply: (file: File) => void;
  onClose: () => void;
}

// Load an image element for pixel analysis (auto-crop only — the cropper itself loads
// `src` internally). crossOrigin="anonymous" must be set BEFORE `src` for CORS-served
// remote images — the box-art precedent in marketing/plank-3d/box-art.ts — drawImage
// works on a tainted canvas but getImageData throws SecurityError otherwise.
const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });

export function ImageEditorDialog({
  src,
  fileName,
  onApply,
  onClose,
}: ImageEditorDialogProps) {
  const t = useTranslations("imageEditor");
  const cropperRef = useRef<CropperRef>(null);
  const [rotation, setRotation] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [baking, setBaking] = useState(false);
  // Whether the member moved, resized or auto-cropped the frame.
  const [cropChanged, setCropChanged] = useState(false);
  // An edit the browser can't bake (scrambled canvas): offer the original.
  const [blocked, setBlocked] = useState(false);
  // Auto-crop reads canvas pixels, so where read-back is scrambled it would
  // analyse noise: hide it. Probed once per opening, during render (no flash);
  // never while closed, so server rendering doesn't touch the DOM.
  const open = src !== null;
  const canAutoCrop = useMemo(() => open && canvasCanBeTrusted(), [open]);

  const reset = () => {
    setRotation(0);
    setLoaded(false);
    setCropChanged(false);
    setBlocked(false);
  };

  // cropperRef.rotateImage() rotates BY the given amount, not to an absolute angle, so
  // every update is driven by the delta against the angle we last told the cropper.
  // Rotation state resets on close along with everything else.
  const applyRotation = (next: number) => {
    cropperRef.current?.rotateImage(next - rotation);
    setRotation(next);
  };

  // Analyze the ORIGINAL image pixels (not the live, zoomed cropper view) for a uniform
  // border to trim. advanced-cropper keeps stencil `coordinates` in the space of the
  // image rotated around its center into a bounding box (the same transform its own
  // getCanvas() bake uses internally), so replicate that transform here — downsampled to
  // <=512px for speed — and hand the detected box straight to setCoordinates() scaled
  // back up. This is exact at any rotation, not just 0.
  const runAutoCrop = async () => {
    if (!src) return;
    try {
      const image = await loadImage(src);
      const rotated = rotateSize(
        image.naturalWidth,
        image.naturalHeight,
        rotation,
      );
      const maxDimension = 512;
      const scale = Math.min(
        1,
        maxDimension / Math.max(rotated.width, rotated.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(rotated.width * scale);
      canvas.height = Math.ceil(rotated.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 2d unavailable");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.translate(-image.naturalWidth / 2, -image.naturalHeight / 2);
      ctx.drawImage(image, 0, 0);

      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const bbox = contentBoundingBox(data, canvas.width, canvas.height);
      if (!bbox) {
        toast.info(t("autoCropNothing"));
        return;
      }
      cropperRef.current?.setCoordinates({
        left: bbox.x / scale,
        top: bbox.y / scale,
        width: bbox.width / scale,
        height: bbox.height / scale,
      });
      setCropChanged(true);
    } catch {
      // Tainted canvas (non-CORS remote) or decode failure.
      toast.error(t("autoCropFailed"));
    }
  };

  // The picked (or stored) image as it is, typed by its magic bytes; the
  // server strips its metadata.
  const originalFile = async (from: string) => {
    const blob = await (await fetch(from)).blob();
    return new File([blob], fileName, { type: await sniffedType(blob) });
  };

  const bakedFile = async () => {
    const canvas = cropperRef.current?.getCanvas();
    if (!canvas) throw new Error("no canvas");
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) throw new Error("bake produced no blob");
    return new File([blob], fileName, { type: "image/jpeg" });
  };

  const apply = async (useOriginal = false) => {
    if (!src) return;
    const choice = useOriginal
      ? "original"
      : exportChoice({
          canvasTrusted: canvasCanBeTrusted(),
          rotation,
          cropChanged,
        });
    if (choice === "blocked") {
      setBlocked(true);
      return;
    }
    setBaking(true);
    try {
      onApply(
        choice === "original" ? await originalFile(src) : await bakedFile(),
      );
      reset();
    } catch {
      // Tainted canvas (non-CORS remote), decode failure, or toBlob failure.
      toast.error(t("bakeFailed"));
    } finally {
      setBaking(false);
    }
  };

  return (
    <Dialog
      open={src !== null}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      {/* Wide editing surface (the canvas is the UI); max-h + scroll keeps the
          footer reachable on short viewports. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl lg:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="bg-muted overflow-hidden rounded-lg">
          {src ? (
            <Cropper
              ref={cropperRef}
              src={src}
              crossOrigin="anonymous"
              className="h-[min(65vh,600px)] w-full"
              onReady={() => setLoaded(true)}
              onInteractionEnd={() => setCropChanged(true)}
            />
          ) : (
            <div className="h-[min(65vh,600px)] w-full" />
          )}
        </div>

        <div className="flex items-center gap-3">
          <Label className="w-16 shrink-0 text-xs">{t("rotation")}</Label>
          <Slider
            aria-label={t("rotation")}
            min={-180}
            max={180}
            step={1}
            value={[rotation]}
            onValueChange={([value]) => applyRotation(value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("rotate90")}
            onClick={() =>
              applyRotation(
                rotation + 90 > 180 ? rotation - 270 : rotation + 90,
              )
            }
          >
            <RotateCw className="h-4 w-4" />
          </Button>
        </div>

        {canAutoCrop && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!loaded || baking}
              onClick={() => void runAutoCrop()}
            >
              {t("autoCrop")}
            </Button>
          </div>
        )}

        {blocked && (
          <div
            role="alert"
            className="bg-muted flex flex-col gap-3 rounded-lg p-3 text-sm sm:flex-row sm:items-center"
          >
            <p className="flex-1">{t("editingBlocked")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={baking}
              onClick={() => void apply(true)}
            >
              {t("useOriginal")}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={baking}
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={baking || !loaded}
            onClick={() => void apply()}
          >
            {baking ? t("applying") : t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
