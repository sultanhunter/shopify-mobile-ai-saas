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
  detail?: string;
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

  if (params.detail) {
    url.searchParams.set("detail", params.detail);
  }

  return url;
}

function mapStoreConnectFailure(error: unknown): { reason: string; detail?: string } {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const stageMatch = message.match(/runtime db provisioning failed at ([a-z_]+):/);
  const stage = stageMatch?.[1];
  const storeSetupStageMatch = message.match(/store setup failed at ([a-z_]+):/);
  const storeSetupStage = storeSetupStageMatch?.[1];
  const isRuntimeDbContext =
    message.includes("runtime db") ||
    message.includes("runtime database") ||
    message.includes("runtime-db") ||
    message.includes("provision runtime database");

  if (message.includes("failed to apply repository files")) {
    return {
      reason: "baseline_apply_failed",
      detail: "runner_repo_apply_failed"
    };
  }

  if (message.includes("not neon pooler") || message.includes("direct postgres host") || message.includes("pooler")) {
    return { reason: "runtime_db_admin_url_invalid", detail: "use_direct_db_host_not_pooler" };
  }

  if (message.includes("is required") && message.includes("runtime_admin_database_url")) {
    return { reason: "runtime_db_admin_url_missing", detail: "set_runner_runtime_admin_database_url" };
  }

  if (message.includes("missing createdb")) {
    return { reason: "runtime_db_admin_permissions_missing", detail: "admin_user_missing_createdb" };
  }

  if (message.includes("missing createrole")) {
    return { reason: "runtime_db_admin_permissions_missing", detail: "admin_user_missing_createrole" };
  }

  if (message.includes("password authentication failed")) {
    return { reason: "runtime_db_admin_auth_failed", detail: "check_admin_db_password" };
  }

  if (
    storeSetupStage &&
    (message.includes("failed to provision runtime database") ||
      message.includes("runtime db provisioning failed") ||
      message.includes("runtime database"))
  ) {
    return {
      reason: "runtime_db_provision_failed",
      detail: `failed_at_${storeSetupStage}`
    };
  }

  if (
    isRuntimeDbContext &&
    (message.includes("getaddrinfo") || message.includes("enotfound") || message.includes("timed out") || message.includes("etimedout"))
  ) {
    return { reason: "runtime_db_admin_unreachable", detail: "check_db_host_network_dns" };
  }

  if (message.includes("getaddrinfo") || message.includes("enotfound") || message.includes("timed out") || message.includes("etimedout")) {
    return { reason: "store_connect_timed_out", detail: "check_runner_network_or_load" };
  }

  if (message.includes("runtime db provisioning failed at")) {
    return {
      reason: "runtime_db_provision_failed",
      detail: stage ? `failed_at_${stage}` : "check_runner_logs_for_stage"
    };
  }

  if (storeSetupStage) {
    return {
      reason: "store_setup_failed",
      detail: `failed_at_${storeSetupStage}`
    };
  }

  if (message.includes("runtime database") || message.includes("runtime db") || message.includes("provision")) {
    return { reason: "runtime_db_provision_failed" };
  }

  return { reason: "store_connect_failed" };
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
  } catch (error) {
    console.error("[SHOPIFY_CALLBACK_TOKEN_EXCHANGE_FAILED]", error);
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
    const mapped = mapStoreConnectFailure(error);
    return NextResponse.redirect(
      buildWorkspaceRedirect(request, {
        projectId: oauthState.projectId,
        status: "error",
        reason: mapped.reason,
        detail: mapped.detail,
        shop
      })
    );
  }
}
