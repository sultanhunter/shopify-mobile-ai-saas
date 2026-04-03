# Architecture Reference

Last updated: 2026-04-03
Version: v2.0.0

This document reflects the runtime-owned architecture.

## 1) System Map

```text
                                        +-------------------------+
                                        |      Shopify Store      |
                                        | (Admin + Customer side) |
                                        +------------+------------+
                                                     ^
                                                     |
                                      Direct API/OAuth calls from runtime
                                                     |
+----------------------------------------------------+---------------------------------------------------+
|                                   Expo Backend (Runtime Plane)                                        |
|                                                                                                        |
|  - Receives config/secrets via /internal/runtime/sync                                                  |
|  - Reads/writes per-project Postgres (Neon)                                                            |
|  - Serves all app-facing APIs                                                                           |
|    - /api/catalog                                                                                      |
|    - /api/products/:handle                                                                             |
|    - /api/customer-auth/*                                                                              |
+-------------------------------+-----------------------------------------------+------------------------+
                                |                                               |
                                |                                               |
                          +-----v------+                                   +-----v----------------+
                          |  Expo App  |                                   | Project DB (Neon PG) |
                          |  mobile/   |                                   | one DB per project    |
                          +------------+                                   +-----------------------+


+--------------------------------------------------------------------------------------------------------+
|                                  Next.js SaaS (Control Plane)                                         |
|                                                                                                        |
|  - Workspace UI + orchestration                                                                        |
|  - Shopify connect callbacks                                                                            |
|  - Runtime config/secrets source of truth                                                               |
|  - Runtime sync outbox + dispatcher                                                                     |
+-----------------------------------+----------------------------------------------+-------------------+
                                    |                                              |
                                    | RUNNER_SERVER_*                              | Supabase
                                    |                                              |
                         +----------v-----------+                       +----------v--------------------+
                         | Runner Server        |                       | Control-plane Tables          |
                         | (execution plane)    |                       | - projects/tasks              |
                         | starts mobile+backend|                       | - project_runtime_config      |
                         | injects backend URL  |                       | - project_runtime_secrets     |
                         +----------------------+                       | - runtime_sync_outbox         |
                                                                        +-------------------------------+
```

## 2) Core Flows

### 2.1 Workspace Create (GitHub-first)

1. SaaS requests runner task `workspace.create`.
2. Runner scaffolds `mobile/` and `expo-backend/`.
3. Runner creates/pushes GitHub repo.
4. Project metadata is stored in Supabase `projects`.

### 2.2 Shopify Connect + Runtime Provisioning

1. SaaS completes Shopify OAuth and receives admin token.
2. SaaS provisions per-project runtime DB (if missing), either directly or through runner.
3. SaaS runs runtime DB migrations (`runtime_sync_state`, `customer_auth_sessions`).
4. SaaS writes:
   - non-secret runtime config -> `project_runtime_config`
   - encrypted runtime secrets JSON -> `project_runtime_secrets`
5. SaaS appends versioned sync event to `runtime_sync_outbox`.

### 2.3 Runtime Sync Dispatch

1. On connect/config updates, event is queued in outbox.
2. On dev-session start/refresh (backend URL available), SaaS dispatches latest payload to:
   - `POST /internal/runtime/sync`
3. Runtime persists synced config+secrets locally and acknowledges version.
4. SaaS marks outbox events `delivered` or `failed`.

### 2.4 App API Path (Hot Path)

1. Expo app calls runtime backend URL (`EXPO_PUBLIC_RUNTIME_BACKEND_URL`).
2. Runtime backend uses synced secrets + per-project DB to serve requests.
3. Runtime backend calls Shopify directly (no SaaS proxy in hot path).

## 3) Data Ownership

- `projects.project`: non-secret project/workspace metadata only.
- `project_runtime_config`: non-secret runtime config, versioned.
- `project_runtime_secrets`: encrypted JSON for per-project sensitive values.
- `runtime_sync_outbox`: versioned sync queue + delivery status.

Project secrets include (stored only in encrypted runtime secrets):

- Shopify admin access token
- Shopify shop domain
- Customer Account API client ID + endpoints/scopes
- Runtime DB credentials
- Other runtime integration secrets (for example webhook shared secrets)

## 4) Required Environment Variables

### SaaS (Next.js)

- `NEXTJS_APP_BASE_URL`
- `RUNNER_SERVER_BASE_URL`
- `RUNNER_SERVER_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PROJECTS_TABLE`
- `SUPABASE_TASKS_TABLE`
- `SUPABASE_RUNTIME_CONFIG_TABLE`
- `SUPABASE_RUNTIME_SECRETS_TABLE`
- `SUPABASE_RUNTIME_SYNC_OUTBOX_TABLE`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_TOKEN_ENCRYPTION_SECRET`
- `SHOPIFY_OAUTH_STATE_SECRET`
- `RUNTIME_DB_PROVISIONER` (`auto`/`direct`/`runner`)
- `RUNTIME_ADMIN_DATABASE_URL` (required when using direct mode)
- `RUNTIME_DATABASE_PREFIX` (optional)
- `RUNTIME_ROLE_PREFIX` (optional)
- Legacy aliases: `NEON_ADMIN_DATABASE_URL`, `NEON_RUNTIME_DATABASE_PREFIX`, `NEON_RUNTIME_ROLE_PREFIX`
- `RUNTIME_SYNC_TOKEN` (recommended)

### Runner

- `RUNNER_SERVER_BASE_URL`
- `RUNNER_SERVER_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_TOKEN`
- `RUNNER_REQUIRE_GITHUB_REPO=true`
- `RUNNER_RUNTIME_ADMIN_DATABASE_URL` (if runner provisions project DBs)
- `RUNNER_RUNTIME_DATABASE_PREFIX` (optional)
- `RUNNER_RUNTIME_ROLE_PREFIX` (optional)

## 5) Operational Notes

- Runtime sync is best-effort per dispatch; failed outbox events are retried on next refresh.
- Runtime backend URL is session-scoped and injected by runner.
- Runtime backend should be considered the app API boundary for mobile clients.

## 6) Version History

### v2.0.0 (2026-04-02)

- Switched to runtime-owned app API path (`Expo app -> expo-backend -> Shopify + project DB`).
- Added per-project Neon DB provisioning and migration flow.
- Replaced runtime state/events control-plane schema with config/secrets/outbox model.
- Added encrypted secrets source of truth outside `projects.project`.
