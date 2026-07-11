"use client";

// The anonymous-visitor view of /members/$handle: identity header (avatar already
// consent-gated server-side), a coarse collection line for public profiles, the
// private-profile card for private ones, and join/log-in CTAs that round-trip
// through Clerk back to this page (redirect_url).

import { MemberIdentityHeader } from "@/components/members/member-identity-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { gateway } from "@/gateway";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Lock } from "lucide-react";
import { useTranslations } from "use-intl";

// The web tier derives Convex view types from the gateway (not @jigswap/contracts directly).
export type PublicMemberTeaserView = NonNullable<
  FunctionReturnType<typeof gateway.social.publicMemberTeaser>
>;

export function LoggedOutTeaser({
  teaser,
  returnToHref,
}: {
  teaser: PublicMemberTeaserView;
  returnToHref: string;
}) {
  const t = useTranslations("members");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12">
      <MemberIdentityHeader
        displayName={teaser.displayName}
        username={teaser.username}
        avatar={teaser.avatar}
        memberSince={teaser.memberSince}
      />

      {teaser.visibility === "public" && teaser.puzzleCount !== null && (
        <p className="text-muted-foreground text-lg">
          {t("collects", { count: teaser.puzzleCount })}
        </p>
      )}

      {teaser.visibility === "private" && (
        <PrivateProfileCard displayName={teaser.displayName} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link
            to="/sign-up/$"
            params={{ _splat: "" }}
            search={{ redirect_url: returnToHref }}
          >
            {t("joinCta", { name: teaser.displayName })}
          </Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link
            to="/sign-in/$"
            params={{ _splat: "" }}
            search={{ redirect_url: returnToHref }}
          >
            {t("logIn")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

// The quiet private-profile card (shared shape with the logged-in interstitial):
// full identity above, one sentence of mutuality framing, no blurred-content
// silhouettes — respectful, never a paywall tease.
export function PrivateProfileCard({ displayName }: { displayName: string }) {
  const t = useTranslations("members");
  return (
    <Card className="flex flex-col items-center gap-2 border-dashed p-8 text-center">
      <Lock className="text-muted-foreground h-5 w-5" />
      <p className="font-semibold">
        {t("privateTitle", { name: displayName })}
      </p>
      <p className="text-muted-foreground text-sm">{t("privateSub")}</p>
    </Card>
  );
}
