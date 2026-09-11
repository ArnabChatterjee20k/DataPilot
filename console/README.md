# DataPilot console

React, Vite, Tailwind, TanStack Query and Zustand, in front of the DataPilot
server.

## Setup

```bash
pnpm install
pnpm dev          # expects the server on http://localhost:8000
```

`VITE_API_URL` points it somewhere else. A production build leaves the variable
unset and the SDK uses a relative URL, because the server serves the built
console from its own origin.

## Layout

```
src/
  lib/
    columns.ts     normalising and refining column metadata
    curl.ts        parsing a pasted curl command into a request
    format.ts      rendering values: masking, relative time, enum pills
    sql.ts         building SELECT, INSERT, UPDATE and DELETE safely
    sdk/           generated API client
  pages/playground/
    components/    grid, filter bar, panels, dialogs, request builder, consoles
    flow/          the node canvas, its nodes and the run socket
    redis/         key browser, dashboard, pub/sub
    hooks/         one react-query hook per resource
    store/         zustand tab store, persisted
```

## SDK

`src/lib/sdk` is generated from the server's OpenAPI schema. Do not edit it by
hand. Regenerate after changing the API:

```bash
# from ../server, dump the schema first
MODE=TESTING uv run python -c "import json; from main import api; open('../console/openapi.json','w').write(json.dumps(api.openapi(), indent=2))"
pnpm generate:sdk
```

`src/lib/sdk-runtime.ts` supplies the base URL and survives regeneration.

## Tests

```bash
pnpm e2e          # headless
pnpm e2e:ui       # Playwright UI mode
```

Playwright starts the real server and a real Vite against a throwaway data
directory, and seeds a SQLite database in `e2e/global-setup.ts` with the cases
worth testing against: a NULL, an empty string, a value with an apostrophe,
JSON, timestamps, a low-cardinality column and a credential-shaped column name.

`e2e/upstream.ts` runs an HTTP server, a WebSocket server and an MQTT broker in
process, so the API client tests send real requests. The Redis tests skip
themselves when no server answers at `TEST_REDIS_URL`, which defaults to
`redis://127.0.0.1:56379/0`, and seed the keys they read from
`e2e/redisSeed.ts` so they do not depend on what was left in the
container.

The fixture in `e2e/fixtures.ts` fails a test on an uncaught page error or a
console error. A React crash renders a blank page, which otherwise shows up as a
confusing "element not found" somewhere further down rather than as the
exception that happened.

`e2e/visual.spec.ts` is not a gate. It writes screenshots of the main states to
`test-results/` for a person to look at.

`e2e/curl.spec.ts` tests a pure function directly rather than through the UI.
