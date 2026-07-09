import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import {
  fieldDiffRows,
  type FieldDiffRow,
} from "@/components/admin/proposals/field-diff";
import { ImageDiffDialog } from "@/components/admin/proposals/image-diff-dialog";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { EmptyState } from "@/components/library/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PageLoading } from "@/components/ui/loading";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useFormatter, useLocale, useTranslations } from "use-intl";

export const Route = createFileRoute(
  "/_dashboard/admin/puzzles/proposals/$proposalId",
)({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminPuzzles") }],
  }),
  component: ProposalReviewPage,
});

function ProposalReviewPage() {
  const { proposalId } = Route.useParams();
  const t = useTranslations("admin.proposals");
  const { data: proposal } = useQuery(
    convexQuery(gateway.admin.getChangeProposal, {
      changeProposalId: proposalId,
    }),
  );
  const { data: categories } = useQuery(
    convexQuery(gateway.catalog.puzzleCategories, {}),
  );

  if (proposal === undefined || categories === undefined) {
    return <PageLoading message={t("title")} />;
  }
  if (proposal === null) {
    // Unknown id — no such proposal was ever filed, or the link is wrong.
    return <EmptyState title={t("notFound")} sub={t("notFoundSub")} />;
  }
  return <ProposalReview proposal={proposal} categories={categories} />;
}

type ProposalRow = NonNullable<
  FunctionReturnType<typeof gateway.admin.getChangeProposal>
>;

const PROPOSAL_STATUS_VARIANT: Record<
  ProposalRow["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  withdrawn: "outline",
};

