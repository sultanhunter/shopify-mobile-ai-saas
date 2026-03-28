import { NextRequest, NextResponse } from "next/server";
import { listPublicProjects } from "@/lib/project-service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const projects = await listPublicProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { name?: string; sdk?: string };
    const name = payload.name?.trim();
    const sdk = payload.sdk?.trim();

    if (!name) {
      return NextResponse.json({ error: "Project name is required." }, { status: 400 });
    }

    const baseUrl = process.env.RUNNER_SERVER_BASE_URL?.trim() || process.env.AI_SERVER_BASE_URL?.trim();
    if (!baseUrl) {
      return NextResponse.json({ error: "RUNNER_SERVER_BASE_URL is missing." }, { status: 500 });
    }

    const headers: HeadersInit = {
      "Content-Type": "application/json"
    };

    const token = process.env.RUNNER_SERVER_TOKEN?.trim() || process.env.AI_SERVER_TOKEN?.trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const backendPortRaw = Number(process.env.WORKSPACE_EXPO_BACKEND_PORT || process.env.WORKSPACE_BACKEND_PORT || "4100");
    const backendPort = Number.isFinite(backendPortRaw) && backendPortRaw > 0 ? backendPortRaw : 4100;

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/shopify-mobile/tasks/workspace/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name,
        sdk: sdk || "55",
        workspaceLayout: {
          mobileAppDir: process.env.WORKSPACE_MOBILE_APP_DIR?.trim() || "mobile",
          expoBackendDir: process.env.WORKSPACE_EXPO_BACKEND_DIR?.trim() || process.env.WORKSPACE_BACKEND_DIR?.trim() || "expo-backend",
          expoBackendPort: backendPort,
          backendDir: process.env.WORKSPACE_EXPO_BACKEND_DIR?.trim() || process.env.WORKSPACE_BACKEND_DIR?.trim() || "expo-backend",
          backendPort,
        }
      })
    });

    const body = (await response.json().catch(() => null)) as
      | {
          task?: { id?: string; status?: string };
          error?: string;
        }
      | null;

    if (!response.ok || !body?.task?.id) {
      return NextResponse.json({ error: body?.error ?? "Failed to create workspace task." }, { status: 500 });
    }

    return NextResponse.json({ task: body.task }, { status: 202 });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Could not create project." },
      { status: 500 }
    );
  }
}
