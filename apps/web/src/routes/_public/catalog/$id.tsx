import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
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
import { StarRating } from "@/components/ui/star-rating";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftRight, MessageCircle, UserRound } from "lucide-react";
import { useState } from "react";
import { useFormatter, useTranslations } from "use-intl";

type View = NonNullable<
  FunctionReturnType<typeof gateway.catalog.publicDefinitionView>
>;
type PublicReview = FunctionReturnType<
  typeof gateway.social.listPublicPuzzleReviews
>[number];

const viewQuery = (id: string) =>
  convexQuery(gateway.catalog.publicDefinitionView, {
    puzzleId: id as Id<"puzzles">,
  });
const reviewsQuery = (id: string) =>
  convexQuery(gateway.social.listPublicPuzzleReviews, {
    puzzleId: id as Id<"puzzles">,
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
    // A malformed id fails `v.id("puzzles")` arg validation and rejects here. Rather than crash to
    // the root error boundary, swallow it and let the component render the same friendly not-found
    // a well-formed-but-nonexistent id shows (which resolves to `null`).
    try {
      const [view] = await Promise.all([
        context.queryClient.ensureQueryData(viewQuery(params.id)),
        context.queryClient.ensureQueryData(reviewsQuery(params.id)),
      ]);
      return { view };
    } catch {
      return { view: null };
    }
  },
  head: ({ loaderData }) => {
    const d = loaderData?.view?.definition;
    if (!d) return { meta: [{ title: "JigSwap" }] };
    const title = `${d.title} — JigSwap`;
    // English-only meta template: head() runs outside the intl render tree; acceptable for SEO.
    const description = `${d.title}${d.brand ? ` by ${d.brand}` : ""} — ${d.pieceCount.toLocaleString("en")}-piece jigsaw puzzle. Community rating, reviews and swap availability on JigSwap.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        ...(d.image ? [{ property: "og:image", content: d.image }] : []),
      ],
    };
  },
  component: PublicPuzzlePage,
});

function PublicPuzzlePage() {
  const { id } = Route.useParams();
  const t = useTranslations("publicCatalog");
  const { data: view, isError } = useQuery(viewQuery(id));

  // A malformed id makes the query error (arg validation); treat it exactly like a nonexistent id.
  if (view === undefined && !isError) return null; // loader-prefetched; only a hard refetch passes here
  if (view === null || isError) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-6 py-10">
        <EmptyState title={t("notFound")} sub={t("notFoundSub")} />
      </main>
    );
  }
  return <PublicPuzzleDetail view={view} puzzleId={id} />;
}

function swapChipClasses(type: "swap" | "lend" | "sale") {
  switch (type) {
    case "swap":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
    case "lend":
      return "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200";
    default:
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200";
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
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-6 py-10">
      {/* Hero — mirrors the dashboard detail skeleton, minus member actions. */}
      <section className="grid items-start gap-7 lg:grid-cols-[300px_minmax(0,1fr)]">
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
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs font-semibold uppercase tracking-[0.18em]">
            {t("title")}
          </div>
          <h1 className="font-heading mt-2 text-3xl font-bold tracking-tight">
            {definition.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-base">
            {definition.brand ? `${definition.brand} · ` : ""}
            <span className="font-mono">
              {definition.pieceCount.toLocaleString()}
            </span>{" "}
            pieces
          </p>
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            {rating.count > 0 && (
              <span className="flex items-center gap-1.5">
                <StarRating value={Math.round(rating.rating)} size="sm" />
                <span className="text-muted-foreground text-sm">
                  {rating.rating} ({rating.count})
                </span>
              </span>
            )}
            {definition.difficulty && (
              <Badge
                className={cn(
                  "rounded-full border-transparent px-2.5 py-0.5 text-xs font-semibold",
                  difficultyClasses(definition.difficulty),
                )}
              >
                {definition.difficulty}
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
          {definition.description && (
            <p className="text-foreground/90 mt-4 text-sm leading-relaxed">
              {definition.description}
            </p>
          )}
          {/* ONE primary CTA (spec): join, with returnTo back to this page. */}
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button variant="brand" asChild>
              <Link
                href={`/sign-up?redirect_url=${encodeURIComponent(`/catalog/${puzzleId}`)}`}
              >
                {t("joinCta")}
              </Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link
                href={`/sign-in?redirect_url=${encodeURIComponent(`/catalog/${puzzleId}`)}`}
              >
                {t("logIn")}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Stats strip — Available-to-swap FIRST (the hook); zero/absent stats are hidden, never
          rendered as dashes (spec). */}
      <div className="grid max-w-[760px] grid-cols-2 gap-y-6 sm:grid-cols-4">
        {availability.total > 0 && (
          <Stat value={availability.total} label={t("statAvailable")} />
        )}
        {stats.communityOwners > 0 && (
          <Stat
            value={stats.communityOwners}
            label={t("statOwners")}
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
          panel; show the softer owners line instead when anyone owns it (spec). */}
      {availability.total > 0 ? (
        <section>
          <SectionHead
            icon={<ArrowLeftRight className="h-4 w-4" />}
            title={t("availabilityTitle")}
          />
          <div className="bg-jigsaw-primary/10 flex flex-wrap items-center gap-5 rounded-xl px-5 py-4">
            <div className="font-heading text-4xl font-bold leading-none">
              {availability.total}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {t("copiesAvailableNow", { count: availability.total })}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {chips.map(([type, n]) => (
                  <span
                    key={type}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold",
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
            <Button variant="brand" size="sm" asChild>
              <Link
                href={`/sign-up?redirect_url=${encodeURIComponent(`/catalog/${puzzleId}`)}`}
              >
                {t("joinToSeeWho")}
              </Link>
            </Button>
          </div>
        </section>
      ) : (
        stats.communityOwners > 0 && (
          <p className="text-muted-foreground text-sm">
            {t("ownersHaveIt", { count: stats.communityOwners })}
          </p>
        )
      )}

      {/* Rating + reviews, two-column like the dashboard page. */}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
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
            {[5, 4, 3, 2, 1].map((star, i) => (
              <div key={star} className="flex items-center gap-2.5">
                <span className="text-muted-foreground inline-flex w-7 items-center justify-end gap-0.5 text-xs">
                  {star}★
                </span>
                <span className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                  <span
                    className="block h-full rounded-full bg-amber-400"
                    style={{ width: `${rating.percentages[i]}%` }}
                  />
                </span>
                <span className="text-muted-foreground w-9 text-right font-mono text-xs">
                  {rating.percentages[i]}%
                </span>
              </div>
            ))}
          </div>
        </section>
        <PublicReviews puzzleId={puzzleId} />
      </div>
    </main>
  );
}

function PublicReviews({ puzzleId }: { puzzleId: string }) {
  const t = useTranslations("publicCatalog");
  const format = useFormatter();
  const { data: reviews } = useQuery(reviewsQuery(puzzleId));
  const list = reviews ?? [];
  // Fixed baseline for relative-time formatting — reading Date.now() during render is impure
  // (react-hooks/purity); seed it once, matching the dashboard detail page.
  const [now] = useState(() => Date.now());

  return (
    <section>
      <SectionHead
        icon={<MessageCircle className="h-4 w-4" />}
        title={t("reviews")}
        meta={String(list.length)}
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
  const name = review.author?.name ?? t("anonymousReviewer");
  return (
    <div className={cn("flex gap-3 py-3.5", !last && "border-border border-b")}>
      {review.author ? (
        <MemberAvatar name={review.author.name} avatar={review.author.avatar} />
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
