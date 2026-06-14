import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import { EmptyState } from "@/components/library/empty-state";
import {
  difficultyClasses,
  MemberAvatar,
  PuzzleCoverFallback,
  SectionHead,
  StarGlyph,
  Stat,
} from "@/components/puzzles/catalog-detail-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StarRating } from "@/components/ui/star-rating";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftRight,
  ChevronRight,
  MessageCircle,
  Star,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

// The web tier derives Convex view types from the gateway (not @jigswap/contracts directly).
type View = NonNullable<
  FunctionReturnType<typeof gateway.library.getPuzzleDefinitionView>
>;
type AvailableCopy = View["availableCopies"][number];
type PuzzleReview = FunctionReturnType<
  typeof gateway.social.listPuzzleReviews
>[number];

export const Route = createFileRoute("/_dashboard/puzzles/$id")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "puzzle") }],
  }),
  component: PuzzlePage,
});

function PuzzlePage() {
  const { id } = Route.useParams();
  const view = useQuery(gateway.library.getPuzzleDefinitionView, {
    puzzleId: id as Id<"puzzles">,
  });

  if (view === undefined) {
    return <PuzzleDefinitionSkeleton />;
  }

  if (view === null) {
    return <PuzzleDefinitionNotFound />;
  }

  return <PuzzleDefinitionDetail view={view} puzzleId={id} />;
}

