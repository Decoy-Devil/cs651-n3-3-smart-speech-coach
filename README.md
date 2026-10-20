# CS651 Lab N3.3 — Smart Speech Coach on Google Cloud Run

An AI-enabled full-stack web app: a **React** frontend calls a **Node/Express** backend with
`fetch()`; the backend calls **Google Gemini** and returns JSON. Both run on **Google Cloud Run**:
the backend as an API service and the frontend as a static site that calls it.

Built on the instructor's starter [grewe/SmartSpeechCoach](https://github.com/grewe/SmartSpeechCoach).
This repository keeps that repository's original commits, so the history shows exactly
what our group changed on top of it.

```
 Browser (React + Vite)                 Google Cloud Run                     Google
┌───────────────────────┐ fetch + JSON ┌──────────────────────────┐  SDK   ┌────────┐
│ Backend status badge  │ ───────────▶ │ GET  /api/health         │        │        │
│ Ask anything          │ ───────────▶ │ POST /api/askanything    │ ─────▶ │ Gemini │
│ Speech feedback       │ ───────────▶ │ POST /api/feedback       │ ─────▶ │  API   │
└───────────────────────┘ ◀─── JSON ── └──────────────────────────┘        └────────┘
  Cloud Run (or localhost:5173)          holds GEMINI_API_KEY (never sent to the browser)
```

## Contents

