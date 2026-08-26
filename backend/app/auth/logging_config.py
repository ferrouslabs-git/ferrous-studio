"""Structured JSON logging for the auth module.

Configures a JSON formatter on the module's logger hierarchy so all
``logging.getLogger(__name__)`` calls across services produce structured
output.  Attaches only to the ``app.auth`` logger — the host app's root
logger is never modified.

Usage (in host app startup)::

    from app.auth.logging_config import configure_logging
    configure_logging()          # INFO, JSON to stderr
    configure_logging("DEBUG")   # override level
"""

import logging
import sys

from pythonjsonlogger import jsonlogger

_MODULE_LOGGER_NAME = "app.auth"
_CONFIGURED = False


class _AuthJsonFormatter(jsonlogger.JsonFormatter):
    """JSON formatter that always includes standard context fields."""

    def add_fields(self, log_record, record, message_dict):
        super().add_fields(log_record, record, message_dict)
        log_record.setdefault("level", record.levelname)
        log_record.setdefault("logger", record.name)
        log_record.setdefault("timestamp", self.formatTime(record))


def configure_logging(level: str = "INFO") -> logging.Logger:
    """Attach a JSON stream handler to the module logger.

    Safe to call multiple times — subsequent calls are no-ops (returns the
    already-configured logger).

    Args:
        level: Logging level name (``DEBUG``, ``INFO``, ``WARNING``, …).

    Returns:
        The configured ``app.auth`` logger.
    """
    global _CONFIGURED
    logger = logging.getLogger(_MODULE_LOGGER_NAME)

    if _CONFIGURED:
        return logger

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(_AuthJsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    logger.propagate = False  # don't duplicate into host root handler

    _CONFIGURED = True
    return logger
