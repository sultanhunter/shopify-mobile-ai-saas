import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { proxyRuntimeCustomerAuthRefresh, resolveProjectRuntimeBaseUrl } from "@/lib/runtime-admin-client";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Params {
  params: {
    projectId: string;
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const payload = (await request.json()) as {
      refreshToken?: string;
    };

    const refreshToken = payload.refreshToken?.trim();
    if (!refreshToken) {
      return NextResponse.json({ error: "refreshToken is required." }, { status: 400 });
    }

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

    const upstream = await proxyRuntimeCustomerAuthRefresh(runtimeBaseUrl, refreshToken);
    return NextResponse.json(upstream.payload ?? { error: upstream.error ?? "Failed to refresh customer auth token." }, {
      status: upstream.status
    });
  } catch (caught) {
    return NextResponse.json(
      {
        error: caught instanceof Error ? caught.message : "Failed to refresh customer auth token.",
      },
      { status: 500 }
    );
  }
}
