"use client";

import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
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
  const [isOpen, setIsOpen] = useState(true);

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
            <div className="flex items-center gap-2">
              <span className="text-sm">{value || placeholder}</span>
            </div>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="z-50" align="start">
            <Card className="p-0 overflow-hidden">
              <CardContent className="p-0">
                <EmojiPicker
                  onEmojiSelect={(emoji) => {
                    onChange(emoji.emoji);
                    setIsOpen(false);
                  }}
                >
                  <EmojiPickerSearch />
                  <div className="max-h-[300px] overflow-y-auto">
                    <EmojiPickerContent />
                  </div>
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
