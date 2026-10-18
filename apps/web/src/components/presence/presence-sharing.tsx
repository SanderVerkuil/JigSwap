"use client";

// The member's presence-sharing choice (spec 6.5): the toggle on the "Privacy & safety" page and
// the one-time prompt above the /messages inbox while the choice was never made (share null).
// Both write social.setPresencePreferences; "Not now" stores false, changeable in settings.
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { Circle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { usePresenceSettings } from "./use-presence";

function useSetPresenceShare() {
  const t = useTranslations("presence");
  const setPresence = useConvexMutation(gateway.social.setPresencePreferences);
  return (share: boolean) =>
    setPresence({ share }).then(
      () => true,
      (error: unknown) => {
        console.error("Failed to save presence sharing:", error);
        toast.error(t("saveFailed"));
        return false;
      },
    );
}

export function PresenceSharingSetting() {
  const t = useTranslations("presence");
  const settings = usePresenceSettings();
  const setShare = useSetPresenceShare();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{t("shareTitle")}</h2>
      <div className="flex items-center justify-between gap-4">
        <label
          htmlFor="presence-share"
          className="text-muted-foreground text-sm"
        >
          {t("shareLabel")}
        </label>
        <Switch
          id="presence-share"
          checked={settings?.share === true}
          disabled={settings === undefined}
          onCheckedChange={(checked) => void setShare(checked)}
        />
      </div>
    </section>
  );
}

/** Inline card above the inbox list, only while the member has never chosen. */
export function PresenceSharePrompt() {
  const t = useTranslations("presence");
  const settings = usePresenceSettings();
  const setShare = useSetPresenceShare();
  // Hidden as soon as either button is pressed; back if the save fails.
  const [answered, setAnswered] = useState(false);
  if (settings?.share !== null || answered) return null;

  const answer = (share: boolean) => {
    setAnswered(true);
    void setShare(share).then((saved) => {
      if (!saved) setAnswered(false);
    });
  };

  return (
    <div className="bg-card motion-safe:animate-in motion-safe:fade-in-0 m-2 flex flex-col gap-2 rounded-xl border p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Circle
          aria-hidden
          className="fill-jigsaw-success text-jigsaw-success size-3 shrink-0"
        />
        {t("promptTitle")}
      </p>
      <p className="text-muted-foreground text-xs">{t("promptBody")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="max-md:min-h-11"
          onClick={() => answer(true)}
        >
          {t("promptShare")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="max-md:min-h-11"
          onClick={() => answer(false)}
        >
          {t("promptNotNow")}
        </Button>
      </div>
    </div>
  );
}
