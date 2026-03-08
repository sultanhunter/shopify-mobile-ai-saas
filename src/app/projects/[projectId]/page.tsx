import { notFound } from "next/navigation";
import { WorkspaceClient } from "@/components/workspace/workspace-client";
import { getPublicProject } from "@/lib/project-service";

export const dynamic = "force-dynamic";

interface ProjectPageProps {
  params: {
    projectId: string;
  };
}

export default async function ProjectWorkspacePage({ params }: ProjectPageProps) {
  const project = await getPublicProject(params.projectId);

  if (!project) {
    notFound();
  }

  return <WorkspaceClient initialProject={project} />;
}
