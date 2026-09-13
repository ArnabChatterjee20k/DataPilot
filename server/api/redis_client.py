"""Redis as a connection kind of its own.

Redis is not a SQL database with tables, so it does not go through the ORM:
there is no schema to introspect and no query to plan. What it has instead is
a keyspace of differently shaped values, a server that reports on itself, and
a pub/sub bus - and each of those is only useful shown as what it is.

The one rule that matters throughout: **never `KEYS *`**. It blocks the server
for the length of the keyspace, which on anything real means an outage. Every
listing here is a cursored `SCAN`.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib.parse import unquote, urlparse

#: How many keys one page of the browser asks for.
DEFAULT_PAGE = 100
MAX_PAGE = 1000

#: How many elements of a collection are read before it is called large. A key
#: with a million members should not arrive in a browser tab.
MAX_ELEMENTS = 500

#: How long any single command may take.
COMMAND_TIMEOUT = 10.0
CONNECT_TIMEOUT = 10.0

#: `SCAN` is cursored, so a match that hits nothing still has to be paged
#: through. This caps how many empty rounds are spent before answering.
MAX_SCAN_ROUNDS = 20

STRING = "string"
HASH = "hash"
LIST = "list"
SET = "set"
ZSET = "zset"
STREAM = "stream"
NONE = "none"

#: What each type is called where a person reads it.
TYPE_LABELS = {
    STRING: "String",
    HASH: "Hash",
    LIST: "List",
    SET: "Set",
    ZSET: "Sorted set",
    STREAM: "Stream",
    NONE: "Missing",
}


class RedisError(Exception):
    """A Redis failure already phrased for the person looking at it."""


@dataclass
class RedisAddress:
    host: str
    port: int
    db: int = 0
    username: Optional[str] = None
    password: Optional[str] = None
    use_tls: bool = False

    @property
    def display(self) -> str:
        scheme = "rediss" if self.use_tls else "redis"
        return f"{scheme}://{self.host}:{self.port}/{self.db}"


def is_redis_url(url: str) -> bool:
    return str(url or "").strip().lower().startswith(("redis://", "rediss://"))


def parse_url(url: str) -> RedisAddress:
    """Read `redis://user:pass@host:6379/2` into its parts."""
    text = str(url or "").strip()
    if not is_redis_url(text):
        raise RedisError(
            f"'{text or 'The URL'}' is not a Redis address. Use "
            "redis://host:6379 or rediss://host:6380 for TLS."
        )

    parsed = urlparse(text)
    if not parsed.hostname:
        raise RedisError(f"'{text}' has no host. Use redis://host:6379.")

    database = 0
    path = (parsed.path or "").strip("/")
    if path:
        try:
            database = int(path)
        except ValueError as error:
            raise RedisError(
                f"'{path}' is not a database number. Redis databases are "
                "numbered, so the path should be something like /0."
            ) from error

    return RedisAddress(
        host=parsed.hostname,
        port=parsed.port or 6379,
        db=database,
        username=unquote(parsed.username) if parsed.username else None,
        password=unquote(parsed.password) if parsed.password else None,
        use_tls=parsed.scheme == "rediss",
    )


def clamp_page(count: Optional[int]) -> int:
    if not count or count < 1:
        return DEFAULT_PAGE
    return min(int(count), MAX_PAGE)


def as_text(value: Any) -> str:
    """Redis values are bytes; most are text, and the rest still have to show."""
    if value is None:
        return ""
    if isinstance(value, (bytes, bytearray)):
        try:
            return bytes(value).decode("utf-8")
        except UnicodeDecodeError:
            return base64.b64encode(bytes(value)).decode("ascii")
    return str(value)


def is_text(value: Any) -> bool:
    if not isinstance(value, (bytes, bytearray)):
        return True
    try:
        bytes(value).decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


@dataclass
class KeyInfo:
    key: str
    type: str
    #: -1 when the key has no expiry, which is not the same as expired.
    ttl: Optional[int] = None
    size: Optional[int] = None
    encoding: Optional[str] = None

    @property
    def label(self) -> str:
        return TYPE_LABELS.get(self.type, self.type)


@dataclass
class KeyValue:
    """One key's contents, shaped by what the key actually is."""

    key: str
    type: str
    ttl: Optional[int] = None
    size: Optional[int] = None
    encoding: Optional[str] = None
    #: A string's value.
    value: Optional[str] = None
    is_text: bool = True
    #: Hash fields, sorted-set members with scores, stream entries.
    entries: list[dict] = field(default_factory=list)
    #: List or set members.
    members: list[str] = field(default_factory=list)
    #: True when there was more than MAX_ELEMENTS and only a page was read.
    truncated: bool = False


