"""
CLV Intelligence — FastAPI backend.

Endpoints:
  GET  /api/demo              → run pipeline on synthetic data (cached at startup)
  POST /api/auth/request      → save access request + notify via Discord webhook
  POST /api/auth/verify       → validate email+OTP → return session token
  GET  /api/schema/{source}   → column-mapping info for the upload wizard
  POST /api/upload/{source}   → validate + store uploaded CSV (requires auth)
  POST /api/run               → run pipeline on uploaded data (requires auth)

Static frontend is served from ./frontend/dist when it exists.
"""

import asyncio
import io
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import httpx
import pandas as pd
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import auth
from clv_engine.engine import DataSources, run_clv_pipeline
from clv_engine.schemas import ValidationError, get_schema_info, validate_and_clean
from clv_engine.synthetic_data import generate_all

# ---------------------------------------------------------------------------
# Demo cache — computed once at startup
# ---------------------------------------------------------------------------

_demo_cache: Optional[dict] = None


def _build_demo_cache() -> dict:
    crm, ga4, media, profiles = generate_all(output_dir="/tmp/clv_synthetic")
    sources = DataSources(crm=crm, ga4=ga4, media_spend=media, customer_profiles=profiles)
    return run_clv_pipeline(sources)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _demo_cache
    loop = asyncio.get_event_loop()
    _demo_cache = await loop.run_in_executor(None, _build_demo_cache)
    yield


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="CLV Intelligence API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://localhost:8000",
        "https://clv-intelligence.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------

class AccessRequest(BaseModel):
    name: str
    email: str
    company: str


class OTPVerify(BaseModel):
    email: str
    code: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/demo")
async def get_demo():
    if _demo_cache is None:
        raise HTTPException(status_code=503, detail="Demo data is still loading. Try again in a moment.")
    return _demo_cache


@app.post("/api/auth/request")
async def request_access(body: AccessRequest):
    webhook_url = os.environ.get("DISCORD_WEBHOOK_URL")
    if webhook_url:
        message = (
            f"**New CLV Intelligence access request**\n"
            f"Name: {body.name}\n"
            f"Email: {body.email}\n"
            f"Company: {body.company}\n\n"
            f"Add to `allowlist.json` and reply with their code."
        )
        try:
            async with httpx.AsyncClient() as client:
                await client.post(webhook_url, json={"content": message}, timeout=5)
        except Exception:
            pass  # don't fail the user-facing request if webhook is down
    return {"status": "ok", "message": "Request received. You'll receive your access code by email."}


@app.post("/api/auth/verify")
async def verify_access(body: OTPVerify):
    token = auth.verify_otp(body.email, body.code)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid or expired code.")
    return {"token": token}


@app.get("/api/schema/{source}")
async def get_schema(source: str):
    info = get_schema_info(source)
    if not info:
        raise HTTPException(status_code=404, detail=f"Unknown source: {source}")
    return info


@app.post("/api/upload/{source}")
async def upload_source(
    source: str,
    file: UploadFile = File(...),
    authorization: str = Header(None),
):
    session = auth.get_session(authorization)
    if not session:
        raise HTTPException(status_code=401, detail="Unauthorized. Please verify your access code first.")

    allowed_sources = {"crm", "ga4", "media_spend", "customer_profiles"}
    if source not in allowed_sources:
        raise HTTPException(status_code=400, detail=f"Unknown source '{source}'. Must be one of: {', '.join(allowed_sources)}")

    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse CSV: {e}")

    try:
        cleaned = validate_and_clean(df, source)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))

    session_dir = Path(f"/tmp/clv_{session['token']}")
    session_dir.mkdir(parents=True, exist_ok=True)
    cleaned.to_csv(session_dir / f"{source}.csv", index=(source == "crm"))

    preview = cleaned.head(5).copy()
    for col in preview.select_dtypes(include=["datetime64[ns]", "datetime64[ns, UTC]"]):
        preview[col] = preview[col].astype(str)

    return {
        "success": True,
        "source":  source,
        "rows":    len(cleaned),
        "columns": list(cleaned.columns),
        "preview": preview.to_dict(orient="records"),
    }


@app.post("/api/run")
async def run_analysis(authorization: str = Header(None)):
    session = auth.get_session(authorization)
    if not session:
        raise HTTPException(status_code=401, detail="Unauthorized.")

    session_dir = Path(f"/tmp/clv_{session['token']}")
    crm_path = session_dir / "crm.csv"
    if not crm_path.exists():
        raise HTTPException(status_code=400, detail="CRM data is required. Please upload crm.csv first.")

    crm = pd.read_csv(crm_path)
    sources = DataSources(crm=crm)

    optional_map = {
        "ga4":               "ga4",
        "media_spend":       "media_spend",
        "customer_profiles": "customer_profiles",
    }
    for attr, filename in optional_map.items():
        path = session_dir / f"{filename}.csv"
        if path.exists():
            setattr(sources, attr, pd.read_csv(path))

    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(None, lambda: run_clv_pipeline(sources))
    return results


# ---------------------------------------------------------------------------
# Serve frontend static files — must be mounted last
# ---------------------------------------------------------------------------

_frontend_dist = Path(__file__).parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
