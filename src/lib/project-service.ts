import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { getProject, listProjects, updateProject } from "@/lib/db";
import {
  applyFilesToProjectRepo,
  applyAndPushToDevRunnerSession,
  getDevRunnerSessionStatus,
  listProjectRepoFiles,
  startDevRunnerSession,
  stopDevRunnerSession,
  upsertRuntimeStateOnRunner
} from "@/lib/dev-runner";
import { renderShopifyBaselineFiles, validateShopifyBaselineFiles } from "@/lib/shopify-baseline";
import { detectCustomerAuthState } from "@/lib/shopify-customer-auth";
import {
  dispatchProjectRuntimeSync,
  getProjectRuntimeSnapshot,
  getProjectRuntimeSecrets,
  upsertAndQueueProjectRuntimeSync
} from "@/lib/runtime-sync";
import { generateProjectUpdate } from "@/lib/llm";
import { AiOutput } from "@/lib/ai-engine";
import {
  AiRun,
  ChatMessage,
  DevSessionState,
  Project,
  PublicProject,
  PublicShopifyCustomerAuthState,
  ShopifyCustomerAuthState,
  WorkspaceLayout,
} from "@/lib/models";
import { provisionRuntimeProjectDatabase } from "@/lib/runtime-db-provisioning";
import { parseRuntimeSecrets } from "@/lib/runtime-secrets";

const CLIENT_ID_CONFIGURED_SENTINEL = "__configured__";
const START_SYNC_POLL_ATTEMPTS = 8;
const START_SYNC_POLL_DELAY_MS = 1500;

function createAssistantMessage(content: string, runId?: string): ChatMessage {
  return {
    id: randomUUID(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    runId
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRuntimeBackendBaseUrl(session: DevSessionState | undefined): string | undefined {
  return session?.expoBackendUrl ?? session?.backendUrl;
}

async function dispatchRuntimeSyncForSession(projectId: string, session: DevSessionState | undefined): Promise<number> {
  const baseUrl = resolveRuntimeBackendBaseUrl(session);
  if (!baseUrl) {
    return 0;
  }

  const delivered = await dispatchProjectRuntimeSync({
    projectId,
    expoBackendBaseUrl: baseUrl,
  });

  return delivered.delivered;
}

async function waitForRuntimeBackendAndDispatchSync(input: {
  projectId: string;
  sessionId: string;
  initialSession: DevSessionState;
}): Promise<DevSessionState> {
  let currentSession = input.initialSession;

  try {
    const deliveredNow = await dispatchRuntimeSyncForSession(input.projectId, currentSession);
    if (deliveredNow > 0 || resolveRuntimeBackendBaseUrl(currentSession)) {
      return currentSession;
    }
  } catch {
    // Retry via status polling.
  }

  for (let attempt = 0; attempt < START_SYNC_POLL_ATTEMPTS; attempt += 1) {
    await sleep(START_SYNC_POLL_DELAY_MS);

    try {
      const refreshed = await getDevRunnerSessionStatus(input.sessionId, 60);
      currentSession = normalizeDevSessionState(refreshed);
    } catch {
      continue;
    }

    const baseUrl = resolveRuntimeBackendBaseUrl(currentSession);
    if (!baseUrl) {
      continue;
    }

    try {
      await dispatchRuntimeSyncForSession(input.projectId, currentSession);
    } catch {
      // Keep session update even if sync failed.
    }

    return currentSession;
  }

  return currentSession;
}

function isRunnerLocalDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  } catch {
    return databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1");
  }
}

function createRuntimeDatabasePool(databaseUrl: string): Pool {
  const isLocal = isRunnerLocalDatabaseUrl(databaseUrl);
  return new Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: isLocal ? undefined : { rejectUnauthorized: false }
  });
}

async function upsertRuntimeStateDirect(params: {
  databaseUrl: string;
  version: number;
  config: Record<string, unknown>;
  secrets: Record<string, unknown>;
}): Promise<void> {
  const pool = createRuntimeDatabasePool(params.databaseUrl);

  try {
    await pool.query(
      "create table if not exists runtime_sync_state (id text primary key, version bigint not null default 0, config_json jsonb not null default '{}'::jsonb, secrets_json jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now())"
    );
    await pool.query(
      "insert into runtime_sync_state (id, version, config_json, secrets_json) values ($1, $2, $3::jsonb, $4::jsonb) on conflict (id) do update set version = excluded.version, config_json = excluded.config_json, secrets_json = excluded.secrets_json, updated_at = now()",
      ["runtime", params.version, JSON.stringify(params.config), JSON.stringify(params.secrets)]
    );
  } finally {
    await pool.end();
  }
}

