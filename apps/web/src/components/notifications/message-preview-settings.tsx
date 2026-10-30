import { useUser } from "@/compat/clerk";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { Switch } from "@/components/ui/switch";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

const CHANNELS = ["email", "push"] as const;
type PreviewChannel = (typeof CHANNELS)[number];

// Whether email and push notifications for a message quote its text (the server decides at send
// time; defaults: email no, push yes). In-app always shows the message, so it has no switch.
export function MessagePreviewSettings() {
  const { user } = useUser();
  const t = useTranslations("notifications");
  const { data: previews } = useQuery(
    convexQuery(gateway.notifications.messagePreviews, user?.id ? {} : "skip"),
  );
  const setPreview = useConvexMutation(gateway.notifications.setMessagePreview);

  const label: Record<PreviewChannel, string> = {
    email: t("messagePreviewsEmail"),
    push: t("messagePreviewsPush"),
  };

  const toggle = (channel: PreviewChannel, enabled: boolean) =>
    setPreview({ channel, enabled }).catch(() =>
      toast.error(t("preferencesError")),
    );

  return (
    <section>
      <SectionHead title={t("messagePreviewsTitle")} icon={MessageSquareText} />
      <div className="bg-muted/30 flex flex-col gap-3 rounded-lg border px-4 py-3">
        {CHANNELS.map((channel) => (
          <div
            key={channel}
            className="flex items-center justify-between gap-4"
          >
            <label
              htmlFor={`message-preview-${channel}`}
              className="text-muted-foreground text-sm"
            >
              {label[channel]}
            </label>
            <Switch
              id={`message-preview-${channel}`}
              checked={previews?.[channel] === true}
              disabled={previews === undefined}
              onCheckedChange={(checked) => void toggle(channel, checked)}
            />
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {t("messagePreviewsNote")}
      </p>
    </section>
  );
}
