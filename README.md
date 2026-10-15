# CS651 Lab N3.3 — Smart Speech Coach on Google Cloud Run

An AI-enabled full-stack web app: a **React** frontend calls a **Node/Express** backend with
`fetch()`; the backend calls **Google Gemini** and returns JSON. The backend is deployed to
**Google Cloud Run**, and the frontend talks to that deployed service.

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
  localhost:5173                         holds GEMINI_API_KEY (never sent to the browser)
```

## Contents

1. [Our deployment](#1-our-deployment)
2. [What we changed from the starter](#2-what-we-changed-from-the-starter)
3. [How we deployed to Google Cloud Run](#3-how-we-deployed-to-google-cloud-run)
4. [Run the frontend against Cloud Run](#4-run-the-frontend-against-cloud-run)
5. [Run everything locally](#5-run-everything-locally)
6. [Demo checklist](#6-demo-checklist)
7. [Stop or remove the deployment](#7-stop-or-remove-the-deployment)
8. [Troubleshooting](#8-troubleshooting)
9. [Project layout](#9-project-layout)

## 1. Our deployment

| | |
|---|---|
| Google Cloud project | `cs651-n3-1014-48f1` |
| Region | `us-west1` |
| Cloud Run service | `smart-speech-coach-backend` |
| Service URL | https://smart-speech-coach-backend-x6crpaxyaa-uw.a.run.app |
| Health check | https://smart-speech-coach-backend-x6crpaxyaa-uw.a.run.app/api/health |
| Gemini model | `gemini-3.5-flash-lite` |
| Deployed | October 14, 2026 |

Verified: the frontend at `http://localhost:5173` shows **Backend (Cloud Run): Connected**, and
questions and speech feedback are answered by Gemini through the Cloud Run service.

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
| Automation | `deploy-gcp.sh` performs every deployment step below. | Any group member can redeploy with one command. |
| Cleanup | Removed `.firebaserc` and the Firebase GitHub workflow (they target the instructor's Firebase project and secrets), the `.agents/` AI-assistant files and `skills-lock.json`, and unused Vite template assets. | Not part of the app; the workflow would fail in our repository. |

## 3. How we deployed to Google Cloud Run

**Prerequisites:** Node.js 20+, the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
(`gcloud`), and a Google account with a billing account (we used our **Billing Account for
Education**; this lab fits in the free tier).

### One command

```bash
bash deploy-gcp.sh
```

It stops only for Google sign-in and billing, and prints the service URL at the end.
The manual equivalent of each step follows.

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

## 4. Run the frontend against Cloud Run

```bash
cd frontend
cp .env.example .env     # deploy-gcp.sh writes this for you
npm ci
npm run dev              # open http://localhost:5173
```

`frontend/.env`:

```
VITE_SERVER_REMOTE=Y
VITE_SERVER_URL_REMOTE=https://smart-speech-coach-backend-x6crpaxyaa-uw.a.run.app
VITE_SERVER_URL_LOCAL=http://localhost:3001
```

Vite reads `.env` only at startup, so restart `npm run dev` after changing it. The backend
allows `http://localhost:5173` through CORS (`allowedOrigins`); to host the frontend
elsewhere, add that origin to `allowedOrigins` in `.env.cloudrun` and redeploy.

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

1. Cloud Console → Cloud Run: show `smart-speech-coach-backend`, its revision, and **Logs**.
2. Open the health URL in a browser.
3. Start the frontend: the badge says **Backend (Cloud Run): Connected** with the `run.app` URL.
4. Ask a question, e.g. "How do I stop saying um?"
5. Paste a short speech into **Get feedback on a speech**: a score, strengths, and improvements appear.
6. DevTools → Network: the `fetch` requests go to the `run.app` URL with JSON bodies; the page does not reload.

## 7. Stop or remove the deployment

Cloud Run scales to zero when idle, so an unused service costs essentially nothing.

```bash
gcloud run services delete smart-speech-coach-backend --region us-west1   # remove the service
gcloud services api-keys list                                            # then delete the key:
gcloud services api-keys delete NAME
gcloud projects delete cs651-n3-1014-48f1                                 # remove everything
```

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Answers say "could not answer right now" | Read the reason: `gcloud run services logs read smart-speech-coach-backend --region us-west1 --limit 30 \| grep -i -A3 failed`. `ACCESS_TOKEN_TYPE_UNSUPPORTED` means an `AQ.` key: re-run `deploy-gcp.sh` and let it create a project key. |
| Badge: "Could not reach the backend" | Wrong URL in `frontend/.env`, Vite not restarted, or the page's origin is missing from `allowedOrigins`. |
| Badge: "Gemini key is not configured" | `GEMINI_API_KEY` missing from `.env.cloudrun`; redeploy. |
| `gcloud: command not found` | Open a new Terminal, or run `source ~/Downloads/google-cloud-sdk/path.zsh.inc`. |
| Deploy fails on a build permission | Grant `roles/run.builder` to the Compute Engine default service account (step 3). |
| First request is slow | Cloud Run cold start; the frontend waits up to 45 seconds. |

## 9. Project layout

```
├── deploy-gcp.sh               One-command setup and deploy to Cloud Run
├── firebase.json               Optional: host frontend/dist on Firebase Hosting
├── backend/
│   ├── app.js                  Express routes: health, askanything, feedback
│   ├── server.js               Reads settings, creates the Gemini client, listens on PORT
│   ├── test/api.test.js        HTTP tests with a fake Gemini client
│   ├── .env.example            Local settings (dotenv)        → copy to .env
│   ├── .env.cloudrun.example   Cloud Run settings (YAML)      → copy to .env.cloudrun
│   └── .gcloudignore           Keeps secrets and node_modules out of the Cloud Run upload
└── frontend/
    ├── src/api.js              Every fetch() call to the backend
    ├── src/App.jsx             Ask anything
    ├── src/components/         BackendStatus, SpeechFeedback, NavigationBar
    └── .env.example            Which backend to call           → copy to .env
```

`.env`, `.env.cloudrun`, `node_modules/`, and `dist/` are git-ignored.
