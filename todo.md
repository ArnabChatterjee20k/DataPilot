# DataPilot – Feature Roadmap
---

## 🥇 PRIORITY 1 — CORE EXPERIENCE (Non-Negotiable)

### Frontend
- [x] **Instant Scanability**
  - [x] Auto column width + manual resize
  - [x] Truncate long text with expand-on-click
  - [x] Sticky headers & first column
  - [x] Clear row hover state
  - [x] Visual distinction for `null`, empty, default values

- [x] **Column Type Awareness (Visible)**
  - [x] Show inferred DB type under column name
  - [x] Types: uuid, text, number, boolean, timestamp, json
  - [x] Monospace for IDs & hashes

- [x] **Zero-Friction Filtering**
  - [x] Click cell → filter by value
  - [x] Breadcrumb-style filter stack
  - [x] Clear all filters in one click
  - [x] AND-only logic (explicit, visual)

- [x] **Empty & Loading States**
  - [x] Skeleton loaders (never blank screens)
  - [x] Clear “0 rows returned” message
  - [x] Query success indicator + execution time

- [x] **Safe-by-Default UX**
  - [x] Read-only mode by default
  - [x] Environment badge (PROD / STAGING / LOCAL)
  - [x] Mask sensitive fields (passwords, tokens)

---

### Backend
- [x] **Schema Introspection**
  - [x] Column type
  - [x] Nullable / default
  - [x] Primary key detection
  - [x] Index detection

- [x] **Unsafe Query Detection**
  - [x] Detect UPDATE / DELETE / DROP
  - [x] Detect missing WHERE clause
  - [x] Expose risk level to frontend

- [x] **Deterministic Pagination**
  - [x] Prefer cursor-based pagination when PK exists
  - [x] Warn on large OFFSET usage
  - [x] Stable ordering guarantees

- [x] **Connection Metadata**
  - [x] Connection name
  - [x] Role (primary / replica)
  - [x] Environment tag

---

## 🥈 PRIORITY 2 — DIFFERENTIATORS (Why DataPilot Wins)
> These make users prefer DataPilot over Adminer / Compass / Supabase UI.

### Frontend
- [x] **Row Expand Panel**
  - [x] Full JSON view
  - [x] Copy full row
  - [x] Field-level inspection

- [x] **Row Compare / Diff View**
  - [x] Select 2 rows → diff
  - [x] Highlight changed fields
  - [x] JSON diff support

- [x] **Smart Defaults**
  - [x] Auto-sort by `updated_at`
  - [x] Relative timestamps (`3h ago`)
  - [x] Enum detection → colored pills

- [x] **Column Controls**
  - [x] Hide / show columns
  - [x] Reorder columns
  - [x] Column-specific filter menu

- [x] **Copyability Everywhere**
  - [x] Copy cell
  - [x] Copy row
  - [x] Copy row as JSON
  - [x] Copy primary key

---

### Backend
- [x] **Index Awareness API**
  - [x] Mark indexed vs non-indexed columns
  - [x] Warn on slow filters

- [x] **Explain-Lite Query Insights**
  - [x] Seq scan vs index scan
  - [x] Estimated rows
  - [x] Time category (fast / medium / slow)

- [x] **Sensitive Field Classification**
  - [x] Backend marks fields as sensitive
  - [x] Frontend masks automatically

- [x] **Backend-Aware Export**
  - [x] Respect UUIDs, ObjectIds, timestamps
  - [x] Export filtered + visible columns only

---

## 🥉 PRIORITY 3 — POWER USER FEATURES (Optional, Non-Bloated)
> Add only if they don’t compromise simplicity.

### Frontend
- [x] **Keyboard-First Navigation**
  - [x] `/` → search
  - [x] `⌘K` → command palette
  - [x] Arrow navigation
  - [x] `Enter` → expand row

- [x] **One-Glance Stats Panel**
  - [x] Row count
  - [x] % nulls per column
  - [x] Top values per column

- [x] **View Personalization**
  - [x] Remember hidden columns
  - [x] Remember sort & filters
  - [x] Remember last table

---

### Backend
- [ ] **Schema Drift Detection (Mongo-first)**
  - Fields present in some docs only
  - Type mismatches
  - _Blocked: there is no Mongo adapter yet. SQLite and PostgreSQL both have a
    fixed schema, so there is nothing to detect until one exists._

- [x] **Change Awareness (Lightweight)**
  - [x] Highlight recently updated rows
  - [x] `updated_at` based signals
  - [x] Rows added or changed since the last load are marked too

---

## ❌ OUT OF SCOPE (Do NOT Build)
> These dilute the product and create maintenance debt.

- Dashboards & charts
- Workflow automation
- Migration generators
- Full query builders
- Heavy auth / role systems
- “Chat with data” AI (for now)

---

