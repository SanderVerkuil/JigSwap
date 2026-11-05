# Clerk configuration

Admin rights depend on Clerk settings that live in the Clerk dashboard, not in this repo. The
files here are the expected versions. `convex/clerkTemplates.test.ts` checks them, and the live
dashboard must match them.

| File                       | Clerk setting                               | Read by                                                                                    |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `convex-jwt-template.json` | JWT template named `convex`                 | Convex: `auth.config.ts` (`aud`) and `convex/identity/isAdmin.ts` (`metadata.role`)        |
| `session-token.json`       | Sessions → Customize session token (claims) | Web: `sessionClaims.metadata.role`, typed in `apps/web/src/types/globals.d.ts` (see below) |

The `convex` template is the one that grants admin. Every admin Convex function checks
`identity/isAdmin`, and the web `/admin` guard (`apps/web/src/lib/require-admin.ts`) asks the same
check through `identity/isCurrentUserAdmin` with a `convex` token. The session-token claim is read
only by `checkRole` in `apps/web/src/lib/roles.ts`, which nothing calls today. It is versioned so
that any future use of `sessionClaims` stays safe.

Both map the `metadata` claim to `{{user.public_metadata}}`. Only the Clerk Backend API can write
public metadata (`admin/setUserRole`), so `metadata.role` is trustworthy.

Rules:

- Never map anything from `unsafe_metadata`. The browser writes it (the web stores shell
  preferences in `unsafeMetadata.shellPrefs`), so a claim built from it lets any member make
  themselves admin.
- Never add a flat `role` claim. `isAdmin` reads only `metadata.role`.
- `aud` must stay `"convex"`, the `applicationID` in `convex/auth.config.ts`.
- Clerk adds `sub`, `iss`, `iat`, `exp` and `nbf` itself. The backend reads only `sub` and
  `metadata.role`. Other claims (name, email and so on) are unused.

## Before deploying the metadata-only admin check

`isAdmin` used to accept a flat `role` claim as a fallback. The commit "fix(identity): grant admin
only from the versioned metadata claim" removed it, and it fails closed: if a live `convex`
template emits a flat `role` instead of `metadata`, every admin loses `/admin` and every admin
Convex function as soon as that commit is deployed. So the order is:

1. Check the live `convex` template on BOTH instances, development and production (step 1 of the
   checklist below). Both must contain `"metadata": "{{user.public_metadata}}"`. Fix the template
   first if one does not.
2. Deploy to development, sign in as an admin and open `/admin`.
3. Only then deploy to production.

## Checking the live configuration

Do this for each Clerk instance (development and production) whenever either setting changes:

1. Clerk dashboard → Configure → JWT templates → `convex`. The claims must contain `"aud": "convex"`
   and `"metadata": "{{user.public_metadata}}"`, and must not mention `unsafe_metadata` or a flat
   `role`.
2. Clerk dashboard → Configure → Sessions → Customize session token. The claims must contain
   `"metadata": "{{user.public_metadata}}"`, with the same two exclusions.
3. If you change the expected configuration, change these files in the same pull request.
