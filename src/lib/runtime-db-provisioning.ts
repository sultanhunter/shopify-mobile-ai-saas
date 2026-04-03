import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { provisionRuntimeDatabaseOnRunner } from "@/lib/dev-runner";
import { RuntimeProjectDatabase } from "@/lib/runtime-database";

const POSTGRES_IDENTIFIER_MAX_LENGTH = 63;

function getRuntimeProvisioningMode(): "auto" | "direct" | "runner" {
  const raw =
    process.env.RUNTIME_DB_PROVISIONER?.trim().toLowerCase() ||
    process.env.NEON_RUNTIME_PROVISIONER?.trim().toLowerCase() ||
    "auto";

  if (raw === "direct" || raw === "runner") {
    return raw;
  }

  return "auto";
}

function getRuntimeAdminDatabaseUrl(): string | undefined {
  return process.env.RUNTIME_ADMIN_DATABASE_URL?.trim() || process.env.NEON_ADMIN_DATABASE_URL?.trim() || undefined;
}

function getRuntimeDatabasePrefix(): string {
  return process.env.RUNTIME_DATABASE_PREFIX?.trim() || process.env.NEON_RUNTIME_DATABASE_PREFIX?.trim() || "shopify_runtime_";
}

function getRuntimeRolePrefix(): string {
  return process.env.RUNTIME_ROLE_PREFIX?.trim() || process.env.NEON_RUNTIME_ROLE_PREFIX?.trim() || "shopify_runtime_";
}

function sanitizeIdentifier(input: string, fallbackPrefix: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_");

  const base = normalized || fallbackPrefix;
  const prefixed = /^[a-z_]/.test(base) ? base : `${fallbackPrefix}_${base}`;
  return prefixed.slice(0, POSTGRES_IDENTIFIER_MAX_LENGTH);
}

function buildProjectName(prefix: string, projectId: string, fallbackPrefix: string): string {
  const compactProjectId = projectId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 28);
  const raw = `${prefix}${compactProjectId}`;
  return sanitizeIdentifier(raw, fallbackPrefix);
}

function makeRuntimeDatabaseUrl(
  adminDatabaseUrl: string,
  params: { roleName: string; password: string; databaseName: string }
): string {
  const url = new URL(adminDatabaseUrl);
  url.username = params.roleName;
  url.password = params.password;
  url.pathname = `/${params.databaseName}`;

  if (!url.searchParams.has("sslmode")) {
    url.searchParams.set("sslmode", "require");
  }

  return url.toString();
}

function createAdminPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 1,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false }
  });
}

function isSetRoleRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("must be able to set role");
}

async function grantRuntimeSchemaPrivileges(adminDatabaseUrl: string, databaseName: string, roleName: string): Promise<void> {
  const databaseUrl = new URL(adminDatabaseUrl);
  databaseUrl.pathname = `/${databaseName}`;

  const databasePool = createAdminPool(databaseUrl.toString());
  try {
    await databasePool.query(`grant usage, create on schema public to ${roleName}`);
  } finally {
    await databasePool.end();
  }
}

async function provisionRuntimeProjectDatabaseDirect(
  projectId: string,
  adminDatabaseUrl: string
): Promise<RuntimeProjectDatabase> {
  const databaseName = buildProjectName(getRuntimeDatabasePrefix(), projectId, "runtime_db");
  const roleName = buildProjectName(getRuntimeRolePrefix(), projectId, "runtime_role");
  const rolePassword = randomBytes(24).toString("hex");

  const pool = createAdminPool(adminDatabaseUrl);
  try {
    const roleExists = await pool.query("select 1 from pg_roles where rolname = $1 limit 1", [roleName]);
    if (roleExists.rowCount && roleExists.rowCount > 0) {
      await pool.query(`alter role ${roleName} with login password '${rolePassword}'`);
    } else {
      await pool.query(`create role ${roleName} with login password '${rolePassword}'`);
    }

    const databaseExists = await pool.query("select 1 from pg_database where datname = $1 limit 1", [databaseName]);
    if (!databaseExists.rowCount || databaseExists.rowCount === 0) {
      try {
        await pool.query(`create database ${databaseName} owner ${roleName}`);
      } catch (error) {
        if (!isSetRoleRequiredError(error)) {
          throw error;
        }

        await pool.query(`create database ${databaseName}`);
      }
    }

    await pool.query(`grant all privileges on database ${databaseName} to ${roleName}`);
  } finally {
    await pool.end();
  }

  await grantRuntimeSchemaPrivileges(adminDatabaseUrl, databaseName, roleName);

  return {
    provider: "postgres",
    databaseName,
    roleName,
    databaseUrl: makeRuntimeDatabaseUrl(adminDatabaseUrl, {
      roleName,
      password: rolePassword,
      databaseName
    })
  };
}

export async function provisionRuntimeProjectDatabase(projectId: string): Promise<RuntimeProjectDatabase> {
  const mode = getRuntimeProvisioningMode();
  const adminDatabaseUrl = getRuntimeAdminDatabaseUrl();

  if (mode === "runner") {
    return provisionRuntimeDatabaseOnRunner(projectId);
  }

  if (mode === "direct") {
    if (!adminDatabaseUrl) {
      throw new Error("RUNTIME_ADMIN_DATABASE_URL is required when RUNTIME_DB_PROVISIONER=direct.");
    }

    return provisionRuntimeProjectDatabaseDirect(projectId, adminDatabaseUrl);
  }

  if (adminDatabaseUrl) {
    return provisionRuntimeProjectDatabaseDirect(projectId, adminDatabaseUrl);
  }

  return provisionRuntimeDatabaseOnRunner(projectId);
}
