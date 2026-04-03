import { NextRequest } from "next/server";
import { getProject } from "@/lib/db";
import { completeRuntimeCustomerAuthCallback, resolveProjectRuntimeBaseUrl } from "@/lib/runtime-admin-client";
import { verifyCustomerAuthState } from "@/lib/shopify-customer-auth";
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

  try {
    const project = await getProject(parsedState.projectId);
    if (!project) {
      return new Response(renderResultHtml("error", "Project not found. Start sign in again."), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const runtimeBaseUrl = resolveProjectRuntimeBaseUrl(project);
    if (!runtimeBaseUrl) {
      return new Response(renderResultHtml("error", "Expo backend URL is unavailable for this project session."), {
        status: 409,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const upstream = await completeRuntimeCustomerAuthCallback(runtimeBaseUrl, {
      sessionId: parsedState.sessionId,
      code,
      oauthError,
      oauthErrorDescription,
      shopDomain: parsedState.shopDomain
    });

    const upstreamStatus = upstream.payload?.status;
    if (upstream.ok && (upstreamStatus === "completed" || upstreamStatus === "already_completed")) {
      return new Response(renderResultHtml("success", "Sign in succeeded. You can return to the app and continue."), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const message = upstream.error || upstream.payload?.error || "Failed to complete customer auth callback.";
    const statusCode = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 500;
    return new Response(renderResultHtml("error", message), {
      status: statusCode,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Failed to complete customer auth callback.";
    return new Response(renderResultHtml("error", message), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
