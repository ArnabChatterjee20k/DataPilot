# DataPilot server

FastAPI over [LaserORM](https://github.com/ArnabChatterjee20k/LaserORM), which does
the talking to SQLite and PostgreSQL.

## Setup

```bash
uv sync
uv run uvicorn main:api --reload
```

Configuration comes from `.env` (see `api/config.py`):

| variable | meaning |
| --- | --- |
| `MODE` | `DEV`, `PROD` or `TESTING` (loads `.env.test`) |
| `DB_PATH` | SQLite file holding connections and buckets |
| `BUCKET_DIR` | where uploaded SQLite databases are stored |
| `MAX_ROWS` | hard cap on rows a single query may return |
| `DEFAULT_ROWS` | default page size |

## Tests

```bash
MODE=TESTING uv run pytest
```

PostgreSQL tests skip themselves when no server is reachable. Point them at one with
`TEST_POSTGRES_HOST` / `TEST_POSTGRES_PORT` / `TEST_POSTGRES_USER` /
`TEST_POSTGRES_PASSWORD` / `TEST_POSTGRES_DB`.

## Regenerating the console SDK

The console's SDK is generated from this server's OpenAPI schema. Dump it, then
generate:

```bash
uv run python -c "import json; from main import api; open('../console/openapi.json','w').write(json.dumps(api.openapi(), indent=2))"
cd ../console && pnpm generate:sdk
```

Pass `throwOnError: true` to SDK calls that should raise rather than return an error.

## Endpoints

| method | path | purpose |
| --- | --- | --- |
| `GET/POST/PUT/DELETE` | `/connections` | manage connections |
| `GET` | `/connections/{uid}/status` | dial a connection, report latency and version |
| `POST` | `/bucket` | upload a SQLite database |
| `GET` | `/connection/{id}/schema` | list schemas (PostgreSQL) |
| `GET` | `/connection/{id}/table` | list tables |
| `GET` | `/connection/{id}/entities/{name}/columns` | column types, PK, indexes, row count |
| `GET` | `/connection/{id}/entities/{name}/rows` | a page of rows, keyset paginated |
| `GET` | `/connection/{id}/entities/{name}/queries` | run a query, with risk and timing |
| `GET` | `/connection/{id}/entities/{name}/explain` | query plan, without running it |
| `GET` | `/connection/{id}/entities/{name}/stats` | per-column nulls, cardinality, top values |
| `GET` | `/connection/{id}/entities/{name}/export` | CSV / JSON / NDJSON export |

### Safety

Every query is classified before it runs (`api/sql.py`): statement type, whether it
is read-only, and a `safe` / `caution` / `dangerous` level with warnings — an
`UPDATE` or `DELETE` without a `WHERE`, a `DROP`, several statements at once, or a
large `OFFSET`.

Connections are read-only by default. A writing query against one is rejected with
403 unless the caller passes `allow_writes=true`.
