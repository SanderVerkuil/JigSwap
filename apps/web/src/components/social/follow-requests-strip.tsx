"use client";

// Pending incoming follow requests, shown as a strip ABOVE the network grid on the People
// page (Phase 4 moves the count onto a tab badge). Approve creates the edge; the second
// button also follows back in the same gesture (mutuality is what unlocks content for the
// requester). Decline is silent for the requester. Renders nothing when there are none.

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { gateway, Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export function FollowRequestsStrip() {
  const t = useTranslations("people");
  const { data: requests } = useQuery(
    convexQuery(gateway.social.incomingFollowRequests, {}),
  );
  const approve = useMutation({
    mutationFn: useConvexMutation(gateway.social.approveFollowRequest),
  });
  const decline = useMutation({
    mutationFn: useConvexMutation(gateway.social.declineFollowRequest),
  });
  const followBack = useMutation({
    mutationFn: useConvexMutation(gateway.social.follow),
  });
  const busy = approve.isPending || decline.isPending || followBack.isPending;

  if (!requests || requests.length === 0) return null;

  // Approve and follow-back are two mutations with independent outcomes: once the approve
  // has committed, a follow-back failure must not be reported as a total failure (the
  // approval stuck). Each gets its own try/catch and its own toast.
  const handleApprove = async (requestId: string, alsoFollowBack: boolean) => {
    let result;
    try {
      result = await approve.mutateAsync({ requestId });
    } catch {
      toast.error(t("requests.error"));
      return;
    }
    if (alsoFollowBack && !result.alreadyFollowsBack) {
      try {
        await followBack.mutateAsync({
          followeeId: result.requesterId as Id<"users">,
        });
      } catch {
        // The approval succeeded; only the follow-back failed. Softer message with a
        // recovery hint rather than a blanket error.
        toast.warning(t("requests.approvedFollowBackFailed"));
        return;
      }
    }
    toast.success(t("requests.approved"));
  };

  const handleDecline = async (requestId: string) => {
    try {
      await decline.mutateAsync({ requestId });
      toast.success(t("requests.declined"));
    } catch {
      toast.error(t("requests.error"));
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" />
          <span className="font-medium">{t("requests.title")}</span>
          <span className="text-muted-foreground text-sm">
            {t("requests.subtitle", { count: requests.length })}
          </span>
        </div>
        <ul className="space-y-2">
          {requests.map((request) => (
            <li
              key={request.requestId}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar className="size-9 shrink-0">
                  {request.requester.avatar && (
                    <AvatarImage
                      src={request.requester.avatar}
                      alt={request.requester.name}
                    />
                  )}
                  <AvatarFallback>
                    {request.requester.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <Link
                  to="/members/$handle"
                  params={{
                    handle: request.requester.username ?? request.requester._id,
                  }}
                  className="truncate font-medium hover:underline"
                >
                  {request.requester.name}
                </Link>
              </div>
              <span className="flex gap-2">
                {!request.alreadyFollowing && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => handleApprove(request.requestId, true)}
                  >
                    {t("requests.approveAndFollowBack")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleApprove(request.requestId, false)}
                >
                  {t("requests.approve")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => handleDecline(request.requestId)}
                >
                  {t("requests.decline")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
