"use client";

// Shared "view community profile" affordance for the /admin/users table rows
// (compact icon button) and the /admin/users/$userId detail page. Links by the
// member's _id: handle resolution is id-first and the profile route redirects
// to the canonical slug/username URL. Deactivated members have no public
// profile (it 404s for everyone, admins included), so they get a disabled
// button with an explanation instead of a broken link.
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { useTranslations } from "use-intl";

export function CommunityProfileAction({
  userId,
  name,
  isActive,
  compact = false,
}: {
  userId: string;
  name: string;
  isActive: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("admin.users");
  const label = compact ? t("viewProfileName", { name }) : t("viewProfile");

  const content = (
    <>
      <UserRound aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </>
  );

  if (!isActive) {
    return (
      <Tooltip>
        {/* A disabled button swallows pointer events, so the span carries the
            tooltip trigger (and keyboard focus) instead. */}
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">
            <Button variant="outline" size={compact ? "icon" : "sm"} disabled>
              {content}
            </Button>
            <span className="sr-only">{t("profileUnavailable")}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("profileUnavailable")}</TooltipContent>
      </Tooltip>
    );
  }

  const link = (
    <Button variant="outline" size={compact ? "icon" : "sm"} asChild>
      <Link to="/members/$handle" params={{ handle: userId }}>
        {content}
      </Link>
    </Button>
  );

  if (!compact) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent>{t("viewProfile")}</TooltipContent>
    </Tooltip>
  );
}