async function seedRuntimeStateInProjectDatabase(projectId: string): Promise<void> {
  const snapshot = await getProjectRuntimeSnapshot(projectId);
  if (!snapshot) {
    return;
  }

  const runtimeSecrets = parseRuntimeSecrets(snapshot.secrets);
  const databaseUrl = runtimeSecrets.runtime?.database?.databaseUrl?.trim();
  if (!databaseUrl) {
    return;
  }

  const payload = {
    databaseUrl,
    version: snapshot.version,
    config: snapshot.config,
    secrets: snapshot.secrets
  };

  if (isRunnerLocalDatabaseUrl(databaseUrl)) {
    await upsertRuntimeStateOnRunner(payload);
    return;
  }

  try {
    await upsertRuntimeStateDirect(payload);
  } catch {
    await upsertRuntimeStateOnRunner(payload);
  }
}

function normalizeWorkspaceDir(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "." || trimmed === "./") {
    return ".";
  }

  return trimmed.replace(/^\.\//, "").replace(/\/$/, "") || fallback;
}

function resolveWorkspaceLayout(project: Project): WorkspaceLayout {
  const configured = project.workspaceLayout;
  if (configured) {
    const expoBackendDir = configured.expoBackendDir ?? configured.backendDir;
    const expoBackendPort = configured.expoBackendPort ?? configured.backendPort;
    const expoBackendStartCommand = configured.expoBackendStartCommand ?? configured.backendStartCommand;

    return {
      mobileAppDir: normalizeWorkspaceDir(configured.mobileAppDir, "mobile"),
      expoBackendDir: normalizeWorkspaceDir(expoBackendDir, "expo-backend"),
      expoBackendPort: Number.isFinite(expoBackendPort) && expoBackendPort > 0 ? expoBackendPort : 4100,
      expoBackendStartCommand: expoBackendStartCommand?.trim() || "npm run dev",
      backendDir: normalizeWorkspaceDir(expoBackendDir, "expo-backend"),
      backendPort: Number.isFinite(expoBackendPort) && expoBackendPort > 0 ? expoBackendPort : 4100,
      backendStartCommand: expoBackendStartCommand?.trim() || "npm run dev",
    };
  }

  const hasMobileScaffold = (project.fileIndex ?? []).some(
    (filePath) => filePath === "mobile/package.json" || filePath.startsWith("mobile/")
  );

  if (hasMobileScaffold) {
    return {
      mobileAppDir: "mobile",
      expoBackendDir: "expo-backend",
      expoBackendPort: 4100,
      expoBackendStartCommand: "npm run dev",
      backendDir: "expo-backend",
      backendPort: 4100,
      backendStartCommand: "npm run dev",
    };
  }

  return {
    mobileAppDir: ".",
    expoBackendDir: "expo-backend",
    expoBackendPort: 4100,
    expoBackendStartCommand: "npm run dev",
    backendDir: "expo-backend",
    backendPort: 4100,
    backendStartCommand: "npm run dev",
  };
}

function buildStoredCustomerAuthSummary(auth: ShopifyCustomerAuthState | undefined): ShopifyCustomerAuthState | undefined {
  if (!auth) {
    return undefined;
  }

  return {
    detectedAt: auth.detectedAt,
    activeMethod: auth.activeMethod,
    recommendedMethod: auth.recommendedMethod,
    supportedMethods: [...auth.supportedMethods],
    hosted: auth.hosted,
    customerAccountApi: {
      enabled: auth.customerAccountApi.enabled,
      clientId: auth.customerAccountApi.clientId ? CLIENT_ID_CONFIGURED_SENTINEL : undefined,
      scopes: [],
      issuer: undefined,
      authorizationEndpoint: undefined,
      tokenEndpoint: undefined,
      revocationEndpoint: undefined,
      endSessionEndpoint: undefined,
      callbackUrl: undefined
    },
    sessions: undefined
  };
}

