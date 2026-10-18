"use client";

// What sits in the composer's slot when the viewer can't reply (spec 2.6). The
// blocker sees "You blocked {name}." with Unblock; everyone else (a readOnly
// thread, or a send refused with CannotReply / NotConnected) sees the neutral
// "You can't reply to this conversation.", which never mentions a block. Same
// border and height as the composer so the thread doesn't jump.
import { BlockMemberDialog } from "@/components/social/block-member-dialog";
import { Button } from "@/components/ui/button";
import type { Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import type { MemberView } from "@jigswap/contracts";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";

export function ComposerClosed({
  reason,
  partner,
}: {
  reason: "blockedByMe" | "cantReply";
  /** The other participant, when the viewer may know who they are. */
  partner?: MemberView | null;
}) {
  return (
    <div className="border-t pt-3">
      <div
        role="status"
        className="text-muted-foreground flex min-h-11 items-center justify-between gap-3 text-sm md:min-h-9"
      >
        {reason === "blockedByMe" ? (
          <BlockedByMe partner={partner ?? null} />
        ) : (
          <CantReply />
        )}
      </div>
    </div>
  );
}

function CantReply() {
  const t = useTranslations("safety");
  return <p>{t("cantReply")}</p>;
}

function BlockedByMe({ partner }: { partner: MemberView | null }) {
  const t = useTranslations("safety");
  const displayName = useMemberDisplayName();
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // No partner to name (anonymised to the viewer): say so without a name; the
  // "Privacy & safety" settings list still offers Unblock.
  if (!partner) return <p>{t("blockedBannerUnnamed")}</p>;

  const name = displayName(partner);
  return (
    <>
      <p className="min-w-0">{t("blockedBanner", { name })}</p>
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        className="h-11 shrink-0 md:h-8"
        onClick={() => setConfirming(true)}
      >
        {t("unblock")}
      </Button>
      <BlockMemberDialog
        mode="unblock"
        memberId={partner._id as Id<"users">}
        name={name}
        open={confirming}
        onOpenChange={setConfirming}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
