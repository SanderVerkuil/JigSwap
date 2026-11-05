import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import { ShareWithCirclesDialog } from "@/components/circles/share-with-circles-dialog";
import { ImageZoom } from "@/components/common/image-zoom";
import { acquisitionMonthOf } from "@/components/copies/acquisition-month";
import { CopyOfferSwitches } from "@/components/copies/copy-offer-switches";
import { CopyOwner } from "@/components/copies/copy-owner";
import { copyPhotoError } from "@/components/copies/copy-photo-error";
import { CopyStatusLine } from "@/components/copies/copy-status-line";
import { formatCopyTenure } from "@/components/copies/copy-tenure";
import { EditCopyDialog } from "@/components/copies/edit-copy-dialog";
import { PhotoLightbox } from "@/components/copies/photo-lightbox";
import { type NavContext } from "@/components/dashboard-layout/nav-context";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import {
  convexErrorCode,
  REQUEST_ACTION_ICONS,
  requestActionKey,
} from "@/components/exchange/request-trade";
import {
  RequestTradeDialog,
  type RequestableCopy,
} from "@/components/exchange/request-trade-dialog";
import { HouseholdAccess } from "@/components/household/household-access";
import { ImageEditorDialog } from "@/components/image-editor/image-editor-dialog";
import {
  conditionDotClass,
  useConditionLabel,
} from "@/components/library/condition";
import { EmptyState } from "@/components/library/empty-state";
import { MemberInitial } from "@/components/members/member-initial";
import { copyMessageRoute } from "@/components/messaging/copy-conversation";
import { PendingPhotoPlaceholder } from "@/components/photos/pending-photo-placeholder";
import { difficultyClasses } from "@/components/puzzles/difficulty-classes";
import { DeleteOwnContentButton } from "@/components/social/delete-own-content-button";
import { FinishSolveDialog } from "@/components/solving/finish-solve-dialog";
import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
import { StartSolveDialog } from "@/components/solving/start-solve-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilePickButton } from "@/components/ui/file-pick-button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StarRating } from "@/components/ui/star-rating";
import { gateway, Id } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { useUploadLimitMessage } from "@/hooks/use-upload-limit-message";
import { formatCompletionDate } from "@/lib/completion-format";
import { DATE_ONLY_TIME_ZONE } from "@/lib/date-input";
import { durationParts } from "@/lib/humanize-duration";
import {
  projectedAuthorOf,
  useMemberDisplayName,
  useProjectedMemberName,
} from "@/lib/member-display-name";
import { COMMENT_TEXT_MAX_LENGTH } from "@/lib/text-limits";
import { isUploadRateLimited, mintUploadUrl } from "@/lib/upload-rate-limit";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
  UserRound,
  Users,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
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
// Shared copy-detail screen used by BOTH the public route (/copies/$id, owned=false)
// and the owner route (/my-puzzles/$id, owned=true). `owned` drives the breadcrumb
// framing and gates the owner route: viewing a copy you don't own under /my-puzzles
// bounces to the public /copies view.
export function CopyInstanceScreen({
  copyId,
  owned,
  navContext = null,
}: {
  copyId: string;
  owned: boolean;
  /** Parsed `?from=` context (e.g. arrived from a collection); null when absent/malformed. */
  navContext?: NavContext | null;
}) {
  const router = useRouter();
  const {
    data: copy,
    isPending: copyPending,
    isError,
  } = useQuery(
    convexQuery(gateway.library.getCopyInstanceView, {
      copyId: copyId as Id<"ownedPuzzles">,
    }),
  );

  // Household members may open a housemate's copy under /my-puzzles too (it is in their library).
  const notOwner =
    owned &&
    copy != null &&
    copy.viewerIsOwner === false &&
    copy.household === null;
  useEffect(() => {
    if (notOwner) router.push(`/copies/${copyId}`);
  }, [notOwner, copyId, router]);

  // A missing copy resolves to `null`; a malformed id or any other query failure surfaces as
  // `isError` with `copy` stuck at `undefined`. Treat both as not-found so an unresolvable copy
  // never hangs on the loading skeleton.
  if (copy === null || isError) {
    return <CopyInstanceNotFound />;
  }

  if (copyPending || copy === undefined || notOwner) {
    return <CopyInstanceSkeleton />;
  }

  return (
    <CopyInstanceDetail
      copy={copy}
      copyId={copyId}
      owned={owned}
      navContext={navContext}
    />
  );
}

