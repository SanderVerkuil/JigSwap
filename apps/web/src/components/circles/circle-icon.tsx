"use client";

// A circle's icon, for its Admins (the server checks that too): pick an image,
// crop it square in the image editor, upload it, and let the shared image check
// approve it. Members see the icon only once it is approved; until then the
// uploader and the Admins see "Being checked", and a refused icon tells its
// uploader it was removed (sharing/circleIcons.ts). The picker is shared by the
// manage dialog's Icon section and the circle chat's "Change icon" item.
import { ImageEditorDialog } from "@/components/image-editor/image-editor-dialog";
import { CircleThreadAvatar } from "@/components/messaging/circle-thread-avatar";
import { Button } from "@/components/ui/button";
import { gateway, type Id } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { ConvexError } from "convex/values";
import { Clock, ImagePlus, Trash2, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

/** The image types the server accepts for an icon (sharing/circleIcons.ts). */
export const CIRCLE_ICON_ACCEPT = "image/jpeg,image/png,image/webp";

const REFUSAL_KEY = {
  ImageTooLarge: "icon.tooLarge",
  UnsupportedImageType: "icon.unsupported",
  UploadExpired: "icon.expired",
} as const;

const errorKey = (error: unknown): string => {
  if (error instanceof ConvexError) {
    const code = (error.data as { code?: unknown } | undefined)?.code;
    if (code === "RateLimited") return "icon.rateLimited";
  }
  return "icon.failed";
};

/**
 * Pick, crop (square) and upload a new icon for `circleId`. Render `dialogs`
 * once (the hidden file input and the editor) and call `pick()` from a
 * button or menu item.
 */
export function useCircleIconPicker(circleId: string): {
  pick: () => void;
  uploading: boolean;
  dialogs: ReactNode;
} {
  const t = useTranslations("circles");
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<{
    src: string;
    fileName: string;
  } | null>(null);
  const generateUploadUrl = useConvexMutation(
    gateway.sharing.generateIconUploadUrl,
  );
  const setIcon = useConvexMutation(gateway.sharing.setIcon);

  const closeEditor = () => {
    if (editing) URL.revokeObjectURL(editing.src);
    setEditing(null);
  };

  // URL grant, raw POST, then the claim: one mutationFn, so isPending covers
  // the whole upload.
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const uploadUrl = await generateUploadUrl({ circleId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = (await res.json()) as { storageId: string };
      return setIcon({ circleId, storageId: storageId as Id<"_storage"> });
    },
    onSuccess: (result) => {
      if ("refused" in result) toast.error(t(REFUSAL_KEY[result.refused]));
      else toast.success(t("icon.uploaded"));
    },
    onError: (error) => toast.error(t(errorKey(error))),
  });

  const dialogs = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={CIRCLE_ICON_ACCEPT}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            setEditing({ src: URL.createObjectURL(file), fileName: file.name });
          }
          e.target.value = "";
        }}
      />
      <ImageEditorDialog
        src={editing?.src ?? null}
        fileName={editing?.fileName ?? "icon.jpg"}
        aspectRatio={1}
        variant="icon"
        onApply={(file) => {
          upload.mutate(file);
          closeEditor();
        }}
        onClose={closeEditor}
      />
    </>
  );

  return {
    pick: () => inputRef.current?.click(),
    uploading: upload.isPending,
    dialogs,
  };
}

export type CircleIconStatus = "checking" | "removed";

/** The manage dialog's Icon section, as it looks for one state (no data access). */
export function CircleIconSectionView({
  iconUrl,
  iconStatus,
  busy,
  onPick,
  onRemove,
  onDismiss,
}: {
  iconUrl?: string;
  iconStatus?: CircleIconStatus;
  busy: boolean;
  onPick: () => void;
  onRemove: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("circles");
  // An upload still being checked can be withdrawn too.
  const removable = iconUrl !== undefined || iconStatus === "checking";
  return (
    <section className="space-y-3">
      <h3 className="font-medium">{t("icon.title")}</h3>
      <p className="text-muted-foreground text-sm">{t("icon.hint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <CircleThreadAvatar
          members={[]}
          iconUrl={iconUrl}
          className="size-14"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onPick}
          >
            <ImagePlus aria-hidden className="size-4" />
            {busy
              ? t("icon.uploading")
              : iconUrl
                ? t("icon.change")
                : t("icon.upload")}
          </Button>
          {removable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onRemove}
            >
              <Trash2 aria-hidden className="size-4" />
              {t("icon.remove")}
            </Button>
          )}
        </div>
      </div>
      {iconStatus === "checking" && (
        <p
          role="status"
          className="text-muted-foreground flex items-start gap-2 text-sm"
        >
          <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="text-foreground font-medium">
              {t("icon.checking")}
            </span>
            {" · "}
            {t("icon.checkingHint")}
          </span>
        </p>
      )}
      {iconStatus === "removed" && (
        <div
          role="status"
          className="bg-muted flex items-start gap-2 rounded-lg p-3 text-sm"
        >
          <p className="flex-1">{t("icon.removed")}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={t("icon.dismiss")}
            onClick={onDismiss}
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      )}
    </section>
  );
}

/** The manage dialog's Icon section for one of the circle's Admins. */
export function CircleIconSection({
  circleId,
  iconUrl,
  iconStatus,
}: {
  circleId: string;
  iconUrl?: string;
  iconStatus?: CircleIconStatus;
}) {
  const t = useTranslations("circles");
  const { pick, uploading, dialogs } = useCircleIconPicker(circleId);
  const remove = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.removeIcon),
    onSuccess: () => toast.success(t("icon.removedToast")),
    onError: () => toast.error(t("icon.removeFailed")),
  });
  const dismiss = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.dismissIconNotice),
  });
  return (
    <>
      <CircleIconSectionView
        iconUrl={iconUrl}
        iconStatus={iconStatus}
        busy={uploading || remove.isPending}
        onPick={pick}
        onRemove={() => remove.mutate({ circleId })}
        onDismiss={() => dismiss.mutate({ circleId })}
      />
      {dialogs}
    </>
  );
}
