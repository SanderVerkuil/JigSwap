import { err, ok, Result } from "../../shared-kernel";
import { IdentityError } from "./errors";

// The elevated roles a Member may hold beyond a plain account. The literal union IS the value
// object: an ordinary member holds none of these. Mirrors StarRating's "create validates the
// primitive" style without needing a wrapper class for a closed string set.
export const ROLES = ["admin", "moderator"] as const;

export type Role = (typeof ROLES)[number];

// Validate an untrusted string (e.g. from a Clerk claim or an admin command) into a Role.
export const createRole = (value: string): Result<Role, IdentityError> => {
  if ((ROLES as readonly string[]).includes(value)) {
    return ok(value as Role);
  }
  return err(IdentityError.invalidRole(value));
};

export const isRole = (value: string): value is Role =>
  (ROLES as readonly string[]).includes(value);
