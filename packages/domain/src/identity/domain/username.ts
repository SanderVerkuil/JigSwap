import { err, ok, Result } from "../../shared-kernel";
import { IdentityError } from "./errors";

// 3-30 chars of letters, digits, underscore, or hyphen — matches the public handle conventions
// we expose, narrow enough to keep URLs/mentions unambiguous.
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,30}$/;

// An optional public handle as an immutable value object. Constructed only via `create`, which
// validates length and charset; the membership stores it verbatim (case-preserving).
export class Username {
  private constructor(readonly value: string) {}

  static create(value: string): Result<Username, IdentityError> {
    if (!USERNAME_PATTERN.test(value)) {
      return err(IdentityError.invalidUsername(value));
    }
    return ok(new Username(value));
  }
}
