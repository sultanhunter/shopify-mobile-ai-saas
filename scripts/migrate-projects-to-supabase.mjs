#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const options = {
    file: ".data/projects.json",
    table: process.env.SUPABASE_PROJECTS_TABLE || "projects",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--file") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--file requires a value");
      }
      options.file = next;
      index += 1;
      continue;
    }

    if (arg === "--table") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--table requires a value");
      }
      options.table = next;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      return options;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  process.stdout.write(
    [
      "Migrate local .data/projects.json into Supabase",
      "",
      "Usage:",
      "  node scripts/migrate-projects-to-supabase.mjs [--file <path>] [--table <name>] [--dry-run]",
      "",
      "Required env:",
      "  SUPABASE_URL",
      "  SUPABASE_SERVICE_ROLE_KEY",
      "",
      "Examples:",
      "  node scripts/migrate-projects-to-supabase.mjs --dry-run",
      "  node scripts/migrate-projects-to-supabase.mjs --file .data/projects.json",
      "  node scripts/migrate-projects-to-supabase.mjs --table projects",
      "",
    ].join("\n"),
  );
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function toIso(value) {
  if (typeof value !== "string" || !value.trim()) {
    return new Date().toISOString();
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return new Date().toISOString();
  }

  return new Date(parsed).toISOString();
}

async function readProjects(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.projects)) {
    throw new Error(`Invalid projects file format: ${absolutePath}`);
  }

  const projects = parsed.projects.filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string");
  return { absolutePath, projects };
}

function toRows(projects) {
  return projects.map((project) => ({
    id: project.id,
    project,
    created_at: toIso(project.createdAt),
    updated_at: toIso(project.updatedAt),
  }));
}

async function upsertInBatches(supabase, table, rows, batchSize = 100) {
  let processed = 0;

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: "id" });
    if (error) {
      throw new Error(`Supabase upsert failed at batch ${offset / batchSize + 1}: ${error.message}`);
    }

    processed += batch.length;
    process.stdout.write(`[migrate] Upserted ${processed}/${rows.length}\n`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const { absolutePath, projects } = await readProjects(options.file);
  const rows = toRows(projects);

  process.stdout.write(`[migrate] Source file: ${absolutePath}\n`);
  process.stdout.write(`[migrate] Table: ${options.table}\n`);
  process.stdout.write(`[migrate] Projects found: ${rows.length}\n`);

  if (rows.length === 0) {
    process.stdout.write("[migrate] Nothing to migrate.\n");
    return;
  }

  if (options.dryRun) {
    process.stdout.write("[migrate] Dry run mode enabled. No rows were written.\n");
    process.stdout.write(`[migrate] Sample IDs: ${rows.slice(0, 5).map((row) => row.id).join(", ")}\n`);
    return;
  }

  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  await upsertInBatches(supabase, options.table, rows);
  process.stdout.write("[migrate] Migration completed successfully.\n");
}

main().catch((error) => {
  process.stderr.write(`[migrate] Failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
