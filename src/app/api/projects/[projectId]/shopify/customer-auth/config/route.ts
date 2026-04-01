import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/db";
import { detectCustomerAuthState, getCustomerApiScopes } from "@/lib/shopify-customer-auth";
import { decryptSecret } from "@/lib/secret-crypto";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Params {
  params: {
    projectId: string;
  };
}

function shouldRefreshDetection(detectedAt: string | undefined): boolean {
  if (!detectedAt) {
    return true;
  }

  const detectedAtMs = Date.parse(detectedAt);
  if (!Number.isFinite(detectedAtMs)) {
    return true;
  }

  return Date.now() - detectedAtMs > 6 * 60 * 60 * 1000;
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const project = await getProject(params.projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const shopDomain = project.store?.shopDomain?.trim().toLowerCase();
    if (!shopDomain) {
      return NextResponse.json({ error: "Shopify store is not connected." }, { status: 400 });
    }

    const accessTokenEncrypted = project.store?.accessTokenEncrypted;
    const accessToken = accessTokenEncrypted
      ? decryptSecret(accessTokenEncrypted)
      : project.store?.accessToken;

    let authState = project.store?.customerAuth;
    if (shouldRefreshDetection(authState?.detectedAt) && accessToken) {
      const refreshed = await detectCustomerAuthState({
        shopDomain,
        accessToken,
        fallbackOrigin: request.nextUrl.origin,
        current: authState,
      });

      authState = refreshed;
      await updateProject(project.id, (current) => ({
        ...current,
        updatedAt: new Date().toISOString(),
        store: current.store
          ? {
              ...current.store,
              customerAuth: refreshed,
            }
          : current.store,
      }));
    }

    if (!authState) {
      return NextResponse.json(
        {
          error: "Customer auth is not initialized for this store yet.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      auth: {
        detectedAt: authState.detectedAt,
        activeMethod: authState.activeMethod,
        recommendedMethod: authState.recommendedMethod,
        supportedMethods: authState.supportedMethods,
        hosted: authState.hosted,
        customerAccountApi: {
          enabled: authState.customerAccountApi.enabled,
          hasClientId: Boolean(authState.customerAccountApi.clientId),
          scopes: authState.customerAccountApi.scopes,
          issuer: authState.customerAccountApi.issuer,
          authorizationEndpoint: authState.customerAccountApi.authorizationEndpoint,
          tokenEndpoint: authState.customerAccountApi.tokenEndpoint,
        },
        endpoints: {
          start: `/api/projects/${encodeURIComponent(project.id)}/shopify/customer-auth/start`,
          sessionBase: `/api/projects/${encodeURIComponent(project.id)}/shopify/customer-auth/session`,
          refresh: `/api/projects/${encodeURIComponent(project.id)}/shopify/customer-auth/refresh`,
        },
      },
    });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to resolve customer auth configuration." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const payload = (await request.json()) as {
      activeMethod?: "shopify_hosted" | "customer_account_api";
      customerAccountClientId?: string | null;
    };

    const hasMethodUpdate = Boolean(payload.activeMethod);
    const hasClientIdUpdate = Object.prototype.hasOwnProperty.call(payload, "customerAccountClientId");
    if (!hasMethodUpdate && !hasClientIdUpdate) {
      return NextResponse.json({ error: "Provide activeMethod and/or customerAccountClientId." }, { status: 400 });
    }

    const project = await getProject(params.projectId);
    if (!project?.store) {
      return NextResponse.json({ error: "Shopify store is not connected for this project." }, { status: 404 });
    }

    const shopDomain = project.store.shopDomain?.trim().toLowerCase();
    if (!shopDomain) {
      return NextResponse.json({ error: "Shopify store domain is missing on this project." }, { status: 409 });
    }

    const accessTokenEncrypted = project.store.accessTokenEncrypted;
    const accessToken = accessTokenEncrypted ? decryptSecret(accessTokenEncrypted) : project.store.accessToken;

    const normalizedClientId = hasClientIdUpdate
      ? typeof payload.customerAccountClientId === "string"
        ? payload.customerAccountClientId.trim()
        : ""
      : undefined;

    if (hasClientIdUpdate && !normalizedClientId) {
      return NextResponse.json({ error: "customerAccountClientId cannot be empty." }, { status: 400 });
    }

    const currentAuthState = project.store.customerAuth
      ? {
          ...project.store.customerAuth,
          customerAccountApi: {
            ...project.store.customerAuth.customerAccountApi,
            clientId: hasClientIdUpdate ? normalizedClientId : project.store.customerAuth.customerAccountApi.clientId,
          },
        }
      : hasClientIdUpdate
        ? {
            detectedAt: new Date().toISOString(),
            activeMethod: "shopify_hosted" as const,
            recommendedMethod: "shopify_hosted" as const,
            supportedMethods: ["shopify_hosted" as const],
            hosted: {
              accountsEnabled: true,
              accountType: "unknown" as const,
              loginUrl: `https://${shopDomain}/account/login`,
              accountUrl: `https://${shopDomain}/account`,
            },
            customerAccountApi: {
              enabled: false,
              clientId: normalizedClientId,
              scopes: getCustomerApiScopes(),
            },
          }
        : undefined;

    const detected = await detectCustomerAuthState({
      shopDomain,
      accessToken,
      fallbackOrigin: request.nextUrl.origin,
      current: currentAuthState,
    });

    if (payload.activeMethod && !detected.supportedMethods.includes(payload.activeMethod)) {
      return NextResponse.json(
        {
          error: `Method ${payload.activeMethod} is not supported for this store.`,
        },
        { status: 409 }
      );
    }

    const updated = await updateProject(project.id, (current) => {
      const now = new Date().toISOString();
      const nextCustomerAuth = {
        ...detected,
        activeMethod: payload.activeMethod ?? detected.activeMethod,
      };

      return {
        ...current,
        updatedAt: now,
        store: current.store
          ? {
              ...current.store,
              customerAuth: nextCustomerAuth,
            }
          : current.store,
      };
    });

    return NextResponse.json({
      auth: {
        activeMethod: updated?.store?.customerAuth?.activeMethod ?? payload.activeMethod,
        customerAccountApi: {
          hasClientId: Boolean(updated?.store?.customerAuth?.customerAccountApi.clientId),
          enabled: Boolean(updated?.store?.customerAuth?.customerAccountApi.enabled),
        },
      },
    });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to update active auth method." },
      { status: 500 }
    );
  }
}
