import Link from "next/link";
import { PublicProject } from "@/lib/models";

interface ProjectListProps {
  projects: PublicProject[];
}

export function ProjectList({ projects }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div className="card project-list-card">
        <p className="section-kicker">Recent workspaces</p>
        <h2 className="form-title">No projects yet</h2>
        <p className="muted">Create your first workspace to start generating a Shopify-powered Expo app.</p>
      </div>
    );
  }

  return (
    <div className="card project-list-card">
      <p className="section-kicker">Recent workspaces</p>
      <h2 className="form-title">Continue building</h2>
      <div className="project-list">
        {projects.map((project) => {
          const latestRun = project.runs[0];
          const sessionStatus = project.devSession?.status ?? "idle";
          const connectionStatus = project.store?.connectedAt ? "Connected" : "Not connected";

          return (
            <Link className="project-item" key={project.id} href={`/projects/${project.id}`}>
              <div className="project-item-head">
                <p className="project-name">{project.name}</p>
                <span className="project-arrow">→</span>
              </div>
              <p className="meta-line">
                <span className="status-chip">Store: {connectionStatus}</span>
                <span className="status-chip">Session: {sessionStatus}</span>
              </p>
              <p className="meta-line">
                Expo SDK {project.expoSdk ?? "unknown"} • {project.preview.screens.length} screens • {project.fileIndex.length} files
              </p>
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
