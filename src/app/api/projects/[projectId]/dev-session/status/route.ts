import { NextRequest, NextResponse } from "next/server";
import { refreshProjectDevSession } from "@/lib/project-service";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Params {
  params: {
    projectId: string;
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const logLinesRaw = request.nextUrl.searchParams.get("logLines");
    const logLines = logLinesRaw ? Number(logLinesRaw) : 200;
    const result = await refreshProjectDevSession(params.projectId, Number.isFinite(logLines) ? logLines : 200);
    return NextResponse.json(result);
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to fetch dev session status." },
      { status: 500 }
    );
  }
}
