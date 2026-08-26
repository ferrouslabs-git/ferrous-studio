"""
Rate limiting service with in-memory and PostgreSQL backends.

Provides a unified interface for distributed (PostgreSQL) and single-process (in-memory) rate limiting.
"""
import logging
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from datetime import datetime, timedelta, UTC
from typing import Optional

from sqlalchemy import select, delete as sa_delete, func
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class RateLimiter(ABC):
    """Abstract base for rate limiter implementations."""

    @abstractmethod
    async def is_rate_limited(self, key: str, limit: int, window_seconds: int) -> bool:
        """
        Return True if the key has exceeded the rate limit.
        """
        pass

    @abstractmethod
    async def close(self) -> None:
        """Clean up resources."""
        pass


class InMemoryRateLimiter(RateLimiter):
    """
    Simple in-memory rate limiter using deque.
    Suitable for single-process deployments or testing.
    """

    def __init__(self):
        self.hits = defaultdict(deque)

    async def is_rate_limited(self, key: str, limit: int, window_seconds: int) -> bool:
        """Check if key has exceeded the rate limit."""
        window = timedelta(seconds=window_seconds)
        now = datetime.now(UTC).replace(tzinfo=None)
        q = self.hits[key]

        # Remove stale entries outside the window
        while q and (now - q[0]) > window:
            q.popleft()

        # Check if limit exceeded
        if len(q) >= limit:
            return True

        # Record this hit
        q.append(now)
        return False

    async def close(self) -> None:
        """No-op for in-memory limiter."""
        pass


class PostgresRateLimiter(RateLimiter):
    """
    Distributed rate limiter using PostgreSQL.
    Tracks hits per key and cleans up stale records.
    """

    def __init__(self, db_factory):
        """
        Initialize with an async database session factory.

        Args:
            db_factory: Async callable that returns an AsyncSession context manager
        """
        self.db_factory = db_factory

    async def is_rate_limited(self, key: str, limit: int, window_seconds: int) -> bool:
        """Check if key has exceeded the rate limit using PostgreSQL."""
        from ..models.rate_limit_hit import RateLimitHit

        try:
            async with self.db_factory() as db:
                window = timedelta(seconds=window_seconds)
                now = datetime.now(UTC).replace(tzinfo=None)
                window_start = now - window

                # Clean up stale records
                await db.execute(
                    sa_delete(RateLimitHit).where(RateLimitHit.hit_at < window_start)
                )

                # Count recent hits
                result = await db.execute(
                    select(func.count()).select_from(RateLimitHit).where(
                        RateLimitHit.key == key,
                        RateLimitHit.hit_at >= window_start,
                    )
                )
                hit_count = result.scalar()

                # Check if limit exceeded
                if hit_count >= limit:
                    return True

                # Record this hit
                new_hit = RateLimitHit(key=key, hit_at=now)
                db.add(new_hit)
                await db.commit()
                return False
        except Exception:
            # On DB error, fail open (allow request) rather than blocking all traffic
            logger.exception("Rate limiter DB error — failing open for key=%s", key)
            return False

    async def close(self) -> None:
        """No-op for PostgreSQL limiter."""
        pass


def create_rate_limiter(db_factory: Optional[callable] = None) -> RateLimiter:
    """
    Factory function to create the appropriate rate limiter.

    Args:
        db_factory: Optional async callable that returns an AsyncSession context manager.
                    If provided, returns PostgresRateLimiter.
                    If not provided, returns InMemoryRateLimiter.

    Returns:
        RateLimiter instance (PostgreSQL or in-memory).
    """
    if db_factory:
        return PostgresRateLimiter(db_factory)
    return InMemoryRateLimiter()
