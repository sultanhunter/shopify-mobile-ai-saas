import { NextResponse } from "next/server";
import { getProject, getProjectRuntimeState, listPendingRuntimeSyncEvents } from "@/lib/db";
import { dispatchProjectRuntimeSync, upsertAndQueueProjectRuntimeSync } from "@/lib/runtime-sync";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Params {
  params: {
    projectId: string;
  };
}

export async function GET(_: Request, { params }: Params) {
  try {
    const runtimeState = await getProjectRuntimeState(params.projectId);
    const pendingEvents = await listPendingRuntimeSyncEvents(params.projectId, 50);

    return NextResponse.json({
      runtimeState: runtimeState
        ? {
            projectId: runtimeState.projectId,
            version: runtimeState.version,
            updatedAt: runtimeState.updatedAt,
          }
        : null,
      pendingEvents: pendingEvents.map((event) => ({
        id: event.id,
        version: event.version,
        status: event.status,
        attempts: event.attempts,
        lastError: event.lastError,
      })),
    });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to inspect runtime sync state." },
      { status: 500 }
    );
  }
}

export async function POST(_: Request, { params }: Params) {
  try {
    const current = await getProjectRuntimeState(params.projectId);
    if (!current) {
      return NextResponse.json(
        { error: "Runtime sync state is not initialized for this project yet." },
        { status: 409 }
      );
    }

    await upsertAndQueueProjectRuntimeSync(params.projectId);
    const project = await getProject(params.projectId);

    const delivered = await dispatchProjectRuntimeSync({
      projectId: params.projectId,
      expoBackendBaseUrl: project?.devSession?.expoBackendUrl ?? project?.devSession?.backendUrl,
    });

    return NextResponse.json({
      ok: true,
      delivered: delivered.delivered,
    });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to run runtime sync." },
      { status: 500 }
    );
  }
}
