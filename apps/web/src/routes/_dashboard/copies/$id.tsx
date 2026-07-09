import { durationParts } from "@/lib/humanize-duration";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { Image } from "@/compat/image";
import { useRouter } from "@/compat/navigation";
import { availabilityToSharing } from "@/components/add-puzzle";
import { EditCopyDialog } from "@/components/copies/edit-copy-dialog";
import { PhotoLightbox } from "@/components/copies/photo-lightbox";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { ImageEditorDialog } from "@/components/image-editor/image-editor-dialog";
import { EmptyState } from "@/components/library/empty-state";
import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StarRating } from "@/components/ui/star-rating";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftRight,
  Calendar,
  CircleCheck,
  Clock,
  Edit,
  Gift,
  ImagePlus,
  MessageCircle,
  Package,
  Puzzle,
  Star,
  Tag,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

// The web tier derives Convex view types from the gateway (not @jigswap/contracts directly).
type CopyInstanceView = NonNullable<
  FunctionReturnType<typeof gateway.library.getCopyInstanceView>
>;
type ProjectedMember = CopyInstanceView["owner"];
type PuzzleComment = FunctionReturnType<
  typeof gateway.social.listPuzzleComments
>[number];

export const Route = createFileRoute("/_dashboard/copies/$id")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "copyInstance") }],
  }),
  component: CopyInstancePage,
});

function CopyInstancePage() {
  const { id } = Route.useParams();
  return <CopyInstanceScreen copyId={id} owned={false} />;
}

// Shared copy-detail screen used by BOTH the public route (/copies/$id, owned=false)
// and the owner route (/my-puzzles/$id, owned=true). `owned` drives the breadcrumb
// framing and gates the owner route: viewing a copy you don't own under /my-puzzles
// bounces to the public /copies view.
export function CopyInstanceScreen({
  copyId,
  owned,
}: {
  copyId: string;
  owned: boolean;
}) {
  const router = useRouter();
  const { data: copy, isPending: copyPending } = useQuery(
    convexQuery(gateway.library.getCopyInstanceView, {
      copyId: copyId as Id<"ownedPuzzles">,
    }),
  );

  const notOwner = owned && copy != null && copy.viewerIsOwner === false;
  useEffect(() => {
    if (notOwner) router.push(`/copies/${copyId}`);
  }, [notOwner, copyId, router]);

  if (copyPending || copy === undefined || notOwner) {
    return <CopyInstanceSkeleton />;
  }

  if (copy === null) {
    return <CopyInstanceNotFound />;
  }

  return <CopyInstanceDetail copy={copy} copyId={copyId} owned={owned} />;
}

function CopyInstanceSkeleton() {
  return (
    <div className="w-full space-y-8">
      <div className="grid gap-7 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Skeleton className="aspect-square w-full rounded-2xl" />
        <div className="space-y-4">
          <Skeleton className="h-9 w-2/3 rounded-lg" />
          <Skeleton className="h-5 w-1/3 rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-44 w-full rounded-xl" />
    </div>
  );
}

function CopyInstanceNotFound() {
  const t = useTranslations("copyInstance");
  return <EmptyState title={t("notFound")} sub={t("notFoundSub")} />;
}

