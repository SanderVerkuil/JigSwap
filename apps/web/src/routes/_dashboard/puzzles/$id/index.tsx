import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import { ImageZoom } from "@/components/common/image-zoom";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { convexErrorCode } from "@/components/exchange/request-trade";
import { useConditionLabel } from "@/components/library/condition";
import { EmptyState } from "@/components/library/empty-state";
import {
  difficultyClasses,
  MemberAvatar,
  PuzzleCoverFallback,
  SectionHead,
  StarGlyph,
  Stat,
} from "@/components/puzzles/catalog-detail-parts";
import { ReportDialog } from "@/components/safety/report-dialog";
import { DeleteOwnContentButton } from "@/components/social/delete-own-content-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StarRating } from "@/components/ui/star-rating";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { gateway, Id } from "@/gateway";
import { useBoxArtInCheck } from "@/hooks/use-box-art-check";
import { useFavorites } from "@/hooks/use-favorites";
import {
  authorMemberIdOf,
  projectedAuthorOf,
  useMemberDisplayName,
  useProjectedMemberName,
} from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import { REVIEW_TEXT_MAX_LENGTH } from "@/lib/text-limits";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link as RouterLink,
  useNavigate,
} from "@tanstack/react-router";
// Not convex/react's: this list is read through stream(), whose pages only keep their ends when the
// client pins them, and this hook does (without it, a change loses or repeats a row between pages).
import { usePaginatedQuery } from "convex-helpers/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftRight,
  ChevronRight,
  Flag,
  Heart,
  MessageCircle,
  Pencil,
  Plus,
  Star,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

// The web tier derives Convex view types from the gateway (not @jigswap/contracts directly).
type View = NonNullable<
  FunctionReturnType<typeof gateway.library.getPuzzleDefinitionView>
>;
type AvailableCopy = View["availableCopies"][number];
type PuzzleReview = FunctionReturnType<
  typeof gateway.social.listPuzzleReviews
>["page"][number];

// How many reviews a page of the list adds.
const REVIEW_PAGE_SIZE = 20;

// Hero action buttons wrap a long label (e.g. Dutch "Vind een exemplaar om te ruilen") onto a
// second line instead of overflowing the narrow info column beside the cover on tablets.
const wrappingAction = "h-auto min-h-9 max-w-full whitespace-normal py-1.5";

export const Route = createFileRoute("/_dashboard/puzzles/$id/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "puzzle") }],
  }),
  component: PuzzlePage,
});

function PuzzlePage() {
  const { id } = Route.useParams();
  const { data: view, isError } = useQuery(
    convexQuery(gateway.library.getPuzzleDefinitionView, {
      puzzleId: id as Id<"puzzles">,
    }),
  );

  // A missing puzzle resolves to `null`; a malformed id (fails `v.id("puzzles")` validation) or any
  // other query failure surfaces as `isError` with `view` stuck at `undefined`. Treat both as
  // not-found so an unresolvable puzzle never hangs on the loading skeleton.
  if (view === null || isError) {
    return <PuzzleDefinitionNotFound />;
  }

  if (view === undefined) {
    return <PuzzleDefinitionSkeleton />;
  }

  return <PuzzleDefinitionDetail view={view} puzzleId={id} />;
}

