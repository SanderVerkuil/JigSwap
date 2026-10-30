"use client";

import { useUser } from "@/compat/clerk";
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway, Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AtSign,
  Calendar,
  Eye,
  Globe,
  Lock,
  MapPin,
  Pencil,
  Star,
  X,
} from "lucide-react";
import { useTranslations } from "use-intl";
import type { Member } from "./member-view";
import { PRIVACY_SECTION_ID } from "./privacy-section";

// The in-content identity strip at the top of the profile: large avatar, the
// member's name as other members see it (their chosen display name, else the
// account name) at h1 size (the chrome already owns the page's "Profile" h1),
// a muted icon meta row (@username · location · member-since year) showing only
// the fields the member actually has plus who can see the profile (a badge that
// jumps to the Privacy section), and — on the right — a green rating badge
// worded like the public profile's ("★ 4.5 · 2 reviews") when reviews exist, a
// link to the public profile page (the owner preview, i.e. what visitors see)
// and the outline Edit Profile toggle.
export function IdentityHeader({
  member,
  isEditing,
  onToggleEdit,
}: {
  member: Member;
  isEditing: boolean;
  onToggleEdit: () => void;
}) {
  const t = useTranslations("profile");
  const tPublic = useTranslations("members.profile");
  const displayName = useMemberDisplayName();
  const { user } = useUser();
  const { data: reputation } = useQuery(
    convexQuery(gateway.reputation.profile, {
      memberId: member._id as Id<"users">,
    }),
  );
  // The bio shown here is the Social profile's bio — the same field
  // getPublicProfile reads for the public "story" — so the owner's own
  // /profile shows exactly what other members see. users.bio (identity) is
  // no longer surfaced.
  const { data: socialProfile } = useQuery(
    convexQuery(gateway.social.profile, {}),
  );

  const avatarSrc = member.avatar ?? user?.imageUrl;
  const memberYear = new Date(member.createdAt).getFullYear();
  // Same precedence as the server's memberDisplayNameOf: chosen display name,
  // else account name, else username — never the email others can't see.
  const nameSource = {
    name: socialProfile?.displayName ?? member.name,
    username: member.username,
  };
  const name = displayName(nameSource);
  // No Social profile yet (null) means the public default.
  const isPrivate = socialProfile?.visibility === "private";
  // The canonical /members handle (same fallback as the route's redirect).
  const publicHandle = member.slug ?? member.username ?? member._id;

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-4 border-b pb-6">
      <Avatar className="size-[84px]">
        <AvatarImage src={avatarSrc} alt={name} />
        <AvatarFallback className="font-heading bg-jigsaw-primary/10 text-jigsaw-primary text-2xl font-bold">
          <MemberInitial source={nameSource} />
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 grow basis-48">
        <h2 className="font-heading text-2xl font-bold tracking-tight [overflow-wrap:anywhere] sm:text-3xl">
          {name}
        </h2>
        <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {member.username && (
            <span className="inline-flex items-center gap-1.5">
              <AtSign aria-hidden className="size-3.5" />
              {member.username}
            </span>
          )}
          {member.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin aria-hidden className="size-3.5" />
              {member.location}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Calendar aria-hidden className="size-3.5" />
            {t("memberSince")} {memberYear}
          </span>
          {socialProfile !== undefined && (
            <Badge asChild variant="outline" className="min-h-6 rounded-full">
              <Link to="/profile" hash={PRIVACY_SECTION_ID}>
                {isPrivate ? <Lock aria-hidden /> : <Globe aria-hidden />}
                {isPrivate
                  ? t("visibilityBadge.private")
                  : t("visibilityBadge.public")}
              </Link>
            </Badge>
          )}
        </div>
        {socialProfile?.bio && (
          <p className="text-muted-foreground mt-2 max-w-prose text-sm">
            {socialProfile.bio}
          </p>
        )}
      </div>

      <div className="flex basis-full flex-wrap items-center gap-2.5 sm:basis-auto">
        {reputation && reputation.reviewCount > 0 && (
          <Badge className="bg-jigsaw-success border-transparent text-white">
            <Star aria-hidden className="fill-current" />
            {tPublic("ratingPill", {
              rating: reputation.averageRating.toFixed(1),
              reviewCount: reputation.reviewCount,
            })}
          </Badge>
        )}
        <Button asChild variant="ghost">
          <Link to="/members/$handle" params={{ handle: publicHandle }}>
            <Eye aria-hidden />
            {t("viewPublicProfile")}
          </Link>
        </Button>
        <Button variant="outline" onClick={onToggleEdit}>
          {isEditing ? <X aria-hidden /> : <Pencil aria-hidden />}
          {isEditing ? t("cancel") : t("edit")}
        </Button>
      </div>
    </header>
  );
}
