"use client";

// Admin indicator for automated photo screening: renders nothing while screening is configured
// and every photo got checked; otherwise a warning that says what is wrong (no Hugging Face token,
// screening turned off) and how many photos are waiting "unscored" (visible to their uploader only).
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "use-intl";

export function ScreeningHealth() {
  const t = useTranslations("admin.moderation.screening");
  const { data: health } = useQuery(
    convexQuery(gateway.admin.getPhotoScreeningHealth, {}),
  );
  if (!health) return null;

  const unscored = health.unscoredCopyPhotos + health.unscoredCompletionPhotos;
  const messages: string[] = [];
  if (health.status === "missing_token") messages.push(t("missingToken"));
  if (health.status === "disabled") messages.push(t("disabled"));
  if (unscored > 0) {
    const capped =
      health.unscoredCopyPhotos >= health.countCap ||
      health.unscoredCompletionPhotos >= health.countCap;
    messages.push(
      t("unscored", {
        count: unscored,
        countLabel: capped ? `${unscored}+` : String(unscored),
      }),
    );
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
          <p key={message} className="text-muted-foreground">
            {message}
          </p>
        ))}
      </div>
    </div>
  );
}
