import { inviteExtrasSuppressed } from "@/components/quick-start/logic";
import {
  INVITE_KEY,
  NEW_MEMBER_WINDOW_MS,
} from "@/components/social/invite-landing";
import { QrDialogAutoOpen } from "@/components/social/qr-dialog";
import { gateway } from "@/gateway";
import { safeStorage } from "@/lib/safe-storage";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

const LOOP_SHOWN_KEY = "jigswap.inviteLoopShown";
const FALLBACK_SHOWN_KEY = "jigswap.inviteFallbackShown";

// Mounted once in the authed dashboard layout. Three jobs, all one-shot:
// 1. Redeem a localStorage invite token that survived the Clerk redirect (attribution). Redeeming
//    follows nobody: it leaves a connection offer from the inviter (`connection: "pending"`), which
//    the new member answers on the dashboard / People page (ConnectionOffersStrip).
// 2. Loop closure: after a successful redemption, offer the new member their OWN QR (skippable).
//    A household link instead leaves a pending household invite: open the quick start household
//    step (/welcome?step=household) to accept it.
// 3. Fallback: brand-new member with NO token (cross-device scan, private mode) gets a one-time
//    "did someone invite you?" nudge toward people search.
// While the member qualifies for the quick start (D7), it still redeems but skips the loop QR and
// the nudge: the quick start's people step offers both, and two dialogs would compete.
export function InviteRedeemer() {
  const t = useTranslations("invite");
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  const { data: quickStart } = useQuery(
    convexQuery(gateway.onboarding.quickStart, me ? {} : "skip"),
  );
  const suppressed = inviteExtrasSuppressed(quickStart);
  const [showLoopQr, setShowLoopQr] = useState(false);
  const ran = useRef(false);
  const hadToken = useRef(false);
  const nudged = useRef(false);
  const navigate = useNavigate();

  const { mutate: redeem } = useMutation({
    mutationFn: useConvexMutation(gateway.social.redeemInvite),
    // A transient failure must not lose attribution: restore the token so the
    // next page load retries (redeemInvite itself is idempotent server-side).
    onError: (_error, variables: { token: string }) => {
      safeStorage.setItem("local", INVITE_KEY, variables.token);
    },
    onSuccess: (
      result: FunctionReturnType<typeof gateway.social.redeemInvite>,
    ) => {
      // The pending invite waits in the quick start's household step; the invitee decides there.
      if (result.householdInvite === "pending") {
        void navigate({ to: "/welcome", search: { step: "household" } });
        return;
      }
      if (
        result.redeemed &&
        // Only once the quick start state says it isn't covering this (unknown = skip).
        suppressed === false &&
        safeStorage.getItem("local", LOOP_SHOWN_KEY) === null
      ) {
        safeStorage.setItem("local", LOOP_SHOWN_KEY, "1");
        setShowLoopQr(true);
      }
    },
  });

  useEffect(() => {
    // Wait for `me` to resolve to a real row before latching `ran`: `me` is
    // undefined while loading and null during the post-signup provisioning race
    // (Clerk session exists, users row not written yet). `!me` short-circuits both
    // so the redeemer fires exactly once, after the account exists — never fire-and-fail.
    if (!me || ran.current) return;
    ran.current = true;

    const token = safeStorage.getItem("local", INVITE_KEY);
    if (token !== null) {
      hadToken.current = true;
      safeStorage.removeItem("local", INVITE_KEY);
      redeem({ token });
    }
  }, [me, redeem]);

  useEffect(() => {
    // The nudge waits for the quick start state (redemption above never does), once per mount.
    if (!me || hadToken.current || nudged.current || suppressed === undefined) {
      return;
    }
    nudged.current = true;
    if (suppressed) return;

    // Fallback nudge: only for members created in the last 15 minutes, once ever.
    const isNew = Date.now() - me.createdAt < NEW_MEMBER_WINDOW_MS;
    if (isNew && safeStorage.getItem("local", FALLBACK_SHOWN_KEY) === null) {
      safeStorage.setItem("local", FALLBACK_SHOWN_KEY, "1");
      toast(t("didSomeoneInviteTitle"), {
        description: t("didSomeoneInviteBody"),
        action: (
          <Link
            to="/people"
            search={{ tab: "find" }}
            className="text-sm font-medium underline"
          >
            {t("findThem")}
          </Link>
        ),
        duration: 15000,
      });
    }
  }, [me, suppressed, t]);

  if (!me || !showLoopQr) return null;

  // Loop closure: the new member's own QR, shown once, skippable (Dialog close = skip).
  return (
    <QrDialogAutoOpen
      memberId={me._id}
      displayName={me.name}
      username={me.username}
      avatarUrl={me.avatar}
      title={t("loopTitle")}
      body={t("loopBody")}
      onClose={() => setShowLoopQr(false)}
    />
  );
}
