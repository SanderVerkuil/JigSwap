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
import { useState } from "react";
import type { Area } from "react-easy-crop";
import Cropper from "react-easy-crop";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { bakeImage } from "./bake-image";
import type { PixelArea } from "./crop-math";

// Reusable crop/zoom/rotate editor. `src` may be an object URL (fresh pick) or a
// CORS-served storage URL (re-editing the stored image); onApply receives the baked File.
export interface ImageEditorDialogProps {
  src: string | null; // null = closed
  fileName: string;
  onApply: (file: File) => void;
  onClose: () => void;
}

export function ImageEditorDialog({
  src,
  fileName,
  onApply,
  onClose,
}: ImageEditorDialogProps) {
  const t = useTranslations("imageEditor");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [cropAreaPixels, setCropAreaPixels] = useState<PixelArea | null>(null);
  const [baking, setBaking] = useState(false);

  const reset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setCropAreaPixels(null);
  };

  const apply = async () => {
    if (!src || !cropAreaPixels) return;
    setBaking(true);
    try {
      const file = await bakeImage(src, cropAreaPixels, rotation, fileName);
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

        <div className="bg-muted relative h-72 w-full overflow-hidden rounded-lg">
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={(_area: Area, areaPixels: Area) =>
                setCropAreaPixels(areaPixels)
              }
            />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-xs">{t("zoom")}</Label>
            <Slider
              aria-label={t("zoom")}
              min={1}
              max={4}
              step={0.05}
              value={[zoom]}
              onValueChange={([value]) => setZoom(value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-xs">{t("rotation")}</Label>
            <Slider
              aria-label={t("rotation")}
              min={-180}
              max={180}
              step={1}
              value={[rotation]}
              onValueChange={([value]) => setRotation(value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t("rotate90")}
              onClick={() =>
                setRotation((r) => (r + 90 > 180 ? r - 270 : r + 90))
              }
            >
              <RotateCw className="h-4 w-4" />
            </Button>
          </div>
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
            disabled={baking || !cropAreaPixels}
            onClick={() => void apply()}
          >
            {baking ? t("applying") : t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
