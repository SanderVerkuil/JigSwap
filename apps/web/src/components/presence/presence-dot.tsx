"use client";

// The presence dot on a member's avatar (spec 6.1): online is a filled green dot, away an amber
// half-filled ring, so colour is never the only cue. Offline or unknown renders nothing. It is
// absolutely positioned: put it in a `relative` wrapper around the avatar (the avatar itself is
// usually aria-hidden, so the dot must sit beside it for its sr-only label to be read) and the
// layout never shifts when a status appears.
import { cn } from "@/lib/utils";
import { useTranslations } from "use-intl";
import type { PresenceStatus } from "./use-presence";

export function PresenceDot({
  status,
  className,
}: {
  status: PresenceStatus | undefined;
  className?: string;
}) {
  const t = useTranslations("presence");
  if (!status) return null;
  return (
    <span
      data-presence={status}
      className={cn(
        "ring-card pointer-events-none absolute right-0 bottom-0 block size-3 rounded-full ring-2",
        status === "online"
          ? "bg-jigsaw-success"
          : "border-jigsaw-warning border-2 bg-[linear-gradient(to_top,var(--jigsaw-warning)_50%,var(--card)_50%)]",
        className,
      )}
    >
      <span className="sr-only">{t(status)}</span>
    </span>
  );
}
