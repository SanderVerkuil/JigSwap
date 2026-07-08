# Convex preview deployments (per-PR backends)

Every pull request gets its own isolated Convex **preview deployment**, named after the
PR branch, instead of all PRs sharing the single dev deployment. Preview deployments are
available on every Convex plan, including Free/Starter (they expire faster there — see
[Behavior](#behavior)).

- `.github/workflows/convex-preview.yml` deploys the branch's backend to its preview on
  every PR push, then checks whether the preview's database is empty and seeds it from
  a snapshot of the shared dev deployment only if so (state-based seeding — a non-empty
  preview is never touched).
- `.github/workflows/convex-deploy.yml`'s `dev` job now runs **only on pushes to main** —
  the shared dev deployment tracks main.

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

| Variable                             | Required?    | Used by                                         | Notes                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLERK_WEBHOOK_SECRET`               | Optional     | `convex/http.ts`                                | Read **per-request** inside the webhook handler; when unset the handler logs a warning and answers `503` — the preview deploys and works (Clerk webhooks never reach previews anyway). Still recommended on dev and **required in prod**, where Clerk actually delivers webhooks. |
| `NEXT_PUBLIC_CLERK_FRONTEND_API_URL` | **Required** | `convex/auth.config.ts`                         | Clerk issuer domain; without it the preview deploys but rejects every authenticated request.                                                                                                                                                                                      |
| `AXIOM_API_KEY`                      | Optional     | `convex/lib/axiom.ts`                           | Wide-event log shipping; logging is a no-op without it.                                                                                                                                                                                                                           |
| `AXIOM_DATASET`                      | Optional     | `convex/lib/axiom.ts`                           | Defaults to `jigswap`. Consider a separate dataset so preview noise stays out of dev telemetry.                                                                                                                                                                                   |
| `AXIOM_EDGE`                         | Optional     | `convex/lib/axiom.ts`                           | Defaults to `eu-central-1.aws.edge.axiom.co`.                                                                                                                                                                                                                                     |
| `VAPID_PUBLIC_KEY`                   | Optional     | `notifications/getPushConfig.ts`, web push      | Web push is off (fails open) unless both keys are set.                                                                                                                                                                                                                            |
| `VAPID_PRIVATE_KEY`                  | Optional     | `notifications/adapters/webPush.ts`             | See above.                                                                                                                                                                                                                                                                        |
| `VAPID_SUBJECT`                      | Optional     | `notifications/adapters/webPush.ts`             | Defaults to `mailto:hello@jigswap.site`.                                                                                                                                                                                                                                          |
| `FIRECRAWL_API_KEY`                  | Optional     | `catalog/adapters/firecrawlStorePageFetcher.ts` | Store-page fetching for catalog URL import; feature is off without it.                                                                                                                                                                                                            |
| `MODERATION_PROVIDER`                | Optional     | `library/moderatePhoto.ts`                      | Defaults to `huggingface`; set `none` to disable photo moderation on previews.                                                                                                                                                                                                    |
| `HF_MODERATION_TOKEN`                | Optional     | `library/adapters/photoModeration.ts`           | Hugging Face token; the adapter fails open (approves) without it.                                                                                                                                                                                                                 |
| `MODERATION_NSFW_THRESHOLD`          | Optional     | `library/moderatePhoto.ts`                      | Numeric threshold override.                                                                                                                                                                                                                                                       |
| `GIT_COMMIT`, `SERVICE_VERSION`      | Optional     | `convex/lib/logEvent.ts`                        | Log metadata only.                                                                                                                                                                                                                                                                |

At minimum, set a preview default for **`NEXT_PUBLIC_CLERK_FRONTEND_API_URL`**
(pointing at the same Clerk dev instance the dev deployment uses, so users from the dev
snapshot can sign in on previews). Everything else is optional on previews.

### 3. Vercel: point preview frontends at their branch's preview backend

Per the [Convex + Vercel guide](https://docs.convex.dev/production/hosting/vercel),
override the Vercel **build command** so preview builds run through `npx convex deploy`,
which (with the Preview-scoped `CONVEX_DEPLOY_KEY` from step 1) targets the branch-named
preview deployment and injects its URL into the build.

The Vercel project's root directory is **`apps/web`** (build cwd = `apps/web`, plain
`vite build`). Vercel has ONE build command for all environments, and the production
Convex deploy is deliberately CI-gated (`convex-deploy.yml` deploys prod only after CI
passes on main) — so branch on `VERCEL_ENV` to keep production builds exactly as they
are today:

```bash
if [ "$VERCEL_ENV" = "preview" ]; then cd ../../packages/backend && npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'pnpm --filter @jigswap/web build'; else pnpm build; fi
```

How it resolves on previews: the deploy runs from `packages/backend`, auto-detects the
branch from `VERCEL_GIT_COMMIT_REF` (landing on the **same** branch-named preview the
GitHub Action creates/seeds), then runs `pnpm --filter @jigswap/web build` with
`VITE_CONVEX_URL` injected. The filter flag works from any directory in the workspace
and output still lands in `apps/web/.output`, so the Output Directory setting stays
valid. (`VITE_CONVEX_URL` is read in `apps/web/src/router.tsx` and
`apps/web/src/lib/require-admin.ts`; Vite inlines it at build time for both client and
SSR bundles.)

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

## Behavior

- **Branch-named, reused**: `convex deploy --preview-name <branch>` creates the preview
  if needed and _reuses_ the existing deployment **and its data** on subsequent pushes.
- **Seeded when empty (state-based)**: every run checks the preview's database with
  `convex data users --limit 1 --format jsonl --preview-name <branch>` (the `users`
  table is the sentinel — every dev snapshot contains users; `--preview-name` is
  accepted by `convex data` even though `--help` hides it). Only when that returns zero
  rows does CI export a snapshot of the shared dev deployment
  (`convex export --include-file-storage`, dev deploy key) and import it into the
  preview (`convex import --preview-name <branch> --replace -y`, preview deploy key).
  A preview that already has data is left untouched, so data created on the preview
  survives pushes — and a preview first created empty by the Vercel build, or recreated
  empty after expiry, gets seeded by the next run automatically.
- **Seeding cannot hit dev/prod**: the import step only has the preview deploy key,
  with which the CLI resolves `--preview-name` project-scoped to preview deployments;
  the dev key (which would make the CLI ignore `--preview-name`) is only exposed to the
  read-only export step.
- **Expiry is the cleanup**: previews are deleted automatically after **5 days** on
  Free/Starter (**14 days** on Pro+). The Convex CLI has **no delete command** for
  preview deployments (verified against the CLI reference and `convex deployment
--help`), so there is no PR-close cleanup job.
- **Revive after expiry is automatic**: the next workflow run (any PR push, or a manual
  run with the branch name) recreates the expired preview, finds it empty, and seeds it
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
