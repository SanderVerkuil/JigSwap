import { MemberId } from "./ids";

// A member's Solving-context preferences. Identified by memberId (one per member). Eventless:
// settings carry no domain events that other contexts react to. `trackCompletionDuration`
// undefined means the member has never chosen — the UI uses that to drive the first-time prompt.
export interface SolvingPreferencesState {
  readonly memberId: MemberId;
  readonly trackCompletionDuration?: boolean;
  // undefined = never chosen. Gates the friend-facing in-progress surfaces; every consumer must
  // test `=== true` (absent behaves as off).
  readonly shareInProgress?: boolean;
  readonly updatedAt: Date;
}

export class SolvingPreferences {
  private constructor(private state: SolvingPreferencesState) {}

  get memberId(): MemberId {
    return this.state.memberId;
  }

  get trackCompletionDuration(): boolean | undefined {
    return this.state.trackCompletionDuration;
  }

  get shareInProgress(): boolean | undefined {
    return this.state.shareInProgress;
  }

  static createDefault(memberId: MemberId, now: Date): SolvingPreferences {
    return new SolvingPreferences({
      memberId,
      trackCompletionDuration: undefined,
      shareInProgress: undefined,
      updatedAt: now,
    });
  }

  setTrackCompletionDuration(enabled: boolean, now: Date): void {
    if (this.state.trackCompletionDuration === enabled) return;
    this.state = {
      ...this.state,
      trackCompletionDuration: enabled,
      updatedAt: now,
    };
  }

  setShareInProgress(enabled: boolean, now: Date): void {
    if (this.state.shareInProgress === enabled) return;
    this.state = { ...this.state, shareInProgress: enabled, updatedAt: now };
  }

  static rehydrate(state: SolvingPreferencesState): SolvingPreferences {
    return new SolvingPreferences(state);
  }

  toState(): SolvingPreferencesState {
    return this.state;
  }
}
