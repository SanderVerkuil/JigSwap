import { PersonRow } from "@/components/household/person-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { gateway, Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// "Invite a member" for the household admin: search existing members and send a household
// invite. Used on the household page and in the quick start's household step.
export function HouseholdMemberInvite({
  excludedIds,
  onError,
}: {
  // Members and pending invitees: never offered again.
  excludedIds: ReadonlySet<string>;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("household");
  const displayName = useMemberDisplayName();
  const [search, setSearch] = useState("");

  const { data: searchResults } = useQuery(
    convexQuery(
      gateway.identity.search,
      search.trim().length >= 2 ? { searchTerm: search.trim() } : "skip",
    ),
  );

  const invite = useMutation({
    mutationFn: useConvexMutation(gateway.household.invite),
    onSuccess: () => {
      setSearch("");
      toast.success(t("invite.sent"));
    },
    onError,
  });

  const candidates = (searchResults ?? []).filter(
    (result) => !excludedIds.has(result._id as string),
  );

  return (
    <>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("invite.searchPlaceholder")}
        aria-label={t("invite.searchPlaceholder")}
        className="max-w-md"
        data-tour="household-invite"
      />
      {candidates.length > 0 && (
        <div className="divide-y rounded-lg border px-4">
          {candidates.map((result) => (
            <PersonRow
              key={result._id}
              person={{
                memberId: result._id as string,
                name: displayName(result),
                avatar: result.avatar,
              }}
            >
              <Button
                size="sm"
                variant="outline"
                disabled={invite.isPending}
                onClick={() =>
                  invite.mutate({ inviteeId: result._id as Id<"users"> })
                }
              >
                <UserPlus className="h-4 w-4" />
                {t("invite.action")}
              </Button>
            </PersonRow>
          ))}
        </div>
      )}
    </>
  );
}
