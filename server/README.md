# DataPilot server

FastAPI. [LaserORM](https://github.com/ArnabChatterjee20k/LaserORM) does the
talking to SQLite, PostgreSQL and MySQL. Redis, HTTP, WebSocket and MQTT have
their own clients, because none of them has a schema to introspect or a query to
plan.

## Setup

```bash
uv sync
uv run uvicorn main:api --reload
```

Configuration comes from `.env`, read in `api/config.py`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MODE` | `DEV` | `DEV`, `PROD`, or `TESTING` to load `.env.test` |
| `DB_PATH` | `./config.db` | SQLite file holding connections, requests and flows |
| `BUCKET_DIR` | `bucket` | where uploaded SQLite databases go |
| `MAX_ROWS` | `5000` | hard cap on rows one query may return |
| `DEFAULT_ROWS` | `100` | default page size |

## Layout

```
api/
  routes/            one module per area
    connections.py   CRUD, and dialling a connection for real
    queries.py       tables, columns, rows, running a query
    insights.py      plans, per-column statistics, exports
    slow_queries.py  what the server itself recorded, and snapshots of it
    requests.py      the HTTP client, the WebSocket proxy, the MQTT proxy
    redis.py         keyspace, dashboard, pub/sub
    flows.py         storing a node graph and running it
  sql.py             statement classification and risk
  storage.py         opening a session, and turning adapter errors into HTTP ones
  http_client.py     sending a request on the user's behalf
  mqtt_client.py     one broker session, built on paho
  redis_client.py    one Redis session
  flows.py           graph reading, ordering, reference resolution
  flow_runner.py     running the graph, reporting each node as it goes
```

## Safety

`api/sql.py` classifies every statement before it runs: the statement type,
whether it is read-only, and a `safe`, `caution` or `dangerous` level with the
reason. An `UPDATE` or `DELETE` with no `WHERE`, a `DROP`, several statements at
once, and a large `OFFSET` all raise the level.

Connections are read-only by default. The server answers a writing query against
one with a 403 unless the caller passes `allow_writes=true`.

A flow runs unattended once started, so it refuses a dangerous statement
outright. Nothing is there to confirm it.

## Errors

`api/storage.py` and `api/http_client.py` turn driver exceptions into messages
worth showing a person. Whether the host was wrong, the port was closed, TLS
failed, or it took too long are four problems with four different fixes, so they
read as four messages.

A refused address on `localhost`, `127.0.0.1` or `::1` carries one extra line:
inside a container `localhost` is the container, which is the most common reason
a database that is plainly running looks unreachable. `http_client.container_hint`
adds it once, wherever the error surfaced.

## Running in Docker

The image is built from the repository root, not from here. `uvicorn` runs as
the unprivileged `datapilot` user; `docker-entrypoint.sh` runs first as root to
fix the ownership of the mounted data directory, because a volume hides what the
build did to it and carries the host's ownership instead.

## Tests

```bash
MODE=TESTING uv run pytest
```

PostgreSQL, MySQL and Redis tests skip themselves when no server is reachable.
Point them at one with `TEST_POSTGRES_*` or `TEST_MYSQL_*` (`HOST`, `PORT`,
`USER`, `PASSWORD`, `DB`), or `TEST_REDIS_HOST` and `TEST_REDIS_PORT`.

The API client tests run a real HTTP server, a real WebSocket server and a real
MQTT broker in process. The point of those clients is acknowledgements and
ordering, and a stub would have to decide those itself.

## Regenerating the console SDK

The console's SDK comes from this server's OpenAPI schema. Dump it, then
generate:

```bash
MODE=TESTING uv run python -c "import json; from main import api; open('../console/openapi.json','w').write(json.dumps(api.openapi(), indent=2))"
cd ../console && pnpm generate:sdk
```

Pass `throwOnError: true` to SDK calls that should raise. Leave it off where the
status code matters, since throwing discards it.

## Endpoints

`/docs` has the interactive version. The root README lists them in a table.