## 🧭 NORTH STAR PRINCIPLES
- Clarity > Power
- Safety > Flexibility
- Defaults > Configuration
- Backend reality > UI cleverness

If a feature doesn’t reduce cognitive load, it doesn’t ship.

---

## ✅ DEFINITION OF “BEST TOOL”
Users should say:
> “I understand my data faster and trust this UI in production.”

That’s the bar.

---

## 🚧 IN FLIGHT

Raised while using the console. Ordered by how much they hurt.

### Connection confidence — *know at the first click whether it works*
- [x] `POST /connections/test` — dial before saving, so a typo is caught here
      rather than at the first query
- [x] **Test connection** button in the modal, with latency and server version
- [x] API connections are dialled for real (HTTP GET, or a websocket handshake)
      instead of answering "dialled per request"
- [x] A refused *local* address hints at the container case — inside a
      container `localhost` is the container itself
- [x] WebSocket failures surface as a banner, not a line in the log
- [x] The proxy reports **upstream** readiness, so "connected" stops meaning
      "reached DataPilot"
- [x] Same treatment for the query path: a connection that has gone away says
      so before the query does, and the sidebar dials every connection as it
      lists them so the answer is on screen before anything is run

### Requests
- [x] **Paste a curl command** into the request box and have it parsed into
      method, URL, headers, body and auth
- [x] **Arbitrary URLs** — the builder shows where the request will actually
      go, and `POST /request` sends one with no connection at all
- [x] Request **history** — past runs, replayable, including the ones that
      failed
- [x] A **variables** editor in the console, which also fixed the round trip:
      reading gave masks and writing took them literally, so saving would have
      replaced each secret with its own mask

### Errors
- [x] Audit every failure path end to end and make sure the message says what
      happened and what to do — no raw driver text reaching the screen.
      Transport failures, driver failures and OS wordings all normalised; the
      container hint lives in one place and is no longer applied twice

### UX audit
- [x] Drive every feature in the browser looking specifically for things that
      break the experience, not just things that throw
- [x] Audit the *flows* rather than the screens — the path from opening the app
      to having an answer, for each of: browse a table, run a query, send a
      request, watch a socket. Count the clicks and the dead ends

  What it found, all fixed:
  - With nothing connected, the first screen offered "New query", a button
    that could only fail, and buried "Add a connection" in the sidebar
  - A new query tab landed on "Select a connection" with one connection in
    the sidebar — a click with one possible answer
  - The query connection picker offered API connections, which cannot answer
    a query
  - The whole result toolbar — reload, export, paging, columns — was live
    before anything had run
  - **Stats** on a query tab led to a panel saying to open a table
  - A disabled search box explained itself instead of getting out of the way
  - Cell hover actions covered the value: a `suspended` pill read as
    `suspen` with no ellipsis to say it had been cut
  - The connection dialog was headed "Database" while offering
    HTTP / WebSocket

