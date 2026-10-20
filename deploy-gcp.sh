#!/usr/bin/env bash
# One-shot setup + deploy for Lab N3.3 (Smart Speech Coach) on Google Cloud Run.
#
#   cd "<this repository>"
#   bash deploy-gcp.sh
#
# What it does (it stops and asks whenever it needs you):
#   1. Checks gcloud / node / npm are installed
#   2. Signs you in to Google (opens your browser)
#   3. Picks or creates a Google Cloud project and checks billing
#   4. Enables Cloud Run, Cloud Build, Artifact Registry
#   5. Creates a Gemini API key in the project (or uses yours) and writes the git-ignored .env files
#   6. Deploys the backend to Cloud Run (service "smart-speech-coach-backend") and tests Gemini
#   7. Points the local frontend at that Cloud Run URL (frontend/.env)
#   8. Deploys the frontend to Cloud Run (service "smart-speech-coach-frontend")
#   9. Opens the public app in your browser
#
# Safe to re-run: it reuses your project, key, and existing services (a re-run redeploys).
# Works with the macOS default bash 3.2.

set -euo pipefail

REGION="us-west1"
BACKEND_SERVICE="smart-speech-coach-backend"
FRONTEND_SERVICE="smart-speech-coach-frontend"
MODEL="gemini-3.5-flash-lite"

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ask()  { local reply; read -r -p "  $1 " reply; printf '%s' "$reply"; }
yes_no() { local r; r="$(ask "$1 [y/N]")"; [ "$r" = "y" ] || [ "$r" = "Y" ]; }

# ---------------------------------------------------------------------------
bold "1/9  Checking tools"
command -v gcloud >/dev/null 2>&1 || die "gcloud not found. Install the Google Cloud CLI, then quit and reopen Terminal."
command -v node   >/dev/null 2>&1 || die "node not found. Install Node.js 20+ from https://nodejs.org"
command -v npm    >/dev/null 2>&1 || die "npm not found. Install Node.js 20+ from https://nodejs.org"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node $NODE_MAJOR is too old; install Node 20 or newer."
[ -f "$BACKEND/app.js" ] && [ -d "$FRONTEND" ] || die "backend/ and frontend/ not found next to this script."
ok "gcloud $(gcloud version 2>/dev/null | head -1 | awk '{print $NF}'), node $(node -v)"

# ---------------------------------------------------------------------------
bold "2/9  Google sign-in"
ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1 || true)"
if [ -z "$ACCOUNT" ]; then
  echo "  Your browser will open. Sign in with the Google account for this class and click Allow."
  gcloud auth login --quiet
  ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1 || true)"
fi
[ -n "$ACCOUNT" ] || die "Not signed in."
ok "Signed in as $ACCOUNT"

# ---------------------------------------------------------------------------
bold "3/9  Google Cloud project"
PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [ -n "$PROJECT" ] && [ "$PROJECT" != "(unset)" ] && yes_no "Use the current project '$PROJECT'?"; then
  :
else
  echo "  Your projects:"
  gcloud projects list --format='table(projectId,name)' 2>/dev/null | sed 's/^/    /' || true
  PROJECT="$(ask "Type a Project ID from the list, or press Enter to create a new project:")"
  if [ -z "$PROJECT" ]; then
    PROJECT="cs651-n3-$(date +%m%d)-$(printf '%04x' "$RANDOM")"
    echo "  Creating project $PROJECT ..."
    gcloud projects create "$PROJECT" --name="CS651 N3 Labs" --quiet
  fi
fi
gcloud config set project "$PROJECT" --quiet >/dev/null 2>&1
ok "Project: $PROJECT"

# Billing: Cloud Run and Cloud Build require a linked billing account (the free tier covers this lab).
# The Cloud Billing API is free and can be enabled before billing is linked.
gcloud services enable cloudbilling.googleapis.com --quiet >/dev/null 2>&1 || true
billing_enabled() {
  [ "$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' --quiet 2>/dev/null || true)" = "True" ]
}
if billing_enabled; then
  ok "Billing is enabled"
