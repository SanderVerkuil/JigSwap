# Convex US → EU migration runbook

Date: 2026-07-13. Status: in progress.

Moves the **prod** and **dev** deployments from US East (legacy `*.convex.cloud`
hosts, no region suffix — e.g. dev `tame-jackal-979`) to **EU West / Ireland**
(`*.eu-west-1.convex.cloud`). Previews already land in `eu-west-1`.

Why a migration at all: a deployment's region is fixed at creation and cannot be
changed ([regions docs](https://docs.convex.dev/production/regions)); the documented
path is a new project/deployment in the target region plus CLI export/import.

Rules of the road:

- The OLD deployments stay untouched and live until Phase 3's cutover, and remain
  the rollback until Phase 5 deletes them. Nothing before Phase 3 affects users.
- Anything written to prod between its export and the DNS-level cutover (Vercel env
  update) is lost — keep the prod window short.
- ✅-marked steps are done; fill in the blanks as you go.

## Roles

- **Dashboard/owner steps** (need Convex/Clerk/Vercel dashboard access): Sander.
- **Repo/CI steps** (GitHub secrets, variables, verification runs): Claude — say the
  word when the marked inputs are ready.

## Phase 0 — Prepare (no user impact)

1. [ ] Dashboard: team settings → set the **default region** to EU West so every
       future deployment inherits it.
2. [x] Dashboard: create the new **project** in EU West. ✅ 2026-07-13
   - New project slug: **`jigswap`**
   - New production deployment: **`spotted-scorpion-690`**
     (`https://spotted-scorpion-690.eu-west-1.convex.cloud`, site
     `https://spotted-scorpion-690.eu-west-1.convex.site`)
   - New dev deployment: **`giddy-octopus-727`**
     (`https://giddy-octopus-727.eu-west-1.convex.cloud`)
3. [x] Dashboard: on the NEW project, set environment variables for **production**
       and **development**, and the **preview defaults** — copy values from the old
       project. The full variable table lives in
       `docs/deployment/convex-preview-deployments.md` § "Default environment variables
       for previews". Minimum for prod: `CLERK_WEBHOOK_SECRET`,
       `NEXT_PUBLIC_CLERK_FRONTEND_API_URL`; copy the Axiom/VAPID/Firecrawl/moderation
       ones you use.
4. [x] Dashboard: generate NEW deploy keys on the new project:
   - Production deploy key → will replace GitHub secret `CONVEX_DEPLOY_KEY_PROD`
     and Vercel's Production `CONVEX_DEPLOY_KEY`.
   - Dev deploy key (for the shared dev deployment) → replaces
     `CONVEX_DEPLOY_KEY_DEV`.
   - Preview deploy key → replaces `CONVEX_DEPLOY_KEY_PREVIEW` (GitHub) and
     Vercel's Preview `CONVEX_DEPLOY_KEY`.

## Phase 1 — Repo/CI config (no user impact)

5. [x] GitHub secrets `CONVEX_DEPLOY_KEY_{PROD,DEV,PREVIEW}` updated with the new
       keys. ✅ 2026-07-13 (verified via secret timestamps). The Vercel **Preview**
       `CONVEX_DEPLOY_KEY` was swapped at the same time, which is safe pre-cutover:
       it only moves _preview_ creation to the new project. Production Vercel builds
       don't use a deploy key at all (prod deploys are CI-gated; see the env-scoping
       table in `convex-preview-deployments.md`).
6. [x] GitHub repo variable `CONVEX_PROJECT_SLUG` → `jigswap`. ✅ 2026-07-13
       `CONVEX_TEAM_SLUG` stays `sander-verkuil`; `CONVEX_MANAGEMENT_TOKEN` is
       team-scoped and keeps working. Transient note: until the preview deploy
       key flips (step 5), previews are still CREATED on the old project while
       the teardown LOOKS in the new one — a harmless no-op notice; old-project
       previews die with the old project in Phase 5.

## Phase 2 — Populate the new deployments (no user impact)

No deploy keys needed: with an interactive `npx convex login` session, export and
import accept `--deployment <name>` (and cross-project references like
`jig-swap-35697:prod`). Code lands on the new deployments via CI first — the deploy
workflow's secrets already point at them — then data follows. Run from
`packages/backend`.

7. [x] Push code to BOTH new deployments ✅ 2026-07-13 — rerun deploy runs landed on
       `giddy-octopus-727.eu-west-1` and `spotted-scorpion-690.eu-west-1`; original dev
       run had failed on a GitHub 'Service Unavailable' flake.
       Original text: push code to BOTH new deployments by re-running the latest **Convex Deploy**
       workflow runs (dev job + CI-gated prod job); confirm the logged URLs are
       `eu-west-1` hosts (`giddy-octopus-727`, `spotted-scorpion-690`).

8. [x] Import the data ✅ 2026-07-13 — dev and prod each imported (96 documents +
       10 stored files); the two-part `project-slug:reference` form fails with 'No
       CONVEX_DEPLOYMENT set', use the THREE-part `team:project:reference` form.
       Import the data (old → new), logged-in CLI, no keys:

```bash
# dev (old shared dev tame-jackal-979 → new dev):
pnpm exec convex export --include-file-storage --deployment tame-jackal-979 --path /tmp/dev-snapshot.zip
pnpm exec convex import --deployment giddy-octopus-727 --replace-all -y /tmp/dev-snapshot.zip

# prod (old project's prod → new prod):
pnpm exec convex export --include-file-storage --deployment jig-swap-35697:prod --path /tmp/prod-snapshot.zip
pnpm exec convex import --deployment spotted-scorpion-690 --replace-all -y /tmp/prod-snapshot.zip
```

(The prod import is the rehearsal — Phase 3 re-runs it for the real cutover so no
writes are lost. If prod gets no traffic right now, treat this as the cutover
import and skip the re-run.)

9. [~] Sanity check: `users` data confirmed present on both new deployments via
   `convex data`; dashboard eyeball (row counts, files, crons) still open.
   Sanity check the new prod in the dashboard: row counts look right, files
   present, crons registered (they register from the deployed code).

## Phase 3 — Cutover (short prod write-freeze)

Do these back-to-back; the freeze lasts from step 10's export until step 12.

10. [ ] Re-run step 7's export/import against prod so the snapshot is current
        (skip if step 7 was treated as the cutover).
11. [ ] Clerk dashboard: update the **webhook endpoint URL** from the old prod
        `.convex.site` host to the new one (`https://<new-prod>.eu-west-1.convex.site/…`,
        same path). Missing this silently stops user signup sync. If dev has its own
        Clerk webhook, update that too.
12. [ ] Vercel: update the **Production**-scoped `VITE_CONVEX_URL` →
        `https://spotted-scorpion-690.eu-west-1.convex.cloud` and **redeploy
        production**. (Vite inlines the URL at build time, so the redeploy IS the
        cutover moment.) Production keeps having NO `CONVEX_DEPLOY_KEY` in Vercel —
        if one was added during key rotation, remove it to preserve the CI-gated
        prod-deploy invariant. The Preview key is already swapped (step 5).
13. [ ] Trigger the repo's **Convex Deploy** workflow (push to main or re-run) and
        confirm it deploys to the NEW dev/prod hosts (eu-west-1 in the logged URL).

## Phase 4 — Verify

14. [ ] Production app: sign in, browse catalog, search (searchableText survived
        import), add a puzzle, upload a photo (file storage), notifications config.
15. [ ] Clerk webhook: create a throwaway user; confirm it appears in the new prod
        `users` table.
16. [x] Previews verified via scrap PRs #62/#63. ✅ 2026-07-13 Findings:
    - First preview key pasted was dev-scoped → the CLI silently ignored
      `--preview-name` and deployed to shared dev (the workflow's key-scoping
      warning in action). Fixed with a real Preview key.
    - Teardown then deleted the preview on PR close ('Deleted preview deployment
      valiant-tapir-102') — the full cycle works.
    - OPEN ITEM: the new `CONVEX_DEPLOY_KEY_DEV` lacks `deployment:backups:create`,
      so the preview SEED step fails (export from dev denied). Regenerate the dev
      key with full permissions; seeding self-heals on the next PR push (empty
      preview → re-seed).
17. [ ] Axiom: log events arriving from the new deployments (if used).

## Phase 5 — Cleanup (point of no return)

18. [ ] After a comfortable soak (suggest ≥ a few days), export a final archival
        backup of the OLD prod, then delete the old project in the dashboard.
19. [ ] Remove any leftover old-key secrets and old preview deployments (the sweep
        in `convex-preview-teardown.yml` handles previews on the new project).

## Rollback

Until Phase 5: revert Vercel's Production `VITE_CONVEX_URL` (+ redeploy) and Preview
`CONVEX_DEPLOY_KEY`, the Clerk webhook URL, the three GitHub secrets, and
`CONVEX_PROJECT_SLUG` — the old deployments were never modified. Data written to the
NEW prod after cutover would need an export/import back.
