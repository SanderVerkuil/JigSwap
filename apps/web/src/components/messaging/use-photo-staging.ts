"use client";

// The composer's photo pipeline (spec 2.2): for each picked file, convert it
// to a JPEG, get an upload URL, POST it with progress, then claim it with
// stageMessageImage. State lives in stagingReducer; this hook only runs the
// steps. There is no cheap "are photos available" query, so the first
// ImagesUnavailable refusal hides Photo for the rest of the session.
import { conversationErrorCode } from "@/components/messaging/format";
import { gateway, type Id } from "@/gateway";
import { preparePhoto, uploadWithProgress } from "@/lib/prepare-photo";
import { useConvexMutation } from "@convex-dev/react-query";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import {
  MAX_STAGED_PHOTOS,
  refusalOf,
  remainingSlots,
  stagingReducer,
} from "./photo-staging";

// Session-wide: set once photos turn out to be unavailable (no classifier).
let photosUnavailable = false;
const listeners = new Set<() => void>();
const markPhotosUnavailable = () => {
  photosUnavailable = true;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
/** Whether Photo is offered (false after an ImagesUnavailable refusal). */
export const usePhotosAvailable = (): boolean =>
  !useSyncExternalStore(
    subscribe,
    () => photosUnavailable,
    () => false,
  );

/** Test seam: forget the session's unavailable flag. */
export const resetPhotosAvailability = () => {
  photosUnavailable = false;
};

let nextKey = 0;

export function usePhotoStaging(threadId: string) {
  const t = useTranslations("messages.photos");
  const [photos, dispatch] = useReducer(stagingReducer, []);
  const generateUrl = useConvexMutation(
    gateway.conversation.generateMessageUploadUrl,
  );
  const stage = useConvexMutation(gateway.conversation.stageMessageImage);

  // Object URLs to revoke once their chip is gone.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  });
  const previewsRef = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set(
      photos.flatMap((photo) => (photo.previewUrl ? [photo.previewUrl] : [])),
    );
    for (const url of previewsRef.current) {
      if (!live.has(url)) {
        URL.revokeObjectURL(url);
        previewsRef.current.delete(url);
      }
    }
  }, [photos]);
  useEffect(
    () => () => {
      for (const url of previewsRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const run = useCallback(
    async (key: string, file: File) => {
      let prepared;
      try {
        prepared = await preparePhoto(file);
      } catch {
        dispatch({ type: "refused", key, reason: "unsupported" });
        return;
      }
      const previewUrl = URL.createObjectURL(prepared.file);
      previewsRef.current.add(previewUrl);
      dispatch({ type: "prepared", key, previewUrl });
      try {
        const url = await generateUrl({ threadId });
        const storageId = await uploadWithProgress(
          url,
          prepared.file,
          (progress) => dispatch({ type: "progress", key, progress }),
        );
        dispatch({ type: "staging", key });
        const result = await stage({
          threadId,
          storageId: storageId as Id<"_storage">,
          width: prepared.width,
          height: prepared.height,
        });
        if ("refused" in result) {
          dispatch({ type: "refused", key, reason: refusalOf(result.refused) });
        } else {
          dispatch({ type: "ready", key, attachmentId: result.attachmentId });
        }
      } catch (error) {
        const code = conversationErrorCode(error);
        if (code === "ImagesUnavailable") {
          // Not this photo's fault: drop it and stop offering Photo.
          dispatch({ type: "remove", key });
          if (!photosUnavailable) toast.error(t("unavailable"));
          markPhotosUnavailable();
          return;
        }
        dispatch({ type: "refused", key, reason: refusalOf(code) });
      }
    },
    [generateUrl, stage, threadId, t],
  );

  /** Stage picked files, up to the free slots. */
  const addFiles = useCallback(
    (files: readonly File[]) => {
      const free = remainingSlots(photosRef.current);
      const accepted = files.slice(0, free);
      if (files.length > free)
        toast.info(t("limit", { max: MAX_STAGED_PHOTOS }));
      if (accepted.length === 0) return;
      const keys = accepted.map(() => `photo-${nextKey++}`);
      dispatch({ type: "add", keys });
      accepted.forEach((file, index) => void run(keys[index], file));
    },
    [run, t],
  );

  return {
    photos,
    addFiles,
    remove: (key: string) => dispatch({ type: "remove", key }),
    clear: () => dispatch({ type: "clear" }),
  };
}
