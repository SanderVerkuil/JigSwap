"use client";

// A member's catalog submissions on the admin user detail page (admin/getUserDetail), newest
// first. Each row links to the admin puzzle page, which serves a definition in any status.
import { Badge } from "@/components/ui/badge";
import { gateway } from "@/gateway";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

type Submission = FunctionReturnType<
  typeof gateway.admin.getUserDetail
>["submissions"][number];

// Catalog definition statuses. The DTO types status as a plain string, so a status added later
// renders as an outline badge with the raw string until it gets a label here.
const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> =
  {
    approved: "secondary",
    pending: "outline",
    rejected: "destructive",
    disabled: "outline",
  };

export function UserSubmissions({
  submissions,
}: {
  submissions: Submission[];
}) {
  const t = useTranslations("admin.users");
  const format = useFormatter();

  if (submissions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        {t("detail.submissionsEmpty")}
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-xl border bg-card">
      {submissions.map((submission) => (
        <li key={submission._id} className="border-b last:border-b-0">
          <Link
            to="/admin/puzzles/$puzzleId"
            params={{ puzzleId: submission._id }}
            className="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-accent/50"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {submission.title}
            </span>
            <Badge variant={STATUS_VARIANT[submission.status] ?? "outline"}>
              {submission.status in STATUS_VARIANT
                ? t(`detail.status.${submission.status}`)
                : submission.status}
            </Badge>
            <span className="shrink-0 text-xs text-muted-foreground">
              {format.dateTime(new Date(submission.createdAt), {
                dateStyle: "medium",
              })}
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
