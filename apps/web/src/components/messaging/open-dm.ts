"use client";

// Opening a DM (spec §6.4): openDmThread lands on the pair's one DM thread
// (creating it on first open) after checking the ConnectionPolicy, then we
// navigate into it. Used by the inbox's member picker; mirrors
// useOpenCircleChat.
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { conversationErrorCode } from "./format";

export function useOpenDm() {
  const t = useTranslations("messages");
  const navigate = useNavigate();
  const openDmThread = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.openDmThread),
  });
  // Resolves true once the thread is open, false after an error toast. Any
  // refusal but NotConnected gets the generic message.
  const open = async (recipientId: string) => {
    try {
      const threadId = await openDmThread.mutateAsync({ recipientId });
      await navigate({ to: "/messages/$threadId", params: { threadId } });
      return true;
    } catch (error) {
      toast.error(
        conversationErrorCode(error) === "NotConnected"
          ? t("notConnected")
          : t("openError"),
      );
      return false;
    }
  };
  return { open, pending: openDmThread.isPending };
}
