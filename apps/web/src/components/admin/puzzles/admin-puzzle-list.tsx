"use client";

// The /admin/puzzles console list (admin.listPuzzleDefinitions): every catalog definition in any
// moderation status, newest first with Load more. Status pills (All / Pending / Approved /
// Rejected / Disabled; Pending carries the waiting count) and a debounced search box narrow it on
// the server; both are the route's URL search, so Back from a definition restores the list. A
// pending row links to its item in the moderation queue (Review). Approved rows can be reversibly
// disabled and disabled rows re-enabled via the shared PuzzleLifecycleAction.
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { PuzzleLifecycleAction } from "@/components/admin/puzzles/puzzle-lifecycle-action";
import { useUrlSearchInput } from "@/components/admin/users/use-url-search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { formatQueueCount, type QueueCount } from "@/lib/queue-count";
import { Link } from "@tanstack/react-router";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ImageOff, Puzzle as PuzzleIcon, Search } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";
import {
  ADMIN_PUZZLE_STATUSES,
  type AdminPuzzleStatus,
} from "./puzzles-search";

export const ADMIN_PUZZLES_PAGE_SIZE = 25;

// Derived from the gateway (not `@jigswap/contracts` directly), mirroring the
// rest of the web tier (e.g. collection-stats.tsx's CollectionPuzzle).
type Row = FunctionReturnType<
  typeof gateway.admin.listPuzzleDefinitions
>["page"][number];

const STATUS_VARIANT: Record<
  Row["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  disabled: "outline",
};

export function AdminPuzzleList({
  status,
  search,
  onStatusChange,
  onSearchChange,
  pendingCount,
}: {
  /** The status filter from the URL; undefined = every status. */
  status?: AdminPuzzleStatus;
  /** The search term from the URL. */
  search?: string;
  onStatusChange: (status: AdminPuzzleStatus | undefined) => void;
  /** Writes the (trimmed, debounced) term to the URL; undefined clears it. */
  onSearchChange: (term: string | undefined) => void;
  /** How many submissions wait for review (admin.pendingCounts); undefined while it loads. */
  pendingCount?: QueueCount;
}) {
  const t = useTranslations("admin.puzzles");
  // usePaginatedQuery restarts pagination whenever its args change, so the term only reaches the
  // URL (and the server) once the admin stops typing.
  const [searchInput, setSearchInput] = useUrlSearchInput(
    search,
    onSearchChange,
  );
  const filters: (AdminPuzzleStatus | undefined)[] = [
    undefined,
    ...ADMIN_PUZZLE_STATUSES,
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="relative max-w-sm">
          <Search
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
            className="h-11 pl-9 md:h-9"
          />
        </div>
        <div
          role="group"
          aria-label={t("statusFilter")}
          className="flex flex-wrap gap-2"
        >
          {filters.map((value) => (
            <Button
              key={value ?? "all"}
              variant={status === value ? "default" : "outline"}
              size="sm"
              className="h-11 md:h-8"
              aria-pressed={status === value}
              onClick={() => onStatusChange(value)}
            >
              {value ? t(`status.${value}`) : t("allStatuses")}
              {value === "pending" && pendingCount && (
                <span className="text-xs font-bold tabular-nums opacity-80">
                  {formatQueueCount(pendingCount.count, pendingCount.capped)}
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* A failed page throws (usePaginatedQuery has no error state): the boundary turns it into
          the retryable admin error, and Retry remounts the list, which subscribes again. Keyed by
          the filters so another filter starts from a clean slate. */}
      <ErrorBoundary
        key={`${status ?? ""}:${search ?? ""}`}
        fallback={PuzzleListError}
      >
        <PuzzleRows status={status} search={search} />
      </ErrorBoundary>
    </div>
  );
}

function PuzzleListError({ resetError }: { resetError: () => void }) {
  return <AdminQueryError onRetry={resetError} />;
}

function PuzzleRows({
  status,
  search,
}: {
  status?: AdminPuzzleStatus;
  search?: string;
}) {
  const t = useTranslations("admin.puzzles");
  const format = useFormatter();
  const {
    results: rows,
    status: pageStatus,
    loadMore,
    isLoading,
  } = usePaginatedQuery(
    gateway.admin.listPuzzleDefinitions,
    { ...(status ? { status } : {}), ...(search ? { search } : {}) },
    { initialNumItems: ADMIN_PUZZLES_PAGE_SIZE },
  );
  const filtered = status !== undefined || search !== undefined;

  if (pageStatus === "LoadingFirstPage") {
    return <PageLoading message={t("loading")} />;
  }

  return (
    <>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <PuzzleIcon className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-semibold">
            {filtered ? t("emptyFiltered.title") : t("empty.title")}
          </p>
          <p className="text-sm text-muted-foreground">
            {filtered ? t("emptyFiltered.description") : t("empty.description")}
          </p>
        </div>
      ) : (
        <div className="@container rounded-xl border bg-card">
          {rows.map((row) => (
            // In a list narrower than @2xl (672px: phones, and tablets beside the sidebar) the
            // action wraps onto its own line under the title, as in the category list, so a long
            // (Dutch) title and the button's label never compete for one row.
            <div
              key={row._id}
              className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-0 @2xl:flex-nowrap"
            >
              <Link
                to="/admin/puzzles/$puzzleId"
                params={{ puzzleId: row._id }}
                className="flex min-w-0 flex-1 basis-full items-center gap-3 @2xl:basis-0"
              >
                {row.image ? (
                  <img
                    src={row.image}
                    alt=""
                    className="size-11 shrink-0 rounded-lg border object-cover"
                  />
                ) : (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted">
                    <PuzzleIcon
                      className="size-5 text-muted-foreground"
                      aria-hidden
                    />
                  </span>
                )}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="line-clamp-2 min-w-0 font-semibold break-words underline-offset-4 hover:underline">
                      {row.title}
                    </span>
                    <Badge variant={STATUS_VARIANT[row.status]}>
                      {t(`status.${row.status}`)}
                    </Badge>
                    {/* The box art's file is gone (SEC-01): re-upload it from the detail page. */}
                    {row.imageMissing === true && (
                      <Badge
                        variant="outline"
                        className="border-destructive/40 text-destructive"
                      >
                        <ImageOff aria-hidden />
                        {t("imageMissing")}
                      </Badge>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs break-words text-muted-foreground">
                    {row.brand && `${row.brand} · `}
                    {t("pieces", { count: row.pieceCount })}
                    {row.submitterName &&
                      ` · ${t("submittedBy", { name: row.submitterName })}`}
                  </p>
                </div>
              </Link>
              <div className="hidden shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground sm:flex">
                <span>
                  {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                </span>
                <span>
                  {t(
                    row.ownerCountIsLowerBound
                      ? "ownerCountLowerBound"
                      : "ownerCount",
                    { count: row.ownerCount },
                  )}
                </span>
              </div>
              <div className="ml-auto flex shrink-0 items-center">
                {row.status === "pending" ? (
                  // A pending definition is decided in the moderation queue: open its item there.
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 md:h-8"
                    asChild
                  >
                    <Link
                      to="/admin/moderation"
                      search={{ tab: "submissions", item: row._id }}
                      aria-label={t("reviewLabel", { title: row.title })}
                    >
                      {t("review")}
                    </Link>
                  </Button>
                ) : (
                  <PuzzleLifecycleAction
                    aggregateId={row.aggregateId}
                    title={row.title}
                    status={row.status}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pageStatus === "CanLoadMore" && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadMore(ADMIN_PUZZLES_PAGE_SIZE)}
            disabled={isLoading}
          >
            {t("loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}
