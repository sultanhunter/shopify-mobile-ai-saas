# Architecture Reference

Last updated: 2026-03-28
Version: v1.0.0

This document is the living reference for how the Shopify Mobile AI platform is wired today.

## 1) System Map

```text
                                         +-------------------------+
                                         |      Shopify Store      |
                                         | (Admin + Customer side) |
                                         +------------+------------+
                                                      |
                                     Admin OAuth + Admin API calls
                                                      |
+-----------------------------------------------------v--------------------------------------------------+
|                                  Next.js SaaS (Control Plane)                                         |
|                                                                                                        |
|  - Workspace UI                                                                                        |
|  - Shopify connect callback + token storage                                                            |
|  - Control-plane APIs (/api/projects/:id/shopify/*)                                                    |
|  - Dev session orchestration (calls runner)                                                            |
+-----------------------------+---------------------------------------+-----------------------------------+
                              |                                       |
                              | RUNNER_SERVER_BASE_URL               | Supabase (projects/tasks)
                              | RUNNER_SERVER_TOKEN                  |
                              |                                       |
+-----------------------------v---------------------------------------v-----------------------------------+
|                                Runner Server (Execution Plane)                                         |
|                                                                                                        |
|  Project workspace root: /var/shopify-mobile/projects/<projectId>/repo                                |
|                                                                                                        |
|  repo/                                                                                                 |
|    mobile/        -> Expo app                                                                          |
|    expo-backend/  -> Node backend used by that Expo app                                                |
|                                                                                                        |
|  Dev session startup order:                                                                            |
|    1) Start expo-backend and wait /api/health                                                          |
|    2) Build session proxy URL: /api/shopify-mobile/dev-session/:sessionId/expo-backend                |
|    3) Inject EXPO_PUBLIC_RUNTIME_BACKEND_URL into Expo process                                         |
|    4) Start Expo                                                                                        |
+-----------------------------+--------------------------------------------------------+-----------------+
                              |                                                        |
                              | exp:// QR                                              | injected backend URL
                              |                                                        |
                       +------v------+                                           +-----v------+
                       |  Expo App   |------------------------------------------>| Expo-Backend|
                       |  (mobile/)  |                  /api/*                  | (Node API) |
                       +-------------+                                           +-----+------+
                                                                                      |
                                                                                      | CONTROL_PLANE_BASE_URL + PROJECT_ID
                                                                                      v
                                                                   Next.js SaaS /api/projects/:id/shopify/*
                                                                                      |
                                                                                      v
                                                                                Shopify Admin API
```

## 2) Core Flows

### 2.1 Workspace Create (GitHub-first)

1. SaaS requests runner task `workspace.create`.
2. Runner scaffolds `mobile/` and `expo-backend/` locally.
3. Runner creates GitHub repo and pushes initial commit.
4. Runner persists project row in Supabase with `github.repoUrl`.
5. If GitHub init fails and `RUNNER_REQUIRE_GITHUB_REPO=true`, task fails.

### 2.2 Shopify Store Connect

1. SaaS starts Shopify OAuth.
2. Shopify callback exchanges token.
3. SaaS stores `store.shopDomain` + `store.accessTokenEncrypted`.
4. SaaS applies Shopify baseline files into repo (`mobile/` + `expo-backend/`).

### 2.3 Dev Session Start

1. SaaS calls runner `/dev-session/start` with `projectId`, `repoUrl`, workspace dirs, and `controlPlaneBaseUrl`.
2. Runner starts expo-backend first and checks `/api/health`.
3. Runner injects `EXPO_PUBLIC_RUNTIME_BACKEND_URL` into Expo process.
4. SaaS polls status and displays Expo URL and expo-backend URL.

### 2.4 Product Fetch (Runtime)

1. Expo app calls `EXPO_PUBLIC_RUNTIME_BACKEND_URL/api/catalog`.
2. Expo-backend calls SaaS: `/api/projects/:projectId/shopify/catalog`.
3. SaaS reads encrypted token from Supabase, decrypts, calls Shopify Admin API.
4. Response returns back through expo-backend to Expo app.

### 2.5 Customer Auth (Runtime)

- `shopify_hosted`: app opens Shopify hosted account/login URL.
- `customer_account_api`: app starts OAuth via expo-backend -> SaaS customer-auth endpoints.

## 3) Source of Truth

- Project state: Supabase `projects` table (JSON `project` field).
- Tasks: Supabase `tasks` table.
- Repo code: GitHub repo + runner local clone.
- Shopify credentials: encrypted in project row (`accessTokenEncrypted`).

## 4) Required Environment Variables

### SaaS (Next.js)

- `NEXTJS_APP_BASE_URL`
- `RUNNER_SERVER_BASE_URL`
- `RUNNER_SERVER_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_TOKEN_ENCRYPTION_SECRET`
- `SHOPIFY_OAUTH_STATE_SECRET`

### Runner

- `RUNNER_SERVER_TOKEN`
- `RUNNER_SERVER_BASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_TOKEN` (or `SHOPIFY_MOBILE_GITHUB_TOKEN`)
- `RUNNER_REQUIRE_GITHUB_REPO=true`

## 5) Operational Notes

- API routes that return project/shopify runtime data are forced dynamic to avoid stale cache.
- Expo backend URL is session-scoped and injected by runner.
- Single repo contains both apps (`mobile/` + `expo-backend/`) by design.

## 6) Version History

### v1.0.0 (2026-03-28)

- Introduced dual-app workspace layout (`mobile/` + `expo-backend/`).
- Added runner-managed expo-backend startup and URL injection to Expo.
- Added Shopify customer auth support (hosted + customer account API).
- Enforced GitHub-first workspace initialization path.
- Forced dynamic API behavior for project/shopify runtime routes.

## 7) Update Checklist (for future changes)

When architecture changes, update all of these:

1. System map section.
2. Flow section(s) affected.
3. Env vars section.
4. Version history with date + bullet changes.
5. Any renamed routes/fields (`projectId`, URL injection env, workspace dirs).
