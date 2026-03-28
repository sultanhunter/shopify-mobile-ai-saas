import { DevSessionState } from "@/lib/models";

interface DevRunnerSessionResponse {
  session?: DevSessionState;
  error?: string;
}

interface DevRunnerApplyResponse {
  session?: DevSessionState;
  committed?: boolean;
  commitSha?: string;
  error?: string;
}

interface DevRunnerRepoFilesResponse {
  files?: string[];
  error?: string;
}

interface DevRunnerRepoFileResponse {
  path?: string;
  isBinary?: boolean;
  content?: string;
  error?: string;
}

interface DevRunnerRepoApplyResponse {
  written?: string[];
  fileIndex?: string[];
  error?: string;
}

function getDevRunnerBaseUrl(): string {
  const baseUrl = process.env.RUNNER_SERVER_BASE_URL?.trim() || process.env.AI_SERVER_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("RUNNER_SERVER_BASE_URL is missing.");
  }

  return baseUrl.replace(/\/$/, "");
}

function buildHeaders(): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json"
  };

  const token = process.env.RUNNER_SERVER_TOKEN?.trim() || process.env.AI_SERVER_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function parseJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

async function buildUpstreamError(response: Response, fallback: string, payloadError?: string): Promise<string> {
  if (payloadError) {
    return payloadError;
  }

  const text = await response.text().catch(() => "");
  const compactText = text.replace(/\s+/g, " ").trim().slice(0, 180);

  if (compactText) {
    return `${fallback} (status ${response.status}): ${compactText}`;
  }

  return `${fallback} (status ${response.status})`;
}

export async function startDevRunnerSession(input: {
  projectId: string;
  repoUrl: string;
  controlPlaneBaseUrl?: string;
  branch?: string;
  install?: boolean;
  useTunnel?: boolean;
  appDirectory?: string;
  expoBackendDirectory?: string;
  expoBackendPort?: number;
  expoBackendStartCommand?: string;
  expoBackendHealthPath?: string;
  startExpoBackend?: boolean;
  backendDirectory?: string;
  backendPort?: number;
  backendStartCommand?: string;
  backendHealthPath?: string;
  startBackend?: boolean;
  injectExpoPublicRuntimeBackendUrl?: boolean;
}): Promise<DevSessionState> {
  async function postStart(payload: Record<string, unknown>) {
    const response = await fetch(`${getDevRunnerBaseUrl()}/api/shopify-mobile/dev-session/start`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload)
    });

    const body = await parseJson<DevRunnerSessionResponse>(response);
    return { response, body };
  }

  const normalizedPayload = {
    ...input,
    backendDirectory: input.backendDirectory ?? input.expoBackendDirectory,
    backendPort: input.backendPort ?? input.expoBackendPort,
    backendStartCommand: input.backendStartCommand ?? input.expoBackendStartCommand,
    backendHealthPath: input.backendHealthPath ?? input.expoBackendHealthPath,
    startBackend: input.startBackend ?? input.startExpoBackend,
    expoBackendDirectory: input.expoBackendDirectory ?? input.backendDirectory,
    expoBackendPort: input.expoBackendPort ?? input.backendPort,
    expoBackendStartCommand: input.expoBackendStartCommand ?? input.backendStartCommand,
    expoBackendHealthPath: input.expoBackendHealthPath ?? input.backendHealthPath,
    startExpoBackend: input.startExpoBackend ?? input.startBackend,
  };

  const firstAttempt = await postStart(normalizedPayload as unknown as Record<string, unknown>);
  if (!firstAttempt.response.ok || !firstAttempt.body?.session) {
    const shouldRetryLegacy =
      firstAttempt.response.status >= 400 &&
      firstAttempt.response.status < 500 &&
      (input.appDirectory !== undefined ||
        input.backendDirectory !== undefined ||
        input.expoBackendDirectory !== undefined ||
        input.backendStartCommand !== undefined ||
        input.expoBackendStartCommand !== undefined ||
        input.startBackend !== undefined ||
        input.startExpoBackend !== undefined ||
        input.injectExpoPublicRuntimeBackendUrl !== undefined);

    if (shouldRetryLegacy) {
      const legacyAttempt = await postStart({
        projectId: input.projectId,
        repoUrl: input.repoUrl,
        branch: input.branch,
        install: input.install,
        useTunnel: input.useTunnel
      });

      if (!legacyAttempt.response.ok || !legacyAttempt.body?.session) {
        throw new Error(
          await buildUpstreamError(legacyAttempt.response, "Failed to start dev session", legacyAttempt.body?.error)
        );
      }

      return legacyAttempt.body.session;
    }

    throw new Error(await buildUpstreamError(firstAttempt.response, "Failed to start dev session", firstAttempt.body?.error));
  }

  return firstAttempt.body.session;
}

