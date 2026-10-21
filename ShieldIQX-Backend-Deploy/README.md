# ShieldIQ X Backend

Standalone FastAPI backend package for deployment on Render. The frontend is a separate project and is not included here.

## Upload to GitHub

Create or use a backend repository, then upload the **contents** of this folder to the repository root. The root must contain `app/`, `pyproject.toml`, and `render.yaml`. Do not upload `.env`, service-account JSON files, `.venv`, or `__pycache__`.

## Deploy on Render

Create a Render Blueprint from the GitHub repository, or create a Python Web Service with:

- Root Directory: blank
- Build Command: `pip install .`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health Check Path: `/api/v1/health`

The included `render.yaml` configures these commands and disables demo mode for deployment.

## Configure environment and cloud access

In Render's Environment settings, set `API_CORS_ORIGINS` to the exact deployed frontend origin, such as `https://your-app.vercel.app` (no path or trailing slash). Configure `GOOGLE_CLOUD_PROJECT` and `FIREBASE_PROJECT_ID` to the Firebase/Google Cloud project used by the application. See `.env.example` for other supported settings.

This API uses Firebase Admin and Google Cloud services for live authentication and data. Do not enable demo mode in production, and never commit service-account credentials. Configure Google Cloud credentials securely in Render (for example, as a secret file and `GOOGLE_APPLICATION_CREDENTIALS` path) and grant the service identity only the required permissions. Vertex AI features also need Vertex AI access in the configured project.

The health endpoint verifies that the service process is responding; it does not verify Firebase, Firestore, BigQuery, or Vertex AI credentials.

## Local development

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
python -m uvicorn app.main:app --reload
```

Run the API tests with `python -m pytest`.
