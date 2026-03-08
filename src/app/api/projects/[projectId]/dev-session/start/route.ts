import { NextRequest, NextResponse } from "next/server";
import { startProjectDevSession } from "@/lib/project-service";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Params {
  params: {
    projectId: string;
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const payload = (await request.json().catch(() => ({}))) as { install?: boolean; useTunnel?: boolean };

    const result = await startProjectDevSession(params.projectId, {
      install: payload.install,
      useTunnel: payload.useTunnel
    });

    return NextResponse.json(result, { status: 202 });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to start dev session." },
      { status: 500 }
    );
  }
}
