"use client";

// Confirm-first invite links: the person who invited a new member offers to follow each other,
// and nothing is followed until the new member picks "Follow each other". "Not now" dismisses it
// silently (the inviter is never told). Shown where a new member lands (the dashboard home and the
// quick start's people step) and in the People page's requests area. Renders nothing when there
// are no open offers.
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import type { ConnectionOfferView } from "@jigswap/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export function ConnectionOffersStrip() {
  const t = useTranslations("people.connectionOffers");
  const displayName = useMemberDisplayName();
  const { data: offers } = useQuery(
    convexQuery(gateway.social.connectionOffers, {}),
  );
  const accept = useMutation({
    mutationFn: useConvexMutation(gateway.social.acceptConnection),
  });
  const decline = useMutation({
    mutationFn: useConvexMutation(gateway.social.declineConnection),
  });

  if (!offers || offers.length === 0) return null;

  const nameOf = (offer: ConnectionOfferView) =>
    displayName(offer.from.anonymous ? null : offer.from.member);

  const handleAccept = async (offer: ConnectionOfferView) => {
    try {
      const { connected } = await accept.mutateAsync({
        offerId: offer.offerId,
      });
      if (connected) {
        toast.success(t("connected", { name: nameOf(offer) }));
      } else {
        toast.error(t("notConnected"));
      }
    } catch {
      toast.error(t("error"));
    }
  };

  const handleDecline = async (offer: ConnectionOfferView) => {
    try {
      await decline.mutateAsync({ offerId: offer.offerId });
    } catch {
      toast.error(t("error"));
    }
  };

  return (
    <ConnectionOfferList
      offers={offers}
      busy={accept.isPending || decline.isPending}
      onAccept={handleAccept}
      onDecline={handleDecline}
    />
  );
}

// Presentational: one row per offer, the inviter named, with the two answers.
export function ConnectionOfferList({
  offers,
  busy,
  onAccept,
  onDecline,
}: {
  offers: readonly ConnectionOfferView[];
  busy: boolean;
  onAccept: (offer: ConnectionOfferView) => void;
  onDecline: (offer: ConnectionOfferView) => void;
}) {
  const t = useTranslations("people.connectionOffers");
  const displayName = useMemberDisplayName();

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary-text" />
          <span className="font-medium">{t("title")}</span>
        </div>
        <ul className="space-y-3">
          {offers.map((offer) => {
            const member = offer.from.anonymous ? null : offer.from.member;
            const name = displayName(member);
            return (
              <li
                key={offer.offerId}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar className="size-9 shrink-0">
                    {member?.avatar && (
                      <AvatarImage src={member.avatar} alt={name} />
                    )}
                    <AvatarFallback>
                      <MemberInitial source={member} />
                    </AvatarFallback>
                  </Avatar>
                  <p className="min-w-0 text-sm">
                    {t.rich("invitedYou", {
                      name,
                      b: (chunks) => (
                        <strong className="font-medium">{chunks}</strong>
                      ),
                    })}
                  </p>
                </div>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => onAccept(offer)}
                  >
                    {t("followEachOther")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onDecline(offer)}
                  >
                    {t("notNow")}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
