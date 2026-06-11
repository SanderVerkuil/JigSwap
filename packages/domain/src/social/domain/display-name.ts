import { err, ok, Result } from "../../shared-kernel";
import { SocialError } from "./errors";

// A member's public display name as an immutable value object validated at construction. The
// raw input is trimmed; an empty/whitespace-only name is rejected with InvalidDisplayName. We
// store the trimmed form so the Profile never holds incidental leading/trailing whitespace.
export class DisplayName {
  private constructor(readonly value: string) {}

  static create(value: string): Result<DisplayName, SocialError> {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return err(SocialError.invalidDisplayName());
    }
    return ok(new DisplayName(trimmed));
  }
}
