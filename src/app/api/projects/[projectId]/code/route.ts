import { NextRequest, NextResponse } from "next/server";
import { readProjectRepoFile } from "@/lib/dev-runner";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Params {
  params: {
    projectId: string;
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const filePath = request.nextUrl.searchParams.get("path")?.trim();
    if (!filePath) {
      return NextResponse.json({ error: "path query parameter is required." }, { status: 400 });
    }

    const file = await readProjectRepoFile(params.projectId, filePath);

    return NextResponse.json({
      path: file.path,
      isBinary: file.isBinary,
      content: file.content
    });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to load file." },
      { status: 500 }
    );
  }
}
