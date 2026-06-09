import { err, ok, Result } from "../../shared-kernel";
import { IdentityError } from "./errors";

// A pragmatic single-line email pattern: a non-empty local part, an "@", and a domain with at
// least one dot. We deliberately do not chase RFC 5322 completeness — Clerk is the source of
// truth for verification; this VO only rejects obviously malformed values at our boundary.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// An email address as an immutable value object validated at construction. Stored normalised
// (trimmed, lower-cased) so equality and the later `users.email` mapping are stable.
export class EmailAddress {
  private constructor(readonly value: string) {}

  static create(value: string): Result<EmailAddress, IdentityError> {
    const normalised = value.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalised)) {
      return err(IdentityError.invalidEmail(value));
    }
    return ok(new EmailAddress(normalised));
  }
}
