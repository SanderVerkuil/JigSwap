# Puzzle Photo Editor — Implementation Plan (PR 4, stacked)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable crop/zoom/rotate image editor (react-easy-crop + canvas bake) applied to every puzzle-photo intake: the definition image control (member suggest-edit + admin edit — including RE-EDITING the currently stored image) and the copy-photo upload on the copies page.

**Architecture:** One `ImageEditorDialog` component (Dialog + `react-easy-crop` Cropper + zoom/rotate sliders + 90° step button) that takes an image `src` and returns a baked `File` via `onApply`. The bake pipeline is split: pure geometry in `crop-math.ts` (node-unit-tested per web convention) and canvas work in `bake-image.ts` (browser-only, no unit tests). Existing stored images load with `crossOrigin="anonymous"` (the proven box-art precedent — `apps/web/src/components/marketing/plank-3d/box-art.ts:259` documents the taint rules); a tainted-canvas `SecurityError` surfaces as a user-facing toast. Integration points: `PuzzleDefinitionFields`' image control (intercept the file pick + a new "Edit photo" button on the current image) and `PhotoStrip`'s upload in `copies/$id.tsx` (edit-before-upload). Scope note: re-editing applies to the DEFINITION image (natural replace semantics); existing copy-strip photos keep their current lifecycle (edit-on-upload only).

**Tech Stack:** react-easy-crop (new dep), @radix-ui/react-slider via a shadcn-style `ui/slider.tsx` (new — the repo has NO slider today), canvas/toBlob, use-intl EN/NL.

---

## Executor setup & non-negotiable constraints

- [ ] **The worktree already exists** — work in `/home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/change-proposals-image-editor`, branch `feat/change-proposals-image-editor`, branched from `feat/change-proposals-admin-ui` at `c9ba7b943`. Run `pnpm install --frozen-lockfile` once first.
- [ ] First commit: this plan (`docs: image-editor plan (PR 4)`).

**STACKED-PR RULES:** base = `feat/change-proposals-admin-ui`; never rebase onto `main`; the controller opens the PR with `--base feat/change-proposals-admin-ui`.

**Baselines:** web 116 tests / backend 589 / domain 1101, all green at `c9ba7b943`. Web vitest is `environment: "node"` — NEVER render components or touch canvas in tests; only pure helpers get tests.

**Guardrails:**

- No backend changes at all (uploads keep using `generateUploadUrl` + existing mutations).
- `react-easy-crop` and `@radix-ui/react-slider` are added to `apps/web/package.json` with caret ranges (house style; use `pnpm --filter @jigswap/web add react-easy-crop @radix-ui/react-slider`).
- `PuzzleDefinitionFields`' external contract keeps `onPickFile: (file: File | undefined) => void` — callers (member suggest-edit, admin edit) must not need changes beyond what this plan states (none).
- Copy-photo behavior change is edit-BEFORE-upload only; the upload mutation itself is untouched.

**Test commands:** web `pnpm --filter @jigswap/web exec vitest run`; sweep at the end as in prior plans.

---

### Task 1 — Deps, `ui/slider.tsx`, and pure crop math (TDD)

**Files:**

- Modify: `apps/web/package.json` (via pnpm add)
- Create: `apps/web/src/components/ui/slider.tsx`
- Create: `apps/web/src/components/image-editor/crop-math.ts`
- Create: `apps/web/src/components/image-editor/crop-math.test.ts`

**Steps:**

- [ ] `pnpm --filter @jigswap/web add react-easy-crop @radix-ui/react-slider` (then `git diff apps/web/package.json` — two caret deps added; lockfile updated).
- [ ] Create `apps/web/src/components/ui/slider.tsx` — the standard shadcn slider, styled consistently with the repo's ui primitives (compare `dialog.tsx`'s `data-slot` + `cn` conventions):

```tsx
"use client";

import { cn } from "@/lib/utils";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center select-none",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="bg-muted relative h-1.5 w-full grow overflow-hidden rounded-full">
        <SliderPrimitive.Range className="bg-primary absolute h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="border-primary bg-background ring-offset-background focus-visible:ring-ring block size-4 rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  );
}

export { Slider };
```

(Verify `@/lib/utils` exports `cn` — every ui primitive imports it; mirror exactly.)

