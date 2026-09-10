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

## 🔭 NEXT

- **Request history** — a saved request can be re-sent, but past runs are not
  kept or replayable.
- **Variables in the console UI** — the API stores and masks them, but there is
  no editor for them yet; they are set through the API.

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