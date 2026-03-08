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

function getDevRunnerBaseUrl(): string {
  const baseUrl = process.env.AI_SERVER_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("AI_SERVER_BASE_URL is missing.");
  }

  return baseUrl.replace(/\/$/, "");
}

function buildHeaders(): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json"
  };

  const token = process.env.AI_SERVER_TOKEN?.trim();
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
  branch?: string;
  install?: boolean;
  useTunnel?: boolean;
}): Promise<DevSessionState> {
  const response = await fetch(`${getDevRunnerBaseUrl()}/api/shopify-mobile/dev-session/start`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(input)
  });

  const payload = await parseJson<DevRunnerSessionResponse>(response);
  if (!response.ok || !payload?.session) {
    throw new Error(await buildUpstreamError(response, "Failed to start dev session", payload?.error));
  }

  return payload.session;
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