function ProposalReview({
  proposal,
  categories,
}: {
  proposal: ProposalRow;
  categories: readonly {
    _id: string;
    aggregateId?: string;
    name: { en: string; nl: string };
  }[];
}) {
  const router = useRouter();
  const t = useTranslations("admin.proposals");
  const tCommon = useTranslations("common");
  const tf = useTranslations("forms.puzzle-form");
  const tShell = useTranslations("shell");
  const format = useFormatter();
  const locale = useLocale();

  usePageHeader(
    () => ({
      title: proposal.definitionTitle ?? t("title"),
      crumbs: [
        { label: tShell("groups.admin.label"), href: "/admin" },
        { label: tShell("pages.adminPuzzles.title"), href: "/admin/puzzles" },
        { label: t("title"), href: "/admin/puzzles/proposals" },
      ],
    }),
    [proposal.definitionTitle, t, tShell],
  );

  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);

  const approve = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.approveChangeProposal),
    onSuccess: () => {
      toast.success(t("approved"));
      router.push("/admin/puzzles/proposals");
    },
    onError: () => toast.error(t("actionFailed")),
  });
  const reject = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.rejectChangeProposal),
    onSuccess: () => {
      toast.success(t("rejected"));
      router.push("/admin/puzzles/proposals");
    },
    onError: () => toast.error(t("actionFailed")),
  });
  const busy = approve.isPending || reject.isPending;

  // Render a raw field value for display. Grouped/object values get bespoke text; the
  // image row is rendered specially below (side-by-side thumbnails), so it's excluded here.
  const formatValue = (key: string, value: unknown): string => {
    if (value === undefined || value === null || value === "") return t("none");
    switch (key) {
      case "barcodes": {
        const group = value as {
          ean?: string;
          upc?: string;
          modelNumber?: string;
        };
        const parts = [
          group.ean && `${tf("ean.label")} ${group.ean}`,
          group.upc && `${tf("upc.label")} ${group.upc}`,
          group.modelNumber &&
            `${tf("modelNumber.label")} ${group.modelNumber}`,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(" · ") : t("none");
      }
      case "dimensions": {
        const dims = value as { width: number; height: number; unit: string };
        return `${dims.width} × ${dims.height} ${dims.unit}`;
      }
      case "tags":
        return (value as string[]).length > 0
          ? (value as string[]).join(", ")
          : t("none");
      case "category": {
        const match = categories.find(
          (c) => (c.aggregateId ?? c._id) === (value as string),
        );
        return match
          ? locale === "nl"
            ? match.name.nl
            : match.name.en
          : String(value);
      }
      case "difficulty":
        return tf(`difficulty.${value as string}`);
      case "shape":
        return tf(`shape.${value as string}`);
      default:
        return String(value);
    }
  };

  const fieldLabel = (key: string): string => {
    switch (key) {
      case "barcodes":
        return `${tf("ean.label")} / ${tf("upc.label")} / ${tf("modelNumber.label")}`;
      case "image":
        return tf("image.label");
      default:
        return tf(`${key}.label`);
    }
  };

  const rows = fieldDiffRows({
    changes: proposal.changes,
    baseline: proposal.baseline,
    current: proposal.current,
    conflictFields: proposal.conflictFields,
  });

  const isDecided = proposal.status !== "pending";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span>
            {proposal.proposerName &&
              `${t("proposedBy", { name: proposal.proposerName })} · `}
            {format.dateTime(proposal.createdAt, { dateStyle: "medium" })}
          </span>
          <Badge variant={PROPOSAL_STATUS_VARIANT[proposal.status]}>
            {t(`status.${proposal.status}`)}
          </Badge>
        </p>
        {proposal.comment && (
          <p className="mt-2 text-sm">
            <span className="text-muted-foreground">{t("comment")}: </span>
            {proposal.comment}
          </p>
        )}
        {proposal.status === "rejected" && proposal.rejectionReason && (
          <p className="text-destructive mt-2 text-sm">
            <span className="text-muted-foreground">
              {t("rejectionReason")}:{" "}
            </span>
            {proposal.rejectionReason}
          </p>
        )}
      </div>

      {!isDecided && proposal.hasConflict && (
        <div className="border-destructive/50 bg-destructive/10 flex items-start gap-2 rounded-lg border p-3 text-sm">
          <AlertTriangle
            className="text-destructive mt-0.5 h-4 w-4 shrink-0"
            aria-hidden
          />
          {t("conflictBanner")}
        </div>
      )}

      <div className="bg-card divide-y rounded-xl border">
        {rows.map((row: FieldDiffRow) =>
          row.key === "image" ? (
            <div key={row.key} className="space-y-2 p-4">
              <p className="text-sm font-semibold">{fieldLabel(row.key)}</p>
              <div className="flex items-center gap-6">
                <figure className="space-y-1">
                  <figcaption className="text-muted-foreground text-xs">
                    {t("current")}
                  </figcaption>
                  {proposal.definitionImage ? (
                    <img
                      src={proposal.definitionImage}
                      alt=""
                      className="size-24 rounded-lg border object-cover"
                    />
                  ) : (
                    <div className="bg-muted size-24 rounded-lg border" />
                  )}
                </figure>
                <figure className="space-y-1">
                  <figcaption className="text-muted-foreground text-xs">
                    {t("proposed")}
                  </figcaption>
                  {proposal.proposedImageUrl ? (
                    <img
                      src={proposal.proposedImageUrl}
                      alt=""
                      className="size-24 rounded-lg border object-cover"
                    />
                  ) : (
                    <div className="bg-muted size-24 rounded-lg border" />
                  )}
                </figure>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCompareOpen(true)}
                >
                  {t("imageCompare.open")}
                </Button>
              </div>
            </div>
          ) : (
            <div key={row.key} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{fieldLabel(row.key)}</p>
                {!isDecided && row.conflict && (
                  <Badge variant="destructive">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {t("conflict")}
                  </Badge>
                )}
              </div>
              <p className="text-sm">
                <span className="text-muted-foreground">{t("current")}: </span>
                {formatValue(row.key, row.current)}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">{t("proposed")}: </span>
                <span className="font-medium">
                  {formatValue(row.key, row.proposed)}
                </span>
              </p>
              {!isDecided && row.conflict && (
                <p className="text-destructive text-xs">
                  {t("wasWhenProposed", {
                    value: formatValue(row.key, row.baseline),
                  })}
                </p>
              )}
            </div>
          ),
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href="/admin/puzzles/proposals">{t("backToQueue")}</Link>
        </Button>
        {!isDecided && (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRejectOpen(true)}
            >
              {t("reject")}
            </Button>
            <Button
              variant="brand"
              disabled={busy}
              onClick={() => setConfirmingApprove(true)}
            >
              {t("approve")}
            </Button>
          </>
        )}
      </div>

      <AlertDialog open={confirmingApprove} onOpenChange={setConfirmingApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("approveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("approveConfirmBody", {
                title: proposal.definitionTitle ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmingApprove(false);
                approve.mutate({ changeProposalId: proposal.aggregateId });
              }}
            >
              {t("approve")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rejectTitle")}</DialogTitle>
            <DialogDescription>{t("rejectBody")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reject-reason">{t("reasonLabel")}</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={busy}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setRejectOpen(false);
                reject.mutate({
                  changeProposalId: proposal.aggregateId,
                  reason: reason.trim() || undefined,
                });
              }}
            >
              {t("reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageDiffDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        currentUrl={proposal.definitionImage}
        proposedUrl={proposal.proposedImageUrl}
        title={proposal.definitionTitle ?? ""}
      />
    </div>
  );
}