function buildRuntimeConfigPatch(project: Project, customerAuth: ShopifyCustomerAuthState | undefined): Record<string, unknown> {
  return {
    projectId: project.id,
    projectName: project.name,
    brandColor: project.preview.primaryColor,
    customerAuth: customerAuth
      ? {
          detectedAt: customerAuth.detectedAt,
          activeMethod: customerAuth.activeMethod,
          recommendedMethod: customerAuth.recommendedMethod,
          supportedMethods: customerAuth.supportedMethods,
          hosted: customerAuth.hosted,
          customerAccountApi: {
            enabled: customerAuth.customerAccountApi.enabled,
            hasClientId: Boolean(customerAuth.customerAccountApi.clientId)
          }
        }
      : undefined,
    updatedAt: new Date().toISOString()
  };
}

async function buildRuntimeDatabaseSecretsPatch(projectId: string, currentSecrets: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseRuntimeSecrets(currentSecrets);
  const existingDatabaseUrl = parsed.runtime?.database?.databaseUrl?.trim();
  if (existingDatabaseUrl) {
    return {};
  }

  const provisioned = await provisionRuntimeProjectDatabase(projectId);

  return {
    runtime: {
      database: {
        provider: provisioned.provider,
        databaseName: provisioned.databaseName,
        roleName: provisioned.roleName,
        databaseUrl: provisioned.databaseUrl
      }
    }
  };
}

function toPublicProject(project: Project): PublicProject {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    expoSdk: project.expoSdk,
    preview: project.preview,
    messages: project.messages,
    runs: project.runs,
    devSession: project.devSession,
    opencodeSession: project.opencodeSession,
    workspaceLayout: project.workspaceLayout,
    store: project.store
      ? {
          shopDomain: undefined,
          connectedAt: project.store.connectedAt,
          hasAccessToken: Boolean(project.store.connectedAt),
          customerAuth: toPublicCustomerAuthState(project.store.customerAuth),
        }
      : undefined,
    github: project.github,
    fileIndex: [...(project.fileIndex ?? [])]
  };
}

function toPublicCustomerAuthState(authState: ShopifyCustomerAuthState | undefined): PublicShopifyCustomerAuthState | undefined {
  if (!authState) {
    return undefined;
  }

  return {
    detectedAt: authState.detectedAt,
    activeMethod: authState.activeMethod,
    recommendedMethod: authState.recommendedMethod,
    supportedMethods: [...authState.supportedMethods],
    hosted: authState.hosted,
    customerAccountApi: {
      enabled: authState.customerAccountApi.enabled,
      hasClientId: Boolean(authState.customerAccountApi.clientId),
      scopes: [...authState.customerAccountApi.scopes],
      issuer: undefined,
      authorizationEndpoint: undefined,
      tokenEndpoint: undefined,
    },
  };
}

function normalizeDevSessionState(session: DevSessionState): DevSessionState {
  const expoBackendStatus = session.expoBackendStatus ?? session.backendStatus;
  const expoBackendUrl = session.expoBackendUrl ?? session.backendUrl;
  const expoBackendPort = session.expoBackendPort ?? session.backendPort;
  const expoBackendLogs = session.expoBackendLogs ?? session.backendLogs;

  return {
    ...session,
    expoBackendStatus,
    backendStatus: expoBackendStatus,
    expoBackendUrl,
    backendUrl: expoBackendUrl,
    expoBackendPort,
    backendPort: expoBackendPort,
    expoBackendLogs: expoBackendLogs?.slice(-200),
    proxiedWebUrl: undefined,
    logs: session.logs.slice(-200),
    backendLogs: expoBackendLogs?.slice(-200)
  };
}

function isMissingDevSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("session not found");
}

function isTransientDevRunnerError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  return (
    message.includes("status 502") ||
    message.includes("status 503") ||
    message.includes("status 504") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("cloudflare")
  );
}

async function clearProjectDevSession(projectId: string, reason: string): Promise<PublicProject> {
  const updated = await updateProject(projectId, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    devSession: undefined,
    messages: [...current.messages, createAssistantMessage(reason)]
  }));

  if (!updated) {
    throw new Error("Project not found");
  }

  return toPublicProject(updated);
}

function buildCommitMessage(prefix: "chore" | "feat", summary: string): string {
  const compact = summary.length > 100 ? `${summary.slice(0, 97)}...` : summary;
  return `${prefix}(ai): ${compact}`;
}

