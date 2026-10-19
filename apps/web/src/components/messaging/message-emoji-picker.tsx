"use client";

// The composer's emoji picker body. Loaded lazily by EmojiButton on the first
// open, so frimousse stays out of the messages chunk; its emoji data comes
// from the CDN at runtime (see lib/emoji-label.ts).
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import type { Locale } from "frimousse";
import { useLocale, useTranslations } from "use-intl";

export default function MessageEmojiPicker({
  onSelect,
}: {
  onSelect: (emoji: string) => void;
}) {
  const t = useTranslations("emojiPicker");
  const locale = useLocale();
  return (
    <EmojiPicker
      locale={locale as Locale}
      className="h-[320px] w-[324px]"
      onEmojiSelect={(emoji) => onSelect(emoji.emoji)}
    >
      <EmojiPickerSearch placeholder={t("search")} />
      <EmojiPickerContent />
      <EmojiPickerFooter />
    </EmojiPicker>
  );
}
