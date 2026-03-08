import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Project } from "@/lib/models";

interface DatabaseShape {
  projects: Project[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "projects.json");

let writeChain = Promise.resolve();

async function ensureDbFile() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(DB_FILE, "utf8");
  } catch {
    const initialData: DatabaseShape = { projects: [] };
    await writeFile(DB_FILE, JSON.stringify(initialData, null, 2), "utf8");
  }
}

async function readDb(): Promise<DatabaseShape> {
  await ensureDbFile();
  const raw = await readFile(DB_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw) as DatabaseShape;
    if (!Array.isArray(parsed.projects)) {
      return { projects: [] };
    }

    return parsed;
  } catch {
    return { projects: [] };
  }
}

async function writeDb(data: DatabaseShape) {
  await ensureDbFile();
  await writeFile(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function listProjects(): Promise<Project[]> {
  const db = await readDb();
  return db.projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(projectId: string): Promise<Project | undefined> {
  const db = await readDb();
  return db.projects.find((item) => item.id === projectId);
}

export async function createProject(project: Project): Promise<void> {
  writeChain = writeChain.then(async () => {
    const db = await readDb();
    db.projects.push(project);
    await writeDb(db);
  });

  await writeChain;
}

export async function updateProject(
  projectId: string,
  updater: (project: Project) => Project
): Promise<Project | undefined> {
  let updatedProject: Project | undefined;

  writeChain = writeChain.then(async () => {
    const db = await readDb();
    const index = db.projects.findIndex((item) => item.id === projectId);

    if (index === -1) {
      updatedProject = undefined;
      return;
    }

    updatedProject = updater(db.projects[index]);
    db.projects[index] = updatedProject;
    await writeDb(db);
  });

  await writeChain;
  return updatedProject;
}