// Difficulty colour swatch, matching the shared PuzzleCard scheme.
function difficultyClasses(difficulty?: string) {
  switch (difficulty) {
    case "easy":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
    case "medium":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200";
    case "hard":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200";
    case "expert":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// Condition dot colour, by copy condition.
function conditionDotClass(condition: string) {
  switch (condition) {
    case "new_sealed":
    case "like_new":
      return "bg-jigsaw-secondary";
    case "good":
      return "bg-jigsaw-primary";
    case "fair":
      return "bg-amber-400";
    default:
      return "bg-destructive";
  }
}

function CopyInstanceDetail({
  copy,
  copyId,
  owned,
}: {
  copy: CopyInstanceView;
  copyId: string;
  owned: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("copyInstance");
  const tShell = useTranslations("shell");
  const tPuzzles = useTranslations("puzzles");
  const tDifficulty = useTranslations("puzzles.puzzles.difficulty");
  const format = useFormatter();
  // A stable "now" captured once per mount, so duration/relative-time renders are
  // idempotent (calling Date.now() during render is an impure-render violation).
  const [now] = useState(() => Date.now());

  const { snapshot, stats, community, gallery } = copy;
  const availability = snapshot.availability;
  const isAvailable =
    availability.forTrade || availability.forSale || availability.forLend;

  // Owner action dialogs. `logOpen` drives the completion logger; `editOpen` drives the inline
  // copy editor (also reachable from the page-head Edit button registered below).
  const [logOpen, setLogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const updateSharing = useMutation({
    mutationFn: useConvexMutation(gateway.library.updateSharing),
  });

  // Toggle a single sharing flag on the copy. Optimistic from the user's view via Convex
  // reactivity; on failure we surface a toast and the next query refresh restores the real state.
  const toggleSharing = async (flag: "forTrade" | "forLend") => {
    if (!copy.viewerIsOwner || copy.aggregateId == null) return;
    try {
      await updateSharing.mutateAsync(
        availabilityToSharing(copy.aggregateId, {
          ...availability,
          [flag]: !availability[flag],
        }),
      );
    } catch {
      toast.error(t("editCopy.editFailed"));
    }
  };

  // Publish the page head: the puzzle name as the title (replacing the generic
  // "Owned copy"), the breadcrumb trail, and the owner-only Edit action. For the
  // owner route (owned) the crumbs are left to the shell's auto trail (My Library ›
  // My Puzzles › <name>, since /my-puzzles/$id's pageKey matches the nav item);
  // the public route publishes an explicit Community › Owned Copies › <name> trail.
  usePageHeader(
    () => ({
      title: snapshot.title,
      crumbs: owned
        ? undefined
        : [
            { label: tShell("groups.community.label"), href: "/community" },
            { label: tShell("crumbs.ownedCopies"), href: "/browse" },
          ],
      actions: copy.viewerIsOwner ? (
        <Button variant="outline" onClick={() => setEditOpen(true)}>
          <Edit className="h-4 w-4" />
          {t("actions.edit")}
        </Button>
      ) : null,
    }),
    [snapshot.title, owned, copy.viewerIsOwner, t, tShell],
  );

  const formatDay = (timestamp: number) =>
    format.dateTime(new Date(timestamp), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const formatMonth = (timestamp: number) =>
    format.dateTime(new Date(timestamp), { year: "numeric", month: "short" });

  // Humanize a solve duration (minutes) to a localized "2 hours" / "1 day" / "1 week" via the
  // largest sensible unit — Intl unit formatting handles plurals + locale.
  const formatDuration = (minutes: number) => {
    const { value, unit } = durationParts(minutes);
    return format.number(value, { style: "unit", unit, unitDisplay: "long" });
  };

  const acquisitionSourceLabel = (
    source?: "bought_new" | "bought_used" | "trade" | "gift",
  ) => (source ? t(`acquisitionSourceLabel.${source}`) : "—");

  const conditionLabel = (condition: string) => {
    // Reuse the puzzles condition namespace where it exists; map the copy union.
    switch (condition) {
      case "new_sealed":
        return t("conditionLabel.new_sealed");
      case "like_new":
        return t("conditionLabel.like_new");
      default:
        return tPuzzles(`puzzles.condition.${condition}`);
    }
  };

  // "In your library" duration: whole years + months from acquisition to now,
  // formatted like "1y 5m" (or "5m" / "<1m"). Owner-only context.
  const ownedDuration = (since: number): string => {
    let months = Math.floor((now - since) / (1000 * 60 * 60 * 24 * 30.4375));
    if (months < 1) return t("durationLessThanMonth");
    const years = Math.floor(months / 12);
    months = months % 12;
    const parts: string[] = [];
    if (years > 0) parts.push(t("durationYears", { years }));
    if (months > 0) parts.push(t("durationMonths", { months }));
    return parts.join(" ");
  };

  const difficultyLabel = (difficulty?: string) =>
    difficulty ? tDifficulty(difficulty) : tDifficulty("unknown");

  return (
    <div className="flex w-full flex-col gap-10">
      {/* Hero */}
      <section className="grid items-start gap-7 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Cover */}
        <div className="bg-muted relative aspect-square w-full max-w-[300px] overflow-hidden rounded-2xl shadow-sm">
          {snapshot.image ? (
            <Image
              src={snapshot.image}
              alt={snapshot.title}
              fill
              className="object-contain"
            />
          ) : (
            <div className="from-jigsaw-primary/20 to-jigsaw-primary text-jigsaw-primary-foreground/70 absolute inset-0 flex items-center justify-center bg-gradient-to-br">
              <Puzzle className="h-1/3 w-1/3" />
            </div>
          )}
          {isAvailable && (
            <span className="bg-jigsaw-secondary absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-white shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              {t("available")}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            {snapshot.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-base">
            {snapshot.brand ? `${snapshot.brand} · ` : ""}
            <span className="font-mono">
              {snapshot.pieceCount.toLocaleString()}
            </span>{" "}
            {tPuzzles("pieces")}
          </p>

          {/* Badges */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                "rounded-full border-transparent px-2.5 py-0.5 text-xs font-semibold",
                difficultyClasses(snapshot.difficulty),
              )}
            >
              {difficultyLabel(snapshot.difficulty)}
            </Badge>
            <span className="border-border text-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold">
              <span
                className={cn(
                  "h-2 w-2 rounded-sm",
                  conditionDotClass(snapshot.condition),
                )}
              />
              {conditionLabel(snapshot.condition)}
            </span>
            {availability.forTrade && (
              <Badge variant="secondary" className="rounded-full text-xs">
                {t("forTrade")}
              </Badge>
            )}
            {availability.forLend && (
              <Badge variant="secondary" className="rounded-full text-xs">
                {t("forLend")}
              </Badge>
            )}
            {availability.forSale && (
              <Badge variant="secondary" className="rounded-full text-xs">
                {t("forSale")}
              </Badge>
            )}
          </div>

          {/* Story */}
          {snapshot.notes && (
            <p className="text-foreground/90 mt-4 max-w-[560px] text-pretty leading-relaxed">
              {snapshot.notes}
            </p>
          )}

          {/* Meta row */}
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
            <MetaItem
              icon={<Calendar className="h-3.5 w-3.5" />}
              label={t("acquired")}
              value={
                snapshot.acquisitionDate
                  ? formatMonth(snapshot.acquisitionDate)
                  : "—"
              }
            />
            <MetaItem
              icon={<Gift className="h-3.5 w-3.5" />}
              label={t("source")}
              value={acquisitionSourceLabel(snapshot.acquisitionSource)}
            />
            <MetaItem
              icon={<Clock className="h-3.5 w-3.5" />}
              label={t("inYourLibrary")}
              value={
                copy.viewerIsOwner
                  ? ownedDuration(copy.acquiredByViewerAt)
                  : "—"
              }
            />
            {snapshot.tags.length > 0 && (
              <MetaItem
                icon={<Tag className="h-3.5 w-3.5" />}
                label={t("tags")}
                value={snapshot.tags.join(", ")}
              />
            )}
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-wrap gap-2.5">
            {copy.viewerIsOwner ? (
              <>
                <Button
                  variant={availability.forTrade ? "brand" : "outline"}
                  aria-pressed={availability.forTrade}
                  disabled={copy.aggregateId == null}
                  onClick={() => void toggleSharing("forTrade")}
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  {availability.forTrade
                    ? t("offeredForSwap")
                    : t("offerForSwap")}
                </Button>
                <Button
                  variant={availability.forLend ? "brand" : "outline"}
                  aria-pressed={availability.forLend}
                  disabled={copy.aggregateId == null}
                  onClick={() => void toggleSharing("forLend")}
                >
                  <Package className="h-4 w-4" />
                  {availability.forLend
                    ? t("offeredForLend")
                    : t("offerForLend")}
                </Button>
                <Button
                  variant="outline"
                  disabled={copy.aggregateId == null}
                  onClick={() => setLogOpen(true)}
                >
                  <CircleCheck className="h-4 w-4" />
                  {t("actions.logCompletion")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="brand" onClick={() => router.push("/trades")}>
                  <ArrowLeftRight className="h-4 w-4" />
                  {t("actions.requestSwap")}
                </Button>
                {!copy.owner.anonymous && (
                  <Button
                    variant="outline"
                    onClick={() => router.push("/messages")}
                  >
                    <MessageCircle className="h-4 w-4" />
                    {t("actions.message")}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <div className="grid max-w-[760px] grid-cols-2 gap-y-6 sm:grid-cols-4">
        <Stat value={stats.timesCompleted} label={t("statTimesCompleted")} />
        <Stat
          value={
            stats.fastestFinishMinutes != null
              ? formatDuration(stats.fastestFinishMinutes)
              : "—"
          }
          label={t("statFastestFinish")}
          divided
        />
        <Stat
          value={stats.timesLentOut}
          label={t("statTimesLentOut")}
          divided
        />
        <Stat
          value={
            copy.viewerIsOwner && stats.yourAvgRating != null
              ? stats.yourAvgRating
              : "—"
          }
          label={t("statYourAvgRating")}
          divided
        />
      </div>

      {/* Photos */}
      <section>
        <SectionHead
          icon={<ImagePlus className="h-4 w-4" />}
          title={t("photos")}
          meta={t("photosCount", { count: gallery.length })}
        />
        <PhotoStrip
          gallery={gallery}
          canAdd={copy.viewerIsOwner}
          copyId={copyId}
          coverImageId={snapshot.coverImageId}
        />
      </section>

      {/* Two-column record */}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {/* Left: history */}
        <div className="space-y-8">
          <HistoryGroup
            icon={<CircleCheck className="h-4 w-4" />}
            title={t("completionHistory")}
            meta={
              copy.completions.length > 0
                ? t("completionsCount", { count: copy.completions.length })
                : undefined
            }
            empty={
              copy.completions.length === 0 ? t("noCompletions") : undefined
            }
          >
            {copy.completions.map((c, i) => (
              <TimelineRow
                key={i}
                icon={<CircleCheck className="h-4 w-4" />}
                iconClass={
                  c.isYou ? "bg-jigsaw-secondary" : "bg-jigsaw-primary"
                }
                last={i === copy.completions.length - 1}
                title={
                  <>
                    <ProjectedName member={c.solver} />
                    {c.isYou && (
                      <span className="text-muted-foreground font-medium">
                        {" "}
                        · {t("you")}
                      </span>
                    )}
                  </>
                }
                sub={
                  c.finishMinutes != null
                    ? `${formatDay(c.occurredAt)} · ${t("finishedIn", { duration: formatDuration(c.finishMinutes) })}`
                    : formatDay(c.occurredAt)
                }
                right={
                  c.rating != null ? (
                    <StarRating value={c.rating} size="sm" />
                  ) : undefined
                }
              >
                {c.note && (
                  <p className="text-foreground/90 mt-1.5 text-sm italic">
                    “{c.note}”
                  </p>
                )}
              </TimelineRow>
            ))}
          </HistoryGroup>

          <HistoryGroup
            icon={<Package className="h-4 w-4" />}
            title={t("lendingHistory")}
            meta={
              copy.loans.length > 0
                ? t("lendsCount", { count: copy.loans.length })
                : undefined
            }
            empty={copy.loans.length === 0 ? t("noLends") : undefined}
          >
            {copy.loans.map((l, i) => (
              <TimelineRow
                key={i}
                icon={<Package className="h-4 w-4" />}
                iconClass="bg-jigsaw-primary"
                last={i === copy.loans.length - 1}
                title={
                  <>
                    {t("lentTo")} <ProjectedName member={l.borrower} />
                  </>
                }
                sub={`${formatDay(l.openedAt)} → ${l.closedAt != null ? formatDay(l.closedAt) : "—"}`}
                right={<LoanStatusPill status={l.status} />}
              />
            ))}
          </HistoryGroup>

          <HistoryGroup
            icon={<ArrowLeftRight className="h-4 w-4" />}
            title={t("swapHistory")}
            meta={
              copy.transfers.length > 0
                ? t("exchangesCount", { count: copy.transfers.length })
                : undefined
            }
            empty={copy.transfers.length === 0 ? t("noSwaps") : undefined}
          >
            {copy.transfers.map((tr, i) => (
              <TimelineRow
                key={i}
                icon={<ArrowLeftRight className="h-4 w-4" />}
                iconClass="bg-jigsaw-secondary"
                last={i === copy.transfers.length - 1}
                title={
                  tr.from.anonymous ? (
                    <>
                      {t("acquiredBy")} <ProjectedName member={tr.to} />
                    </>
                  ) : (
                    <>
                      {t("swappedFromTo")} <ProjectedName member={tr.from} /> →{" "}
                      <ProjectedName member={tr.to} />
                    </>
                  )
                }
                sub={
                  tr.viaExchange
                    ? `${formatDay(tr.occurredAt)} · ${t("viaExchange")}`
                    : formatDay(tr.occurredAt)
                }
              />
            ))}
          </HistoryGroup>
        </div>

        {/* Right: community + comments */}
        <div className="space-y-9">
          <CommunityRating community={community} />
          <CommentsSection copyId={copyId} />
        </div>
      </div>

      {/* Owner dialogs: completion logger (keyed by aggregateId) + inline copy editor. */}
      {copy.viewerIsOwner && (
        <>
          <LogSolveDialog
            open={logOpen}
            onOpenChange={setLogOpen}
            copyId={copy.aggregateId ?? ""}
            puzzleTitle={snapshot.title}
            viewerIsOwner={copy.viewerIsOwner}
          />
          <EditCopyDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            copy={copy}
          />
        </>
      )}
    </div>
  );
}

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </div>
      <div className="text-foreground text-sm font-semibold">{value}</div>
    </div>
  );
}

function Stat({
  value,
  label,
  divided,
}: {
  value: ReactNode;
  label: string;
  divided?: boolean;
}) {
  return (
    <div className={cn(divided && "border-border sm:border-l sm:pl-5")}>
      <div className="font-heading text-foreground text-3xl font-bold leading-none">
        {value}
      </div>
      <div className="text-muted-foreground mt-1.5 text-sm">{label}</div>
    </div>
  );
}

function SectionHead({
  icon,
  title,
  meta,
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="text-jigsaw-primary inline-flex">{icon}</span>
      <h2 className="font-heading text-lg font-bold">{title}</h2>
      {meta && (
        <span className="text-muted-foreground font-mono text-xs">{meta}</span>
      )}
    </div>
  );
}

function PhotoStrip({
  gallery,
  canAdd,
  copyId,
  coverImageId,
}: {
  gallery: CopyInstanceView["gallery"];
  canAdd: boolean;
  copyId: string;
  coverImageId: string | null;
}) {
  const t = useTranslations("copyInstance");
  const inputRef = useRef<HTMLInputElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [editing, setEditing] = useState<{
    src: string;
    fileName: string;
  } | null>(null);
  const generateUploadUrl = useConvexMutation(
    gateway.library.generateUploadUrl,
  );
  const addCopyPhoto = useConvexMutation(gateway.library.addCopyPhoto);

  const openLightbox = (index: number) => {
    setActiveIndex(index);
    setLightboxOpen(true);
  };

  // Edit-before-upload: a picked file opens the editor on an object URL instead of
  // uploading directly; onApply forwards the baked File to the existing upload
  // pipeline below. The object URL is only ever used for the editor preview, so it's
  // safe to revoke as soon as the dialog closes (cancel) or apply hands off a baked File.
  const closeEditor = () => {
    if (editing) URL.revokeObjectURL(editing.src);
    setEditing(null);
  };

  // Photo upload: ask Convex for a one-shot upload URL, POST the blob to it, then
  // attach the returned storageId to this copy. The getCopyInstanceView query
  // reads the same table so Convex reactivity refreshes the strip automatically.
  // The WHOLE pipeline (URL grant → raw fetch POST → attach) is the mutationFn so
  // isPending covers the full upload span (busy-state rule v2).
  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = (await res.json()) as { storageId: string };
      await addCopyPhoto({
        copyId: copyId as Id<"ownedPuzzles">,
        fileId: storageId as Id<"_storage">,
      });
    },
    onSuccess: () => toast.success(t("photoAdded")),
    onError: () => toast.error(t("photoFailed")),
    onSettled: () => {
      if (inputRef.current) inputRef.current.value = "";
    },
  });
  const uploading = uploadPhoto.isPending;

  return (
    <div className="flex gap-3.5 overflow-x-auto pb-1.5">
      {gallery.map((photo, i) => (
        <button
          key={photo.id}
          type="button"
          onClick={() => openLightbox(i)}
          aria-label={photo.caption ?? t("photos")}
          className="bg-muted focus-visible:ring-ring relative aspect-[4/3] w-[210px] shrink-0 cursor-pointer overflow-hidden rounded-lg shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            alt={photo.caption ?? ""}
            className="h-full w-full object-contain"
          />
          {/* Top-left status chips: which photo is the cover + a "pending review" flag while a
              freshly-uploaded photo is being moderated (only the uploader sees their pending ones). */}
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {coverImageId === photo.id && (
              <span className="bg-jigsaw-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                <Star className="h-2.5 w-2.5" fill="currentColor" />
                {t("photoCover")}
              </span>
            )}
            {photo.moderationStatus === "pending" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                <Clock className="h-2.5 w-2.5" />
                {t("photoPending")}
              </span>
            )}
          </div>
          {photo.caption && (
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-5 text-left text-xs font-semibold text-white">
              {photo.caption}
            </figcaption>
          )}
        </button>
      ))}
      {canAdd && (
        <label
          className={cn(
            "border-border text-muted-foreground flex aspect-[4/3] w-[150px] shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-xs font-semibold",
            uploading && "pointer-events-none opacity-60",
          )}
        >
          <ImagePlus className="h-5 w-5" />
          {uploading ? t("uploading") : t("addPhoto")}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setEditing({
                  src: URL.createObjectURL(file),
                  fileName: file.name,
                });
              }
              e.target.value = "";
            }}
          />
        </label>
      )}
      {gallery.length === 0 && !canAdd && (
        <p className="text-muted-foreground text-sm">{t("noPhotos")}</p>
      )}
      {gallery.length > 0 && (
        <PhotoLightbox
          gallery={gallery}
          index={activeIndex}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          onIndexChange={setActiveIndex}
          canSetCover={canAdd}
          copyId={copyId}
          coverImageId={coverImageId}
        />
      )}
      <ImageEditorDialog
        src={editing?.src ?? null}
        fileName={editing?.fileName ?? "photo.jpg"}
        onApply={(file) => {
          uploadPhoto.mutate(file);
          closeEditor();
        }}
        onClose={closeEditor}
      />
    </div>
  );
}

function HistoryGroup({
  icon,
  title,
  meta,
  empty,
  children,
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
  empty?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <SectionHead icon={icon} title={title} meta={meta} />
      {empty ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <div>{children}</div>
      )}
    </section>
  );
}

function TimelineRow({
  icon,
  iconClass,
  title,
  sub,
  right,
  last,
  children,
}: {
  icon: ReactNode;
  iconClass: string;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex gap-3.5", !last && "pb-5")}>
      <div className="flex shrink-0 flex-col items-center">
        <span
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-full text-white",
            iconClass,
          )}
        >
          {icon}
        </span>
        {!last && <span className="bg-border mt-1.5 w-0.5 flex-1" />}
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-baseline justify-between gap-2.5">
          <span className="text-foreground text-sm font-semibold">{title}</span>
          {right}
        </div>
        {sub && (
          <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div>
        )}
        {children}
      </div>
    </div>
  );
}

