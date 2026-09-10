"""Running an HTTP request on the user's behalf.

The browser cannot call an arbitrary API directly — CORS blocks it, and any
credential it sent would be readable by the page. The request is therefore
built here, sent from the server, and the response handed back whole.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional
from urllib.parse import urljoin, urlparse

import httpx

#: Header names whose values are echoed back masked.
SECRET_HEADER_PATTERNS = (
    "authorization",
    "cookie",
    "token",
    "api-key",
    "apikey",
    "secret",
    "password",
    "signature",
)

#: Variable names whose values are masked wherever they are shown.
SECRET_VARIABLE_PATTERNS = (
    "token",
    "secret",
    "password",
    "key",
    "auth",
    "credential",
)

VARIABLE = re.compile(r"\{\{\s*([\w.-]+)\s*\}\}")

DEFAULT_TIMEOUT = 30.0
MAX_TIMEOUT = 120.0
#: Response bodies larger than this are truncated rather than held in memory.
MAX_BODY_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5

TEXTUAL_CONTENT = (
    "text/",
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-www-form-urlencoded",
    "+json",
    "+xml",
)


def is_secret_header(name: str) -> bool:
    lowered = (name or "").lower()
    return any(pattern in lowered for pattern in SECRET_HEADER_PATTERNS)


def is_secret_variable(name: str) -> bool:
    lowered = (name or "").lower()
    return any(pattern in lowered for pattern in SECRET_VARIABLE_PATTERNS)


def mask(value: str) -> str:
    """Keep enough of a secret to recognise it, not enough to use it."""
    text = str(value or "")
    if len(text) <= 8:
        return "•" * len(text)
    return f"{text[:4]}{'•' * 8}{text[-2:]}"


def interpolate(value: Any, variables: dict) -> Any:
    """Replace `{{name}}` with the connection's variables.

    An unknown name is left as written rather than blanked, so a typo is
    visible in the request that goes out instead of silently sending nothing.
    """
    if not isinstance(value, str) or not variables:
        return value
    return VARIABLE.sub(
        lambda match: str(variables.get(match.group(1), match.group(0))), value
    )


@dataclass
class KeyValue:
    key: str
    value: str = ""
    enabled: bool = True


def active_pairs(pairs: Iterable[dict] | None, variables: dict) -> list[tuple[str, str]]:
    """Resolve key/value rows into the pairs actually sent."""
    resolved = []
    for pair in pairs or []:
        if not pair.get("enabled", True):
            continue
        key = str(pair.get("key") or "").strip()
        if not key:
            continue
        resolved.append((key, str(interpolate(pair.get("value") or "", variables))))
    return resolved


def resolve_url(base_url: str, path: str, variables: dict) -> str:
    """Join a saved request's path onto the connection's base URL."""
    path = str(interpolate(path or "", variables)).strip()
    base = str(interpolate(base_url or "", variables)).strip()

    if path.startswith(("http://", "https://")):
        return path
    if not base:
        raise ValueError("The connection has no base URL, so the path cannot resolve")

    if not base.endswith("/"):
        base += "/"
    return urljoin(base, path.lstrip("/"))


def build_body(
    body_type: str, body: Any, variables: dict
) -> tuple[Optional[bytes], Optional[dict], Optional[str]]:
    """Return (content, form data, the content type to declare)."""
    if body_type in (None, "", "none"):
        return None, None, None

    if body_type == "json":
        if isinstance(body, str):
            text = str(interpolate(body, variables))
            if not text.strip():
                return None, None, None
            try:
                json.loads(text)
            except ValueError as error:
                raise ValueError(f"Request body is not valid JSON: {error}") from error
            return text.encode("utf-8"), None, "application/json"
        return (
            json.dumps(body).encode("utf-8"),
            None,
            "application/json",
        )

    if body_type in ("form", "urlencoded"):
        pairs = active_pairs(body if isinstance(body, list) else [], variables)
        return None, dict(pairs), None

    text = str(interpolate(body if isinstance(body, str) else "", variables))
    return (text.encode("utf-8") if text else None), None, "text/plain; charset=utf-8"


def apply_auth(headers: list[tuple[str, str]], auth: dict | None, variables: dict):
    """Add the header the chosen auth scheme implies."""
    if not auth:
        return headers

    kind = (auth.get("type") or "none").lower()
    if kind == "none":
        return headers

    if kind == "bearer":
        token = str(interpolate(auth.get("token") or "", variables))
        if token:
            headers.append(("Authorization", f"Bearer {token}"))
    elif kind == "basic":
        import base64

        user = str(interpolate(auth.get("username") or "", variables))
        password = str(interpolate(auth.get("password") or "", variables))
        encoded = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
        headers.append(("Authorization", f"Basic {encoded}"))
    elif kind == "header":
        name = str(auth.get("name") or "").strip()
        value = str(interpolate(auth.get("value") or "", variables))
        if name:
            headers.append((name, value))

    return headers


@dataclass
class SentRequest:
    method: str
    url: str
    headers: list[dict] = field(default_factory=list)
    body: Optional[str] = None


@dataclass
class ReceivedResponse:
    status: int
    reason: str
    headers: list[dict]
    body: str
    is_text: bool
    size: int
    truncated: bool
    elapsed_ms: float
    content_type: Optional[str]


def is_textual(content_type: Optional[str]) -> bool:
    lowered = (content_type or "").lower()
    return any(token in lowered for token in TEXTUAL_CONTENT)


async def send(
    *,
    method: str,
    url: str,
    params: list[tuple[str, str]],
    headers: list[tuple[str, str]],
    content: Optional[bytes],
    data: Optional[dict],
    timeout: float,
    follow_redirects: bool,
    verify_tls: bool,
) -> tuple[SentRequest, ReceivedResponse]:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Only http and https URLs can be sent, got '{url}'")

    started = time.perf_counter()
    async with httpx.AsyncClient(
        timeout=min(max(timeout, 1.0), MAX_TIMEOUT),
        follow_redirects=follow_redirects,
        max_redirects=MAX_REDIRECTS,
        verify=verify_tls,
    ) as client:
        response = await client.request(
            method.upper(),
            url,
            params=params or None,
            headers=headers or None,
            content=content,
            data=data,
        )
        raw = response.content
    elapsed = (time.perf_counter() - started) * 1000

    truncated = len(raw) > MAX_BODY_BYTES
    payload = raw[:MAX_BODY_BYTES]
    content_type = response.headers.get("content-type")
    textual = is_textual(content_type)

    if textual:
        body = payload.decode(response.encoding or "utf-8", errors="replace")
    else:
        import base64

        body = base64.b64encode(payload).decode("ascii")

    sent = SentRequest(
        method=method.upper(),
        url=str(response.request.url),
        headers=[
            {
                "key": key,
                "value": mask(value) if is_secret_header(key) else value,
                "secret": is_secret_header(key),
            }
            for key, value in response.request.headers.items()
        ],
        body=(content.decode("utf-8", errors="replace") if content else None),
    )

    received = ReceivedResponse(
        status=response.status_code,
        reason=response.reason_phrase or "",
        headers=[{"key": key, "value": value} for key, value in response.headers.items()],
        body=body,
        is_text=textual,
        size=len(raw),
        truncated=truncated,
        elapsed_ms=round(elapsed, 2),
        content_type=content_type,
    )
    return sent, received
