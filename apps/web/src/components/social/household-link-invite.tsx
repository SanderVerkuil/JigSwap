import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Home } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export type HouseholdLinkState = FunctionReturnType<
  typeof gateway.social.householdLinkInvite
>["state"];

// The signed-in landing for an EXISTING member on a household invite link: "<inviter> invited you
// to their household" with Accept / Decline, or why they can't join. Every state comes from
// social.getHouseholdLinkInvite; the server re-checks all of it on Accept and Decline.
export function HouseholdLinkInvite({
  token,
  fallbackName,
}: {
  token: string;
  // The viewed profile's name, used if the server returns no inviter name.
  fallbackName: string;
}) {
  const t = useTranslations("invite");
  const navigate = useNavigate();
  const [declined, setDeclined] = useState(false);
  const { data } = useQuery(
    convexQuery(gateway.social.householdLinkInvite, { token }),
  );
  const name = data?.inviterName ?? fallbackName;

  const accept = useMutation({
    mutationFn: useConvexMutation(gateway.social.acceptHouseholdLinkInvite),
    onSuccess: () => {
      toast.success(t("householdLinkJoined", { name }));
      void navigate({ to: "/household" });
    },
    onError: () => toast.error(t("householdLinkFailed")),
  });
  const decline = useMutation({
    mutationFn: useConvexMutation(gateway.social.declineHouseholdLinkInvite),
    onSuccess: () => {
      setDeclined(true);
      toast.success(t("householdLinkDeclined"));
    },
    onError: () => toast.error(t("householdLinkFailed")),
  });

  if (!data || declined) return null;
  return (
    <HouseholdLinkInviteCard
      state={data.state}
      inviterName={name}
      busy={accept.isPending || decline.isPending}
      onAccept={() => accept.mutate({ token })}
      onDecline={() => decline.mutate({ token })}
    />
  );
}

export function HouseholdLinkInviteCard({
  state,
  inviterName,
  busy,
  onAccept,
  onDecline,
}: {
  state: HouseholdLinkState;
  inviterName: string;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const t = useTranslations("invite");
  const tHousehold = useTranslations("household.invites");
  const headingId = useId();

  if (state === "own-link") return null;
  if (state === "expired" || state === "used" || state === "invalid") {
    const key =
      state === "expired"
        ? "householdLinkExpired"
        : state === "used"
          ? "householdLinkUsed"
          : "householdLinkInvalid";
    return (
      <div className="text-muted-foreground mb-6 rounded-xl border px-4 py-3 text-center text-sm">
        <p>{t(key, { name: inviterName })}</p>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="border-jigsaw-primary/20 bg-jigsaw-primary/5 mb-6 flex w-full flex-col gap-3 rounded-xl border px-4 py-4"
    >
      <div className="flex items-start gap-2.5">
        <Home className="text-jigsaw-primary mt-0.5 size-4 shrink-0" />
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-sm font-medium">
            {t("householdLinkTitle", { name: inviterName })}
          </h2>
          <p className="text-muted-foreground text-sm">
            {state === "can-accept"
              ? t("householdLinkBody")
              : t("householdLinkAlreadyInHousehold")}
          </p>
        </div>
      </div>
      {state === "can-accept" && (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button
            size="sm"
            disabled={busy}
            onClick={onAccept}
            className="pointer-coarse:min-h-11"
          >
            {tHousehold("accept")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onDecline}
            className="pointer-coarse:min-h-11"
          >
            {tHousehold("decline")}
          </Button>
        </div>
      )}
    </section>
  );
}
