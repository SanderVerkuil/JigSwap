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
import { RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactCrop, { type Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { bakeImage, loadEditorImage } from "./bake-image";
import { rotateSize } from "./crop-math";
import { fullCrop, percentCropToPixelArea } from "./crop-select";

// Reusable crop/rotate editor. `src` may be an object URL (fresh pick) or a CORS-served
// storage URL (re-editing the stored image); onApply receives the baked File. The user
// drags a free-form crop rectangle on a rotated PREVIEW of the image (react-image-crop),
// which is mapped back to pixel coordinates in the rotated-canvas space that the existing
// bakeImage pipeline cuts from.
export interface ImageEditorDialogProps {
  src: string | null; // null = closed
  fileName: string;
  onApply: (file: File) => void;
  onClose: () => void;
}

// Draws the ORIGINAL image rotated around its center onto a bounding canvas — the exact
// same transform bakeImage uses — and returns an object URL for the live preview.
const renderRotatedPreview = (
  image: HTMLImageElement,
  rotationDeg: number,
): Promise<string> => {
  const rotated = rotateSize(
    image.naturalWidth,
    image.naturalHeight,
    rotationDeg,
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(rotated.width);
  canvas.height = Math.ceil(rotated.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.translate(-image.naturalWidth / 2, -image.naturalHeight / 2);
  ctx.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("preview render produced no blob"));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, "image/png");
  });
};

export function ImageEditorDialog({
  src,
  fileName,
  onApply,
  onClose,
}: ImageEditorDialogProps) {
  const t = useTranslations("imageEditor");
  const [crop, setCrop] = useState<Crop>({ unit: "%", ...fullCrop() });
  const [rotation, setRotation] = useState(0);
  const [rotatedSrc, setRotatedSrc] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [baking, setBaking] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const reset = () => {
    setCrop({ unit: "%", ...fullCrop() });
    setRotation(0);
    setRotatedSrc(null);
    setNaturalSize(null);
    imageRef.current = null;
  };

  // Rotation change invalidates the old selection's coordinates, so every rotation update
  // also resets the crop to the full frame.
  const applyRotation = (next: number) => {
    setRotation(next);
    setCrop({ unit: "%", ...fullCrop() });
  };

  // Load the original once per `src` (network fetch / decode), cached in imageRef so
  // rotation changes redraw from the already-loaded element instead of reloading.
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    void loadEditorImage(src).then((image) => {
      if (cancelled) return;
      imageRef.current = image;
      setNaturalSize({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Regenerate the rotated preview whenever the loaded image or rotation changes, debounced
  // so dragging the rotation slider doesn't re-render a canvas on every tick. The previous
  // preview keeps showing while a new one renders (rotatedSrc only updates on success).
  useEffect(() => {
    const image = imageRef.current;
    if (!image || !naturalSize) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderRotatedPreview(image, rotation).then((url) => {
        if (cancelled) return;
        setRotatedSrc(url);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [naturalSize, rotation]);

  // Revoke the previous object URL whenever rotatedSrc changes (including on unmount) —
  // the cleanup below runs with the OLD value right before the effect re-fires.
  useEffect(() => {
    return () => {
      if (rotatedSrc) URL.revokeObjectURL(rotatedSrc);
    };
  }, [rotatedSrc]);

  const apply = async () => {
    if (!src || !naturalSize) return;
    setBaking(true);
    try {
      const rotated = rotateSize(
        naturalSize.width,
        naturalSize.height,
        rotation,
      );
      const area = percentCropToPixelArea(
        { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
        rotated.width,
        rotated.height,
      );
      const file = await bakeImage(src, area, rotation, fileName);
      onApply(file);
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="bg-muted relative w-full overflow-hidden rounded-lg">
          {rotatedSrc ? (
            <ReactCrop
              crop={crop}
              onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
            >
              <img
                src={rotatedSrc}
                alt=""
                className="max-h-72 w-full object-contain"
              />
            </ReactCrop>
          ) : (
            <div className="h-72 w-full" />
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
            disabled={baking || rotatedSrc === null}
            onClick={() => void apply()}
          >
            {baking ? t("applying") : t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
