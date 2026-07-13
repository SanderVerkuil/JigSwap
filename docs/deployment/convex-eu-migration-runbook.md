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

5. [x] GitHub secrets updated (2026-07-13, verified via timestamps) — Vercel keys were also already swapped (part of step 12) with the three new keys (owner pastes values, or runs
       `gh secret set CONVEX_DEPLOY_KEY_{PROD,DEV,PREVIEW}`).
6. [x] GitHub repo variable `CONVEX_PROJECT_SLUG` → `jigswap`. ✅ 2026-07-13
       `CONVEX_TEAM_SLUG` stays `sander-verkuil`; `CONVEX_MANAGEMENT_TOKEN` is
       team-scoped and keeps working. Transient note: until the preview deploy
       key flips (step 5), previews are still CREATED on the old project while
       the teardown LOOKS in the new one — a harmless no-op notice; old-project
       previews die with the old project in Phase 5.

## Phase 2 — Populate the new deployments (no user impact)

Run from `packages/backend`, with the keys from step 4 (each command's
`CONVEX_DEPLOY_KEY` decides which deployment it targets — same key-scoping idea as
the preview workflow).

7. [ ] Deploy code to the new prod, then import the old prod's data:

```bash
# Export FROM old prod (old prod key):
CONVEX_DEPLOY_KEY=<OLD prod key> pnpm exec convex export --include-file-storage --path /tmp/prod-snapshot.zip

# Push code TO new prod (new prod key), then import:
CONVEX_DEPLOY_KEY=<NEW prod key> pnpm exec convex deploy
CONVEX_DEPLOY_KEY=<NEW prod key> pnpm exec convex import --replace-all -y /tmp/prod-snapshot.zip
```

(This is the rehearsal import — Phase 3 re-runs the export/import for the real
cutover so no writes are lost. If prod truly gets no traffic right now, you can
skip the re-run and treat this as the cutover import.)

8. [ ] Same for dev (old dev key → export; new dev key → deploy + import). Dev has
       no cutover-consistency concern; once is enough:

```bash
CONVEX_DEPLOY_KEY=<OLD dev key> pnpm exec convex export --include-file-storage --path /tmp/dev-snapshot.zip
CONVEX_DEPLOY_KEY=<NEW dev key> npx convex dev --once
CONVEX_DEPLOY_KEY=<NEW dev key> pnpm exec convex import --replace-all -y /tmp/dev-snapshot.zip
```

9. [ ] Sanity check the new prod in the dashboard: row counts look right, files
       present, crons registered (they register from the deployed code).

## Phase 3 — Cutover (short prod write-freeze)

Do these back-to-back; the freeze lasts from step 10's export until step 12.

10. [ ] Re-run step 7's export/import against prod so the snapshot is current
        (skip if step 7 was treated as the cutover).
11. [ ] Clerk dashboard: update the **webhook endpoint URL** from the old prod
        `.convex.site` host to the new one (`https://<new-prod>.eu-west-1.convex.site/…`,
        same path). Missing this silently stops user signup sync. If dev has its own
        Clerk webhook, update that too.
12. [ ] Vercel: update **Production** env `NEXT_PUBLIC_CONVEX_URL` → new prod
        `.convex.cloud` URL, and `CONVEX_DEPLOY_KEY` (Production) → new prod key;
        **Preview** env `CONVEX_DEPLOY_KEY` → new preview key. Redeploy production.
13. [ ] Trigger the repo's **Convex Deploy** workflow (push to main or re-run) and
        confirm it deploys to the NEW dev/prod hosts (eu-west-1 in the logged URL).

## Phase 4 — Verify

14. [ ] Production app: sign in, browse catalog, search (searchableText survived
        import), add a puzzle, upload a photo (file storage), notifications config.
15. [ ] Clerk webhook: create a throwaway user; confirm it appears in the new prod
        `users` table.
16. [ ] Previews: open a scrap PR; deploy + seed should target the NEW project
        (log shows eu-west-1); close it and confirm the teardown deletes the preview
        (teardown reads the updated `CONVEX_PROJECT_SLUG`).
17. [ ] Axiom: log events arriving from the new deployments (if used).

## Phase 5 — Cleanup (point of no return)

18. [ ] After a comfortable soak (suggest ≥ a few days), export a final archival
        backup of the OLD prod, then delete the old project in the dashboard.
19. [ ] Remove any leftover old-key secrets and old preview deployments (the sweep
        in `convex-preview-teardown.yml` handles previews on the new project).

## Rollback

Until Phase 5: revert Vercel's `NEXT_PUBLIC_CONVEX_URL` + `CONVEX_DEPLOY_KEY`, the
Clerk webhook URL, the three GitHub secrets, and `CONVEX_PROJECT_SLUG` — the old
deployments were never modified. Data written to the NEW prod after cutover would
need an export/import back.
