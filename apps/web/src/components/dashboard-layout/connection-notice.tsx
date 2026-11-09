"use client";

// A slim strip that says the app is offline, so a member who loses their connection isn't left
// wondering why nothing updates or sends. It waits a few seconds first: the socket drops and comes
// back on its own often enough (a phone switching networks, a laptop waking) that an instant notice
// would flash for nothing. The status region is always mounted, so screen readers announce the
// strip when it appears. Mounted twice by the shell, each shown by its own layout: at the top of
// the sheet from md, and inside the sticky phone top bar.
import { useConnectionState } from "@/lib/use-connection-state";
import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

export const CONNECTION_NOTICE_DELAY_MS = 3000;

export function ConnectionNotice({ className }: { className?: string }) {
  const t = useTranslations("shell.connection");
  const { connected } = useConnectionState();
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    if (connected) return;
    const timer = window.setTimeout(
      () => setWaited(true),
      CONNECTION_NOTICE_DELAY_MS,
    );
    // Back online: the next drop waits again.
    return () => {
      window.clearTimeout(timer);
      setWaited(false);
    };
  }, [connected]);

  return (
    <div role="status" className={className}>
      {!connected && waited && (
        <p className="bg-muted text-muted-foreground flex items-center gap-2 px-4 py-2 text-sm">
          <WifiOff aria-hidden className="size-4 shrink-0" />
          {t("offline")}
        </p>
      )}
    </div>
  );
}
