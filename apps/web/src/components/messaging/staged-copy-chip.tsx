"use client";

// The copy staged on the composer (message-center redesign spec §7): a compact
// chip above the input row, removable unless the conversation is about it.
import { Image } from "@/compat/image";
import { Button } from "@/components/ui/button";
import { Puzzle, X } from "lucide-react";
import { useTranslations } from "use-intl";
import type { MessageCopy } from "./copy-card";

export function StagedCopyChip({
  copy,
  onRemove,
  descriptionId,
}: {
  copy: MessageCopy;
  // id of the sr-only "Attached: <title>" text, for the textarea's
  // aria-describedby.
  descriptionId?: string;
  // Omitted when the copy can't be removed (a new conversation about it).
  onRemove?: () => void;
}) {
  const t = useTranslations("messages");
  return (
    <div className="bg-background mb-2 flex w-fit max-w-full items-center gap-2 rounded-lg border p-1.5 pr-1">
      <span className="bg-muted relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {copy.coverUrl ? (
          <Image src={copy.coverUrl} alt="" fill className="object-cover" />
        ) : (
          <Puzzle className="text-muted-foreground size-4" aria-hidden />
        )}
      </span>
      <span className="min-w-0 truncate text-sm font-medium">{copy.title}</span>
      {descriptionId && (
        <span id={descriptionId} className="sr-only">
          {t("attached", { title: copy.title })}
        </span>
      )}
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 md:size-8"
          onClick={onRemove}
          aria-label={t("removeAttachment", { title: copy.title })}
        >
          <X className="size-4" />
        </Button>
      ) : (
        <span className="w-1" aria-hidden />
      )}
    </div>
  );
}