else
  warn "Billing is not linked to $PROJECT yet."
  ACCOUNTS="$(gcloud billing accounts list --filter=open=true --format='value(name,displayName)' --quiet 2>/dev/null || true)"
  if [ -n "$ACCOUNTS" ]; then
    echo "  Your open billing accounts:"
    echo "$ACCOUNTS" | sed 's/^/    /'
    BA="$(ask "Paste the billing account ID to link (the first column, like 01ABCD-234EFG-56789H), or press Enter to do it in the browser:")"
    if [ -n "$BA" ]; then
      gcloud billing projects link "$PROJECT" --billing-account="$BA" --quiet >/dev/null || warn "Linking failed; use the browser link below."
    fi
  fi
  if ! billing_enabled; then
    echo "  Open this page, link a billing account (or your education credit), then come back:"
    echo "    https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
    while ! billing_enabled; do
      ask "Press Enter after billing is linked (Ctrl+C to quit)..." >/dev/null
    done
  fi
  ok "Billing is enabled"
fi

# ---------------------------------------------------------------------------
bold "4/9  Enabling Cloud Run, Cloud Build, Artifact Registry (first time takes ~1 minute)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --quiet
# Source deploys build with the Compute Engine default service account; newer projects need this role.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/run.builder" --condition=None --quiet >/dev/null 2>&1 \
  && ok "Build permissions set" || warn "Could not grant roles/run.builder (fine if the deploy below works)"
ok "Services enabled"

# ---------------------------------------------------------------------------
bold "5/9  Gemini API key"
# Google AI Studio now often issues keys starting with "AQ." that the Gemini API rejects with
# 401 ACCESS_TOKEN_TYPE_UNSUPPORTED. A classic "AIza..." key created in this Cloud project
# works, so that is the default here. The key is never printed.
create_project_key() {
  gcloud services enable generativelanguage.googleapis.com apikeys.googleapis.com --quiet >/dev/null
  local name
  name="$(gcloud services api-keys list --filter='displayName=smart-speech-coach-gemini' \
    --format='value(name)' --limit=1 2>/dev/null || true)"
  if [ -z "$name" ]; then
    name="$(gcloud services api-keys create --display-name="smart-speech-coach-gemini" \
      --api-target=service=generativelanguage.googleapis.com \
      --format='value(response.name)' --quiet 2>/dev/null || true)"
  fi
  if [ -z "$name" ]; then
    name="$(gcloud services api-keys list --filter='displayName=smart-speech-coach-gemini' \
      --format='value(name)' --limit=1 2>/dev/null || true)"
  fi
  [ -n "$name" ] || die "Could not create an API key. Create one in Cloud Console > APIs & Services > Credentials."
  gcloud services api-keys get-key-string "$name" --format='value(keyString)'
}

KEY=""
if [ -f "$BACKEND/.env" ]; then
  KEY="$(sed -n 's/^GEMINI_API_KEY=//p' "$BACKEND/.env" | head -1)"
  case "$KEY" in your_gemini_api_key_here|AQ.*) KEY="" ;; esac
fi
if [ -n "$KEY" ] && yes_no "A Gemini key is already saved in backend/.env (starts with ${KEY:0:4}...). Use it?"; then
  :
elif yes_no "Paste your own Gemini key instead of creating one in this project? (most people: N)"; then
  echo "  Copy your key (copy icon at https://aistudio.google.com/apikey), then press Enter here"
  echo "  to read it from the clipboard, or paste it and press Enter. It is not shown on screen."
  read -r -s -p "  Gemini API key: " KEY; echo
  if [ -z "$KEY" ] && command -v pbpaste >/dev/null 2>&1; then
    KEY="$(pbpaste)"
  fi
  # Clean the paste: whitespace, terminal paste markers (ESC[200~ / ESC[201~), quotes.
  KEY="$(printf '%s' "$KEY" | LC_ALL=C sed -e 's/\x1b\[20[01]~//g' | LC_ALL=C tr -d '[:space:][:cntrl:]"'"'"'`')"
  KEY="${KEY#\[200~}"; KEY="${KEY%\[201~}"
  [ -n "$KEY" ] || die "No key was received. Re-run and paste the key (Cmd+V) at the prompt."
  BAD="$(printf '%s' "$KEY" | LC_ALL=C tr -d 'A-Za-z0-9._-')"
  [ -z "$BAD" ] || die "The key contains unexpected characters. Copy it again with the copy icon and re-run."
  case "$KEY" in AQ.*) warn "Keys starting with AQ. are often rejected by the Gemini API; if questions fail, re-run and answer N here." ;; esac
