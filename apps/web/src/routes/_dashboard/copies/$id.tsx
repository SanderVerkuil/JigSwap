import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { Image } from "@/compat/image";
import { useRouter } from "@/compat/navigation";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { EmptyState } from "@/components/library/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftRight,
  Calendar,
  CircleCheck,
  Edit,
  HandHelping,
  MessageCircle,
  Puzzle,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "use-intl";

// The web tier derives Convex view types from the gateway (not @jigswap/contracts directly).
type CopyInstanceView = NonNullable<
  FunctionReturnType<typeof gateway.library.getCopyInstanceView>
>;
type CopyInstanceTimelineEntry = CopyInstanceView["before"][number];
type ProjectedMember = CopyInstanceView["owner"];

export const Route = createFileRoute("/_dashboard/copies/$id")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "copyInstance") }],
  }),
  component: CopyInstancePage,
});

function CopyInstancePage() {
  const { id } = Route.useParams();
  const copy = useQuery(gateway.library.getCopyInstanceView, {
    copyId: id as Id<"ownedPuzzles">,
  });

  if (copy === undefined) {
    return <CopyInstanceSkeleton />;
  }

  if (copy === null) {
    return <CopyInstanceNotFound />;
  }

  return <CopyInstanceDetail copy={copy} copyId={id} />;
}

function CopyInstanceSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Skeleton className="aspect-square w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
      <div className="space-y-6">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    </div>
  );
}

function CopyInstanceNotFound() {
  const t = useTranslations("copyInstance");
  return <EmptyState title={t("notFound")} sub={t("notFoundSub")} />;
}

