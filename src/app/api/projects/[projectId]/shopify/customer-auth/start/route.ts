import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/db";
import {
  buildCustomerAuthorizeUrl,
  createCustomerAuthState,
  createPkcePair,
  getCustomerAuthCallbackUrl,
} from "@/lib/shopify-customer-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Params {
  params: {
    projectId: string;
  };
}

export async function POST(request: Request, { params }: Params) {
  try {
    const project = await getProject(params.projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const shopDomain = project.store?.shopDomain?.trim().toLowerCase();
    const auth = project.store?.customerAuth;
    if (!shopDomain || !auth) {
      return NextResponse.json({ error: "Shopify customer auth is not configured." }, { status: 400 });
    }

    const clientId = auth.customerAccountApi.clientId;
    const authorizationEndpoint = auth.customerAccountApi.authorizationEndpoint;
    const callbackUrl = getCustomerAuthCallbackUrl(new URL(request.url).origin);
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
      scopes: auth.customerAccountApi.scopes,
      state,
      codeChallenge: pkce.codeChallenge,
    });

    await updateProject(project.id, (current) => {
      const now = new Date().toISOString();
      const existingSessions = current.store?.customerAuth?.sessions ?? [];
      const sessions = [...existingSessions, {
        id: sessionId,
        status: "pending" as const,
        createdAt: now,
        updatedAt: now,
        expiresAt: sessionExpiresAt,
        codeVerifier: pkce.codeVerifier,
      }].slice(-20);

      return {
        ...current,
        updatedAt: now,
        store: current.store
          ? {
              ...current.store,
              customerAuth: current.store.customerAuth
                ? {
                    ...current.store.customerAuth,
                    sessions,
                  }
                : current.store.customerAuth,
            }
          : current.store,
      };
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
