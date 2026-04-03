import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { proxyRuntimeCustomerAuthStart, resolveProjectRuntimeBaseUrl } from "@/lib/runtime-admin-client";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Params {
  params: {
    projectId: string;
  };
}

export async function POST(_: Request, { params }: Params) {
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

    const upstream = await proxyRuntimeCustomerAuthStart(runtimeBaseUrl);
    return NextResponse.json(upstream.payload ?? { error: upstream.error ?? "Failed to start customer auth." }, {
      status: upstream.status
    });
  } catch (caught) {
    return NextResponse.json(
      {
        error: caught instanceof Error ? caught.message : "Failed to start Customer Account API auth session.",
      },
      { status: 500 }
    );
  }
}
