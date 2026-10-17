import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { DisplayName } from "./display-name";
import { SocialError } from "./errors";
import {
  ProfileShelfArranged,
  ProfileUpdated,
  ProfileVisibilityChanged,
} from "./events";
import { MemberId, ProfileId } from "./ids";

// Maximum number of copies that can be featured on the profile shelf.
export const MAX_FEATURED = 6;

// Who can see a member's profile. "public" (the default) reveals the member's identity to anyone;
// "private" hides it from members they are not connected with. Read by other features to decide
// whether to surface the member or treat them as anonymous.
export type ProfileVisibility = "public" | "private";

// Input to create()/edit(): the still-unvalidated display name plus an optional bio. The bio is
// free text (or cleared by passing undefined); a supplied display name is validated by the
// DisplayName VO. The display name is OPTIONAL: a profile can be opened lazily (visibility toggle,
// shelf curation) for a member who never chose one, and an edit that omits it keeps the current
// one (bio-only save). Readers fall back to the account name via resolveMemberDisplayName.
export interface EditProps {
  readonly displayName?: string;
  readonly bio?: string;
  readonly now: Date;
}

// The persistable shape of a member's public profile, kept deliberately close to a `profiles`
// table so the 1b mapper is a trivial field-for-field translation (DisplayName <-> string).
export interface ProfileState {
  readonly id: ProfileId;
  readonly memberId: MemberId;
  readonly displayName?: DisplayName;
  readonly bio?: string;
  readonly visibility: ProfileVisibility;
  // Ordered, curated set of owned copies featured on the profile shelf (sub-project ④).
  // Empty means uncurated (the plank falls back to recent-6).
  readonly featuredCopyIds: readonly string[];
  readonly updatedAt: Date;
}

// Profile: the per-member aggregate root for the public face of a member (display name, bio).
// One profile per member; it is created with a valid (or no) display name and emits ProfileUpdated on
// every successful edit so follower feeds and Notifications can react.
export class Profile {
  private events: DomainEvent[] = [];

  private constructor(private state: ProfileState) {}

  get id(): ProfileId {
    return this.state.id;
  }

  get memberId(): MemberId {
    return this.state.memberId;
  }

  get displayName(): DisplayName | undefined {
    return this.state.displayName;
  }

  get bio(): string | undefined {
    return this.state.bio;
  }

  get visibility(): ProfileVisibility {
    return this.state.visibility;
  }

  get featuredCopyIds(): readonly string[] {
    return this.state.featuredCopyIds;
  }

  // Open a brand-new profile for a member. Validates a supplied display name; an invalid one fails
  // the whole creation, an absent one leaves it unset. Records ProfileUpdated so the initial public
  // state propagates like any edit.
  static create(
    id: ProfileId,
    memberId: MemberId,
    props: EditProps,
  ): Result<Profile, SocialError> {
    let displayName: DisplayName | undefined;
    if (props.displayName !== undefined) {
      const created = DisplayName.create(props.displayName);
      if (created.isErr) return err(created.error);
      displayName = created.value;
    }

    const profile = new Profile({
      id,
      memberId,
      displayName,
      bio: props.bio,
      visibility: "public",
      featuredCopyIds: [],
      updatedAt: props.now,
    });
    profile.record(
      new ProfileUpdated(id, memberId, displayName?.value, props.now),
    );
    return ok(profile);
  }

  // Apply an edit to the editable fields. Decides only from its own data: rejects an invalid
  // display name; an omitted one keeps the current. Emits ProfileUpdated carrying the resulting
  // display name for subscribers.
  edit(props: EditProps): Result<void, SocialError> {
    let displayName = this.state.displayName;
    if (props.displayName !== undefined) {
      const created = DisplayName.create(props.displayName);
      if (created.isErr) return err(created.error);
      displayName = created.value;
    }

    this.state = {
      ...this.state,
      displayName,
      bio: props.bio,
      updatedAt: props.now,
    };

    this.record(
      new ProfileUpdated(
        this.state.id,
        this.state.memberId,
        displayName?.value,
        props.now,
      ),
    );
    return ok(undefined);
  }

  // Change who can see this profile. There is nothing to validate beyond the union type, so it
  // always succeeds; the Result shape mirrors edit() for a uniform call site. Emits
  // ProfileVisibilityChanged carrying the new visibility for subscribers.
  changeVisibility(
    visibility: ProfileVisibility,
    now: Date,
  ): Result<void, SocialError> {
    this.state = {
      ...this.state,
      visibility,
      updatedAt: now,
    };

    this.record(
      new ProfileVisibilityChanged(
        this.state.id,
        this.state.memberId,
        visibility,
        now,
      ),
    );
    return ok(undefined);
  }

  // Set the curated, ordered list of owned copies featured on the profile shelf. Dedupes preserving
  // first-occurrence order; caps at MAX_FEATURED. Empty array clears the shelf. Always succeeds —
  // the Result shape matches changeVisibility for a uniform call site. Emits ProfileShelfArranged.
  arrangeShelf(
    copyIds: readonly string[],
    now: Date,
  ): Result<void, SocialError> {
    const deduped = [...new Set(copyIds)].slice(0, MAX_FEATURED);
    this.state = { ...this.state, featuredCopyIds: deduped, updatedAt: now };
    this.record(
      new ProfileShelfArranged(
        this.state.id,
        this.state.memberId,
        deduped,
        now,
      ),
    );
    return ok(undefined);
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: ProfileState): Profile {
    return new Profile({
      ...state,
      featuredCopyIds: state.featuredCopyIds ?? [],
    });
  }

  toState(): ProfileState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
