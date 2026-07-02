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
import { gateway } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/admin/moderation")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminModeration") }],
  }),
  component: ModerationPage,
});

// Minimal moderation queue: list pending puzzle submissions with approve/reject, wired to the
// domain-driven catalog mutations. Submissions become public only once approved.
function ModerationPage() {
  const t = useTranslations("admin.moderation");
  const pending = useQuery(gateway.catalog.pending);
  const approve = useMutation(gateway.catalog.approve);
  const reject = useMutation(gateway.catalog.reject);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The aggregate is keyed by aggregateId; a pre-domain pending row without one cannot be moderated.
  const moderate = async (
    aggregateId: string | undefined,
    action: "approve" | "reject",
  ) => {
    if (!aggregateId) return;
    setBusyId(aggregateId);
    try {
      const run = action === "approve" ? approve : reject;
      await run({ puzzleDefinitionId: aggregateId });
      toast.success(
        action === "approve" ? t("approveSuccess") : t("rejectSuccess"),
      );
    } catch {
      toast.error(t("error"));
    } finally {
      setBusyId(null);
    }
  };

  if (pending === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-muted-foreground mt-2">{t("subtitle")}</p>
      </div>

      {pending.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pending.map((puzzle) => (
            <Card key={puzzle._id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{puzzle.title}</CardTitle>
                  <Badge variant="secondary">{t("pending")}</Badge>
                </div>
                <CardDescription>
                  {puzzle.brand && `${puzzle.brand} • `}
                  {t("pieces", { count: puzzle.pieceCount })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {puzzle.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={puzzle.image}
                    alt={puzzle.title}
                    className="w-full h-32 rounded object-cover"
                  />
                )}
                {puzzle.description && (
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {puzzle.description}
                  </p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => moderate(puzzle.aggregateId, "approve")}
                    disabled={
                      !puzzle.aggregateId || busyId === puzzle.aggregateId
                    }
                    className="flex items-center gap-1"
                  >
                    <Check className="h-3 w-3" />
                    {t("approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => moderate(puzzle.aggregateId, "reject")}
                    disabled={
                      !puzzle.aggregateId || busyId === puzzle.aggregateId
                    }
                    className="flex items-center gap-1 text-destructive hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                    {t("reject")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
