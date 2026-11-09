import { Link } from "@/compat/link";
import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { ImageZoom } from "@/components/common/image-zoom";
import { MarketingNotFoundContent } from "@/components/NotFound";
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
import { StarRating } from "@/components/ui/star-rating";
import { gateway, Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import { headMessage, seoHead } from "@/lib/seo-head";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftRight, MessageCircle, Star, UserRound } from "lucide-react";
import { useState } from "react";
import { useFormatter, useTranslations } from "use-intl";

type View = NonNullable<
  FunctionReturnType<typeof gateway.catalog.publicDefinitionView>
>;
type ReviewPage = FunctionReturnType<
  typeof gateway.social.listPublicPuzzleReviews
>;
type PublicReview = ReviewPage["page"][number];

// How many reviews a page of the list adds; the first page is in the server-rendered HTML.
const REVIEW_PAGE_SIZE = 20;

const viewQuery = (id: string) =>
  convexQuery(gateway.catalog.publicDefinitionView, { puzzleId: id });
const reviewsQuery = (id: string, endCursor?: string) =>
  convexQuery(gateway.social.listPublicPuzzleReviews, {
    puzzleId: id as Id<"puzzles">,
    paginationOpts: {
      numItems: REVIEW_PAGE_SIZE,
      cursor: null,
      ...(endCursor !== undefined && { endCursor }),
    },
  });

export const Route = createFileRoute("/_public/catalog/$id")({
  // Members always get the richer dashboard page (own actions, per-copy list): the spec's
  // bidirectional redirect. The unauthenticated /puzzles/$id -> /catalog/$id half lives in
  // _dashboard/route.tsx.
  beforeLoad: ({ context, params }) => {
    if (context.userId) {
      throw redirect({ to: "/puzzles/$id", params: { id: params.id } });
    }
  },
  loader: async ({ context, params }) => {
    // Both reads settle before deciding, so neither is still pending when the page is dehydrated.
    const [view] = await Promise.allSettled([
      context.queryClient.ensureQueryData(viewQuery(params.id)),
      context.queryClient.ensureQueryData(reviewsQuery(params.id)),
    ]);
    // A URL that names no puzzle reads as null, malformed ids included (the query takes any string):
    // a real 404 with the friendly not-found below, not a 200. A rejection is a failed read, so it
    // goes to the error view with a 500: these URLs are the whole sitemap, and an outage must not
    // tell crawlers the puzzles are gone.
    if (view.status === "rejected") throw view.reason;
    if (!view.value) throw notFound();
    return { view: view.value };
  },
  // loaderData is resolved before head() runs on the SSR pass, which is what crawlers and link
  // previews read; the description is the visitor's language via the root intl payload.
  head: ({ loaderData, match }) => {
    const d = loaderData?.view.definition;
    if (!d) {
      return match.status === "error"
        ? {}
        : { meta: [{ title: pageTitle(match.context, "notFound") }] };
    }
    const maker = d.brand || d.publisher;
    return seoHead(match, "catalog", {
      title: `${d.title} — JigSwap`,
      description: headMessage(match.context, "publicCatalog.metaDescription", {
        title: d.title,
        hasMaker: maker ? "yes" : "no",
        maker: maker ?? "",
        count: d.pieceCount,
      }),
      image: d.image,
    });
  },
  notFoundComponent: PuzzleNotFound,
  errorComponent: PuzzleLoadError,
  component: PublicPuzzlePage,
});

// The public 404, naming what's missing; a way back to the catalogue is among its actions.
function PuzzleNotFound() {
  const t = useTranslations("publicCatalog");
  return (
    <main id={MAIN_CONTENT_ID}>
      <MarketingNotFoundContent
        title={t("notFound")}
        message={t("notFoundSub")}
      />
    </main>
  );
}

// A failed read (see the loader): the puzzle may well exist, so no "404", and no raw error text.
function PuzzleLoadError() {
  const t = useTranslations("publicCatalog");
  return (
    <main id={MAIN_CONTENT_ID}>
      <MarketingNotFoundContent
        kicker={null}
        title={t("loadErrorTitle")}
        message={t("loadErrorSub")}
      />
    </main>
  );
}

function PublicPuzzlePage() {
  const { id } = Route.useParams();
  const { data: view, isError } = useQuery(viewQuery(id));

  // The loader already 404s a missing puzzle; this covers one removed (or a read failing) while
  // the page is open, treated exactly like a nonexistent id.
  if (view === undefined && !isError) return null; // loader-prefetched; only a hard refetch passes here
  if (view === null || isError) return <PuzzleNotFound />;
  return <PublicPuzzleDetail view={view} puzzleId={id} />;
}

