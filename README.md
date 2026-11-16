# Araw · Visual schedules and picture cards

An npm workspace with React + Vite, Express, and a shared types package. Requires Node.js 22.12+ and npm.

## Frontend preview

The responsive frontend follows the [Araw Figma design](https://www.figma.com/design/LIUnykdWEJ139auGBKjTUs/SRS-v2?node-id=26-3). It includes the staff dashboard, child profiles, schedule editor, task status, progress, settings, picture card management, and the child schedule and communication board. Figma SVG assets and Nunito fonts are bundled locally.

Run the frontend alone without MySQL or the API:

```sh
npm ci
npm run dev -w @starter/web
```

Open http://localhost:5173. On PowerShell systems that block `npm.ps1`, use `npm.cmd` instead of `npm`.

This frontend currently uses demo profiles (Mika, Leo and Ari) and stores edits in browser local storage. Login and registration demonstrate the UI only. The backend endpoints described below are separate and are not connected to these screens yet. The communication board uses the browser's speech synthesis when available.

Verify the frontend with `npm run typecheck -w @starter/web` and `npm run build -w @starter/web`.

```text
apps/
  api/
    src/
      db/pool.ts          # MySQL pool and connectivity checks
      lib/errors.ts       # Async routes and API errors
      lib/validate.ts     # Request validation helpers
      routes/health.ts    # GET /api/health
      app.ts              # Express application and CORS
      server.ts           # Environment, listener, shutdown
    scripts/
      schema.ts          # Apply schema.sql
      seed.ts            # Seed library and demo schedules
    schema.sql
    .env.example
    tsconfig.json
  web/
    src/
      lib/api.ts        # Typed API client
      App.tsx
      main.tsx
      styles.css
    .env.example
    index.html
    vite.config.ts
    tsconfig.json
packages/
  shared/
    src/index.ts        # Shared API contracts
    src/schemas.ts      # Shared Zod schemas
    tsconfig.json
package.json
tsconfig.base.json
```

## Run locally

Start MySQL and create the `special_project` database. Copy `apps/api/.env.example` to
`apps/api/.env`, then set your MySQL credentials and the frontend origin:

```sh
npm install
npm run db:schema
npm run db:seed
npm run dev
```

Open http://localhost:5173. The API listens on http://localhost:3001 and verifies its
database connection before starting. Vite proxies `/api` requests to the backend.
Copy `apps/web/.env.example` to `apps/web/.env` only if you need to customize the frontend.
On PowerShell systems that block npm.ps1, use `npm.cmd` instead of `npm`.
The seed-only demo caregiver has no login password; create a normal account to use the API.

## Commands

- `npm run dev`: run both apps with automatic reload.
- `npm run typecheck`: check every workspace.
- `npm run build`: compile shared schemas and the API, then build the frontend.
- `npm run db:schema`: create the database tables (the database itself must already exist).
- `npm run db:seed`: add the activity library, default cards, and demo schedules.
- `npm test -w @starter/api`: run API tests.
- `npm start`: run the compiled API after building.
- `npm run preview -w @starter/web`: preview the frontend build locally (no development API proxy).

## Extend the template

### Child profiles, activities, schedules and tasks

The API persists child, activity, schedule and task data in MySQL. Child, schedule and task queries are scoped to the authenticated user's ID, and deleting a child relies on the schema's foreign-key cascades. Requests use the real JWT middleware. API unit tests use the in-memory mock store only when running under Vitest without database configuration. See [the backend plan](docs/BACKEND_TASKS.md).

| Method and path | Response |
| --- | --- |
| `GET /api/children` | `200`, array of the caller's children (empty array if none) |
| `POST /api/children` | `201`, created child |
| `GET /api/children/:id` | `200`, owned child |
| `PUT /api/children/:id` | `200`, updated child; accepts a nonempty partial update |
| `DELETE /api/children/:id` | `200`, `{ "success": true }`; removes the child's schedules and tasks through database cascades |
| `GET /api/activities` | `200`, array of shared activities with `id`, `name`, `icon`, `category` |

All child and activity endpoints require a valid JWT. Missing/invalid tokens return `401`; invalid input returns `400`; missing or another user's child returns the same `404`. Errors use `{ "error": "message" }`. Ownership comes from authentication; client-supplied ids, ownership and timestamps are rejected in child bodies. Deletion confirmation belongs in the frontend.

Example create body:

```json
{ "name": "Sam", "age": 5, "delay_domain": "speech", "notes": "Likes music", "avatar": "🐼" }
```

The current validation choices are: trimmed name (1–100 characters), integer age (0–120), delay domain (`speech`, `motor`, `cognitive`, `social`, `general`), optional notes (up to 2,000 characters, or `null` to clear), and an optional avatar (`🦊`, `🐼`, `🐰`, `🐻`, `🐱`, `🐶`; defaults to `🦊` on create). A partial update preserves omitted fields. Shared TypeScript contracts are in [the shared package](packages/shared/src/index.ts); runtime schemas live in [the shared schemas](packages/shared/src/schemas.ts).

Run unit tests with `npm run test -w @starter/api`. For MySQL-backed ownership, persistence, activity-library and child-cascade coverage, configure `DB_TEST_HOST`, `DB_TEST_PORT`, `DB_TEST_USER`, `DB_TEST_PASSWORD`, and `DB_TEST_NAME` (a dedicated, empty database whose name ends in `_test`), then run `npm run test:integration -w @starter/api`. The integration test applies the schema without dropping tables and deletes only its own fixtures.

For local integration testing, put those `DB_TEST_*` values in `apps/api/.env.test` (this file is git-ignored). Create the database first; the test account needs privileges only on that database and the database must not contain any users. Do not copy production credentials or seed production data into the test database.

### Cards, settings, and profile

- `GET /api/cards?childId=` returns shared defaults and the child's custom cards grouped by category. Hidden cards are excluded unless `includeHidden=true`.
- `POST /api/cards` accepts `{ "childId": 1, "label": "Break", "category": "Activities", "icon": "⭐" }`.
- `PATCH /api/cards/:id` accepts `{ "hidden": true }`; `DELETE /api/cards/:id` deletes an owned custom card.
- `GET /api/settings` returns defaults or the authenticated user's settings; `PUT /api/settings` updates them.
- `GET /api/auth/me` returns the current profile; `PATCH /api/auth/me` updates only its name.

Custom cards and settings use parameterized MySQL access. The card schema includes an `is_hidden` flag; re-run `npm run db:schema` after updating an existing local database. Unit tests inject in-memory repositories; the dedicated integration test covers MySQL route persistence.

### Adding features

Add API routes under `apps/api/src/routes`, UI components under `apps/web/src/components`, and shared contracts and Zod schemas under `packages/shared/src`. Use shared schemas at API boundaries to validate user input.

## Deployment

Serve `apps/web/dist` using a static host and run the API with `npm start`. Configure a reverse proxy to forward `/api` to the backend on the same origin. For separate origins, set `VITE_API_BASE_URL` before building the frontend and configure explicit CORS permissions on the API. Vite environment variables are public build-time values; keep secrets in the backend environment.
