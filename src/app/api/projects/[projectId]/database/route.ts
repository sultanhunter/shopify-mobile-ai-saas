import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getProject } from "@/lib/db";
import { getProjectRuntimeSecrets } from "@/lib/runtime-sync";
import { parseRuntimeSecrets } from "@/lib/runtime-secrets";

function parseLimit(raw: string | null): number {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 40;
  }

  return Math.min(Math.floor(parsed), 200);
}

function createPool(databaseUrl: string): Pool {
  const isLocal = databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1");
  return new Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: isLocal ? undefined : { rejectUnauthorized: false }
  });
}

function escapeIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function isRunnerOnlyDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  } catch {
    return databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1");
  }
}

async function exploreDatabaseViaRunner(input: { databaseUrl: string; table?: string; limit: number }) {
  const runnerBaseUrl = process.env.RUNNER_SERVER_BASE_URL?.trim();
  if (!runnerBaseUrl) {
    throw new Error("RUNNER_SERVER_BASE_URL is required to explore runner-local project databases.");
  }

  const runnerToken = process.env.RUNNER_SERVER_TOKEN?.trim();
  const response = await fetch(`${runnerBaseUrl.replace(/\/$/, "")}/api/shopify-mobile/runtime-db/explore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(runnerToken ? { Authorization: `Bearer ${runnerToken}` } : {})
    },
    body: JSON.stringify({
      databaseUrl: input.databaseUrl,
      table: input.table,
      limit: input.limit
    })
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        tables?: string[];
        selectedTable?: string | null;
        columns?: Array<{ name?: string; type?: string }>;
        rows?: Array<Record<string, unknown>>;
        rowCount?: number;
        error?: string;
      }
    | null;

  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? "Runner failed to explore runtime database.");
  }

  return {
    tables: payload.tables ?? [],
    selectedTable: payload.selectedTable ?? null,
    columns: (payload.columns ?? []).map((column) => ({
      name: column.name ?? "",
      type: column.type ?? "text"
    })),
    rows: payload.rows ?? [],
    rowCount: payload.rowCount ?? 0
  };
}

export async function GET(request: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    const project = await getProject(params.projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const secrets = await getProjectRuntimeSecrets(project.id);
    const parsedSecrets = parseRuntimeSecrets(secrets);
    const databaseUrl = parsedSecrets.runtime?.database?.databaseUrl?.trim();
    if (!databaseUrl) {
      return NextResponse.json({ error: "Runtime database is not configured for this project." }, { status: 409 });
    }

    const requestedTable = request.nextUrl.searchParams.get("table")?.trim();
    const rowLimit = parseLimit(request.nextUrl.searchParams.get("limit"));

    const result = isRunnerOnlyDatabaseUrl(databaseUrl)
      ? await exploreDatabaseViaRunner({ databaseUrl, table: requestedTable, limit: rowLimit })
      : await (async () => {
          const pool = createPool(databaseUrl);

          try {
            const tablesResult = await pool.query<{ table_name: string }>(
              `
              select table_name
              from information_schema.tables
              where table_schema = 'public'
                and table_type = 'BASE TABLE'
              order by table_name asc
              `
            );

            const tables = tablesResult.rows.map((row) => row.table_name);
            const selectedTable = requestedTable && tables.includes(requestedTable) ? requestedTable : tables[0] ?? null;

            if (!selectedTable) {
              return {
                tables: [],
                selectedTable: null,
                columns: [],
                rows: [],
                rowCount: 0
              };
            }

            const columnsResult = await pool.query<{ column_name: string; data_type: string }>(
              `
              select column_name, data_type
              from information_schema.columns
              where table_schema = 'public'
                and table_name = $1
              order by ordinal_position asc
              `,
              [selectedTable]
            );

            const safeTable = escapeIdentifier(selectedTable);
            const rowsResult = await pool.query<Record<string, unknown>>(`select * from ${safeTable} limit $1`, [rowLimit]);

            return {
              tables,
              selectedTable,
              columns: columnsResult.rows.map((row) => ({
                name: row.column_name,
                type: row.data_type
              })),
              rows: rowsResult.rows,
              rowCount: rowsResult.rowCount ?? rowsResult.rows.length
            };
          } finally {
            await pool.end();
          }
        })();

    return NextResponse.json({
      database: {
        provider: parsedSecrets.runtime?.database?.provider ?? "postgres",
        databaseName: parsedSecrets.runtime?.database?.databaseName
      },
      tables: result.tables,
      selectedTable: result.selectedTable,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount
    });
  } catch (caught) {
    return NextResponse.json(
      {
        error: caught instanceof Error ? caught.message : "Failed to load runtime database explorer."
      },
      { status: 500 }
    );
  }
}
