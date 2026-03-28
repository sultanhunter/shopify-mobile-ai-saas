import { NextResponse } from "next/server";
import { listProjectRepoFiles } from "@/lib/dev-runner";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Params {
  params: {
    projectId: string;
  };
}

export async function GET(_: Request, { params }: Params) {
  try {
    const files = await listProjectRepoFiles(params.projectId);
    return NextResponse.json({ files });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to list project files." },
      { status: 500 }
    );
  }
}
