"use client";

// Admin indicator for automated photo screening: renders nothing while screening is configured
// and every photo got checked; otherwise a warning that says what is wrong (provider credentials missing,
// screening turned off) and how many photos are waiting "unscored" (visible to their uploader only),
// with a link to the runbook section that re-screens them.
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

// The runbook section that says how to re-screen photos that could not be checked.
export const RESCREEN_RUNBOOK_URL =
  "https://github.com/SanderVerkuil/JigSwap/blob/main/docs/deployment/one-shot-migrations.md#libraryrescreenphotos--screen-images-that-were-never-checked";

export function ScreeningHealth() {
  const t = useTranslations("admin.moderation.screening");
  const { data: health } = useQuery(
    convexQuery(gateway.admin.getPhotoScreeningHealth, {}),
  );
  if (!health) return null;

  const unscored = health.unscoredCopyPhotos + health.unscoredCompletionPhotos;
  const messages: { key: string; text: ReactNode }[] = [];
  if (health.status === "missing_token") {
    messages.push({
      key: "missingToken",
      text: t("missingToken", {
        provider: health.provider,
        vars: health.missingVars.join(", "),
      }),
    });
  }
  if (health.status === "disabled") {
    messages.push({ key: "disabled", text: t("disabled") });
  }
  if (unscored > 0) {
    const capped =
      health.unscoredCopyPhotos >= health.countCap ||
      health.unscoredCompletionPhotos >= health.countCap;
    messages.push({
      key: "unscored",
      text: t.rich("unscored", {
        count: unscored,
        countLabel: capped ? `${unscored}+` : String(unscored),
        link: (chunks) => (
          <a
            href={RESCREEN_RUNBOOK_URL}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {chunks}
          </a>
        ),
      }),
    });
  }
  if (messages.length === 0) return null;

  return (
    <div
      role="status"
      className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
    >
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
      <div className="space-y-1">
        <p className="font-medium">{t("title")}</p>
        {messages.map((message) => (
          <p key={message.key} className="text-muted-foreground">
            {message.text}
          </p>
        ))}
      </div>
    </div>
  );
}
