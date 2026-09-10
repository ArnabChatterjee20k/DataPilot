"""Opening sessions against a user's connection, and turning adapter errors
into HTTP responses.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import HTTPException, status
from laserorm.storage.storage import StorageSession

from .config import UPLOAD_DIR, SourceConfig, get_adapter

#: LaserORM normalises driver errors into messages with a stable prefix.
ERROR_PREFIX_STATUS = (
    (("Authentication failed", "Authorization error"), status.HTTP_401_UNAUTHORIZED),
    (("Permission denied",), status.HTTP_403_FORBIDDEN),
    (
        (
            "Connection refused",
            "Connection timeout",
            "Connection failure",
            "Connection closed",
            "Connection error",
            "Connection limit exceeded",
            "Network error",
        ),
        status.HTTP_503_SERVICE_UNAVAILABLE,
    ),
    (
        (
            "Table not found",
            "Invalid column",
            "SQL syntax error",
            "Duplicate entry error",
            "Missing required field",
            "Integrity error",
            "Foreign key constraint",
            "Check constraint",
            "Database not found",
            "Operational error",
        ),
        status.HTTP_400_BAD_REQUEST,
    ),
)


def resolve_connection_uri(connection) -> str:
    """SQLite connections store a bucket filename, not a usable path."""
    if connection.source == SourceConfig.SQLITE.value:
        return str(UPLOAD_DIR / str(connection.connection_uri))
    return str(connection.connection_uri)


def to_http_error(error: Exception) -> HTTPException:
    if isinstance(error, HTTPException):
        return error

    message = str(error)
    for prefixes, code in ERROR_PREFIX_STATUS:
        if message.startswith(prefixes):
            return HTTPException(status_code=code, detail=message)

    if isinstance(error, (ConnectionError, OSError, TimeoutError)):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not reach the database: {message}",
        )

    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=message
    )


@asynccontextmanager
async def open_session(connection) -> AsyncGenerator[StorageSession, None]:
    """Open a session against a user connection, mapping failures to HTTP errors."""
    adapter = get_adapter(connection.source)
    if adapter is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{connection.source}' connections are not supported yet",
        )

    storage = adapter(connection_uri=resolve_connection_uri(connection))
    try:
        async with storage.session() as session:
            yield session
    except HTTPException:
        raise
    except Exception as error:
        raise to_http_error(error) from error
