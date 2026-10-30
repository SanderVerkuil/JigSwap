"use client";

// Mute or unmute a thread for the viewer only: any thread they take part in
// (DM, exchange or circle), through conversation/setThreadMuted. A muted thread
// sends them no notifications and leaves the shell's unread badge. Shared by
// the circle header and members panel and the DM/exchange ⋯ menu.
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export function useThreadMute({
  threadId,
  muted,
}: {
  threadId: string;
  muted?: boolean;
}) {
  const t = useTranslations("messages");
  const setThreadMuted = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.setThreadMuted),
  });
  const isMuted = muted === true;
  const toggle = () => {
    setThreadMuted
      .mutateAsync({ threadId, muted: !isMuted })
      .catch(() => toast.error(t("circle.muteError")));
  };
  return { muted: isMuted, toggle, pending: setThreadMuted.isPending };
}
