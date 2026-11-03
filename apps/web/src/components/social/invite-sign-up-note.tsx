import { gateway, type Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { inviteHrefTarget } from "./invite-landing";

// What sign-up does with the invite link the visitor came through, above the sign-up card: the
// promise has to match what redeeming it does (social/redeemInvite), not what the locked page looks
// like. Quiet unless the server says the token is live for that member (social.inviteContext), so a
// dead link or a hand-made redirect_url can't put a name here.
export function InviteSignUpNote({ redirectUrl }: { redirectUrl: unknown }) {
  const target = inviteHrefTarget(redirectUrl);
  return target ? <LiveInviteNote {...target} /> : null;
}

function LiveInviteNote({ handle, token }: { handle: string; token: string }) {
  const t = useTranslations("invite");
  const displayName = useMemberDisplayName();
  const { data: profile } = useQuery(
    convexQuery(gateway.social.publicProfile, { handle }),
  );
  const memberId = profile?.hero.memberId;
  const { data: context } = useQuery({
    ...convexQuery(gateway.social.inviteContext, {
      token,
      memberId: (memberId ?? "") as Id<"users">,
    }),
    enabled: memberId !== undefined,
  });
  if (!profile || !context?.valid) return null;
  const name = displayName({ name: profile.hero.displayName });
  const household = context.kind === "household";
  return (
    <div className="mb-4 flex flex-col gap-1 text-center text-sm">
      <p className="font-medium">
        {t(household ? "householdInvitedYou" : "invitedYou", { name })}
      </p>
      <p className="text-muted-foreground">
        {t(household ? "householdExplainer" : "signUpExplainer")}
      </p>
    </div>
  );
}
