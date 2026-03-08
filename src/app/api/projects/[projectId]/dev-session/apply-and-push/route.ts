import { NextRequest, NextResponse } from "next/server";
import { applyProjectDevSessionAndPush } from "@/lib/project-service";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Params {
  params: {
    projectId: string;
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const payload = (await request.json().catch(() => ({}))) as {
      commitMessage?: string;
      runInstall?: boolean;
    };

    const result = await applyProjectDevSessionAndPush(params.projectId, {
      commitMessage: payload.commitMessage,
      runInstall: payload.runInstall
    });

    return NextResponse.json(result);
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to apply and push dev session updates." },
      { status: 500 }
    );
  }
}
