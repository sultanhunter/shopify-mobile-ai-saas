import { NextRequest, NextResponse } from "next/server";
import { createNewProject, listPublicProjects } from "@/lib/project-service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const projects = await listPublicProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { name?: string };
    const name = payload.name?.trim();

    if (!name) {
      return NextResponse.json({ error: "Project name is required." }, { status: 400 });
    }

    const project = await createNewProject(name);
    return NextResponse.json({ project }, { status: 201 });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Could not create project." },
      { status: 500 }
    );
  }
}
