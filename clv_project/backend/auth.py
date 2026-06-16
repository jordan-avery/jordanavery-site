"""
Simple OTP + session auth for the CLV Intelligence API.

Allowlist format (allowlist.json):
  {
    "user@example.com": {
      "code": "ABC123",
      "name": "Jane Smith",
      "company": "Acme Corp",
      "expires": "2024-12-31T23:59:59"   // ISO UTC — omit for no expiry
    }
  }

Add entries manually via Render shell or SSH after someone submits a request.
"""

import json
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

ALLOWLIST_PATH = Path(__file__).parent / "allowlist.json"
TOKEN_TTL_HOURS = 24

# In-memory session store: { token: { email, expires_at, token } }
_sessions: dict[str, dict] = {}


def _load_allowlist() -> dict:
    if not ALLOWLIST_PATH.exists():
        return {}
    with open(ALLOWLIST_PATH) as f:
        return json.load(f)


def verify_otp(email: str, code: str) -> Optional[str]:
    """
    Validates email + OTP against allowlist.json.
    Returns a session token on success, None on failure.
    """
    allowlist = _load_allowlist()
    entry = allowlist.get(email.lower())
    if not entry:
        return None

    if entry.get("code") != code:
        return None

    expires = entry.get("expires")
    if expires:
        if datetime.fromisoformat(expires) < datetime.utcnow():
            return None

    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(hours=TOKEN_TTL_HOURS)
    _sessions[token] = {
        "email":      email.lower(),
        "expires_at": expires_at.isoformat(),
        "token":      token,
    }
    return token


def get_session(authorization: Optional[str]) -> Optional[dict]:
    """
    Validates a Bearer token from the Authorization header.
    Returns the session dict on success, None if missing/expired.
    """
    if not authorization:
        return None
    token = authorization.removeprefix("Bearer ").strip()
    session = _sessions.get(token)
    if not session:
        return None
    if datetime.fromisoformat(session["expires_at"]) < datetime.utcnow():
        del _sessions[token]
        return None
    return session
