"""
JWT Token Verification for AWS Cognito
Downloads JWKS and validates token signatures
"""
import asyncio
import logging
import threading
import time
from typing import Dict

import httpx
from jose import jwt, JWTError
from fastapi import HTTPException, status
from pydantic import ValidationError

from ..config import get_settings
from ..schemas.token import TokenPayload

logger = logging.getLogger(__name__)

JWKS_TTL_SECONDS = 3600  # Re-fetch JWKS every hour


class InvalidTokenError(HTTPException):
    """Custom exception for invalid tokens"""
    def __init__(self, detail: str = "Invalid or expired token"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"}
        )


def _jwks_url() -> str:
    settings = get_settings()
    return (
        f"https://cognito-idp.{settings.cognito_region}.amazonaws.com/"
        f"{settings.cognito_user_pool_id}/.well-known/jwks.json"
    )


class _JWKSCache:
    """Async-first JWKS cache with TTL and proper concurrency control.

    Uses a single asyncio.Lock for the async path (primary) and a
    threading.Lock for the legacy sync path. Both locks guard writes
    to the shared ``_jwks`` / ``_fetched_at`` state via an atomic
    snapshot tuple so readers never see a torn update.

    A long-lived ``httpx.AsyncClient`` is reused across fetches for
    connection pooling.
    """

    def __init__(self, ttl: int = JWKS_TTL_SECONDS):
        self._lock = threading.Lock()
        # Eagerly create the asyncio lock to avoid lazy-init race.
        # asyncio.Lock() can be instantiated outside a running loop.
        self._async_lock = asyncio.Lock()
        # Atomic snapshot: readers grab the tuple in one operation so
        # they never see _jwks from one fetch paired with _fetched_at
        # from another.
        self._snapshot: tuple[Dict | None, float] = (None, 0.0)
        self._ttl = ttl
        self._async_client: httpx.AsyncClient | None = None

    def _is_stale(self) -> bool:
        jwks, fetched_at = self._snapshot
        return jwks is None or (time.monotonic() - fetched_at) >= self._ttl

    def _cached_jwks(self) -> Dict | None:
        return self._snapshot[0]

    # ── sync path (legacy — avoid in async runtime) ─────────────

    def _fetch_sync(self) -> Dict:
        response = httpx.get(_jwks_url(), timeout=10)
        response.raise_for_status()
        return response.json()

    def get(self) -> Dict:
        if not self._is_stale():
            return self._cached_jwks()  # type: ignore[return-value]

        with self._lock:
            # Double-check after acquiring lock
            if not self._is_stale():
                return self._cached_jwks()  # type: ignore[return-value]
            try:
                jwks = self._fetch_sync()
                self._snapshot = (jwks, time.monotonic())
                logger.info("JWKS fetched/refreshed successfully (sync)")
            except httpx.HTTPError as e:
                cached = self._cached_jwks()
                if cached is not None:
                    logger.warning("JWKS refresh failed, using cached copy: %s", e)
                    return cached
                raise InvalidTokenError(f"Failed to fetch JWKS: {str(e)}")
        return self._cached_jwks()  # type: ignore[return-value]

    # ── async path (primary) ────────────────────────────────────

    def _get_async_client(self) -> httpx.AsyncClient:
        if self._async_client is None or self._async_client.is_closed:
            self._async_client = httpx.AsyncClient()
        return self._async_client

    async def _fetch_async(self) -> Dict:
        client = self._get_async_client()
        response = await client.get(_jwks_url(), timeout=10)
        response.raise_for_status()
        return response.json()

    async def get_async(self) -> Dict:
        if not self._is_stale():
            return self._cached_jwks()  # type: ignore[return-value]

        async with self._async_lock:
            if not self._is_stale():
                return self._cached_jwks()  # type: ignore[return-value]
            try:
                jwks = await self._fetch_async()
                self._snapshot = (jwks, time.monotonic())
                logger.info("JWKS fetched/refreshed successfully (async)")
            except httpx.HTTPError as e:
                cached = self._cached_jwks()
                if cached is not None:
                    logger.warning("JWKS refresh failed, using cached copy: %s", e)
                    return cached
                raise InvalidTokenError(f"Failed to fetch JWKS: {str(e)}")
        return self._cached_jwks()  # type: ignore[return-value]

    def invalidate(self) -> None:
        """Force next call to re-fetch (e.g. when a kid is not found)."""
        with self._lock:
            jwks = self._cached_jwks()
            self._snapshot = (jwks, 0.0)

    async def aclose(self) -> None:
        """Shut down the long-lived async HTTP client."""
        if self._async_client is not None and not self._async_client.is_closed:
            await self._async_client.aclose()
            self._async_client = None


_jwks_cache = _JWKSCache()


def get_jwks() -> Dict:
    """Return cached Cognito JWKS, refreshing when the TTL expires."""
    return _jwks_cache.get()


