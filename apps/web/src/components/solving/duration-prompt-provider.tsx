"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUserSettings } from "@/hooks/use-user-settings";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

interface DurationPromptApi {
  // Open the first-time prompt (no-op if the member already chose). Call after a solve is logged.
  requestPrompt: () => void;
}

const DurationPromptContext = createContext<DurationPromptApi | null>(null);

// Mounted once in the dashboard shell so the prompt survives any solve dialog unmounting. It opens
// as a separate modal *after* the log dialog closes, and can show a GIF pointing at the Settings
// toggle.
export function DurationPromptProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("solving.durationPrompt");
  const { trackCompletionDuration, setTrackDuration } = useUserSettings();
  const [open, setOpen] = useState(false);

  const requestPrompt = () => {
    if (trackCompletionDuration === undefined) setOpen(true);
  };

  const choose = async (enabled: boolean) => {
    await setTrackDuration(enabled);
    setOpen(false);
  };

  return (
    <DurationPromptContext.Provider value={{ requestPrompt }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          {/* Placeholder slot until the real screencast is dropped in at this path: a 1×1
              placeholder GIF would otherwise stretch, so constrain + contain it. */}
          <img
            src="/help/track-duration-setting.gif"
            alt={t("imageAlt")}
            className="bg-muted max-h-48 w-full rounded-md border object-contain"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => void choose(false)}>
              {t("no")}
            </Button>
            <Button onClick={() => void choose(true)}>{t("yes")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DurationPromptContext.Provider>
  );
}

// Solve dialogs call requestPrompt() after a first-time save. Safe no-op outside the provider.
export function useDurationPrompt(): DurationPromptApi {
  return useContext(DurationPromptContext) ?? { requestPrompt: () => {} };
}
