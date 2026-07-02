"use client";

import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { conversationErrorCode } from "@/components/messaging/format";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { gateway, Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// "Message" entry point beside the follow toggle. Gated by the same
// ConnectionPolicy openDmThread enforces (gateway.conversation.canMessage):
// unconnected members get a disabled button with an explanatory tooltip.
// Clicking opens (or lands on) the pair's DM thread and navigates into it.
// `size` mirrors FollowButton so compact contexts render the small variant.
export function MessageButton({
  memberId,
  size = "default",
}: {
  memberId: Id<"users">;
  size?: "default" | "sm";
}) {
  const t = useTranslations("messages");
  const navigate = useNavigate();
  const { member } = useCurrentMember();
  const me = member?._id;

  const { data: canMessage } = useQuery(
    convexQuery(
      gateway.conversation.canMessage,
      me ? { recipientId: memberId } : "skip",
    ),
  );
  const openDmThread = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.openDmThread),
  });
  const pending = openDmThread.isPending;

  const handleClick = async () => {
    try {
      const threadId = await openDmThread.mutateAsync({
        recipientId: memberId,
      });
      await navigate({ to: "/messages/$threadId", params: { threadId } });
    } catch (error) {
      const code = conversationErrorCode(error);
      toast.error(code === "NotConnected" ? t("notConnected") : t("openError"));
    }
  };

  const button = (enabled: boolean) => (
    <Button
      variant="outline"
      size={size}
      disabled={!enabled || pending}
      onClick={enabled ? handleClick : undefined}
    >
      <MessageCircle className="mr-2 h-4 w-4" />
      {t("messageButton")}
    </Button>
  );

  // canMessage undefined = still loading; render the button disabled without
  // the "not connected" explanation until the gate has actually answered.
  if (canMessage === undefined) {
    return button(false);
  }

  if (!canMessage) {
    return (
      <Tooltip>
        {/* A disabled button swallows pointer events, so the span carries the
            tooltip trigger (and keyboard focus) instead. */}
        <TooltipTrigger asChild>
          <span tabIndex={0}>{button(false)}</span>
        </TooltipTrigger>
        <TooltipContent>{t("notConnected")}</TooltipContent>
      </Tooltip>
    );
  }

  return button(true);
}
