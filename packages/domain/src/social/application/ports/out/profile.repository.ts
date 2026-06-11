import { MemberId, Profile } from "../../../domain";

// Outbound port: persistence for the per-member Profile aggregate. The profile is keyed by
// member; `findByMember` returns null for a member who has no profile yet (the EditProfile use
// case then reports ProfileNotFound, leaving creation to a separate flow).
export interface ProfileRepository {
  findByMember(memberId: MemberId): Promise<Profile | null>;
  save(profile: Profile): Promise<void>;
}
