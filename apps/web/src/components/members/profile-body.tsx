"use client";

// The single shared body for the redesigned public member profile
// (/members/$handle), rendered for every viewer tier: logged-out ("public"),
// logged-in non-self ("member"), and the owner-preview ("owner"). It consumes
// the discriminated `gateway.social.publicProfile` payload — unlocked (hero +
// story + stats + records + shelf) or locked (hero + private card + follow
// action). All tokens resolve in both the marketing and dashboard shells.

import { PuzzlePlank3D } from "@/components/common/puzzle-plank-3d";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { toPlankBox, type ShelfCopy } from "@/components/profile/to-plank-box";
import { FollowButton } from "@/components/social/follow-button";
import { MessageButton } from "@/components/social/message-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import {
  AtSign,
  BookOpen,
  CalendarDays,
  Heart,
  Lock,
  MapPin,
  Mountain,
  Sparkles,
  Star,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

// The web tier derives Convex view types from the gateway (not @jigswap/contracts directly).
export type PublicProfileView = NonNullable<
  FunctionReturnType<typeof gateway.social.publicProfile>
>;
type Hero = PublicProfileView["hero"];
type UnlockedProfile = Extract<PublicProfileView, { locked: false }>;

export type ProfileViewer = "public" | "member" | "owner";

function firstNameOf(displayName: string): string {
  return displayName.split(/\s+/)[0] || displayName;
}

export function ProfileBody({
  profile,
  shelf,
  viewer,
  returnToHref,
}: {
  profile: PublicProfileView;
  // The auth-gated featured shelf (fetched only for logged-in viewers of an
  // unlocked profile). Absent for the logged-out and locked cases.
  shelf?: ShelfCopy[];
  viewer: ProfileViewer;
  // Round-trip target for the logged-out sign-up CTAs (public viewer only).
  returnToHref?: string;
}) {
  const hero = profile.hero;
  const firstName = firstNameOf(hero.displayName);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <HeroSection
        hero={hero}
        viewer={viewer}
        locked={profile.locked}
        returnToHref={returnToHref}
      />

      {profile.locked ? (
        <LockedCard
          firstName={firstName}
          memberId={hero.memberId as Id<"users">}
          viewer={viewer}
          returnToHref={returnToHref}
        />
      ) : (
        <>
          {profile.story && (
            <StorySection firstName={firstName} story={profile.story} />
          )}
          <StatStrip stats={profile.stats} />
          <RecordsRow records={profile.records} />
          <ShelfSection firstName={firstName} shelf={shelf} />
        </>
      )}
    </div>
  );
}

