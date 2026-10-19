import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// The viewer's own open request to join a household, on /household (above Create when they're
// in none, above the tabs when they're in one): "You asked <name> to let you into their
// household", waiting, with Withdraw. A declined request keeps reading as waiting until it
// lapses (decline is silent), exactly like one the admin hasn't seen yet.
export function MyJoinRequestCard({
  onError,
}: {
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("invite");
  const displayName = useMemberDisplayName();
  const { data: request } = useQuery(
    convexQuery(gateway.household.myJoinRequest, {}),
  );
  const withdraw = useMutation({
    mutationFn: useConvexMutation(gateway.household.withdrawJoinRequest),
    onSuccess: () => toast.success(t("householdAskWithdrawn")),
    onError,
  });
  if (!request) return null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar className="h-9 w-9">
          <AvatarImage src={request.inviter.avatar} alt="" />
          <AvatarFallback>
            <MemberInitial source={request.inviter} />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-medium">
            {t("householdAskPendingTitle", {
              name: displayName(request.inviter),
            })}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("householdAskPendingBody")}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 pointer-coarse:min-h-11"
        disabled={withdraw.isPending}
        onClick={() => withdraw.mutate({ requestId: request.requestId })}
      >
        {t("householdAskWithdraw")}
      </Button>
    </section>
  );
}
