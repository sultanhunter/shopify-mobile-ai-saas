import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/db";
import { ShopifyCustomerTokenSet } from "@/lib/shopify-customer-auth";
import { decryptSecret } from "@/lib/secret-crypto";

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

  const decrypted = decryptSecret(raw);
  const parsed = JSON.parse(decrypted) as ShopifyCustomerTokenSet;
  if (!parsed || typeof parsed.accessToken !== "string") {
    return undefined;
  }

  return parsed;
}

export async function GET(_: Request, { params }: Params) {
  try {
    const project = await getProject(params.projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const auth = project.store?.customerAuth;
    const sessions = auth?.sessions ?? [];
    const session = sessions.find((entry) => entry.id === params.sessionId);
    if (!session) {
      return NextResponse.json(
        {
          error: "Customer auth session not found.",
          requestedSessionId: params.sessionId,
          knownSessionIds: sessions.map((entry) => entry.id).slice(-10),
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
      await updateProject(project.id, (current) => {
        const now = new Date().toISOString();
        const nextSessions = (current.store?.customerAuth?.sessions ?? []).map((entry) =>
          entry.id === session.id
            ? {
                ...entry,
                status: "expired" as const,
                updatedAt: now,
                error: entry.error ?? "Customer auth session expired.",
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
                      sessions: nextSessions,
                    }
                  : current.store.customerAuth,
              }
            : current.store,
        };
      });

      return NextResponse.json({ status: "expired", error: "Customer auth session expired." });
    }

    if (session.status === "pending" && session.tokenPayloadEncrypted) {
      const tokens = readTokenPayload(session.tokenPayloadEncrypted);
      if (!tokens) {
        return NextResponse.json({ status: "failed", error: "Session token payload is invalid." });
      }

      await updateProject(project.id, (current) => {
        const now = new Date().toISOString();
        const nextSessions = (current.store?.customerAuth?.sessions ?? []).map((entry) =>
          entry.id === session.id
            ? {
                ...entry,
                status: "consumed" as const,
                updatedAt: now,
                tokenPayloadEncrypted: undefined,
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
                      sessions: nextSessions,
                    }
                  : current.store.customerAuth,
              }
            : current.store,
        };
      });

      return NextResponse.json({ status: "completed", tokens });
    }

    if (session.status === "completed") {
      const tokens = readTokenPayload(session.tokenPayloadEncrypted);
      if (!tokens) {
        return NextResponse.json({ status: "failed", error: "Completed session is missing token payload." });
      }

      await updateProject(project.id, (current) => {
        const now = new Date().toISOString();
        const nextSessions = (current.store?.customerAuth?.sessions ?? []).map((entry) =>
          entry.id === session.id
            ? {
                ...entry,
                status: "consumed" as const,
                updatedAt: now,
                tokenPayloadEncrypted: undefined,
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
                      sessions: nextSessions,
                    }
                  : current.store.customerAuth,
              }
            : current.store,
        };
      });

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
