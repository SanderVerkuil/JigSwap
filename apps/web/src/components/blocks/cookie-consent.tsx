"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  closeCookieSettings,
  currentAnalyticsConsent,
  getCookieBannerSnapshot,
  grantAnalyticsConsent,
  subscribeConsent,
  withdrawAnalyticsConsent,
  type CookieBannerState,
} from "@/lib/analytics-consent";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Cookie, X } from "lucide-react";
import * as React from "react";
import { useTranslations } from "use-intl";

// Hidden in the server render and during hydration: whether to show depends on
// the visitor's consent cookie, which is only read on the client. A visitor
// who already chose never sees the banner flash.
const hiddenOnServer = (): CookieBannerState => "hidden";

// Define prop types
interface CookieConsentProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "small" | "mini";
  demo?: boolean;
  onAcceptCallback?: () => void;
  onDeclineCallback?: () => void;
  description?: string;
  learnMoreHref?: string;
}

const CookieConsent = React.forwardRef<HTMLDivElement, CookieConsentProps>(
  (
    {
      variant = "default",
      demo = false,
      onAcceptCallback = () => {},
      onDeclineCallback = () => {},
      className,
      description,
      learnMoreHref = "#",
      ...props
    },
    ref,
  ) => {
    const t = useTranslations("privacy.cookieConsent");
    // Shown while the visitor hasn't chosen, and again after "Cookie
    // settings" (openCookieSettings) asks for it; `demo` always shows it.
    const state = React.useSyncExternalStore(
      subscribeConsent,
      getCookieBannerSnapshot,
      hiddenOnServer,
    );
    const visible = demo || state !== "hidden";

    const regionRef = React.useRef<HTMLDivElement | null>(null);
    const openerRef = React.useRef<HTMLElement | null>(null);
    const setRegion = React.useCallback(
      (node: HTMLDivElement | null) => {
        regionRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    // Reopened from "Cookie settings": move focus onto the banner so keyboard
    // and screen-reader users land on the choice, and remember the control
    // that opened it so focus can go back there afterwards.
    React.useEffect(() => {
      if (state !== "settings") return;
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement ? active : null;
      regionRef.current?.focus();
    }, [state]);

    const returnFocus = React.useCallback(() => {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus();
    }, []);

    // Someone who already chose may reopen the banner just to check: it says
    // what the choice is, and they can leave without answering (the close
    // button or Escape). A visitor who hasn't chosen still has to answer.
    const choice = state === "settings" ? currentAnalyticsConsent() : "unset";
    const canClose = choice !== "unset";

    const handleClose = React.useCallback(() => {
      closeCookieSettings();
      returnFocus();
    }, [returnFocus]);

    // An Escape another layer already consumed (a dialog) is left alone.
    React.useEffect(() => {
      if (!canClose) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && !event.defaultPrevented) handleClose();
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [canClose, handleClose]);

    // Use provided description or fall back to translation, which links to
    // the cookie section of the privacy policy.
    const consentDescription =
      description ||
      t.rich("description", {
        link: (chunks) => (
          <Link
            to="/privacy"
            hash="p-cookies"
            className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
          >
            {chunks}
          </Link>
        ),
      });

    const handleAccept = () => {
      void grantAnalyticsConsent();
      returnFocus();
      onAcceptCallback();
    };

    // Declines are persisted too, so analytics stays off on every future visit
    // and the banner doesn't nag again (the privacy policy promises declined
    // analytics is never loaded). A decline is also a withdrawal: it stops a
    // PostHog already running in this page and clears what it stored.
    const handleDecline = () => {
      withdrawAnalyticsConsent();
      returnFocus();
      onDeclineCallback();
    };

    if (!visible) return null;

    const containerClasses = cn(
      "fixed z-50 outline-none animate-in fade-in slide-in-from-bottom-4 duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:animate-none",
      className,
    );

    const commonWrapperProps = {
      ref: setRegion,
      role: "region",
      "aria-label": t("title"),
      tabIndex: -1,
      className: cn(
        containerClasses,
        variant === "mini"
          ? // Inside the app on phones it sits above the bottom tab bar (its
            // published height: 57px, more in the installed app) and its raised
            // "+" (12px overhang), with an 8px gap.
            "inset-x-0 bottom-0 max-md:[body:has([data-mobile-tab-bar])_&]:bottom-[calc(var(--mobile-tab-bar-height,57px)+20px)]"
          : "bottom-0 left-0 right-0 sm:left-4 sm:bottom-4 w-full sm:max-w-md",
      ),
      ...props,
    };

    if (variant === "default") {
      return (
        <div {...commonWrapperProps}>
          <Card
            className="m-3 shadow-lg" // taste-skill-ignore: a real overlay.
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg">{t("title")}</CardTitle>
              <Cookie className="h-5 w-5" />
            </CardHeader>
            <CardContent className="space-y-2">
              <CardDescription className="text-sm">
                {consentDescription}
              </CardDescription>
              <p className="text-xs text-muted-foreground">
                {t("acceptanceText")}
              </p>
              <a
                href={learnMoreHref}
                className="text-xs text-primary-text underline underline-offset-4 hover:no-underline"
              >
                {t("learnMoreText")}
              </a>
            </CardContent>
            <CardFooter className="flex gap-2 pt-2">
              <Button
                onClick={handleDecline}
                variant="secondary"
                className="flex-1"
              >
                {t("declineText")}
              </Button>
              <Button onClick={handleAccept} className="flex-1">
                {t("acceptText")}
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    if (variant === "small") {
      return (
        <div {...commonWrapperProps}>
          <Card
            className="m-3 shadow-lg" // taste-skill-ignore: a real overlay.
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 h-0 px-4">
              <CardTitle className="text-base">{t("title")}</CardTitle>
              <Cookie className="h-4 w-4" />
            </CardHeader>
            <CardContent className="pt-0 pb-2 px-4">
              <CardDescription className="text-sm">
                {consentDescription}
              </CardDescription>
            </CardContent>
            <CardFooter className="flex gap-2 h-0 py-2 px-4">
              <Button
                onClick={handleDecline}
                variant="secondary"
                size="sm"
                className="flex-1 rounded-full"
              >
                {t("declineText")}
              </Button>
              <Button
                onClick={handleAccept}
                size="sm"
                className="flex-1 rounded-full"
              >
                {t("acceptText")}
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    if (variant === "mini") {
      return (
        <div {...commonWrapperProps}>
          <div
            className="bg-card text-card-foreground relative flex flex-col gap-2 px-4 py-2.5 shadow-lg sm:flex-row sm:items-center sm:gap-6 sm:px-6" // taste-skill-ignore: a real overlay.
          >
            <p
              className={cn(
                "max-w-[80ch] flex-1 text-base leading-snug",
                canClose && "max-sm:pr-8",
              )}
            >
              {consentDescription}
              {canClose && (
                <span className="mt-1 block font-medium text-foreground">
                  {t(choice === "granted" ? "currentGranted" : "currentDenied")}
                </span>
              )}
            </p>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
              <Button
                onClick={handleDecline}
                variant="secondary"
                className="max-sm:h-11 max-sm:flex-1"
              >
                {t("declineText")}
              </Button>
              <Button
                onClick={handleAccept}
                className="max-sm:h-11 max-sm:flex-1"
              >
                {t("acceptText")}
              </Button>
              {canClose && (
                // In the corner on phones, where the buttons fill the row.
                <Button
                  onClick={handleClose}
                  variant="ghost"
                  size="icon"
                  aria-label={t("closeSettings")}
                  className="size-10 max-sm:absolute max-sm:top-1 max-sm:right-1"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return null;
  },
);

CookieConsent.displayName = "CookieConsent";
export { CookieConsent };
export default CookieConsent;