function LoanStatusPill({ status }: { status: string }) {
  const t = useTranslations("copyInstance");
  const tone =
    status === "open"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
      : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", tone)}
    >
      {t(`loanStatus.${status}`)}
    </span>
  );
}

function CommunityRating({
  community,
}: {
  community: CopyInstanceView["community"];
}) {
  const t = useTranslations("copyInstance");
  const total = community.breakdown.reduce((a, b) => a + b, 0) || 1;
  return (
    <section>
      <SectionHead icon={<StarGlyph />} title={t("communityRating")} />
      <div className="mb-3.5 flex items-end gap-3.5">
        <div className="font-heading text-foreground text-4xl font-bold leading-none">
          {community.rating}
        </div>
        <div className="pb-0.5">
          <StarRating value={Math.round(community.rating)} size="sm" />
          <div className="text-muted-foreground mt-1 text-xs">
            {t("communityRatings", { count: community.count })}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {[5, 4, 3, 2, 1].map((star, i) => {
          const n = community.breakdown[i];
          return (
            <div key={star} className="flex items-center gap-2.5">
              <span className="text-muted-foreground inline-flex w-7 items-center justify-end gap-0.5 text-xs">
                {star}★
              </span>
              <span className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                <span
                  className="block h-full rounded-full bg-yellow-400"
                  style={{ width: `${(n / total) * 100}%` }}
                />
              </span>
              <span className="text-muted-foreground w-6 text-right font-mono text-xs">
                {n}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// A small inline star glyph for section heads (matching the lucide stroke style).
function StarGlyph() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function CommentsSection({ copyId }: { copyId: string }) {
  const t = useTranslations("copyInstance");
  const format = useFormatter();
  const { data: comments } = useQuery(
    convexQuery(gateway.social.listPuzzleComments, {
      copyId: copyId as Id<"ownedPuzzles">,
    }),
  );
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  const postComment = useMutation({
    mutationFn: useConvexMutation(gateway.social.postPuzzleComment),
  });

  const [text, setText] = useState("");
  const [rating, setRating] = useState(0);
  const posting = postComment.isPending;
  const [now] = useState(() => Date.now());

  const list = comments ?? [];

  const relative = (timestamp: number) =>
    format.relativeTime(new Date(timestamp), now);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await postComment.mutateAsync({
        copyId: copyId as Id<"ownedPuzzles">,
        text: trimmed,
        ...(rating > 0 ? { rating } : {}),
      });
      setText("");
      setRating(0);
    } catch {
      toast.error(t("commentFailed"));
    }
  };

  return (
    <section>
      <SectionHead
        icon={<MessageCircle className="h-4 w-4" />}
        title={t("comments")}
        meta={String(list.length)}
      />

      {/* Composer */}
      <div className="mb-4 flex gap-2.5">
        <Avatar className="h-8 w-8">
          {me?.avatar && <AvatarImage src={me.avatar} alt={me.name} />}
          <AvatarFallback className="text-xs font-medium">
            {(me?.name ?? "?").slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex gap-2">
            <Input
              placeholder={t("addComment")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              className="flex-1"
            />
            <Button
              variant="brand"
              onClick={() => void submit()}
              disabled={posting || text.trim().length === 0}
            >
              {t("post")}
            </Button>
          </div>
          <StarRating
            value={rating}
            onChange={setRating}
            size="sm"
            label={t("rateOptional")}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex flex-col">
        {list.map((comment, i) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            relative={relative}
            last={i === list.length - 1}
          />
        ))}
        {list.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("noComments")}</p>
        )}
      </div>
    </section>
  );
}

function CommentRow({
  comment,
  relative,
  last,
}: {
  comment: PuzzleComment;
  relative: (timestamp: number) => string;
  last: boolean;
}) {
  const name = comment.author.name;
  return (
    <div className={cn("flex gap-3 py-3.5", !last && "border-border border-b")}>
      <Avatar className="h-8 w-8">
        {comment.author.avatar && (
          <AvatarImage src={comment.author.avatar} alt={name} />
        )}
        <AvatarFallback className="text-xs font-medium">
          {name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-sm font-semibold">{name}</span>
          {comment.rating != null && (
            <StarRating value={comment.rating} size="sm" />
          )}
          <span className="text-muted-foreground text-xs">
            {relative(comment.createdAt)}
          </span>
        </div>
        <p className="text-foreground/90 mt-1 text-sm leading-relaxed">
          {comment.text}
        </p>
      </div>
    </div>
  );
}

// Render a ProjectedMember inline: a revealed member shows their name; an
// anonymised one shows the i18n "Anonymous user" label — never a real name.
function ProjectedName({ member }: { member: ProjectedMember }) {
  const t = useTranslations("copyInstance");
  if (member.anonymous) {
    return <span className="font-semibold">{t("anonymousUser")}</span>;
  }
  return <span className="font-semibold">{member.member.name}</span>;
}
