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
import { generateProjectUpdate } from "@/lib/llm";
import { AiOutput } from "@/lib/ai-engine";
import { AiRun, ChatMessage, DevSessionState, Project, PublicProject } from "@/lib/models";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

function getBackendBaseUrl() {
  const mobileBackendBaseUrl = process.env.MOBILE_BACKEND_BASE_URL?.trim();
  if (mobileBackendBaseUrl) {
    return mobileBackendBaseUrl.replace(/\/$/, "");
  }

  const appBaseUrl = process.env.APP_BASE_URL?.trim();
  if (appBaseUrl) {
    return appBaseUrl.replace(/\/$/, "");
  }

  const aiServerBaseUrl = process.env.AI_SERVER_BASE_URL?.trim();
  if (aiServerBaseUrl) {
    return aiServerBaseUrl.replace(/\/$/, "");
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
    store: project.store
      ? {
          shopDomain: project.store.shopDomain,
          connectedAt: project.store.connectedAt,
          hasAccessToken: hasEncryptedToken || hasLegacyToken
        }
      : undefined,
    github: project.github,
    fileIndex: [...(project.fileIndex ?? [])]
  };
}

function normalizeDevSessionState(session: DevSessionState): DevSessionState {
  return {
    ...session,
    proxiedWebUrl: undefined,
    logs: session.logs.slice(-200)
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
        connectedAt: now
      },
      messages: [...current.messages, createAssistantMessage(`Store connected: ${domain}. Applying Shopify baseline...`)]
    };
  });

  if (!connected) {
    throw new Error("Project not found");
  }

  const baselineFiles = renderShopifyBaselineFiles({
    projectId: connected.id,
    projectName: connected.name,
    shopDomain: domain,
    backendBaseUrl: getBackendBaseUrl(),
    brandColor: connected.preview.primaryColor
  });

  validateShopifyBaselineFiles(baselineFiles);

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
        `Store connected: ${domain}. Shopify baseline commerce screens (home, products, cart, checkout) are now applied locally.`
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
  options?: { install?: boolean; useTunnel?: boolean }
): Promise<{ project: PublicProject; devSession: DevSessionState }> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  if (!project.github.enabled || !project.github.repoUrl) {
    throw new Error("GitHub repository is required before starting a dev session.");
  }

  const session = await startDevRunnerSession({
    projectId: project.id,
    repoUrl: project.github.repoUrl,
    branch: "main",
    install: options?.install ?? true,
    useTunnel: options?.useTunnel ?? true
  });

  const normalized = normalizeDevSessionState(session);
  const updated = await updateProject(project.id, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    devSession: normalized,
    messages: [
      ...current.messages,
      createAssistantMessage(`Dev session started (${normalized.id}). Waiting for Expo URLs...`)
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
    messages: [...current.messages, createAssistantMessage("Dev session stopped.")]
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