function CopyInstanceDetail({
  copy,
  copyId,
}: {
  copy: CopyInstanceView;
  copyId: string;
}) {
  const router = useRouter();
  const t = useTranslations("copyInstance");
  const tPuzzles = useTranslations("puzzles");
  const format = useFormatter();

  const { snapshot } = copy;

  // Viewer actions in the shell page head. Owners get Edit / Log solve / Delete;
  // non-owners get Request swap + Message (Message hidden for anonymous owners).
  usePageHeader(
    () => ({
      title: snapshot.title,
      actions: copy.viewerIsOwner ? (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/my-puzzles/${copyId}/edit`)}
          >
            <Edit className="h-4 w-4" />
            {t("actions.edit")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/my-puzzles/${copyId}`)}
          >
            <CircleCheck className="h-4 w-4" />
            {t("actions.logSolve")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => router.push("/my-puzzles")}
          >
            <Trash2 className="h-4 w-4" />
            {t("actions.delete")}
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="brand"
            size="sm"
            onClick={() => router.push("/trades")}
          >
            <ArrowLeftRight className="h-4 w-4" />
            {t("actions.requestSwap")}
          </Button>
          {!copy.owner.anonymous && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/messages")}
            >
              <MessageCircle className="h-4 w-4" />
              {t("actions.message")}
            </Button>
          )}
        </>
      ),
    }),
    [copy.viewerIsOwner, copy.owner, snapshot.title, copyId],
  );

  const formatDate = (timestamp: number) =>
    format.dateTime(new Date(timestamp), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const acquisitionSourceLabel = (
    source?: "bought_new" | "bought_used" | "trade" | "gift",
  ) => (source ? t(`acquisitionSource.${source}`) : undefined);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Main column */}
      <div className="space-y-6 lg:col-span-2">
        {/* Cover */}
        <Card className="overflow-hidden p-0">
          <div className="bg-muted relative aspect-square w-full">
            {snapshot.image ? (
              <Image
                src={snapshot.image}
                alt={snapshot.title}
                fill
                className="object-cover"
              />
            ) : (
              <div className="from-jigsaw-primary/15 to-jigsaw-primary-accent/15 text-jigsaw-primary/50 absolute inset-0 flex items-center justify-center bg-gradient-to-br">
                <Puzzle className="h-1/4 w-1/4" />
              </div>
            )}
          </div>
        </Card>

        {/* Notes */}
        {snapshot.notes && (
          <Card>
            <CardHeader>
              <CardTitle>{t("notes")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground leading-relaxed">
                {snapshot.notes}
              </p>
            </CardContent>
          </Card>
        )}

        {/* History */}
        <Card>
          <CardHeader>
            <CardTitle>{t("history")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {copy.since.length === 0 && copy.before.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noHistory")}</p>
            ) : (
              <>
                {copy.viewerIsOwner && copy.since.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">
                      {t("sinceYouAcquired")}
                    </h3>
                    <Timeline
                      entries={copy.since}
                      condensed={false}
                      formatDate={formatDate}
                    />
                  </section>
                )}

                {copy.before.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">{t("beforeYou")}</h3>
                    <Timeline
                      entries={copy.before}
                      condensed
                      formatDate={formatDate}
                    />
                  </section>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        {/* Snapshot details */}
        <Card>
          <CardHeader>
            <CardTitle>{t("details")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {snapshot.brand && (
              <DetailRow label={t("brand")} value={snapshot.brand} />
            )}
            <DetailRow
              label={tPuzzles("pieceCount")}
              value={`${snapshot.pieceCount} ${tPuzzles("pieces")}`}
            />
            <DetailRow
              label={t("condition")}
              value={
                <Badge variant="secondary" className="text-xs">
                  {tPuzzles(snapshot.condition)}
                </Badge>
              }
            />
            <div className="flex items-center justify-between">
              <span className="font-medium">{t("availability")}</span>
              <div className="flex flex-wrap justify-end gap-1">
                {snapshot.availability.forTrade && (
                  <Badge variant="outline" className="text-xs">
                    {tPuzzles("trade")}
                  </Badge>
                )}
                {snapshot.availability.forSale && (
                  <Badge variant="outline" className="text-xs">
                    {tPuzzles("sale")}
                  </Badge>
                )}
                {snapshot.availability.forLend && (
                  <Badge variant="outline" className="text-xs">
                    {tPuzzles("lend")}
                  </Badge>
                )}
                {!snapshot.availability.forTrade &&
                  !snapshot.availability.forSale &&
                  !snapshot.availability.forLend && (
                    <span className="text-muted-foreground text-sm">
                      {t("notAvailable")}
                    </span>
                  )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Owner */}
        <Card>
          <CardHeader>
            <CardTitle>{t("owner")}</CardTitle>
          </CardHeader>
          <CardContent>
            <MemberLine member={copy.owner} />
          </CardContent>
        </Card>

        {/* Acquisition */}
        {(snapshot.acquisitionDate || snapshot.acquisitionSource) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                {t("acquisition")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {snapshot.acquisitionDate && (
                <DetailRow
                  label={t("acquiredOn")}
                  value={formatDate(snapshot.acquisitionDate)}
                />
              )}
              {snapshot.acquisitionSource && (
                <DetailRow
                  label={t("acquiredVia")}
                  value={
                    acquisitionSourceLabel(snapshot.acquisitionSource) ?? ""
                  }
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground text-right text-sm">{value}</span>
    </div>
  );
}

// Render a ProjectedMember: a revealed member shows name + avatar; an anonymised
// one shows the "Anonymous user" label with a stable colour/initial derived from
// its anonRef so distinct hidden people stay visually distinct — never a name.
function MemberLine({ member }: { member: ProjectedMember }) {
  const t = useTranslations("copyInstance");

  if (member.anonymous) {
    const { hue, initial } = anonStyle(member.anonRef);
    return (
      <div className="flex items-center gap-2">
        <Avatar>
          <AvatarFallback
            className="text-xs font-medium text-white"
            style={{ backgroundColor: `hsl(${hue} 55% 45%)` }}
          >
            {initial}
          </AvatarFallback>
        </Avatar>
        <span className="text-muted-foreground text-sm">
          {t("anonymousUser")}
        </span>
      </div>
    );
  }

  const name = member.member.name;
  return (
    <div className="flex items-center gap-2">
      <Avatar>
        {member.member.avatar && (
          <AvatarImage src={member.member.avatar} alt={name} />
        )}
        <AvatarFallback className="text-xs font-medium">
          {name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm font-medium">{name}</span>
    </div>
  );
}

// A purely cosmetic, deterministic colour + glyph for an anonymised member, so
// two distinct hidden people read as distinct. Derived from the opaque anonRef;
// reveals nothing about the real identity.
function anonStyle(anonRef: string): { hue: number; initial: string } {
  let hash = 0;
  for (let i = 0; i < anonRef.length; i++) {
    hash = (hash * 31 + anonRef.charCodeAt(i)) % 360;
  }
  return { hue: hash, initial: "?" };
}

function Timeline({
  entries,
  condensed,
  formatDate,
}: {
  entries: CopyInstanceTimelineEntry[];
  condensed: boolean;
  formatDate: (timestamp: number) => string;
}) {
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {entries.map((entry, index) => (
        <TimelineRow
          key={index}
          entry={entry}
          condensed={condensed}
          formatDate={formatDate}
        />
      ))}
    </ol>
  );
}

function TimelineRow({
  entry,
  condensed,
  formatDate,
}: {
  entry: CopyInstanceTimelineEntry;
  condensed: boolean;
  formatDate: (timestamp: number) => string;
}) {
  const t = useTranslations("copyInstance");

  let icon: ReactNode;
  let title: ReactNode;
  let detail: ReactNode;

  if (entry.type === "transfer") {
    icon = <ArrowLeftRight className="h-3.5 w-3.5" />;
    title = entry.from.anonymous ? (
      <span>
        {t("acquiredBy")} <ProjectedName member={entry.to} />
      </span>
    ) : (
      <span>
        {t("swappedFromTo")} <ProjectedName member={entry.from} /> →{" "}
        <ProjectedName member={entry.to} />
      </span>
    );
    detail = entry.viaExchange ? t("viaExchange") : undefined;
  } else if (entry.type === "completion") {
    icon = <CircleCheck className="h-3.5 w-3.5" />;
    title = (
      <span>
        {t("completedBy")} <ProjectedName member={entry.solver} />
      </span>
    );
    detail =
      entry.timeMinutes != null
        ? t("completionTime", { minutes: entry.timeMinutes })
        : undefined;
  } else {
    icon = <HandHelping className="h-3.5 w-3.5" />;
    title =
      entry.status === "open" ? (
        <span>
          {t("lentTo")} <ProjectedName member={entry.borrower} />
        </span>
      ) : (
        <span>{t("returned")}</span>
      );
    detail = t(`loanStatus.${entry.status}`);
  }

  return (
    <li className="relative">
      <span className="bg-muted text-muted-foreground absolute -left-[1.85rem] flex h-6 w-6 items-center justify-center rounded-full">
        {icon}
      </span>
      <div className={cn("flex flex-col gap-0.5", condensed && "text-sm")}>
        <span>{title}</span>
        <span className="text-muted-foreground text-xs">
          {formatDate(entry.occurredAt)}
          {detail ? ` · ${detail}` : ""}
        </span>
      </div>
    </li>
  );
}

function ProjectedName({ member }: { member: ProjectedMember }) {
  const t = useTranslations("copyInstance");
  if (member.anonymous) {
    return <span className="font-medium">{t("anonymousUser")}</span>;
  }
  return <span className="font-medium">{member.member.name}</span>;
}
