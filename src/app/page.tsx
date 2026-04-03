import { ProjectCreateForm } from "@/components/project-create-form";
import { ProjectList } from "@/components/project-list";
import { ThemeToggle } from "@/components/theme-toggle";
import { listPublicProjects } from "@/lib/project-service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await listPublicProjects();
  const connectedStores = projects.filter((project) => Boolean(project.store?.connectedAt)).length;
  const activeSessions = projects.filter((project) => {
    const status = project.devSession?.status;
    return status === "starting" || status === "ready";
  }).length;
  const totalRuns = projects.reduce((count, project) => count + project.runs.length, 0);

  return (
    <main className="home-shell">
      <header className="home-nav">
        <div className="brand-wrap">
          <span className="brand-mark">SM</span>
          <div>
            <p className="brand-label">Shopify Mobile Studio</p>
            <p className="brand-sub">AI-powered app workspace</p>
          </div>
        </div>
        <div className="home-nav-actions">
          <p className="pill">Production Runtime Architecture</p>
          <ThemeToggle />
        </div>
      </header>

      <section className="home-header">
        <div>
          <p className="eyebrow">World-class build flow</p>
          <h1 className="home-title">Design, generate, preview, and ship Shopify mobile apps in one workspace</h1>
          <p className="home-subtitle">
            Create the project, connect the store, watch step-by-step setup progress, and iterate with streaming AI +
            live Expo backend sync.
          </p>
        </div>
        <div className="stats-grid">
          <article className="stat-card">
            <p className="stat-label">
              <span className="stat-dot" /> Projects
            </p>
            <p className="stat-value">{projects.length}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">
              <span className="stat-dot" /> Stores Connected
            </p>
            <p className="stat-value">{connectedStores}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">
              <span className="stat-dot" /> Active Dev Sessions
            </p>
            <p className="stat-value">{activeSessions}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">
              <span className="stat-dot" /> AI Runs
            </p>
            <p className="stat-value">{totalRuns}</p>
          </article>
        </div>
      </section>

      <section className="home-grid">
        <ProjectCreateForm />
        <ProjectList projects={projects} />
      </section>
    </main>
  );
}