def describe_failure(address: RedisAddress, error: Exception) -> str:
    """Say what went wrong, in words worth showing a person."""
    from .http_client import container_hint

    text = str(error).strip() or type(error).__name__
    lowered = text.lower()
    target = address.display

    if "wrongpass" in lowered or "invalid username-password" in lowered:
        detail = (
            f"{target} refused the credentials. Check the username and "
            "password on the connection."
        )
    elif "noauth" in lowered or "authentication required" in lowered:
        detail = (
            f"{target} needs a password. Put it in the connection URL as "
            "redis://:password@host:6379."
        )
    elif "noperm" in lowered:
        detail = f"{target} accepted the user but not the command: {text}"
    elif "refused" in lowered or "connection refused" in lowered:
        detail = (
            f"Could not reach {target}: the connection was refused. Nothing "
            "is listening on that host and port."
        )
    elif "name or service not known" in lowered or "getaddrinfo" in lowered:
        detail = f"Could not resolve the host in {target}. Check the hostname."
    elif "timed out" in lowered or "timeout" in lowered:
        detail = f"Timed out talking to {target}."
    elif "ssl" in lowered or "certificate" in lowered:
        detail = (
            f"TLS failed talking to {target}: {text}. Use redis:// for a "
            "server without TLS, and rediss:// for one with it."
        )
    elif "out of range" in lowered and "db index" in lowered:
        detail = (
            f"{target} does not have that database. Redis servers have 16 by "
            "default, numbered from 0."
        )
    else:
        detail = f"{target} returned an error: {text}"

    return container_hint(f"{address.host}:{address.port}", detail)


# ------------------------------------------------------------------ the server


#: What a person actually wants to know about a running Redis, and why.
INFO_FIELDS = (
    ("redis_version", "Version"),
    ("uptime_in_seconds", "Uptime"),
    ("connected_clients", "Clients"),
    ("used_memory_human", "Memory used"),
    ("used_memory_peak_human", "Memory peak"),
    ("maxmemory_human", "Memory limit"),
    ("maxmemory_policy", "Eviction policy"),
    ("evicted_keys", "Evicted keys"),
    ("expired_keys", "Expired keys"),
    ("total_commands_processed", "Commands"),
    ("instantaneous_ops_per_sec", "Commands per second"),
    ("keyspace_hits", "Keyspace hits"),
    ("keyspace_misses", "Keyspace misses"),
    ("rdb_last_bgsave_status", "Last save"),
    ("role", "Role"),
    ("connected_slaves", "Replicas"),
)


def hit_rate(info: dict) -> Optional[float]:
    """The number that says whether the cache is earning its keep."""
    try:
        hits = int(info.get("keyspace_hits") or 0)
        misses = int(info.get("keyspace_misses") or 0)
    except (TypeError, ValueError):
        return None
    total = hits + misses
    return round(hits / total * 100, 1) if total else None


def keyspace(info: dict) -> list[dict]:
    """How many keys live in each numbered database.

    Redis reports these as `db0: keys=12,expires=3,avg_ttl=0`, which is not a
    shape anything else can read.
    """
    databases = []
    for name, value in info.items():
        if not str(name).startswith("db") or not isinstance(value, (dict, str)):
            continue
        stats = value
        if isinstance(value, str):
            stats = {}
            for part in value.split(","):
                field_name, _, field_value = part.partition("=")
                stats[field_name.strip()] = field_value.strip()
        try:
            databases.append(
                {
                    "db": int(str(name)[2:]),
                    "keys": int(stats.get("keys") or 0),
                    "expires": int(stats.get("expires") or 0),
                }
            )
        except (TypeError, ValueError):
            continue
    return sorted(databases, key=lambda item: item["db"])


