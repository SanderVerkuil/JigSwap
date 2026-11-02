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
  readAnalyticsConsent,
  writeAnalyticsConsent,
} from "@/lib/analytics-consent";
import { cn } from "@/lib/utils";
import { Cookie } from "lucide-react";
import * as React from "react";
import { useTranslations } from "use-intl";

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
    const [isOpen, setIsOpen] = React.useState(false);
    const [hide, setHide] = React.useState(false);

    // Use provided description or fall back to translation
    const consentDescription = description || t("description");

    const handleAccept = React.useCallback(() => {
      setIsOpen(false);
      writeAnalyticsConsent("granted");
      setTimeout(() => {
        setHide(true);
      }, 700);
      onAcceptCallback();
    }, [onAcceptCallback]);

    // Declines are persisted too, so analytics stays off on every future visit
    // and the banner doesn't nag again (the privacy policy promises declined
    // analytics is never loaded).
    const handleDecline = React.useCallback(() => {
      setIsOpen(false);
      writeAnalyticsConsent("denied");
      setTimeout(() => {
        setHide(true);
      }, 700);
      onDeclineCallback();
    }, [onDeclineCallback]);

    React.useEffect(() => {
      try {
        setIsOpen(true);
        if (readAnalyticsConsent(document.cookie) !== "unset" && !demo) {
          setIsOpen(false);
          setTimeout(() => {
            setHide(true);
          }, 700);
        }
      } catch (error) {
        console.warn("Cookie consent error:", error);
      }
    }, [demo]);

    if (hide) return null;

    const containerClasses = cn(
      "fixed z-50 transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
      !isOpen ? "translate-y-full opacity-0" : "translate-y-0 opacity-100",
      className,
    );

    const commonWrapperProps = {
      ref,
      className: cn(
        containerClasses,
        variant === "mini"
          ? "inset-x-0 bottom-0"
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
            className="bg-card text-card-foreground flex flex-col gap-2 px-4 py-2.5 shadow-lg sm:flex-row sm:items-center sm:gap-6 sm:px-6" // taste-skill-ignore: a real overlay.
          >
            <p className="max-w-[80ch] flex-1 text-base leading-snug">
              {consentDescription}
            </p>
            <div className="flex shrink-0 items-center justify-end gap-2">
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
