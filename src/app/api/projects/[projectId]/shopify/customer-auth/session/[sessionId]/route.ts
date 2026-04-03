import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import {
  consumeRuntimeCustomerAuthSession,
  getRuntimeCustomerAuthSession,
  markRuntimeCustomerAuthSessionExpired,
  runRuntimeProjectMigrations
} from "@/lib/project-runtime-db";
import { ShopifyCustomerTokenSet } from "@/lib/shopify-customer-auth";
import { getProjectRuntimeSecrets } from "@/lib/runtime-sync";
import { parseRuntimeSecrets } from "@/lib/runtime-secrets";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Params {
  params: {
    projectId: string;
    sessionId: string;
  };
}

function readTokenPayload(raw: string | undefined): ShopifyCustomerTokenSet | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as ShopifyCustomerTokenSet;
    if (!parsed || typeof parsed.accessToken !== "string") {
      return undefined;
    }

    return parsed;
  } catch {
    return undefined;
  }
}

export async function GET(_: Request, { params }: Params) {
  try {
    const project = await getProject(params.projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const runtimeSecrets = await getProjectRuntimeSecrets(project.id);
    const parsed = parseRuntimeSecrets(runtimeSecrets);
    const runtimeDatabaseUrl = parsed.runtime?.database?.databaseUrl;

    if (!runtimeDatabaseUrl) {
      return NextResponse.json({ error: "Runtime database is not configured." }, { status: 409 });
    }

    await runRuntimeProjectMigrations(runtimeDatabaseUrl).catch(() => null);

    const session = await getRuntimeCustomerAuthSession(runtimeDatabaseUrl, params.sessionId);
    if (!session) {
      return NextResponse.json(
        {
          error: "Customer auth session not found.",
          requestedSessionId: params.sessionId,
          knownSessionIds: [],
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }

    const expiresAtMs = Date.parse(session.expiresAt);
    if (session.status === "pending" && Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
      await markRuntimeCustomerAuthSessionExpired(runtimeDatabaseUrl, session.id);
      return NextResponse.json({ status: "expired", error: "Customer auth session expired." });
    }

    if (session.status === "completed") {
      const tokens = readTokenPayload(session.tokenPayloadEncrypted);
      if (!tokens) {
        return NextResponse.json({ status: "failed", error: "Completed session is missing token payload." });
      }

      await consumeRuntimeCustomerAuthSession(runtimeDatabaseUrl, session.id);
      return NextResponse.json({ status: "completed", tokens });
    }

    if (session.status === "failed") {
      return NextResponse.json({ status: "failed", error: session.error ?? "Customer auth failed." });
    }

    if (session.status === "expired") {
      return NextResponse.json({ status: "expired", error: session.error ?? "Customer auth session expired." });
    }

    if (session.status === "consumed") {
      return NextResponse.json({ status: "consumed" });
    }

    return NextResponse.json({ status: "pending" });
  } catch (caught) {
    return NextResponse.json(
      {
        error: caught instanceof Error ? caught.message : "Failed to resolve customer auth session status.",
      },
      { status: 500 }
    );
  }
}
