"use client";

import { useClerk } from "@/compat/clerk";
import { SegmentedPills } from "@/components/add-puzzle/segmented-pills";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import type { MemberNameSource } from "@jigswap/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type Visibility = "public" | "private";

// Matches identity.setLocation's limit.
const MAX_LOCATION_LENGTH = 80;

// Step 5, Make it yours (spec §2.4): the avatar with "Change photo" (Clerk owns the image, so it
// opens Clerk's profile UI), the location saved with identity.setLocation, and profile
// visibility saved with social.setProfileVisibility. Choosing either visibility writes it
// explicitly, which marks the step done; the current value (public by default) is preselected.
export function ProfileStep() {
  const { member } = useCurrentMember();
  const { data: socialProfile } = useQuery(
    convexQuery(gateway.social.profile, {}),
  );
  if (!member || socialProfile === undefined) {
    return <Skeleton className="h-40 w-full" />;
  }
  return (
    <ProfileStepLoaded
      member={member}
      visibility={socialProfile?.visibility ?? "public"}
    />
  );
}

function ProfileStepLoaded({
  member,
  visibility,
}: {
  member: MemberNameSource & { avatar?: string; location?: string };
  visibility: Visibility;
}) {
  const t = useTranslations("profile");
  const clerk = useClerk();
  const savedLocation = member.location ?? "";
  // Seeded once from the loaded member, so typing is never overwritten by a live update.
  const [location, setLocation] = useState(savedLocation);
  const saveLocation = useMutation({
    mutationFn: useConvexMutation(gateway.identity.setLocation),
    onSuccess: () => toast.success(t("saved")),
    onError: () => toast.error(t("saveError")),
  });
  const saveVisibility = useMutation({
    mutationFn: useConvexMutation(gateway.social.setProfileVisibility),
    onError: () => toast.error(t("saveError")),
  });

  return (
    <ProfileStepView
      avatarUrl={member.avatar}
      nameSource={member}
      location={location}
      savedLocation={savedLocation}
      savingLocation={saveLocation.isPending}
      // The choice shows at once; the live profile takes over when the write lands.
      visibility={
        saveVisibility.isPending
          ? saveVisibility.variables.visibility
          : visibility
      }
      savingVisibility={saveVisibility.isPending}
      onLocationChange={setLocation}
      onLocationSave={() => saveLocation.mutate({ location: location.trim() })}
      onVisibilityChange={(next) => saveVisibility.mutate({ visibility: next })}
      onChangePhoto={() => clerk.openUserProfile()}
    />
  );
}

/** Step 5's markup, free of data hooks so it renders on the server in tests. */
export function ProfileStepView({
  avatarUrl,
  nameSource,
  location,
  savedLocation,
  savingLocation,
  visibility,
  savingVisibility,
  onLocationChange,
  onLocationSave,
  onVisibilityChange,
  onChangePhoto,
}: {
  avatarUrl?: string;
  nameSource: MemberNameSource;
  location: string;
  savedLocation: string;
  savingLocation: boolean;
  visibility: Visibility;
  savingVisibility: boolean;
  onLocationChange: (value: string) => void;
  onLocationSave: () => void;
  onVisibilityChange: (value: Visibility) => void;
  onChangePhoto: () => void;
}) {
  const t = useTranslations("quickStart.profile");
  const tProfile = useTranslations("profile");
  const inputId = useId();
  const hintId = useId();
  const unchanged = location.trim() === savedLocation.trim();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">{t("lead")}</p>

      <div className="flex items-center gap-4">
        <Avatar className="size-16" aria-hidden="true">
          {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
          <AvatarFallback className="text-lg font-semibold">
            <MemberInitial source={nameSource} />
          </AvatarFallback>
        </Avatar>
        <Button
          type="button"
          variant="outline"
          className="pointer-coarse:min-h-11"
          onClick={onChangePhoto}
        >
          {t("changePhoto")}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>{tProfile("location")}</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            value={location}
            maxLength={MAX_LOCATION_LENGTH}
            autoComplete="address-level2"
            aria-describedby={hintId}
            onChange={(e) => onLocationChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !unchanged && !savingLocation) {
                onLocationSave();
              }
            }}
            className="max-w-sm pointer-coarse:min-h-11"
          />
          <Button
            type="button"
            variant="outline"
            className="pointer-coarse:min-h-11"
            disabled={unchanged || savingLocation}
            onClick={onLocationSave}
          >
            {savingLocation ? tProfile("saving") : tProfile("save")}
          </Button>
        </div>
        <p id={hintId} className="text-muted-foreground text-xs">
          {t("locationHint")}
        </p>
      </div>

      <div className="flex flex-col gap-2" aria-busy={savingVisibility}>
        <p className="text-sm font-medium">{t("visibility")}</p>
        <SegmentedPills
          ariaLabel={t("visibility")}
          value={visibility}
          onChange={onVisibilityChange}
          options={[
            { value: "public", label: t("public") },
            { value: "private", label: t("private") },
          ]}
        />
      </div>
    </div>
  );
}
