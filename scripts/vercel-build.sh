#!/usr/bin/env bash
# Vercel Build Command for the JigSwap web app (Root Directory: apps/web).
# Dashboard Build Command: bash ../../scripts/vercel-build.sh
#
# Preview builds deploy the branch's Convex preview (preview-scoped CONVEX_DEPLOY_KEY) and
# inject its URL into the web build via VITE_CONVEX_URL — see
# docs/deployment/convex-preview-deployments.md.
#
# Previews are created by the Vercel Preview workflow (`vercel deploy` from CI, since
# apps/web/vercel.json turns off Git-integration deploys for every branch but main). It
# passes the PR branch as the build env JIGSWAP_PREVIEW_BRANCH, because per the Vercel docs
# a CLI deployment can lack the Git branch association (VERCEL_GIT_COMMIT_REF) that
# Git-triggered builds always have. Git-triggered builds use that variable as the fallback.
#
# EMAIL_BASE_URL: email CTA/preferences links need the web app's own origin, which is
# only known here, after Vercel assigns it. VERCEL_BRANCH_URL is the stable per-branch
# alias (survives repeated pushes), so the preview backend always links back to the
# branch's latest web preview. If a CLI deployment gets no branch alias, VERCEL_URL (this
# deployment's own URL) is used instead; every preview build re-sets it.
# Production is NOT handled here: prod Convex deploys are CI-gated (convex-deploy.yml) and
# prod's EMAIL_BASE_URL is a stable one-time `npx convex env set` (with a code default of
# https://jigswap.site).
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"

if [ "${VERCEL_ENV:-}" = "preview" ]; then
  branch="${JIGSWAP_PREVIEW_BRANCH:-${VERCEL_GIT_COMMIT_REF:-}}"
  if [ -z "$branch" ]; then
    echo "error: no preview branch (JIGSWAP_PREVIEW_BRANCH and VERCEL_GIT_COMMIT_REF are both empty)" >&2
    exit 1
  fi
  web_host="${VERCEL_BRANCH_URL:-${VERCEL_URL:-}}"
  cd ../../packages/backend
  # The Convex Preview workflow pushes to this same preview at the same time; the retry
  # wrapper re-runs the deploy only when it lost that race (see convex-deploy-retry.sh).
  # `--cmd` runs before the push, so a retry rebuilds the web app too (same URL, same code).
  bash "$scripts_dir/convex-deploy-retry.sh" npx convex deploy --typecheck enable \
    --preview-name "$branch" --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'pnpm --filter @jigswap/web build'
  # Deliberately best-effort: a flag regression must not fail an otherwise-good preview build.
  if [ -n "$web_host" ]; then
    npx convex env set --preview-name "$branch" EMAIL_BASE_URL "https://$web_host" \
      || echo "warning: EMAIL_BASE_URL not set on the preview deployment (email links fall back to https://jigswap.site)"
  else
    echo "warning: neither VERCEL_BRANCH_URL nor VERCEL_URL is set; EMAIL_BASE_URL not updated"
  fi
else
  pnpm build
fi