async function appendProjectOperationMessage(projectId: string, content: string): Promise<void> {
  await updateProject(projectId, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    messages: [...current.messages, createAssistantMessage(content)]
  }));
}

async function resolveRepoFileIndex(projectId: string, fallback: string[]): Promise<string[]> {
  try {
    return await listProjectRepoFiles(projectId);
  } catch {
    return fallback;
  }
}

export async function listPublicProjects(): Promise<PublicProject[]> {
  const projects = await listProjects();
  return projects.map(toPublicProject);
}

export async function getPublicProject(projectId: string): Promise<PublicProject | undefined> {
  const project = await getProject(projectId);
  return project ? toPublicProject(project) : undefined;
}

export async function createNewProject(projectName: string, sdkTarget?: string): Promise<PublicProject> {
  throw new Error(
    `Direct project creation is disabled. Use the workspace creation task endpoint instead (name=${projectName}, sdk=${sdkTarget ?? "55"}).`
  );
}

export async function connectStoreToProject(params: {
  projectId: string;
  shopDomain: string;
  accessToken?: string;
}): Promise<PublicProject> {
  const domain = params.shopDomain.trim().toLowerCase();
  if (!domain) {
    throw new Error("shopDomain is required");
  }

  const project = await getProject(params.projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  let stage = "initializing";

  const failStoreSetup = async (error: unknown): Promise<never> => {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await appendProjectOperationMessage(project.id, `Store setup failed: ${domain} (${stage}) - ${message}`);
    } catch {
      // Best effort log only.
    }

    throw new Error(`Store setup failed at ${stage}: ${message}`);
  };

  const workspaceLayout = resolveWorkspaceLayout(project);

  await appendProjectOperationMessage(project.id, `Store setup: started for ${domain}.`);

  const fallbackOrigin = process.env.NEXTJS_APP_BASE_URL?.trim() || process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
  const existingRuntimeSecrets = await getProjectRuntimeSecrets(project.id);
  const parsedRuntimeSecrets = parseRuntimeSecrets(existingRuntimeSecrets);
  const resolvedAccessToken = params.accessToken?.trim() || parsedRuntimeSecrets.shopify?.adminAccessToken?.trim();

  if (!resolvedAccessToken) {
    throw new Error("Shopify admin access token is required to connect store.");
  }

  let detectedCustomerAuth = parsedRuntimeSecrets.shopify?.customerAuth;

  try {
    stage = "detect_customer_auth";
    await appendProjectOperationMessage(project.id, "Store setup: detecting customer auth capabilities...");

    detectedCustomerAuth = await detectCustomerAuthState({
      shopDomain: domain,
      accessToken: resolvedAccessToken,
      fallbackOrigin,
      current: parsedRuntimeSecrets.shopify?.customerAuth,
    });
    await appendProjectOperationMessage(project.id, "Store setup: customer auth capabilities detected.");
  } catch {
    detectedCustomerAuth = parsedRuntimeSecrets.shopify?.customerAuth;
    await appendProjectOperationMessage(
      project.id,
      "Store setup: customer auth detection failed, using previously known customer auth settings."
    );
  }

  try {
    stage = "provision_runtime_database";
    await appendProjectOperationMessage(project.id, "Store setup: ensuring per-project runtime database...");

    const runtimeDatabasePatch = await buildRuntimeDatabaseSecretsPatch(project.id, existingRuntimeSecrets);
    if (Object.keys(runtimeDatabasePatch).length > 0) {
      await appendProjectOperationMessage(project.id, "Store setup: per-project runtime database provisioned.");
    } else {
      await appendProjectOperationMessage(project.id, "Store setup: per-project runtime database already available.");
    }

    stage = "sync_runtime_config";
    await appendProjectOperationMessage(project.id, "Store setup: syncing runtime config and secrets...");

    await upsertAndQueueProjectRuntimeSync({
      projectId: project.id,
      config: buildRuntimeConfigPatch(project, detectedCustomerAuth),
      secrets: {
        ...runtimeDatabasePatch,
        shopify: {
          shopDomain: domain,
          adminAccessToken: resolvedAccessToken,
          customerAuth: detectedCustomerAuth
            ? {
                ...detectedCustomerAuth,
                sessions: undefined
              }
            : undefined
        }
      }
    });

    stage = "seed_runtime_state_db";
    await appendProjectOperationMessage(project.id, "Store setup: writing runtime state into the project database...");
    await seedRuntimeStateInProjectDatabase(project.id);

    await appendProjectOperationMessage(project.id, "Store setup: runtime config and secrets synced.");

    stage = "persist_store_connection";
    await appendProjectOperationMessage(project.id, "Store setup: saving store connection metadata...");

    const now = new Date().toISOString();
    const connected = await updateProject(project.id, (current) => {
      return {
        ...current,
        updatedAt: now,
        store: {
          shopDomain: undefined,
          connectedAt: now,
          customerAuth: buildStoredCustomerAuthSummary(detectedCustomerAuth),
        },
        workspaceLayout: current.workspaceLayout ?? workspaceLayout,
        messages: [...current.messages, createAssistantMessage("Store setup: store metadata saved. Applying Shopify baseline...")]
      };
    });

    if (!connected) {
      throw new Error("Project not found");
    }

    stage = "generate_shopify_baseline";
    await appendProjectOperationMessage(project.id, "Store setup: generating Shopify baseline files...");

    const baselineInput = {
      projectId: connected.id,
      projectName: connected.name,
      shopDomain: domain,
      mobileAppDir: workspaceLayout.mobileAppDir,
      expoBackendDir: workspaceLayout.expoBackendDir,
      expoBackendPort: workspaceLayout.expoBackendPort,
      brandColor: connected.preview.primaryColor
    };

    const baselineFiles = renderShopifyBaselineFiles(baselineInput);

    validateShopifyBaselineFiles(baselineFiles, baselineInput);

    stage = "apply_shopify_baseline";
    await appendProjectOperationMessage(
      project.id,
      `Store setup: applying Shopify baseline to ${workspaceLayout.mobileAppDir}/ and ${workspaceLayout.expoBackendDir}/...`
    );

    const applied = await applyFilesToProjectRepo({
      projectId: connected.id,
      files: baselineFiles
    });

    const finalized = await updateProject(connected.id, (current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      fileIndex: applied.fileIndex,
      messages: [
        ...current.messages,
        createAssistantMessage(
          `Store setup: Shopify baseline applied to ${workspaceLayout.mobileAppDir}/ and ${workspaceLayout.expoBackendDir}/.`
        ),
        createAssistantMessage(`Store connected: ${domain}. Runtime configuration synced and baseline applied.`)
      ]
    }));

    const nextProject = finalized ?? connected;

    stage = "dispatch_runtime_sync";
    await appendProjectOperationMessage(project.id, "Store setup: dispatching runtime sync to active expo backend (if available)...");

    try {
      await dispatchProjectRuntimeSync({
        projectId: nextProject.id,
        expoBackendBaseUrl: nextProject.devSession?.expoBackendUrl ?? nextProject.devSession?.backendUrl,
      });
      await appendProjectOperationMessage(project.id, "Store setup: runtime sync dispatch completed.");
    } catch {
      await appendProjectOperationMessage(
        project.id,
        "Store setup: runtime sync dispatch skipped or failed. It can be retried from dev-session refresh."
      );
    }

    return toPublicProject(nextProject);
  } catch (error) {
    return failStoreSetup(error);
  }
}

