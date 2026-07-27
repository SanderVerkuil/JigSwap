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
import { StarRating } from "@/components/ui/star-rating";
import { Textarea } from "@/components/ui/textarea";
import { gateway, type Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import Compressor from "compressorjs";
import { AlertTriangle, ImagePlus, X } from "lucide-react";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { solvingErrorCode } from "./solving-error";

interface CompletionFollowUpApi {
  // Open the post-solve follow-up (rating + review + photos) for a completion. First-wins:
  // calls while a follow-up is already open are ignored (the completions-row Review button
  // is the fallback). Safe no-op outside the provider.
  requestFollowUp: (completionId: string) => void;
}

const CompletionFollowUpContext = createContext<CompletionFollowUpApi | null>(
  null,
);

// Flat client cap. Deliberate simplification: the completion is freshly created in this flow,
// so it never has existing photos; the server-side 5-cap is the real guard (TooManyPhotos).
const MAX_PHOTOS = 5;

interface PendingPhoto {
  id: string; // local key
  file: File; // compressed file, ready to POST
  previewUrl: string; // object URL of `file`; revoked on remove/close
  storageId?: string; // set once uploaded; retained across retries
  failed?: boolean; // last upload attempt failed (marked in UI, re-run by Retry)
}

let nextPhotoId = 0;

// Mounted once in the dashboard shell (inside DurationPromptProvider) so the dialog survives
// any solve dialog unmounting/navigating. Solve dialogs call requestFollowUp(completionId)
// after a completed save; the provider owns the single dialog instance.
export function CompletionFollowUpProvider({
  children,
}: {
  children: ReactNode;
}) {
  const t = useTranslations("solving.followUp");
  const tReview = useTranslations("solving.review");

  const generateUploadUrl = useConvexMutation(
    gateway.library.generateUploadUrl,
  );
  const reviewPuzzle = useConvexMutation(gateway.solving.reviewPuzzle);
  const attachCompletionPhotos = useConvexMutation(
    gateway.solving.attachCompletionPhotos,
  );

  const [completionId, setCompletionId] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  // First-wins guard (ref, not state: immune to same-tick double calls).
  const activeRef = useRef(false);
  // Review submitted on a previous Save attempt → retry is attach-only (never re-review).
  const reviewDoneRef = useRef(false);
  // Mirrors `completionId` for async callbacks (compression finishing after a close must not
  // leak a photo — or an unrevoked object URL — into a later session).
  const completionIdRef = useRef<string | null>(null);

  const requestFollowUp = (id: string) => {
    if (activeRef.current) return; // first-wins per open
    activeRef.current = true;
    completionIdRef.current = id;
    setCompletionId(id);
  };

  // Every close path (save, skip, dismiss) funnels here: clear the completionId and ALL
  // photo/upload state — revoking object URLs — so the next requestFollowUp works.
  const closeAndReset = () => {
    // Revoke-then-clear inside the functional update so it always sees the CURRENT list,
    // never a stale closure. Double-revoke under StrictMode is a harmless no-op.
    setPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
    setRating(0);
    setText("");
    setSaving(false);
    reviewDoneRef.current = false;
    activeRef.current = false;
    completionIdRef.current = null;
    setCompletionId(null);
  };

  const pickFiles = (list: FileList | null) => {
    const session = completionId; // pin the session the pick belongs to
    const files = Array.from(list ?? []);
    // Flat cap: only compress what still fits (see MAX_PHOTOS note above).
    const remaining = MAX_PHOTOS - photos.length;
    for (const file of files.slice(0, remaining)) {
      new Compressor(file, {
        quality: 0.6,
        maxWidth: 1024,
        maxHeight: 1024,
        success: (result) => {
          // Dialog closed (or reopened for another completion) while compressing: drop the
          // result before creating any object URL, so close always means fully-reset state.
          if (session === null || completionIdRef.current !== session) return;
          const compressed = new File([result], file.name, {
            type: file.type,
          });
          const previewUrl = URL.createObjectURL(compressed);
          // Re-check the cap against the CURRENT list (concurrent picks can race past the
          // pre-slice); in the reject branch revoke immediately — double-revoke is a no-op.
          setPhotos((prev) => {
            if (prev.length >= MAX_PHOTOS) {
              URL.revokeObjectURL(previewUrl);
              return prev;
            }
            return [
              ...prev,
              { id: `photo-${nextPhotoId++}`, file: compressed, previewUrl },
            ];
          });
        },
        error: (error) => {
          console.error("Failed to compress photo:", error);
          toast.error(t("uploadFailed"));
        },
      });
    }
  };

  const removePhoto = (id: string) => {
    const target = photos.find((p) => p.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  // One file's grant → POST → storageId pipeline (mirrors the copy PhotoStrip upload).
  const uploadOne = async (photo: PendingPhoto): Promise<string> => {
    const uploadUrl = await generateUploadUrl({});
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": photo.file.type },
      body: photo.file,
    });
    if (!res.ok) throw new Error("upload failed");
    const { storageId } = (await res.json()) as { storageId: string };
    return storageId;
  };

  const handleSave = async () => {
    if (!completionId || saving) return;
    setSaving(true);
    try {
      // 1. Upload in parallel — only photos without a storageId (Retry re-runs failures
      //    only; earlier successes keep their storageIds).
      const current = photos;
      const pending = current.filter((p) => !p.storageId);
      const settled = await Promise.allSettled(pending.map(uploadOne));
      const uploaded = new Map<string, string>();
      const failedIds = new Set<string>();
      pending.forEach((p, i) => {
        const result = settled[i];
        if (result.status === "fulfilled") uploaded.set(p.id, result.value);
        else failedIds.add(p.id);
      });
      // Apply results by photo id via a functional update: photos unknown to this save pass
      // (none today — picking is disabled while saving — but by construction) stay untouched
      // and their object URLs are never clobbered.
      setPhotos((prev) =>
        prev.map((p) => {
          const storageId = uploaded.get(p.id);
          if (storageId) return { ...p, storageId, failed: false };
          return failedIds.has(p.id) ? { ...p, failed: true } : p;
        }),
      );
      if (failedIds.size > 0) {
        // Partial failure: keep the dialog open with failed items marked; Save becomes Retry.
        toast.error(t("saveError"));
        return;
      }

      // 2. Review (independent of photos; rating 0 means "skipped the rating").
      if (rating >= 1 && !reviewDoneRef.current) {
        await reviewPuzzle({
          completionId,
          rating,
          text: text.trim() || undefined,
        });
        reviewDoneRef.current = true;
      }

      // 3. One attach call for all storageIds; on failure the retry is attach-only
      //    (uploads are done, review is once-guarded above). Prior successes come off the
      //    snapshot, fresh ones off this pass's upload results.
      const storageIds = current.flatMap((p) => {
        const storageId = p.storageId ?? uploaded.get(p.id);
        return storageId ? [storageId as Id<"_storage">] : [];
      });
      if (storageIds.length > 0) {
        await attachCompletionPhotos({ completionId, storageIds });
      }

      toast.success(t("saved"));
      closeAndReset();
    } catch (error) {
      console.error("Failed to save completion follow-up:", error);
      toast.error(
        solvingErrorCode(error) === "TooManyPhotos"
          ? t("tooManyPhotos")
          : t("saveError"),
      );
    } finally {
      setSaving(false);
    }
  };

  const hasFailed = photos.some((p) => p.failed && !p.storageId);

  return (
    <CompletionFollowUpContext.Provider value={{ requestFollowUp }}>
      {children}
      <Dialog
        open={completionId !== null}
        onOpenChange={(o) => {
          // Dismissal is disabled while saving: ignore the close request entirely.
          if (!o && !saving) closeAndReset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{tReview("rating")}</Label>
              <StarRating
                value={rating}
                onChange={setRating}
                size="lg"
                label={tReview("rating")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="follow-up-text">{tReview("text")}</Label>
              <Textarea
                id="follow-up-text"
                placeholder={tReview("textPlaceholder")}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("photosLabel")}</Label>
              <div className="grid grid-cols-4 gap-2">
                {photos.map((photo) => (
                  <div
                    key={photo.id}
                    className={cn(
                      "bg-muted relative aspect-square overflow-hidden rounded-md border",
                      photo.failed && !photo.storageId && "border-destructive",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.previewUrl}
                      alt={photo.file.name}
                      className="h-full w-full object-cover"
                    />
                    {photo.failed && !photo.storageId && (
                      <span
                        title={t("uploadFailed")}
                        className="bg-destructive absolute bottom-1 left-1 rounded-full p-1 text-white"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        <span className="sr-only">{t("uploadFailed")}</span>
                      </span>
                    )}
                    {!saving && (
                      <button
                        type="button"
                        onClick={() => removePhoto(photo.id)}
                        aria-label={t("removePhoto")}
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <label
                    className={cn(
                      "border-border text-muted-foreground flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-[10px] font-semibold",
                      saving && "pointer-events-none opacity-60",
                    )}
                  >
                    <ImagePlus className="h-4 w-4" />
                    {t("addPhotos")}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      disabled={saving}
                      onChange={(e) => {
                        pickFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
              <p className="text-muted-foreground text-xs">{t("photosHint")}</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeAndReset} disabled={saving}>
              {t("skip")}
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {hasFailed ? t("retry") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CompletionFollowUpContext.Provider>
  );
}

// Solve dialogs call requestFollowUp(completionId) after a completed save. Safe no-op outside
// the provider.
export function useCompletionFollowUp(): CompletionFollowUpApi {
  return (
    useContext(CompletionFollowUpContext) ?? {
      requestFollowUp: () => {},
    }
  );
}