else
  echo "  Creating a Gemini API key in project $PROJECT (restricted to the Gemini API)..."
  KEY="$(create_project_key)"
fi
case "$KEY" in ""|*[!A-Za-z0-9._-]*) die "Could not get a usable Gemini key." ;; esac
ok "Key ready (${#KEY} characters, starts with ${KEY:0:4}...)"

PROMPT='You answer questions about Smart Speech Coach, a service that helps people practice speeches, improve delivery, organize ideas, reduce speaking anxiety, and get simple coaching feedback using machine learning. If the user asks about something unrelated, briefly steer them back to Smart Speech Coach. Keep the answer to 1-4 sentences.'
# CORS: the browser may call the backend from local dev or from the Cloud Run frontend.
# Cloud Run gives each service two equivalent URLs; allow both (the second exists once deployed).
FRONTEND_URL_STABLE="https://${FRONTEND_SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
FRONTEND_URL_EXISTING="$(gcloud run services describe "$FRONTEND_SERVICE" --region "$REGION" --format='value(status.url)' 2>/dev/null || true)"
ORIGINS="http://localhost:5173,http://127.0.0.1:5173,$FRONTEND_URL_STABLE"
[ -n "$FRONTEND_URL_EXISTING" ] && [ "$FRONTEND_URL_EXISTING" != "$FRONTEND_URL_STABLE" ] && ORIGINS="$ORIGINS,$FRONTEND_URL_EXISTING"

umask 077   # the .env files are readable only by you
cat > "$BACKEND/.env" <<EOF
GEMINI_API_KEY=$KEY
GEMINI_MODEL=$MODEL
PORT=3001
allowedOrigins=$ORIGINS
askAnythingPrompt="$PROMPT"
EOF
cat > "$BACKEND/.env.cloudrun" <<EOF
GEMINI_API_KEY: "$KEY"
GEMINI_MODEL: "$MODEL"
allowedOrigins: "$ORIGINS"
askAnythingPrompt: "$PROMPT"
EOF
umask 022
ok "Wrote backend/.env and backend/.env.cloudrun (both git-ignored, never uploaded to GitHub)"

# ---------------------------------------------------------------------------
bold "6/9  Deploying the backend to Cloud Run (2-5 minutes)"
(cd "$BACKEND" && npm ci --no-audit --no-fund --loglevel=error)
gcloud run deploy "$BACKEND_SERVICE" \
  --source "$BACKEND" \
  --region "$REGION" \
  --allow-unauthenticated \
  --env-vars-file "$BACKEND/.env.cloudrun" \
  --quiet
BACKEND_URL="$(gcloud run services describe "$BACKEND_SERVICE" --region "$REGION" --format='value(status.url)')"
ok "Backend URL: $BACKEND_URL"
HEALTH="$(curl -s --max-time 30 "$BACKEND_URL/api/health" || true)"
echo "  /api/health -> $HEALTH"
case "$HEALTH" in
  *'"geminiConfigured":true'*) ok "Backend is up and has the Gemini key" ;;
  *) warn "Health check didn't confirm the key; check Cloud Run logs if questions fail." ;;
esac
ANSWER="$(curl -s --max-time 60 -X POST "$BACKEND_URL/api/askanything" \
  -H 'Content-Type: application/json' -d '{"message":"In one sentence, what is Smart Speech Coach?"}' || true)"
