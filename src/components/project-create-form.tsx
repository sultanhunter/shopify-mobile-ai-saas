"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function ProjectCreateForm() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmed = projectName.trim();
    if (!trimmed) {
      setError("Please provide a project name.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: trimmed })
      });

      const payload = (await response.json()) as { project?: { id: string }; error?: string };
      if (!response.ok || !payload.project?.id) {
        throw new Error(payload.error ?? "Failed to create project.");
      }

      router.push(`/projects/${payload.project.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to create project.");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2 className="form-title">Create A New Builder Workspace</h2>
      <label className="field-label" htmlFor="projectName">
        Project Name
      </label>
      <input
        id="projectName"
        className="text-input"
        placeholder="eg. Alpine Outfitters Mobile"
        value={projectName}
        onChange={(event) => setProjectName(event.target.value)}
      />
      <p className="muted">
        This creates an Expo SDK 55 scaffold (via create-expo-app), initializes AI context, and can auto-create a
        GitHub repo.
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      <button className="button" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Creating..." : "Create Workspace"}
      </button>
    </form>
  );
}
