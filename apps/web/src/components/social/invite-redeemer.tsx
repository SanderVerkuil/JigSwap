import { QrDialogAutoOpen } from "@/components/social/qr-dialog";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

const INVITE_KEY = "jigswap.invite";
const LOOP_SHOWN_KEY = "jigswap.inviteLoopShown";
const FALLBACK_SHOWN_KEY = "jigswap.inviteFallbackShown";
const NEW_MEMBER_WINDOW_MS = 15 * 60 * 1000;

// Mounted once in the authed dashboard layout. Three jobs, all one-shot:
// 1. Redeem a localStorage invite token that survived the Clerk redirect (attribution).
// 2. Loop closure: after a successful redemption, offer the new member their OWN QR (skippable).
// 3. Fallback: brand-new member with NO token (cross-device scan, private mode) gets a one-time
//    "did someone invite you?" nudge toward people search.
export function InviteRedeemer() {
  const t = useTranslations("invite");
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  const [showLoopQr, setShowLoopQr] = useState(false);
  const ran = useRef(false);

  const { mutate: redeem } = useMutation({
    mutationFn: useConvexMutation(gateway.social.redeemInvite),
    onSuccess: (
      result: FunctionReturnType<typeof gateway.social.redeemInvite>,
    ) => {
      if (
        result.redeemed &&
        window.localStorage.getItem(LOOP_SHOWN_KEY) === null
      ) {
        window.localStorage.setItem(LOOP_SHOWN_KEY, "1");
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

    const token = window.localStorage.getItem(INVITE_KEY);
    if (token !== null) {
      window.localStorage.removeItem(INVITE_KEY);
      redeem({ token });
      return;
    }

    // Fallback nudge: only for members created in the last 15 minutes, once ever.
    const isNew = Date.now() - me.createdAt < NEW_MEMBER_WINDOW_MS;
    if (isNew && window.localStorage.getItem(FALLBACK_SHOWN_KEY) === null) {
      window.localStorage.setItem(FALLBACK_SHOWN_KEY, "1");
      toast(t("didSomeoneInviteTitle"), {
        description: t("didSomeoneInviteBody"),
        action: (
          // Phase 4 will deep-link this to /people?tab=find; plain /people for now.
          <Link to="/people" className="text-sm font-medium underline">
            {t("findThem")}
          </Link>
        ),
        duration: 15000,
      });
    }
  }, [me, redeem, t]);

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
