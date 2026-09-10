# DataPilot console

React + Vite + Tailwind front end for the DataPilot server.

## Setup

```bash
pnpm install
pnpm dev          # expects the server on http://localhost:8000
```

Point it somewhere else with `VITE_API_URL`. In a production build the variable is
unset and the SDK uses a relative URL, because the server serves the built console
from its own origin.

## SDK

`src/lib/sdk` is generated from the server's OpenAPI schema — do not edit it by
hand. Regenerate after changing the API:

```bash
# from ../server, dump the schema first
uv run python -c "import json; from main import api; open('../console/openapi.json','w').write(json.dumps(api.openapi(), indent=2))"
pnpm generate:sdk
```

`src/lib/sdk-runtime.ts` supplies the base URL and is preserved across
regeneration.

## Tests

```bash
pnpm e2e          # headless
pnpm e2e:ui       # Playwright UI mode
```

Playwright boots the real server and Vite against a throwaway data directory, and
seeds a SQLite database (`e2e/global-setup.ts`) containing the cases worth testing
against: a NULL, an empty string, a value with an apostrophe, JSON, timestamps, a
low-cardinality column and a credential-shaped column name.

`e2e/visual.spec.ts` is not a gate — it captures the main states as screenshots
under `test-results/` for a human (or an agent) to look at.

## Layout

```
src/
  lib/
    columns.ts     normalising and refining column metadata
    format.ts      rendering values: masking, relative time, enum pills
    sql.ts         building SELECT/INSERT/UPDATE/DELETE safely
    sdk/           generated API client
  pages/playground/
    components/    grid, filter bar, panels, dialogs
    hooks/         react-query hooks per resource
    store/         zustand tab store (persisted)
```