function PuzzleDefinitionSkeleton() {
  return (
    <div className="@container w-full space-y-10">
      <div className="grid gap-7 @md:grid-cols-[200px_minmax(0,1fr)] @2xl:grid-cols-[300px_minmax(0,1fr)]">
        <Skeleton className="aspect-square w-full rounded-2xl" />
        <div className="space-y-4">
          <Skeleton className="h-9 w-2/3 rounded-lg" />
          <Skeleton className="h-5 w-1/3 rounded-lg" />
          <Skeleton className="h-8 w-1/2 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-20 w-full max-w-[760px] rounded-xl" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}

function PuzzleDefinitionNotFound() {
  const t = useTranslations("puzzleDefinition");
  return <EmptyState title={t("notFound")} sub={t("notFoundSub")} />;
}

function PuzzleDefinitionDetail({
  view,
  puzzleId,
}: {
  view: View;
  puzzleId: string;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const t = useTranslations("puzzleDefinition");
  const tPuzzles = useTranslations("puzzles");
  const tCatalog = useTranslations("puzzles.puzzles");
  const tDifficulty = useTranslations("puzzles.puzzles.difficulty");
  const conditionLabel = useConditionLabel();
  const format = useFormatter();

  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = isFavorite(puzzleId);
  const boxArtInCheck = useBoxArtInCheck();
  const favoriteLabel = favorited
    ? tCatalog("removeFromFavorites")
    : tCatalog("addToFavorites");

  const {
    definition,
    rating,
    stats,
    ownership,
    availableCopies,
    totalAvailable,
  } = view;
  // The member's own copy, when they have one, is the page's primary destination. It opens in the
  // owner's frame (My Library › My Puzzles), not Browse's /copies frame.
  const ownCopyHref =
    ownership.viewerOwns && ownership.copyId
      ? `/my-puzzles/${ownership.copyId}`
      : null;
  const noCopiesOffered = totalAvailable === 0;
  const noCopiesHintId = useId();

  // Publish the puzzle name so the breadcrumb becomes "Community › Puzzles catalogue › <name>"
  // (the route's pageKey "puzzles" matches the catalogue nav item, which renders the middle
  // crumb). The hero's h1 below is the page's only title heading, so the shell keeps the name
  // as the breadcrumb leaf (and mobile bar text) only.
  usePageHeader(
    () => ({ title: definition.title, titleInContent: true }),
    [definition.title],
  );

  // Only an approved definition (or the viewer's own submission) takes reviews; the server
  // refuses the rest, so neither the action nor the composer is offered there. Loading, or a
  // backend that predates the flag, keeps them.
  const { data: myReviews } = useQuery(
    convexQuery(gateway.solving.getMyReviews, {
      puzzleId: puzzleId as Id<"puzzles">,
    }),
  );
  const canReview = myReviews?.puzzleReviewAllowed !== false;

  // "Write a Review" and "Be the first to rate it" take the member to the review composer and
  // focus its first control, the required star rating (its single tab stop).
  const composerRef = useRef<HTMLDivElement>(null);
  const focusComposer = () => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    composerRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
    composerRef.current
      ?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
      ?.focus();
  };

  // The "topics" pills: the category name first (if any), then each tag.
  const topics = [
    ...(definition.categoryName ? [definition.categoryName] : []),
    ...definition.tags,
  ];

  return (
    <div className="@container flex w-full flex-col gap-10">
      {/* Hero: sized by the content width, not the viewport, so a tablet with the sidebar open
          gets the cover beside the info instead of a full-width cover above it. */}
      <section className="grid items-start gap-7 @md:grid-cols-[200px_minmax(0,1fr)] @2xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* Cover — full width on phones, a 200px then 300px column beside the info once the
            content is wide enough. object-contain (via ImageZoom) shows the whole puzzle; hovering
            opens a side panel that magnifies where the cursor points. */}
        <div className="bg-muted relative aspect-square w-full overflow-hidden rounded-2xl shadow-sm">
          {definition.image ? (
            <ImageZoom
              src={definition.image}
              alt={definition.title}
              fill
              priority
            />
          ) : (
            <PuzzleCoverFallback checking={boxArtInCheck.has(puzzleId)} />
          )}
        </div>

        {/* Info */}
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            {definition.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-base">
            {definition.brand ? `${definition.brand} · ` : ""}
            <span className="font-mono">
              {format.number(definition.pieceCount)}
            </span>{" "}
            {tPuzzles("pieces", { count: definition.pieceCount })}
          </p>

          {/* Rating + difficulty + topics */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            {/* Unrated: say so rather than five empty stars and "0 (0)". The Write a Review action
                below already leads to the composer. */}
            {rating.count > 0 ? (
              <span className="flex items-center gap-1.5">
                <StarRating value={Math.round(rating.rating)} size="sm" />
                <span className="text-muted-foreground text-sm">
                  {rating.rating} ({rating.count})
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground text-sm">
                {t("noRatingsYet")}
              </span>
            )}
            {definition.difficulty && (
              <Badge
                className={cn(
                  "rounded-full border-transparent px-2.5 py-0.5 text-xs font-semibold",
                  difficultyClasses(definition.difficulty),
                )}
              >
                {tDifficulty(definition.difficulty)}
              </Badge>
            )}
            {topics.map((topic, i) => (
              <span
                key={`${topic}-${i}`}
                className="border-border text-foreground inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
              >
                {topic}
              </span>
            ))}
          </div>

          {/* Ownership banner (status only: the primary action below opens the copy) */}
          {ownership.viewerOwns && (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 dark:border-green-900/50 dark:bg-green-900/20">
              <span className="text-sm font-medium text-green-800 dark:text-green-200">
                {t("youOwnACopy")}
                {ownership.condition
                  ? ` — ${t("conditionSuffix", {
                      condition: conditionLabel(ownership.condition),
                    })}`
                  : ""}
              </span>
            </div>
          )}

          {/* Actions in three tiers: one brand primary (the member's own copy when they have
              one, otherwise adding it), outline secondaries with the favourite icon toggle, then
              link-style extras. */}
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {ownCopyHref && (
              <Button variant="brand" className={wrappingAction} asChild>
                <Link href={ownCopyHref}>{t("viewYourCopy")}</Link>
              </Button>
            )}
            {/* Opens the copy-mode add form (definition pre-filled; the member
                fills in condition/availability/cover/notes for their copy). */}
            <Button
              variant={ownCopyHref ? "outline" : "brand"}
              className={wrappingAction}
              onClick={() =>
                router.push(`/my-puzzles/add/new?puzzleId=${puzzleId}`)
              }
            >
              <Plus className="h-4 w-4" />
              {tPuzzles("addToLibrary")}
            </Button>
            {/* Nothing to find while nobody offers a copy: disabled, with the reason below. */}
            <Button
              variant="outline"
              className={wrappingAction}
              disabled={noCopiesOffered}
              aria-describedby={noCopiesOffered ? noCopiesHintId : undefined}
              onClick={() =>
                navigate({ to: "/browse", search: { puzzle: puzzleId } })
              }
            >
              <ArrowLeftRight className="h-4 w-4" />
              {t("findCopyToSwap")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("favorite")}
                  aria-pressed={favorited}
                  onClick={() => void toggleFavorite(puzzleId)}
                >
                  <Heart
                    className={cn(
                      "h-4 w-4",
                      favorited && "fill-red-500 text-red-500",
                    )}
                    aria-hidden
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{favoriteLabel}</TooltipContent>
            </Tooltip>
          </div>
          {noCopiesOffered && (
            <p
              id={noCopiesHintId}
              className="text-muted-foreground mt-2 text-sm"
            >
              {t(
                ownership.viewerOwns
                  ? "noOtherCopiesOffered"
                  : "noCopiesOffered",
              )}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-5">
            {canReview && (
              <Button
                variant="link"
                size="sm"
                className="px-0 has-[>svg]:px-0"
                onClick={focusComposer}
              >
                <Star className="h-4 w-4" />
                {t("writeReview")}
              </Button>
            )}
            <Button
              variant="link"
              size="sm"
              className="px-0 has-[>svg]:px-0"
              asChild
            >
              <Link href={`/puzzles/${puzzleId}/suggest-edit`}>
                <Pencil className="h-4 w-4" />
                {t("suggestEdit")}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <div className="grid max-w-[760px] grid-cols-2 gap-y-6 sm:grid-cols-4">
        <Stat value={stats.communityOwners} label={t("communityOwners")} />
        <Stat
          value={stats.totalCompletions}
          label={t("totalCompletions")}
          divided
        />
        <Stat
          value={
            stats.avgCompletionDays == null ? (
              // No finished completions yet: a bare dash, never a unit on a missing number.
              <>
                <span aria-hidden="true">—</span>
                <span className="sr-only">{t("noValue")}</span>
              </>
            ) : (
              t("avgCompletionValue", { days: stats.avgCompletionDays })
            )
          }
          label={t("avgCompletion")}
          divided
        />
        <Stat
          value={stats.availableToSwap}
          label={t("availableToSwap")}
          divided
        />
      </div>

      {/* Two-column */}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {/* Left: rating + available copies */}
        <div className="space-y-9">
          <CommunityRating
            rating={rating}
            onRate={canReview ? focusComposer : undefined}
          />
          <AvailableToSwap
            copies={availableCopies}
            totalAvailable={totalAvailable}
            puzzleId={puzzleId}
            viewerOwns={ownership.viewerOwns}
          />
        </div>

        {/* Right: reviews */}
        <div>
          <ReviewsSection
            puzzleId={puzzleId}
            composerRef={composerRef}
            canReview={canReview}
          />
        </div>
      </div>
    </div>
  );
}

function CommunityRating({
  rating,
  onRate,
}: {
  rating: View["rating"];
  /** Takes the member to the review composer; absent where the puzzle can't be reviewed. */
  onRate?: () => void;
}) {
  const t = useTranslations("puzzleDefinition");
  // Unrated: an invitation instead of a "0" score over five 0% bars.
  if (rating.count === 0) {
    return (
      <section>
        <SectionHead icon={<StarGlyph />} title={t("communityRating")} />
        <p className="text-muted-foreground text-sm">{t("noRatingsYet")}</p>
        {onRate && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRate}>
            <Star className="h-4 w-4" />
            {t("beFirstToRate")}
          </Button>
        )}
      </section>
    );
  }
  return (
    <section>
      <SectionHead icon={<StarGlyph />} title={t("communityRating")} />
      <div className="mb-3.5 flex items-end gap-3.5">
        <div className="font-heading text-foreground text-4xl font-bold leading-none">
          {rating.rating}
        </div>
        <div className="pb-0.5">
          <StarRating value={Math.round(rating.rating)} size="sm" />
          <div className="text-muted-foreground mt-1 text-xs">
            {t("ratingsCount", { count: rating.count })}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {[5, 4, 3, 2, 1].map((star, i) => {
          const percent = rating.percentages[i];
          return (
            <div key={star} className="flex items-center gap-2.5">
              <span className="text-muted-foreground inline-flex w-7 items-center justify-end gap-0.5 text-xs">
                {star}★
              </span>
              <span className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                <span
                  className="block h-full rounded-full bg-amber-400"
                  style={{ width: `${percent}%` }}
                />
              </span>
              <span className="text-muted-foreground w-9 text-right font-mono text-xs">
                {percent}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function swapTypeClasses(swapType: AvailableCopy["swapType"]) {
  switch (swapType) {
    case "swap":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
    case "lend":
      return "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200";
    default:
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200";
  }
}

// An offering owner's location and partner rating, each only when known (never "★ —").
function ownerMetaLine(owner: AvailableCopy["owner"]) {
  return [
    owner.location,
    owner.avgRating != null ? `★ ${owner.avgRating}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function AvailableToSwap({
  copies,
  totalAvailable,
  puzzleId,
  viewerOwns,
}: {
  copies: AvailableCopy[];
  totalAvailable: number;
  puzzleId: string;
  /** This list leaves out the viewer's own copies, so "nobody offers it" would be untrue. */
  viewerOwns: boolean;
}) {
  const t = useTranslations("puzzleDefinition");
  const displayName = useMemberDisplayName();
  return (
    <section>
      <SectionHead
        icon={<ArrowLeftRight className="h-4 w-4" />}
        title={t("availableToSwapSection")}
        meta={t("copiesCount", { count: totalAvailable })}
      />
      {copies.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t(viewerOwns ? "noOtherCopies" : "noCopies")}
        </p>
      ) : (
        <div className="flex flex-col">
          {copies.map((copy, i) => (
            <Link
              key={copy.copyId}
              href={`/copies/${copy.copyId}`}
              className={cn(
                "hover:bg-muted/40 group flex items-center gap-3 py-3.5 transition-colors",
                i !== copies.length - 1 && "border-border border-b",
              )}
            >
              <MemberAvatar
                source={{ name: copy.owner.name }}
                avatar={copy.owner.avatarUrl}
              />
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate text-sm font-medium">
                  {displayName({ name: copy.owner.name })}
                </div>
                {ownerMetaLine(copy.owner) && (
                  <div className="text-muted-foreground truncate text-xs">
                    {ownerMetaLine(copy.owner)}
                  </div>
                )}
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  swapTypeClasses(copy.swapType),
                )}
              >
                {t(`swapType.${copy.swapType}`)}
              </span>
              <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
            </Link>
          ))}
        </div>
      )}
      {totalAvailable > 0 && (
        <RouterLink
          to="/browse"
          search={{ puzzle: puzzleId }}
          className="text-primary-text mt-3 inline-block text-sm font-semibold hover:underline"
        >
          {t("seeAllCopies", { count: totalAvailable })}
        </RouterLink>
      )}
    </section>
  );
}

function ReviewsSection({
  puzzleId,
  composerRef,
  canReview,
}: {
  puzzleId: string;
  composerRef: React.RefObject<HTMLDivElement | null>;
  canReview: boolean;
}) {
  const t = useTranslations("puzzleDefinition");
  const format = useFormatter();
  const ratingHintId = useId();
  const {
    results: list,
    status: reviewsStatus,
    loadMore,
  } = usePaginatedQuery(
    gateway.social.listPuzzleReviews,
    { puzzleId: puzzleId as Id<"puzzles"> },
    { initialNumItems: REVIEW_PAGE_SIZE },
  );
  const moreReviews =
    reviewsStatus === "CanLoadMore" || reviewsStatus === "LoadingMore";
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  // The caller's own puzzle review (if any) drives the update-mode affordance:
  // prefill the composer and relabel the submit button.
  const { data: myReviews } = useQuery(
    convexQuery(gateway.solving.getMyReviews, {
      puzzleId: puzzleId as Id<"puzzles">,
    }),
  );
  const postReview = useMutation({
    mutationFn: useConvexMutation(gateway.social.postPuzzleReview),
  });

  const [text, setText] = useState("");
  const [rating, setRating] = useState(0);
  const [now] = useState(() => Date.now());
  // The review being reported stays set while the dialog animates closed.
  const [reported, setReported] = useState<PuzzleReview | null>(null);
  const [reporting, setReporting] = useState(false);
  const reportTriggerRef = useRef<HTMLElement | null>(null);
  const projectedName = useProjectedMemberName();

  // Seed the composer once from the existing review, during render (the sanctioned "adjust
  // state when a value changes" pattern — an effect + setState would trip the
  // react-hooks/set-state-in-effect rule); later reactive updates must not clobber what the
  // member is typing.
  const [seeded, setSeeded] = useState(false);
  if (!seeded && myReviews !== undefined) {
    if (myReviews.puzzle) {
      setRating(myReviews.puzzle.rating ?? 0);
      setText(myReviews.puzzle.text ?? "");
    }
    setSeeded(true);
  }

  const hasExistingReview = myReviews?.puzzle != null;

  // Posting needs a rating (only the text is optional); until one is chosen, a hint says so and
  // describes both the stars and the disabled Post button.
  const needsRating = rating < 1;

  const relative = (timestamp: number) =>
    format.relativeTime(new Date(timestamp), now);

  const submit = async () => {
    const trimmed = text.trim();
    try {
      await postReview.mutateAsync({
        puzzleId: puzzleId as Id<"puzzles">,
        rating,
        ...(trimmed ? { text: trimmed } : {}),
      });
      toast.success(hasExistingReview ? t("reviewUpdated") : t("reviewPosted"));
    } catch (error) {
      // A review stored before the length cap can be longer than the field allows: say why.
      const code = convexErrorCode(error);
      toast.error(
        code === "RateLimited"
          ? t("reviewRateLimited")
          : code === "ReviewTextTooLong"
            ? t("reviewTooLong")
            : t("reviewFailed"),
      );
    }
  };

  return (
    <section>
      <SectionHead
        icon={<MessageCircle className="h-4 w-4" />}
        title={t("reviews")}
        meta={moreReviews ? `${list.length}+` : String(list.length)}
      />

      {/* Composer: the required rating first, then the optional text, then Post. */}
      {!canReview ? (
        <p className="text-muted-foreground mb-4 text-sm">
          {t("reviewNotOpen")}
        </p>
      ) : (
        <div ref={composerRef} className="mb-4 flex gap-2.5">
          <MemberAvatar source={me} avatar={me?.avatar} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div>
              <p className="text-foreground text-sm font-medium">
                {t("yourRating")}
                <span aria-hidden="true" className="text-destructive ml-0.5">
                  *
                </span>
              </p>
              <StarRating
                value={rating}
                onChange={setRating}
                size="lg"
                label={t("yourRating")}
                required
                clearable
                describedBy={needsRating ? ratingHintId : undefined}
              />
              {needsRating && (
                <p id={ratingHintId} className="text-muted-foreground text-xs">
                  {t("chooseRatingToPost")}
                </p>
              )}
            </div>
            {/* Grows with the text, and Enter is a line break: a review is public, so only Post
                publishes it. Same field as the post-solve follow-up (two-level-review-fields). */}
            <div className="flex flex-col gap-2">
              <Textarea
                placeholder={t("reviewPlaceholder")}
                value={text}
                maxLength={REVIEW_TEXT_MAX_LENGTH}
                onChange={(e) => setText(e.target.value)}
                className="max-h-60"
              />
              <Button
                variant="brand"
                className="self-end"
                onClick={() => void submit()}
                disabled={postReview.isPending || needsRating}
                aria-describedby={needsRating ? ratingHintId : undefined}
              >
                {hasExistingReview ? t("updateReview") : t("post")}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {t("reviewPublicNote")}
            </p>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex flex-col">
        {list.map((review, i) => (
          <ReviewRow
            key={review.id}
            review={review}
            puzzleId={puzzleId}
            relative={relative}
            last={i === list.length - 1}
            // Other members' reviews with text (a rating alone has nothing to report; the server
            // refuses it, and your own, too); not until we know who you are. A hidden author can be
            // reported as well: the report names the review, not them.
            onReport={
              me &&
              authorMemberIdOf(review.author) !== me._id &&
              review.text != null
                ? (trigger) => {
                    reportTriggerRef.current = trigger;
                    setReported(review);
                    setReporting(true);
                  }
                : undefined
            }
            // The composer was seeded from this review: empty it once the review is gone.
            onDeleted={() => {
              setRating(0);
              setText("");
            }}
          />
        ))}
        {reviewsStatus === "Exhausted" && list.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("noReviews")}</p>
        )}
        {/* aria-disabled, not disabled, while the next page loads: a disabled button drops focus. */}
        {moreReviews && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 self-center pointer-coarse:min-h-11"
            aria-disabled={reviewsStatus === "LoadingMore"}
            onClick={() => {
              if (reviewsStatus === "CanLoadMore") loadMore(REVIEW_PAGE_SIZE);
            }}
          >
            {t("showMoreReviews")}
          </Button>
        )}
      </div>
      {reported && (
        <ReportDialog
          target={{
            kind: "puzzleReview",
            id: reported.id,
            snippet: reported.text ?? "",
          }}
          name={projectedName(
            projectedAuthorOf(reported.author),
            t("anonymousReviewer"),
          )}
          memberId={
            authorMemberIdOf(reported.author) as Id<"users"> | undefined
          }
          open={reporting}
          onOpenChange={setReporting}
          returnFocusRef={reportTriggerRef}
        />
      )}
    </section>
  );
}

function ReviewRow({
  review,
  puzzleId,
  relative,
  last,
  onReport,
  onDeleted,
}: {
  review: PuzzleReview;
  puzzleId: string;
  relative: (timestamp: number) => string;
  last: boolean;
  /** Offered on other members' reviews with text: opens the report dialog. */
  onReport?: (trigger: HTMLButtonElement) => void;
  onDeleted: () => void;
}) {
  const tSafety = useTranslations("safety");
  const t = useTranslations("puzzleDefinition");
  const projectedName = useProjectedMemberName();
  // A private author the viewer isn't connected with arrives anonymous (SEC-11): label only, and
  // the avatar and initial show only for a revealed author.
  const author = projectedAuthorOf(review.author);
  const name = projectedName(author, t("anonymousReviewer"));
  const member = author.anonymous ? null : author.member;
  return (
    <div className={cn("flex gap-3 py-3.5", !last && "border-border border-b")}>
      <MemberAvatar source={member} avatar={member?.avatar} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-sm font-semibold">{name}</span>
          {review.rating != null && (
            <StarRating value={review.rating} size="sm" />
          )}
          <span className="text-muted-foreground text-xs">
            {relative(review.updatedAt)}
          </span>
        </div>
        {review.text != null && (
          <p className="text-foreground/90 mt-1 text-sm leading-relaxed whitespace-pre-wrap">
            {review.text}
          </p>
        )}
      </div>
      {onReport && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={tSafety("reportReviewFrom", { name })}
          title={tSafety("reportReview")}
          onClick={(event) => onReport(event.currentTarget)}
          className="text-muted-foreground hover:text-destructive -my-1.5 size-11 shrink-0 md:size-8"
        >
          <Flag className="size-4" aria-hidden />
        </Button>
      )}
      {review.canDelete && (
        <DeleteOwnContentButton
          kind="review"
          mutation={gateway.social.deletePuzzleReview}
          args={{ puzzleId: puzzleId as Id<"puzzles"> }}
          onDeleted={onDeleted}
          iconOnly
        />
      )}
    </div>
  );
}
