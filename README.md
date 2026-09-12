<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/graph.svg?title=DataPilot&subtitle=Browse+your+databases,+call+your+APIs,+join+them+in+a+flow&mode=dark" />
    <img alt="DataPilot" src="https://shieldcn.dev/header/graph.svg?title=DataPilot&subtitle=Browse+your+databases,+call+your+APIs,+join+them+in+a+flow&mode=light" />
  </picture>
</p>

<p align="center">
  <a href="https://github.com/ArnabChatterjee20k/DataPilot/stargazers"><img alt="Stars" src="https://shieldcn.dev/github/stars/ArnabChatterjee20k/DataPilot.svg?variant=secondary" /></a>
  <a href="https://github.com/ArnabChatterjee20k/DataPilot/commits"><img alt="Last commit" src="https://shieldcn.dev/github/last-commit/ArnabChatterjee20k/DataPilot.svg?variant=secondary" /></a>
  <img alt="Python 3.12" src="https://shieldcn.dev/badge/python-3.12-blue.svg?variant=secondary&logo=python" />
  <img alt="React 19" src="https://shieldcn.dev/badge/react-19-blue.svg?variant=secondary&logo=react" />
  <img alt="Docker ready" src="https://shieldcn.dev/badge/docker-ready-blue.svg?variant=secondary&logo=docker" />
</p>

A console for the things an application talks to. Databases, HTTP APIs,
WebSocket endpoints, MQTT brokers and Redis all open in tabs next to each other,
so you can read a table, send the request that changed it, and watch the message
it published without switching tools.

Flows join them up. Feed a query's rows into a request, run the chain once, and
watch each node report what it produced.

The server holds every connection. The browser never opens a socket to your
database or sends your API credentials. That is what makes a browser-based
client workable at all. CORS blocks a page from calling an arbitrary origin, and
anything the page sent would be readable in its own devtools.

## What it connects to

| Kind | URL | What you get |
| --- | --- | --- |
| PostgreSQL | `postgresql://user:pass@host:5432/db` | tables, schemas, queries, plans, statistics |
| MySQL | `mysql://user:pass@host:3306/db` | the same |
| SQLite | an uploaded `.db` file | the same, minus schemas |
| HTTP API | `https://api.example.com` | saved requests, history, variables |
| WebSocket | `ws://` or `wss://` | a two-way message log |
| MQTT | `mqtt://` or `mqtts://` | subscribe, publish, QoS, retain, MQTT 5 properties |
| Redis | `redis://` or `rediss://` | keys by type, a server dashboard, pub/sub |

DataPilot dials every connection when you save it, and again when the sidebar
lists it, so you find a typo where you made it. A green or red dot sits next to
each one, and opening a connection that does not answer shows why.

## Running it

### Docker

```bash
docker compose up -d
```

The server serves both the console and the API on `http://localhost:8000`. It
writes connections and uploaded SQLite files to `./data`, which the container
mounts from the host. The server process runs as an unprivileged user, and the
entrypoint fixes the mounted directory's ownership first, so an install that
predates that change keeps working.

Inside the container, `localhost` is the container. To reach a database on your
machine, use `host.docker.internal`. To reach a sibling container, put DataPilot
on its network and use the container name:

```bash
docker network connect my-project_default datapilot
```

### From source

It runs as two processes. Start the server:

```bash
cd server
uv sync
uv run uvicorn main:api --reload
```

The console:

```bash
cd console
pnpm install
pnpm dev
```

The console runs on `http://localhost:5173` and expects the server on port 8000.
Point it elsewhere with `VITE_API_URL`.

## Reading data

A table opens with its rows, and with the parts of the schema you need to read
them. Column headers carry the type, the primary key, and whether the column is
indexed. Timestamps render as `3h ago`, low-cardinality columns render as
coloured pills, and the grid masks a column whose name looks like a credential
until you click it.

Clicking a cell filters by that value. Filters stack as breadcrumbs and clear in
one click. DataPilot remembers hidden columns, sort and filters per table, and
you can save a set of them as a named view.