export async function runPrompt(
  projectId: string,
  prompt: string,
  options?: { model?: string; thinking?: string }
): Promise<{ project: PublicProject; run: AiRun }> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error("Prompt is required");
  }

  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const aiOutput = await generateProjectUpdate(project, trimmedPrompt, {
    model: options?.model,
    thinking: options?.thinking
  });
  return persistPromptOutput(projectId, project, trimmedPrompt, aiOutput);
}

export async function runPromptFromPrecomputedOutput(
  projectId: string,
  prompt: string,
  aiOutput: AiOutput
): Promise<{ project: PublicProject; run: AiRun }> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error("Prompt is required");
  }

  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  return persistPromptOutput(projectId, project, trimmedPrompt, aiOutput);
}

async function persistPromptOutput(
  projectId: string,
  project: Project,
  trimmedPrompt: string,
  aiOutput: AiOutput
): Promise<{ project: PublicProject; run: AiRun }> {
  const changedFiles = aiOutput.changedFiles ?? [];

  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const commitMessage = buildCommitMessage("feat", aiOutput.summary);

  let run: AiRun = {
    id: runId,
    prompt: trimmedPrompt,
    summary: aiOutput.summary,
    changedFiles,
    status: "completed",
    commitMessage,
    createdAt
  };

  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: trimmedPrompt,
    createdAt
  };

  const assistantMessage = createAssistantMessage(
    `${aiOutput.summary}. Updated ${changedFiles.length} file(s) in the workspace repository.`,
    runId
  );

  const latestFileIndex = await resolveRepoFileIndex(projectId, project.fileIndex ?? []);

  let updated = await updateProject(projectId, (current) => ({
    ...current,
    updatedAt: createdAt,
    preview: aiOutput.preview,
    fileIndex: latestFileIndex,
    opencodeSession: aiOutput.opencodeSession ?? current.opencodeSession,
    runs: [run, ...current.runs].slice(0, 30),
    messages: [...current.messages, userMessage, assistantMessage]
  }));

  if (!updated) {
    throw new Error("Project not found");
  }

  return {
    project: toPublicProject(updated),
    run
  };
}

