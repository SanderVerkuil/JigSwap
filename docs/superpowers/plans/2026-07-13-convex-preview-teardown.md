# Convex Preview Teardown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete a PR's Convex preview deployment when the PR is merged or closed, via the Convex Management API.

**Architecture:** One new GitHub Actions workflow triggered on `pull_request: closed`. It resolves the numeric project id from team/project slugs, lists the project's deployments, finds the preview whose `reference` matches the closed PR's branch, and POSTs its delete endpoint. Pure `curl` + `jq`, no checkout — the pinned Convex CLI (1.42.1) has no delete command (convex-backend#455).

**Tech Stack:** GitHub Actions, Convex Management API (`https://api.convex.dev/v1`), bash/curl/jq.

**Spec:** `docs/superpowers/specs/2026-07-13-convex-preview-teardown-design.md`

**Repo conventions:** prettier does not manage `.github/workflows/*.yml`? — it does (prettier checks the whole repo), so run `pnpm prettier --write` on every changed file before committing. Commits end with a blank line then `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**Secrets/vars (already configured by the owner):** secret `CONVEX_MANAGEMENT_TOKEN`, repo variables `CONVEX_TEAM_SLUG`, `CONVEX_PROJECT_SLUG`.

---

### Task 1: Validate the jq selection logic against a fixture

The workflow's only real logic is a jq expression choosing the deployment to delete. Pin it down against a fixture BEFORE embedding it in YAML.

**Files:**

- Create: `/tmp` fixture only (scratch — not committed)

- [ ] **Step 1: Write the fixture and expression check**

```bash
cat > "$RUNNER_TEMP_OR_TMP/deployments.json" <<'EOF'
[
  {"name":"playful-otter-123","deploymentType":"preview","reference":"feat/publisher-brand-series","kind":"cloud"},
  {"name":"giant-badger-456","deploymentType":"preview","reference":"fix/other-branch","kind":"cloud"},
  {"name":"happy-antelope-789","deploymentType":"prod","reference":"prod","kind":"cloud"},
  {"name":"local-dev","deploymentType":"dev","kind":"local"}
]
EOF
BRANCH="feat/publisher-brand-series"
jq -r --arg ref "$BRANCH" '[.[] | select(.deploymentType == "preview" and .reference == $ref)][0].name // empty' "$RUNNER_TEMP_OR_TMP/deployments.json"
```

Expected output: `playful-otter-123`.
Also verify the no-match case (`BRANCH="never-existed"`) prints nothing (empty), and that the local-deployment variant (which lacks `reference`) does not crash the expression.

- [ ] **Step 2: No commit** — this is a scratch validation; the expression lands in Task 2's YAML.

---

### Task 2: The teardown workflow

**Files:**

- Create: `.github/workflows/convex-preview-teardown.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Convex Preview Teardown

permissions:
  contents: read

# Deletes a PR's Convex preview deployment when the PR is merged or closed
# (docs/deployment/convex-preview-deployments.md → "Teardown on PR close").
#
# Uses the Convex Management API (https://docs.convex.dev/management-api) over curl:
# the pinned Convex CLI has no `deployment delete`/`deployment list` commands
# (https://github.com/get-convex/convex-backend/issues/455). Once that feature
# request ships, simplify this job to the CLI. curl also keeps the job
# dependency-free — no checkout, no pnpm, no Node setup.
#
# Auth: the Management API requires a team token (or PAT) — the deploy keys used by
# convex-preview.yml cannot call it. Until the owner configures the secret and both
# slug variables (see the docs above), every run is a documented green no-op.
# Auto-expiry (5 days Free/Starter, 14 Pro+) remains the fallback cleanup for any
# preview this job misses (e.g. a re-created one after a stray late synchronize run).
on:
  pull_request:
    types: [closed]

jobs:
  teardown:
    name: Delete preview deployment
    runs-on: ubuntu-latest
    timeout-minutes: 5
    env:
      CONVEX_API: https://api.convex.dev/v1
      BRANCH_NAME: ${{ github.head_ref }}
      TEAM_SLUG: ${{ vars.CONVEX_TEAM_SLUG }}
      PROJECT_SLUG: ${{ vars.CONVEX_PROJECT_SLUG }}
      # Whether the one-time owner setup (management token + slug variables) has
      # happened yet. Until it has, the job succeeds as a documented no-op.
      HAS_CONFIG: ${{ secrets.CONVEX_MANAGEMENT_TOKEN != '' && vars.CONVEX_TEAM_SLUG != '' && vars.CONVEX_PROJECT_SLUG != '' }}
    steps:
      - name: Skip when the management token or slugs are not configured
        if: env.HAS_CONFIG != 'true'
        run: echo "::notice::CONVEX_MANAGEMENT_TOKEN / CONVEX_TEAM_SLUG / CONVEX_PROJECT_SLUG not configured — skipping preview teardown (see docs/deployment/convex-preview-deployments.md)"

      - name: Delete the branch's preview deployment
        if: env.HAS_CONFIG == 'true'
        env:
          CONVEX_MANAGEMENT_TOKEN: ${{ secrets.CONVEX_MANAGEMENT_TOKEN }}
        run: |
          auth=(-H "Authorization: Bearer $CONVEX_MANAGEMENT_TOKEN")

          # Slugs -> numeric project id (the other project endpoints take the id).
          project_id="$(curl -sSf "${auth[@]}" \
            "$CONVEX_API/teams/$TEAM_SLUG/projects/$PROJECT_SLUG" | jq -r '.id')"

          deployments="$(curl -sSf "${auth[@]}" \
            "$CONVEX_API/projects/$project_id/list_deployments")"

          # The preview created by `convex deploy --preview-name "$BRANCH_NAME"`
          # carries the branch as its unique in-project reference. Local dev
          # deployments in the response lack `reference`; select() skips them.
          name="$(jq -r --arg ref "$BRANCH_NAME" \
            '[.[] | select(.deploymentType == "preview" and .reference == $ref)][0].name // empty' \
            <<<"$deployments")"

          if [ -z "$name" ]; then
            echo "::notice::No preview deployment found for branch '$BRANCH_NAME' (already expired, or never created) — nothing to tear down"
            echo "Existing previews were:"
            jq -r '[.[] | select(.deploymentType == "preview")] | map("  \(.name) (reference: \(.reference))")[]' <<<"$deployments" || true
            exit 0
          fi

          curl -sSf -X POST "${auth[@]}" "$CONVEX_API/deployments/$name/delete"
          echo "::notice::Deleted preview deployment '$name' for branch '$BRANCH_NAME'"
```

- [ ] **Step 2: Validate the YAML parses**

Run: `node -e "const y=require('yaml');y.parse(require('fs').readFileSync('.github/workflows/convex-preview-teardown.yml','utf8'));console.log('yaml ok')"`
(If the `yaml` package isn't resolvable from the repo root, use `pnpm dlx yaml` equivalents or `python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/convex-preview-teardown.yml'));print('yaml ok')"`.)
Expected: `yaml ok`.

- [ ] **Step 3: Sanity-check the guard expression against the existing pattern**

Compare with `convex-preview.yml`'s `HAS_PREVIEW_KEY` (`${{ secrets.CONVEX_DEPLOY_KEY_PREVIEW != '' }}` + step-level `if: env.HAS_PREVIEW_KEY == 'true'`). The new `HAS_CONFIG` must follow the same env-then-if shape.

- [ ] **Step 4: Commit**

```bash
pnpm prettier --write .github/workflows/convex-preview-teardown.yml
git add .github/workflows/convex-preview-teardown.yml
git commit -m "ci: tear down Convex preview deployment when its PR closes"
```

---

### Task 3: Update the stale comment + deployment doc

**Files:**

- Modify: `.github/workflows/convex-preview.yml:16-19` (header comment)
- Modify: `docs/deployment/convex-preview-deployments.md` (new section)

- [ ] **Step 1: Amend the convex-preview.yml header comment.** Replace the bullet

```
#   - Previews auto-expire after 5 days on Free/Starter (14 on Pro+). There is no CLI
#     command to delete one, so expiry IS the cleanup. To revive one on demand, run
#     this workflow manually via workflow_dispatch with the branch name; check `force`
#     to re-clone the dev snapshot over a preview that still has data.
```

with

```
#   - convex-preview-teardown.yml deletes a PR's preview when the PR closes (via the
#     Management API — the CLI still has no delete command). Auto-expiry (5 days on
#     Free/Starter, 14 on Pro+) remains the fallback cleanup. To revive a preview on
#     demand, run this workflow manually via workflow_dispatch with the branch name;
#     check `force` to re-clone the dev snapshot over a preview that still has data.
```

- [ ] **Step 2: Add a "Teardown on PR close" section to `docs/deployment/convex-preview-deployments.md`**, after the one-time owner setup section:

```markdown
## Teardown on PR close

`.github/workflows/convex-preview-teardown.yml` deletes the branch's preview
deployment when its PR is merged or closed, so review environments don't linger
until expiry. It calls the
[Convex Management API](https://docs.convex.dev/management-api) directly (the CLI
has no `deployment delete` — see
[convex-backend#455](https://github.com/get-convex/convex-backend/issues/455)):
slug → project id → list deployments → delete the preview whose `reference` is the
PR branch. Auto-expiry remains the fallback for anything the teardown misses.

### One-time owner setup

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
```

- [ ] **Step 3: Format and commit**

```bash
pnpm prettier --write .github/workflows/convex-preview.yml docs/deployment/convex-preview-deployments.md
git add .github/workflows/convex-preview.yml docs/deployment/convex-preview-deployments.md
git commit -m "docs(ci): document preview teardown; point stale no-delete comment at it"
```

---

### Task 4: Whole-repo verify + PR

- [ ] **Step 1: Repo-wide format check** (this is what failed CI last time)

Run: `pnpm prettier --check . 2>&1 | grep -v .clerk`
Expected: no warnings outside gitignored `.clerk` temp files.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/convex-preview-teardown
gh pr create --title "ci: tear down Convex preview deployments when PRs close" --body "..."
```

PR body must mention: needs `CONVEX_MANAGEMENT_TOKEN` secret + `CONVEX_TEAM_SLUG`/`CONVEX_PROJECT_SLUG` variables (already configured); live verification = close any scrap PR after merge and watch the teardown run.

## Out of scope (do NOT do)

- Backlog sweep / cron (previews auto-expire).
- Convex CLI usage in the teardown (no delete command exists; note points at #455).
- Vercel preview cleanup.