function CopyInstanceSkeleton() {
  return (
    <div className="w-full space-y-8">
      <div className="grid gap-7 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Skeleton className="mx-auto aspect-square w-full max-w-[40vh] rounded-2xl lg:mx-0 lg:max-w-none" />
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

function CopyInstanceDetail({
  copy,
  copyId,
  owned,
  navContext,
}: {
  copy: CopyInstanceView;
  copyId: string;
  owned: boolean;
  navContext: NavContext | null;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const t = useTranslations("copyInstance");
  const tShell = useTranslations("shell");
  const tOwner = useTranslations("copyOwner");
  const tConversation = useTranslations("copyConversation");
  const tRequest = useTranslations("tradeRequest.cta");
  const tCircles = useTranslations("circles");
  const tPuzzles = useTranslations("puzzles");
  const tLogSolve = useTranslations("solving.logSolve");
  const tStart = useTranslations("solving.startSolve");
  const tCompletions = useTranslations("solving.completions");
  const tDifficulty = useTranslations("puzzles.puzzles.difficulty");
  const conditionLabel = useConditionLabel();
  const format = useFormatter();
  const projectedName = useProjectedMemberName();
  // A stable "now" captured once per mount, so duration/relative-time renders are
  // idempotent (calling Date.now() during render is an impure-render violation).
  const [now] = useState(() => Date.now());

  const { snapshot, stats, community, gallery } = copy;
  const availability = snapshot.availability;
  const isAvailable =
    availability.forTrade || availability.forSale || availability.forLend;
  // The request button names what the owner offers ("Ask to borrow" on a lend-only copy).
  const requestAction = requestActionKey(availability);
  const RequestIcon = REQUEST_ACTION_ICONS[requestAction];

  // Owner action dialogs. `logOpen` drives the completion logger; `editOpen` drives the inline
  // copy editor (also reachable from the page-head Edit button registered below).
  const [logOpen, setLogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // The photo strip's file input, so the copy editor's "Add photo" can open the same picker.
  const addPhotoInputRef = useRef<HTMLInputElement>(null);
  // Where the editor opens: on its acquisition fields when reached from "Add details".
  const [editFocus, setEditFocus] = useState<"acquisition" | undefined>();
  const openEditor = (focus?: "acquisition") => {
    setEditFocus(focus);
    setEditOpen(true);
  };
  // The owner's "Share with circles" dialog.
  const [shareOpen, setShareOpen] = useState(false);
  // The trade-request dialog's target (null = closed); set from the non-owner Request action.
  const [requestCopy, setRequestCopy] = useState<RequestableCopy | null>(null);
  // Start/Finish solve swap: `startOpen` drives the start dialog; `finishTarget` holds the
  // in-progress completion being finished (null = finish dialog closed).
  const [startOpen, setStartOpen] = useState(false);
  const [finishTarget, setFinishTarget] = useState<{
    completionId: string;
    startDate: number;
  } | null>(null);

  // The copy is in the viewer's library: they own it, or a household member does.
  const inLibrary = copy.viewerIsOwner || copy.household !== null;
  // Who may log their own solves here: the owner, any household member (view or manage) and the
  // borrower who has it right now (the solve mutations allow the holder) — completions stay
  // personal. Management (sharing toggles, edit, photos) needs viewerCanManage. A backend without
  // `viewerHoldsCopy` leaves the borrower out, as before.
  const canSolve = inLibrary || copy.viewerHoldsCopy === true;
  // The borrower has this copy in hand: lending it out doesn't clear its offer flags, but asking
  // for it makes no sense to them. They keep Message.
  const canRequest = isAvailable && copy.viewerHoldsCopy !== true;

  // The caller's solve history on this copy (caller-scoped server-side), powering the
  // Start puzzle ↔ Finish solve swap below. Only for viewers who may solve here, so other
  // viewers skip the query entirely.
  const { data: myHistory } = useQuery(
    convexQuery(
      gateway.solving.completionHistory,
      canSolve && copy.aggregateId ? { copyId: copy.aggregateId } : "skip",
    ),
  );
  // The CALLER's most recent in-progress solve on this copy (caller-scoped server-side).
  const myInProgress = (myHistory ?? [])
    .filter((c) => !c.isCompleted && c.aggregateId)
    .sort((a, b) => b.startDate - a.startDate)[0];

  // Custody for the status line: the copy's open loan, and (for managers, who may recall it) its
  // loan id from lending.lentOut, which lists the open loans the caller may manage.
  const openLoanEntry = copy.loans.find((loan) => loan.status === "open");
  const { data: lentOut } = useQuery(
    convexQuery(
      gateway.lending.lentOut,
      copy.viewerCanManage && openLoanEntry ? {} : "skip",
    ),
  );
  const openLoan = openLoanEntry
    ? {
        puzzleTitle: snapshot.title,
        borrowerName: projectedName(openLoanEntry.borrower, t("anonymousUser")),
        openedAt: openLoanEntry.openedAt,
        loanId:
          lentOut?.find((loan) => loan.copyDocId === copy.copyId)?.loanId ??
          null,
      }
    : null;

  // When the arriving link carried `?from=collection:<id>`, resolve that collection so the
  // page head can show contextual breadcrumbs instead of the canonical trail below. Skipped
  // (no query) when there's no context; unreadable/missing collections resolve to null and
  // the canonical trail applies exactly as if there were no context at all.
  const { data: navCollection } = useQuery(
    convexQuery(
      gateway.collections.byId,
      navContext
        ? { collectionId: navContext.id as Id<"collections"> }
        : "skip",
    ),
  );

  // Publish the page head: the puzzle name as the title (replacing the generic
  // "Owned copy"), the breadcrumb trail, and the owner-only Edit action. For the
  // owner route (owned) the crumbs are left to the shell's auto trail (My Library ›
  // My Puzzles › <name>, since /my-puzzles/$id's pageKey matches the nav item);
  // the public route publishes an explicit Community › Browse Puzzles › <name> trail (the crumb
  // uses Browse's own nav label, since that is where it leads).
  // A readable `?from=collection:<id>` context overrides both with My Library ›
  // Collections › <name> and highlights Collections in the sidebar; no context (or an
  // unreadable/malformed one) falls back to the behavior above, byte-identical.
  usePageHeader(
    () => ({
      title: snapshot.title,
      // The body renders the title as this page's h1 below md; from md the head's h1 is it.
      ownsHeading: "phone",
      crumbs: navCollection
        ? [
            { label: tShell("groups.library.label"), href: "/library" },
            { label: tShell("pages.collections.title"), href: "/collections" },
            {
              label: navCollection.name,
              href: `/collections/${navContext?.id}`,
            },
          ]
        : owned
          ? undefined
          : [
              { label: tShell("groups.community.label"), href: "/community" },
              { label: tShell("pages.browse.title"), href: "/browse" },
            ],
      actions: copy.viewerCanManage ? (
        <Button variant="outline" onClick={() => openEditor()}>
          <Edit className="h-4 w-4" />
          {t("actions.edit")}
        </Button>
      ) : null,
      // Neither /copies/$id nor /my-puzzles/$id matches a nav item's href, so the
      // sidebar's pathname-prefix match would highlight nothing; override with the
      // nav item that frames this copy for the current viewer (or Collections when
      // arriving from one via the resolved nav context).
      activeNavKey: navCollection
        ? "collections"
        : inLibrary
          ? "myPuzzles"
          : "browse",
    }),
    [
      snapshot.title,
      owned,
      inLibrary,
      copy.viewerCanManage,
      t,
      tShell,
      navContext?.id,
      navCollection,
    ],
  );

  const formatDay = (timestamp: number) =>
    format.dateTime(new Date(timestamp), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  // A solve date is a calendar date stored as UTC midnight (lib/date-input), so it formats in UTC.
  const formatSolveDay = (timestamp: number) =>
    format.dateTime(new Date(timestamp), {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: DATE_ONLY_TIME_ZONE,
    });

  const formatMonth = (timestamp: number) =>
    format.dateTime(new Date(timestamp), { year: "numeric", month: "short" });
  // A stored value that isn't a real date (the server has refused them since UX-97) counts as not
  // recorded: the manager gets "Add details" to fix it, not "Invalid Date".
  const acquiredAt =
    snapshot.acquisitionDate != null &&
    acquisitionMonthOf(snapshot.acquisitionDate, "UTC") !== null
      ? snapshot.acquisitionDate
      : null;

  // Humanize a solve duration (minutes) to a localized "2 hours" / "1 day" / "1 week" via the
  // largest sensible unit — Intl unit formatting handles plurals + locale.
  const formatDuration = (minutes: number) => {
    const { value, unit } = durationParts(minutes);
    return format.number(value, { style: "unit", unit, unitDisplay: "long" });
  };

  return (
    <div className="flex w-full flex-col gap-10">
      {/* Hero */}
      <section className="grid items-start gap-7 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Cover — capped at 40vh and centred below lg so the title, status and actions start on the
            first screen of a phone; beside the info column at lg. Hovering opens a side panel that
            magnifies where the cursor points. */}
        <div className="bg-muted relative mx-auto aspect-square w-full max-w-[40vh] overflow-hidden rounded-2xl shadow-sm lg:mx-0 lg:max-w-[300px]">
          {snapshot.image ? (
            <ImageZoom
              src={snapshot.image}
              alt={snapshot.title}
              fill
              priority
            />
          ) : (
            <div className="from-jigsaw-primary/20 to-jigsaw-primary text-jigsaw-primary-foreground/70 absolute inset-0 flex items-center justify-center bg-gradient-to-br">
              <Puzzle className="h-1/3 w-1/3" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0">
          {/* From md the shell page head already shows the title (published above). */}
          <h1 className="font-heading text-3xl font-bold tracking-tight md:hidden">
            {snapshot.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-base md:mt-0">
            {snapshot.brand ? `${snapshot.brand} · ` : ""}
            <span className="font-mono">
              {format.number(snapshot.pieceCount)}
            </span>{" "}
            {tPuzzles("pieces", { count: snapshot.pieceCount })}
            {/* Only when the definition page would open for this viewer (not for a definition that
                is no longer approved, unless they submitted it or are an admin). Hidden only on an
                explicit false: web can deploy before the backend that sends the field, and an
                absent value must keep the link for approved definitions. */}
            {copy.viewerMayOpenDefinition !== false && (
              <>
                {" · "}
                <Link
                  href={`/puzzles/${copy.puzzleId}`}
                  className="text-primary-text font-semibold hover:underline"
                >
                  {t("viewPuzzlePage")}
                </Link>
              </>
            )}
          </p>

          {/* Status: custody, offers and who can see it, in one line (offers only for visitors). */}
          <CopyStatusLine
            detailed={copy.viewerCanManage}
            availability={availability}
            visibilityPreference={
              snapshot.visibilityPreference ?? snapshot.visibility
            }
            openLoan={openLoan}
          />

          {/* Badges */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {snapshot.difficulty && (
              <Badge
                className={cn(
                  "rounded-full border-transparent px-2.5 py-0.5 text-xs font-semibold",
                  difficultyClasses(snapshot.difficulty),
                )}
              >
                {tDifficulty(snapshot.difficulty)}
              </Badge>
            )}
            <span className="border-border text-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold">
              <span
                className={cn(
                  "h-2 w-2 rounded-sm",
                  conditionDotClass(snapshot.condition),
                )}
              />
              {conditionLabel(snapshot.condition)}
            </span>
            {myInProgress && (
              <Badge variant="secondary" className="rounded-full text-xs">
                <Clock className="mr-1 h-3 w-3" />
                {tCompletions("inProgress")}
              </Badge>
            )}
          </div>

          {/* Story */}
          {snapshot.notes && (
            <p className="text-foreground/90 mt-4 max-w-[560px] text-pretty leading-relaxed">
              {snapshot.notes}
            </p>
          )}

          {/* Offers (managers): labelled switches that never change the owner's visibility choice. */}
          {copy.viewerCanManage && (
            <div className="mt-5">
              <CopyOfferSwitches
                copyId={copy.aggregateId}
                availability={availability}
                visibilityPreference={
                  snapshot.visibilityPreference ?? snapshot.visibility
                }
                onLoan={openLoanEntry !== undefined}
              />
            </div>
          )}

          {/* Actions */}
          <div className="mt-5 flex flex-wrap gap-2.5">
            {canSolve && (
              <>
                {/* Circle shares are the owner's alone (sharing/shareCopiesToCircle). */}
                {copy.viewerIsOwner && copy.aggregateId != null && (
                  <Button variant="outline" onClick={() => setShareOpen(true)}>
                    <Users className="h-4 w-4" />
                    {tCircles("shareDialog.trigger")}
                  </Button>
                )}
                {!myInProgress && (
                  <Button
                    variant="outline"
                    disabled={copy.aggregateId == null}
                    onClick={() => setLogOpen(true)}
                  >
                    <CircleCheck className="h-4 w-4" />
                    {tLogSolve("trigger")}
                  </Button>
                )}
                {myInProgress ? (
                  <Button
                    variant="outline"
                    disabled={copy.aggregateId == null}
                    onClick={() =>
                      setFinishTarget({
                        completionId: myInProgress.aggregateId!,
                        startDate: myInProgress.startDate,
                      })
                    }
                  >
                    {tStart("finishTrigger")}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    disabled={copy.aggregateId == null}
                    onClick={() => setStartOpen(true)}
                  >
                    {tStart("trigger")}
                  </Button>
                )}
              </>
            )}
            {/* Someone else's copy (a borrower included): request it and/or message the owner. */}
            {!inLibrary && (
              <>
                {/* An anonymous (privacy-projected) owner goes unnamed: propose derives the recipient. */}
                {canRequest && (
                  <Button
                    variant="brand"
                    disabled={!copy.viewerMayRequest}
                    aria-describedby={
                      copy.viewerMayRequest ? undefined : "request-view-only"
                    }
                    onClick={() => {
                      setRequestCopy({
                        copyId: copy.copyId,
                        ownerId: copy.owner.anonymous
                          ? undefined
                          : copy.owner.member._id,
                        owner: copy.owner.anonymous ? null : copy.owner.member,
                        title: snapshot.title,
                        pieceCount: snapshot.pieceCount,
                        coverUrl: snapshot.image,
                        availability,
                      });
                    }}
                  >
                    <RequestIcon className="h-4 w-4" />
                    {tRequest(requestAction)}
                  </Button>
                )}
                {canRequest && !copy.viewerMayRequest && (
                  // The server refuses a request through a view-only circle seat (propose); say why.
                  <p
                    id="request-view-only"
                    className="text-muted-foreground self-center text-sm"
                  >
                    {t("actions.requestViewOnly")}
                  </p>
                )}
                {copy.owner.anonymous ? (
                  // No conversation with a hidden owner (getCopyConversation: ownerHidden).
                  <p className="text-muted-foreground self-center text-sm">
                    {tConversation("ownerHidden")}
                  </p>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => navigate(copyMessageRoute(copyId))}
                  >
                    <MessageCircle className="h-4 w-4" />
                    {t("actions.message")}
                  </Button>
                )}
              </>
            )}
          </div>

          {/* Meta row: after the actions, so they start on the first screen of a phone. */}
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-4">
            <MetaItem
              icon={<UserRound className="h-3.5 w-3.5" />}
              label={tOwner("label")}
              value={
                <CopyOwner
                  owner={copy.owner}
                  householdOwner={copy.household?.owner}
                  viewerIsOwner={copy.viewerIsOwner}
                />
              }
            />
            {/* Acquisition (manager-only data): shown when recorded; when neither part is,
                managers get "Add details", which opens the editor on those fields. */}
            {acquiredAt !== null && (
              <MetaItem
                icon={<Calendar className="h-3.5 w-3.5" />}
                label={t("acquired")}
                value={formatMonth(acquiredAt)}
              />
            )}
            {snapshot.acquisitionSource && (
              <MetaItem
                icon={<Gift className="h-3.5 w-3.5" />}
                label={t("source")}
                value={t(
                  `acquisitionSourceLabel.${snapshot.acquisitionSource}`,
                )}
              />
            )}
            {copy.viewerCanManage &&
              copy.aggregateId != null &&
              acquiredAt === null &&
              !snapshot.acquisitionSource && (
                <MetaItem
                  icon={<Calendar className="h-3.5 w-3.5" />}
                  label={t("acquired")}
                  value={
                    <button
                      type="button"
                      onClick={() => openEditor("acquisition")}
                      className="text-primary-text hover:underline"
                    >
                      {t("addDetails")}
                    </button>
                  }
                />
              )}
            {/* The viewer's own tenure: only the owner has one. */}
            {copy.viewerIsOwner && copy.acquiredByViewerAt !== null && (
              <MetaItem
                icon={<Clock className="h-3.5 w-3.5" />}
                label={t("inYourLibrary")}
                value={formatCopyTenure(copy.acquiredByViewerAt, now, t)}
              />
            )}
            {snapshot.tags.length > 0 && (
              <MetaItem
                icon={<Tag className="h-3.5 w-3.5" />}
                label={t("tags")}
                value={snapshot.tags.join(", ")}
              />
            )}
          </div>

          {copy.household && (
            <HouseholdAccess copyId={copyId} household={copy.household} />
          )}
          <RequestTradeDialog
            copy={requestCopy}
            onOpenChange={(open) => {
              if (!open) setRequestCopy(null);
            }}
          />
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
        {/* The viewer's own rating of this copy: for those who can solve it here (owner and
            household), or anyone who has rated it. */}
        {(canSolve || stats.yourCopyRating != null) && (
          <Stat
            value={stats.yourCopyRating != null ? stats.yourCopyRating : "—"}
            label={t("statYourCopyRating")}
            divided
          />
        )}
      </div>

      {/* Photos */}
      <section>
        <SectionHead
          icon={<ImagePlus className="h-4 w-4" />}
          title={t("photos")}
          meta={t("photosCount", {
            count: gallery.length + copy.pendingPhotos.length,
          })}
        />
        <PhotoStrip
          gallery={gallery}
          pendingPhotos={copy.pendingPhotos}
          photoLimit={copy.photoLimit}
          canAdd={copy.viewerCanManage}
          copyId={copyId}
          coverImageId={snapshot.coverImageId}
          inputRef={addPhotoInputRef}
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
                  c.isYou ? "bg-jigsaw-secondary-strong" : "bg-jigsaw-primary"
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
                  (c.datePrecision ?? "day") !== "day"
                    ? formatCompletionDate(tCompletions, format, {
                        startDate: c.occurredAt,
                        datePrecision: c.datePrecision,
                      })
                    : c.finishMinutes != null
                      ? `${formatSolveDay(c.occurredAt)} · ${t("finishedIn", { duration: formatDuration(c.finishMinutes) })}`
                      : formatSolveDay(c.occurredAt)
                }
              />
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
                iconClass="bg-jigsaw-secondary-strong"
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

        {/* Right: community + copy reviews + comments */}
        <div className="space-y-9">
          <CommunityRating community={community} />
          <CopyReviewsSection copyId={copyId} reviews={copy.copyReviews} />
          <CommentsSection copyId={copyId} />
        </div>
      </div>

      {/* Solve dialogs (owner, household members and the borrower; keyed by aggregateId) + the
          inline copy editor (managers only). */}
      {canSolve && (
        <>
          <LogSolveDialog
            open={logOpen}
            onOpenChange={setLogOpen}
            copyId={copy.aggregateId ?? ""}
            puzzleTitle={snapshot.title}
            viewerIsOwner={copy.viewerCanManage}
          />
          <StartSolveDialog
            open={startOpen}
            onOpenChange={setStartOpen}
            copyId={copy.aggregateId ?? ""}
            puzzleTitle={snapshot.title}
          />
          {finishTarget && (
            <FinishSolveDialog
              open
              onOpenChange={(open) => !open && setFinishTarget(null)}
              completionId={finishTarget.completionId}
              minEndDate={finishTarget.startDate}
              puzzleTitle={snapshot.title}
            />
          )}
          {copy.viewerCanManage && (
            <EditCopyDialog
              open={editOpen}
              onOpenChange={setEditOpen}
              copy={copy}
              onAddPhotos={
                // With every place taken by photos still being checked, the photo strip has no
                // file input for the button to open.
                gallery.length + copy.pendingPhotos.length < copy.photoLimit
                  ? () => addPhotoInputRef.current?.click()
                  : undefined
              }
              focus={editFocus}
            />
          )}
          {copy.viewerIsOwner && copy.aggregateId != null && (
            <ShareWithCirclesDialog
              open={shareOpen}
              onOpenChange={setShareOpen}
              copy={{
                copyId: copy.aggregateId,
                title: snapshot.title,
                availability,
                visibility: snapshot.visibility,
              }}
            />
          )}
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
  pendingPhotos,
  photoLimit,
  canAdd,
  copyId,
  coverImageId,
  inputRef,
}: {
  gallery: CopyInstanceView["gallery"];
  pendingPhotos: CopyInstanceView["pendingPhotos"];
  photoLimit: CopyInstanceView["photoLimit"];
  canAdd: boolean;
  copyId: string;
  coverImageId: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useTranslations("copyInstance");
  const uploadLimitMessage = useUploadLimitMessage();
  const relativeTime = useRelativeTime();
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
      const uploadUrl = await mintUploadUrl(() => generateUploadUrl({}));
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
    onError: (error) => {
      // An upload URL refused by the member's upload limit says to wait (SEC-20); the attach's own
      // refusals (the photo limit, a full copy) name their reason (SEC-19).
      if (isUploadRateLimited(error)) {
        toast.error(uploadLimitMessage(error));
        return;
      }
      const refusal = copyPhotoError(error, Date.now());
      toast.error(
        refusal.key === "photoRateLimited"
          ? t(refusal.key, { when: relativeTime(refusal.retryAt) })
          : t(refusal.key, { max: photoLimit }),
      );
    },
  });
  const uploading = uploadPhoto.isPending;
  // Every photo shown here, placeholders included, takes one of the copy's places; once they are
  // all taken the server refuses another (TooManyImages), so the picker is not offered and
  // nothing is uploaded only to be refused.
  const full = gallery.length + pendingPhotos.length >= photoLimit;

  return (
    // -m-1 p-1: room inside the scroll box so the tiles' focus rings aren't clipped (same layout).
    <div className="-m-1 flex gap-3.5 overflow-x-auto p-1 pb-2.5">
      {gallery.map((photo, i) => (
        <button
          key={photo.id}
          type="button"
          onClick={() => openLightbox(i)}
          aria-label={photo.caption ?? t("photos")}
          className="bg-muted focus-visible:ring-ring relative aspect-[4/3] w-[210px] shrink-0 cursor-pointer overflow-hidden rounded-lg shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {/* The tile is 210px wide (object-contain never draws wider), so the browser picks a
              rendition from srcSet once the photo has them; the lightbox keeps the original. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            srcSet={photo.srcSet}
            sizes={photo.srcSet ? "210px" : undefined}
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
      {/* Other members' photos still being screened: a blurred placeholder, not openable. */}
      {pendingPhotos.map((pending, i) => (
        <PendingPhotoPlaceholder
          key={`pending-${pending.createdAt}-${i}`}
          blurhash={pending.blurhash}
          className="aspect-[4/3] w-[210px] shrink-0 rounded-lg shadow-sm"
        />
      ))}
      {canAdd && full && (
        <p className="border-border text-muted-foreground flex aspect-[4/3] w-[150px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 text-center text-xs font-semibold">
          <ImagePlus className="h-5 w-5 opacity-50" aria-hidden />
          {t("photoLimitTile", { max: photoLimit })}
        </p>
      )}
      {canAdd && !full && (
        // A real button (keyboard-reachable), styled as the dashed "add" tile. Edit copy's "Add
        // photos" opens the same input through inputRef.
        <FilePickButton
          variant="ghost"
          accept="image/*"
          inputRef={inputRef}
          disabled={uploading}
          onFiles={([file]) => {
            if (file) {
              setEditing({
                src: URL.createObjectURL(file),
                fileName: file.name,
              });
            }
          }}
          className="border-border text-muted-foreground flex aspect-[4/3] h-auto w-[150px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-xs font-semibold"
        >
          <ImagePlus className="size-5" />
          {uploading ? t("uploading") : t("addPhoto")}
        </FilePickButton>
      )}
      {gallery.length === 0 && pendingPhotos.length === 0 && !canAdd && (
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
                  style={{ width: `${community.percentages[i]}%` }}
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

// Star-only reviews of THIS physical copy (distinct from the definition-wide community rating
// above). Authors are ProjectedMembers — privacy-projected server-side like every member on this
// page, so an anonymised author renders the "Anonymous user" label and never a real name/avatar.
// The viewer's own review (canDelete, server-computed) carries "Delete my review" (SEC-70).
function CopyReviewsSection({
  copyId,
  reviews,
}: {
  copyId: string;
  reviews: CopyInstanceView["copyReviews"];
}) {
  const t = useTranslations("copyInstance");
  const displayName = useMemberDisplayName();
  const format = useFormatter();
  const formatDay = (timestamp: number) =>
    format.dateTime(new Date(timestamp), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  const average =
    reviews.length > 0
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : null;
  return (
    <section>
      <SectionHead
        icon={<StarGlyph />}
        title={t("copyReviews")}
        meta={String(reviews.length)}
      />
      {average == null ? (
        <p className="text-muted-foreground text-sm">{t("noCopyReviews")}</p>
      ) : (
        <>
          <div className="mb-1.5 flex items-end gap-2.5">
            <div className="font-heading text-foreground text-2xl font-bold leading-none">
              {format.number(average, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
            </div>
            <div className="pb-0.5">
              <StarRating value={Math.round(average)} size="sm" />
            </div>
          </div>
          <div className="flex flex-col">
            {reviews.map((review, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-3 py-3.5",
                  i !== reviews.length - 1 && "border-border border-b",
                )}
              >
                <Avatar className="h-8 w-8">
                  {!review.author.anonymous && review.author.member.avatar && (
                    <AvatarImage
                      src={review.author.member.avatar}
                      alt={displayName(review.author.member)}
                    />
                  )}
                  <AvatarFallback className="text-xs font-medium">
                    <MemberInitial
                      source={
                        review.author.anonymous ? null : review.author.member
                      }
                    />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <ProjectedName member={review.author} />
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {formatDay(review.updatedAt)}
                  </div>
                </div>
                <StarRating value={review.rating} size="sm" />
                {review.canDelete && (
                  <DeleteOwnContentButton
                    kind="copyReview"
                    mutation={gateway.solving.deleteCopyReview}
                    args={{ copyId: copyId as Id<"ownedPuzzles"> }}
                    iconOnly
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {/* Where copy reviews come from: whoever logs a solve of the copy is asked to rate it. */}
      <p className="text-muted-foreground mt-2 text-xs">
        {t("copyReviewsHint")}
      </p>
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
  const displayName = useMemberDisplayName();
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
      });
      setText("");
    } catch (error) {
      toast.error(
        convexErrorCode(error) === "RateLimited"
          ? t("commentRateLimited")
          : t("commentFailed"),
      );
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
          {me?.avatar && <AvatarImage src={me.avatar} alt={displayName(me)} />}
          <AvatarFallback className="text-xs font-medium">
            <MemberInitial source={me} />
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-1 gap-2">
          <Input
            placeholder={t("addComment")}
            value={text}
            maxLength={COMMENT_TEXT_MAX_LENGTH}
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
  const t = useTranslations("copyInstance");
  const projectedName = useProjectedMemberName();
  // A private author the viewer isn't connected with arrives anonymous (SEC-11): label only, and
  // the avatar and initial show only for a revealed author.
  const author = projectedAuthorOf(comment.author);
  const name = projectedName(author, t("anonymousUser"));
  const member = author.anonymous ? null : author.member;
  return (
    <div className={cn("flex gap-3 py-3.5", !last && "border-border border-b")}>
      <Avatar className="h-8 w-8">
        {member?.avatar && <AvatarImage src={member.avatar} alt={name} />}
        <AvatarFallback className="text-xs font-medium">
          <MemberInitial source={member} />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-sm font-semibold">{name}</span>
          <span className="text-muted-foreground text-xs">
            {relative(comment.createdAt)}
          </span>
        </div>
        <p className="text-foreground/90 mt-1 text-sm leading-relaxed">
          {comment.text}
        </p>
      </div>
      {comment.canDelete && (
        <DeleteOwnContentButton
          kind="comment"
          mutation={gateway.social.deletePuzzleComment}
          args={{ commentId: comment.id }}
          iconOnly
        />
      )}
    </div>
  );
}

// Render a ProjectedMember inline: a revealed member shows their name; an
// anonymised one shows the i18n "Anonymous user" label ("Deleted member" for a
// departed account) — never a real name.
function ProjectedName({ member }: { member: ProjectedMember }) {
  const t = useTranslations("copyInstance");
  const projectedName = useProjectedMemberName();
  return (
    <span className="font-semibold">
      {projectedName(member, t("anonymousUser"))}
    </span>
  );
}
