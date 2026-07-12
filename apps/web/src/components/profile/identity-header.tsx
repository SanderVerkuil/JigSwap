"use client";

import { useUser } from "@/compat/clerk";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { AtSign, Calendar, MapPin, Pencil, Star, X } from "lucide-react";
import { useTranslations } from "use-intl";
import type { Member } from "./member-view";

// The in-content identity strip at the top of the profile: large avatar, the
// member's name at h1 size (the chrome already owns the page's "Profile" h1),
// a muted icon meta row (@username · location · member-since year) showing only
// the fields the member actually has, and — on the right — a green trust badge
// when reviews exist plus the outline Edit Profile toggle.
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
  const initials = (member.name ?? "?")
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const memberYear = new Date(member.createdAt).getFullYear();

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-4 border-b pb-6">
      <Avatar className="size-[84px]">
        <AvatarImage src={avatarSrc} alt={member.name} />
        <AvatarFallback className="font-heading bg-jigsaw-primary/10 text-jigsaw-primary text-2xl font-bold">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <h2 className="font-heading text-3xl font-bold tracking-tight">
          {member.name}
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
        </div>
        {socialProfile?.bio && (
          <p className="text-muted-foreground mt-2 max-w-prose text-sm">
            {socialProfile.bio}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        {reputation && reputation.reviewCount > 0 && (
          <Badge className="bg-jigsaw-success border-transparent text-white">
            <Star aria-hidden className="fill-current" />
            {t("trustBadge", { rating: reputation.averageRating.toFixed(1) })}
          </Badge>
        )}
        <Button variant="outline" onClick={onToggleEdit}>
          {isEditing ? <X aria-hidden /> : <Pencil aria-hidden />}
          {isEditing ? t("cancel") : t("edit")}
        </Button>
      </div>
    </header>
  );
}