// ── Hero ───────────────────────────────────────────────────────────────────
function HeroSection({
  hero,
  viewer,
  locked,
  returnToHref,
}: {
  hero: Hero;
  viewer: ProfileViewer;
  locked: boolean;
  returnToHref?: string;
}) {
  const t = useTranslations("members.profile");
  const memberSinceYear = new Date(hero.memberSince).getFullYear();
  const handle = hero.slug ?? hero.username;

  return (
    <section className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-5">
        <Avatar className="size-24 shrink-0">
          {hero.avatar && (
            <AvatarImage src={hero.avatar} alt={hero.displayName} />
          )}
          <AvatarFallback className="text-3xl">
            {hero.displayName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="font-heading text-3xl">{hero.displayName}</h1>
            {hero.reviewCount > 0 && (
              <span className="bg-jigsaw-secondary/10 text-jigsaw-secondary inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium">
                <Star className="size-3.5 fill-current" />
                {t("ratingPill", {
                  rating: hero.rating.toFixed(1),
                  reviewCount: hero.reviewCount,
                })}
              </span>
            )}
            {viewer === "owner" && hero.visibility === "private" && (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" />
                {t("privateBadge")}
              </Badge>
            )}
          </div>

          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {handle && (
              <span className="inline-flex items-center gap-1">
                <AtSign className="size-3.5" />
                <span className="font-mono">{handle}</span>
              </span>
            )}
            {hero.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                {hero.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" />
              {t("memberSinceYear", { year: memberSinceYear })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" />
              <span className="text-foreground font-semibold">
                {hero.followerCount}
              </span>{" "}
              {t("followers", { count: hero.followerCount })} ·{" "}
              <span className="text-foreground font-semibold">
                {hero.followingCount}
              </span>{" "}
              {t("following")}
            </span>
          </div>

          {viewer === "member" && !locked && (
            <FollowersYouKnowRow memberId={hero.memberId as Id<"users">} />
          )}
        </div>
      </div>

      <HeroActions
        viewer={viewer}
        memberId={hero.memberId as Id<"users">}
        locked={hero.visibility === "private"}
        returnToHref={returnToHref}
      />
    </section>
  );
}

function HeroActions({
  viewer,
  memberId,
  locked,
  returnToHref,
}: {
  viewer: ProfileViewer;
  memberId: Id<"users">;
  locked: boolean;
  returnToHref?: string;
}) {
  const t = useTranslations("members.profile");

  if (viewer === "owner") {
    // The owner-preview banner (route-level) carries Edit profile / Back to app.
    return null;
  }

  if (viewer === "member") {
    // Locked (private, non-mutual): follow-only — messaging is connection-gated
    // and the request lives in the private card. Unlocked: Follow + Message.
    if (locked) return null;
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <FollowButton memberId={memberId} />
        <MessageButton memberId={memberId} />
      </div>
    );
  }

  // Logged-out: the only real action is to join; deep follow lives behind sign-up.
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button asChild variant="brand">
        <SignUpLink returnToHref={returnToHref}>{t("follow")}</SignUpLink>
      </Button>
    </div>
  );
}

// ── Followers you know ──────────────────────────────────────────────────────
// Social proof: accounts the VIEWER follows who also follow this member (see
// backend social/knownFollowers.ts) — personalized, so only ever fetched for a
// logged-in viewer on someone else's unlocked profile (guarded by the caller).
type FollowersYouKnowMember = NonNullable<
  FunctionReturnType<typeof gateway.social.followersYouKnow>
>["members"][number];

function FollowersYouKnowRow({ memberId }: { memberId: Id<"users"> }) {
  const t = useTranslations("members.followersYouKnow");
  const [open, setOpen] = useState(false);
  const { data } = useQuery(
    convexQuery(gateway.social.followersYouKnow, { memberId }),
  );

  // `total > 0` but an empty `members` preview is only reachable if every previewed followee
  // became unresolvable (e.g. a hard-deleted user) — guard so the copy below never dereferences
  // an undefined member.
  if (!data || data.total === 0 || data.members.length === 0) return null;

  const [first, second] = data.members;
  const stack = data.members.slice(0, 3);
  const extraCount = data.total - data.members.length;

  // The 2+ copy needs two names; if only one previewed member resolved (unresolvable followees),
  // fall back to the single-name copy rather than interpolating an undefined name.
  let copy: string;
  if (data.total === 1 || !second) {
    copy = t("one", { name: first.displayName });
  } else if (data.total === 2) {
    copy = t("two", { name1: first.displayName, name2: second.displayName });
  } else {
    copy = t("more", {
      name1: first.displayName,
      name2: second.displayName,
      count: data.total - 2,
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground mt-3 flex items-center gap-2 text-left text-sm transition-colors"
      >
        <span className="flex items-center">
          {stack.map((member, i) => (
            <Avatar
              key={member.memberId}
              title={member.displayName}
              className={cn(
                "border-background size-7 border-2",
                i > 0 && "-ml-2",
              )}
            >
              {member.avatar && (
                <AvatarImage src={member.avatar} alt={member.displayName} />
              )}
              <AvatarFallback className="text-xs">
                {member.displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ))}
        </span>
        <span>{copy}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
          </DialogHeader>
          <ul className="flex flex-col gap-3">
            {data.members.map((member) => (
              <FollowersYouKnowListItem key={member.memberId} member={member} />
            ))}
          </ul>
          {extraCount > 0 && (
            <p className="text-muted-foreground text-sm">
              {t("andMore", { count: extraCount })}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FollowersYouKnowListItem({
  member,
}: {
  member: FollowersYouKnowMember;
}) {
  return (
    <li>
      <Link
        to="/members/$handle"
        params={{ handle: member.slug ?? member.username ?? member.memberId }}
        className="flex items-center gap-3 hover:underline"
      >
        <Avatar className="size-8">
          {member.avatar && (
            <AvatarImage src={member.avatar} alt={member.displayName} />
          )}
          <AvatarFallback className="text-xs">
            {member.displayName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium">{member.displayName}</span>
      </Link>
    </li>
  );
}

// ── Story ──────────────────────────────────────────────────────────────────
function StorySection({
  firstName,
  story,
}: {
  firstName: string;
  story: string;
}) {
  const t = useTranslations("members.profile");
  return (
    <section>
      <SectionHead title={t("storyTitle", { name: firstName })} icon={Heart} />
      <div className="relative">
        <span
          aria-hidden
          className="font-heading text-jigsaw-primary/10 pointer-events-none absolute -top-6 -left-2 select-none text-8xl leading-none"
        >
          &ldquo;
        </span>
        <p className="text-foreground/90 relative pl-4 text-lg leading-relaxed whitespace-pre-wrap">
          {story}
        </p>
      </div>
    </section>
  );
}

// ── Stat strip ───────────────────────────────────────────────────────────────
function StatStrip({ stats }: { stats: UnlockedProfile["stats"] }) {
  const t = useTranslations("members.profile");
  const cells = [
    { value: stats.puzzlesOwned, label: t("statOwned") },
    { value: stats.completions, label: t("statCompletions") },
    { value: stats.piecesPlaced, label: t("statPieces") },
    { value: stats.swaps, label: t("statSwaps") },
  ];
  return (
    <section className="grid grid-cols-2 gap-y-6 sm:grid-cols-4 sm:gap-y-0">
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={cn("px-3 text-center", i > 0 && "sm:border-l")}
        >
          <div className="font-heading text-jigsaw-primary text-4xl leading-none font-bold">
            {cell.value.toLocaleString()}
          </div>
          <div className="text-muted-foreground mt-2 text-sm">{cell.label}</div>
        </div>
      ))}
    </section>
  );
}

// ── Records ──────────────────────────────────────────────────────────────────
function RecordsRow({ records }: { records: UnlockedProfile["records"] }) {
  const t = useTranslations("members.profile");
  if (!records.fastest && !records.hardest) return null;
  return (
    <section className="grid gap-4 sm:grid-cols-2">
      {records.fastest && (
        <RecordCard
          icon={Zap}
          chipClass="bg-amber-500/10 text-amber-500"
          label={t("fastestLabel")}
          title={records.fastest.title}
          sub={t("minutesValue", { minutes: records.fastest.minutes })}
        />
      )}
      {records.hardest && (
        <RecordCard
          icon={Mountain}
          chipClass="bg-jigsaw-primary/10 text-jigsaw-primary"
          label={t("hardestLabel")}
          title={records.hardest.title}
          sub={t("piecesValue", { count: records.hardest.pieceCount })}
        />
      )}
    </section>
  );
}

function RecordCard({
  icon: Icon,
  chipClass,
  label,
  title,
  sub,
}: {
  icon: LucideIcon;
  chipClass: string;
  label: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="border-border flex items-center gap-4 rounded-xl border p-4">
      <div
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-lg",
          chipClass,
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-muted-foreground font-mono text-xs uppercase">
          {label}
        </div>
        <div className="truncate font-semibold">{title}</div>
        <div className="text-muted-foreground text-sm">{sub}</div>
      </div>
    </div>
  );
}

// ── Shelf ────────────────────────────────────────────────────────────────────
function ShelfSection({
  firstName,
  shelf,
}: {
  firstName: string;
  shelf?: ShelfCopy[];
}) {
  const t = useTranslations("profile.shelf");
  const boxes = useMemo(
    () => (shelf ?? []).slice(0, 6).map(toPlankBox),
    [shelf],
  );

  if (boxes.length === 0) return null;

  return (
    <section>
      <SectionHead
        title={t("title", { name: firstName })}
        icon={BookOpen}
        meta={t("meta", { count: boxes.length })}
      />
      <div className="h-[300px] min-w-0 md:h-[360px]">
        <PuzzlePlank3D boxes={boxes} interactive />
      </div>
    </section>
  );
}

// ── Locked (private, non-owner or owner-preview) ─────────────────────────────
function LockedCard({
  firstName,
  memberId,
  viewer,
  returnToHref,
}: {
  firstName: string;
  memberId: Id<"users">;
  viewer: ProfileViewer;
  returnToHref?: string;
}) {
  const t = useTranslations("members.profile");
  return (
    <Card className="mx-auto flex w-full max-w-md flex-col items-center gap-3 border-dashed p-8 text-center">
      <Lock className="text-muted-foreground size-6" />
      <p className="text-muted-foreground text-sm">
        {t("privateBody", { name: firstName })}
      </p>
      {viewer === "member" && (
        // Phase 1 keeps today's instant follow; the request-to-follow flow
        // replaces this in Phase 2.
        <FollowButton memberId={memberId} />
      )}
      {viewer === "public" && (
        <Button asChild variant="brand">
          <SignUpLink returnToHref={returnToHref}>
            {t("signUpToFollow")}
          </SignUpLink>
        </Button>
      )}
    </Card>
  );
}

// ── Shared: sign-up link + bottom CTA band ───────────────────────────────────
function SignUpLink({
  returnToHref,
  children,
}: {
  returnToHref?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to="/sign-up/$"
      params={{ _splat: "" }}
      search={returnToHref ? { redirect_url: returnToHref } : {}}
    >
      {children}
    </Link>
  );
}

// The bottom "Love puzzles too? / Sign up free" band on the logged-out public
// view — pure presentation, routed through the existing Clerk sign-up flow.
export function ProfileCtaBand({ returnToHref }: { returnToHref?: string }) {
  const t = useTranslations("members.profile");
  return (
    <section className="border-border/60 mt-4 border-t">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-4 py-14 text-center">
        <Sparkles className="text-jigsaw-primary size-7" />
        <h2 className="font-heading text-2xl">{t("ctaTitle")}</h2>
        <p className="text-muted-foreground max-w-md">{t("ctaSub")}</p>
        <Button asChild variant="brand" size="lg" className="mt-1">
          <SignUpLink returnToHref={returnToHref}>{t("ctaButton")}</SignUpLink>
        </Button>
      </div>
    </section>
  );
}
