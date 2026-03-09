import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Project } from "@/lib/models";

interface ProjectRow {
  id: string;
  project: Project;
  created_at: string;
  updated_at: string;
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

function normalizeProject(value: unknown): Project | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const project = value as Project;
  if (typeof project.id !== "string" || typeof project.updatedAt !== "string") {
    return null;
  }

  return project;
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