Select two rows to compare them field by field, including inside JSON. The grid
marks rows added or changed since the last load.

## Running queries

The query tab runs against the connection you pick, which DataPilot preselects
when there is an obvious one. The server classifies every statement before it
runs: the statement type, whether it writes, and a `safe`, `caution` or
`dangerous` level with the reason. A `DELETE` with no `WHERE` and a `DROP` are
both dangerous. A large `OFFSET` is a caution.

**Connections are read-only until you say otherwise.** The server answers a
writing query against a read-only connection with a 403 rather than running it.

The **Plan** panel shows what the planner intends to do without running the
query: sequential scan against index scan, the index it picked, estimated rows,
and a warning when a filter has no index behind it. The **Stats** panel reports
per-column null counts, distinct counts and top values for a table.

Results export as CSV, JSON or NDJSON, honouring the filters and the visible
columns rather than dumping the table.

## Slow queries

Timing the queries DataPilot happens to run tells you about DataPilot. The
**Slow queries** tab reads what the server itself recorded: `pg_stat_statements`
on PostgreSQL, `performance_schema.events_statements_summary_by_digest` on
MySQL. That covers the application's traffic.

Each statement comes with its call count, total and mean time, rows per call,
and on MySQL the rows examined. The gap between rows examined and rows returned
is what finds a missing index.

The counters only ever go up, and a restart clears them, so the absolute numbers
cover everything since the last reset. **Snapshot** stores a reading. You can
then compare that reading against now, or against a second one, and the
comparison reports the difference, which is what ran in that window.

Where the source is not enabled, the tab says which of the two PostgreSQL
problems you have. `CREATE EXTENSION` fixes an extension that was never created.
`shared_preload_libraries` and a restart fix one that was created but never
loaded. SQLite has no such view and says so rather than showing an empty table.

## The API client

An API connection holds a base URL, default headers, auth and variables. A saved
request lives under it the way a table lives under a database.

Paste a `curl` command into the URL field and it becomes the request. The parser
reads the flags that describe the request and drops the ones that describe curl,
saying which it dropped:

| Flag | Becomes |
| --- | --- |
| `-X`, `--request` | the method |
| `-H`, `--header` | header rows |
| `-d`, `--data*`, `--json` | a JSON, form or text body |
| `-F`, `--form` | form rows |
| `-u`, `--user` | basic auth |
| `-G` | data moved into the query string |
| `-I` | `HEAD` |

An `Authorization: Bearer` header becomes the auth block, where the request
preview masks the token. The query string becomes rows you can switch off one at
a time, and the URL above them always shows where the request will actually go.

An absolute URL overrides the connection's base. A request needs no connection
at all: `POST /request` takes a full URL, so trying one endpoint does not mean
inventing a connection for it.

You write variables as `{{name}}` in the URL, headers and body. DataPilot stores
a value whose name looks like a secret whole and shows it masked. It keeps the
last 50 runs per connection, and you can load any of them back into the tab,
including the ones that failed.

### WebSocket

The server holds the upstream socket and relays frames both ways. The tab reads
`connecting` until the upstream is actually up, because the browser's socket to
DataPilot opens first and would otherwise look like success. A failed handshake
shows a reason rather than a bare close code.

### MQTT

MQTT 5 by default, falling back to 3.1.1 for a broker that refuses it. Subscribe
to topic filters with wildcards, publish with QoS and retain, unsubscribe, and
watch messages arrive with their topic, QoS and retain flag.

The tab reports nothing as subscribed until the broker acknowledges it. A
publish issued after an unacknowledged subscribe races ahead of the broker
registering it, and MQTT drops the message with no error anywhere.

Each session gets its own client id, because a broker evicts the existing
session when a second one arrives with the same id, and two tabs sharing an id
kick each other off in a loop.

The **Broker** panel holds the protocol version, credentials, enhanced
authentication (a named method and its data, which is how a broker takes a JWT
instead of a password), user properties sent on connect, a fixed client id, and
TLS verification. All of it goes into the connection's variables, which masks
the credentials. Per-message user properties, content type and reply topic sit
next to the topic field.

