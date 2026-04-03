import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { proxyRuntimeCustomerAuthSession, resolveProjectRuntimeBaseUrl } from "@/lib/runtime-admin-client";

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

export async function GET(_: Request, { params }: Params) {
  try {
    const project = await getProject(params.projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const runtimeBaseUrl = resolveProjectRuntimeBaseUrl(project);
    if (!runtimeBaseUrl) {
      return NextResponse.json(
        { error: "Expo backend URL is unavailable. Start or refresh the dev session and retry." },
        { status: 409 }
      );
    }

    const upstream = await proxyRuntimeCustomerAuthSession(runtimeBaseUrl, params.sessionId);
    return NextResponse.json(upstream.payload ?? { error: upstream.error ?? "Failed to fetch customer auth session." }, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (caught) {
    return NextResponse.json(
      {
        error: caught instanceof Error ? caught.message : "Failed to resolve customer auth session status.",
      },
      { status: 500 }
    );
  }
}
