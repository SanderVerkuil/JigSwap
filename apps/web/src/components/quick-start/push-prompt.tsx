"use client";

import { usePushSubscription } from "@/components/notifications/use-push-subscription";
import { Button } from "@/components/ui/button";
import { safeStorage } from "@/lib/safe-storage";
import { cn } from "@/lib/utils";
import { Bell } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "use-intl";
import { shouldOfferPush } from "./logic";
import { PRIMARY_LOOK } from "./parts";

// Push permission is per device, so the "already asked" guard is too (spec §2.7).
const ASKED_KEY = "jigswap.quickStart.pushAsked";

const noopSubscribe = () => () => {};

/**
 * The inline push offer inside /welcome, only after the member's first social action there
 * (`triggered`). Not a dialog and it doesn't move focus; either answer sets the device guard.
 */
export function PushPrompt({ triggered }: { triggered: boolean }) {
  const push = usePushSubscription();
  // The server snapshot says "asked", so nothing renders until the client knows.
  const asked = useSyncExternalStore(
    noopSubscribe,
    () => safeStorage.getItem("local", ASKED_KEY) !== null,
    () => true,
  );
  const [answered, setAnswered] = useState(false);

  const offer =
    !answered &&
    shouldOfferPush({
      triggered,
      supported: push.supported,
      permission: push.permission,
      configured: push.configured,
      asked,
    });
  if (!offer) return null;

  const answer = (enable: boolean) => {
    safeStorage.setItem("local", ASKED_KEY, "1");
    setAnswered(true);
    if (enable) push.enable();
  };

  return (
    <PushPromptCard
      busy={push.busy}
      onEnable={() => answer(true)}
      onNotNow={() => answer(false)}
    />
  );
}

export function PushPromptCard({
  busy,
  onEnable,
  onNotNow,
}: {
  busy: boolean;
  onEnable: () => void;
  onNotNow: () => void;
}) {
  const t = useTranslations("quickStart.push");
  return (
    <div className="bg-card motion-safe:animate-in motion-safe:fade-in-0 flex flex-col gap-3 rounded-xl border p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Bell aria-hidden className="text-jigsaw-primary size-4 shrink-0" />
        {t("title")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button className={cn(PRIMARY_LOOK)} disabled={busy} onClick={onEnable}>
          {t("enable")}
        </Button>
        <Button
          variant="ghost"
          className="pointer-coarse:min-h-11"
          onClick={onNotNow}
        >
          {t("notNow")}
        </Button>
      </div>
    </div>
  );
}
