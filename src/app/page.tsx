import { ProjectCreateForm } from "@/components/project-create-form";
import { ProjectList } from "@/components/project-list";
import { listPublicProjects } from "@/lib/project-service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await listPublicProjects();

  return (
    <main className="home-shell">
      <header className="home-header">
        <div>
          <p className="pill">Shopify + Expo + AI</p>
          <h1 className="home-title">Build Shopify Store Mobile Apps With AI</h1>
          <p className="home-subtitle">
            Left panel chat drives code generation. Right panel mirrors a live mobile preview. Every successful AI
            update can be committed directly into a GitHub repository.
          </p>
        </div>
      </header>

      <section className="home-grid">
        <ProjectCreateForm />
        <ProjectList projects={projects} />
      </section>
    </main>
  );
}
