"use client";

import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { gateway, Id } from "@/gateway";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { MessageCircle } from "lucide-react";
import { useState } from "react";
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

  const canMessage = useQuery(
    gateway.conversation.canMessage,
    me ? { recipientId: memberId } : "skip",
  );
  const openDmThread = useMutation(gateway.conversation.openDmThread);
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    setPending(true);
    try {
      const threadId = await openDmThread({ recipientId: memberId });
      await navigate({ to: "/messages/$threadId", params: { threadId } });
    } catch (error) {
      const code =
        error instanceof ConvexError
          ? (error.data as { code?: unknown } | undefined)?.code
          : undefined;
      toast.error(code === "NotConnected" ? t("notConnected") : t("openError"));
    } finally {
      setPending(false);
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
