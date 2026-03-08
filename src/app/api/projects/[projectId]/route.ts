import { NextResponse } from "next/server";
import { getPublicProject } from "@/lib/project-service";

interface Params {
  params: {
    projectId: string;
  };
}

export async function GET(_: Request, { params }: Params) {
  const project = await getPublicProject(params.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ project });
}
