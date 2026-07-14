import { DomainEvent } from "../../shared-kernel";
import { Channel, CHANNELS } from "./channel";
import { PreferenceChanged } from "./events";
import { MemberId, NotificationPreferenceId } from "./ids";
import { NOTIFICATION_TYPES, NotificationType } from "./notification-type";

// The set of channels enabled for a single notification type. A missing channel means disabled.
export type ChannelToggles = Readonly<Partial<Record<Channel, boolean>>>;

// A channel toggle map with every channel explicitly resolved -- what `defaultToggles` and
// `resolvedToggles` always produce (no absent keys to fall back on).
type ResolvedChannelToggles = Readonly<Record<Channel, boolean>>;

// The persistable shape: per (type, channel) enablement, plus the member it belongs to. We store
// only the toggles that differ from "off" is NOT assumed — we store the full resolved map so the
// 4a-backend mapper is a plain serialise; `allows` reads it directly without re-deriving defaults.
export interface NotificationPreferenceState {
  readonly id: NotificationPreferenceId;
  readonly memberId: MemberId;
  // type -> channel -> enabled. Absent (type or channel) resolves to disabled.
  readonly toggles: Readonly<Partial<Record<NotificationType, ChannelToggles>>>;
  readonly updatedAt: Date;
}

// Build the sensible default toggle map: every type enabled on inApp, email/push off. This is the
// policy a member with no stored preference gets (the application layer materialises one of these).
const defaultToggles = (): Record<NotificationType, ResolvedChannelToggles> => {
  const map = {} as Record<NotificationType, ResolvedChannelToggles>;
  for (const type of NOTIFICATION_TYPES) {
    map[type] = { inApp: true, email: false, push: false };
  }
  return map;
};

// NotificationPreference: the per-member aggregate root governing which (type, channel) deliveries
// a member accepts. NotifyMember consults `allows` per channel; this is the policy seam that keeps
// Notifications a pure subscriber.
export class NotificationPreference {
  private events: DomainEvent[] = [];

  private constructor(private state: NotificationPreferenceState) {}

  get id(): NotificationPreferenceId {
    return this.state.id;
  }

  get memberId(): MemberId {
    return this.state.memberId;
  }

  // A fresh preference set carrying the sensible defaults (all types on inApp; email/push off).
  static createDefault(
    id: NotificationPreferenceId,
    memberId: MemberId,
    now: Date,
  ): NotificationPreference {
    return new NotificationPreference({
      id,
      memberId,
      toggles: defaultToggles(),
      updatedAt: now,
    });
  }

  // Does this member accept a notification of `type` on `channel`? Falls back PER CHANNEL: absent
  // keys arise from type-level absence (untouched types, or types added after the row was written)
  // or channels added later; an explicit stored value (including false) always wins.
  allows(type: NotificationType, channel: Channel): boolean {
    return (
      this.state.toggles[type]?.[channel] ?? defaultToggles()[type][channel]
    );
  }

  // The full 21-type read model: every NOTIFICATION_TYPES member resolved to its complete
  // {inApp, email, push} triple, via the same per-channel stored-over-default merge as `allows`.
  // This is the READ-side truth the preferences UI renders; `allows` is the delivery-side
  // equivalent.
  resolvedToggles(): Readonly<Record<NotificationType, ChannelToggles>> {
    const resolved = {} as Record<NotificationType, ChannelToggles>;
    for (const type of NOTIFICATION_TYPES) {
      const triple = {} as Record<Channel, boolean>;
      for (const channel of CHANNELS) {
        triple[channel] = this.allows(type, channel);
      }
      resolved[type] = triple;
    }
    return resolved;
  }

  // Turn a (type, channel) delivery on. Records PreferenceChanged only when it actually changed.
  enable(type: NotificationType, channel: Channel, now: Date): void {
    this.set(type, channel, true, now);
  }

  // Turn a (type, channel) delivery off. Records PreferenceChanged only when it actually changed.
  disable(type: NotificationType, channel: Channel, now: Date): void {
    this.set(type, channel, false, now);
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: NotificationPreferenceState): NotificationPreference {
    return new NotificationPreference(state);
  }

  toState(): NotificationPreferenceState {
    return this.state;
  }

  // --- internals ---

  // The ONLY place toggles change. No-ops (and records nothing) if the value already matches, so a
  // redundant toggle never emits a spurious PreferenceChanged.
  private set(
    type: NotificationType,
    channel: Channel,
    enabled: boolean,
    now: Date,
  ): void {
    if (this.allows(type, channel) === enabled) {
      return;
    }
    const current = this.state.toggles[type] ?? defaultToggles()[type];
    const nextForType: ChannelToggles = { ...current, [channel]: enabled };
    this.state = {
      ...this.state,
      toggles: { ...this.state.toggles, [type]: nextForType },
      updatedAt: now,
    };
    this.record(
      new PreferenceChanged(this.state.memberId, type, channel, enabled, now),
    );
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
