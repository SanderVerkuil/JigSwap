"use client";

// Admin indicator for CSAM hash matching (lib/imageModeration/csamHashCheck), at the top of the
// moderation console next to ScreeningHealth: red while matching is off (no provider selected),
// selected but not configured (photos are then held, like an outage), or unreachable with photos
// held unpublished, and while photos uploaded WITHOUT a hash check (hashCheckSkippedAt) still wait
// for one. That count is of uploads, not of published photos: the classifier or a moderator may
// have refused some since. It never says a check ran that did not (review 2026-10-29, SEC-03,
// P-03 Stage 1a). Renders nothing while matching works and nothing waits. Reads the hash-check
// state of admin/listCsamEscalations, which the page already loads for the Hash matches tab (the
// tab keeps the waiting/timed-out details).
import type { CsamEscalations } from "@/components/admin/moderation/csam-escalations";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { ShieldAlert } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

type HashCheck = CsamEscalations["hashCheck"];

export function HashCheckHealth({
  hashCheck,
}: {
  hashCheck: HashCheck | undefined;
}) {
  const t = useTranslations("admin.moderation.csam.health");
  const format = useFormatter();
  const relativeTime = useRelativeTime();
  if (!hashCheck) return null;

  const { status, waitingPhotos, uncheckedPhotos } = hashCheck;
  // Photos held for an answer: the service is down, or Offlimits is selected but incomplete.
  const held = status !== "disabled" && waitingPhotos > 0;
  const unreachable = status === "ok" && held;
  if (status === "ok" && !unreachable && uncheckedPhotos === 0) return null;

  const title =
    status === "disabled"
      ? t("offTitle")
      : status === "missing_config"
        ? t("missingConfigTitle")
        : unreachable
          ? t("unreachableTitle")
          : t("uncheckedTitle");

  const messages: string[] = [];
  if (status === "disabled") messages.push(t("off"));
  if (status === "missing_config") {
    messages.push(
      t("missingConfig", { vars: hashCheck.missingVars.join(", ") }),
    );
  }
  if (held) {
    messages.push(
      t("held", {
        count: waitingPhotos,
        countLabel: hashCheck.waitingCapped
          ? `${waitingPhotos}+`
          : String(waitingPhotos),
        since:
          hashCheck.oldestWaitingSince === null
            ? ""
            : relativeTime(hashCheck.oldestWaitingSince),
      }),
    );
  }
  if (uncheckedPhotos > 0) {
    messages.push(
      t("unchecked", {
        count: uncheckedPhotos,
        countLabel: hashCheck.uncheckedCapped
          ? `${uncheckedPhotos}+`
          : String(uncheckedPhotos),
        since:
          hashCheck.uncheckedSince === null
            ? ""
            : format.dateTime(hashCheck.uncheckedSince, {
                dateStyle: "medium",
              }),
      }),
    );
    // Only a working service can check them; an unreachable one is told above.
    if (status === "ok" && !held) messages.push(t("recheck"));
  }

  return (
    <div
      role="status"
      className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <ShieldAlert
        className="mt-0.5 size-4 shrink-0 text-destructive"
        aria-hidden
      />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{title}</p>
        {messages.map((message) => (
          <p key={message} className="break-words text-muted-foreground">
            {message}
          </p>
        ))}
      </div>
    </div>
  );
}
