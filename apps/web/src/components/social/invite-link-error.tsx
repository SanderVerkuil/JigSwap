import { Button } from "@/components/ui/button";
import { useTranslations } from "use-intl";

// Shown in place of the code or the share buttons when the invite link couldn't be fetched.
export function InviteLinkError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("invite");
  return (
    <div role="alert" className="flex max-w-sm flex-col items-center gap-3">
      <p className="text-center text-sm">{t("linkError")}</p>
      <Button variant="outline" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}
