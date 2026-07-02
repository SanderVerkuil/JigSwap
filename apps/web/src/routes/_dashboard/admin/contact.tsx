import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { QueueEmpty } from "@/components/admin/queue-empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import type { Id } from "@/gateway";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/contact")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminContact") }],
  }),
  component: ContactTriagePage,
});

// Admin triage inbox for the public contact form: every message newest first,
// with a single "mark as handled" transition (new -> handled). The listing and
// the transition are admin-gated server-side in the Convex functions.
function ContactTriagePage() {
  const t = useTranslations("admin.contact");
  const tAdmin = useTranslations("admin");
  const format = useFormatter();
  const { data: messages } = useQuery(
    convexQuery(gateway.adminTriage.contactMessages, {}),
  );
  const markHandled = useMutation({
    mutationFn: useConvexMutation(gateway.adminTriage.markContactHandled),
  });
  // Scope the pending state to the message being handled so only that row's
  // button disables, exactly as the old per-id busy flag did.
  const busyId = markHandled.isPending
    ? (markHandled.variables?.id ?? null)
    : null;

  const handle = async (id: Id<"contactMessages">) => {
    try {
      await markHandled.mutateAsync({ id });
      toast.success(t("markHandledSuccess"));
    } catch {
      toast.error(t("markHandledError"));
    }
  };

  if (messages === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  if (messages.length === 0) {
    return <QueueEmpty title={tAdmin("queueEmpty.title")} label={t("empty")} />;
  }

  return (
    <div className="rounded-xl border bg-card">
      {messages.map((message) => (
        <div
          key={message._id}
          className="flex flex-col gap-3 border-b px-4 py-3 last:border-0"
        >
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{message.name}</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {t(`subject.${message.subject}`)}
                </Badge>
                {message.status === "new" ? (
                  <Badge variant="default">{t("statusNew")}</Badge>
                ) : (
                  <Badge variant="secondary">{t("statusHandled")}</Badge>
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              <a href={`mailto:${message.email}`} className="underline">
                {message.email}
              </a>
              {" • "}
              {format.dateTime(new Date(message.createdAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {message.locale && ` • ${message.locale}`}
            </p>
          </div>
          <p className="text-sm whitespace-pre-wrap">{message.message}</p>
          {message.status === "new" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handle(message._id)}
              disabled={busyId === message._id}
              className="flex items-center gap-1 self-start"
            >
              <Check className="h-3 w-3" />
              {t("markHandled")}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
