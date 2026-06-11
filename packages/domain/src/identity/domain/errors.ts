import { DomainError } from "../../shared-kernel";

// A closed set of reasons a Member entity operation can fail from its own data. The `code` is
// the stable, machine-readable discriminant a transport adapter maps to (the human message is
// for logs/tests only). Modelled as a DomainError subclass so it can be thrown or carried in a
// Result interchangeably. Cross-aggregate failures (clerkId uniqueness, member-not-found) are
// orchestration concerns and live in the application layer, not here.
export type IdentityErrorCode =
  | "InvalidEmail"
  | "InvalidUsername"
  | "InvalidRole"
  | "ClerkIdImmutable";

export class IdentityError extends DomainError {
  override readonly name = "IdentityError";

  private constructor(
    readonly code: IdentityErrorCode,
    message: string,
  ) {
    super(message);
  }

  // The supplied string is not a syntactically valid email address.
  static invalidEmail(value: string): IdentityError {
    return new IdentityError(
      "InvalidEmail",
      `Email "${value}" is not a valid address`,
    );
  }

  // The supplied username violates the length/charset rules.
  static invalidUsername(value: string): IdentityError {
    return new IdentityError(
      "InvalidUsername",
      `Username "${value}" must be 3-30 chars of letters, digits, underscore, or hyphen`,
    );
  }

  // The supplied string is not one of the known elevated roles.
  static invalidRole(value: string): IdentityError {
    return new IdentityError(
      "InvalidRole",
      `Role "${value}" is not a known role`,
    );
  }

  // A Member's clerkId is fixed at registration and can never be reassigned.
  static clerkIdImmutable(): IdentityError {
    return new IdentityError(
      "ClerkIdImmutable",
      "A Member's clerkId is immutable once set",
    );
  }
}
