import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/db";
import { detectCustomerAuthState, getCustomerApiScopes } from "@/lib/shopify-customer-auth";
import {
  dispatchProjectRuntimeSync,
  getProjectRuntimeSecrets,
  upsertAndQueueProjectRuntimeSync
} from "@/lib/runtime-sync";
import { parseRuntimeSecrets } from "@/lib/runtime-secrets";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CLIENT_ID_CONFIGURED_SENTINEL = "__configured__";

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

function buildRuntimeConfigPatch(params: {
  projectId: string;
  projectName: string;
  brandColor: string;
  customerAuth: Awaited<ReturnType<typeof detectCustomerAuthState>>;
}): Record<string, unknown> {
  return {
    projectId: params.projectId,
    projectName: params.projectName,
    brandColor: params.brandColor,
    customerAuth: {
      detectedAt: params.customerAuth.detectedAt,
      activeMethod: params.customerAuth.activeMethod,
      recommendedMethod: params.customerAuth.recommendedMethod,
      supportedMethods: params.customerAuth.supportedMethods,
      hosted: params.customerAuth.hosted,
      customerAccountApi: {
        enabled: params.customerAuth.customerAccountApi.enabled,
        hasClientId: Boolean(params.customerAuth.customerAccountApi.clientId)
      }
    },
    updatedAt: new Date().toISOString()
  };
}

function buildProjectStoreCustomerAuthSummary(auth: Awaited<ReturnType<typeof detectCustomerAuthState>>) {
  return {
    detectedAt: auth.detectedAt,
    activeMethod: auth.activeMethod,
    recommendedMethod: auth.recommendedMethod,
    supportedMethods: auth.supportedMethods,
    hosted: auth.hosted,
    customerAccountApi: {
      enabled: auth.customerAccountApi.enabled,
      clientId: auth.customerAccountApi.clientId ? CLIENT_ID_CONFIGURED_SENTINEL : undefined,
      scopes: [],
      issuer: undefined,
      authorizationEndpoint: undefined,
      tokenEndpoint: undefined,
      revocationEndpoint: undefined,
      endSessionEndpoint: undefined,
      callbackUrl: undefined
    }
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const project = await getProject(params.projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const runtimeSecrets = await getProjectRuntimeSecrets(project.id);
    const parsed = parseRuntimeSecrets(runtimeSecrets);
    const shopDomain = parsed.shopify?.shopDomain?.trim().toLowerCase();
    const accessToken = parsed.shopify?.adminAccessToken;
    let authState = parsed.shopify?.customerAuth;

    if (!shopDomain) {
      return NextResponse.json({ error: "Shopify store is not connected." }, { status: 400 });
    }

    if (authState && shouldRefreshDetection(authState.detectedAt) && accessToken) {
      const refreshed = await detectCustomerAuthState({
        shopDomain,
        accessToken,
        fallbackOrigin: request.nextUrl.origin,
        current: authState,
      });

      authState = refreshed;
      await upsertAndQueueProjectRuntimeSync({
        projectId: project.id,
        config: buildRuntimeConfigPatch({
          projectId: project.id,
          projectName: project.name,
          brandColor: project.preview.primaryColor,
          customerAuth: refreshed
        }),
        secrets: {
          shopify: {
            customerAuth: {
              ...refreshed,
              sessions: undefined
            }
          }
        }
      });
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
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const runtimeSecrets = await getProjectRuntimeSecrets(project.id);
    const parsed = parseRuntimeSecrets(runtimeSecrets);

    const shopDomain = parsed.shopify?.shopDomain?.trim().toLowerCase();
    const accessToken = parsed.shopify?.adminAccessToken;
    if (!shopDomain || !accessToken) {
      return NextResponse.json({ error: "Shopify store is not connected for this project." }, { status: 404 });
    }

    const normalizedClientId = hasClientIdUpdate
      ? typeof payload.customerAccountClientId === "string"
        ? payload.customerAccountClientId.trim()
        : ""
      : undefined;

    if (hasClientIdUpdate && !normalizedClientId) {
      return NextResponse.json({ error: "customerAccountClientId cannot be empty." }, { status: 400 });
    }

    const currentAuthState = parsed.shopify?.customerAuth
      ? {
          ...parsed.shopify.customerAuth,
          customerAccountApi: {
            ...parsed.shopify.customerAuth.customerAccountApi,
            clientId: hasClientIdUpdate
              ? normalizedClientId
              : parsed.shopify.customerAuth.customerAccountApi.clientId,
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
            sessions: undefined,
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

    const nextAuth = {
      ...detected,
      activeMethod: payload.activeMethod ?? detected.activeMethod,
      sessions: undefined,
    };

    await upsertAndQueueProjectRuntimeSync({
      projectId: project.id,
      config: buildRuntimeConfigPatch({
        projectId: project.id,
        projectName: project.name,
        brandColor: project.preview.primaryColor,
        customerAuth: nextAuth
      }),
      secrets: {
        shopify: {
          customerAuth: nextAuth
        }
      }
    });

    const updated = await updateProject(project.id, (current) => {
      const now = new Date().toISOString();

      return {
        ...current,
        updatedAt: now,
        store: {
          shopDomain: undefined,
          connectedAt: current.store?.connectedAt ?? now,
          customerAuth: buildProjectStoreCustomerAuthSummary(nextAuth),
        },
      };
    });

    try {
      await dispatchProjectRuntimeSync({
        projectId: project.id,
        expoBackendBaseUrl: updated?.devSession?.expoBackendUrl ?? updated?.devSession?.backendUrl,
      });
    } catch {
      // Best effort sync; pending outbox retries on next dev-session refresh.
    }

    return NextResponse.json({
      auth: {
        activeMethod: updated?.store?.customerAuth?.activeMethod ?? payload.activeMethod,
        customerAccountApi: {
          hasClientId: Boolean(nextAuth.customerAccountApi.clientId),
          enabled: Boolean(nextAuth.customerAccountApi.enabled),
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
