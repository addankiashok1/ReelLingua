# ReelSync AI

ReelSync AI is a multilingual video dubbing workspace with a FastAPI backend and a Next.js frontend. Users can upload videos, queue renders, manage project folders, review render history, and buy subscription plans through PhonePe.

## Current Status

- Backend: FastAPI + SQLAlchemy + PostgreSQL
- Frontend: Next.js 14 + React + Tailwind CSS
- Billing model: plan limits are enforced in seconds, with 70% protected usage caps
- Render output caps are enforced by plan
- Downloads and original-video previews are authenticated

Current development note:
- `reelsync-backend/core/pipeline.py` currently contains a temporary dubbing bypass for render testing and reuses the original audio track instead of calling the live dubbing provider end-to-end.

## Repository Layout

```text
ReelSync AI
|- reelsync-backend/
|  |- core/
|  |- models/
|  |- routers/
|  |- local_storage/
|  |- temp_outputs/
|  |- billing.py
|  |- config.py
|  |- database.py
|  |- main.py
|  `- media_probe.py
|- reelsync-frontend/
|  |- scripts/
|  `- src/
|- requirements.txt
`- README.md
```

## Main Features

- JWT-based authentication
- Dashboard-based video upload and render queueing
- Project workspace with folders, scenes, reprocess flow, and history
- Subscription billing and PhonePe checkout
- Credits/usage enforcement by actual video duration
- Plan-based output resolution caps
- Trash and restore flow for projects, folders, and scenes
- Authenticated final-video download and original-video preview streaming

## Tech Stack

### Backend

- FastAPI
- SQLAlchemy 2.x
- asyncpg
- PostgreSQL
- MoviePy
- Pillow
- FFmpeg
- python-jose
- ElevenLabs SDK

### Frontend

- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- Axios

## Prerequisites

| Requirement | Recommended |
|---|---|
| Python | 3.11+ |
| Node.js | 20 LTS or 22 LTS |
| PostgreSQL | 14+ |
| FFmpeg | Installed and available on PATH |

Notes:
- The frontend dev server is most stable on Node 20 or 22 LTS.
- Port `5432` is expected for PostgreSQL only if you choose that in your `DATABASE_URL`.

## Installation

### Backend

```bash
cd reelsync-backend
python -m venv venv
venv\Scripts\activate
pip install -r ..\requirements.txt
```

### Frontend

```bash
cd reelsync-frontend
npm install
```

## Environment Variables

Create either:

- `reelsync-backend/.env`, or
- a repo-root `.env`

The backend is configured to read both.

Example:

```env
# Dubbing provider
ELEVENLABS_API_KEY=sk_your_key

# Database and auth
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/reelsync
JWT_SECRET_KEY=your_random_secret_key_min_32_chars

# PhonePe
PHONEPE_MERCHANT_ID=your_merchant_id
PHONEPE_SALT_KEY=your_salt_key
PHONEPE_SALT_INDEX=1
PHONEPE_API_URL=https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay
BASE_URL=http://localhost:8000
FRONTEND_URL=http://localhost:3000

# Optional SMTP for OTP/reset flows
SMTP_USER=your_email@example.com
SMTP_PASSWORD=your_app_password

# Optional concurrency override
MAX_CONCURRENT_JOBS=3
```

## Running the App

### Backend

```bash
cd reelsync-backend
uvicorn main:app --reload --port 8000
```

Backend docs:

- `http://localhost:8000/docs`

### Frontend

```bash
cd reelsync-frontend
npm run dev
```

If you need a specific port:

```bash
npm run dev -- --port 3000
```

Notes:
- The custom frontend dev script clears stale `.next` output before starting.
- `npm run dev -p 3000` is not the correct form for this project; use `npm run dev -- --port 3000`.

## Storage Paths

These folders are created automatically by the backend:

- `reelsync-backend/local_storage/inputs`
- `reelsync-backend/local_storage/outputs`
- `reelsync-backend/local_storage/profiles`
- `reelsync-backend/local_storage/thumbnails`
- `reelsync-backend/temp_outputs`

## Subscription Model

The backend currently enforces the following cycle allowances from code in `reelsync-backend/billing.py`. Usage is enforced in seconds, while the UI also shows a rounded display balance in minutes.

