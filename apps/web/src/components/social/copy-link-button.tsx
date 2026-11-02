import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Copy link: says "Copied" only once the clipboard accepted the link; a refusal (permissions,
// insecure context, no clipboard API) says so instead. Disabled while the link is still on its way.
export function CopyLinkButton({
  url,
  className,
  onCopied,
}: {
  url: string | null;
  className?: string;
  onCopied?: () => void;
}) {
  const t = useTranslations("invite");
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // No "Copied" reset may fire after the button is gone.
  useEffect(() => {
    const timer = copiedTimer;
    return () => clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      toast.error(t("copyError"));
      return;
    }
    setCopied(true);
    onCopied?.();
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Button
        variant="outline"
        className={className}
        disabled={!url}
        onClick={() => void copy()}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? t("copied") : t("copyLink")}
      </Button>
      {/* The button label swaps to "Copied!"; this live region announces it. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t("copied") : ""}
      </span>
    </>
  );
}
