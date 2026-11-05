import { rateLimitedRetryAt } from "@/lib/convex-error-code";
import { UploadRateLimitedError } from "@/lib/upload-rate-limit";
import { useTranslations } from "use-intl";
import { useRelativeTime } from "./use-relative-time";

// The toast for an upload URL refused by the member's upload limit (uploadUrl per hour,
// uploadUrlDaily per day): the refusal says when they can try again, so the message does too. The
// wording without a time is for a refusal that doesn't say.
export function useUploadLimitMessage(): (error: unknown) => string {
  const t = useTranslations("common");
  const relativeTime = useRelativeTime();
  return (error) => {
    const retryAt =
      error instanceof UploadRateLimitedError
        ? rateLimitedRetryAt(error.cause, Date.now())
        : undefined;
    return retryAt === undefined
      ? t("photoUploadRateLimited")
      : t("photoUploadRateLimitedUntil", { when: relativeTime(retryAt) });
  };
}