def readable_uptime(seconds: Any) -> str:
    try:
        total = int(seconds or 0)
    except (TypeError, ValueError):
        return ""
    days, rest = divmod(total, 86400)
    hours, rest = divmod(rest, 3600)
    minutes = rest // 60
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def summarise(info: dict) -> list[dict]:
    """The INFO fields worth showing, in the order worth showing them."""
    rows = []
    for name, label in INFO_FIELDS:
        if name not in info:
            continue
        value = info[name]
        if name == "uptime_in_seconds":
            value = readable_uptime(value)
        rows.append({"name": name, "label": label, "value": as_text(value)})
    return rows


# ----------------------------------------------------------------- the session


#: The types a key can be created as from here.
WRITABLE_TYPES = (STRING, HASH, LIST, SET, ZSET, STREAM)


def _require_content(kind: str, value, entries: list, members: list) -> None:
    """Redis cannot store an empty collection: the key simply would not exist."""
    if kind == STRING:
        if value is None:
            raise RedisError("A string key needs a value, even an empty one.")
        return
    if kind in (LIST, SET) and not members:
        raise RedisError(
            f"A {TYPE_LABELS[kind].lower()} with nothing in it is not a key Redis "
            "can store. Give it at least one member."
        )
    if kind in (HASH, ZSET, STREAM) and not entries:
        raise RedisError(
            f"A {TYPE_LABELS[kind].lower()} with nothing in it is not a key Redis "
            "can store. Give it at least one entry."
        )


def _score(raw) -> float:
    try:
        return float(raw)
    except (TypeError, ValueError) as error:
        raise RedisError(f"{raw!r} is not a number, so it cannot be a score.") from error


def _queue_write(pipe, key: str, kind: str, value, entries: list, members: list) -> None:
    if kind == STRING:
        pipe.set(key, value)
    elif kind == HASH:
        mapping = {str(entry.get("field", "")): str(entry.get("value", "")) for entry in entries}
        if "" in mapping:
            raise RedisError("Every hash field needs a name.")
        pipe.hset(key, mapping=mapping)
    elif kind == LIST:
        pipe.rpush(key, *members)
    elif kind == SET:
        pipe.sadd(key, *members)
    elif kind == ZSET:
        pipe.zadd(
            key,
            {str(entry.get("member", "")): _score(entry.get("score")) for entry in entries},
        )
    elif kind == STREAM:
        for entry in entries:
            fields = {str(name): str(item) for name, item in (entry.get("fields") or {}).items()}
            if not fields:
                raise RedisError("A stream entry needs at least one field.")
            pipe.xadd(key, fields)


async def _string_set(client, key, item):
    await client.set(key, str(item.get("value", "")), keepttl=True)


async def _hash_set(client, key, item):
    field = str(item.get("field") or "")
    if not field:
        raise RedisError("A hash field needs a name.")
    await client.hset(key, field, str(item.get("value", "")))


async def _hash_remove(client, key, item):
    if not await client.hdel(key, str(item.get("field") or "")):
        raise RedisError(f"There is no field {item.get('field')!r} in {key!r}.")


async def _list_set(client, key, item):
    try:
        await client.lset(key, int(item.get("index")), str(item.get("value", "")))
    except (TypeError, ValueError) as error:
        raise RedisError("A list position is a whole number.") from error


async def _list_push(client, key, item):
    value = str(item.get("value", ""))
    if item.get("end") == "head":
        await client.lpush(key, value)
    else:
        await client.rpush(key, value)


async def _list_remove(client, key, item):
    """Remove one position, rather than every member that happens to match.

    LREM works by value, so two identical members make "remove this one"
    ambiguous. Marking the position with a value nothing else can hold, then
    removing that, takes exactly the row that was pointed at.
    """
    import uuid

    marker = f"__datapilot_removed_{uuid.uuid4().hex}"
    try:
        await client.lset(key, int(item.get("index")), marker)
    except (TypeError, ValueError) as error:
        raise RedisError("A list position is a whole number.") from error
    await client.lrem(key, 1, marker)


