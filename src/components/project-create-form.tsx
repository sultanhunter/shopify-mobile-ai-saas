"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ExpoSdkOption {
  sdk: string;
  status: "active" | "maintenance";
}

const FALLBACK_SDK_OPTIONS: ExpoSdkOption[] = [{ sdk: "55", status: "active" }];

export function ProjectCreateForm() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [selectedSdk, setSelectedSdk] = useState("55");
  const [sdkOptions, setSdkOptions] = useState<ExpoSdkOption[]>(FALLBACK_SDK_OPTIONS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/expo-sdks", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as
          | {
              defaultSdk?: string;
              supported?: Array<{ sdk?: string; status?: "active" | "maintenance" }>;
            }
          | null;

        if (!response.ok || !payload || !Array.isArray(payload.supported) || cancelled) {
          return;
        }

        const options = payload.supported
          .map((entry) => {
            const sdk = typeof entry.sdk === "string" ? entry.sdk.trim() : "";
            const status = entry.status === "maintenance" ? "maintenance" : "active";
            if (!sdk) return null;
            return { sdk, status };
          })
          .filter((entry): entry is ExpoSdkOption => Boolean(entry));

        if (options.length === 0) {
          return;
        }

        setSdkOptions(options);
        const defaultSdk =
          typeof payload.defaultSdk === "string" && payload.defaultSdk.trim() ? payload.defaultSdk.trim() : options[0].sdk;
        setSelectedSdk(defaultSdk);
      } catch {
        // Keep fallback SDK options.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmed = projectName.trim();
    if (!trimmed) {
      setError("Please provide a project name.");
      return;
    }

    setIsSubmitting(true);
    setTaskStatus("Queued");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: trimmed,
          sdk: selectedSdk
        })
      });

      const payload = (await response.json()) as { task?: { id?: string; status?: string }; error?: string };
      if (!response.ok || !payload.task?.id) {
        throw new Error(payload.error ?? "Failed to create project.");
      }

      const taskId = payload.task.id;
      setTaskStatus("Running workspace setup");

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const taskResponse = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
          cache: "no-store"
        });

        const taskPayload = (await taskResponse.json().catch(() => null)) as
          | {
              task?: {
                status?: string;
                projectId?: string;
                result?: { projectId?: string };
                error?: string;
              };
              error?: string;
            }
          | null;

        if (!taskResponse.ok || !taskPayload?.task) {
          throw new Error(taskPayload?.error ?? "Failed to check workspace task status.");
        }

        const status = taskPayload.task.status ?? "running";
        setTaskStatus(status === "completed" ? "Completed" : status === "failed" ? "Failed" : "Running workspace setup");

        if (status === "completed") {
          const projectId = taskPayload.task.projectId ?? taskPayload.task.result?.projectId;
          if (!projectId) {
            throw new Error("Workspace task completed without project id.");
          }

          router.push(`/projects/${projectId}`);
          router.refresh();
          return;
        }

        if (status === "failed") {
          throw new Error(taskPayload.task.error ?? taskPayload.error ?? "Workspace creation task failed.");
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to create project.");
      setTaskStatus(null);
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
      <label className="field-label" htmlFor="expoSdk">
        Expo SDK Version
      </label>
      <select id="expoSdk" className="text-input" value={selectedSdk} onChange={(event) => setSelectedSdk(event.target.value)}>
        {sdkOptions.map((option) => (
          <option key={option.sdk} value={option.sdk}>
            {`SDK ${option.sdk}${option.status === "maintenance" ? " (maintenance)" : ""}`}
          </option>
        ))}
      </select>
      <p className="muted">
        This creates an Expo SDK {selectedSdk} scaffold (via create-expo-app), initializes AI context, and can auto-create a
        GitHub repo.
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      {taskStatus ? <p className="meta-line">Task: {taskStatus}</p> : null}
      <button className="button" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Creating..." : "Create Workspace"}
      </button>
    </form>
  );
}