def _decode_and_validate(token: str, jwks: Dict, settings, allowed_token_uses: tuple[str, ...]) -> TokenPayload | None:
    """Pure-CPU JWT decode + claim validation. Shared by sync and async paths.

    Returns None (sentinel) when the token's kid is not found in the JWKS,
    signalling the caller should invalidate the cache and retry once.
    """
    unverified_header = jwt.get_unverified_header(token)
    kid = unverified_header.get("kid")

    if not kid:
        raise InvalidTokenError("Token missing 'kid' in header")

    matching_key = None
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            matching_key = key
            break

    if not matching_key:
        return None  # sentinel: caller must retry

    issuer = (
        f"https://cognito-idp.{settings.cognito_region}.amazonaws.com/"
        f"{settings.cognito_user_pool_id}"
    )

    payload = jwt.decode(
        token,
        matching_key,
        algorithms=["RS256"],
        issuer=issuer,
        options={
            "verify_signature": True,
            "verify_exp": True,
            "verify_aud": False,
            "verify_iss": True,
            "verify_at_hash": False,
        },
    )

    token_use = payload.get("token_use")
    if token_use not in allowed_token_uses:
        raise InvalidTokenError(
            f"Invalid token_use '{token_use}'. Expected one of: {', '.join(allowed_token_uses)}"
        )

    expected_client_id = settings.cognito_client_id
    audience_ok = False

    if token_use == "access":
        audience_ok = payload.get("client_id") == expected_client_id
        aud_claim = payload.get("aud")
        if not audience_ok and isinstance(aud_claim, str):
            audience_ok = aud_claim == expected_client_id
        if not audience_ok and isinstance(aud_claim, list):
            audience_ok = expected_client_id in aud_claim
    elif token_use == "id":
        aud_claim = payload.get("aud")
        if isinstance(aud_claim, str):
            audience_ok = aud_claim == expected_client_id
        elif isinstance(aud_claim, list):
            audience_ok = expected_client_id in aud_claim

    if not audience_ok:
        raise InvalidTokenError("Token audience/client_id does not match configured app client")

    return TokenPayload(**payload)


def verify_token(token: str, allowed_token_uses: tuple[str, ...] = ("access",)) -> TokenPayload:
    """Sync JWT verification (legacy).

    Prefer ``verify_token_async`` in async code paths to avoid blocking
    the event loop on JWKS fetches.
    """
    settings = get_settings()

    try:
        jwks = get_jwks()

        result = _decode_and_validate(token, jwks, settings, allowed_token_uses)
        if result is None:
            _jwks_cache.invalidate()
            jwks = get_jwks()
            result = _decode_and_validate(token, jwks, settings, allowed_token_uses)
            if result is None:
                raise InvalidTokenError("No matching key found in JWKS")

        return result

    except InvalidTokenError:
        raise
    except JWTError as e:
        raise InvalidTokenError(f"JWT validation failed: {str(e)}")
    except ValidationError as e:
        raise InvalidTokenError(f"Token payload validation failed: {str(e)}")
    except ValueError as e:
        raise InvalidTokenError(f"Invalid token payload: {str(e)}")
    except Exception as e:
        raise InvalidTokenError(f"Token verification error: {str(e)}")


async def verify_token_async(
    token: str, allowed_token_uses: tuple[str, ...] = ("access",),
) -> TokenPayload:
    """Async-aware token verification — uses async JWKS fetch on cache miss."""
    settings = get_settings()

    try:
        jwks = await _jwks_cache.get_async()

        result = _decode_and_validate(token, jwks, settings, allowed_token_uses)
        if result is None:
            # Key not found — invalidate and retry once
            _jwks_cache.invalidate()
            jwks = await _jwks_cache.get_async()
            result = _decode_and_validate(token, jwks, settings, allowed_token_uses)
            if result is None:
                raise InvalidTokenError("No matching key found in JWKS")

        return result

    except InvalidTokenError:
        raise
    except JWTError as e:
        raise InvalidTokenError(f"JWT validation failed: {str(e)}")
    except ValidationError as e:
        raise InvalidTokenError(f"Token payload validation failed: {str(e)}")
    except ValueError as e:
        raise InvalidTokenError(f"Invalid token payload: {str(e)}")
    except Exception as e:
        raise InvalidTokenError(f"Token verification error: {str(e)}")


def verify_token_optional(token: str | None, allowed_token_uses: tuple[str, ...] = ("access",)) -> TokenPayload | None:
    """Sync optional verification (legacy). Returns None when token is absent."""
    if not token:
        return None
    return verify_token(token, allowed_token_uses=allowed_token_uses)


async def verify_token_optional_async(
    token: str | None, allowed_token_uses: tuple[str, ...] = ("access",),
) -> TokenPayload | None:
    """Async optional verification. Returns None when token is absent."""
    if not token:
        return None
    return await verify_token_async(token, allowed_token_uses=allowed_token_uses)