async def _set_add(client, key, item):
    await client.sadd(key, str(item.get("member", "")))


async def _set_remove(client, key, item):
    if not await client.srem(key, str(item.get("member", ""))):
        raise RedisError(f"{item.get('member')!r} is not in {key!r}.")


async def _zset_set(client, key, item):
    await client.zadd(key, {str(item.get("member", "")): _score(item.get("score"))})


async def _zset_remove(client, key, item):
    if not await client.zrem(key, str(item.get("member", ""))):
        raise RedisError(f"{item.get('member')!r} is not in {key!r}.")


async def _stream_add(client, key, item):
    fields = {str(name): str(value) for name, value in (item.get("fields") or {}).items()}
    if not fields:
        raise RedisError("A stream entry needs at least one field.")
    await client.xadd(key, fields)


async def _stream_remove(client, key, item):
    if not await client.xdel(key, str(item.get("id", ""))):
        raise RedisError(f"There is no entry {item.get('id')!r} in {key!r}.")


#: What each type can be changed with, one part at a time.
_EDITS = {
    (STRING, "set"): _string_set,
    (HASH, "set"): _hash_set,
    (HASH, "remove"): _hash_remove,
    (LIST, "set"): _list_set,
    (LIST, "push"): _list_push,
    (LIST, "remove"): _list_remove,
    (SET, "add"): _set_add,
    (SET, "remove"): _set_remove,
    (ZSET, "set"): _zset_set,
    (ZSET, "remove"): _zset_remove,
    (STREAM, "add"): _stream_add,
    (STREAM, "remove"): _stream_remove,
}


