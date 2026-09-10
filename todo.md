# DataPilot – Feature Roadmap
---

## 🥇 PRIORITY 1 — CORE EXPERIENCE (Non-Negotiable)

### Frontend
- [ ] **Instant Scanability**
  - Auto column width + manual resize
  - Truncate long text with expand-on-click
  - Sticky headers & first column
  - Clear row hover state
  - Visual distinction for `null`, empty, default values

- [ ] **Column Type Awareness (Visible)**
  - Show inferred DB type under column name
  - Types: uuid, text, number, boolean, timestamp, json
  - Monospace for IDs & hashes

- [ ] **Zero-Friction Filtering**
  - Click cell → filter by value
  - Breadcrumb-style filter stack
  - Clear all filters in one click
  - AND-only logic (explicit, visual)

- [ ] **Empty & Loading States**
  - Skeleton loaders (never blank screens)
  - Clear “0 rows returned” message
  - Query success indicator + execution time

- [ ] **Safe-by-Default UX**
  - Read-only mode by default
  - Environment badge (PROD / STAGING / LOCAL)
  - Mask sensitive fields (passwords, tokens)

---

### Backend
- [ ] **Schema Introspection**
  - Column type
  - Nullable / default
  - Primary key detection
  - Index detection

- [ ] **Unsafe Query Detection**
  - Detect UPDATE / DELETE / DROP
  - Detect missing WHERE clause
  - Expose risk level to frontend

- [ ] **Deterministic Pagination**
  - Prefer cursor-based pagination when PK exists
  - Warn on large OFFSET usage
  - Stable ordering guarantees

- [ ] **Connection Metadata**
  - Connection name
  - Role (primary / replica)
  - Environment tag

---

## 🥈 PRIORITY 2 — DIFFERENTIATORS (Why DataPilot Wins)
> These make users prefer DataPilot over Adminer / Compass / Supabase UI.

### Frontend
- [ ] **Row Expand Panel**
  - Full JSON view
  - Copy full row
  - Field-level inspection

- [ ] **Row Compare / Diff View**
  - Select 2 rows → diff
  - Highlight changed fields
  - JSON diff support

- [ ] **Smart Defaults**
  - Auto-sort by `updated_at`
  - Relative timestamps (`3h ago`)
  - Enum detection → colored pills

- [ ] **Column Controls**
  - Hide / show columns
  - Reorder columns
  - Column-specific filter menu

- [ ] **Copyability Everywhere**
  - Copy cell
  - Copy row
  - Copy JSON path
  - Copy primary key

---

### Backend
- [ ] **Index Awareness API**
  - Mark indexed vs non-indexed columns
  - Warn on slow filters

- [ ] **Explain-Lite Query Insights**
  - Seq scan vs index scan
  - Estimated rows
  - Time category (fast / medium / slow)

- [ ] **Sensitive Field Classification**
  - Backend marks fields as sensitive
  - Frontend masks automatically

- [ ] **Backend-Aware Export**
  - Respect UUIDs, ObjectIds, timestamps
  - Export filtered + visible columns only

---

## 🥉 PRIORITY 3 — POWER USER FEATURES (Optional, Non-Bloated)
> Add only if they don’t compromise simplicity.

### Frontend
- [ ] **Keyboard-First Navigation**
  - `/` → search
  - `⌘K` → command palette
  - Arrow navigation
  - `Enter` → expand row

- [ ] **One-Glance Stats Panel**
  - Row count
  - % nulls per column
  - Top values per column

- [ ] **View Personalization**
  - Remember hidden columns
  - Remember sort & filters
  - Remember last table

---

### Backend
- [ ] **Schema Drift Detection (Mongo-first)**
  - Fields present in some docs only
  - Type mismatches

- [ ] **Change Awareness (Lightweight)**
  - Highlight recently updated rows
  - `updated_at` based signals

---

### API client
A very similar to postman. It will be api client as well option with option to add url, query string ,headers,etc in a kv format as well.
Think about more here
Option for http and ws clients

Having option to chain requests in a flow like sequence, parallel, branching,etc in a visual way while passing data among each other
option for copying as curl and js fetch and js ws

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