| Plan | Current enforced seconds | Current display balance | Output cap |
|---|---:|---:|---:|
| Free | 420 sec | 7 min | Up to 420p |
| Starter | 1,260 sec | 21 min | Up to 1080p |
| Creator | 5,082 sec | 85 min | Up to 2160p |
| Pro | 25,200 sec | 420 min | Up to 2160p |

Enforcement rules:

- Render jobs are blocked when the uploaded video's duration exceeds the remaining cycle balance.
- Output resolution is clamped by plan before rendering starts.
- Free plan output is capped at `420p`.
- Dashboard and project workspace resolution pickers are filtered by the active plan.
- The repository still contains a 70% margin cap in `APP_PLAN_TIMERS`; if you want full advertised bundle access instead, update the backend allocation logic first and then revise these docs.

## Key Backend Modules

- `reelsync-backend/billing.py`
  - Plan pricing, usage caps, and output-height caps
- `reelsync-backend/media_probe.py`
  - Duration and height probing helpers
- `reelsync-backend/core/pipeline.py`
  - Background render pipeline
- `reelsync-backend/core/video_processor.py`
  - Burned subtitles, scaling, and final render composition
- `reelsync-backend/routers/videos.py`
  - Dashboard upload/process/rework routes
- `reelsync-backend/routers/explorer.py`
  - Project workspace scenes, folders, and reprocess routes
- `reelsync-backend/routers/payments.py`
  - Subscription and payment flows
- `reelsync-backend/routers/trash.py`
  - Trash, restore, and permanent delete flows

## API Surface

This is a high-level overview of the main routes.

### Auth

- `POST /api/auth/signup-request`
- `POST /api/auth/verify-otp`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/forgot-password-request`
- `POST /api/auth/reset-password-verify`

### Dashboard video flow

- `POST /api/videos/upload`
- `POST /api/videos/process/{project_id}`
- `GET /api/videos/projects`
- `GET /api/videos/jobs/{job_id}`
- `POST /api/videos/rework/{project_id}`
- `GET /api/videos/credits`
- `GET /api/videos/tier`

### Project workspace

- `GET /api/projects/{project_id}/contents`
- `POST /api/folders`
- `PUT /api/folders/{folder_id}`
- `DELETE /api/folders/{folder_id}`
- `POST /api/scenes`
- `PUT /api/scenes/{scene_id}`
- `PATCH /api/scenes/{scene_id}/move`
- `DELETE /api/scenes/{scene_id}`
- `POST /api/scenes/{scene_id}/reprocess`
- `GET /api/scenes/{scene_id}/history`

### Trash

- `GET /api/trash/count`
- `GET /api/trash/projects`
- `GET /api/trash/workspace`
- restore and permanent-delete endpoints for projects, folders, and scenes

### Payments

- `POST /api/payments/subscribe`
- `POST /api/payments/initiate`
- `POST /api/payments/webhook`

### Secure media delivery

- `GET /downloads/{filename}?token=...`
- `GET /originals/{filename}?token=...`

## Frontend Areas

- `src/app/dashboard/page.tsx`
  - Fast-track upload flow and recent renders
- `src/app/dashboard/billing/page.tsx`
  - Monthly plans and billing summary
- `src/app/dashboard/projects/[projectId]/page.tsx`
  - Foldered workspace, scene management, and reprocessing
- `src/components/Sidebar.tsx`
  - Navigation, credits summary, and profile dropdown

## Development Notes

- The frontend uses `reelsync-frontend/scripts/dev-server.mjs` to normalize port args and clear stale Next build output.
- The backend creates missing database columns on startup for some schema migrations.
- Resolution caps are enforced in both request routing and render execution flow.
- The UI has been refactored to show credits-based usage rather than the older minute-only/character-heavy model.

## Testing

PhonePe callback test helper:

```bash
cd reelsync-backend
python test_phonepe.py
```

You can also sanity-check touched frontend code with:

```bash
cd reelsync-frontend
npx tsc --noEmit
```

## Known Notes

- Backend dependencies are installed from the repo-root `requirements.txt`.
- The current pipeline contains a temporary dubbing bypass for render testing.
- Some legacy naming in the backend still uses `credit_minutes` for display compatibility, even though hard enforcement now runs on seconds.
