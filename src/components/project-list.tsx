import Link from "next/link";
import { PublicProject } from "@/lib/models";

interface ProjectListProps {
  projects: PublicProject[];
}

export function ProjectList({ projects }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div className="card">
        <h2 className="form-title">No Projects Yet</h2>
        <p className="muted">Create your first workspace to start generating a Shopify-powered Expo app.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="form-title">Recent Workspaces</h2>
      <div className="project-list">
        {projects.map((project) => {
          const latestRun = project.runs[0];

          return (
            <Link className="project-item" key={project.id} href={`/projects/${project.id}`}>
              <p className="project-name">{project.name}</p>
              <p className="meta-line">{project.preview.screens.length} screens • {project.fileIndex.length} files</p>
              <p className="meta-line">
                Updated: {new Date(project.updatedAt).toLocaleString()} {latestRun ? `• Last run: ${latestRun.summary}` : ""}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
