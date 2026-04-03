import { Project } from "@/lib/models";

interface RuntimeJsonResponse<T> {
  ok: boolean;
  status: number;
  payload: T | null;
  error?: string;
}

function parseRuntimeToken(): string | undefined {
  return process.env.RUNTIME_SYNC_TOKEN?.trim() || process.env.RUNNER_SERVER_TOKEN?.trim() || undefined;
}

function getPayloadError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const value = (payload as Record<string, unknown>).error;
  return typeof value === "string" ? value : undefined;
}

export function resolveProjectRuntimeBaseUrl(project: Pick<Project, "devSession">): string | undefined {
  const value = project.devSession?.expoBackendUrl ?? project.devSession?.backendUrl;
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/$/, "") : undefined;
}

async function requestRuntimeJson<T>(params: {
  baseUrl: string;
  path: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  internalAuth?: boolean;
}): Promise<RuntimeJsonResponse<T>> {
  const headers: HeadersInit = {
    "Content-Type": "application/json"
  };

  if (params.internalAuth) {
    const token = parseRuntimeToken();
    if (!token) {
      throw new Error("RUNTIME_SYNC_TOKEN is required for internal runtime admin requests.");
    }

    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${params.baseUrl}${params.path}`, {
    method: params.method,
    headers,
    ...(params.body ? { body: JSON.stringify(params.body) } : {})
  });

  const payload = (await response.json().catch(() => null)) as T | null;
  const payloadError = getPayloadError(payload);

  return {
    ok: response.ok,
    status: response.status,
    payload,
    error: payloadError
  };
}

export async function proxyRuntimeCustomerAuthStart(baseUrl: string): Promise<RuntimeJsonResponse<Record<string, unknown>>> {
  return requestRuntimeJson<Record<string, unknown>>({
    baseUrl,
    path: "/api/customer-auth/start",
    method: "POST"
  });
}

export async function proxyRuntimeCustomerAuthSession(
  baseUrl: string,
  sessionId: string
): Promise<RuntimeJsonResponse<Record<string, unknown>>> {
  return requestRuntimeJson<Record<string, unknown>>({
    baseUrl,
    path: `/api/customer-auth/session/${encodeURIComponent(sessionId)}`,
    method: "GET"
  });
}

export async function proxyRuntimeCustomerAuthRefresh(
  baseUrl: string,
  refreshToken: string
): Promise<RuntimeJsonResponse<Record<string, unknown>>> {
  return requestRuntimeJson<Record<string, unknown>>({
    baseUrl,
    path: "/api/customer-auth/refresh",
    method: "POST",
    body: { refreshToken }
  });
}

export async function completeRuntimeCustomerAuthCallback(
  baseUrl: string,
  input: {
    sessionId: string;
    code?: string;
    oauthError?: string;
    oauthErrorDescription?: string;
    shopDomain?: string;
  }
): Promise<RuntimeJsonResponse<{ status?: string; error?: string }>> {
  return requestRuntimeJson<{ status?: string; error?: string }>({
    baseUrl,
    path: "/internal/admin/customer-auth/callback",
    method: "POST",
    internalAuth: true,
    body: {
      sessionId: input.sessionId,
      code: input.code,
      oauthError: input.oauthError,
      oauthErrorDescription: input.oauthErrorDescription,
      shopDomain: input.shopDomain
    }
  });
}
