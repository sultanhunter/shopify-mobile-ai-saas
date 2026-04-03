import { NextRequest, NextResponse } from "next/server";
import { connectStoreToProject } from "@/lib/project-service";
import {
  exchangeShopifyAccessToken,
  getAppBaseUrl,
  normalizeShopDomain,
  verifyShopifyCallbackHmac,
  verifyShopifyOAuthState
} from "@/lib/shopify";

function buildWorkspaceRedirect(request: NextRequest, params: {
  projectId?: string;
  status: "success" | "error";
  reason?: string;
  shop?: string;
}) {
  const appBaseUrl = getAppBaseUrl(request.nextUrl.origin);
  const projectPath = params.projectId ? `/projects/${params.projectId}` : "/";
  const url = new URL(`${appBaseUrl}${projectPath}`);
  url.searchParams.set("shopify_oauth", params.status);

  if (params.shop) {
    url.searchParams.set("shop", params.shop);
  }

  if (params.reason) {
    url.searchParams.set("reason", params.reason);
  }

  return url;
}

function mapStoreConnectFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes("runtime database") || message.includes("runtime db") || message.includes("provision")) {
    return "runtime_db_provision_failed";
  }

  return "store_connect_failed";
}

export async function GET(request: NextRequest) {
  const rawShop = request.nextUrl.searchParams.get("shop");
  const shop = rawShop ? normalizeShopDomain(rawShop) : null;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!shop || !code || !state) {
    return NextResponse.redirect(
      buildWorkspaceRedirect(request, {
        status: "error",
        reason: "missing_callback_params"
      })
    );
  }

  const oauthState = verifyShopifyOAuthState(state);
  if (!oauthState || oauthState.shopDomain !== shop) {
    return NextResponse.redirect(
      buildWorkspaceRedirect(request, {
        status: "error",
        reason: "invalid_state",
        shop
      })
    );
  }

  if (!verifyShopifyCallbackHmac(request.nextUrl.searchParams)) {
    return NextResponse.redirect(
      buildWorkspaceRedirect(request, {
        projectId: oauthState.projectId,
        status: "error",
        reason: "invalid_hmac",
        shop
      })
    );
  }

  let accessToken: string;
  try {
    const tokenResult = await exchangeShopifyAccessToken({
      shopDomain: shop,
      code
    });
    accessToken = tokenResult.accessToken;
  } catch {
    return NextResponse.redirect(
      buildWorkspaceRedirect(request, {
        projectId: oauthState.projectId,
        status: "error",
        reason: "token_exchange_failed",
        shop
      })
    );
  }

  try {
    await connectStoreToProject({
      projectId: oauthState.projectId,
      shopDomain: shop,
      accessToken
    });

    return NextResponse.redirect(
      buildWorkspaceRedirect(request, {
        projectId: oauthState.projectId,
        status: "success",
        shop
      })
    );
  } catch (error) {
    console.error("[SHOPIFY_CALLBACK_CONNECT_STORE_FAILED]", error);
    return NextResponse.redirect(
      buildWorkspaceRedirect(request, {
        projectId: oauthState.projectId,
        status: "error",
        reason: mapStoreConnectFailureReason(error),
        shop
      })
    );
  }
}
