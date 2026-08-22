#!/usr/bin/env bash
#
# LIFT-1167: smoke-test the LIVE production deploy before CI announces success.
#
# Vercel deploys via its own git integration, entirely OUTSIDE GitHub Actions.
# A green CI graph therefore does NOT prove the site is actually live: a
# failed/rolled-back Vercel build, a broken bundle, or an SSO/edge misconfig
# would still let `notify-deploy` post "✅ Deployed to production". This script
# curls the real prod domain and asserts HTTP 200 + the app's <title> marker,
# retrying to absorb the race between the git push and Vercel finishing its
# build. It exits non-zero on failure so `notify-failure` alerts instead.
#
# The prod domain is READ from CLAUDE.md (the single source of truth) and the
# marker is READ from index.html — neither is hardcoded here, per the SEV1
# rule against fabricating/duplicating external identifiers. Override either
# via DEPLOY_DOMAIN / DEPLOY_MARKER for local testing.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Prod domain: the `**Live:** <domain> (...)` line in CLAUDE.md.
DOMAIN="${DEPLOY_DOMAIN:-$(grep -m1 '^\*\*Live:\*\*' "$ROOT/CLAUDE.md" | sed -E 's/^\*\*Live:\*\* *([^ ]+).*/\1/')}"

# Expected HTML marker: the app's <title>, read from index.html so it tracks
# the current commit. A broken bundle, a rollback to a different app, or an
# SSO/login interstitial would not serve this exact string.
MARKER="${DEPLOY_MARKER:-$(grep -oE '<title>[^<]*</title>' "$ROOT/index.html" | head -1 | sed -E 's:</?title>::g')}"

MAX_ATTEMPTS="${MAX_ATTEMPTS:-12}"
RETRY_DELAY="${RETRY_DELAY:-15}"

if [ -z "$DOMAIN" ]; then
  echo "::error::Could not read the deployment domain from CLAUDE.md (**Live:** line)." >&2
  exit 1
fi
if [ -z "$MARKER" ]; then
  echo "::error::Could not read the <title> marker from index.html." >&2
  exit 1
fi

URL="https://${DOMAIN}/"
echo "Smoke-testing production deploy at ${URL} (expecting HTTP 200 + marker \"${MARKER}\")"

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  status=$(curl -sS -o response.html -w '%{http_code}' --max-time 20 "$URL" || echo "000")
  if [ "$status" = "200" ] && grep -qF -- "$MARKER" response.html; then
    echo "✅ Production is live: HTTP 200 with the expected marker (attempt ${attempt}/${MAX_ATTEMPTS})."
    rm -f response.html
    exit 0
  fi
  if grep -qF -- "$MARKER" response.html 2>/dev/null; then marker_state="present"; else marker_state="missing"; fi
  echo "Attempt ${attempt}/${MAX_ATTEMPTS}: HTTP ${status}, marker ${marker_state}. Retrying in ${RETRY_DELAY}s…"
  attempt=$((attempt + 1))
  [ "$attempt" -le "$MAX_ATTEMPTS" ] && sleep "$RETRY_DELAY"
done

rm -f response.html
echo "::error::Production deploy smoke test FAILED after ${MAX_ATTEMPTS} attempts — ${URL} never served HTTP 200 with the expected marker. Vercel may have failed to build, rolled back, or the deploy is not yet live." >&2
exit 1
