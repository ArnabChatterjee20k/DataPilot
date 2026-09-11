"""A real Redis, seeded with one key of every type.

Every type is here because the point of the browser is showing each of them as
what it is - a hash rendered as a string is unreadable, and a sorted set
without its scores is not a sorted set.
"""

import os

import pytest


def redis_url() -> str:
    host = os.getenv("TEST_REDIS_HOST", "127.0.0.1")
    port = os.getenv("TEST_REDIS_PORT", "56379")
    return f"redis://{host}:{port}/0"


@pytest.fixture(scope="function")
def redis_connection_uri():
    """Seed a database and yield its URL, skipping if there is no server."""
    import redis as sync_redis

    url = redis_url()
    try:
        client = sync_redis.Redis.from_url(url, socket_connect_timeout=3)
        client.ping()
    except Exception as error:
        pytest.skip(f"Redis not available: {error}")

    client.flushdb()

    client.set("greeting", "hello")
    client.set("counter", 41)
    client.setex("temporary", 600, "expires soon")
    client.set("binary", b"\xff\xfe\x00")

    client.hset("user:7", mapping={"name": "Ada", "email": "ada@example.com"})
    client.rpush("queue:jobs", "first", "second", "third")
    client.sadd("tags", "alpha", "beta", "gamma")
    client.zadd("leaderboard", {"ada": 120.5, "bob": 99, "carol": 150})
    client.xadd("events", {"kind": "signup", "user": "7"})
    client.xadd("events", {"kind": "login", "user": "7"})

    client.close()
    yield url

    try:
        client = sync_redis.Redis.from_url(url, socket_connect_timeout=3)
        client.flushdb()
        client.close()
    except Exception:
        pass


@pytest.fixture()
def redis_connection(client, redis_connection_uri):
    response = client.post(
        "/connections",
        json={
            "source": "redis",
            "name": "Cache",
            "connection_uri": redis_connection_uri,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()
