# Shopify Mobile AI Builder (New Project)

This is a brand-new SaaS prototype that matches your requested flow:

- Left panel: AI chat for app requirements
- Right panel: mobile app preview frame
- Project uses Expo code generation
- Each AI update can auto-commit to a GitHub repository
- Store connection is tracked per workspace and written into generated Expo config

## Stack

- Next.js App Router (single app for UI + API)
- File-based local persistence (`.data/projects.json`) for fast MVP iteration
- GitHub REST API integration for repo creation + file commits
- Provider-based LLM layer (`src/lib/llm.ts`) with Vertex-backed Gemini via external Node server
- Shopify OAuth callback validation + token exchange + encrypted token storage
- External Node AI server support for long-running Vertex generation jobs
- Expo scaffolding runs on external Node server using `create-expo-app` SDK 55 template
- Node dev-session APIs for clone/install/expo-run/apply-and-push workflow

## Key Endpoints

- `POST /api/projects` - create workspace + Expo scaffold
- `GET /api/projects` - list workspaces
- `GET /api/projects/:projectId` - fetch workspace state
- `POST /api/projects/:projectId/connect-store` - connect Shopify store metadata
- `POST /api/projects/:projectId/messages` - run prompt -> update Expo files + preview + optional GitHub commit
- `GET /api/shopify/auth?shop=...&projectId=...` - build Shopify OAuth URL with signed state
- `GET /api/shopify/callback` - verify HMAC/state -> exchange token -> securely store per project

External Node server endpoints (`Desktop/skulptaApp/server`):

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

- Set `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`
- Set `SHOPIFY_OAUTH_STATE_SECRET` and `SHOPIFY_TOKEN_ENCRYPTION_SECRET`
- Set `GEMINI_API_KEY`
- Set `AI_SERVER_BASE_URL` to your Node server (for example `http://localhost:3100`)
- Set `AI_SERVER_TOKEN` to match `SHOPIFY_MOBILE_AI_SERVER_TOKEN` on the Node server
- Set `EXPO_SCAFFOLD_SERVER_BASE_URL` if scaffold service runs on a different server
- Set `EXPO_SCAFFOLD_SERVER_TOKEN` if scaffold token differs from AI server token
- Optional: switch provider/model via `LLM_PROVIDER` and `LLM_MODEL`

4. Configure the Node AI server (`/Users/sultanibneusman/Desktop/skulptaApp/server`)

- Set `PORT=3100`
- Set `VERTEX_API_KEY`
- Set `VERTEX_MODEL` (default is `gemini-3.1-flash-lite-preview`)
- Set `SHOPIFY_MOBILE_AI_SERVER_TOKEN` to a shared secret
- Ensure `npx` is available for `create-expo-app` scaffolding

5. Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Real Dev Workflow Mode

The Node server now supports a developer-like loop:

1. Start dev session (clone + install + Expo start)
2. Apply AI file edits into the live clone
3. Commit and push back to GitHub
4. Expo hot-reloads from the running dev session

This keeps Vercel lightweight while long-running build/watch work stays on persistent Node infrastructure.

## Notes

- Shopify access tokens are encrypted before persisting in the local DB.
- `LLM_PROVIDER=vertex-server` is the recommended mode for Vercel deployments.
- `LLM_PROVIDER=rule-based` is still available as a fallback provider for development.
- Workspace preview supports a quick in-app preview and a Snack web preview mode.
- Generated Expo project files are persisted in the project record and can be pushed to GitHub.
