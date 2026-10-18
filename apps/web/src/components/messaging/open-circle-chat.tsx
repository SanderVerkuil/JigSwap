"use client";

// Opening a circle's group chat (spec §6.4): openCircleThread lands on the
// circle's one thread (creating it on first open), then we navigate into it.
// Shared by the circles page button and the inbox's circle picker.
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export function useOpenCircleChat() {
  const t = useTranslations("messages");
  const navigate = useNavigate();
  const openCircleThread = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.openCircleThread),
  });
  const open = async (circleId: string) => {
    try {
      const threadId = await openCircleThread.mutateAsync({ circleId });
      await navigate({ to: "/messages/$threadId", params: { threadId } });
    } catch {
      toast.error(t("circle.openGroupChatError"));
    }
  };
  return { open, pending: openCircleThread.isPending };
}

// The circles page's "Open group chat". Shown from sm up only: below that the
// circle row has no room left (its name already collapses), so phones open a
// circle chat from the inbox's New menu until the row is reworked.
export function OpenCircleChatButton({
  circleId,
  circleName,
}: {
  circleId: string;
  circleName: string;
}) {
  const t = useTranslations("messages");
  const { open, pending } = useOpenCircleChat();
  return (
    <Button
      variant="outline"
      size="sm"
      className="hidden sm:inline-flex"
      disabled={pending}
      onClick={() => void open(circleId)}
      aria-label={t("circle.openGroupChatNamed", { circle: circleName })}
    >
      <MessageSquare aria-hidden className="size-4" />
      {t("circle.openGroupChat")}
    </Button>
  );
}
