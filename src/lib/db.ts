import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Project } from "@/lib/models";

interface ProjectRow {
  id: string;
  project: Project;
  created_at: string;
  updated_at: string;
}

export type WorkspaceTaskStatus = "queued" | "running" | "completed" | "failed";

interface WorkspaceTaskRow {
  id: string;
  type: string;
  status: WorkspaceTaskStatus;
  project_id: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectRuntimeConfigRow {
  project_id: string;
  config_json: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ProjectRuntimeSecretsRow {
  project_id: string;
  secrets_enc_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface RuntimeSyncOutboxRow {
  id: number;
  project_id: string;
  version: number;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceTask {
  id: string;
  type: string;
  status: WorkspaceTaskStatus;
  projectId?: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRuntimeState {
  projectId: string;
  config: Record<string, unknown>;
  secretsEncrypted: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeSyncEvent {
  id: number;
  projectId: string;
  version: number;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

let cachedClient: SupabaseClient | null = null;
let writeChain = Promise.resolve();

function getSupabaseUrl(): string {
  const value = process.env.SUPABASE_URL?.trim();
  if (!value) {
    throw new Error("SUPABASE_URL is required.");
  }

  return value;
}

function getSupabaseServiceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  return value;
}

function getProjectsTableName(): string {
  return process.env.SUPABASE_PROJECTS_TABLE?.trim() || "projects";
}

function getTasksTableName(): string {
  return process.env.SUPABASE_TASKS_TABLE?.trim() || "tasks";
}

function getRuntimeConfigTableName(): string {
  return process.env.SUPABASE_RUNTIME_CONFIG_TABLE?.trim() || "project_runtime_config";
}

function getRuntimeSecretsTableName(): string {
  return process.env.SUPABASE_RUNTIME_SECRETS_TABLE?.trim() || "project_runtime_secrets";
}

function getRuntimeSyncOutboxTableName(): string {
  return process.env.SUPABASE_RUNTIME_SYNC_OUTBOX_TABLE?.trim() || "runtime_sync_outbox";
}

function getSupabaseClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return cachedClient;
}

function sortProjects(projects: Project[]): Project[] {
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeTask(row: WorkspaceTaskRow | null): WorkspaceTask | undefined {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    projectId: row.project_id ?? undefined,
    payload: row.payload ?? undefined,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeRuntimeState(
  configRow: ProjectRuntimeConfigRow | null,
  secretsRow: ProjectRuntimeSecretsRow | null
): ProjectRuntimeState | undefined {
  if (!configRow && !secretsRow) {
    return undefined;
  }

  return {
    projectId: configRow?.project_id ?? secretsRow?.project_id ?? "",
    config: (configRow?.config_json ?? {}) as Record<string, unknown>,
    secretsEncrypted: (secretsRow?.secrets_enc_json ?? {}) as Record<string, unknown>,
    version: Number(configRow?.version ?? 0),
    createdAt: configRow?.created_at ?? secretsRow?.created_at ?? new Date().toISOString(),
    updatedAt: configRow?.updated_at ?? secretsRow?.updated_at ?? new Date().toISOString(),
  };
}

function normalizeRuntimeSyncEvent(row: RuntimeSyncOutboxRow | null): RuntimeSyncEvent | undefined {
  if (!row) {
    return undefined;
  }

  const status = row.status === "delivered" || row.status === "failed" ? row.status : "pending";
  return {
    id: row.id,
    projectId: row.project_id,
    version: Number(row.version ?? 0),
    status,
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeProject(value: unknown): Project | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const project = value as Project;
  if (typeof project.id !== "string" || typeof project.updatedAt !== "string") {
    return null;
  }

  const anyProject = project as unknown as { fileIndex?: unknown; files?: unknown };
  if (!Array.isArray(anyProject.fileIndex)) {
    const legacyFiles = anyProject.files && typeof anyProject.files === "object"
      ? Object.keys(anyProject.files as Record<string, unknown>).sort((a, b) => a.localeCompare(b))
      : [];
    project.fileIndex = legacyFiles;
  }

  return project;
}

function mergeProjectForConcurrentUpdates(updatedProject: Project, latestProject: Project | null): Project {
  if (!latestProject) {
    return updatedProject;
  }

  const merged: Project = {
    ...updatedProject,
  };

  if (!merged.store && latestProject.store) {
    merged.store = latestProject.store;
  }

  if (merged.store && latestProject.store) {
    merged.store = {
      shopDomain: merged.store.shopDomain,
      connectedAt: merged.store.connectedAt || latestProject.store.connectedAt,
      customerAuth: merged.store.customerAuth || latestProject.store.customerAuth,
    };
  }

  return merged;
}

async function fetchProjectRow(projectId: string): Promise<ProjectRow | null> {
  const { data, error } = await getSupabaseClient()
    .from(getProjectsTableName())
    .select("id, project, created_at, updated_at")
    .eq("id", projectId)
    .maybeSingle<ProjectRow>();

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  return data ?? null;
}

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await getSupabaseClient()
    .from(getProjectsTableName())
    .select("project")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Supabase list failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ project?: unknown }>;
  const projects = rows
    .map((row: { project?: unknown }) => normalizeProject(row.project))
    .filter((project: Project | null): project is Project => project !== null);

  return sortProjects(projects);
}

export async function getProject(projectId: string): Promise<Project | undefined> {
  const row = await fetchProjectRow(projectId);
  if (!row) {
    return undefined;
  }

  return normalizeProject(row.project) ?? undefined;
}

export async function createProject(project: Project): Promise<void> {
  writeChain = writeChain.then(async () => {
    const row: ProjectRow = {
      id: project.id,
      project,
      created_at: project.createdAt,
      updated_at: project.updatedAt
    };

    const { error } = await getSupabaseClient().from(getProjectsTableName()).insert(row);
    if (error) {
      throw new Error(`Supabase insert failed: ${error.message}`);
    }
  });

  await writeChain;
}

export async function updateProject(
  projectId: string,
  updater: (project: Project) => Project
): Promise<Project | undefined> {
  let updatedProject: Project | undefined;

  writeChain = writeChain.then(async () => {
    const existing = await fetchProjectRow(projectId);
    if (!existing) {
      updatedProject = undefined;
      return;
    }

    const existingProject = normalizeProject(existing.project);
    if (!existingProject) {
      throw new Error(`Corrupt project payload for id ${projectId}`);
    }

    updatedProject = updater(existingProject);

    const latestRow = await fetchProjectRow(projectId);
    const latestProject = latestRow ? normalizeProject(latestRow.project) : null;
    if (updatedProject) {
      updatedProject = mergeProjectForConcurrentUpdates(updatedProject, latestProject);
    }

    const row: ProjectRow = {
      id: projectId,
      project: updatedProject,
      created_at: updatedProject.createdAt,
      updated_at: updatedProject.updatedAt
    };

    const { error } = await getSupabaseClient().from(getProjectsTableName()).upsert(row, { onConflict: "id" });
    if (error) {
      throw new Error(`Supabase update failed: ${error.message}`);
    }
  });

  await writeChain;
  return updatedProject;
}

export async function getWorkspaceTask(taskId: string): Promise<WorkspaceTask | undefined> {
  const { data, error } = await getSupabaseClient()
    .from(getTasksTableName())
    .select("id, type, status, project_id, payload, result, error, created_at, updated_at")
    .eq("id", taskId)
    .maybeSingle<WorkspaceTaskRow>();

  if (error) {
    throw new Error(`Supabase task fetch failed: ${error.message}`);
  }

  return normalizeTask(data ?? null);
}

export async function getProjectRuntimeState(projectId: string): Promise<ProjectRuntimeState | undefined> {
  const [configResult, secretsResult] = await Promise.all([
    getSupabaseClient()
      .from(getRuntimeConfigTableName())
      .select("project_id, config_json, version, created_at, updated_at")
      .eq("project_id", projectId)
      .maybeSingle<ProjectRuntimeConfigRow>(),
    getSupabaseClient()
      .from(getRuntimeSecretsTableName())
      .select("project_id, secrets_enc_json, created_at, updated_at")
      .eq("project_id", projectId)
      .maybeSingle<ProjectRuntimeSecretsRow>()
  ]);

  if (configResult.error) {
    throw new Error(`Supabase runtime-config fetch failed: ${configResult.error.message}`);
  }

  if (secretsResult.error) {
    throw new Error(`Supabase runtime-secrets fetch failed: ${secretsResult.error.message}`);
  }

  return normalizeRuntimeState(configResult.data ?? null, secretsResult.data ?? null);
}

export async function upsertProjectRuntimeState(input: {
  projectId: string;
  config: Record<string, unknown>;
  secretsEncrypted: Record<string, unknown>;
}): Promise<ProjectRuntimeState> {
  let nextState: ProjectRuntimeState | undefined;

  writeChain = writeChain.then(async () => {
    const existing = await getProjectRuntimeState(input.projectId);
    const hasConfigChanged = JSON.stringify(existing?.config ?? {}) !== JSON.stringify(input.config ?? {});
    const hasSecretsChanged =
      JSON.stringify(existing?.secretsEncrypted ?? {}) !== JSON.stringify(input.secretsEncrypted ?? {});

    if (existing && !hasConfigChanged && !hasSecretsChanged) {
      nextState = existing;
      return;
    }

    const version = (existing?.version ?? 0) + 1;
    const now = new Date().toISOString();

    const configRow: ProjectRuntimeConfigRow = {
      project_id: input.projectId,
      config_json: input.config,
      version,
      created_at: existing?.createdAt ?? new Date().toISOString(),
      updated_at: now,
    };

    const secretsRow: ProjectRuntimeSecretsRow = {
      project_id: input.projectId,
      secrets_enc_json: input.secretsEncrypted,
      created_at: existing?.createdAt ?? new Date().toISOString(),
      updated_at: now,
    };

    const [configUpsert, secretsUpsert] = await Promise.all([
      getSupabaseClient().from(getRuntimeConfigTableName()).upsert(configRow, { onConflict: "project_id" }),
      getSupabaseClient().from(getRuntimeSecretsTableName()).upsert(secretsRow, { onConflict: "project_id" })
    ]);

    if (configUpsert.error) {
      throw new Error(`Supabase runtime-config upsert failed: ${configUpsert.error.message}`);
    }

    if (secretsUpsert.error) {
      throw new Error(`Supabase runtime-secrets upsert failed: ${secretsUpsert.error.message}`);
    }

    nextState = {
      projectId: configRow.project_id,
      config: configRow.config_json,
      secretsEncrypted: secretsRow.secrets_enc_json,
      version: configRow.version,
      createdAt: configRow.created_at,
      updatedAt: configRow.updated_at,
    };
  });

  await writeChain;

  if (!nextState) {
    throw new Error("Failed to upsert runtime state.");
  }

  return nextState;
}

export async function enqueueRuntimeSyncEvent(input: {
  projectId: string;
  version: number;
}): Promise<RuntimeSyncEvent> {
  const row: Partial<RuntimeSyncOutboxRow> = {
    project_id: input.projectId,
    version: input.version,
    status: "pending",
    attempts: 0,
    last_error: null,
  };

  const { data, error } = await getSupabaseClient()
    .from(getRuntimeSyncOutboxTableName())
    .insert(row)
    .select("id, project_id, version, status, attempts, last_error, created_at, updated_at")
    .single<RuntimeSyncOutboxRow>();

  if (error || !data) {
    throw new Error(`Supabase runtime-sync event insert failed: ${error?.message ?? "Unknown error"}`);
  }

  const normalized = normalizeRuntimeSyncEvent(data);
  if (!normalized) {
    throw new Error("Failed to normalize runtime sync event.");
  }

  return normalized;
}

export async function listPendingRuntimeSyncEvents(projectId: string, limit = 20): Promise<RuntimeSyncEvent[]> {
  const { data, error } = await getSupabaseClient()
    .from(getRuntimeSyncOutboxTableName())
    .select("id, project_id, version, status, attempts, last_error, created_at, updated_at")
    .eq("project_id", projectId)
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Supabase runtime-sync events list failed: ${error.message}`);
  }

  return ((data ?? []) as RuntimeSyncOutboxRow[])
    .map((row) => normalizeRuntimeSyncEvent(row))
    .filter((row): row is RuntimeSyncEvent => Boolean(row));
}

export async function markRuntimeSyncEventDelivered(eventId: number): Promise<void> {
  const { error } = await getSupabaseClient()
    .from(getRuntimeSyncOutboxTableName())
    .update({ status: "delivered", last_error: null })
    .eq("id", eventId);

  if (error) {
    throw new Error(`Supabase runtime-sync event delivered update failed: ${error.message}`);
  }
}

export async function markRuntimeSyncEventFailed(eventId: number, message: string): Promise<void> {
  const { data: existing, error: fetchError } = await getSupabaseClient()
    .from(getRuntimeSyncOutboxTableName())
    .select("attempts")
    .eq("id", eventId)
    .maybeSingle<{ attempts: number }>();

  if (fetchError) {
    throw new Error(`Supabase runtime-sync event fetch failed: ${fetchError.message}`);
  }

  const attempts = Number(existing?.attempts ?? 0) + 1;

  const { error } = await getSupabaseClient()
    .from(getRuntimeSyncOutboxTableName())
    .update({ status: "failed", attempts, last_error: message })
    .eq("id", eventId);

  if (error) {
    throw new Error(`Supabase runtime-sync event failed update failed: ${error.message}`);
  }
}