function PuzzleDefinitionSkeleton() {
  return (
    <div className="w-full space-y-10">
      <div className="grid gap-7 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Skeleton className="aspect-square w-full rounded-2xl" />
        <div className="space-y-4">
          <Skeleton className="h-4 w-44 rounded-lg" />
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
  const t = useTranslations("puzzleDefinition");
  const tPuzzles = useTranslations("puzzles");
  const tDifficulty = useTranslations("puzzles.puzzles.difficulty");
  const tCondition = useTranslations("puzzles.puzzles.condition");
  const tCopyCondition = useTranslations("copyInstance.conditionLabel");

  const {
    definition,
    rating,
    stats,
    ownership,
    availableCopies,
    totalAvailable,
  } = view;

  // The review composer is focused by the "Write a Review" action.
  const composerRef = useRef<HTMLInputElement>(null);
  const focusComposer = () => {
    composerRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    composerRef.current?.focus();
  };

  const difficultyLabel = (difficulty?: string) =>
    difficulty ? tDifficulty(difficulty) : tDifficulty("unknown");

  // Viewer-copy condition spans the ownedPuzzles union; new_sealed/like_new live
  // in copyInstance.conditionLabel, the rest in puzzles.puzzles.condition.
  const conditionLabel = (condition: string) => {
    switch (condition) {
      case "new_sealed":
        return tCopyCondition("new_sealed");
      case "like_new":
        return tCopyCondition("like_new");
      default:
        return tCondition(condition);
    }
  };

  // The "topics" pills: the category name first (if any), then each tag.
  const topics = [
    ...(definition.categoryName ? [definition.categoryName] : []),
    ...definition.tags,
  ];

  return (
    <div className="flex w-full flex-col gap-10">
      {/* Hero */}
      <section className="grid items-start gap-7 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Cover */}
        <div className="bg-muted relative aspect-square w-full max-w-[300px] overflow-hidden rounded-2xl shadow-sm">
          {definition.image ? (
            <Image
              src={definition.image}
              alt={definition.title}
              fill
              className="object-cover"
            />
          ) : (
            <PuzzleCoverFallback />
          )}
        </div>

        {/* Info */}
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs font-semibold uppercase tracking-[0.18em]">
            {t("eyebrow")}
          </div>
          <h1 className="font-heading mt-2 text-3xl font-bold tracking-tight">
            {definition.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-base">
            {definition.brand ? `${definition.brand} · ` : ""}
            <span className="font-mono">
              {definition.pieceCount.toLocaleString()}
            </span>{" "}
            {tPuzzles("pieces")}
          </p>

          {/* Rating + difficulty + topics */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5">
              <StarRating value={Math.round(rating.rating)} size="sm" />
              <span className="text-muted-foreground text-sm">
                {rating.rating} ({rating.count})
              </span>
            </span>
            <Badge
              className={cn(
                "rounded-full border-transparent px-2.5 py-0.5 text-xs font-semibold",
                difficultyClasses(definition.difficulty),
              )}
            >
              {difficultyLabel(definition.difficulty)}
            </Badge>
            {topics.map((topic, i) => (
              <span
                key={`${topic}-${i}`}
                className="border-border text-foreground inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
              >
                {topic}
              </span>
            ))}
          </div>

          {/* Ownership banner */}
          {ownership.viewerOwns && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 dark:border-green-900/50 dark:bg-green-900/20">
              <span className="text-sm font-medium text-green-800 dark:text-green-200">
                {t("youOwnACopy")}
                {ownership.condition
                  ? ` — ${t("conditionSuffix", {
                      condition: conditionLabel(ownership.condition),
                    })}`
                  : ""}
              </span>
              {ownership.copyId && (
                <Link
                  href={`/copies/${ownership.copyId}`}
                  className="text-sm font-semibold text-green-800 hover:underline dark:text-green-200"
                >
                  {t("viewYourCopy")}
                </Link>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button variant="brand" onClick={() => router.push("/browse")}>
              <ArrowLeftRight className="h-4 w-4" />
              {t("findCopyToSwap")}
            </Button>
            <Button variant="outline" onClick={focusComposer}>
              <Star className="h-4 w-4" />
              {t("writeReview")}
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
          value={t("avgCompletionValue", {
            days: stats.avgCompletionDays ?? "—",
          })}
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
          <CommunityRating rating={rating} />
          <AvailableToSwap
            copies={availableCopies}
            totalAvailable={totalAvailable}
          />
        </div>

        {/* Right: reviews */}
        <div>
          <ReviewsSection puzzleId={puzzleId} composerRef={composerRef} />
        </div>
      </div>
    </div>
  );
}

function CommunityRating({ rating }: { rating: View["rating"] }) {
  const t = useTranslations("puzzleDefinition");
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

function AvailableToSwap({
  copies,
  totalAvailable,
}: {
  copies: AvailableCopy[];
  totalAvailable: number;
}) {
  const t = useTranslations("puzzleDefinition");
  return (
    <section>
      <SectionHead
        icon={<ArrowLeftRight className="h-4 w-4" />}
        title={t("availableToSwapSection")}
        meta={t("copiesCount", { count: totalAvailable })}
      />
      {copies.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noCopies")}</p>
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
                name={copy.owner.name}
                avatar={copy.owner.avatarUrl}
              />
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate text-sm font-medium">
                  {copy.owner.name}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {copy.owner.location ?? ""}
                  {copy.owner.location ? " · " : ""}★{" "}
                  {copy.owner.avgRating ?? "—"}
                </div>
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
        <Link
          href="/browse"
          className="text-jigsaw-primary mt-3 inline-block text-sm font-semibold hover:underline"
        >
          {t("seeAllCopies", { count: totalAvailable })}
        </Link>
      )}
    </section>
  );
}

function ReviewsSection({
  puzzleId,
  composerRef,
}: {
  puzzleId: string;
  composerRef: React.RefObject<HTMLInputElement | null>;
}) {
  const t = useTranslations("puzzleDefinition");
  const format = useFormatter();
  const reviews = useQuery(gateway.social.listPuzzleReviews, {
    puzzleId: puzzleId as Id<"puzzles">,
  });
  const me = useQuery(gateway.identity.currentUser, {});
  const view = useQuery(gateway.library.getPuzzleDefinitionView, {
    puzzleId: puzzleId as Id<"puzzles">,
  });
  const postReview = useMutation(gateway.social.postPuzzleReview);

  const [text, setText] = useState("");
  const [rating, setRating] = useState(0);
  const [posting, setPosting] = useState(false);
  const [now] = useState(() => Date.now());

  const list = reviews ?? [];
  const title = view?.definition.title ?? "";

  const relative = (timestamp: number) =>
    format.relativeTime(new Date(timestamp), now);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPosting(true);
    try {
      await postReview({
        puzzleId: puzzleId as Id<"puzzles">,
        text: trimmed,
        ...(rating > 0 ? { rating } : {}),
      });
      setText("");
      setRating(0);
    } catch {
      toast.error(t("reviewFailed"));
    } finally {
      setPosting(false);
    }
  };

  return (
    <section>
      <SectionHead
        icon={<MessageCircle className="h-4 w-4" />}
        title={t("reviews")}
        meta={String(list.length)}
      />

      {/* Composer */}
      <div className="mb-4 flex gap-2.5">
        <MemberAvatar name={me?.name ?? "?"} avatar={me?.avatar} />
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex gap-2">
            <Input
              ref={composerRef}
              placeholder={t("reviewPlaceholder", { title })}
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
        {list.map((review, i) => (
          <ReviewRow
            key={review.id}
            review={review}
            relative={relative}
            last={i === list.length - 1}
          />
        ))}
        {list.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("noReviews")}</p>
        )}
      </div>
    </section>
  );
}

function ReviewRow({
  review,
  relative,
  last,
}: {
  review: PuzzleReview;
  relative: (timestamp: number) => string;
  last: boolean;
}) {
  const name = review.author.name;
  return (
    <div className={cn("flex gap-3 py-3.5", !last && "border-border border-b")}>
      <MemberAvatar name={name} avatar={review.author.avatar} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-sm font-semibold">{name}</span>
          {review.rating != null && (
            <StarRating value={review.rating} size="sm" />
          )}
          <span className="text-muted-foreground text-xs">
            {relative(review.createdAt)}
          </span>
        </div>
        <p className="text-foreground/90 mt-1 text-sm leading-relaxed">
          {review.text}
        </p>
      </div>
    </div>
  );
}
