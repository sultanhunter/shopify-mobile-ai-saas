import { NextResponse } from "next/server";
import { getWorkspaceTask } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Params {
  params: {
    taskId: string;
  };
}

export async function GET(_: Request, { params }: Params) {
  try {
    const task = await getWorkspaceTask(params.taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    return NextResponse.json(
      { task },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate"
        }
      }
    );
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to fetch task status." },
      { status: 500 }
    );
  }
}