- [ ] Write the failing test. Create `apps/web/src/components/image-editor/crop-math.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampCropArea, rotateSize } from "./crop-math";

describe("rotateSize", () => {
  it("is the identity at 0° and 180°", () => {
    expect(rotateSize(400, 300, 0)).toEqual({ width: 400, height: 300 });
    const r180 = rotateSize(400, 300, 180);
    expect(r180.width).toBeCloseTo(400);
    expect(r180.height).toBeCloseTo(300);
  });

  it("swaps dimensions at 90° and 270°", () => {
    const r90 = rotateSize(400, 300, 90);
    expect(r90.width).toBeCloseTo(300);
    expect(r90.height).toBeCloseTo(400);
    const r270 = rotateSize(400, 300, 270);
    expect(r270.width).toBeCloseTo(300);
    expect(r270.height).toBeCloseTo(400);
  });

  it("bounds a 45° rotation by the diagonal", () => {
    const r45 = rotateSize(100, 100, 45);
    expect(r45.width).toBeCloseTo(Math.SQRT2 * 100);
    expect(r45.height).toBeCloseTo(Math.SQRT2 * 100);
  });
});

describe("clampCropArea", () => {
  it("passes through an in-bounds area", () => {
    expect(
      clampCropArea({ x: 10, y: 10, width: 50, height: 50 }, 100, 100),
    ).toEqual({ x: 10, y: 10, width: 50, height: 50 });
  });

  it("clamps origin and size to the canvas bounds", () => {
    expect(
      clampCropArea({ x: -5, y: 90, width: 50, height: 50 }, 100, 100),
    ).toEqual({ x: 0, y: 90, width: 50, height: 10 });
  });

  it("floors fractional pixels to integers", () => {
    expect(
      clampCropArea({ x: 1.6, y: 2.4, width: 10.9, height: 9.2 }, 100, 100),
    ).toEqual({ x: 1, y: 2, width: 10, height: 9 });
  });
});
```

- [ ] Run it — module-resolution failure expected. Create `apps/web/src/components/image-editor/crop-math.ts`:

```ts
// Pure geometry for the image editor's canvas bake. Kept canvas-free so the web test
// suite (node environment) can pin it; the browser-only drawing lives in bake-image.ts.

export interface PixelArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Bounding-box size of a w×h rectangle rotated by `rotationDeg` degrees.
export const rotateSize = (
  width: number,
  height: number,
  rotationDeg: number,
): { width: number; height: number } => {
  const rad = (rotationDeg * Math.PI) / 180;
  return {
    width: Math.abs(Math.cos(rad) * width) + Math.abs(Math.sin(rad) * height),
    height: Math.abs(Math.sin(rad) * width) + Math.abs(Math.cos(rad) * height),
  };
};

// react-easy-crop reports fractional pixel areas that can poke past the rotated canvas
// by sub-pixels; clamp to integer bounds so drawImage/toBlob never sample outside.
export const clampCropArea = (
  area: PixelArea,
  canvasWidth: number,
  canvasHeight: number,
): PixelArea => {
  const x = Math.min(Math.max(Math.floor(area.x), 0), canvasWidth);
  const y = Math.min(Math.max(Math.floor(area.y), 0), canvasHeight);
  return {
    x,
    y,
    width: Math.min(Math.floor(area.width), canvasWidth - x),
    height: Math.min(Math.floor(area.height), canvasHeight - y),
  };
};
```

- [ ] Run: test file (6 passing); full web suite 116 + 6 = 122.
- [ ] Prettier; commit: `feat(web): slider primitive + image-editor crop math`

---

### Task 2 — Bake pipeline + `ImageEditorDialog` + i18n

**Files:**

- Create: `apps/web/src/components/image-editor/bake-image.ts`
- Create: `apps/web/src/components/image-editor/image-editor-dialog.tsx`
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json` (new top-level `imageEditor` namespace)

**Steps:**

- [ ] Create `apps/web/src/components/image-editor/bake-image.ts`:

```ts
import { clampCropArea, type PixelArea, rotateSize } from "./crop-math";

// Browser-only canvas bake for the image editor. Loads the source with
// crossOrigin="anonymous" BEFORE setting src (the box-art precedent in
// marketing/plank-3d/box-art.ts — drawImage works on a tainted canvas but
// toBlob/getImageData throw SecurityError, so remote sources MUST be CORS-served).
const loadEditorImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });

// Draw the source rotated around its center onto a bounding canvas, cut the crop
// area out, and return it as a File ready for the existing upload pipelines.
export async function bakeImage(
  src: string,
  cropAreaPixels: PixelArea,
  rotationDeg: number,
  fileName: string,
  mimeType = "image/jpeg",
): Promise<File> {
  const image = await loadEditorImage(src);
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

  const area = clampCropArea(cropAreaPixels, canvas.width, canvas.height);
  const out = document.createElement("canvas");
  out.width = area.width;
  out.height = area.height;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("canvas 2d unavailable");
  outCtx.drawImage(
    canvas,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    area.width,
    area.height,
  );

  // toBlob throws SecurityError here when the canvas is tainted (non-CORS remote src).
  const blob = await new Promise<Blob | null>((resolve) =>
    out.toBlob(resolve, mimeType, 0.9),
  );
  if (!blob) throw new Error("bake produced no blob");
  return new File([blob], fileName, { type: mimeType });
}
```

- [ ] Create `apps/web/src/components/image-editor/image-editor-dialog.tsx`:

```tsx
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
              aspect={undefined}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={(_area, areaPixels) =>
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
```

IMPLEMENTATION NOTES: verify react-easy-crop's import shape (`import Cropper from "react-easy-crop"` is the default export). CHECK ITS ASPECT SEMANTICS in the installed package's types: react-easy-crop historically REQUIRES a numeric `aspect` (no free-form). If free-form isn't supported, use `aspect={1}` (square — matching the `size-24` square previews everywhere the image is shown) and report that adaptation. If the `Button` `variant="brand"` doesn't exist in `ui/button.tsx` variants, use the same variant the suggest-edit submit button uses (read it).

- [ ] i18n — add a top-level `imageEditor` namespace to en + source (after `suggestEdit`):

```json
  "imageEditor": {
    "title": "Edit photo",
    "description": "Crop, zoom and rotate. The edited photo replaces the original when you save the form.",
    "zoom": "Zoom",
    "rotation": "Rotation",
    "rotate90": "Rotate 90°",
    "apply": "Apply",
    "applying": "Applying…",
    "cancel": "Cancel",
    "bakeFailed": "Couldn't process this image"
  },
```

nl:

```json
  "imageEditor": {
    "title": "Foto bewerken",
    "description": "Bijsnijden, zoomen en draaien. De bewerkte foto vervangt het origineel zodra je het formulier opslaat.",
    "zoom": "Zoom",
    "rotation": "Rotatie",
    "rotate90": "90° draaien",
    "apply": "Toepassen",
    "applying": "Toepassen…",
    "cancel": "Annuleren",
    "bakeFailed": "Deze afbeelding kon niet worden verwerkt"
  },
```

- [ ] Verify: web vitest 122; web tsc clean; JSON parse + en==source.
- [ ] Prettier; commit: `feat(web): reusable crop/zoom/rotate image editor dialog`

---

### Task 3 — Integrate into the definition image control (pick + re-edit)

**Files:**

- Modify: `apps/web/src/components/suggest-edit/definition-fields.tsx`
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json` (one key)

**Steps:**

- [ ] In `definition-fields.tsx` (image block at ~lines 264-292): route BOTH intake paths through the editor.
  - Add local state: `const [editing, setEditing] = useState<{ src: string; fileName: string; revoke: boolean } | null>(null);`
  - File input `onChange`: instead of `onPickFile(file)` directly, `const file = e.target.files?.[0]; if (file) setEditing({ src: URL.createObjectURL(file), fileName: file.name, revoke: true }); e.target.value = "";` (reset so re-picking the same file re-fires).
  - Add an "Edit photo" button next to "Replace image", rendered only when `currentImageUrl` is set: `onClick={() => setEditing({ src: currentImageUrl, fileName: "cover.jpg", revoke: false })}` with a `Pencil` icon (import) and new key `t("editImage")`.
  - Render `<ImageEditorDialog src={editing?.src ?? null} fileName={editing?.fileName ?? "cover.jpg"} onApply={(file) => { onPickFile(file); closeEditor(); }} onClose={closeEditor} />` where `closeEditor` revokes the object URL when `editing?.revoke` and sets state null.
  - The component's external contract is unchanged (`onPickFile` still receives a `File`); both host pages (member suggest-edit, admin edit) need NO changes — their preview/diff logic already treats a picked file as the new image.
- [ ] Add the key to all three locales inside `suggestEdit` (next to `replaceImage`): en + source `"editImage": "Edit photo",` — nl `"editImage": "Foto bewerken",`.
- [ ] Verify: web vitest 122; web tsc clean; lint no new warnings; JSON checks.
- [ ] Prettier; commit: `feat(web): image editor wired into the definition image control`

---

### Task 4 — Integrate into the copy-photo upload

**Files:**

- Modify: `apps/web/src/routes/_dashboard/copies/$id.tsx` (the `PhotoStrip` upload path, ~lines 692-803)

**Steps:**

- [ ] In `PhotoStrip`: the file input currently calls `uploadPhoto.mutate(file)` directly. Change to the same edit-first flow: picked file → object URL → `ImageEditorDialog` → `onApply(baked) => uploadPhoto.mutate(baked)`; `onClose` revokes + clears. Keep `uploadPhoto` and its toasts untouched; keep the input-reset in `onSettled`. Scope: only NEW uploads get the editor (existing strip photos keep their current lifecycle).
- [ ] Verify: web vitest 122; web tsc clean; lint no new.
- [ ] Prettier; commit: `feat(web): edit-before-upload for copy photos`

---

### Task 5 — Full sweep

- [ ] Run the standard sweep (`nx run-many -t type-check|test|lint --skip-nx-cache`, `prettier --check .`, backend 589, web 122). All green expected; write-fix prettier findings.
- [ ] Report done; the controller pushes and opens the stacked PR (`--base feat/change-proposals-admin-ui`).
