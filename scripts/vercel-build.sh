#!/usr/bin/env bash
# Vercel Build Command for the JigSwap web app (Root Directory: apps/web).
# Dashboard Build Command: bash ../../scripts/vercel-build.sh
#
# Preview builds deploy the branch's Convex preview (preview-scoped CONVEX_DEPLOY_KEY;
# branch auto-detected from VERCEL_GIT_COMMIT_REF) and inject its URL into the web build
# via VITE_CONVEX_URL — see docs/deployment/convex-preview-deployments.md.
#
# EMAIL_BASE_URL: email CTA/preferences links need the web app's own origin, which is
# only known here, after Vercel assigns it. VERCEL_BRANCH_URL is the stable per-branch
# alias (survives repeated pushes), so the preview backend always links back to the
# branch's latest web preview. Production is NOT handled here: prod Convex deploys are
# CI-gated (convex-deploy.yml) and prod's EMAIL_BASE_URL is a stable one-time
# `npx convex env set` (with a code default of https://jigswap.site).
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "preview" ]; then
  cd ../../packages/backend
  npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'pnpm --filter @jigswap/web build'
  # Deliberately best-effort: a flag regression must not fail an otherwise-good preview build.
  npx convex env set --preview-name "$VERCEL_GIT_COMMIT_REF" EMAIL_BASE_URL "https://$VERCEL_BRANCH_URL" \
    || echo "warning: EMAIL_BASE_URL not set on the preview deployment (email links fall back to https://jigswap.site)"
else
  pnpm build
fi
