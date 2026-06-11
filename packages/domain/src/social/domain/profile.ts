import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { DisplayName } from "./display-name";
import { SocialError } from "./errors";
import { ProfileUpdated } from "./events";
import { MemberId, ProfileId } from "./ids";

// Input to edit(): the still-unvalidated display name plus an optional bio. The bio is free
// text (or cleared by passing undefined); the display name is validated by the DisplayName VO.
export interface EditProps {
  readonly displayName: string;
  readonly bio?: string;
  readonly now: Date;
}

// The persistable shape of a member's public profile, kept deliberately close to a `profiles`
// table so the 1b mapper is a trivial field-for-field translation (DisplayName <-> string).
export interface ProfileState {
  readonly id: ProfileId;
  readonly memberId: MemberId;
  readonly displayName: DisplayName;
  readonly bio?: string;
  readonly updatedAt: Date;
}

// Profile: the per-member aggregate root for the public face of a member (display name, bio).
// One profile per member; it is created with a valid display name and emits ProfileUpdated on
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

  get displayName(): DisplayName {
    return this.state.displayName;
  }

  get bio(): string | undefined {
    return this.state.bio;
  }

  // Open a brand-new profile for a member. Validates the display name; an invalid one fails the
  // whole creation. Records ProfileUpdated so the initial public state propagates like any edit.
  static create(
    id: ProfileId,
    memberId: MemberId,
    props: EditProps,
  ): Result<Profile, SocialError> {
    const displayName = DisplayName.create(props.displayName);
    if (displayName.isErr) return err(displayName.error);

    const profile = new Profile({
      id,
      memberId,
      displayName: displayName.value,
      bio: props.bio,
      updatedAt: props.now,
    });
    profile.record(
      new ProfileUpdated(id, memberId, displayName.value.value, props.now),
    );
    return ok(profile);
  }

  // Apply an edit to the editable fields. Decides only from its own data: rejects an invalid
  // display name. Emits ProfileUpdated carrying the new display name for subscribers.
  edit(props: EditProps): Result<void, SocialError> {
    const displayName = DisplayName.create(props.displayName);
    if (displayName.isErr) return err(displayName.error);

    this.state = {
      ...this.state,
      displayName: displayName.value,
      bio: props.bio,
      updatedAt: props.now,
    };

    this.record(
      new ProfileUpdated(
        this.state.id,
        this.state.memberId,
        displayName.value.value,
        props.now,
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
    return new Profile(state);
  }

  toState(): ProfileState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
