// "Invite to a circle…" from a member's profile ⋯ menu: pick one of your circles and the seat's
// permission, then send the invite (sharing.inviteToCircle). Offered only where it can work:
// you follow each other (the invite contact rule) and you're an Admin of at least one circle.
// The server stays authoritative (CannotInvite, AlreadyMember, CircleFull… become toasts).
import { circleInviteErrorKey } from "@/components/circles/circle-invite-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gateway, type Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type RefObject } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type CirclePermissionLevel = "ViewOnly" | "Exchange" | "Admin";
const PERMISSIONS: CirclePermissionLevel[] = ["ViewOnly", "Exchange", "Admin"];

export interface InvitableCircle {
  // The domain CircleId (inviteToCircle takes this).
  circleId: string;
  name: string;
}

/**
 * The circles the viewer could invite `memberId` into: none unless the two follow each other,
 * otherwise every circle where the viewer holds an Admin seat. The circles are only read once
 * the follow is known to be mutual.
 */
export function useCirclesToInviteInto(
  memberId: Id<"users">,
): InvitableCircle[] {
  const { data: relation } = useQuery(
    convexQuery(gateway.social.followRelation, { memberId }),
  );
  const mutual = relation?.following === true && relation.followsYou === true;
  const { data: circles } = useQuery(
    convexQuery(gateway.sharing.myCircles, mutual ? {} : "skip"),
  );
  if (!mutual) return [];
  return (circles ?? []).flatMap((circle) =>
    circle.viewerPermission === "Admin" && circle.aggregateId
      ? [{ circleId: circle.aggregateId, name: circle.name }]
      : [],
  );
}

export function InviteToCircleDialog({
  memberId,
  name,
  circles,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  memberId: Id<"users">;
  /** The member's resolved display name. */
  name: string;
  circles: readonly InvitableCircle[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The menu item that opened the dialog is gone by the time it closes: focus goes here.
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("circles");
  const tCommon = useTranslations("common");
  const [chosenCircleId, setChosenCircleId] = useState<string>();
  // A circle is for swapping, and the inviter chose this person: they can still pick View only.
  const [permission, setPermission] =
    useState<CirclePermissionLevel>("Exchange");
  const circleId = circles.some((c) => c.circleId === chosenCircleId)
    ? chosenCircleId
    : circles[0]?.circleId;
  const circleName = circles.find((c) => c.circleId === circleId)?.name ?? "";

  const invite = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.inviteToCircle),
    onSuccess: () => {
      toast.success(t("inviteToCircle.sent", { name, circle: circleName }));
      onOpenChange(false);
    },
    onError: (error) => toast.error(t(circleInviteErrorKey(error))),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !invite.isPending && onOpenChange(next)}
    >
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("inviteToCircle.title", { name })}</DialogTitle>
          <DialogDescription>
            {t("inviteToCircle.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-to-circle-circle">
              {t("inviteToCircle.circleLabel")}
            </Label>
            <Select value={circleId} onValueChange={setChosenCircleId}>
              <SelectTrigger id="invite-to-circle-circle" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {circles.map((circle) => (
                  <SelectItem key={circle.circleId} value={circle.circleId}>
                    {circle.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-to-circle-permission">
              {t("invite.permissionLabel")}
            </Label>
            <Select
              value={permission}
              onValueChange={(value: CirclePermissionLevel) =>
                setPermission(value)
              }
            >
              <SelectTrigger
                id="invite-to-circle-permission"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSIONS.map((p) => (
                  <SelectItem
                    key={p}
                    value={p}
                    description={t(`permissionDescriptions.${p}`)}
                  >
                    {t(`permissions.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={invite.isPending}
            onClick={() => onOpenChange(false)}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={invite.isPending || !circleId}
            onClick={() =>
              circleId &&
              invite.mutate({ circleId, inviteeId: memberId, permission })
            }
          >
            {invite.isPending ? t("inviteToCircle.sending") : t("invite.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
