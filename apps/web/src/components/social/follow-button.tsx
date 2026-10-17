"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { gateway, Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock, Loader2, UserMinus, UserPlus } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

const STALE_REQUEST_MS = 48 * 60 * 60 * 1000;

// Follow/unfollow/request toggle for a target member, driven by the composite
// followRelation read. Public target: Follow ⇄ Unfollow, as before. Private target:
// "Request to follow" → "Requested" (a dropdown offering Cancel request); after ~48h
// with no answer the label admits it ("hasn't responded yet"). The server decides
// instant-vs-request — this component only renders what the relation says.
// `memberName` (optional) personalises the stale-request label.
// `iconOnly` (opt-in, for compact cards) renders a square icon button with a tooltip
// and a name-qualified aria-label; without it the labelled button is unchanged.
export function FollowButton({
  memberId,
  size = "default",
  memberName,
  iconOnly = false,
}: {
  memberId: Id<"users">;
  size?: "default" | "sm";
  memberName?: string;
  iconOnly?: boolean;
}) {
  const t = useTranslations("follow");
  const { data: relation } = useQuery(
    convexQuery(gateway.social.followRelation, { memberId }),
  );
  // Calling Date.now() during render is an impure-render violation; capture it once
  // at mount (matches the codebase's existing `useState(() => Date.now())` idiom).
  const [now] = useState(() => Date.now());
  const follow = useMutation({
    mutationFn: useConvexMutation(gateway.social.follow),
  });
  const unfollow = useMutation({
    mutationFn: useConvexMutation(gateway.social.unfollow),
  });
  const cancelRequest = useMutation({
    mutationFn: useConvexMutation(gateway.social.cancelFollowRequest),
  });
  const pending =
    follow.isPending || unfollow.isPending || cancelRequest.isPending;

  if (relation === undefined) {
    if (iconOnly) {
      return (
        <Button
          variant="outline"
          size="icon"
          className={ICON_BUTTON_CLASS}
          disabled
          aria-label={
            memberName ? t("followName", { name: memberName }) : t("follow")
          }
        >
          <UserPlus aria-hidden="true" />
        </Button>
      );
    }
    return (
      <Button variant="outline" size={size} disabled>
        <UserPlus className="mr-2 h-4 w-4" />
        {t("follow")}
      </Button>
    );
  }

  const handleFollow = async () => {
    try {
      const result = await follow.mutateAsync({ followeeId: memberId });
      toast.success(
        result.kind === "requested"
          ? t("toastRequestSent")
          : t("toastFollowing"),
      );
    } catch {
      toast.error(t("errorUpdate"));
    }
  };

  const handleUnfollow = async () => {
    try {
      await unfollow.mutateAsync({ followeeId: memberId });
      toast.success(t("toastUnfollowed"));
    } catch {
      toast.error(t("errorUpdate"));
    }
  };

  const handleCancel = async () => {
    if (!relation.pendingRequest) return;
    try {
      await cancelRequest.mutateAsync({
        requestId: relation.pendingRequest.requestId,
      });
      toast.success(t("toastRequestCancelled"));
    } catch {
      toast.error(t("errorCancel"));
    }
  };

  if (relation.following) {
    if (iconOnly) {
      return withTooltip(
        <Button
          variant="outline"
          size="icon"
          className={ICON_BUTTON_CLASS}
          onClick={handleUnfollow}
          disabled={pending}
          aria-busy={pending || undefined}
          aria-label={
            memberName ? t("unfollowName", { name: memberName }) : t("unfollow")
          }
        >
          {pending ? <BusyIcon /> : <UserMinus aria-hidden="true" />}
        </Button>,
        t("unfollow"),
      );
    }
    return (
      <Button
        variant="outline"
        size={size}
        onClick={handleUnfollow}
        disabled={pending}
      >
        <UserMinus className="mr-2 h-4 w-4" />
        {t("unfollow")}
      </Button>
    );
  }

  if (relation.pendingRequest) {
    const stale = now - relation.pendingRequest.requestedAt > STALE_REQUEST_MS;
    const label = stale
      ? memberName
        ? t("requestedStale", { name: memberName })
        : t("requestedStaleNoName")
      : t("requested");
    if (iconOnly) {
      // The stale label already names the member; otherwise qualify "Requested".
      const ariaLabel = stale
        ? label
        : memberName
          ? t("requestedName", { name: memberName })
          : label;
      return (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className={ICON_BUTTON_CLASS}
                  disabled={pending}
                  aria-busy={pending || undefined}
                  aria-label={ariaLabel}
                >
                  {pending ? <BusyIcon /> : <Clock aria-hidden="true" />}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleCancel}>
              {t("cancelRequest")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size} disabled={pending}>
            <Clock className="mr-2 h-4 w-4" />
            {label}
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleCancel}>
            {t("cancelRequest")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const requestMode = relation.targetIsPrivate && !relation.followsYou;
  if (iconOnly) {
    const ariaLabel = memberName
      ? requestMode
        ? t("requestToFollowName", { name: memberName })
        : t("followName", { name: memberName })
      : requestMode
        ? t("requestToFollow")
        : t("follow");
    return withTooltip(
      <Button
        variant="default"
        size="icon"
        className={ICON_BUTTON_CLASS}
        onClick={handleFollow}
        disabled={pending}
        aria-busy={pending || undefined}
        aria-label={ariaLabel}
      >
        {pending ? <BusyIcon /> : <UserPlus aria-hidden="true" />}
      </Button>,
      requestMode ? t("requestToFollow") : t("follow"),
    );
  }
  return (
    <Button
      variant="default"
      size={size}
      onClick={handleFollow}
      disabled={pending}
    >
      <UserPlus className="mr-2 h-4 w-4" />
      {requestMode ? t("requestToFollow") : t("follow")}
    </Button>
  );
}

// Compact (iconOnly) mode: 36px, growing to a 44px target on touch screens.
const ICON_BUTTON_CLASS = "pointer-coarse:size-11";

function BusyIcon() {
  return (
    <Loader2
      className="animate-spin motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}

function withTooltip(trigger: ReactElement, label: string) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
