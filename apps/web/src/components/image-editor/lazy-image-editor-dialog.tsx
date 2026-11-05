"use client";

import { useEffect, useEffectEvent, useState, type ComponentType } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { ImageEditorDialogProps } from "./image-editor-dialog";

/**
 * The image editor for a page that offers it. The cropper and its stylesheet weigh 25 KB gz and most
 * visitors to those pages never pick an image, so they download when one is picked, and
 * bundle-budget.json keeps them out of every route's first load. Import this one, not
 * ./image-editor-dialog, which a static import would put back in that route's first load.
 */
export function LazyImageEditorDialog(props: ImageEditorDialogProps) {
  const t = useTranslations("imageEditor");
  const [Editor, setEditor] =
    useState<ComponentType<ImageEditorDialogProps> | null>(null);
  const loading = props.src !== null && Editor === null;
  // Closing, and with it the page's cleanup of the picked file: the next pick tries the load again.
  const giveUp = useEffectEvent(() => {
    toast.error(t("loadFailed"));
    props.onClose();
  });
  useEffect(() => {
    if (!loading) return;
    import("./image-editor-dialog").then(
      ({ ImageEditorDialog }) => setEditor(() => ImageEditorDialog),
      () => giveUp(),
    );
  }, [loading]);
  return Editor ? <Editor {...props} /> : null;
}
