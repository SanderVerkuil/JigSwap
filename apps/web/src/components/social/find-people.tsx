"use client";

// The Find-people tab: search-first member discovery. A debounced search box
// (2-character minimum, mirrored server-side in identity/searchUsers) over the
// privacy-gated member search; while idle, a small "Recently joined" seed of
// public profiles. Both empty states route to the QR fallback — the answer to
// "can't find them" is always "ask for their link or QR". Discovery tiles hide
// location (stats build trust with strangers; street-level context doesn't).

import { EmptyState } from "@/components/community/primitives";
import { SectionHead } from "@/components/dashboard-home/section-head";
import {
  MemberTile,
  MemberTileSkeleton,
} from "@/components/social/member-tile";
import { QrDialog } from "@/components/social/qr-dialog";
import { Input } from "@/components/ui/input";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Search, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

export function FindPeople() {
  const t = useTranslations("people.find");
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term.trim(), DEBOUNCE_MS);
  const searching = debounced.length >= MIN_QUERY_LENGTH;

  const { data: results } = useQuery({
    ...convexQuery(gateway.identity.search, { searchTerm: debounced }),
    enabled: searching,
  });
  const { data: recent } = useQuery(
    convexQuery(gateway.identity.recentPublicMembers, {}),
  );
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));

  // Phase 3's self-contained trigger-button + fullscreen dialog; reused at all
  // three "can't find them" surfaces below.
  const qrButton = me ? (
    <QrDialog
      memberId={me._id}
      displayName={me.name}
      username={me.username}
      avatarUrl={me.avatar}
    />
  ) : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-9"
            aria-label={t("searchPlaceholder")}
          />
        </div>
        {qrButton}
      </div>

      {term.trim().length > 0 && !searching ? (
        <p className="text-muted-foreground text-sm">{t("minChars")}</p>
      ) : searching ? (
        results === undefined ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <MemberTileSkeleton key={i} />
            ))}
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            title={t("noResultsTitle")}
            sub={t("noResultsSub")}
            action={qrButton}
          />
        ) : (
          <div
            className="flex flex-col gap-4"
            role="list"
            aria-label={t("resultsLabel")}
          >
            {results.map((member) => (
              <MemberTile
                key={member._id}
                memberId={member._id as Id<"users">}
                followsYou={false}
                hideLocation
              />
            ))}
          </div>
        )
      ) : (
        <section>
          <SectionHead title={t("recentlyJoined")} icon={UserPlus} />
          {recent === undefined ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <MemberTileSkeleton key={i} />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              title={t("recentlyJoinedEmptyTitle")}
              sub={t("recentlyJoinedEmptySub")}
              action={qrButton}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {recent.map((member) => (
                <MemberTile
                  key={member._id}
                  memberId={member._id as Id<"users">}
                  followsYou={false}
                  hideLocation
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
