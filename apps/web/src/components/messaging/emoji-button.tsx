"use client";

// The composer's emoji button (md and up; phones have an OS emoji keyboard).
// Opens a popover with the frimousse picker, loaded on first open. A pick is
// inserted at the textarea's caret (replacing a selection), the popover
// closes and focus goes back to the textarea.
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Loader2, Smile } from "lucide-react";
import { lazy, Suspense, useState, type RefObject } from "react";
import { useTranslations } from "use-intl";
import { applyTextEdit, replaceSelection } from "./markup-shortcuts";

const MessageEmojiPicker = lazy(() => import("./message-emoji-picker"));

export function EmojiButton({
  textareaRef,
  maxLength,
  onValue,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  maxLength: number;
  /** Called with the new value when the insert can't go through execCommand. */
  onValue: (value: string) => void;
}) {
  const t = useTranslations("messages");
  const [open, setOpen] = useState(false);

  const insert = (emoji: string) => {
    setOpen(false);
    const textarea = textareaRef.current;
    if (!textarea) return;
    const edit = replaceSelection(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      emoji,
      maxLength,
    );
    if (edit) applyTextEdit(textarea, edit, onValue);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "text-muted-foreground hidden size-10 shrink-0 rounded-full md:inline-flex",
                open && "bg-accent text-accent-foreground",
              )}
              aria-label={t("emojiButton")}
            >
              <Smile aria-hidden className="size-5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("emojiButton")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        className="w-auto overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          textareaRef.current?.focus();
        }}
      >
        <Suspense
          fallback={
            <div className="text-muted-foreground flex h-[320px] w-[324px] items-center justify-center">
              <Loader2 aria-hidden className="size-4 animate-spin" />
            </div>
          }
        >
          <MessageEmojiPicker onSelect={insert} />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
