import { NextRequest } from "next/server";
import { getProject, updateProject } from "@/lib/db";
import {
  exchangeCustomerAuthCode,
  getCustomerAuthCallbackUrl,
  verifyCustomerAuthState,
} from "@/lib/shopify-customer-auth";
import { encryptSecret } from "@/lib/secret-crypto";
import { normalizeShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const maxDuration = 120;

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

async function failSession(projectId: string, sessionId: string, error: string): Promise<void> {
  await updateProject(projectId, (current) => {
    const now = new Date().toISOString();
    const sessions = (current.store?.customerAuth?.sessions ?? []).map((entry) =>
      entry.id === sessionId
        ? {
            ...entry,
            status: "failed" as const,
            updatedAt: now,
            error,
            codeVerifier: undefined,
          }
        : entry
    );

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

  const parsedState = verifyCustomerAuthState(state);
  if (!parsedState) {
    return new Response(renderResultHtml("error", "The auth state is invalid or expired. Start sign in again."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const shopDomain = parsedState.shopDomain;
  const queryShopDomain = rawShop ? normalizeShopDomain(rawShop) : null;
  if (rawShop && (!queryShopDomain || queryShopDomain !== shopDomain)) {
    return new Response(renderResultHtml("error", "Shop domain mismatch in callback. Start sign in again."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const project = await getProject(parsedState.projectId);
  if (!project?.store?.customerAuth) {
    return new Response(renderResultHtml("error", "Project auth context was not found. Please retry sign in."), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const session = (project.store.customerAuth.sessions ?? []).find((entry) => entry.id === parsedState.sessionId);
  if (!session) {
    return new Response(renderResultHtml("error", "Auth session was not found. Please retry sign in."), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (oauthError) {
    const message = oauthErrorDescription || oauthError;
    await failSession(project.id, session.id, message);
    return new Response(renderResultHtml("error", message), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const tokenEndpoint = project.store.customerAuth.customerAccountApi.tokenEndpoint;
  const clientId = project.store.customerAuth.customerAccountApi.clientId;
  const callbackUrl = getCustomerAuthCallbackUrl(request.nextUrl.origin);
  if (!tokenEndpoint || !clientId || !callbackUrl || !code || !session.codeVerifier) {
    await failSession(project.id, session.id, "Customer Account API configuration is incomplete.");
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

    await updateProject(project.id, (current) => {
      const now = new Date().toISOString();
      const sessions = (current.store?.customerAuth?.sessions ?? []).map((entry) =>
        entry.id === session.id
          ? {
              ...entry,
              status: "completed" as const,
              updatedAt: now,
              tokenPayloadEncrypted: encryptSecret(JSON.stringify(tokenSet)),
              codeVerifier: undefined,
              error: undefined,
            }
          : entry
      );

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

    return new Response(
      renderResultHtml("success", "Sign in succeeded. You can return to the app and continue."),
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Failed to exchange auth code.";
    await failSession(project.id, session.id, message);
    return new Response(renderResultHtml("error", message), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
