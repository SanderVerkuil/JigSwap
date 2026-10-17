"use client";

import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { FindPeople } from "@/components/social/find-people";
import { inviteLandingUrl } from "@/components/social/invite-share";
import { InviteShareActions } from "@/components/social/invite-share-actions";
import { MemberTile } from "@/components/social/member-tile";
import { Button } from "@/components/ui/button";
import { gateway, type Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import type { QuickStartStepStatus } from "@jigswap/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { PushPrompt } from "./push-prompt";

// Step 3, Find people (spec §2.4): people you may know (only from existing ties: followers I
// don't follow back and household members), the reused FindPeople search, and the member's own
// invite link through the share sheet. The push offer follows the first follow or share here.
export function PeopleStep({ status }: { status: QuickStartStepStatus }) {
  const t = useTranslations("quickStart.people");
  const { member } = useCurrentMember();
  const suggestions = useSuggestions();
  const [shared, setShared] = useState(false);
  // A follow made here turns the step done; one that was done on arrival doesn't count.
  const [doneOnArrival] = useState(status === "done");
  const triggered = shared || (!doneOnArrival && status === "done");

  return (
    <div className="flex flex-col gap-8">
      {suggestions.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="font-heading text-lg font-semibold">
            {t("suggested")}
          </h3>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {suggestions.map((s) => (
              <MemberTile
                key={s.memberId}
                memberId={s.memberId as Id<"users">}
                followsYou={s.followsYou}
                hideLocation
              />
            ))}
          </div>
        </section>
      )}

      <FindPeople />

      <section className="flex flex-col gap-3">
        <h3 className="font-heading text-lg font-semibold">
          {t("inviteTitle")}
        </h3>
        <p className="text-muted-foreground text-sm">{t("inviteBody")}</p>
        {member ? (
          member.username == null ? (
            <NeedUsername />
          ) : (
            <NetworkInvite
              memberId={member._id}
              onShared={() => setShared(true)}
            />
          )
        ) : null}
        <PushPrompt triggered={triggered} />
      </section>
    </div>
  );
}

// Followers I don't follow back, then household members I don't follow; never myself.
function useSuggestions(): { memberId: string; followsYou: boolean }[] {
  const { member } = useCurrentMember();
  const enabled = member ? {} : "skip";
  const { data: following } = useQuery(
    convexQuery(gateway.social.following, enabled),
  );
  const { data: followers } = useQuery(
    convexQuery(gateway.social.followers, enabled),
  );
  const { data: household } = useQuery(
    convexQuery(gateway.household.mine, enabled),
  );
  if (!member || following === undefined || followers === undefined) {
    return [];
  }
  const followed = new Set(following.map((e) => e.memberId as string));
  const seen = new Set<string>([member._id, ...followed]);
  const out: { memberId: string; followsYou: boolean }[] = [];
  for (const edge of followers) {
    const id = edge.memberId as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ memberId: id, followsYou: true });
  }
  for (const m of household?.members ?? []) {
    if (seen.has(m.memberId)) continue;
    seen.add(m.memberId);
    out.push({ memberId: m.memberId, followsYou: false });
  }
  return out;
}

function NetworkInvite({
  memberId,
  onShared,
}: {
  memberId: string;
  onShared: () => void;
}) {
  // getMyInviteLink is a mutation: it mints the link on first use.
  const { mutate: fetchLink, data: link } = useMutation({
    mutationFn: useConvexMutation(gateway.social.myInviteLink),
  });
  useEffect(() => {
    fetchLink({});
  }, [fetchLink]);
  // Only set after a client-side mutation, so `window` is defined here.
  const url = link
    ? inviteLandingUrl(window.location.origin, memberId, link.token)
    : null;
  return <InviteShareActions url={url} kind="network" onShared={onShared} />;
}

// The existing QR dialog's "Set a username first" state: the link needs a username.
function NeedUsername() {
  const t = useTranslations("invite");
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border p-4">
      <p className="font-medium">{t("needUsernameTitle")}</p>
      <p className="text-muted-foreground text-sm">{t("needUsernameBody")}</p>
      <Button asChild variant="outline" className="pointer-coarse:min-h-11">
        <Link to="/profile">{t("openSettings")}</Link>
      </Button>
    </div>
  );
}
