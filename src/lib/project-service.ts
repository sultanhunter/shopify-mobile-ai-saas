import { randomUUID } from "node:crypto";
import { getProject, listProjects, updateProject } from "@/lib/db";
import {
  applyFilesToProjectRepo,
  applyAndPushToDevRunnerSession,
  getDevRunnerSessionStatus,
  listProjectRepoFiles,
  startDevRunnerSession,
  stopDevRunnerSession
} from "@/lib/dev-runner";
import { renderShopifyBaselineFiles, validateShopifyBaselineFiles } from "@/lib/shopify-baseline";
import { detectCustomerAuthState } from "@/lib/shopify-customer-auth";
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
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

function getControlPlaneBaseUrl() {
  const appBaseUrl = process.env.NEXTJS_APP_BASE_URL?.trim() || process.env.APP_BASE_URL?.trim();
  if (appBaseUrl) {
    return appBaseUrl.replace(/\/$/, "");
  }

  return "http://localhost:3000";
}

function createAssistantMessage(content: string, runId?: string): ChatMessage {
  return {
    id: randomUUID(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    runId
  };
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

function toPublicProject(project: Project): PublicProject {
  const hasEncryptedToken = Boolean(project.store?.accessTokenEncrypted);
  const hasLegacyToken = Boolean(project.store?.accessToken);

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
          shopDomain: project.store.shopDomain,
          connectedAt: project.store.connectedAt,
          hasAccessToken: hasEncryptedToken || hasLegacyToken,
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
      issuer: authState.customerAccountApi.issuer,
      authorizationEndpoint: authState.customerAccountApi.authorizationEndpoint,
      tokenEndpoint: authState.customerAccountApi.tokenEndpoint,
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

  const workspaceLayout = resolveWorkspaceLayout(project);

  const fallbackOrigin = process.env.NEXTJS_APP_BASE_URL?.trim() || process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
  const resolvedAccessToken =
    params.accessToken?.trim() ||
    (project.store?.accessTokenEncrypted ? decryptSecret(project.store.accessTokenEncrypted) : project.store?.accessToken);
  let detectedCustomerAuth = project.store?.customerAuth;

  try {
    detectedCustomerAuth = await detectCustomerAuthState({
      shopDomain: domain,
      accessToken: resolvedAccessToken,
      fallbackOrigin,
      current: project.store?.customerAuth,
    });
  } catch {
    detectedCustomerAuth = project.store?.customerAuth;
  }

  const now = new Date().toISOString();
  const connected = await updateProject(project.id, (current) => {
    const encryptedAccessToken = params.accessToken
      ? encryptSecret(params.accessToken)
      : current.store?.accessTokenEncrypted;

    return {
      ...current,
      updatedAt: now,
      store: {
        shopDomain: domain,
        accessToken: params.accessToken ? undefined : current.store?.accessToken,
        accessTokenEncrypted: encryptedAccessToken,
        connectedAt: now,
        customerAuth: detectedCustomerAuth,
      },
      workspaceLayout: current.workspaceLayout ?? workspaceLayout,
      messages: [...current.messages, createAssistantMessage(`Store connected: ${domain}. Applying Shopify baseline...`)]
    };
  });

  if (!connected) {
    throw new Error("Project not found");
  }

  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const baselineInput = {
    projectId: connected.id,
    projectName: connected.name,
    shopDomain: domain,
    controlPlaneBaseUrl,
    mobileAppDir: workspaceLayout.mobileAppDir,
    expoBackendDir: workspaceLayout.expoBackendDir,
    expoBackendPort: workspaceLayout.expoBackendPort,
    brandColor: connected.preview.primaryColor
  };

  const baselineFiles = renderShopifyBaselineFiles(baselineInput);

  validateShopifyBaselineFiles(baselineFiles, baselineInput);

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
          `Store connected: ${domain}. Shopify baseline was applied to ${workspaceLayout.mobileAppDir}/ and ${workspaceLayout.expoBackendDir}/.`
        )
      ]
    }));

  return toPublicProject(finalized ?? connected);
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
  const project = await getProject(projectId);
  if (!project?.store) {
    return undefined;
  }

  if (project.store.accessTokenEncrypted) {
    return decryptSecret(project.store.accessTokenEncrypted);
  }

  return project.store.accessToken;
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

  const workspaceLayout = resolveWorkspaceLayout(project);

  const session = await startDevRunnerSession({
    projectId: project.id,
    repoUrl: project.github.repoUrl,
    controlPlaneBaseUrl: getControlPlaneBaseUrl(),
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
  const updated = await updateProject(project.id, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    workspaceLayout: current.workspaceLayout ?? workspaceLayout,
    devSession: normalized,
    messages: [
      ...current.messages,
      createAssistantMessage(
        `Dev session started (${normalized.id}) for mobile (${workspaceLayout.mobileAppDir}) and expo backend (${workspaceLayout.expoBackendDir}). Waiting for URLs...`
      )
    ]
  }));

  if (!updated) {
    throw new Error("Project not found");
  }

  return {
    project: toPublicProject(updated),
    devSession: normalized,
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
