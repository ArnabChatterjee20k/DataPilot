"""Opening sessions against a user's connection, and turning adapter errors
into HTTP responses.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import HTTPException, status
from laserorm.storage.storage import StorageSession

from .config import UPLOAD_DIR, SourceConfig, get_adapter
from .http_client import container_hint, refusal_wording

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


def to_http_error(error: Exception, connection_uri: str = "") -> HTTPException:
    """Turn an adapter error into an HTTP one, in words worth showing a person."""
    if isinstance(error, HTTPException):
        return error

    message = str(error) or type(error).__name__
    for prefixes, code in ERROR_PREFIX_STATUS:
        if message.startswith(prefixes):
            if code == status.HTTP_503_SERVICE_UNAVAILABLE:
                message = container_hint(connection_uri, message)
            return HTTPException(status_code=code, detail=message)

    if isinstance(error, (ConnectionError, OSError, TimeoutError)):
        # the OS wording for a closed port varies by platform and says nothing
        # useful; what matters is that nothing is listening
        detail = (
            "Could not reach the database: the connection was refused. "
            "Nothing is listening on that host and port."
            if refusal_wording(message)
            else f"Could not reach the database: {message}"
        )
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=container_hint(connection_uri, detail),
        )

    # nothing recognised it, so say plainly that it was unexpected rather than
    # leaving a bare driver string on screen with no context
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"The database driver failed unexpectedly: {message}",
    )


@asynccontextmanager
async def open_session(connection) -> AsyncGenerator[StorageSession, None]:
    """Open a session against a user connection, mapping failures to HTTP errors."""
    adapter = get_adapter(connection.source)
    if adapter is None:
        if connection.source == SourceConfig.API.value:
            detail = (
                "This is an API connection - use the request endpoints instead "
                "of the query ones"
            )
        elif connection.source == SourceConfig.REDIS.value:
            detail = (
                "This is a Redis connection. Redis has no tables and no SQL, "
                "so use the key browser instead of the query endpoints."
            )
        else:
            detail = f"'{connection.source}' connections are not supported yet"
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    storage = adapter(connection_uri=resolve_connection_uri(connection))
    try:
        async with storage.session() as session:
            yield session
    except HTTPException:
        raise
    except Exception as error:
        raise to_http_error(error, str(connection.connection_uri)) from error
