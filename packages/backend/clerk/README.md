# Clerk configuration

Admin rights depend on two Clerk settings that live in the Clerk dashboard, not in this repo. The
files here are the expected versions. `convex/clerkTemplates.test.ts` checks them, and the live
dashboard must match them.

| File                       | Clerk setting                               | Read by                                                                       |
| -------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| `convex-jwt-template.json` | JWT template named `convex`                 | Convex: `auth.config.ts` (`aud`) and `convex/identity/isAdmin.ts` (role)      |
| `session-token.json`       | Sessions → Customize session token (claims) | Web: `apps/web/src/lib/roles.ts` (`sessionClaims.metadata.role`) for `/admin` |

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

## Checking the live configuration

Do this for each Clerk instance (development and production) whenever either setting changes:

1. Clerk dashboard → Configure → JWT templates → `convex`. The claims must contain `"aud": "convex"`
   and `"metadata": "{{user.public_metadata}}"`, and must not mention `unsafe_metadata` or a flat
   `role`.
2. Clerk dashboard → Configure → Sessions → Customize session token. The claims must contain
   `"metadata": "{{user.public_metadata}}"`, with the same two exclusions.
3. If you change the expected configuration, change these files in the same pull request.
