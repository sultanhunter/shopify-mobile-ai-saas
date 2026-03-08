import { NextResponse } from "next/server";
import { stopProjectDevSession } from "@/lib/project-service";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Params {
  params: {
    projectId: string;
  };
}

export async function POST(_: Request, { params }: Params) {
  try {
    const result = await stopProjectDevSession(params.projectId);
    return NextResponse.json(result);
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to stop dev session." },
      { status: 500 }
    );
  }
}