class RedisSession:
    """One connection to a Redis server, for the length of one request.

    Values come back as bytes and go out as text; the decoding lives here so
    nothing above has to think about it.
    """

    def __init__(self, address: RedisAddress):
        self.address = address
        self._client = None

    async def __aenter__(self) -> "RedisSession":
        import redis.asyncio as redis

        self._client = redis.Redis(
            host=self.address.host,
            port=self.address.port,
            db=self.address.db,
            username=self.address.username,
            password=self.address.password,
            ssl=self.address.use_tls,
            socket_connect_timeout=CONNECT_TIMEOUT,
            socket_timeout=COMMAND_TIMEOUT,
            decode_responses=False,
            health_check_interval=0,
        )
        return self

    async def __aexit__(self, *_exc):
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:
                pass

    @property
    def client(self):
        if self._client is None:
            raise RedisError("The Redis session is not open.")
        return self._client

    async def ping(self) -> bool:
        return bool(await self.client.ping())

    async def info(self) -> dict:
        """INFO, as a flat dictionary."""
        raw = await self.client.info()
        return {as_text(key): value for key, value in (raw or {}).items()}

    async def scan_keys(
        self, pattern: str = "*", cursor: int = 0, count: int = DEFAULT_PAGE
    ) -> tuple[list[KeyInfo], int]:
        """One page of keys, with the cursor to ask for the next.

        SCAN rather than KEYS: KEYS walks the whole keyspace in one blocking
        command, which on a real server is an outage. SCAN can also hand back
        an empty page with a non-zero cursor, so a selective pattern is paged
        through rather than reported as nothing.
        """
        found: list = []
        rounds = 0

        while rounds < MAX_SCAN_ROUNDS:
            cursor, batch = await self.client.scan(
                cursor=cursor, match=pattern or "*", count=count
            )
            found.extend(batch or [])
            rounds += 1
            if cursor == 0 or len(found) >= count:
                break

        # every key found is kept, even past `count`: the cursor has already
        # moved beyond them, so trimming a page loses keys for good. COUNT is
        # only a hint, and one hash bucket can hand back more than it asked.
        return await self._describe(found), int(cursor)

    async def _describe(self, keys: list) -> list[KeyInfo]:
        """Type, TTL and size for a page of keys, in one round trip."""
        if not keys:
            return []

        pipeline = self.client.pipeline(transaction=False)
        for key in keys:
            pipeline.type(key)
            pipeline.ttl(key)
        answers = await pipeline.execute()

        described = []
        for index, key in enumerate(keys):
            described.append(
                KeyInfo(
                    key=as_text(key),
                    type=as_text(answers[index * 2]) or NONE,
                    ttl=answers[index * 2 + 1],
                )
            )

        sizes = await self._sizes(keys, [item.type for item in described])
        for item, size in zip(described, sizes):
            item.size = size if isinstance(size, int) else None
        return described

    async def _sizes(self, keys: list, types: list) -> list:
        """How many elements each key holds, which is the useful size for one."""
        pipeline = self.client.pipeline(transaction=False)
        for key, kind in zip(keys, types):
            if kind == HASH:
                pipeline.hlen(key)
            elif kind == LIST:
                pipeline.llen(key)
            elif kind == SET:
                pipeline.scard(key)
            elif kind == ZSET:
                pipeline.zcard(key)
            elif kind == STREAM:
                pipeline.xlen(key)
            else:
                pipeline.strlen(key)
        return await pipeline.execute()

    async def read(self, key: str) -> KeyValue:
        """One key's contents, shaped by what the key is.

        A hash shown as a string is unreadable, and a sorted set without its
        scores is not a sorted set.
        """
        kind = as_text(await self.client.type(key)) or NONE
        if kind == NONE:
            raise RedisError(
                f"There is no key called {key!r}. It may have expired, or "
                "never existed."
            )

        value = KeyValue(key=key, type=kind, ttl=await self.client.ttl(key))

        try:
            value.encoding = as_text(await self.client.object("encoding", key))
        except Exception:
            # OBJECT is restricted on some managed servers, and it is a nicety
            value.encoding = None

        if kind == STRING:
            raw = await self.client.get(key)
            value.value = as_text(raw)
            value.is_text = is_text(raw)
            value.size = len(raw or b"")

        elif kind == HASH:
            value.size = await self.client.hlen(key)
            fields = await self.client.hgetall(key)
            items = list(fields.items())[:MAX_ELEMENTS]
            value.entries = [
                {"field": as_text(name), "value": as_text(item)}
                for name, item in items
            ]
            value.truncated = (value.size or 0) > len(items)

        elif kind == LIST:
            value.size = await self.client.llen(key)
            members = await self.client.lrange(key, 0, MAX_ELEMENTS - 1)
            value.members = [as_text(member) for member in members]
            value.truncated = (value.size or 0) > len(members)

        elif kind == SET:
            value.size = await self.client.scard(key)
            members: list = []
            cursor = 0
            while len(members) < MAX_ELEMENTS:
                cursor, batch = await self.client.sscan(key, cursor=cursor, count=200)
                members.extend(batch or [])
                if cursor == 0:
                    break
            value.members = [as_text(member) for member in members[:MAX_ELEMENTS]]
            value.truncated = (value.size or 0) > len(value.members)

        elif kind == ZSET:
            value.size = await self.client.zcard(key)
            scored = await self.client.zrange(key, 0, MAX_ELEMENTS - 1, withscores=True)
            value.entries = [
                {"member": as_text(member), "score": score}
                for member, score in scored
            ]
            value.truncated = (value.size or 0) > len(scored)

        elif kind == STREAM:
            value.size = await self.client.xlen(key)
            entries = await self.client.xrange(key, count=MAX_ELEMENTS)
            value.entries = [
                {
                    "id": as_text(entry_id),
                    "fields": {
                        as_text(name): as_text(item) for name, item in fields.items()
                    },
                }
                for entry_id, fields in entries
            ]
            value.truncated = (value.size or 0) > len(entries)

        return value

    async def delete(self, key: str) -> bool:
        return bool(await self.client.delete(key))

    # --------------------------------------------------------------- writes

    async def create(
        self,
        key: str,
        kind: str,
        *,
        value: Optional[str] = None,
        entries: Optional[list] = None,
        members: Optional[list] = None,
        ttl: Optional[int] = None,
        replace: bool = False,
    ) -> None:
        """Write a whole key in one go, or refuse to clobber one that exists.

        Done as a transaction watching the key, so "it did not exist when I
        looked" and "I wrote it" cannot have someone else's write between them.
        """
        import redis.asyncio as redis

        if not key:
            raise RedisError("A key needs a name.")
        if kind not in WRITABLE_TYPES:
            raise RedisError(
                f"'{kind}' is not a type a key can be created as; it is one of "
                f"{', '.join(WRITABLE_TYPES)}."
            )

        entries = entries or []
        members = [str(member) for member in (members or [])]
        _require_content(kind, value, entries, members)

        async with self.client.pipeline(transaction=True) as pipe:
            try:
                await pipe.watch(key)
                if not replace and await pipe.exists(key):
                    raise RedisError(
                        f"There is already a key called {key!r}. Open it to edit "
                        "it, or choose to replace it."
                    )
                pipe.multi()
                if replace:
                    pipe.delete(key)
                _queue_write(pipe, key, kind, value, entries, members)
                if ttl is not None and ttl > 0:
                    pipe.expire(key, int(ttl))
                await pipe.execute()
            except redis.WatchError as error:
                raise RedisError(
                    f"{key!r} changed while it was being written, so nothing was "
                    "written. Try again."
                ) from error

    async def edit(self, key: str, action: str, item: dict) -> None:
        """Change one part of a key, in the way its type allows.

        A hash field, a list position, a set member: editing one of them should
        not mean rewriting the whole key and racing whoever else touches it.
        """
        kind = as_text(await self.client.type(key)) or NONE
        if kind == NONE:
            raise RedisError(
                f"There is no key called {key!r}. It may have expired since it was "
                "opened."
            )

        handler = _EDITS.get((kind, action))
        if handler is None:
            allowed = sorted(name for (of, name) in _EDITS if of == kind)
            raise RedisError(
                f"A {TYPE_LABELS.get(kind, kind).lower()} cannot be changed with "
                f"'{action}'; it takes {', '.join(allowed)}."
            )
        await handler(self.client, key, item)

    async def expire(self, key: str, ttl: Optional[int]) -> None:
        """Set how long a key lives, or take the limit away."""
        if not await self.client.exists(key):
            raise RedisError(f"There is no key called {key!r}.")
        if ttl is None or ttl < 0:
            await self.client.persist(key)
        elif ttl == 0:
            # zero would delete it on the spot, which is a delete, not an expiry
            raise RedisError(
                "A time to live of 0 would delete the key immediately. Delete it "
                "instead, or give it at least one second."
            )
        else:
            await self.client.expire(key, int(ttl))

    async def rename(self, key: str, to: str, replace: bool = False) -> None:
        if not to:
            raise RedisError("The new name is empty.")
        if not await self.client.exists(key):
            raise RedisError(f"There is no key called {key!r}.")
        if replace:
            await self.client.rename(key, to)
        elif not await self.client.renamenx(key, to):
            raise RedisError(
                f"There is already a key called {to!r}. Choose to replace it, or "
                "pick another name."
            )

    # -------------------------------------------------------------- pub/sub

    async def channels(self, pattern: str = "*") -> list:
        """Channels with at least one subscriber, and how many.

        A channel nobody is listening to does not exist as far as Redis is
        concerned, so this is "what is being listened to right now" rather
        than every name ever published to.
        """
        names = await self.client.pubsub_channels(pattern or "*")
        if not names:
            return []

        counts = await self.client.pubsub_numsub(*names)
        return sorted(
            (
                {"channel": as_text(name), "subscribers": int(count)}
                for name, count in counts
            ),
            key=lambda item: (-item["subscribers"], item["channel"]),
        )

    async def pattern_count(self) -> int:
        """Subscriptions made with PSUBSCRIBE, which the channel list misses."""
        try:
            return int(await self.client.pubsub_numpat())
        except Exception:
            return 0

    async def publish(self, channel: str, message: str) -> int:
        """Returns how many subscribers got it, which is the useful part."""
        return int(await self.client.publish(channel, message))
