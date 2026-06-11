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

export const Route = createFileRoute("/admin/moderation")({
  component: ModerationPage,
});

// Minimal moderation queue: list pending puzzle submissions with approve/reject, wired to the
// domain-driven catalog mutations. Submissions become public only once approved.
function ModerationPage() {
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
        action === "approve" ? "Puzzle approved" : "Puzzle rejected",
      );
    } catch {
      toast.error("Failed to update submission");
    } finally {
      setBusyId(null);
    }
  };

  if (pending === undefined) {
    return <PageLoading message="Loading submissions..." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">
          Puzzle Moderation
        </h1>
        <p className="text-muted-foreground mt-2">
          Review pending submissions before they appear in the public catalog.
        </p>
      </div>

      {pending.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No pending submissions.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pending.map((puzzle) => (
            <Card key={puzzle._id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{puzzle.title}</CardTitle>
                  <Badge variant="secondary">Pending</Badge>
                </div>
                <CardDescription>
                  {puzzle.brand && `${puzzle.brand} • `}
                  {puzzle.pieceCount} pieces
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
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => moderate(puzzle.aggregateId, "reject")}
                    disabled={
                      !puzzle.aggregateId || busyId === puzzle.aggregateId
                    }
                    className="flex items-center gap-1 text-red-600 hover:text-red-700"
                  >
                    <X className="h-3 w-3" />
                    Reject
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
