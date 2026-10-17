"use client";

import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useReportSurfaceBusy } from "@/components/whats-new/surface-busy";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Puzzle } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { welcomeSurfaceBusy } from "./logic";
import { PRIMARY_LOOK } from "./parts";

// The one-time welcome dialog (spec §2.1, §5.1), mounted on /dashboard only. It wins the
// surface-busy priority over the What's new highlight: it reports busy while the member and the
// onboarding query load, not just while open, because the highlight checks once after its 600 ms
// timer. Every close is final (dismissWelcome); "Start quick setup" also opens /welcome. Nothing
// redirects on its own.
export function WelcomeDialog() {
  const { member, isMemberLoading } = useCurrentMember();
  const { data: view } = useQuery(
    convexQuery(gateway.onboarding.quickStart, member ? {} : "skip"),
  );
  const [closed, setClosed] = useState(false);
  const record = useConvexMutation(gateway.onboarding.recordQuickStart);

  const busy =
    !closed &&
    welcomeSurfaceBusy({
      memberLoading: isMemberLoading,
      hasMember: !!member,
      view,
    });
  useReportSurfaceBusy("quickstart-welcome", busy);

  const close = () => {
    if (closed) return;
    setClosed(true);
    record({ kind: "dismissWelcome" }).catch((error: unknown) =>
      console.error("Failed to dismiss the welcome:", error),
    );
  };

  return (
    <Dialog
      open={!closed && view?.showWelcome === true}
      onOpenChange={(open) => !open && close()}
    >
      <WelcomeDialogContent onClose={close} />
    </Dialog>
  );
}

function WelcomeDialogContent({ onClose }: { onClose: () => void }) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <DialogContent
      ref={contentRef}
      className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 motion-reduce:animate-none sm:max-w-md"
      onOpenAutoFocus={(event) => {
        // Focus the primary action, not the close X Radix would pick first.
        event.preventDefault();
        contentRef.current
          ?.querySelector<HTMLElement>("[data-quickstart-primary]")
          ?.focus();
      }}
    >
      <WelcomeDialogBody onClose={onClose} />
    </DialogContent>
  );
}

/** The dialog's body (header band, copy, footer); rendered inside a Dialog root. */
export function WelcomeDialogBody({ onClose }: { onClose: () => void }) {
  const t = useTranslations("quickStart.welcome");
  const fullWidth = "w-full sm:w-auto";
  const lines = [t("stepPuzzles"), t("stepSolves"), t("stepPeople")];
  return (
    <>
      <div
        aria-hidden
        className="bg-jigsaw-primary-tint flex h-28 items-center justify-center"
      >
        <span className="bg-card text-jigsaw-primary flex size-14 items-center justify-center rounded-2xl shadow-sm">
          <Puzzle className="size-7" />
        </span>
      </div>
      <div className="flex flex-col gap-2 p-6 pt-5">
        <DialogTitle className="font-heading text-left text-2xl leading-tight font-semibold">
          {t("title")}
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-left">
          {t("body")}
        </DialogDescription>
        {/* role="list" keeps the list semantics Safari drops under list-none. */}
        <ol role="list" className="mt-2 flex flex-col gap-2">
          {lines.map((line, i) => (
            <li key={line} className="flex items-center gap-3 text-sm">
              <span
                aria-hidden
                className="border-border flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold"
              >
                {i + 1}
              </span>
              {line}
            </li>
          ))}
        </ol>
        <p className="text-muted-foreground mt-1 text-sm">{t("time")}</p>
      </div>
      {/* flex-col-reverse on mobile: the primary ends up on top. */}
      <DialogFooter className="bg-muted/40 border-t px-6 py-4">
        <Button
          variant="ghost"
          className={cn(fullWidth, "pointer-coarse:min-h-11")}
          onClick={onClose}
        >
          {t("explore")}
        </Button>
        <Button
          asChild
          data-quickstart-primary
          className={cn(fullWidth, PRIMARY_LOOK)}
        >
          <Link to="/welcome" onClick={onClose}>
            {t("start")}
          </Link>
        </Button>
      </DialogFooter>
    </>
  );
}
