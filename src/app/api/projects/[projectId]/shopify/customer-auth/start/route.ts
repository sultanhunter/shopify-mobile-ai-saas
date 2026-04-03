import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import {
  buildCustomerAuthorizeUrl,
  createCustomerAuthState,
  createPkcePair,
  normalizeCustomerApiScopes,
} from "@/lib/shopify-customer-auth";
import { createRuntimeCustomerAuthSession, runRuntimeProjectMigrations } from "@/lib/project-runtime-db";
import { getProjectRuntimeSecrets } from "@/lib/runtime-sync";
import { parseRuntimeSecrets } from "@/lib/runtime-secrets";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Params {
  params: {
    projectId: string;
  };
}

export async function POST(_: Request, { params }: Params) {
  try {
    const project = await getProject(params.projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const runtimeSecrets = await getProjectRuntimeSecrets(project.id);
    const parsed = parseRuntimeSecrets(runtimeSecrets);

    const shopDomain = parsed.shopify?.shopDomain?.trim().toLowerCase();
    const auth = parsed.shopify?.customerAuth;
    const runtimeDatabaseUrl = parsed.runtime?.database?.databaseUrl;

    if (!shopDomain || !auth || !runtimeDatabaseUrl) {
      return NextResponse.json({ error: "Shopify customer auth is not configured." }, { status: 400 });
    }

    const clientId = auth.customerAccountApi.clientId;
    const authorizationEndpoint = auth.customerAccountApi.authorizationEndpoint;
    const callbackUrl = auth.customerAccountApi.callbackUrl;
    const normalizedScopes = normalizeCustomerApiScopes(auth.customerAccountApi.scopes);
    if (!auth.customerAccountApi.enabled || !clientId || !authorizationEndpoint || !callbackUrl) {
      return NextResponse.json(
        {
          error: "Customer Account API auth is not available for this store.",
        },
        { status: 409 }
      );
    }

    const apiSecret = process.env.SHOPIFY_API_SECRET?.trim();
    if (apiSecret && clientId === apiSecret) {
      return NextResponse.json(
        {
          error:
            "Customer Account API client_id is misconfigured. Use SHOPIFY_API_KEY (or proper Customer Account API client ID), not SHOPIFY_API_SECRET.",
        },
        { status: 500 }
      );
    }

    await runRuntimeProjectMigrations(runtimeDatabaseUrl).catch(() => null);

    const sessionId = randomUUID();
    const sessionExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const pkce = createPkcePair();
    const state = createCustomerAuthState({
      projectId: project.id,
      shopDomain,
      sessionId,
    });

    const authUrl = buildCustomerAuthorizeUrl({
      authorizationEndpoint,
      clientId,
      redirectUri: callbackUrl,
      scopes: normalizedScopes,
      state,
      codeChallenge: pkce.codeChallenge,
    });

    await createRuntimeCustomerAuthSession({
      databaseUrl: runtimeDatabaseUrl,
      sessionId,
      codeVerifier: pkce.codeVerifier,
      expiresAt: sessionExpiresAt,
    });

    return NextResponse.json({
      sessionId,
      status: "pending",
      expiresAt: sessionExpiresAt,
      authUrl,
    });
  } catch (caught) {
    return NextResponse.json(
      {
        error: caught instanceof Error ? caught.message : "Failed to start Customer Account API auth session.",
      },
      { status: 500 }
    );
  }
}