### MQTT
A third protocol alongside HTTP and WebSocket, under the same API connection
kind. Reference: [mqtt-appwrite-testing](https://github.com/ArnabChatterjee20k/mqtt-appwrite-testing/blob/master/appwrite_mqtt/mqtt.py).

- [x] **Broker connection** — `mqtt://` / `mqtts://` base URL, username and
      password or a token, TLS on by default for 8883
- [x] **Subscribe** to one or more topic filters, with wildcards, and watch
      messages arrive with their topic, QoS and retain flag
- [x] **Publish** to a topic, with QoS and retain
- [x] Unsubscribe, and disconnect cleanly

Both things the reference gets right are copied:

- [x] **Wait for SUBACK before reporting "subscribed".** A publish issued
  straight after a subscribe otherwise races ahead of the broker registering it
  and the message is simply dropped — MQTT has no retained replay for that
  case. This is the same failure as reporting a websocket "connected" before
  the upstream is up.
- [x] **A unique client id per connection.** Brokers evict an existing session
  when a new one connects with the same id, so a shared id makes two tabs kick
  each other off.

Also found while building it: `paho` is used directly rather than through an
asyncio wrapper, because the wrappers register the socket with the event loop
and Windows' default (proactor) loop cannot do that at all.

**MQTT 5**, since user properties and enhanced authentication exist nowhere else:

- [x] **Protocol 5 by default**, with an automatic retry on 3.1.1 for a broker
      that refuses it, and the version shown once connected
- [x] **Enhanced authentication** — a named method and its data, which is how a
      broker takes a JWT or a session secret rather than a password
- [x] **User properties** on connect, subscribe, unsubscribe and publish
- [x] **Content type, reply topic and correlation data** on a publish, and all
      of an incoming message's metadata shown in the log
- [x] TLS verification can be turned off, for a gateway behind a private CA
- [x] A fixed client id, for a broker that requires one
- [x] A QoS 1 delivery is acknowledged once the browser has it, not the moment
      it arrives - the PUBACK is what tells the broker to stop replaying

### Slow queries — *from the database's own performance schema*
- [x] Read the slow statements the server already tracks, rather than timing
      queries DataPilot happened to run: `pg_stat_statements` on PostgreSQL,
      `performance_schema.events_statements_summary_by_digest` on MySQL. Both
      keep a normalised digest, total and mean time, calls and rows
- [x] Say what to do when the source is not there — and tell the two
      PostgreSQL cases apart, because they have different fixes: the extension
      not created (`CREATE EXTENSION`) and the extension created but never
      loaded (`shared_preload_libraries`, plus a restart)
- [x] SQLite has no such view. Say so plainly instead of showing an empty table
- [x] **Store them**, so a snapshot survives the counters being reset and two
      snapshots can be compared
- [x] A **Slow queries** tab per database connection, ordered by total time,
      mean, calls or rows, with the digest, timings, rows per call and — on
      MySQL — rows examined, which is the number that finds a missing index
- [x] Compare a stored reading against now, or against another reading. The
      absolute numbers cover everything since the counters were last reset,
      which is rarely the window you care about

Noted while building it: a statement DataPilot runs on the user's behalf does
not always turn up in `pg_stat_statements`, because of how the adapter
executes it. That is the right outcome — the point is the application's
traffic, not this tool's.

---

## 🕸️ FLOW BUILDER — *node graph across the DB and API planes*

> ⚠️ Note: **"Workflow automation"** is listed under OUT OF SCOPE below. This
> overlaps with it. Worth settling which of the two readings is wanted before
> building, because they are different products:
>
> 1. **Composition** — wire a query into a request, run the chain once, watch
>    the data move. A debugging and exploration tool. Fits the North Star.
> 2. **Automation** — save it, schedule it, retry it, alert on it. That is the
>    thing the roadmap rules out.

- [ ] Node canvas — drag a **DB node** (connection + query) and an **API node**
      (connection + request) onto a surface and connect them
- [ ] Data flows along the edges; a downstream node reads upstream output with
      `{{node.field}}`, reusing the variable syntax the API client already has
- [ ] **Branching** — one node feeding several, run in parallel
- [ ] **Every node shows its own state on the canvas** — idle / running /
      succeeded / failed, with row or status counts, timing, and the actual
      result available from the node. Debugging a flow means seeing where the
      data stopped being what you expected, so a node that hides its output is
      useless
- [ ] A failed node names what failed and does not blame the nodes downstream
      of it
- [ ] Stored either as its own connection kind, or inside an existing one

---

## 🔭 NEXT

Nothing outstanding beyond the IN FLIGHT queue above.

---

## 🔌 API CLIENT

A connection is already "a thing DataPilot talks to" — `SourceConfig` has had an
`api` member since the start, and the routing vocabulary says *"connections →
databases, apis"* and *"entities → tables, endpoints"*. An API client is the
second kind of connection, not a second product.

### The shape

- **Connection** = an API: base URL, default headers, auth, and variables.
- **Entity** = a saved request under that connection, the way a table is an
  entity under a database.
- Requests open in the same tabs, next to query tabs, against the same sidebar.

### Frontend
- [x] **Request builder**
  - Method + URL bar, with `{{variable}}` interpolation
  - Query string as key/value rows, kept in sync with the URL as it is typed
  - Headers as key/value rows, each toggleable
  - Body: JSON (validated), form, url-encoded, raw, none
  - Auth: none / bearer / basic / header, inherited from the connection

- [x] **Response viewer**
  - Status, time, size — the same status bar language queries already use
  - Body as pretty JSON, raw, or preview; headers in their own tab
  - Errors shown as a result, not a toast

- [x] **WebSocket client**
  - Connect / disconnect with visible state
  - Message log, both directions, timestamped
  - Send frames as text or JSON

- [x] **Saved requests**
  - Requests listed under their connection in the sidebar
  - _Run history is not built; a saved request is re-sent rather than replayed._

### Backend
- [x] **Request execution** — `POST /connection/{id}/request`
  - Runs server-side, so the browser is not blocked by CORS and credentials
    never reach the page
  - Returns status, headers, body, elapsed time and size
  - Timeout, response size cap and redirect limit

- [x] **WebSocket proxy** — `WS /connection/{id}/socket`
  - The server holds the upstream socket and pipes frames both ways, for the
    same reasons

- [x] **Saved requests** — CRUD under `/connection/{id}/requests`

- [x] **Variables** — per connection, interpolated into URL, headers and body,
  with secret values masked the way sensitive columns already are

### Deliberately not in scope
Test scripts, pre-request scripting, mock servers, contract testing, and
comparing responses across environments. Those are what makes Postman heavy;
the North Star applies here too.