## Redis

Redis has no tables to introspect and no query to plan, so it does not go
through the ORM.

The key browser pages through the keyspace with a cursored `SCAN`, never `KEYS
*`, which walks the whole keyspace in one blocking command. Each type gets its
own view: a hash as fields, a list in order with its indexes, a sorted set with
its scores in score order, a stream as entries with their fields. Every key
carries its TTL, size and encoding, and `-1` reads as "no expiry" rather than as
expired.

The **Dashboard** reports version, uptime, clients, memory with its peak and
limit, eviction policy and count, commands per second, replication role, and the
key count per database. The keyspace hit rate gets its own card.

The **Pub/Sub** panel lists the channels being listened to right now. Redis
keeps no registry of channel names, so a channel appears only while something is
listening to it. Subscribe to channels or patterns and messages arrive with the
channel they came in on and the pattern that matched. Publishing reports how
many subscribers received it, and zero is the answer that explains why nothing
happened.

## Flows

A flow connects a query to a request. Drop a database node and an API node on a
canvas, join them, and run the chain once.

A downstream node reads what an upstream one produced:

| Written | Gives |
| --- | --- |
| `{{Users.first.id}}` | a field of the first row |
| `{{Users.rows.2.name}}` | a field of any row |
| `{{Users.row_count}}` | how many came back |
| `{{Ping.json.token}}` | a field of a JSON response |
| `{{Ping.status}}` | the status code |

A name with a space in it is written with an underscore, so a node called
`Get users` is `{{Get_users.first.id}}`.

**Test this node** in the setup panel runs one node and whatever feeds it,
leaving the branches beside it alone. It reports what the node was actually
sent once the references were replaced, and what came back, followed by a table
of every reference the next node can write against this one with the value each
holds right now:

| You write | You get |
| --- | --- |
| `{{Parts.first.id}}` | `1` |
| `{{Parts.first.name}}` | `bolt` |
| `{{Parts.rows.1.id}}` | `2` |
| `{{Parts.row_count}}` | `2` |

Each line copies. Working out the output shape, the node name and how the two
combine is the slow part of wiring a flow, and this hands over the answer
instead.

Nodes run as soon as their own dependencies finish, so two branches off one node
run at the same time. Each node shows its state on the canvas as it goes, with
the row or status count and the timing, and the whole result is one click away.

A node that fails names what failed. DataPilot marks the nodes after it
**skipped, waiting on it** rather than failed, because they never ran, and
calling both the same thing hides which one to go and fix. A `{{...}}` that
points at nothing is a warning on the node that used it, and the reference is
left in the request as written so the call that went out is visibly wrong
instead of silently sending nothing.

This is composition, not automation. There is no schedule, no retry and no
alerting. A flow runs unattended once started, so DataPilot refuses a
destructive statement rather than asking you to confirm it.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MODE` | `DEV` | `DEV`, `PROD`, or `TESTING` to load `.env.test` |
| `DB_PATH` | `./config.db` | SQLite file holding connections, requests and flows |
| `BUCKET_DIR` | `bucket` | where uploaded SQLite databases go |
| `MAX_ROWS` | `5000` | hard cap on rows one query may return |
| `DEFAULT_ROWS` | `100` | default page size |
| `PORT` | `8000` | the port compose publishes |

## Development

```
server/          FastAPI, on LaserORM for the SQL adapters
  api/
    routes/      one module per area
    sql.py       statement classification and risk
    insights.py  query plans, normalised across backends
    http_client.py, mqtt_client.py, redis_client.py
    flows.py, flow_runner.py
  tests/
console/         React, Vite, Tailwind, TanStack Query, Zustand
  src/lib/sdk/   generated from the server's OpenAPI schema
  e2e/           Playwright, against real servers
scripts/
  check_image_size.py