export async function getProjectStoreAdminAccessToken(projectId: string): Promise<string | undefined> {
  const secrets = await getProjectRuntimeSecrets(projectId);
  const parsed = parseRuntimeSecrets(secrets);
  return parsed.shopify?.adminAccessToken;
}

export async function startProjectDevSession(
  projectId: string,
  options?: { install?: boolean; useTunnel?: boolean; startBackend?: boolean }
): Promise<{ project: PublicProject; devSession: DevSessionState }> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  if (!project.github.enabled || !project.github.repoUrl) {
    throw new Error("GitHub repository is required before starting a dev session.");
  }

  try {
    const existingRuntimeSecrets = await getProjectRuntimeSecrets(project.id);
    const runtimeDatabasePatch = await buildRuntimeDatabaseSecretsPatch(project.id, existingRuntimeSecrets);
    if (Object.keys(runtimeDatabasePatch).length > 0) {
      await upsertAndQueueProjectRuntimeSync({
        projectId: project.id,
        config: buildRuntimeConfigPatch(project, project.store?.customerAuth),
        secrets: runtimeDatabasePatch
      });
    }

    await seedRuntimeStateInProjectDatabase(project.id);
  } catch (error) {
    if (project.store?.connectedAt) {
      throw error instanceof Error
        ? error
        : new Error("Failed to provision runtime database before starting dev session.");
    }
  }

  const workspaceLayout = resolveWorkspaceLayout(project);

  const session = await startDevRunnerSession({
    projectId: project.id,
    repoUrl: project.github.repoUrl,
    branch: "main",
    install: options?.install ?? true,
    useTunnel: options?.useTunnel ?? true,
    appDirectory: workspaceLayout.mobileAppDir,
    expoBackendDirectory: workspaceLayout.expoBackendDir,
    expoBackendPort: workspaceLayout.expoBackendPort,
    expoBackendStartCommand: workspaceLayout.expoBackendStartCommand,
    expoBackendHealthPath: "/api/health",
    startExpoBackend: options?.startBackend ?? true,
    injectExpoPublicRuntimeBackendUrl: true,
  });

  const normalized = normalizeDevSessionState(session);
  const sessionWithSyncAttempt = await waitForRuntimeBackendAndDispatchSync({
    projectId: project.id,
    sessionId: normalized.id,
    initialSession: normalized
  });

  const updated = await updateProject(project.id, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    workspaceLayout: current.workspaceLayout ?? workspaceLayout,
    devSession: sessionWithSyncAttempt,
    messages: [
      ...current.messages,
      createAssistantMessage(
        `Dev session started (${normalized.id}) for mobile (${workspaceLayout.mobileAppDir}) and expo backend (${workspaceLayout.expoBackendDir}).`
      )
    ]
  }));

  if (!updated) {
    throw new Error("Project not found");
  }

  return {
    project: toPublicProject(updated),
    devSession: sessionWithSyncAttempt,
  };
}

