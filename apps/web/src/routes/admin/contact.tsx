import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import type { Id } from "@/gateway";
import { gateway } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/admin/contact")({
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
  const format = useFormatter();
  const messages = useQuery(gateway.adminTriage.contactMessages);
  const markHandled = useMutation(gateway.adminTriage.markContactHandled);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handle = async (id: Id<"contactMessages">) => {
    setBusyId(id);
    try {
      await markHandled({ id });
      toast.success(t("markHandledSuccess"));
    } catch {
      toast.error(t("markHandledError"));
    } finally {
      setBusyId(null);
    }
  };

  if (messages === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-muted-foreground mt-2">{t("subtitle")}</p>
      </div>

      {messages.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <Card key={message._id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{message.name}</CardTitle>
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
                <CardDescription>
                  <a href={`mailto:${message.email}`} className="underline">
                    {message.email}
                  </a>
                  {" • "}
                  {format.dateTime(new Date(message.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {message.locale && ` • ${message.locale}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm whitespace-pre-wrap">{message.message}</p>
                {message.status === "new" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handle(message._id)}
                    disabled={busyId === message._id}
                    className="flex items-center gap-1"
                  >
                    <Check className="h-3 w-3" />
                    {t("markHandled")}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
