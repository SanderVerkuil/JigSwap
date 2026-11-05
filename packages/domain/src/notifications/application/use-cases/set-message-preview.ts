import { Clock, ok, Result } from "../../../shared-kernel";
import { NotificationPreference } from "../../domain";
import {
  SetMessagePreview,
  SetMessagePreviewCommand,
} from "../ports/in/set-message-preview.port";
import { NotificationPreferenceIdGenerator } from "../ports/out/notification-preference-id-generator";
import { NotificationPreferenceRepository } from "../ports/out/notification-preference.repository";

export interface SetMessagePreviewDeps {
  readonly preferences: NotificationPreferenceRepository;
  readonly preferenceIds: NotificationPreferenceIdGenerator;
  readonly clock: Clock;
}

// Set whether email or push may quote a message's text, materialising the member's default
// preference first if none is stored. The aggregate owns the default and the no-op rule.
export const makeSetMessagePreview =
  (deps: SetMessagePreviewDeps): SetMessagePreview =>
  async (cmd: SetMessagePreviewCommand): Promise<Result<void, never>> => {
    const now = deps.clock.now();
    const preference =
      (await deps.preferences.findByMember(cmd.memberId)) ??
      NotificationPreference.createDefault(
        deps.preferenceIds.next(),
        cmd.memberId,
        now,
      );
    preference.setMessagePreview(cmd.channel, cmd.enabled, now);
    await deps.preferences.save(preference);
    return ok(undefined);
  };
