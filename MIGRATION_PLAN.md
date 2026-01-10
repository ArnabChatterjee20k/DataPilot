# Migration Plan: TanStack Query + Zustand Integration

## Goal
- **TanStack Query**: Server-driven data (fetching & mutations)
- **Zustand**: Client state only (UI state, tabs, local caching)

## Current State Analysis

### Server Data Operations (to migrate to React Query):
1. **Connections**
   - `listConnections()` - DatabaseSidebar, ConnectionModal
   - `getConnection()` - ConnectionModal
   - `createConnection()` - ConnectionModal
   - `updateConnection()` - ConnectionModal
   - `deleteConnection()` - DatabaseSidebar

2. **Schemas**
   - `getSchemas()` - DatabaseSidebar

3. **Tables**
   - `getTables()` - DatabaseSidebar, code-area

4. **Query Execution**
   - `executeQuery()` - DatabaseSidebar, index.tsx, table.tsx

5. **File Upload**
   - `uploadFile()` - ConnectionModal

### Client State (keep in Zustand):
- Tabs management
- Active tab state
- Query results cache (per tab)
- Table filters, pagination
- Columns/rows cache (for display)

## Migration Steps

### Phase 1: Setup & Connections (Simplest)
**Step 1.1**: Create `useConnections` hook
- Query: `listConnections`
- Mutation: `createConnection`, `updateConnection`, `deleteConnection`

**Step 1.2**: Migrate DatabaseSidebar connections loading
- Replace `loadConnections()` with `useConnections()`
- Keep Zustand for local state management

**Step 1.3**: Migrate ConnectionModal
- Use `useConnections` for listing
- Use mutations for create/update/delete

### Phase 2: Schemas & Tables
**Step 2.1**: Create `useSchemas` hook
**Step 2.2**: Create `useTables` hook
**Step 2.3**: Migrate DatabaseSidebar schema/table loading

### Phase 3: Query Execution
**Step 3.1**: Create `useExecuteQuery` hook
**Step 3.2**: Migrate query execution in index.tsx
**Step 3.3**: Migrate table pagination in table.tsx

### Phase 4: Cleanup
**Step 4.1**: Remove server data from Zustand store
**Step 4.2**: Update any remaining components
**Step 4.3**: Final testing

## Implementation Order

1. ✅ **Step 1.1**: Create hooks infrastructure and `useConnections`
2. ⏳ **Step 1.2**: Migrate DatabaseSidebar connections (incremental)
3. ⏳ **Step 1.3**: Migrate ConnectionModal
4. ⏳ Continue with Phase 2, 3, 4...

