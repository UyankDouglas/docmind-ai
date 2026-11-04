"""Rate limiting simples por janela fixa (Redis), com fallback em memória para testes."""

from __future__ import annotations

import threading
import time

from app.core.config import settings
from app.core.exceptions import RateLimitedError
from app.core.logging import get_logger

log = get_logger(__name__)


class _MemoryWindow:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: dict[str, tuple[int, float]] = {}

    def hit(self, key: str, window_seconds: int) -> int:
        now = time.time()
        with self._lock:
            count, reset_at = self._data.get(key, (0, now + window_seconds))
            if now >= reset_at:
                count, reset_at = 0, now + window_seconds
            count += 1
            self._data[key] = (count, reset_at)
            return count

    def reset(self) -> None:
        with self._lock:
            self._data.clear()


_memory = _MemoryWindow()


def _hit(key: str, window_seconds: int) -> int:
    if settings.app_env == "test":
        return _memory.hit(key, window_seconds)
    try:
        from app.providers.redis_client import get_redis

        r = get_redis()
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, window_seconds, nx=True)
        count, _ = pipe.execute()
        return int(count)
    except Exception as exc:  # Redis indisponível: registra e usa memória local
        log.warning("rate_limit_redis_unavailable", error=type(exc).__name__)
        return _memory.hit(key, window_seconds)


def enforce_rate_limit(scope: str, identifier: str, limit: int, window_seconds: int) -> None:
    """Lança RateLimitedError quando `identifier` excede `limit` hits na janela."""
    if limit <= 0:
        return
    key = f"rl:{scope}:{identifier}"
    count = _hit(key, window_seconds)
    if count > limit:
        raise RateLimitedError()


def reset_for_tests() -> None:
    _memory.reset()