```

### Tests

```bash
cd server && MODE=TESTING uv run pytest
cd console && pnpm e2e
```

The Playwright suite starts a real server and a real Vite, seeds a SQLite
database, and runs an HTTP server, a WebSocket server and an MQTT broker in
process. Tests that need PostgreSQL, MySQL or Redis skip themselves when none is
reachable. Point them at one with `TEST_POSTGRES_*`, `TEST_MYSQL_*` (`HOST`,
`PORT`, `USER`, `PASSWORD`, `DB`) or `TEST_REDIS_URL`.

`console/e2e/visual.spec.ts` is not a gate. It writes screenshots of the main
states to `test-results/` for a person to look at.

### Regenerating the SDK

`openapi-ts` generates `console/src/lib/sdk` from the server's schema. Dump the
schema, then generate:

```bash
cd server
MODE=TESTING uv run python -c "import json; from main import api; open('../console/openapi.json','w').write(json.dumps(api.openapi(), indent=2))"
cd ../console && pnpm generate:sdk
```

`src/lib/sdk-runtime.ts` supplies the base URL and survives regeneration.

### Image size

The image was 718MB and is a little over 300MB now. Most of that saving came
from things that arrived without anyone noticing, so there is a budget:

```bash
python scripts/check_image_size.py --build
```

It fails above 400MB and names the heaviest build steps. Raise the budget only
once you know which step grew and why it is worth it.

## API

Interactive docs are at `/docs`, and the schema at `/openapi.json`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET POST PUT DELETE` | `/connections` | manage connections |
| `POST` | `/connections/test` | dial a connection before saving it |
| `GET` | `/connections/{uid}/status` | dial a saved one, with latency and version |
| `POST` | `/bucket` | upload a SQLite database |
| `GET` | `/connection/{id}/table` | list tables |
| `GET` | `/connection/{id}/schema` | list schemas, on PostgreSQL |
| `GET` | `/connection/{id}/entities/{name}/columns` | types, primary key, indexes, row count |
| `GET` | `/connection/{id}/entities/{name}/rows` | a page of rows, keyset paginated |
| `GET` | `/connection/{id}/entities/{name}/queries` | run a query, with risk and timing |
| `GET` | `/connection/{id}/entities/{name}/explain` | the plan, without running it |
| `GET` | `/connection/{id}/entities/{name}/stats` | per-column nulls, cardinality, top values |
| `GET` | `/connection/{id}/entities/{name}/export` | CSV, JSON or NDJSON |
| `GET` | `/connection/{id}/slow-queries` | what the server recorded as slow |
| `GET POST DELETE` | `/connection/{id}/slow-queries/snapshots` | store and read readings |
| `GET` | `/connection/{id}/slow-queries/compare` | the difference between two |
| `POST` | `/connection/{id}/request` | send a saved request |
| `POST` | `/request` | send one that belongs to no connection |
| `GET POST PUT DELETE` | `/connection/{id}/requests` | manage saved requests |
| `GET PUT` | `/connection/{id}/variables` | connection variables, secrets masked |
| `WS` | `/connection/{id}/socket` | the WebSocket proxy |
| `WS` | `/connection/{id}/mqtt` | the MQTT proxy |
| `GET DELETE` | `/connection/{id}/redis/keys` | scan and delete keys |
| `GET` | `/connection/{id}/redis/keys/value` | one key, shaped by its type |
| `GET` | `/connection/{id}/redis/info` | the dashboard numbers |
| `GET` | `/connection/{id}/redis/channels` | channels with a subscriber |
| `POST` | `/connection/{id}/redis/publish` | publish, with the subscriber count |
| `WS` | `/connection/{id}/redis/subscribe` | watch messages arrive |
| `GET POST PUT DELETE` | `/flows` | manage flows |
| `WS` | `/flows/{uid}/run` | run one, reporting each node as it goes |
| `POST` | `/flows/{uid}/nodes/{id}/test` | run one node and what feeds it |

## Built on

[LaserORM](https://github.com/ArnabChatterjee20k/LaserORM) does the talking to
SQLite, PostgreSQL and MySQL.
