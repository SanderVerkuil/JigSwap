"use client";

import * as Popover from "@radix-ui/react-popover";
import type { Locale } from "frimousse";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from "./emoji-picker";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Card, CardContent } from "./card";

export function EmojiPickerInput({
  id,
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
}: {
  id: string;
  value: string;
  onChange: (emoji: string) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // The localized name of the just-picked emoji, shown next to the glyph in the trigger. frimousse
  // has no reverse char->name lookup, so a persisted icon (on first render) shows just the glyph
  // until the user (re)picks; picking surfaces the localized name immediately.
  const [label, setLabel] = useState<string | null>(null);
  const t = useTranslations("emojiPicker");
  const locale = useLocale();

  return (
    <div id={id}>
      <Popover.Root open={isOpen} onOpenChange={setIsOpen} modal>
        <Popover.Trigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={isOpen}
            className={cn(
              "w-full justify-between",
              disabled && "opacity-50 cursor-not-allowed",
              className,
            )}
            disabled={disabled}
          >
            <span className="flex min-w-0 items-center gap-2">
              {value ? (
                <>
                  <span className="text-base leading-none">{value}</span>
                  {label && (
                    <span className="text-muted-foreground truncate text-sm">
                      {label}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground text-sm">
                  {placeholder}
                </span>
              )}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="z-50" align="start">
            <Card className="p-0 overflow-hidden">
              <CardContent className="p-0">
                {/* frimousse's Viewport is its own (virtualized) scroll area, so the Root needs a
                    concrete height for it to scroll, and a concrete width so the emoji grid fills
                    the popover (no right-hand whitespace). No extra overflow wrapper. */}
                <EmojiPicker
                  locale={locale as Locale}
                  className="h-[320px] w-[324px]"
                  onEmojiSelect={(emoji) => {
                    onChange(emoji.emoji);
                    setLabel(emoji.label);
                    setIsOpen(false);
                  }}
                >
                  <EmojiPickerSearch placeholder={t("search")} />
                  <EmojiPickerContent />
                  <EmojiPickerFooter />
                </EmojiPicker>
              </CardContent>
            </Card>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
