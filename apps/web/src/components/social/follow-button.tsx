"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { gateway, Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock, UserMinus, UserPlus } from "lucide-react";
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
export function FollowButton({
  memberId,
  size = "default",
  memberName,
}: {
  memberId: Id<"users">;
  size?: "default" | "sm";
  memberName?: string;
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
