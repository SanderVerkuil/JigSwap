import { MemberId, ReputationProfile } from "../../../domain";

// Outbound port: persistence for the per-member ReputationProfile aggregate. The profile is
// keyed by member; `findByMember` returns null for a member never reviewed (the use case
// then opens a fresh profile).
export interface ReputationProfileRepository {
  findByMember(memberId: MemberId): Promise<ReputationProfile | null>;
  save(profile: ReputationProfile): Promise<void>;
}
