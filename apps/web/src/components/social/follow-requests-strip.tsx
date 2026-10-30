"use client";

// Pending incoming follow requests, shown as a strip ABOVE the network grid on the People
// page (Phase 4 moves the count onto a tab badge). Approve creates the edge; the second
// button also follows back in the same gesture (mutuality is what unlocks content for the
// requester). Decline is silent for the requester. Renders nothing when there are none.
import { convexErrorCode } from "@/components/exchange/request-trade";
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { gateway, Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type Requester = FunctionReturnType<
  typeof gateway.social.incomingFollowRequests
>[number]["requester"];

// A backend that predates the teaser view (the web deploys before Convex) still sends the
// requester as a MemberView: `_id` and `name` in place of `memberId` and `displayName`. Reading
// those only as a fallback keeps each row's link and name working until Convex catches up,
// instead of linking /members/undefined.
const withLegacyFallback = (
  requester: Requester & { _id?: string; name?: string },
): Requester => ({
  ...requester,
  memberId: requester.memberId ?? requester._id,
  displayName: requester.displayName ?? requester.name,
});

export function FollowRequestsStrip() {
  const t = useTranslations("people");
  const displayName = useMemberDisplayName();
  const { data } = useQuery(
    convexQuery(gateway.social.incomingFollowRequests, {}),
  );
  const requests = data?.map((request) => ({
    ...request,
    requester: withLegacyFallback(request.requester),
  }));
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
      } catch (error) {
        // The approval succeeded; only the follow-back failed. Softer message with a
        // recovery hint rather than a blanket error; the Follow button can't help while the
        // server's follow limit (RateLimited) is full, so that case says to wait.
        toast.warning(
          t(
            convexErrorCode(error) === "RateLimited"
              ? "requests.approvedFollowBackRateLimited"
              : "requests.approvedFollowBackFailed",
          ),
        );
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
          <UserPlus className="h-4 w-4 text-primary-text" />
          {/* A section of the page: the strip sits right under the page h1. */}
          <h2 className="font-medium">{t("requests.title")}</h2>
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
                      alt={displayName({ name: request.requester.displayName })}
                    />
                  )}
                  <AvatarFallback>
                    <MemberInitial
                      source={{ name: request.requester.displayName }}
                    />
                  </AvatarFallback>
                </Avatar>
                <Link
                  to="/members/$handle"
                  // Slug, else the id, never the username (SEC-07); the route redirects to the
                  // canonical handle.
                  params={{
                    handle:
                      request.requester.slug ?? request.requester.memberId,
                  }}
                  className="truncate font-medium hover:underline"
                >
                  {/* Teaser identity (SEC-11): displayName is resolved server-side; absent
                      renders the generic member label. */}
                  {displayName({ name: request.requester.displayName })}
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
