#!/usr/bin/env bash
# Run a `convex deploy` command, retrying ONLY when it lost a race with a concurrent push
# to the same deployment. Usage: convex-deploy-retry.sh <command> [args...]
#
# Every PR push makes two pushes to the branch's Convex preview at once: the Vercel build
# (scripts/vercel-build.sh) and the Convex Preview workflow. The loser fails with
#   503 ... OptimisticConcurrencyControlFailure        (POST /api/deploy2/start_push)
#   409 Conflict: RaceDetected ... created by a concurrent push   (wait_for_schema)
#   Component ... was created by a concurrent push / Schema was overwritten by another push
# and the CLI does not retry these itself (it only retries idempotent HTTP methods).
# Retrying is safe: the retry pushes the same checked-out code, and the CLI uploads only
# modules whose hashes the server doesn't already have, so an identical re-push is cheap.
# Any other failure (typecheck, schema validation, bad key, ...) exits immediately with
# the command's own status. Output is streamed unchanged so logs stay readable.
set -uo pipefail

race_pattern='OptimisticConcurrencyControlFailure|RaceDetected|concurrent push|Schema was overwritten by another push'
delays=(15 30 60)
max_attempts=$((${#delays[@]} + 1))

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

for ((attempt = 1; ; attempt++)); do
  echo "convex-deploy-retry: attempt $attempt/$max_attempts: $*"
  "$@" 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  if ! grep -qE "$race_pattern" "$log"; then
    exit "$status"
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "convex-deploy-retry: still racing a concurrent push after $max_attempts attempts; giving up"
    exit "$status"
  fi
  delay=${delays[attempt - 1]}
  echo "convex-deploy-retry: lost a race with a concurrent push; retrying in ${delay}s"
  sleep "$delay"
done
