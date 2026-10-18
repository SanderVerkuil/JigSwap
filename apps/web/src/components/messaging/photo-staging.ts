// Pure state and rules for the composer's staged photos (spec 2.2, R.3), kept
// free of React/Convex runtime imports so they unit-test in plain node.
//
// Each picked file becomes one chip that walks preparing (JPEG re-encode) →
// uploading (progress 0..1) → staging (stageMessageImage) → ready (holds the
// attachment id), or stops at refused with a reason the chip explains.

/** Photos per send (the backend's MAX_PHOTOS_PER_SEND). */
export const MAX_STAGED_PHOTOS = 4;

export type PhotoRefusal =
  // The browser could not decode or convert the file (e.g. HEIC outside Safari).
  "unsupported" | "tooLarge" | "expired" | "rateLimited" | "failed";

export type StagedPhoto = {
  /** Client-side key. */
  readonly key: string;
  /** Object URL of the converted JPEG, once it exists. */
  readonly previewUrl?: string;
} & (
  | { readonly status: "preparing" }
  | { readonly status: "uploading"; readonly progress: number }
  | { readonly status: "staging" }
  | { readonly status: "ready"; readonly attachmentId: string }
  | { readonly status: "refused"; readonly reason: PhotoRefusal }
);

export type StagingAction =
  | { type: "add"; keys: readonly string[] }
  | { type: "prepared"; key: string; previewUrl: string }
  | { type: "progress"; key: string; progress: number }
  | { type: "staging"; key: string }
  | { type: "ready"; key: string; attachmentId: string }
  | { type: "refused"; key: string; reason: PhotoRefusal }
  | { type: "remove"; key: string }
  | { type: "clear" };

// Updates for a chip that was removed meanwhile are dropped (its upload may
// still finish in the background; the backend expires an unsent stage).
const update = (
  photos: readonly StagedPhoto[],
  key: string,
  next: (photo: StagedPhoto) => StagedPhoto,
): readonly StagedPhoto[] =>
  photos.map((photo) => (photo.key === key ? next(photo) : photo));

export function stagingReducer(
  photos: readonly StagedPhoto[],
  action: StagingAction,
): readonly StagedPhoto[] {
  switch (action.type) {
    case "add":
      return [
        ...photos,
        ...action.keys.map((key) => ({ key, status: "preparing" as const })),
      ];
    case "prepared":
      return update(photos, action.key, (photo) => ({
        ...photo,
        previewUrl: action.previewUrl,
        status: "uploading",
        progress: 0,
      }));
    case "progress":
      return update(photos, action.key, (photo) =>
        photo.status === "uploading"
          ? { ...photo, progress: Math.min(1, Math.max(0, action.progress)) }
          : photo,
      );
    case "staging":
      return update(photos, action.key, (photo) => ({
        key: photo.key,
        previewUrl: photo.previewUrl,
        status: "staging",
      }));
    case "ready":
      return update(photos, action.key, (photo) => ({
        key: photo.key,
        previewUrl: photo.previewUrl,
        status: "ready",
        attachmentId: action.attachmentId,
      }));
    case "refused":
      return update(photos, action.key, (photo) => ({
        key: photo.key,
        previewUrl: photo.previewUrl,
        status: "refused",
        reason: action.reason,
      }));
    case "remove":
      return photos.filter((photo) => photo.key !== action.key);
    case "clear":
      return [];
  }
}

/** How many more files a pick may add. */
export const remainingSlots = (photos: readonly StagedPhoto[]): number =>
  Math.max(0, MAX_STAGED_PHOTOS - photos.length);

/** Chips still working (not ready, not refused). */
export const isBusy = (photo: StagedPhoto): boolean =>
  photo.status !== "ready" && photo.status !== "refused";

export type SendState =
  | { kind: "disabled" }
  // Both a puzzle and photos staged: send them separately (see the hint).
  | { kind: "blocked" }
  | { kind: "text" }
  | { kind: "photos"; attachmentIds: string[] };

/**
 * What Send does now. Photos send once every upload has finished (refused
 * chips are ignored; a pick that is only refusals sends the text alone). A
 * staged puzzle needs text, as before. A puzzle together with photos is
 * blocked: the caption belongs to the photos and the puzzle card to a text
 * message, so they go in two sends.
 */
export function sendState({
  body,
  photos,
  hasCopy,
}: {
  body: string;
  photos: readonly StagedPhoto[];
  hasCopy: boolean;
}): SendState {
  if (photos.some(isBusy)) return { kind: "disabled" };
  const attachmentIds = photos.flatMap((photo) =>
    photo.status === "ready" ? [photo.attachmentId] : [],
  );
  if (attachmentIds.length > 0) {
    return hasCopy ? { kind: "blocked" } : { kind: "photos", attachmentIds };
  }
  return body.trim() ? { kind: "text" } : { kind: "disabled" };
}

/** stageMessageImage's `{ refused }` codes and the pipeline's error codes → a chip reason. */
export function refusalOf(code: string | undefined): PhotoRefusal {
  switch (code) {
    case "ImageTooLarge":
      return "tooLarge";
    case "UnsupportedImageType":
    case "InvalidImageSize":
      return "unsupported";
    case "UploadExpired":
      return "expired";
    case "RateLimited":
      return "rateLimited";
    default:
      return "failed";
  }
}

// A photo's box keeps its stored aspect ratio, clamped between 3:4 (tall) and
// 16:9 (wide), so the thread doesn't jump when the image loads; unknown sizes
// get 4:3.
const MIN_ASPECT = 3 / 4;
const MAX_ASPECT = 16 / 9;
export function photoAspect(w?: number, h?: number): number {
  if (!w || !h) return 4 / 3;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
}
