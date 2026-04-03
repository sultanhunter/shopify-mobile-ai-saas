import { Pool } from "pg";

export interface RuntimeCustomerAuthSessionRecord {
  id: string;
  status: "pending" | "completed" | "failed" | "expired" | "consumed";
  codeVerifier?: string;
  tokenPayloadEncrypted?: string;
  error?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

function createRuntimePool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 2,
    ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false }
  });
}

function normalizeSessionRow(value: unknown): RuntimeCustomerAuthSessionRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const status = typeof row.status === "string" ? row.status : "pending";
  const toIsoString = (input: unknown): string => {
    if (typeof input === "string") {
      return input;
    }

    if (input instanceof Date) {
      return input.toISOString();
    }

    return "";
  };

  const expiresAt = toIsoString(row.expires_at);
  const createdAt = toIsoString(row.created_at);
  const updatedAt = toIsoString(row.updated_at);

  if (!id || !expiresAt || !createdAt || !updatedAt) {
    return undefined;
  }

  if (!["pending", "completed", "failed", "expired", "consumed"].includes(status)) {
    return undefined;
  }

  return {
    id,
    status: status as RuntimeCustomerAuthSessionRecord["status"],
    codeVerifier: typeof row.code_verifier === "string" ? row.code_verifier : undefined,
    tokenPayloadEncrypted: typeof row.token_payload_encrypted === "string" ? row.token_payload_encrypted : undefined,
    error: typeof row.error === "string" ? row.error : undefined,
    expiresAt,
    createdAt,
    updatedAt
  };
}

export async function runRuntimeProjectMigrations(databaseUrl: string): Promise<void> {
  const pool = createRuntimePool(databaseUrl);

  try {
    await pool.query(
      "create table if not exists runtime_sync_state (id text primary key, version bigint not null default 0, config_json jsonb not null default '{}'::jsonb, secrets_json jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now())"
    );

    await pool.query(
      "create table if not exists customer_auth_sessions (id text primary key, status text not null, code_verifier text, token_payload_encrypted text, error text, expires_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())"
    );

    await pool.query(
      "create index if not exists customer_auth_sessions_status_updated_at_idx on customer_auth_sessions (status, updated_at desc)"
    );
  } finally {
    await pool.end();
  }
}

export async function getRuntimeCustomerAuthSession(
  databaseUrl: string,
  sessionId: string
): Promise<RuntimeCustomerAuthSessionRecord | undefined> {
  const pool = createRuntimePool(databaseUrl);

  try {
    const result = await pool.query(
      "select id, status, code_verifier, token_payload_encrypted, error, expires_at, created_at, updated_at from customer_auth_sessions where id = $1 limit 1",
      [sessionId]
    );

    return normalizeSessionRow(result.rows[0]);
  } finally {
    await pool.end();
  }
}

export async function createRuntimeCustomerAuthSession(params: {
  databaseUrl: string;
  sessionId: string;
  codeVerifier: string;
  expiresAt: string;
}): Promise<void> {
  const pool = createRuntimePool(params.databaseUrl);

  try {
    await pool.query(
      "insert into customer_auth_sessions (id, status, code_verifier, expires_at, created_at, updated_at) values ($1, 'pending', $2, $3, now(), now()) on conflict (id) do update set status = excluded.status, code_verifier = excluded.code_verifier, expires_at = excluded.expires_at, token_payload_encrypted = null, error = null, updated_at = now()",
      [params.sessionId, params.codeVerifier, params.expiresAt]
    );
  } finally {
    await pool.end();
  }
}

export async function markRuntimeCustomerAuthSessionExpired(databaseUrl: string, sessionId: string): Promise<void> {
  const pool = createRuntimePool(databaseUrl);

  try {
    await pool.query(
      "update customer_auth_sessions set status = 'expired', error = coalesce(error, 'Customer auth session expired.'), code_verifier = null, updated_at = now() where id = $1",
      [sessionId]
    );
  } finally {
    await pool.end();
  }
}

export async function consumeRuntimeCustomerAuthSession(databaseUrl: string, sessionId: string): Promise<void> {
  const pool = createRuntimePool(databaseUrl);

  try {
    await pool.query(
      "update customer_auth_sessions set status = 'consumed', code_verifier = null, token_payload_encrypted = null, error = null, updated_at = now() where id = $1",
      [sessionId]
    );
  } finally {
    await pool.end();
  }
}

export async function markRuntimeCustomerAuthSessionFailed(
  databaseUrl: string,
  sessionId: string,
  errorMessage: string
): Promise<void> {
  const pool = createRuntimePool(databaseUrl);

  try {
    await pool.query(
      "update customer_auth_sessions set status = 'failed', error = $2, code_verifier = null, updated_at = now() where id = $1",
      [sessionId, errorMessage]
    );
  } finally {
    await pool.end();
  }
}

export async function markRuntimeCustomerAuthSessionCompleted(params: {
  databaseUrl: string;
  sessionId: string;
  tokenPayloadEncrypted: string;
}): Promise<void> {
  const pool = createRuntimePool(params.databaseUrl);

  try {
    await pool.query(
      "update customer_auth_sessions set status = 'completed', token_payload_encrypted = $2, error = null, code_verifier = null, updated_at = now() where id = $1",
      [params.sessionId, params.tokenPayloadEncrypted]
    );
  } finally {
    await pool.end();
  }
}