export async function getDevRunnerSessionStatus(sessionId: string, logLines = 200): Promise<DevSessionState> {
  const response = await fetch(
    `${getDevRunnerBaseUrl()}/api/shopify-mobile/dev-session/${encodeURIComponent(sessionId)}/status?logLines=${logLines}`,
    {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store"
    }
  );

  const payload = await parseJson<DevRunnerSessionResponse>(response);
  if (!response.ok || !payload?.session) {
    throw new Error(await buildUpstreamError(response, "Failed to fetch dev session status", payload?.error));
  }

  return payload.session;
}

export async function stopDevRunnerSession(sessionId: string): Promise<DevSessionState> {
  const response = await fetch(`${getDevRunnerBaseUrl()}/api/shopify-mobile/dev-session/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
    headers: buildHeaders()
  });

  const payload = await parseJson<DevRunnerSessionResponse>(response);
  if (!response.ok || !payload?.session) {
    throw new Error(await buildUpstreamError(response, "Failed to stop dev session", payload?.error));
  }

  return payload.session;
}

export async function applyAndPushToDevRunnerSession(input: {
  sessionId: string;
  files?: Record<string, string>;
  commitMessage?: string;
  runInstall?: boolean;
}): Promise<{ session: DevSessionState; committed: boolean; commitSha?: string }> {
  const response = await fetch(
    `${getDevRunnerBaseUrl()}/api/shopify-mobile/dev-session/${encodeURIComponent(input.sessionId)}/apply-and-push`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        files: input.files,
        commitMessage: input.commitMessage,
        runInstall: input.runInstall
      })
    }
  );

  const payload = await parseJson<DevRunnerApplyResponse>(response);
  if (!response.ok || !payload?.session || typeof payload.committed !== "boolean") {
    throw new Error(
      await buildUpstreamError(response, "Failed to commit and push changes from dev session", payload?.error)
    );
  }

  return {
    session: payload.session,
    committed: payload.committed,
    commitSha: payload.commitSha
  };
}

export async function listProjectRepoFiles(projectId: string): Promise<string[]> {
  const response = await fetch(
    `${getDevRunnerBaseUrl()}/api/shopify-mobile/repo/${encodeURIComponent(projectId)}/files`,
    {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store"
    }
  );

  const payload = await parseJson<DevRunnerRepoFilesResponse>(response);
  if (!response.ok || !Array.isArray(payload?.files)) {
    throw new Error(await buildUpstreamError(response, "Failed to list repository files", payload?.error));
  }

  return payload.files;
}

export async function readProjectRepoFile(projectId: string, filePath: string): Promise<{
  path: string;
  isBinary: boolean;
  content: string;
}> {
  const response = await fetch(
    `${getDevRunnerBaseUrl()}/api/shopify-mobile/repo/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(filePath)}`,
    {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store"
    }
  );

  const payload = await parseJson<DevRunnerRepoFileResponse>(response);
  if (!response.ok || !payload?.path || typeof payload.isBinary !== "boolean" || typeof payload.content !== "string") {
    throw new Error(await buildUpstreamError(response, "Failed to read repository file", payload?.error));
  }

  return {
    path: payload.path,
    isBinary: payload.isBinary,
    content: payload.content,
  };
}

export async function applyFilesToProjectRepo(input: {
  projectId: string;
  files: Record<string, string>;
}): Promise<{ written: string[]; fileIndex: string[] }> {
  const response = await fetch(
    `${getDevRunnerBaseUrl()}/api/shopify-mobile/repo/${encodeURIComponent(input.projectId)}/apply-files`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ files: input.files })
    }
  );

  const payload = await parseJson<DevRunnerRepoApplyResponse>(response);
  if (!response.ok || !Array.isArray(payload?.written) || !Array.isArray(payload?.fileIndex)) {
    throw new Error(await buildUpstreamError(response, "Failed to apply repository files", payload?.error));
  }

  return {
    written: payload.written,
    fileIndex: payload.fileIndex,
  };
}
