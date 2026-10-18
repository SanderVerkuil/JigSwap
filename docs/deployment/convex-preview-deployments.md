# Convex preview deployments (per-PR backends)

Every pull request labeled **`preview`** (and not a draft) gets a Vercel web preview and
its own isolated Convex **preview deployment**, named after the PR branch, instead of all
PRs sharing the single dev deployment. Preview deployments are
available on every Convex plan, including Free/Starter (they expire faster there — see
[Behavior](#behavior)).

- `.github/workflows/vercel-preview.yml` deploys the web preview with the Vercel CLI
  (see [Label-gated previews](#label-gated-previews)).
- `.github/workflows/convex-preview.yml` deploys the branch's backend to its preview on
  every push to a labeled PR, then checks whether the preview's database is empty and seeds it from
  a snapshot of the shared dev deployment only if so (state-based seeding — a non-empty
  preview is never touched).
- `.github/workflows/convex-deploy.yml`'s `dev` job now runs **only on pushes to main** —
  the shared dev deployment tracks main.

## Label-gated previews

Vercel's daily deployment quota counts every deployment, including builds cancelled by an
Ignored Build Step, so skipping builds there would not save anything.
[`apps/web/vercel.json`](../../apps/web/vercel.json) instead sets
`git.deploymentEnabled` to `{"**": false, "main": true}`: the Git integration deploys
only `main` (production, unchanged) and no longer creates a preview for each PR push. The
setting is read from the pushed commit, so a branch created before this change still gets
Git previews until it is rebased onto main.

Previews are opt-in per PR with the `preview` label. `vercel-preview.yml` and
`convex-preview.yml` share one gate: the PR has the `preview` label and is not a draft.
They run when the label is added, on every push while it is on, and when a labeled draft
is marked ready for review. Both also have a manual `workflow_dispatch` that takes a
branch name and skips the label check. Removing the label (or closing the PR) deletes the
Convex preview through `convex-preview-teardown.yml`. The Vercel web preview stays, but it
is not redeployed.

`vercel-preview.yml` checks out the PR branch (not the merge ref) and runs
`vercel deploy --target=preview` from the repo root with a pinned CLI. The build runs
remotely on Vercel, so the dashboard Build Command (`scripts/vercel-build.sh`) and the
Preview-scoped env vars apply as before. The Vercel docs say a CLI deployment can lack the
Git branch association that sets `VERCEL_GIT_COMMIT_REF`, so the workflow:

- passes the branch as the build env `JIGSWAP_PREVIEW_BRANCH`, which `vercel-build.sh`
  prefers over `VERCEL_GIT_COMMIT_REF` and hands to `convex deploy --preview-name`, and
- adds the documented `--meta githubDeployment=1 --meta githubCommitRef=<branch>` so the
  deployment gets the branch association (branch-scoped env vars and the branch URL).

Then it posts the deployment URL as a single sticky PR comment, edited on every deploy.
Without the Vercel secrets (or on a fork PR) the job does nothing and emits a notice.

### One-time owner setup (label-gated previews)

1. Create the label: `gh label create preview --color 0E8A16 --description "Deploy a Vercel + Convex preview for this PR"`.
2. Vercel → Account Settings → Tokens: create a token scoped to the team and add it as
   the GitHub Actions secret **`VERCEL_TOKEN`**.
3. Add **`VERCEL_ORG_ID`** (team ID, Team Settings → General) and
   **`VERCEL_PROJECT_ID`** (Project Settings → General) as GitHub Actions secrets.
4. Optional: in Vercel project Settings → Git, turn off the PR comments of the Vercel bot
   if they become noise. Production deploys from `main` keep working through the Git
   integration with no change.

## One-time owner setup

These steps need dashboard access and can't be done from the repo.

### 1. Preview deploy key

1. Convex dashboard → project settings →
   [Preview deploy keys](https://dashboard.convex.dev/project/settings#preview-deploy-keys)
   → generate a **Preview** deploy key (format `preview:<team>:<project>|…`).
2. Add it as the GitHub Actions secret **`CONVEX_DEPLOY_KEY_PREVIEW`** (repo →
   Settings → Secrets and variables → Actions). Until this secret exists, the
   **Convex Preview** workflow succeeds as a documented no-op (it emits a notice and
   skips every step) rather than failing the PR checks.
3. Add the same key in Vercel as the env var **`CONVEX_DEPLOY_KEY`**, scoped to the
   **Preview** environment only (Production keeps its production deploy key).

### 2. Default environment variables for previews

Preview deployments are created fresh (and recreated after expiry), so they only receive
the **project default environment variables** configured for the _preview_ deployment
type (Convex dashboard → project settings → Environment Variables, or
`npx convex env default`). Defaults apply **at deployment creation** — changing them
later does not update existing previews.

Variables read by the backend (`packages/backend/convex`):

| Variable                             | Required?    | Used by                                         | Notes                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANON_REF_SECRET`                    | **Required** | `convex/social/privacy.ts`                      | HMAC key for hidden members' `anonRef` (#178). At least 32 characters; see [`ANON_REF_SECRET`](#anon_ref_secret-every-deployment). Without it the backend fails closed (a throwaway key per request plus a `console.error`), so it works but hidden members' refs change on every response.                                           |
| `CLERK_WEBHOOK_SECRET`               | Optional     | `convex/http.ts`                                | Read **per-request** inside the webhook handler; when unset the handler logs a warning and answers `503` — the preview deploys and works (Clerk webhooks never reach previews anyway). Still recommended on dev and **required in prod**, where Clerk actually delivers webhooks.                                                     |
| `NEXT_PUBLIC_CLERK_FRONTEND_API_URL` | **Required** | `convex/auth.config.ts`                         | Clerk issuer domain; without it the preview deploys but rejects every authenticated request.                                                                                                                                                                                                                                          |
| `AXIOM_API_KEY`                      | Optional     | `convex/lib/axiom.ts`                           | Wide-event log shipping; logging is a no-op without it.                                                                                                                                                                                                                                                                               |
| `AXIOM_DATASET`                      | Optional     | `convex/lib/axiom.ts`                           | Defaults to `jigswap`. Consider a separate dataset so preview noise stays out of dev telemetry.                                                                                                                                                                                                                                       |
| `AXIOM_EDGE`                         | Optional     | `convex/lib/axiom.ts`                           | Defaults to `eu-central-1.aws.edge.axiom.co`.                                                                                                                                                                                                                                                                                         |
| `EMAIL_BASE_URL`                     | Auto-set     | `notifications/sendEmail.ts`                    | **Not** a preview default — the Vercel build script sets it on every preview build (see [step 3](#3-vercel-point-preview-frontends-at-their-branchs-preview-backend)), so it always tracks the branch's current `VERCEL_BRANCH_URL`. Falls back to the code default (`https://jigswap.site`) only if the build script hasn't run yet. |
| `VAPID_PUBLIC_KEY`                   | Optional     | `notifications/getPushConfig.ts`, web push      | Web push is off (fails open) unless both keys are set.                                                                                                                                                                                                                                                                                |
| `VAPID_PRIVATE_KEY`                  | Optional     | `notifications/adapters/webPush.ts`             | See above.                                                                                                                                                                                                                                                                                                                            |
| `VAPID_SUBJECT`                      | Optional     | `notifications/adapters/webPush.ts`             | Defaults to `mailto:hello@jigswap.site`.                                                                                                                                                                                                                                                                                              |
| `FIRECRAWL_API_KEY`                  | Optional     | `catalog/adapters/firecrawlStorePageFetcher.ts` | Store-page fetching for catalog URL import; feature is off without it.                                                                                                                                                                                                                                                                |
| `MODERATION_PROVIDER`                | Optional     | `library/adapters/photoModeration.ts`           | `huggingface` (default), `sightengine`, or `none` to disable photo screening on previews (photos are then approved unchecked).                                                                                                                                                                                                        |
| `HF_MODERATION_TOKEN`                | Optional     | `library/adapters/photoModeration.ts`           | Hugging Face token with the "Inference Providers" permission. Without it new photos end `unscored` (visible to their uploader only); nothing is approved unchecked.                                                                                                                                                                   |
| `HF_MODERATION_MODEL`                | Optional     | `library/adapters/photoModeration.ts`           | Model id on the hf-inference provider; defaults to `Falconsai/nsfw_image_detection`.                                                                                                                                                                                                                                                  |
| `SIGHTENGINE_API_USER`               | Optional     | `library/adapters/photoModeration.ts`           | Sightengine API user; needed when `MODERATION_PROVIDER=sightengine`.                                                                                                                                                                                                                                                                  |
| `SIGHTENGINE_SECRET_KEY`             | Optional     | `library/adapters/photoModeration.ts`           | Sightengine API secret; needed when `MODERATION_PROVIDER=sightengine`. Without both, new photos end `unscored`.                                                                                                                                                                                                                       |
| `SIGHTENGINE_MODEL`                  | Optional     | `library/adapters/photoModeration.ts`           | Defaults to `nudity-2.1`.                                                                                                                                                                                                                                                                                                             |
| `MODERATION_NSFW_THRESHOLD`          | Optional     | `library/adapters/photoModeration.ts`           | Numeric threshold override (default 0.85).                                                                                                                                                                                                                                                                                            |
| `GIT_COMMIT`, `SERVICE_VERSION`      | Optional     | `convex/lib/logEvent.ts`                        | Log metadata only.                                                                                                                                                                                                                                                                                                                    |

At minimum, set a preview default for **`NEXT_PUBLIC_CLERK_FRONTEND_API_URL`**
(pointing at the same Clerk dev instance the dev deployment uses, so users from the dev
snapshot can sign in on previews) and for **`ANON_REF_SECRET`** (below). Everything else
is optional on previews.

#### `ANON_REF_SECRET` (every deployment)

When a member is hidden from the viewer, the backend replaces them with an `anonRef`.
That ref is an HMAC-SHA256 keyed by this server-only secret
(`packages/backend/convex/social/privacy.ts`, #178). Without the key, a viewer cannot
recompute a ref from a candidate member id. The secret must be at least 32 characters.
If it is unset or too short, the backend does **not** fall back to an unkeyed hash. It
signs with a random key that lasts for one request and logs
`ANON_REF_SECRET is unset or shorter than 32 characters…` in the deployment's logs on
every such request. Pages keep working, but refs change on every response.

Set it **before merging #178**. The production deploy runs right after CI passes on main,
and setting the variable earlier is harmless because the old code never reads it.
Run the commands from `packages/backend`. Use a different value for production than for
dev and previews. Leave the value out of the command so the CLI prompts for it and the
secret stays out of your shell history:

```bash
openssl rand -base64 48            # one value for prod, one for dev + previews (64 chars each)

npx convex env set --prod ANON_REF_SECRET                     # production (prompts for the value)
npx convex env set ANON_REF_SECRET                            # the shared dev deployment
npx convex env default set --type preview ANON_REF_SECRET     # default for NEW previews

# Existing previews predate the default (defaults apply only at creation), so set it on
# each live one too, or remove and re-add the PR's `preview` label to recreate it:
npx convex env set --deployment preview/<branch-with-slashes-as-dashes> ANON_REF_SECRET

# Check (names only, values are never printed):
npx convex env list --prod --names-only
npx convex env list --names-only
npx convex env default list --type preview --names-only
```

`npx convex env set ANON_REF_SECRET` without a flag targets the deployment in your local
`packages/backend/.env.local` (`CONVEX_DEPLOYMENT`). If that is not the shared dev
deployment, pass `--deployment <name>`. No GitHub or Vercel secret is needed: the GitHub
preview workflow and the Vercel build both deploy to the same Convex preview, and that
preview reads the project default.

Nothing stores an `anonRef`. The schema, notifications and data export never contain
one, and the web app never reads the value. So setting or rotating the secret
changes each hidden member's ref once, on the next render. Rotate it by setting a new
value the same way.

### 3. Vercel: point preview frontends at their branch's preview backend

Per the [Convex + Vercel guide](https://docs.convex.dev/production/hosting/vercel),
override the Vercel **build command** so preview builds run through `npx convex deploy`,
which (with the Preview-scoped `CONVEX_DEPLOY_KEY` from step 1) targets the branch-named
preview deployment and injects its URL into the build.

The script passes `--typecheck enable`, so a type error in the Convex functions (or their
`*.test.ts` suites, which `convex/tsconfig.json` includes) fails the preview build instead
of being skipped. See `packages/backend/README.md`.

The Vercel project's root directory is **`apps/web`** (build cwd = `apps/web`, plain
`vite build`). Vercel has ONE build command for all environments, and the production
Convex deploy is deliberately CI-gated (`convex-deploy.yml` deploys prod only after CI
passes on main) — so branch on `VERCEL_ENV` to keep production builds exactly as they
are today. The dashboard Build Command is the versioned script
[`scripts/vercel-build.sh`](../../scripts/vercel-build.sh):

```bash
bash ../../scripts/vercel-build.sh
```

If you previously pasted the inline one-liner as the Build Command, replace it with the
line above.

How it resolves on previews: the deploy runs from `packages/backend` with
`--preview-name` set to `JIGSWAP_PREVIEW_BRANCH` (falling back to `VERCEL_GIT_COMMIT_REF`
for a Git-triggered build), landing on the **same** branch-named preview the GitHub
Action creates/seeds, then runs `pnpm --filter @jigswap/web build` with
`VITE_CONVEX_URL` injected. The filter flag works from any directory in the workspace
and output still lands in `apps/web/.output`, so the Output Directory setting stays
valid. (`VITE_CONVEX_URL` is read in `apps/web/src/router.tsx` and
`apps/web/src/lib/require-admin.ts`; Vite inlines it at build time for both client and
SSR bundles.)

After the Convex deploy, the script also sets `EMAIL_BASE_URL` on that same preview
deployment: `npx convex env set --preview-name "$branch" EMAIL_BASE_URL
"https://$VERCEL_BRANCH_URL"` (or `VERCEL_URL` if a CLI deployment has no branch URL). Email CTA/preferences links
(`packages/backend/convex/notifications/sendEmail.ts`) need the web app's own origin,
but on previews that origin is only known once Vercel assigns it — so it can't be a
preview default env var (those apply only at deployment creation, see
[step 2](#2-default-environment-variables-for-previews)) and must instead be set from
inside the Vercel build, the one place that knows both the Convex preview and the web
URL. `VERCEL_BRANCH_URL` is Vercel's stable per-branch alias (unlike the per-deployment
URL, it doesn't change on every push), so the preview backend always links back to the
branch's latest web preview. `--preview-name` is accepted by `convex env set` even
though `--help` hides it (verified against the CLI source, same as the `convex data`
precedent below). Production is untouched: prod's `EMAIL_BASE_URL` is a stable
one-time `npx convex env set` (plus the `https://jigswap.site` code default).

Vercel env-var scoping:

| Variable                     | Preview scope         | Production scope                    |
| ---------------------------- | --------------------- | ----------------------------------- |
| `CONVEX_DEPLOY_KEY`          | the `preview:…` key   | _not set — prod deploys stay in CI_ |
| `VITE_CONVEX_URL`            | **remove** (injected) | keep the static prod URL            |
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_test…`            | prod key later                      |
| `CLERK_SECRET_KEY`           | `sk_test…`            | prod key later                      |

Also confirm Settings → Root Directory → **"Include source files outside of the Root
Directory"** is enabled (default for monorepos) so `packages/backend` exists in the
build container.

## Teardown on PR close

`.github/workflows/convex-preview-teardown.yml` deletes the branch's preview
deployment when its PR is merged or closed, or when the PR's `preview` label is removed,
so review environments don't linger until expiry. It calls the
[Convex Management API](https://docs.convex.dev/management-api) directly (the CLI
has no `deployment delete` — see
[convex-backend#455](https://github.com/get-convex/convex-backend/issues/455)):
slug → project id → list deployments → delete the preview whose `reference` matches
the PR branch (references are `preview/<branch>` with slashes replaced by dashes).
Auto-expiry is nominally the fallback for anything the teardown misses, but it has
proven unreliable in practice — hence the sweep below.

### Sweeping stale previews

The same workflow has a manual **sweep** (Actions → Convex Preview Teardown → Run
workflow): it deletes every preview deployment whose branch has no open PR. The
keep-set is computed from open PRs with the same branch→reference mapping, so a
reference never needs to be reverse-parsed. `dryRun` is checked by default and only
lists what would be deleted — eyeball that list, then re-dispatch with `dryRun`
unchecked to actually delete. If listing open PRs fails, the job aborts rather than
treating the failure as "no open PRs".

### One-time owner setup (teardown)

1. Convex dashboard → team settings → access tokens → create a **team token** →
   add it as the GitHub Actions secret **`CONVEX_MANAGEMENT_TOKEN`**. (Deploy keys
   cannot call the Management API.)
2. Set two GitHub Actions repository **variables**, both visible in any dashboard
   URL (`dashboard.convex.dev/t/<team-slug>/<project-slug>/…`):
   - **`CONVEX_TEAM_SLUG`** — the team slug
   - **`CONVEX_PROJECT_SLUG`** — the project slug

Until the secret and both variables exist, the teardown workflow succeeds as a
documented no-op (a notice in the job log), exactly like the preview deploy
workflow before its key is configured.

## Behavior

- **Branch-named, reused**: `convex deploy --preview-name <branch>` creates the preview
  if needed and _reuses_ the existing deployment **and its data** on subsequent pushes.
- **Seeded when empty (state-based)**: every run checks the preview's database with
  `convex data users --limit 1 --format jsonl --preview-name <branch>` (the `users`
  table is the sentinel — every dev snapshot contains users; `--preview-name` is
  accepted by `convex data` even though `--help` hides it). Only when that returns zero
  rows does CI export a snapshot of the shared dev deployment
  (`convex export --include-file-storage`, dev deploy key) and import it into the
  preview (`convex import --preview-name <branch> --replace-all -y`, preview deploy
  key). It is `--replace-all` (delete every existing table first) rather than
  `--replace` because the deploy step already pushed the branch's schema: a table the
  branch newly adds exists empty on the preview but is absent from the dev snapshot,
  and `--replace` aborts on the resulting table-ID conflict.
  `--replace-all` alone is not enough either: for such a table the backend creates an
  empty replacement and picks its table number mid-import (lowest free number), which can
  collide with a number the snapshot assigns to a table created later (PR #109:
  `conflict between memberOnboarding and whatsNewReadStates with table number 10051`).
  A retry can pass by luck, because the aborted import's hidden tables then occupy that number. So before
  importing, CI lists the preview's tables (`convex data --preview-name <branch>`) and
  `scripts/pin-snapshot-table-numbers.py` adds a `_tables` entry for every one the
  snapshot lacks, numbered above all of the snapshot's numbers. The snapshot's documents,
  IDs and table numbers are imported unchanged. A table the branch _removes_ is still
  imported from the snapshot (Convex accepts tables outside the schema).
  A preview that already has data is left untouched, so data created on the preview
  survives pushes — and a preview first created empty by the Vercel build, or recreated
  empty after expiry, gets seeded by the next run automatically.
- **Concurrent pushes are retried**: every push to a labeled PR makes the Vercel build and this
  workflow push to the same preview at the same time, and the loser fails with
  `503 … OptimisticConcurrencyControlFailure` (`start_push`) or `409 RaceDetected` /
  "… was created by a concurrent push". The CLI does not retry those (they are POSTs),
  so both sides run `convex deploy` through `scripts/convex-deploy-retry.sh`, which
  retries up to 4 attempts (15/30/60s apart) **only** on those race messages; a
  typecheck or any other failure exits at once. A retry re-pushes the same code (the
  CLI uploads only modules the server lacks) and keeps `--typecheck enable`. On Vercel,
  `--cmd` runs before the push, so a retry also rebuilds the web app.
- **Seeding cannot hit dev/prod**: the import step only has the preview deploy key,
  with which the CLI resolves `--preview-name` project-scoped to preview deployments;
  the dev key (which would make the CLI ignore `--preview-name`) is only exposed to the
  read-only export step.
- **Teardown on close, expiry as fallback**: the teardown workflow (above) deletes a
  PR's preview when the PR closes; previews it misses are deleted automatically after
  **5 days** on Free/Starter (**14 days** on Pro+). The Convex CLI has **no delete
  command** for preview deployments (verified against the CLI reference and
  `convex deployment --help`), which is why the teardown uses the Management API.
- **Revive after expiry is automatic**: the next workflow run (any push to a labeled PR,
  or a manual run with the branch name) recreates the expired preview, finds it empty, and seeds it
  — no special event needed. To deliberately **re-seed a preview that still has data**,
  run the workflow manually (Actions → Convex Preview → Run workflow) with the branch
  name and the **force** checkbox enabled; this replaces the preview's data with a
  fresh dev snapshot.
- **No-op until configured**: while the `CONVEX_DEPLOY_KEY_PREVIEW` secret is missing,
  the workflow emits a GitHub notice and skips all steps, so PRs stay green during the
  one-time owner setup window.
- **Clerk webhooks do not reach previews**: users and profile updates arrive on the dev
  deployment via Clerk webhooks; previews only have whatever the dev snapshot contained.
  A user created _after_ the seed won't exist on the preview until it's re-seeded. With
  `CLERK_WEBHOOK_SECRET` unset the webhook endpoint answers `503` and logs a warning.
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
