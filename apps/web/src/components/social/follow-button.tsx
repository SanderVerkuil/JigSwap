"use client";

import { convexErrorCode } from "@/components/exchange/request-trade";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  ChevronDown,
  Clock,
  Loader2,
  UserCheck,
  UserMinus,
  UserPlus,
} from "lucide-react";
import type { ReactElement } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

const STALE_REQUEST_MS = 48 * 60 * 60 * 1000;

// Follow/unfollow/request toggle for a target member, driven by the composite
// followRelation read. Not following: Follow, or "Request to follow" for a private
// target. Following: a "Following" menu whose only item is "Unfollow {name}" — never
// a one-tap destructive button. Unfollowing toasts with an Undo that follows again,
// except for a private target who doesn't follow back: there following again means a
// new request, so the unfollow is confirmed first and offers no Undo. A pending
// request is "Requested" (a dropdown offering Cancel request); after ~48h with no
// answer the label admits it ("hasn't responded yet"). The server decides
// instant-vs-request — this component only renders what the relation says.
// `memberName` (the resolved display name) qualifies labels, the toasts and the confirm.
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
  memberName: string;
  iconOnly?: boolean;
}) {
  const t = useTranslations("follow");
  const tCommon = useTranslations("common");
  const { data: relation } = useQuery(
    convexQuery(gateway.social.followRelation, { memberId }),
  );
  // Calling Date.now() during render is an impure-render violation; capture it once
  // at mount (matches the codebase's existing `useState(() => Date.now())` idiom).
  const [now] = useState(() => Date.now());
  const [confirmingUnfollow, setConfirmingUnfollow] = useState(false);
  const followingTriggerRef = useRef<HTMLButtonElement>(null);
  // The raw Convex function (not only the react-query observer below): the Undo in the
  // unfollow toast can fire after this button unmounted (the network list drops a tile
  // you no longer follow when they don't follow you).
  const followMember = useConvexMutation(gateway.social.follow);
  const follow = useMutation({ mutationFn: followMember });
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
          aria-label={t("followName", { name: memberName })}
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

  // The server rate limits follow, unfollow and cancel (RateLimited); anything else is generic.
  const refusal = (error: unknown, fallback: string) =>
    convexErrorCode(error) === "RateLimited" ? t("errorRateLimited") : fallback;

  const handleFollow = async () => {
    try {
      const result = await follow.mutateAsync({ followeeId: memberId });
      toast.success(
        result.kind === "requested"
          ? t("toastRequestSent")
          : t("toastFollowing"),
      );
    } catch (error) {
      toast.error(refusal(error, t("errorUpdate")));
    }
  };

  const undoUnfollow = async () => {
    try {
      const result = await followMember({ followeeId: memberId });
      toast.success(
        result.kind === "requested"
          ? t("toastRequestSent")
          : t("toastFollowing"),
      );
    } catch (error) {
      toast.error(refusal(error, t("undoError", { name: memberName })));
    }
  };

  // `offerUndo` is false when following again would only send a request.
  const handleUnfollow = async (offerUndo: boolean) => {
    try {
      await unfollow.mutateAsync({ followeeId: memberId });
      toast.success(
        t("toastUnfollowed", { name: memberName }),
        offerUndo
          ? { action: { label: t("undo"), onClick: () => void undoUnfollow() } }
          : undefined,
      );
    } catch (error) {
      toast.error(refusal(error, t("errorUpdate")));
    }
  };

  const handleCancel = async () => {
    if (!relation.pendingRequest) return;
    try {
      await cancelRequest.mutateAsync({
        requestId: relation.pendingRequest.requestId,
      });
      toast.success(t("toastRequestCancelled"));
    } catch (error) {
      toast.error(refusal(error, t("errorCancel")));
    }
  };

  if (relation.following) {
    // Following again would be a new request the member must approve: confirm first.
    const confirmFirst = relation.targetIsPrivate && !relation.followsYou;
    const trigger = iconOnly ? (
      <Button
        ref={followingTriggerRef}
        variant="outline"
        size="icon"
        className={ICON_BUTTON_CLASS}
        disabled={pending}
        aria-busy={pending || undefined}
        aria-label={t("followingName", { name: memberName })}
      >
        {pending ? <BusyIcon /> : <UserCheck aria-hidden="true" />}
      </Button>
    ) : (
      <Button
        ref={followingTriggerRef}
        variant="outline"
        size={size}
        disabled={pending}
      >
        <UserCheck className="mr-2 h-4 w-4" />
        {t("following")}
        <ChevronDown className="ml-2 h-4 w-4" />
      </Button>
    );
    return (
      <>
        <DropdownMenu>
          {iconOnly ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("following")}</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          )}
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="min-h-11 md:min-h-0"
              onSelect={() =>
                confirmFirst
                  ? setConfirmingUnfollow(true)
                  : void handleUnfollow(true)
              }
            >
              <UserMinus aria-hidden="true" />
              {t("unfollowName", { name: memberName })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {confirmFirst && (
          <AlertDialog
            open={confirmingUnfollow}
            onOpenChange={setConfirmingUnfollow}
          >
            <AlertDialogContent
              onCloseAutoFocus={(event) => {
                // The menu item that opened the dialog is gone: return focus to the trigger.
                const target = followingTriggerRef.current;
                if (!target?.isConnected) return;
                event.preventDefault();
                target.focus();
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("unfollowConfirmTitle", { name: memberName })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("unfollowConfirmBody", { name: memberName })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-11 md:h-9">
                  {tCommon("cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  className="h-11 md:h-9"
                  onClick={() => void handleUnfollow(false)}
                >
                  {t("unfollow")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  }

  if (relation.pendingRequest) {
    const stale = now - relation.pendingRequest.requestedAt > STALE_REQUEST_MS;
    const label = stale
      ? t("requestedStale", { name: memberName })
      : t("requested");
    if (iconOnly) {
      // The stale label already names the member; otherwise qualify "Requested".
      const ariaLabel = stale
        ? label
        : t("requestedName", { name: memberName });
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
    const ariaLabel = requestMode
      ? t("requestToFollowName", { name: memberName })
      : t("followName", { name: memberName });
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
