import { NextRequest } from "next/server";
import {
  getRuntimeCustomerAuthSession,
  markRuntimeCustomerAuthSessionCompleted,
  markRuntimeCustomerAuthSessionExpired,
  markRuntimeCustomerAuthSessionFailed
} from "@/lib/project-runtime-db";
import { getProjectRuntimeSecrets } from "@/lib/runtime-sync";
import { parseRuntimeSecrets } from "@/lib/runtime-secrets";
import {
  exchangeCustomerAuthCode,
  getCustomerAuthCallbackUrl,
  verifyCustomerAuthState,
} from "@/lib/shopify-customer-auth";
import { normalizeShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const maxDuration = 120;

interface UnsignedCustomerAuthStatePayload {
  projectId: string;
  shopDomain: string;
  sessionId: string;
  nonce: string;
  expiresAt: number;
}

function parseUnsignedCustomerAuthState(rawState: string): UnsignedCustomerAuthStatePayload | null {
  try {
    const json = Buffer.from(rawState, "base64url").toString("utf8");
    const payload = JSON.parse(json) as Partial<UnsignedCustomerAuthStatePayload>;
    if (
      typeof payload.projectId !== "string" ||
      typeof payload.shopDomain !== "string" ||
      typeof payload.sessionId !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.expiresAt !== "number"
    ) {
      return null;
    }

    if (payload.expiresAt < Date.now()) {
      return null;
    }

    return {
      projectId: payload.projectId,
      shopDomain: payload.shopDomain,
      sessionId: payload.sessionId,
      nonce: payload.nonce,
      expiresAt: payload.expiresAt
    };
  } catch {
    return null;
  }
}

function renderResultHtml(status: "success" | "error", message: string): string {
  const color = status === "success" ? "#065f46" : "#991b1b";
  const bg = status === "success" ? "#ecfdf5" : "#fef2f2";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Shopify Customer Auth</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #f8fafc; color: #0f172a; }
      .card { max-width: 560px; margin: 48px auto; background: ${bg}; border: 1px solid #cbd5e1; border-radius: 14px; padding: 20px; }
      h1 { margin: 0 0 8px 0; color: ${color}; font-size: 24px; }
      p { margin: 0; line-height: 1.55; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${status === "success" ? "Authentication complete" : "Authentication failed"}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}

async function failSession(databaseUrl: string, sessionId: string, error: string): Promise<void> {
  await markRuntimeCustomerAuthSessionFailed(databaseUrl, sessionId, error);
}

export async function GET(request: NextRequest) {
  const rawShop = request.nextUrl.searchParams.get("shop");
  const code = request.nextUrl.searchParams.get("code")?.trim();
  const state = request.nextUrl.searchParams.get("state")?.trim();
  const oauthError = request.nextUrl.searchParams.get("error")?.trim();
  const oauthErrorDescription = request.nextUrl.searchParams.get("error_description")?.trim();

  if (!state) {
    return new Response(renderResultHtml("error", "Missing auth state. Return to the app and retry sign in."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const signedState = verifyCustomerAuthState(state);
  const unsignedState = parseUnsignedCustomerAuthState(state);
  const parsedState = signedState ?? unsignedState;

  if (!parsedState) {
    return new Response(renderResultHtml("error", "The auth state is invalid or expired. Start sign in again."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const queryShopDomain = rawShop ? normalizeShopDomain(rawShop) : null;
  if (rawShop && (!queryShopDomain || queryShopDomain !== parsedState.shopDomain)) {
    return new Response(renderResultHtml("error", "Shop domain mismatch in callback. Start sign in again."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const runtimeSecrets = await getProjectRuntimeSecrets(parsedState.projectId);
  const parsedSecrets = parseRuntimeSecrets(runtimeSecrets);
  const runtimeDatabaseUrl = parsedSecrets.runtime?.database?.databaseUrl;

  if (!runtimeDatabaseUrl) {
    return new Response(renderResultHtml("error", "Runtime database is not configured for this project."), {
      status: 409,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const shopDomain = parsedSecrets.shopify?.shopDomain;
  if (!shopDomain || shopDomain !== parsedState.shopDomain) {
    return new Response(renderResultHtml("error", "Project auth context was not found. Please retry sign in."), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const session = await getRuntimeCustomerAuthSession(runtimeDatabaseUrl, parsedState.sessionId);
  if (!session) {
    return new Response(renderResultHtml("error", "Auth session was not found. Please retry sign in."), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (session.status === "failed") {
    return new Response(renderResultHtml("error", session.error ?? "Customer auth failed."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (session.status === "expired") {
    return new Response(renderResultHtml("error", session.error ?? "Customer auth session expired."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (session.status === "completed" || session.status === "consumed") {
    return new Response(
      renderResultHtml("success", "Sign in already completed. You can return to the app and continue."),
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }

  const expiresAtMs = Date.parse(session.expiresAt);
  if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
    await markRuntimeCustomerAuthSessionExpired(runtimeDatabaseUrl, session.id);
    return new Response(renderResultHtml("error", "Customer auth session expired."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (oauthError) {
    const message = oauthErrorDescription || oauthError;
    await failSession(runtimeDatabaseUrl, session.id, message);
    return new Response(renderResultHtml("error", message), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const tokenEndpoint = parsedSecrets.shopify?.customerAuth?.customerAccountApi.tokenEndpoint;
  const clientId = parsedSecrets.shopify?.customerAuth?.customerAccountApi.clientId;
  const callbackUrl =
    parsedSecrets.shopify?.customerAuth?.customerAccountApi.callbackUrl || getCustomerAuthCallbackUrl(request.nextUrl.origin);

  if (!tokenEndpoint || !clientId || !callbackUrl || !code || !session.codeVerifier) {
    await failSession(runtimeDatabaseUrl, session.id, "Customer Account API configuration is incomplete.");
    return new Response(renderResultHtml("error", "Customer Account API configuration is incomplete."), {
      status: 409,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  try {
    const tokenSet = await exchangeCustomerAuthCode({
      tokenEndpoint,
      clientId,
      code,
      codeVerifier: session.codeVerifier,
      redirectUri: callbackUrl,
    });

    await markRuntimeCustomerAuthSessionCompleted({
      databaseUrl: runtimeDatabaseUrl,
      sessionId: session.id,
      tokenPayloadEncrypted: JSON.stringify(tokenSet)
    });

    return new Response(
      renderResultHtml("success", "Sign in succeeded. You can return to the app and continue."),
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Failed to exchange auth code.";
    await failSession(runtimeDatabaseUrl, session.id, message);
    return new Response(renderResultHtml("error", message), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