export async function refreshProjectDevSession(
  projectId: string,
  logLines = 200
): Promise<{ project: PublicProject; devSession?: DevSessionState }> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  if (!project.devSession?.id) {
    throw new Error("No active dev session found for this project.");
  }

  let session: DevSessionState;
  try {
    session = await getDevRunnerSessionStatus(project.devSession.id, logLines);
  } catch (error) {
    if (isMissingDevSessionError(error)) {
      const clearedProject = await clearProjectDevSession(
        project.id,
        "Dev session no longer exists on runner. Start a new session."
      );

      return {
        project: clearedProject,
        devSession: undefined
      };
    }

    if (isTransientDevRunnerError(error)) {
      const now = new Date().toISOString();
      const warningMessage = error instanceof Error ? error.message : String(error);

      const updated = await updateProject(project.id, (current) => ({
        ...current,
        updatedAt: now,
        devSession: current.devSession
          ? {
              ...current.devSession,
              updatedAt: now,
              error: `Runner temporarily unavailable: ${warningMessage}`
            }
          : current.devSession
      }));

      if (!updated) {
        throw new Error("Project not found");
      }

      return {
        project: toPublicProject(updated),
        devSession: updated.devSession
      };
    }

    throw error;
  }

  const normalized = normalizeDevSessionState(session);

  const updated = await updateProject(project.id, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    devSession: normalized
  }));

  if (!updated) {
    throw new Error("Project not found");
  }

  try {
    await dispatchProjectRuntimeSync({
      projectId: updated.id,
      expoBackendBaseUrl: normalized.expoBackendUrl ?? normalized.backendUrl,
    });
  } catch {
    // Runtime sync can be retried on next refresh.
  }

  return {
    project: toPublicProject(updated),
    devSession: normalized
  };
}

export async function stopProjectDevSession(
  projectId: string
): Promise<{ project: PublicProject; devSession?: DevSessionState }> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  if (!project.devSession?.id) {
    throw new Error("No active dev session found for this project.");
  }

  let session: DevSessionState;
  try {
    session = await stopDevRunnerSession(project.devSession.id);
  } catch (error) {
    if (isMissingDevSessionError(error)) {
      const clearedProject = await clearProjectDevSession(
        project.id,
        "Dev session was already gone on runner and has been cleared locally."
      );

      return {
        project: clearedProject,
        devSession: undefined
      };
    }

    throw error;
  }

  const normalized = normalizeDevSessionState(session);

  const updated = await updateProject(project.id, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    devSession: normalized,
    messages: [...current.messages, createAssistantMessage("Dev session stopped (mobile and expo backend).")]
  }));

  if (!updated) {
    throw new Error("Project not found");
  }

  return {
    project: toPublicProject(updated),
    devSession: normalized
  };
}

export async function applyProjectDevSessionAndPush(
  projectId: string,
  params?: { commitMessage?: string; runInstall?: boolean }
): Promise<{ project: PublicProject; devSession?: DevSessionState; committed: boolean; commitSha?: string }> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  if (!project.devSession?.id) {
    throw new Error("No active dev session found for this project.");
  }

  const commitMessage = params?.commitMessage?.trim() || project.runs[0]?.commitMessage || "feat: commit AI workspace changes";
  let result: { session: DevSessionState; committed: boolean; commitSha?: string };
  try {
    result = await applyAndPushToDevRunnerSession({
      sessionId: project.devSession.id,
      commitMessage,
      runInstall: params?.runInstall ?? false
    });
  } catch (error) {
    if (isMissingDevSessionError(error)) {
      const clearedProject = await clearProjectDevSession(
        project.id,
        "Dev session not found on runner during commit. Start a new session and retry."
      );

      return {
        project: clearedProject,
        devSession: undefined,
        committed: false
      };
    }

    throw error;
  }

  const normalized = normalizeDevSessionState(result.session);
  const latestFileIndex = await resolveRepoFileIndex(project.id, project.fileIndex ?? []);
  const updated = await updateProject(project.id, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    devSession: normalized,
    fileIndex: latestFileIndex,
    github:
      result.committed && result.commitSha
        ? {
            ...current.github,
            lastCommitSha: result.commitSha,
            lastCommitMessage: commitMessage,
            lastSyncedAt: new Date().toISOString(),
            error: undefined
          }
        : current.github,
    messages: [
      ...current.messages,
      createAssistantMessage(
        result.committed
          ? `Committed and pushed ${result.commitSha ?? "latest commit"}.`
          : "No uncommitted AI changes found."
      )
    ]
  }));

  if (!updated) {
    throw new Error("Project not found");
  }

  return {
    project: toPublicProject(updated),
    devSession: normalized,
    committed: result.committed,
    commitSha: result.commitSha
  };
}
