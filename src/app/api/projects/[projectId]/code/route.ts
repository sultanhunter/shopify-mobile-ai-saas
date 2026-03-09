import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const BINARY_BASE64_PREFIX = "__binary_base64__:";

interface Params {
  params: {
    projectId: string;
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const project = await getProject(params.projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const filePath = request.nextUrl.searchParams.get("path")?.trim();
    if (!filePath) {
      return NextResponse.json({ error: "path query parameter is required." }, { status: 400 });
    }

    const content = project.files[filePath];
    if (typeof content !== "string") {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }

    const isBinary = content.startsWith(BINARY_BASE64_PREFIX);

    return NextResponse.json({
      path: filePath,
      branch: project.github.defaultBranch ?? "main",
      isBinary,
      content: isBinary ? "" : content
    });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to load file." },
      { status: 500 }
    );
  }
}
