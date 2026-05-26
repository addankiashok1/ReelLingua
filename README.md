# ReelSync AI

AI-powered multilingual video dubbing and caption service. Upload an MP4, choose a target language, and receive a fully dubbed, captioned video — powered by ElevenLabs, MoviePy, and Pillow.

---

## Architecture

```
ReelSync AI
├── reelsync-backend/     ← FastAPI backend (Phases 1–3)
└── reelsync-frontend/    ← Next.js 14 frontend (Phase 3)
```

### Phase 1 — CLI Prototype
Local script that accepts an MP4, calls the ElevenLabs Dubbing API, downloads the dubbed audio and SRT subtitles, then burns styled captions onto video frames using Pillow (no ImageMagick required).

### Phase 2 — FastAPI Web Server
Transforms the CLI into a full REST API with PostgreSQL persistence, JWT authentication, local file storage, and background job processing.

### Phase 3 — Payments + Static Serving
CORS configuration for the Next.js frontend, `/downloads` static asset route for direct video streaming, and a PhonePe S2S payment webhook with SHA256 signature verification.

---

## Project Structure

```
reelsync-backend/
├── .env                       # API keys and secrets (never commit)
├── requirements.txt
├── main.py                    # FastAPI app, CORS, static mount, startup
├── config.py                  # Pydantic Settings — loads all env vars
├── database.py                # SQLAlchemy async engine + session factory
├── core/
│   ├── ai_client.py           # ElevenLabs Dubbing API + SRT download
│   ├── video_processor.py     # Pillow caption burner
│   └── pipeline.py            # CLI pipeline + async background job runner
├── models/
│   ├── db_models.py           # SQLAlchemy ORM: User, Project, RenderJob
│   └── schemas.py             # Pydantic request/response schemas
├── routers/
│   ├── auth.py                # /signup, /login, /me
│   ├── videos.py              # /upload, /process, /jobs, /credits
│   └── payments.py            # /phonepe-callback (S2S webhook)
├── local_storage/             # Auto-created; holds input + output videos (gitignored)
├── temp_outputs/              # Auto-created; ElevenLabs working files (gitignored)
├── test_run.py                # Phase 1 CLI entrypoint
└── test_phonepe.py            # PhonePe webhook integration test

reelsync-frontend/
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx           # Redirects to /login
    │   ├── login/
    │   ├── signup/
    │   └── dashboard/
    │       └── sync/          # Video upload + dubbing flow
    └── utils/
        └── api.ts             # Axios instance with JWT interceptor
```

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.11+ | `python --version` |
| Node.js | 18+ | For the Next.js frontend |
| PostgreSQL | 14+ | Local or remote instance |
| FFmpeg | Any recent | Required by MoviePy — `winget install ffmpeg` |
| ElevenLabs account | — | Creator plan or above for no watermark |

> ImageMagick is **not** required. Captions are rendered entirely via Pillow.

---

## Backend Setup

```bash
cd reelsync-backend

# Create and activate virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux

# Install dependencies
pip install -r requirements.txt
```

### Environment Variables

Create `reelsync-backend/.env` with the following keys:

```env
# Phase 1 — ElevenLabs
ELEVENLABS_API_KEY=sk_your_elevenlabs_key

# Phase 2 — Database & Auth
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/reelsync
JWT_SECRET_KEY=your_random_secret_key_min_32_chars

# Phase 3 — PhonePe (get from business.phonepe.com → Developers → API Keys)
PHONEPE_SALT_KEY=your_uat_or_prod_salt_key
PHONEPE_SALT_INDEX=1
```

### Run the Server

```bash
uvicorn main:app --reload --port 8000
```

API docs available at: `http://localhost:8000/docs`

---

## Frontend Setup

```bash
cd reelsync-frontend
npm install
npm run dev
```

Frontend runs at: `http://localhost:3000`

---

## API Endpoints

### Authentication
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/signup` | Register — returns JWT |
| POST | `/api/auth/login` | Login — returns JWT |
| GET | `/api/auth/me` | Current user profile + credit balance |

### Videos
| Method | Path | Description |
|---|---|---|
| POST | `/api/videos/upload` | Upload MP4 + title, create project |
| POST | `/api/videos/process/{project_id}` | Queue dubbing job |
| GET | `/api/videos/jobs/{job_id}` | Poll live job status |
| GET | `/api/videos/credits` | Remaining credit minutes |

### Payments
| Method | Path | Description |
|---|---|---|
| POST | `/api/payments/phonepe-callback` | PhonePe S2S webhook (internal) |

### Downloads
```
GET http://localhost:8000/downloads/{filename.mp4}
```
Direct MP4 stream from `local_storage/outputs/`.

---

## Supported Dubbing Languages

| Code | Language | Code | Language |
|---|---|---|---|
| `hi` | Hindi | `ko` | Korean |
| `en` | English | `ja` | Japanese |
| `es` | Spanish | `zh` | Chinese |
| `fr` | French | `ru` | Russian |
| `de` | German | `uk` | Ukrainian |
| `pt` | Portuguese | `ar` | Arabic |
| `it` | Italian | `tr` | Turkish |
| `nl` | Dutch | `pl` | Polish |
| `id` | Indonesian | `sv` | Swedish |
| `ms` | Malay | `ro` | Romanian |
| `fil` | Filipino | — | — |

> Telugu, Tamil, Kannada and other Indian regional languages are not currently supported by ElevenLabs Dubbing. Only Hindi (`hi`) is available for Indian language dubbing.

---

## Credit System

| Event | Credit change |
|---|---|
| New account | +3 minutes (free trial) |
| Job completed | −1 minute |
| PhonePe payment | +15 minutes (default) |

---

## Testing the PhonePe Webhook

```bash
# Edit TEST_EMAIL, TEST_PASSWORD, SALT_KEY at the top of the file first
python test_phonepe.py
```

This script logs in, fires a simulated COMPLETED payment callback, verifies credits are applied, and confirms tampered signatures are rejected with 401.

---

## Known Limitations

- No project history list endpoint yet (dashboard shows current job only)
- Single dubbing job per project (re-processing creates a new job)
- ElevenLabs free plan adds an audio watermark to dubbed output
- Local file storage only — no S3 or cloud bucket integration yet
