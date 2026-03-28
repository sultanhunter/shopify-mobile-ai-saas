# Shopify Mobile AI Builder (New Project)

This is a brand-new SaaS prototype that matches your requested flow:

- Left panel: AI chat for app requirements
- Right panel: mobile app preview frame
- Project uses Expo code generation
- Each AI update can auto-commit to a GitHub repository
- Store connection is tracked per workspace and written into generated Expo config

## Stack

- Next.js App Router (single app for UI + API)
- Supabase-backed persistence for workspace/project state
- GitHub REST API integration for repo creation + file commits
- Provider-based LLM layer (`src/lib/llm.ts`) with Vertex-backed Gemini via external Node server
- Shopify OAuth callback validation + token exchange + encrypted token storage
- External runner server support for long-running Vertex generation jobs
- Expo scaffolding runs on external Node server using `create-expo-app` SDK 55 template
- Shopify baseline now scaffolds a modular per-workspace Node expo backend (`expo-backend/`) for Expo app APIs
- Node dev-session APIs for clone/install/expo-run/apply-and-push workflow
- Workspace layout targets two apps: `mobile/` (Expo) and `expo-backend/` (Node API)

## Key Endpoints

- `POST /api/projects` - create workspace + Expo scaffold
- `GET /api/tasks/:taskId` - poll background task status
- `GET /api/projects` - list workspaces
- `GET /api/projects/:projectId` - fetch workspace state
- `POST /api/projects/:projectId/connect-store` - connect Shopify store metadata
- `POST /api/projects/:projectId/messages` - run prompt -> update Expo files + preview + optional GitHub commit
- `GET /api/shopify/auth?shop=...&projectId=...` - build Shopify OAuth URL with signed state
- `GET /api/shopify/callback` - verify HMAC/state -> exchange token -> securely store per project
- `GET /api/projects/:projectId/shopify/customer-auth/config` - resolve/store active customer auth strategy and endpoints
- `POST /api/projects/:projectId/shopify/customer-auth/config` - set active customer auth strategy
- `POST /api/projects/:projectId/shopify/customer-auth/start` - create Customer Account API session + OAuth URL
- `GET /api/projects/:projectId/shopify/customer-auth/session/:sessionId` - poll Customer Account API auth completion
- `POST /api/projects/:projectId/shopify/customer-auth/refresh` - refresh Customer Account API token
- `GET /api/shopify/customer-auth/callback` - Customer Account API callback -> session completion page

External runner server endpoints (`Desktop/shopify-mobile-runner-server`):

- `POST /api/shopify-mobile/dev-session/start` - clone repo, install deps, start Expo
- `GET /api/shopify-mobile/dev-session/:sessionId/status` - fetch session status/logs/Expo URL
- `POST /api/shopify-mobile/dev-session/:sessionId/apply-and-push` - write files, commit, push
- `POST /api/shopify-mobile/dev-session/:sessionId/stop` - stop Expo process
- `ANY /api/shopify-mobile/dev-session/:sessionId/web/*` - reverse proxy to live Expo web session

## Expo Scaffold Source

Workspace creation now uses this command on the external Node server:

```bash
npx create-expo-app@latest <project-slug> --template default@sdk-55 --yes --no-install
```

After scaffold generation, AI-generated files are layered on top of the base Expo project.

## Run Locally

1. Create env file

```bash
cp .env.example .env.local
```

2. (Optional) Configure GitHub sync

- Set `GITHUB_TOKEN` (repo scope)
- Set `GITHUB_OWNER` if you want repos created under an org/user explicitly

3. Configure Shopify + LLM

- Set `SUPABASE_URL`
- Set `SUPABASE_SERVICE_ROLE_KEY`
- Optional: set `SUPABASE_PROJECTS_TABLE` (defaults to `projects`)
- Apply schema from `supabase/projects.sql` in your Supabase SQL editor
- Set `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`
- Set `SHOPIFY_OAUTH_STATE_SECRET` and `SHOPIFY_TOKEN_ENCRYPTION_SECRET`
- Optional Customer Account API vars for mobile customer login:
  - `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID` (falls back to `SHOPIFY_API_KEY`)
  - `SHOPIFY_CUSTOMER_ACCOUNT_SCOPES` (default `openid,email,profile`)
- `SHOPIFY_CUSTOMER_AUTH_CALLBACK_URL` (defaults to `<NEXTJS_APP_BASE_URL>/api/shopify/customer-auth/callback`)
- Set `GEMINI_API_KEY`
- Set `NEXTJS_APP_BASE_URL` to your public Next.js URL (used for Shopify OAuth redirect URL)
- Expo backend URL is injected by runner per session (`EXPO_PUBLIC_RUNTIME_BACKEND_URL`)
- Optional legacy static URL aliases (not used by current baseline generator):
  - `MOBILE_EXPO_BACKEND_BASE_URL`
  - `MOBILE_RUNTIME_BACKEND_BASE_URL`
  - `MOBILE_BACKEND_BASE_URL`
- Optional workspace layout envs for create-task payload:
  - `WORKSPACE_MOBILE_APP_DIR` (default `mobile`)
  - `WORKSPACE_EXPO_BACKEND_DIR` (default `expo-backend`)
  - `WORKSPACE_EXPO_BACKEND_PORT` (default `4100`)
- Set `RUNNER_SERVER_BASE_URL` to your runner server (for example `http://localhost:3100`)
- Set `RUNNER_SERVER_TOKEN` to match `RUNNER_SERVER_TOKEN` on the runner server
- Set `EXPO_SCAFFOLD_SERVER_BASE_URL` if scaffold service runs on a different server
- Set `EXPO_SCAFFOLD_SERVER_TOKEN` if scaffold token differs from runner token
- Optional: switch provider/model via `LLM_PROVIDER` and `LLM_MODEL`

4. Configure the runner server (`/Users/sultanibneusman/Desktop/shopify-mobile-runner-server`)

- Set `PORT=3100`
- Set `VERTEX_API_KEY`
- Set `VERTEX_MODEL` (default is `gemini-3.1-flash-lite-preview`)
- Set `RUNNER_SERVER_TOKEN` to a shared secret
- Ensure `npx` is available for `create-expo-app` scaffolding

5. Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Workspace creation is now asynchronous: `POST /api/projects` returns a task ID and the UI polls task status until project setup completes.

## Migrate Existing Local Data

If you have existing `.data/projects.json` records from local file storage, migrate them into Supabase:

```bash
npm run migrate:projects:supabase -- --dry-run
npm run migrate:projects:supabase
```

Optional flags:

- `--file <path>` to use a non-default JSON path
- `--table <name>` to target a custom Supabase table

## Real Dev Workflow Mode

The Node server now supports a developer-like loop:

1. Start dev session (clone + install + start Expo app + start expo backend)
2. Apply AI file edits into the live clone
3. Commit and push back to GitHub
4. Expo hot-reloads from the running dev session and consumes expo backend URL

This keeps Vercel lightweight while long-running build/watch work stays on persistent Node infrastructure.

## Notes

- Shopify access tokens are encrypted before persisting in the local DB.
- Generated Expo apps call their own workspace expo backend (`expo-backend/`), and that backend bridges to control-plane APIs.
- `LLM_PROVIDER=vertex-server` is the recommended mode for Vercel deployments.
- `LLM_PROVIDER=rule-based` is still available as a fallback provider for development.
- Workspace preview supports a quick in-app preview and a Snack web preview mode.
- Generated Expo project files are source-of-truth in the server workspace repo and can be pushed to GitHub.