function swapChipClasses(type: "swap" | "lend" | "sale") {
  switch (type) {
    case "swap":
      return "bg-mk-success-soft text-mk-success-strong";
    case "lend":
      return "bg-mk-card text-mk-text-strong";
    default:
      return "bg-mk-warning-soft text-mk-warning-strong";
  }
}

function PublicPuzzleDetail({
  view,
  puzzleId,
}: {
  view: View;
  puzzleId: string;
}) {
  const t = useTranslations("publicCatalog");
  const tDifficulty = useTranslations("puzzles.puzzles.difficulty");
  const { definition, rating, stats, availability } = view;
  const topics = [
    ...(definition.categoryName ? [definition.categoryName] : []),
    ...definition.tags,
  ];
  const chips = (
    [
      ["swap", availability.byType.swap],
      ["lend", availability.byType.lend],
      ["sale", availability.byType.sale],
    ] as const
  ).filter(([, n]) => n > 0);

  return (
    <main id={MAIN_CONTENT_ID}>
      {/* Hero: mirrors the dashboard detail skeleton, minus member actions. Two columns from md
          and a shorter 4:3 cover on phones, so the cover never fills the first screen on its own. */}
      <div className="bg-mk-sky px-4 min-[760px]:px-10">
        <section className="grid w-full max-w-[1200px] items-start gap-7 py-[clamp(24px,4vw,48px)] md:grid-cols-[260px_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* The box stands on its plank at its own size, so the plank is never under empty mat.
              From md the slot and plank keep the column's square footprint (251 + 9 = 260). The
              zoom's box hugs the picture, as its lens and pinch maths need, and its column flex
              lets a tall cover shrink to the slot's height. */}
          <div className="flex w-full flex-col lg:max-w-[300px]">
            <div className="relative flex aspect-[4/3] items-end justify-center overflow-hidden rounded-t-[2px] md:aspect-auto md:h-[251px] lg:h-[291px]">
              {definition.image ? (
                <ImageZoom
                  src={definition.image}
                  alt={definition.title}
                  priority
                  wrapperClassName="flex max-h-full max-w-full flex-col items-center"
                  className="min-h-0 max-w-full rounded-t-[2px]"
                />
              ) : (
                <PuzzleCoverFallback />
              )}
            </div>
            <div aria-hidden="true" className="bg-mk-plank h-[9px] shrink-0" />
          </div>
          <div className="min-w-0">
            <h1 className="font-mk-heading text-mk-text-strong text-[clamp(30px,4vw,48px)] leading-[1.1] font-normal tracking-[-0.01em] text-balance">
              {definition.title}
            </h1>
            <p className="text-mk-text-strong mt-2 text-[17px]">
              {[definition.brand, definition.publisher]
                .filter(Boolean)
                .map((part) => `${part} · `)
                .join("")}
              {t.rich("piecesCount", {
                count: definition.pieceCount,
                num: (chunks) => <span className="tabular-nums">{chunks}</span>,
              })}
            </p>
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              {rating.count > 0 && (
                <span className="flex items-center gap-1.5">
                  <StarRating value={Math.round(rating.rating)} size="sm" />
                  <span className="text-mk-text-strong text-sm tabular-nums">
                    {rating.rating} ({rating.count})
                  </span>
                </span>
              )}
              {definition.difficulty && (
                <Badge
                  className={cn(
                    "rounded-sm border-transparent px-2.5 py-0.5 text-[13px] font-semibold",
                    difficultyClasses(definition.difficulty),
                  )}
                >
                  {tDifficulty(definition.difficulty)}
                </Badge>
              )}
              {topics.map((topic, i) => (
                <span
                  key={`${topic}-${i}`}
                  className="bg-mk-sky-soft text-mk-text-strong inline-flex items-center rounded-sm px-2.5 py-0.5 text-[13px] font-semibold"
                >
                  {topic}
                </span>
              ))}
            </div>
            {definition.description && (
              <p className="text-mk-text-strong mt-4 max-w-[62ch] text-[17px] leading-relaxed">
                {definition.description}
              </p>
            )}
            {/* ONE primary CTA (spec): join, with returnTo back to this page. */}
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              {/* The label is wider than a 320px phone at the public size, so it may wrap. It stays
                  50px on touch too, over the base's 44px coarse-pointer floor. */}
              <Button
                variant="brand"
                size="public"
                className="h-auto min-h-[50px] max-w-full py-2.5 text-center whitespace-normal pointer-coarse:min-h-[50px]"
                asChild
              >
                <Link
                  href={`/sign-up?redirect_url=${encodeURIComponent(`/catalog/${puzzleId}`)}`}
                >
                  {t("joinCta")}
                </Link>
              </Button>
              <Button
                variant="link"
                className="text-mk-text-strong underline underline-offset-3 max-sm:px-0"
                asChild
              >
                <Link
                  href={`/sign-in?redirect_url=${encodeURIComponent(`/catalog/${puzzleId}`)}`}
                >
                  {t("logIn")}
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </div>

      <div className="flex w-full max-w-[1280px] flex-col gap-10 px-4 py-[clamp(32px,5vw,56px)] min-[760px]:px-10">
        {/* Stats strip — Available-to-swap FIRST (the hook); zero/absent stats are hidden, never
          rendered as dashes (spec). */}
        <div className="grid max-w-[760px] grid-cols-2 gap-y-6 sm:grid-cols-4">
          {availability.total > 0 && (
            <Stat value={availability.total} label={t("statAvailable")} />
          )}
          {stats.communityOwners > 0 && (
            <Stat
              value={stats.communityOwners}
              label={t("statOwners", { count: stats.communityOwners })}
              divided={availability.total > 0}
            />
          )}
          {stats.totalCompletions > 0 && (
            <Stat
              value={stats.totalCompletions}
              label={t("statCompletions")}
              divided
            />
          )}
          {stats.avgCompletionDays != null && stats.avgCompletionDays > 0 && (
            <Stat
              value={stats.avgCompletionDays}
              label={t("statAvgDays")}
              divided
            />
          )}
        </div>

        {/* Availability panel: aggregate only — no owner identities. Zero availability -> omit the
          panel; the owners stat above already says who has it. */}
        {availability.total > 0 && (
          <section>
            <SectionHead
              icon={<ArrowLeftRight className="h-4 w-4" />}
              title={t("availabilityTitle")}
            />
            <div className="bg-mk-sky-soft dark:bg-mk-muted flex flex-wrap items-center gap-5 rounded-md px-5 py-4">
              <div className="figures text-4xl leading-none font-semibold">
                {availability.total}
              </div>
              {/* A 12rem flex basis makes the avatars and CTA wrap to their own line on phones instead
                of squeezing this text to one word per line. */}
              <div className="min-w-0 flex-[1_1_12rem]">
                <div className="text-sm font-medium">
                  {t("copiesAvailableNow", { count: availability.total })}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {chips.map(([type, n]) => (
                    <span
                      key={type}
                      className={cn(
                        "rounded-sm px-2.5 py-0.5 text-[13px] font-semibold",
                        swapChipClasses(type),
                      )}
                    >
                      {t(
                        type === "swap"
                          ? "chipSwap"
                          : type === "lend"
                            ? "chipLend"
                            : "chipSale",
                        { count: n },
                      )}
                    </span>
                  ))}
                </div>
              </div>
              {/* Three generic, non-identifying avatar circles: signals people without naming them. */}
              <div className="flex -space-x-2">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="bg-muted border-background text-muted-foreground flex h-8 w-8 items-center justify-center rounded-full border-2"
                  >
                    <UserRound className="h-4 w-4" />
                  </span>
                ))}
              </div>
              <Button
                variant="link"
                className="text-mk-text-strong underline underline-offset-3"
                asChild
              >
                <Link
                  href={`/sign-up?redirect_url=${encodeURIComponent(`/browse?puzzle=${puzzleId}`)}`}
                >
                  {t("joinToSeeWho")}
                </Link>
              </Button>
            </div>
          </section>
        )}

        {/* Rating + reviews, two-column like the dashboard page. */}
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <section>
            <SectionHead icon={<StarGlyph />} title={t("communityRating")} />
            {rating.count === 0 ? (
              // Unrated: say so rather than show a 0 score, empty stars and 0% bars.
              <p className="text-muted-foreground text-sm">{t("noRatings")}</p>
            ) : (
              <>
                <div className="mb-3.5 flex items-end gap-3.5">
                  <div className="figures text-foreground text-4xl leading-none font-semibold">
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
                  {[5, 4, 3, 2, 1].map((star, i) => (
                    <div key={star} className="flex items-center gap-2.5">
                      <span className="text-muted-foreground inline-flex w-7 items-center justify-end gap-0.5 text-xs">
                        {star}
                        <Star
                          aria-hidden="true"
                          className="size-3 fill-current"
                        />
                      </span>
                      <span className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                        <span
                          className="bg-mk-gold block h-full rounded-full"
                          style={{ width: `${rating.percentages[i]}%` }}
                        />
                      </span>
                      <span className="text-muted-foreground w-9 text-right text-xs tabular-nums">
                        {rating.percentages[i]}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
          <PublicReviews key={puzzleId} puzzleId={puzzleId} />
        </div>
      </div>
    </main>
  );
}

function PublicReviews({ puzzleId }: { puzzleId: string }) {
  const t = useTranslations("publicCatalog");
  const format = useFormatter();
  const { convexClient } = Route.useRouteContext();
  // First page: a plain reactive query, prefetched by the loader so it is in the server HTML. Older
  // pages accumulate here, as on the catalogue list. The section is keyed by the puzzle. Once a page
  // follows it, the first page ends where that page starts: left to hold its numItems, a new review
  // would push its last row out of it and into the gap before that fixed next page.
  const [firstPageEnd, setFirstPageEnd] = useState<string>();
  const { data: firstPage } = useQuery({
    ...reviewsQuery(puzzleId, firstPageEnd),
    placeholderData: keepPreviousData,
  });
  const [morePages, setMorePages] = useState<ReviewPage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const lastPage = morePages.at(-1) ?? firstPage;
  const hasMore = lastPage !== undefined && !lastPage.isDone;
  // A review updated meanwhile moves to the top of the first page: list it once.
  const list = [
    ...new Map(
      [...(firstPage?.page ?? []), ...morePages.flatMap((p) => p.page)].map(
        (review) => [review.id, review],
      ),
    ).values(),
  ];
  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    const cursor = lastPage.continueCursor;
    try {
      const next = await convexClient.query(
        gateway.social.listPublicPuzzleReviews,
        {
          puzzleId: puzzleId as Id<"puzzles">,
          paginationOpts: { numItems: REVIEW_PAGE_SIZE, cursor },
        },
      );
      setFirstPageEnd((end) => end ?? cursor);
      setMorePages((pages) => [...pages, next]);
    } finally {
      setLoadingMore(false);
    }
  };
  // Fixed baseline for relative-time formatting — reading Date.now() during render is impure
  // (react-hooks/purity); seed it once, matching the dashboard detail page.
  const [now] = useState(() => Date.now());

  return (
    <section>
      <SectionHead
        icon={<MessageCircle className="h-4 w-4" />}
        title={t("reviews")}
        meta={hasMore ? `${list.length}+` : String(list.length)}
      />
      <div className="flex flex-col">
        {list.map((review, i) => (
          <PublicReviewRow
            key={review.id}
            review={review}
            relative={(ts) => format.relativeTime(new Date(ts), now)}
            last={i === list.length - 1}
          />
        ))}
        {list.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("noReviews")}</p>
        )}
        {/* aria-disabled, not disabled, while the next page loads: a disabled button drops focus. */}
        {hasMore && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 self-center pointer-coarse:min-h-11"
            aria-disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {t("showMoreReviews")}
          </Button>
        )}
      </div>
      {/* Read-only surface: in place of the composer, one muted line (spec). */}
      <p className="text-muted-foreground mt-4 text-sm">
        <Link
          href={`/sign-in?redirect_url=${encodeURIComponent(`/catalog/${puzzleId}`)}`}
          className="hover:underline"
        >
          {t("logInToReview")}
        </Link>
      </p>
    </section>
  );
}

function PublicReviewRow({
  review,
  relative,
  last,
}: {
  review: PublicReview;
  relative: (timestamp: number) => string;
  last: boolean;
}) {
  const t = useTranslations("publicCatalog");
  const displayName = useMemberDisplayName();
  const name = review.author
    ? displayName(review.author)
    : t("anonymousReviewer");
  return (
    <div
      className={cn(
        "flex gap-3 py-3.5",
        !last && "border-border border-b", // taste-skill-ignore: rows of a real review list.
      )}
    >
      {review.author ? (
        <MemberAvatar source={review.author} avatar={review.author.avatar} />
      ) : (
        <span className="bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
          <UserRound className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-sm font-semibold",
              review.author
                ? "text-foreground"
                : "text-muted-foreground italic",
            )}
          >
            {name}
          </span>
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
    </div>
  );
}