1. [Our deployment](#1-our-deployment)
   - [Where everything lives](#where-everything-lives)
2. [What we changed from the starter](#2-what-we-changed-from-the-starter)
3. [How we deployed to Google Cloud Run](#3-how-we-deployed-to-google-cloud-run)
4. [Deploy the frontend to Cloud Run](#4-deploy-the-frontend-to-cloud-run)
5. [Run everything locally](#5-run-everything-locally)
6. [Demo checklist](#6-demo-checklist)
7. [Stop or remove the deployment](#7-stop-or-remove-the-deployment)
8. [Troubleshooting](#8-troubleshooting)
9. [Project layout](#9-project-layout)
10. [How we published this repository](#10-how-we-published-this-repository)

## 1. Our deployment

| | |
|---|---|
| Google Cloud project | `cs651-n3-1014-48f1` |
| Region | `us-west1` |
| **App (public)** | https://smart-speech-coach-frontend-896438282436.us-west1.run.app |
| Frontend service | `smart-speech-coach-frontend` |
| Backend service | `smart-speech-coach-backend` |
| Backend URL | https://smart-speech-coach-backend-x6crpaxyaa-uw.a.run.app |
| Health check | https://smart-speech-coach-backend-x6crpaxyaa-uw.a.run.app/api/health |
| Gemini model | `gemini-3.5-flash-lite` |
| Deployed | October 14, 2026 |

Verified: the public app shows **Backend (Cloud Run): Connected**, and questions and speech
feedback are answered by Gemini through the Cloud Run backend.

### Where everything lives

| What | Where | How to find it |
|---|---|---|
| Source code | GitHub: [Decoy-Devil/cs651-n3-3-smart-speech-coach](https://github.com/Decoy-Devil/cs651-n3-3-smart-speech-coach), branch `main` | Instructor's original commits first, then ours |
| Instructor's starter | GitHub: [grewe/SmartSpeechCoach](https://github.com/grewe/SmartSpeechCoach) | Kept as the `upstream` git remote |
| Google Cloud project | `cs651-n3-1014-48f1` (project number `896438282436`) | [Cloud Console dashboard](https://console.cloud.google.com/home/dashboard?project=cs651-n3-1014-48f1) |
| Billing | Billing Account for Education, linked to the project | [Billing → linked account](https://console.cloud.google.com/billing/linkedaccount?project=cs651-n3-1014-48f1) |
| Frontend service | Cloud Run `smart-speech-coach-frontend`, region `us-west1`; serves the built React app | [Cloud Run services](https://console.cloud.google.com/run?project=cs651-n3-1014-48f1) |
| Backend service | Cloud Run `smart-speech-coach-backend`, region `us-west1`; Express API that calls Gemini | [Cloud Run services](https://console.cloud.google.com/run?project=cs651-n3-1014-48f1) |
| Container images | Artifact Registry repository `cloud-run-source-deploy` in `us-west1` (created by the first source deploy) | [Artifact Registry](https://console.cloud.google.com/artifacts?project=cs651-n3-1014-48f1) |
| Build logs | Cloud Build, one build per deploy | [Cloud Build history](https://console.cloud.google.com/cloud-build/builds;region=us-west1?project=cs651-n3-1014-48f1) |
| Request and error logs | Cloud Run → service → **Logs**, or `gcloud run services logs read SERVICE --region us-west1` | [Logs Explorer](https://console.cloud.google.com/logs?project=cs651-n3-1014-48f1) |
| Gemini API key | API key `smart-speech-coach-gemini`, restricted to the Generative Language API | [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=cs651-n3-1014-48f1) |
| Backend settings | Environment variables on the backend service: `GEMINI_API_KEY`, `GEMINI_MODEL`, `allowedOrigins`, `askAnythingPrompt` | Cloud Run → backend → **Revisions** → **Variables & Secrets** |
| Frontend settings | Build-time variables `VITE_SERVER_REMOTE`, `VITE_SERVER_URL_REMOTE` (the backend URL is compiled into the page) | `gcloud run deploy ... --set-build-env-vars` (section 4) |
| Local secrets (never committed) | `backend/.env`, `backend/.env.cloudrun`, `frontend/.env` on the developer's machine | Listed in `.gitignore` and `.gcloudignore` |

## 2. What we changed from the starter

| Area | Change | Why |
|---|---|---|
| New AI feature | `POST /api/feedback` and a **Get feedback on a speech** form. Gemini returns structured JSON (clarity score 1–10, summary, strengths, improvements) that the page renders as lists. | A second fetch-driven AI feature: JSON in, JSON out. |
| Backend status | The page calls `GET /api/health` on load and shows a badge with the backend URL it is using. | Shows during the demo that the page is talking to Cloud Run. |
| fetch helper | `frontend/src/api.js` holds the backend URL, a timeout (AbortController), and readable error messages for network, CORS, and HTTP errors. | The starter repeated this logic and could wait forever on a stalled request. |
| Gemini model | Default `gemini-3.5-flash-lite`, configurable with `GEMINI_MODEL`. | The starter's `gemini-2.5-flash` is limited to accounts that already used it. |
| Gemini call | `ai.models.generateContent` with `systemInstruction` and, for feedback, a JSON response schema. | Keeps our instructions separate from user text; guarantees parseable feedback. |
| Secrets | `backend/.gcloudignore` added. | Without it, `gcloud run deploy --source .` would upload `backend/.env` (with the API key) into the container image. |
| Validation | Questions ≤ 500 characters, speeches ≤ 5000, JSON bodies ≤ 20 kB; every error is JSON. Gemini's output is checked before it is returned. | Bounds cost and response time; consistent errors for the frontend. |
| Structure | Routes in `backend/app.js`, startup in `backend/server.js`. | Tests can build the app with a fake Gemini client. |
| Tests | `backend/test/api.test.js`: 10 HTTP tests, no key or network needed (`npm test`). | Checks routes, validation, CORS, and error handling. |
| Dependencies | Pinned versions instead of `"latest"`, `engines.node >= 20`, lockfile. | Reproducible Cloud Run builds. |
| Frontend hosting | `frontend/server.mjs` (Node built-ins only) serves the built app on Cloud Run; `gcp-build` and `start` scripts in `frontend/package.json`; `frontend/.gcloudignore`. | The whole app runs on Google Cloud, reachable from any device. |
| Automation | `deploy-gcp.sh` performs every deployment step below, for both services. | Any group member can redeploy with one command. |
| Cleanup | Removed `.firebaserc` and the Firebase GitHub workflow (they target the instructor's Firebase project and secrets), the `.agents/` AI-assistant files and `skills-lock.json`, and unused Vite template assets. | Not part of the app; the workflow would fail in our repository. |

## 3. How we deployed to Google Cloud Run

**Prerequisites:** Node.js 20+, the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
(`gcloud`), and a Google account with a billing account (we used our **Billing Account for
Education**; this lab fits in the free tier).

**Installing the Google Cloud CLI on macOS** (what we did): download the macOS ARM64 package
from the link above, unpack it in `~/Downloads`, then run

```bash
~/Downloads/google-cloud-sdk/install.sh        # answer Y to update PATH, Enter for the default rc file
source ~/Downloads/google-cloud-sdk/path.zsh.inc   # or open a new Terminal window
gcloud --version
```

### One command

```bash
bash deploy-gcp.sh
```

It stops only for Google sign-in and billing, deploys the backend and then the frontend, and
prints the public app URL at the end. The manual equivalent of each step follows.

### Step by step (what the script runs)

**1. Sign in and create a project**

```bash
gcloud auth login
gcloud projects create cs651-n3-1014-48f1 --name="CS651 N3 Labs"
gcloud config set project cs651-n3-1014-48f1
```

**2. Link billing.** Cloud Console → Billing → *Link a billing account* → choose the
education billing account (or `gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT_ID`).

**3. Enable the services**

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud services enable generativelanguage.googleapis.com apikeys.googleapis.com
```

New projects also need the build service account to be allowed to build from source:

```bash
PROJECT_NUMBER=$(gcloud projects describe cs651-n3-1014-48f1 --format='value(projectNumber)')
gcloud projects add-iam-policy-binding cs651-n3-1014-48f1 \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/run.builder" --condition=None
```

**4. Create a Gemini API key in the project**

```bash
gcloud services api-keys create --display-name="smart-speech-coach-gemini" \
  --api-target=service=generativelanguage.googleapis.com
gcloud services api-keys list          # copy the key's NAME
gcloud services api-keys get-key-string NAME
```

We created the key this way because keys from Google AI Studio that start with `AQ.` were
rejected by the Gemini API (`401 ACCESS_TOKEN_TYPE_UNSUPPORTED`, a
[known issue](https://discuss.ai.google.dev/t/aq-auth-key-returns-401-access-token-type-unsupported-on-generative-language-api-a-standard-aiza-keys-on-same-account-still-work/184612)).
The project key starts with `AIza` and is restricted to the Gemini API only.

**5. Write the Cloud Run settings file.** Copy `backend/.env.cloudrun.example` to
`backend/.env.cloudrun` and put the key in it. The file is YAML (`KEY: "value"`), is
git-ignored, and must not set `PORT` (Cloud Run sets it).

**6. Deploy from source**

```bash
cd backend
gcloud run deploy smart-speech-coach-backend \
  --source . \
  --region us-west1 \
  --allow-unauthenticated \
  --env-vars-file .env.cloudrun
```

Cloud Run uploads the source (minus `.gcloudignore` entries), builds a container with Google
Cloud buildpacks (no Dockerfile), creates a revision, and prints the **Service URL**.
`--allow-unauthenticated` makes the API callable from a browser.

**7. Verify**

```bash
curl https://smart-speech-coach-backend-x6crpaxyaa-uw.a.run.app/api/health
# {"status":"ok","geminiConfigured":true,"model":"gemini-3.5-flash-lite",...}

curl -X POST https://smart-speech-coach-backend-x6crpaxyaa-uw.a.run.app/api/askanything \
  -H "Content-Type: application/json" -d '{"message":"What is Smart Speech Coach?"}'
# {"answer":"..."}
```

**Optional: continuous deployment from GitHub.** Cloud Console → Cloud Run → the service →
*Set up continuous deployment* → connect this repository, branch `^main$`, build type
*buildpacks*, build context `/backend`. Set the same variables under *Variables & Secrets*.

## 4. Deploy the frontend to Cloud Run

The frontend is a second Cloud Run service. Cloud Run's Node buildpack runs `npm ci` and
`npm run gcp-build` (Vite builds `frontend/dist`), then starts `npm start`, which runs
`frontend/server.mjs` to serve the built files. The backend URL is baked in at build time:

```bash
cd frontend
gcloud run deploy smart-speech-coach-frontend \
  --source . \
  --region us-west1 \
  --allow-unauthenticated \
  --set-build-env-vars "VITE_SERVER_REMOTE=Y,VITE_SERVER_URL_REMOTE=https://smart-speech-coach-backend-x6crpaxyaa-uw.a.run.app"
```

The browser now calls the backend from the frontend's Cloud Run address, so the backend must
allow that origin (CORS). Cloud Run gives a service two equivalent URLs; we allow both:

```bash
gcloud run services update smart-speech-coach-backend --region us-west1 \
  --update-env-vars "^@^allowedOrigins=http://localhost:5173,http://127.0.0.1:5173,https://smart-speech-coach-frontend-896438282436.us-west1.run.app,SECOND_FRONTEND_URL"
```

`SECOND_FRONTEND_URL` is the `...-uw.a.run.app` address that
`gcloud run services describe smart-speech-coach-frontend --region us-west1 --format='value(status.url)'`
prints. (`^@^` tells gcloud to split variables on `@`, so the commas stay inside the value.)
`deploy-gcp.sh` does both steps and checks the CORS response.

**Using the frontend locally instead** (for development): `frontend/.env` points the dev
server at Cloud Run (`deploy-gcp.sh` writes it), then:

```bash
cd frontend
npm ci
npm run dev              # http://localhost:5173
```

## 5. Run everything locally

```bash
# terminal 1: backend on http://localhost:3001
cd backend
cp .env.example .env     # put a Gemini key in it
npm ci
npm start

# terminal 2: frontend, with VITE_SERVER_REMOTE=N in frontend/.env
cd frontend
npm ci
npm run dev
```

`npm test` in `backend/` runs the tests without a key.

## 6. Demo checklist

1. Cloud Console → Cloud Run: show both services (`smart-speech-coach-frontend`, `smart-speech-coach-backend`), their revisions, and **Logs**.
2. Open the health URL in a browser.
3. Open the public app URL: the badge says **Backend (Cloud Run): Connected** with the backend's `run.app` URL.
4. Ask a question, e.g. "How do I stop saying um?"
5. Paste a short speech into **Get feedback on a speech**: a score, strengths, and improvements appear.
6. DevTools → Network: the page comes from the frontend service, and its `fetch` requests go to the backend service with JSON bodies; the page does not reload.

## 7. Stop or remove the deployment

Cloud Run scales to zero when idle, so an unused service costs essentially nothing.

```bash
gcloud run services delete smart-speech-coach-frontend --region us-west1  # remove the frontend
gcloud run services delete smart-speech-coach-backend --region us-west1   # remove the backend
gcloud services api-keys list                                            # then delete the key:
gcloud services api-keys delete NAME
gcloud projects delete cs651-n3-1014-48f1                                 # remove everything
```

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Answers say "could not answer right now" | Read the reason: `gcloud run services logs read smart-speech-coach-backend --region us-west1 --limit 30 \| grep -i -A3 failed`. `ACCESS_TOKEN_TYPE_UNSUPPORTED` means an `AQ.` key: re-run `deploy-gcp.sh` and let it create a project key. |
| Badge: "Could not reach the backend" | The page's origin is missing from the backend's `allowedOrigins` (DevTools Console shows a CORS error): re-run `deploy-gcp.sh`. Locally: wrong URL in `frontend/.env` or Vite not restarted. |
| Badge: "Gemini key is not configured" | `GEMINI_API_KEY` missing from `.env.cloudrun`; redeploy. |
| `gcloud: command not found` | Open a new Terminal, or run `source ~/Downloads/google-cloud-sdk/path.zsh.inc`. |
| Deploy fails on a build permission | Grant `roles/run.builder` to the Compute Engine default service account (step 3). |
| First request is slow | Cloud Run cold start; the frontend waits up to 45 seconds. |

## 9. Project layout

```
├── deploy-gcp.sh               One-command setup and deploy of both services to Cloud Run
├── firebase.json               Optional: host frontend/dist on Firebase Hosting
├── backend/
│   ├── app.js                  Express routes: health, askanything, feedback
│   ├── server.js               Reads settings, creates the Gemini client, listens on PORT
│   ├── test/api.test.js        HTTP tests with a fake Gemini client
│   ├── .env.example            Local settings (dotenv)        → copy to .env
│   ├── .env.cloudrun.example   Cloud Run settings (YAML)      → copy to .env.cloudrun
│   └── .gcloudignore           Keeps secrets and node_modules out of the Cloud Run upload
└── frontend/
    ├── server.mjs              Serves the built app on Cloud Run (no dependencies)
    ├── .gcloudignore           Keeps node_modules, dist, and .env out of the upload
    ├── src/api.js              Every fetch() call to the backend
    ├── src/App.jsx             Ask anything
    ├── src/components/         BackendStatus, SpeechFeedback, NavigationBar
    └── .env.example            Which backend to call           → copy to .env
```

`.env`, `.env.cloudrun`, `node_modules/`, and `dist/` are git-ignored.

## 10. How we published this repository

1. Cloned the instructor's starter with its history:
   `git clone https://github.com/grewe/SmartSpeechCoach cs651-n3-3-smart-speech-coach`
2. Renamed its remote so our pushes go to our own repository: `git remote rename origin upstream`.
3. Made our changes (section 2) and checked that no secrets are tracked:
   `git status` shows no `.env` files, because `.gitignore` excludes them.
4. Committed as ourselves, with the email linked to our GitHub account.
5. Installed the GitHub CLI and signed in: `brew install gh`, then `gh auth login --web`.
6. Created the public repository and pushed `main` with the full history:
   `gh repo create Decoy-Devil/cs651-n3-3-smart-speech-coach --public --source=. --remote=origin --push`
7. Later changes: `git add -A && git commit -m "message" && git push`.
