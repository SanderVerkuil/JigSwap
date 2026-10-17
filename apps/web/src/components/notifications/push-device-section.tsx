import { SectionHead } from "@/components/dashboard-home/section-head";
import { Button } from "@/components/ui/button";
import { BellOff, BellRing, Smartphone } from "lucide-react";
import { useTranslations } from "use-intl";
import { usePushSubscription } from "./use-push-subscription";

// Per-device Web Push control: a browser subscription is global to this device, separate from the
// per-type push preference toggles (which decide WHICH notifications go to push). This card-free
// section owns the "does this browser receive any push at all" decision: request permission,
// subscribe via the PushManager with the server's VAPID public key, and register/unregister the
// subscription. The UI follows the ACTUAL browser subscription; the server sync is best-effort.
export function PushDeviceSection() {
  const t = useTranslations("notifications");
  const {
    mounted,
    supported,
    permission,
    loading,
    configured,
    enabled,
    busy,
    enable,
    disable,
  } = usePushSubscription();

  // One bordered control row (NOT a card) holding the resolved status + action for this device.
  let row: React.ReactNode;
  if (!mounted || loading) {
    row = <Status text={t("pushDeviceDesc")} />;
  } else if (!supported) {
    row = <Status text={t("pushUnsupported")} />;
  } else if (!configured) {
    row = <Status text={t("pushUnconfigured")} />;
  } else if (permission === "denied") {
    row = <Status text={t("pushBlocked")} />;
  } else if (enabled) {
    row = (
      <>
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
          <BellRing className="text-jigsaw-secondary h-4 w-4" />
          {t("pushEnabledOnDevice")}
        </span>
        <Button variant="outline" size="sm" disabled={busy} onClick={disable}>
          {t("pushDisable")}
        </Button>
      </>
    );
  } else {
    row = (
      <>
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
          <BellOff className="h-4 w-4" />
          {t("pushDeviceDesc")}
        </span>
        <Button variant="brand" size="sm" disabled={busy} onClick={enable}>
          {t("pushEnable")}
        </Button>
      </>
    );
  }

  return (
    <section>
      <SectionHead title={t("pushDeviceTitle")} icon={Smartphone} />
      <div className="bg-muted/30 flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
        {row}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {t("pushDeviceSubtitle")}
      </p>
    </section>
  );
}

function Status({ text }: { text: string }) {
  return <p className="text-muted-foreground text-sm">{text}</p>;
}
