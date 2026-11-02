import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "use-intl";

// Shown in place of the code or the share buttons when the invite link couldn't be fetched.
// Left-aligned, as the sections it sits in are; the centred QR card centres it through className.
export function InviteLinkError({
  onRetry,
  className,
}: {
  onRetry: () => void;
  className?: string;
}) {
  const t = useTranslations("invite");
  return (
    <div
      role="alert"
      className={cn("flex max-w-sm flex-col items-start gap-3", className)}
    >
      <p className="text-sm">{t("linkError")}</p>
      <Button variant="outline" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}
