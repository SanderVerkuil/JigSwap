import { MemberId, SolvingPreferences } from "../../../domain";

// Read side of the SolvingPreferences port — used by the federated settings read path, which has
// no write capability (Convex QueryCtx). Interface-segregated from the full repository.
export interface SolvingPreferencesReader {
  findByMember(memberId: MemberId): Promise<SolvingPreferences | null>;
}

export interface SolvingPreferencesRepository extends SolvingPreferencesReader {
  save(preferences: SolvingPreferences): Promise<void>;
}