echo "  Test question -> $ANSWER"
case "$ANSWER" in
  *'"answer"'*) ok "Gemini answered through Cloud Run" ;;
  *) warn "Gemini did not answer. Check the key, or run: gcloud run services logs read $BACKEND_SERVICE --region $REGION --limit 20" ;;
esac

# ---------------------------------------------------------------------------
bold "7/9  Pointing the local frontend at Cloud Run"
cat > "$FRONTEND/.env" <<EOF
VITE_SERVER_REMOTE=Y
VITE_SERVER_URL_REMOTE=$BACKEND_URL
VITE_SERVER_URL_LOCAL=http://localhost:3001
EOF
(cd "$FRONTEND" && npm ci --no-audit --no-fund --loglevel=error)
ok "Wrote frontend/.env (VITE_SERVER_URL_REMOTE=$BACKEND_URL)"

# ---------------------------------------------------------------------------
bold "8/9  Deploying the frontend to Cloud Run (2-5 minutes)"
# Cloud Run builds the React app (npm run gcp-build) with the backend URL baked in, then serves
# frontend/dist with frontend/server.mjs. frontend/.env is not uploaded (.gcloudignore).
gcloud run deploy "$FRONTEND_SERVICE" \
  --source "$FRONTEND" \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-build-env-vars "VITE_SERVER_REMOTE=Y,VITE_SERVER_URL_REMOTE=$BACKEND_URL" \
  --quiet
FRONTEND_URL="$(gcloud run services describe "$FRONTEND_SERVICE" --region "$REGION" --format='value(status.url)')"
ok "Frontend URL: $FRONTEND_URL"

# First deploy: the short URL only exists now, so add it to the backend's CORS list.
case ",$ORIGINS," in
  *",$FRONTEND_URL,"*) ok "Backend already allows $FRONTEND_URL" ;;
  *)
    ORIGINS="$ORIGINS,$FRONTEND_URL"
    sed -i.bak "s|^allowedOrigins=.*|allowedOrigins=$ORIGINS|" "$BACKEND/.env"
    sed -i.bak "s|^allowedOrigins: .*|allowedOrigins: \"$ORIGINS\"|" "$BACKEND/.env.cloudrun"
    rm -f "$BACKEND/.env.bak" "$BACKEND/.env.cloudrun.bak"
    gcloud run services update "$BACKEND_SERVICE" --region "$REGION" \
      --update-env-vars "^@^allowedOrigins=$ORIGINS" --quiet >/dev/null
    ok "Backend now allows requests from $FRONTEND_URL"
    ;;
esac

PAGE="$(curl -s --max-time 30 "$FRONTEND_URL/" || true)"
case "$PAGE" in *'<div id="root">'*) ok "Frontend is serving the app" ;; *) warn "Frontend did not return the app page yet." ;; esac
CORS="$(curl -s -o /dev/null -D - --max-time 30 -X OPTIONS "$BACKEND_URL/api/askanything" \
  -H "Origin: $FRONTEND_URL" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' \
  | tr -d '\r' | sed -n 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin: //p' || true)"
if [ "$CORS" = "$FRONTEND_URL" ]; then ok "Backend accepts calls from the frontend (CORS)"; else warn "CORS check did not confirm $FRONTEND_URL (got: ${CORS:-nothing})"; fi

# ---------------------------------------------------------------------------
bold "Done"
cat <<EOF
  Project          $PROJECT  (region $REGION)
  App (public)     $FRONTEND_URL
  Backend          $BACKEND_URL
  Health check     $BACKEND_URL/api/health

  Add these to the "Our deployment" table in README.md.

  Stop / remove later:
    gcloud run services delete $FRONTEND_SERVICE --region $REGION
    gcloud run services delete $BACKEND_SERVICE --region $REGION
EOF

bold "9/9  Try the app"
if yes_no "Open $FRONTEND_URL in your browser now?"; then
  open "$FRONTEND_URL" >/dev/null 2>&1 || echo "  Open $FRONTEND_URL in your browser."
fi
