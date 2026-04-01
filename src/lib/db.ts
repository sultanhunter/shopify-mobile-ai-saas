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

function mergeCustomerAuthSessions(
  latestSessions: unknown,
  updatedSessions: unknown
): unknown {
  const combined = new Map<string, Record<string, unknown>>();

  const statusRank = (status: unknown): number => {
    switch (status) {
      case "consumed":
        return 5;
      case "completed":
        return 4;
      case "failed":
        return 3;
      case "expired":
        return 2;
      case "pending":
        return 1;
      default:
        return 0;
    }
  };

  const toTime = (value: unknown): number => {
    if (typeof value !== "string") {
      return Number.NEGATIVE_INFINITY;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };

  const addSessions = (value: unknown) => {
    if (!Array.isArray(value)) {
      return;
    }

    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : undefined;
      if (!id) {
        continue;
      }

      const previous = combined.get(id);
      if (!previous) {
        combined.set(id, { ...record });
        continue;
      }

      const previousRank = statusRank(previous.status);
      const nextRank = statusRank(record.status);

      if (nextRank > previousRank) {
        combined.set(id, { ...record });
        continue;
      }

      if (nextRank < previousRank) {
        continue;
      }

      const previousUpdatedAt = toTime(previous.updatedAt);
      const nextUpdatedAt = toTime(record.updatedAt);
      if (nextUpdatedAt >= previousUpdatedAt) {
        combined.set(id, { ...record });
      }
    }
  };

  addSessions(latestSessions);
  addSessions(updatedSessions);

  return combined.size > 0 ? [...combined.values()] : updatedSessions ?? latestSessions;
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
      ...merged.store,
      shopDomain: merged.store.shopDomain || latestProject.store.shopDomain,
      accessTokenEncrypted: merged.store.accessTokenEncrypted || latestProject.store.accessTokenEncrypted,
      accessToken: merged.store.accessToken || latestProject.store.accessToken,
      customerAuth: merged.store.customerAuth || latestProject.store.customerAuth,
    };

    if (merged.store.customerAuth && latestProject.store.customerAuth) {
      merged.store.customerAuth = {
        ...latestProject.store.customerAuth,
        ...merged.store.customerAuth,
        customerAccountApi: {
          ...latestProject.store.customerAuth.customerAccountApi,
          ...merged.store.customerAuth.customerAccountApi,
          clientId:
            merged.store.customerAuth.customerAccountApi.clientId ||
            latestProject.store.customerAuth.customerAccountApi.clientId,
          scopes:
            merged.store.customerAuth.customerAccountApi.scopes?.length
              ? merged.store.customerAuth.customerAccountApi.scopes
              : latestProject.store.customerAuth.customerAccountApi.scopes,
        },
        sessions: mergeCustomerAuthSessions(
          latestProject.store.customerAuth.sessions,
          merged.store.customerAuth.sessions
        ) as typeof merged.store.customerAuth.sessions,
      };
    }
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
