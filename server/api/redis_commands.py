"""Running a Redis command someone typed, and deciding whether it may run.

The browser is a place people poke at a live cache, so the rule is simple and
errs one way: a command is only treated as a read if it is known to be one.
Anything unrecognised - a module command, a typo, something added to Redis
next year - counts as a write, which a read-only connection refuses.
"""

from __future__ import annotations

import shlex
from dataclasses import dataclass
from typing import Any, Optional

#: Commands that only read. Everything else is treated as a write.
READS = frozenset(
    """
    GET MGET GETRANGE STRLEN GETBIT BITCOUNT BITPOS
    HGET HMGET HGETALL HKEYS HVALS HLEN HEXISTS HSTRLEN HSCAN HRANDFIELD
    LRANGE LLEN LINDEX LPOS
    SMEMBERS SCARD SISMEMBER SMISMEMBER SSCAN SRANDMEMBER SINTER SUNION SDIFF
    ZRANGE ZRANGEBYSCORE ZRANGEBYLEX ZREVRANGE ZREVRANGEBYSCORE ZREVRANGEBYLEX
    ZSCORE ZMSCORE ZCARD ZCOUNT ZLEXCOUNT ZRANK ZREVRANK ZSCAN ZRANDMEMBER
    XRANGE XREVRANGE XLEN XINFO XPENDING XREAD
    PFCOUNT GEOPOS GEODIST GEOHASH GEOSEARCH GEORADIUS_RO GEORADIUSBYMEMBER_RO
    TYPE TTL PTTL EXPIRETIME PEXPIRETIME EXISTS SCAN KEYS RANDOMKEY DUMP
    OBJECT MEMORY DBSIZE INFO PING ECHO TIME LASTSAVE ROLE COMMAND
    PUBSUB SLOWLOG LATENCY LOLWUT
    """.split()
)

#: Subcommands that make an otherwise read-only command write, or the reverse.
SUBCOMMANDS = {
    "CONFIG": {"GET": "read"},
    "CLIENT": {"LIST": "read", "INFO": "read", "GETNAME": "read", "ID": "read"},
    "SCRIPT": {"EXISTS": "read"},
    "FUNCTION": {"LIST": "read", "STATS": "read", "DUMP": "read"},
    "ACL": {"WHOAMI": "read", "LIST": "read", "USERS": "read", "CAT": "read"},
    "CLUSTER": {"INFO": "read", "NODES": "read", "SLOTS": "read", "SHARDS": "read"},
    "MEMORY": {"USAGE": "read", "STATS": "read", "DOCTOR": "read"},
}

#: Refused here whatever the connection allows, each with where to go instead.
REFUSED = {
    "SUBSCRIBE": "it holds the connection open for messages. Use the Pub/Sub panel.",
    "PSUBSCRIBE": "it holds the connection open for messages. Use the Pub/Sub panel.",
    "SSUBSCRIBE": "it holds the connection open for messages. Use the Pub/Sub panel.",
    "MONITOR": "it streams every command the server runs and never returns.",
    "SYNC": "it turns this connection into a replica.",
    "PSYNC": "it turns this connection into a replica.",
    "SHUTDOWN": "it stops the server.",
    "DEBUG": "it can crash or stall the server.",
    "REPLICAOF": "it changes what the server replicates from.",
    "SLAVEOF": "it changes what the server replicates from.",
    "FAILOVER": "it changes which server is the primary.",
    "MODULE": "it loads code into the server.",
    "SWAPDB": "it swaps whole databases under every client connected to them.",
    "BGREWRITEAOF": "it rewrites the server's persistence files.",
    "BLPOP": "it blocks until something arrives, which may be never.",
    "BRPOP": "it blocks until something arrives, which may be never.",
    "BLMOVE": "it blocks until something arrives, which may be never.",
    "BZPOPMIN": "it blocks until something arrives, which may be never.",
    "BZPOPMAX": "it blocks until something arrives, which may be never.",
    "WAIT": "it blocks until replicas catch up.",
}

#: Writes that empty a whole database, so they need saying twice.
WIPES = frozenset({"FLUSHDB", "FLUSHALL"})

#: A read that is still worth a word before it runs.
WARNINGS = {
    "KEYS": (
        "KEYS walks the whole keyspace in one blocking command. On a large "
        "server that stalls every other client; SCAN pages through it instead."
    ),
}


class CommandError(Exception):
    """Something about the command itself, phrased for whoever typed it."""


@dataclass
class Command:
    parts: list[str]
    name: str
    writes: bool
    wipes: bool
    warning: str = ""


def parse(text: str) -> Command:
    """Split a command the way redis-cli would, quotes and all."""
    try:
        parts = shlex.split(text or "", posix=True)
    except ValueError as error:
        raise CommandError(f"That command has an unclosed quote: {error}.") from error
    if not parts:
        raise CommandError("There is no command to run.")

    name = parts[0].upper()
    if name in REFUSED:
        raise CommandError(f"{name} is not run from here, because {REFUSED[name]}")

    sub = parts[1].upper() if len(parts) > 1 else ""
    if name in SUBCOMMANDS:
        writes = SUBCOMMANDS[name].get(sub) != "read"
    else:
        writes = name not in READS

    return Command(
        parts=parts,
        name=name,
        writes=writes,
        wipes=name in WIPES,
        warning=WARNINGS.get(name, ""),
    )


def render(reply: Any, name: str = "") -> Any:
    """A reply in a shape JSON can carry: text for bytes, lists stay lists.

    redis-py turns a status reply into `True`, so `PING` would read as
    `(integer) true`; redis-cli says PONG, and OK for everything else.
    """
    from .redis_client import as_text

    if reply is True:
        return "PONG" if name == "PING" else "OK"
    if isinstance(reply, (bytes, bytearray, memoryview)):
        return as_text(bytes(reply))
    if isinstance(reply, dict):
        return {str(render(name)): render(item) for name, item in reply.items()}
    if isinstance(reply, (list, tuple, set)):
        return [render(item) for item in reply]
    return reply


def kind_of(reply: Any) -> str:
    """What redis-cli would label the reply, which is how people read one."""
    if reply is None:
        return "nil"
    if isinstance(reply, bool):
        return "integer"
    if isinstance(reply, int):
        return "integer"
    if isinstance(reply, float):
        return "double"
    if isinstance(reply, dict):
        return "map"
    if isinstance(reply, list):
        return "array"
    return "string"
