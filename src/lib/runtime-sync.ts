import {
  enqueueRuntimeSyncEvent,
  getProjectRuntimeState,
  listPendingRuntimeSyncEvents,
  markRuntimeSyncEventDelivered,
  markRuntimeSyncEventFailed,
  upsertProjectRuntimeState
} from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

export interface RuntimeSnapshot {
  projectId: string;
  version: number;
  config: Record<string, unknown>;
  secrets: Record<string, unknown>;
}

type RuntimeSyncUpsertInput =
  | string
  | {
      projectId: string;
      config?: Record<string, unknown>;
      secrets?: Record<string, unknown>;
    };

function getRuntimeSyncToken(): string | undefined {
  return process.env.RUNTIME_SYNC_TOKEN?.trim() || process.env.RUNNER_SERVER_TOKEN?.trim() || undefined;
}

function getRuntimeSyncRequestTimeoutMs(): number {
  const parsed = Number(process.env.RUNTIME_SYNC_TIMEOUT_MS ?? "15000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15000;
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeRecords(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    const previous = next[key];
    if (isRecord(previous) && isRecord(value)) {
      next[key] = mergeRecords(previous, value);
      continue;
    }

    next[key] = value;
  }

  return next;
}

function encodeRuntimeSecrets(secrets: Record<string, unknown>): Record<string, unknown> {
  return {
    payloadEncrypted: encryptSecret(JSON.stringify(secrets))
  };
}

function decodeRuntimeSecrets(secretsEncrypted: Record<string, unknown>): Record<string, unknown> {
  const encrypted = typeof secretsEncrypted.payloadEncrypted === "string" ? secretsEncrypted.payloadEncrypted : undefined;

  if (!encrypted) {
    return {};
  }

  try {
    const decrypted = decryptSecret(encrypted);
    const parsed = JSON.parse(decrypted) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function getProjectRuntimeSnapshot(projectId: string): Promise<RuntimeSnapshot | undefined> {
  const runtimeState = await getProjectRuntimeState(projectId);
  if (!runtimeState) {
    return undefined;
  }

  return {
    projectId: runtimeState.projectId,
    version: runtimeState.version,
    config: runtimeState.config,
    secrets: decodeRuntimeSecrets(runtimeState.secretsEncrypted)
  };
}

export async function getProjectRuntimeSecrets(projectId: string): Promise<Record<string, unknown>> {
  const snapshot = await getProjectRuntimeSnapshot(projectId);
  return snapshot?.secrets ?? {};
}

export async function upsertAndQueueProjectRuntimeSync(input: RuntimeSyncUpsertInput): Promise<{ version?: number }> {
  const projectId = typeof input === "string" ? input : input.projectId;
  const existingState = await getProjectRuntimeState(projectId);
  const existingConfig = existingState?.config ?? {};
  const existingSecrets = existingState ? decodeRuntimeSecrets(existingState.secretsEncrypted) : {};

  const configPatch = typeof input === "string" ? {} : input.config ?? {};
  const secretsPatch = typeof input === "string" ? {} : input.secrets ?? {};

  const nextConfig = mergeRecords(existingConfig, configPatch);
  const nextSecrets = mergeRecords(existingSecrets, secretsPatch);

  if (!existingState && typeof input === "string") {
    throw new Error("Runtime sync state does not exist yet for this project.");
  }

  const nextState = await upsertProjectRuntimeState({
    projectId,
    config: nextConfig,
    secretsEncrypted: encodeRuntimeSecrets(nextSecrets)
  });

  const pendingEvents = await listPendingRuntimeSyncEvents(projectId, 10);
  const hasCurrentVersionPending = pendingEvents.some((event) => event.version === nextState.version);
  if (!hasCurrentVersionPending) {
    await enqueueRuntimeSyncEvent({
      projectId,
      version: nextState.version
    });
  }

  return { version: nextState.version };
}

export async function dispatchProjectRuntimeSync(params: {
  projectId: string;
  expoBackendBaseUrl?: string;
}): Promise<{ delivered: number }> {
  const baseUrl = normalizeBaseUrl(params.expoBackendBaseUrl);
  if (!baseUrl) {
    return { delivered: 0 };
  }

  const runtimeState = await getProjectRuntimeState(params.projectId);
  if (!runtimeState) {
    return { delivered: 0 };
  }

  const events = await listPendingRuntimeSyncEvents(params.projectId, 20);
  if (events.length === 0) {
    return { delivered: 0 };
  }

  const token = getRuntimeSyncToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getRuntimeSyncRequestTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}/internal/runtime/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        projectId: params.projectId,
        version: runtimeState.version,
        config: runtimeState.config,
        secrets: decodeRuntimeSecrets(runtimeState.secretsEncrypted)
      }),
      signal: controller.signal
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      const errorMessage = payload?.error ?? `Runtime sync failed with ${response.status}`;
      throw new Error(errorMessage);
    }

    for (const event of events) {
      await markRuntimeSyncEventDelivered(event.id);
    }

    return { delivered: events.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runtime sync request failed.";
    for (const event of events) {
      await markRuntimeSyncEventFailed(event.id, message);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
