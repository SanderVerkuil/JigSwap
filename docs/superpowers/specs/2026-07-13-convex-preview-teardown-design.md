# Convex preview teardown on PR close — design

Date: 2026-07-13
Status: approved pending user review

## Problem

Every PR gets its own Convex preview deployment (`convex-preview.yml`), but nothing
removes it when the PR is merged or closed. Cleanup currently relies on auto-expiry
(5 days on Free/Starter, 14 on Pro+), so stale review environments accumulate in the
Convex dashboard while their PRs are long closed.

## Decisions (made with the user)

1. **Trigger**: close-triggered only — `pull_request: types: [closed]` (fires for both
   merge and plain close). No backlog sweep and no cron; the existing stale previews
   simply expire on their own.
2. **Mechanism**: the Convex **Management API** over `curl` + `jq`, NOT the CLI. The
   pinned CLI (1.42.1) has no `deployment delete`/`deployment list` commands
   (`convex deployment` offers only select/create/token); this is a known gap tracked
   in [convex-backend#455](https://github.com/get-convex/convex-backend/issues/455).
   The workflow header notes that the job should be simplified to the CLI once that
   lands. `curl` also keeps the job dependency-free: no checkout, no pnpm, no Node
   setup — it runs in seconds.

## Workflow

New file `.github/workflows/convex-preview-teardown.yml`, separate from
`convex-preview.yml` (mirroring the existing deploy/preview file split, so neither
workflow needs event-type guards on every job).

- Trigger: `pull_request: types: [closed]`.
- Permissions: `contents: read` (the job only talks to the Convex API).
- Single job, no checkout:
  1. `GET https://api.convex.dev/v1/projects/$CONVEX_PROJECT_ID/list_deployments`
     with `Authorization: Bearer $CONVEX_MANAGEMENT_TOKEN`.
  2. Select the deployment with `deploymentType == "preview"` whose `reference`
     equals the closed PR's branch (`github.head_ref` — the same value
     `--preview-name` used to create it). Log the candidate previews when no match
     is found so a reference-format surprise is diagnosable rather than silent.
  3. `POST https://api.convex.dev/v1/deployments/{name}/delete` for the match,
     where `{name}` is the deployment's readable name (e.g. `playful-otter-123`).

### Failure modes (all deliberate)

- **Token or project id not configured** → the job succeeds as a documented no-op
  with a `::notice::`, mirroring `convex-preview.yml`'s `HAS_PREVIEW_KEY` pattern.
- **No matching preview** (already expired, or the PR never created one) → success
  with a notice, not a failure.
- **API error on list or delete** → the job fails loudly. A red teardown check on a
  closed PR costs nothing and makes broken cleanup visible.
- **Re-creation race**: if a stray late `synchronize` deploy re-creates the preview
  after teardown, it expires naturally; no re-check loop.

## One-time owner setup (dashboard access required)

Documented in `docs/deployment/convex-preview-deployments.md`, same style as the
existing preview-key setup:

1. Convex dashboard → team settings → access tokens → create a **team token** → add
   as GitHub Actions secret **`CONVEX_MANAGEMENT_TOKEN`**. (The existing deploy keys
   cannot call the Management API — it requires a team token or PAT.)
2. Set the GitHub Actions repo **variable** `CONVEX_PROJECT_ID` (numeric project id;
   visible via the dashboard or one `curl` to
   `GET /v1/teams/{team_id}/list_projects`).

Until both exist, the workflow is a green no-op.

## Doc/comment updates

- `convex-preview.yml` header: the sentence "There is no CLI command to delete one,
  so expiry IS the cleanup" gains a pointer to the teardown workflow (expiry remains
  the fallback for previews the teardown misses).
- `docs/deployment/convex-preview-deployments.md`: new "Teardown on PR close"
  section covering the workflow and the one-time setup above.

## Out of scope (deliberate)

- Sweeping the existing backlog of stale previews (they auto-expire).
- A scheduled/cron safety net.
- Deleting Vercel previews (Vercel manages its own).
- Any Convex CLI usage in the teardown job (revisit when convex-backend#455 ships).

## Testing / verification

- `actionlint` (or YAML parse) on the new/changed workflow files.
- The `jq` selection expression validated locally against a fixture JSON matching the
  Management API's `PlatformDeploymentResponse` shape (deploymentType/reference/name).
- Live verification after merge: close a scrap PR and watch the teardown run delete
  its preview (or no-op cleanly if secrets are not yet configured).
