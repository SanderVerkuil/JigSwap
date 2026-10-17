"use client";

// Compact card for the copy a conversation is about: shown in the new-conversation composer
// header and inside a message that references a copy. Links to the copy page.
import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import type { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { Puzzle } from "lucide-react";
import { useTranslations } from "use-intl";

export type MessageCopy = Extract<
  FunctionReturnType<typeof gateway.conversation.getCopyConversation>,
  { status: "new" }
>["copy"];

export function MessageCopyCard({
  copy,
  className,
}: {
  copy: MessageCopy;
  className?: string;
}) {
  const t = useTranslations("copyConversation");
  const meta = [
    copy.brand,
    copy.pieceCount !== null ? t("pieces", { count: copy.pieceCount }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/copies/${copy.copyId}`}
      className={cn(
        "bg-background text-foreground hover:bg-accent flex items-center gap-3 rounded-lg border p-2 transition-colors",
        className,
      )}
    >
      <span className="bg-muted relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {copy.coverUrl ? (
          <Image
            src={copy.coverUrl}
            alt={copy.title}
            fill
            className="object-cover"
          />
        ) : (
          <Puzzle className="text-muted-foreground size-5" aria-hidden />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">
          {copy.title}
        </span>
        {meta && (
          <span className="text-muted-foreground block truncate text-xs">
            {meta}
          </span>
        )}
      </span>
    </Link>
  );
}
