# Convex preview deployments (per-PR backends)

Every pull request gets its own isolated Convex **preview deployment**, named after the
PR branch, instead of all PRs sharing the single dev deployment. Preview deployments are
available on every Convex plan, including Free/Starter (they expire faster there — see
[Behavior](#behavior)).

- `.github/workflows/convex-preview.yml` deploys the branch's backend to its preview on
  every PR push, and seeds it once from a snapshot of the shared dev deployment when the
  PR is opened or reopened.
- `.github/workflows/convex-deploy.yml`'s `dev` job now runs **only on pushes to main** —
  the shared dev deployment tracks main.

## One-time owner setup

These steps need dashboard access and can't be done from the repo.

### 1. Preview deploy key

1. Convex dashboard → project settings →
   [Preview deploy keys](https://dashboard.convex.dev/project/settings#preview-deploy-keys)
   → generate a **Preview** deploy key (format `preview:<team>:<project>|…`).
2. Add it as the GitHub Actions secret **`CONVEX_DEPLOY_KEY_PREVIEW`** (repo →
   Settings → Secrets and variables → Actions).
3. Add the same key in Vercel as the env var **`CONVEX_DEPLOY_KEY`**, scoped to the
   **Preview** environment only (Production keeps its production deploy key).

### 2. Default environment variables for previews

Preview deployments are created fresh (and recreated after expiry), so they only receive
the **project default environment variables** configured for the _preview_ deployment
type (Convex dashboard → project settings → Environment Variables, or
`npx convex env default`). Defaults apply **at deployment creation** — changing them
later does not update existing previews.

Variables read by the backend (`packages/backend/convex`):

| Variable                             | Required?    | Used by                                         | Notes                                                                                                                                                                                                   |
| ------------------------------------ | ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLERK_WEBHOOK_SECRET`               | **Required** | `convex/http.ts`                                | Read at **module scope** via `ensureEnvironmentVariable`, which **throws** — a preview **fails to deploy** without it. Any non-empty value works for previews (Clerk webhooks never reach them anyway). |
| `NEXT_PUBLIC_CLERK_FRONTEND_API_URL` | **Required** | `convex/auth.config.ts`                         | Clerk issuer domain; without it the preview deploys but rejects every authenticated request.                                                                                                            |
| `AXIOM_API_KEY`                      | Optional     | `convex/lib/axiom.ts`                           | Wide-event log shipping; logging is a no-op without it.                                                                                                                                                 |
| `AXIOM_DATASET`                      | Optional     | `convex/lib/axiom.ts`                           | Defaults to `jigswap`. Consider a separate dataset so preview noise stays out of dev telemetry.                                                                                                         |
| `AXIOM_EDGE`                         | Optional     | `convex/lib/axiom.ts`                           | Defaults to `eu-central-1.aws.edge.axiom.co`.                                                                                                                                                           |
| `VAPID_PUBLIC_KEY`                   | Optional     | `notifications/getPushConfig.ts`, web push      | Web push is off (fails open) unless both keys are set.                                                                                                                                                  |
| `VAPID_PRIVATE_KEY`                  | Optional     | `notifications/adapters/webPush.ts`             | See above.                                                                                                                                                                                              |
| `VAPID_SUBJECT`                      | Optional     | `notifications/adapters/webPush.ts`             | Defaults to `mailto:hello@jigswap.site`.                                                                                                                                                                |
| `FIRECRAWL_API_KEY`                  | Optional     | `catalog/adapters/firecrawlStorePageFetcher.ts` | Store-page fetching for catalog URL import; feature is off without it.                                                                                                                                  |
| `MODERATION_PROVIDER`                | Optional     | `library/moderatePhoto.ts`                      | Defaults to `huggingface`; set `none` to disable photo moderation on previews.                                                                                                                          |
| `HF_MODERATION_TOKEN`                | Optional     | `library/adapters/photoModeration.ts`           | Hugging Face token; the adapter fails open (approves) without it.                                                                                                                                       |
| `MODERATION_NSFW_THRESHOLD`          | Optional     | `library/moderatePhoto.ts`                      | Numeric threshold override.                                                                                                                                                                             |
| `GIT_COMMIT`, `SERVICE_VERSION`      | Optional     | `convex/lib/logEvent.ts`                        | Log metadata only.                                                                                                                                                                                      |

At minimum, set preview defaults for **`CLERK_WEBHOOK_SECRET`** and
**`NEXT_PUBLIC_CLERK_FRONTEND_API_URL`** (pointing at the same Clerk dev instance the
dev deployment uses, so users from the dev snapshot can sign in on previews).

### 3. Vercel: point preview frontends at their branch's preview backend

Per the [Convex + Vercel guide](https://docs.convex.dev/production/hosting/vercel),
override the Vercel **build command** so the frontend build runs through
`npx convex deploy`, which (with the Preview-scoped `CONVEX_DEPLOY_KEY` from step 1)
targets the branch-named preview deployment and injects its URL into the build:

```
npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd '<existing build command>'
```

Notes for this repo:

- It's a pnpm monorepo — backend in `packages/backend`, web app in `apps/web`.
  `VITE_CONVEX_URL` is read in `apps/web/src/router.tsx` and
  `apps/web/src/lib/require-admin.ts`.
- The exact command shape depends on the Vercel project's **root directory** setting
  (not visible from the repo). If the root directory is `apps/web`, `npx convex deploy`
  must still run against `packages/backend`, e.g.:
  `cd ../.. && pnpm exec convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'pnpm --filter web build'`
  (run from `packages/backend` via `pnpm --dir packages/backend exec …` if needed) —
  verify against the project's current build command.
- Vercel infers the same Git branch name Convex uses, so the frontend preview and the
  GitHub-Actions-created backend preview land on the **same** deployment.
- Afterward, **remove the static Preview-scoped `VITE_CONVEX_URL`** env var from Vercel —
  it would otherwise pin every frontend preview to one fixed backend.

## Behavior

- **Branch-named, reused**: `convex deploy --preview-name <branch>` creates the preview
  if needed and _reuses_ the existing deployment **and its data** on subsequent pushes.
- **Seeded once**: on PR `opened`/`reopened`, CI exports a snapshot of the shared dev
  deployment (`convex export --include-file-storage`, dev deploy key) and imports it
  into the preview (`convex import --preview-name <branch> --replace -y`, preview deploy
  key). Pushes (`synchronize`) only redeploy code — they never re-import, so data
  created on the preview survives.
- **Seeding cannot hit dev/prod**: the import step only has the preview deploy key,
  with which the CLI resolves `--preview-name` project-scoped to preview deployments;
  the dev key (which would make the CLI ignore `--preview-name`) is only exposed to the
  read-only export step.
- **Expiry is the cleanup**: previews are deleted automatically after **5 days** on
  Free/Starter (**14 days** on Pro+). The Convex CLI has **no delete command** for
  preview deployments (verified against the CLI reference and `convex deployment
--help`), so there is no PR-close cleanup job.
- **Re-seed / revive after expiry**: run the **Convex Preview** workflow manually
  (Actions → Convex Preview → Run workflow) with the PR branch name. It recreates the
  preview from that branch and re-imports a fresh dev snapshot. Note this **replaces**
  data in the imported tables.
- **Clerk webhooks do not reach previews**: users and profile updates arrive on the dev
  deployment via Clerk webhooks; previews only have whatever the dev snapshot contained.
  A user created _after_ the seed won't exist on the preview until it's re-seeded.
- **Shared dev tracks main**: PR pushes no longer deploy to dev, so concurrent PRs with
  conflicting schemas can't break each other's backend anymore.

## References (verified 2026-07-08)

- Preview deployments — creation, naming, reuse vs recreate, expiry:
  <https://docs.convex.dev/production/hosting/preview-deployments>
- CLI reference (`deploy --preview-name/--preview-create/--preview-run`, `export`,
  `import`, no delete command): <https://docs.convex.dev/cli>
- Deploy key types (preview keys redirect `convex deploy` to a preview):
  <https://docs.convex.dev/cli/deploy-key-types>
- Snapshot export/import:
  <https://docs.convex.dev/database/import-export/export>,
  <https://docs.convex.dev/database/import-export/import>
- Vercel build-command override:
  <https://docs.convex.dev/production/hosting/vercel>
- Project default environment variables:
  <https://docs.convex.dev/production/environment-variables>
