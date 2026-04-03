"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { DevSessionState, PublicProject } from "@/lib/models";

interface WorkspaceClientProps {
  initialProject: PublicProject;
}

type ThinkingMode = "low" | "medium" | "high" | "xHigh";
type WorkspaceTab = "preview" | "mobile" | "backend" | "database";

interface DatabaseColumn {
  name: string;
  type: string;
}

interface DatabaseResponse {
  database?: {
    provider?: string;
    databaseName?: string;
  };
  tables?: string[];
  selectedTable?: string | null;
  columns?: DatabaseColumn[];
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
  error?: string;
}

const LLM_MODEL_OPTIONS = ["gpt-5.4"];
const THINKING_MODE_OPTIONS: ThinkingMode[] = ["low", "medium", "high", "xHigh"];

function renderCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

export function WorkspaceClient({ initialProject }: WorkspaceClientProps) {
  const searchParams = useSearchParams();
  const [project, setProject] = useState<PublicProject>(initialProject);
  const [prompt, setPrompt] = useState("");
  const [storeDomain, setStoreDomain] = useState(initialProject.store?.shopDomain ?? "");
  const [selectedModel, setSelectedModel] = useState(LLM_MODEL_OPTIONS[0]);
  const [selectedThinking, setSelectedThinking] = useState<ThinkingMode>("medium");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("preview");
  const [isSendingPrompt, setIsSendingPrompt] = useState(false);
  const [isConnectingStore, setIsConnectingStore] = useState(false);
  const [isStartingDevSession, setIsStartingDevSession] = useState(false);
  const [isRefreshingDevSession, setIsRefreshingDevSession] = useState(false);
  const [isStoppingDevSession, setIsStoppingDevSession] = useState(false);
  const [isCommittingDevSession, setIsCommittingDevSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devSessionFeedback, setDevSessionFeedback] = useState<string | null>(null);
  const [devSessionError, setDevSessionError] = useState<string | null>(null);
  const [customerClientIdInput, setCustomerClientIdInput] = useState("");
  const [isSavingCustomerClientId, setIsSavingCustomerClientId] = useState(false);
  const [customerClientIdFeedback, setCustomerClientIdFeedback] = useState<string | null>(null);

  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbTables, setDbTables] = useState<string[]>([]);
  const [dbSelectedTable, setDbSelectedTable] = useState<string | null>(null);
  const [dbColumns, setDbColumns] = useState<DatabaseColumn[]>([]);
  const [dbRows, setDbRows] = useState<Array<Record<string, unknown>>>([]);
  const [dbRowCount, setDbRowCount] = useState(0);
  const [dbName, setDbName] = useState<string | undefined>(undefined);

  const oauthStatus = searchParams.get("shopify_oauth");
  const oauthShop = searchParams.get("shop");
  const oauthReason = searchParams.get("reason");
  const oauthDetail = searchParams.get("detail");

  const latestRun = project.runs[0];
  const devSession = project.devSession;
  const customerAuth = project.store?.customerAuth;
  const customerApiHasClientId = Boolean(customerAuth?.customerAccountApi.hasClientId);
  const hasActiveDevSession = Boolean(devSession && (devSession.status === "starting" || devSession.status === "ready"));

  const expoBackendLogs = devSession?.expoBackendLogs ?? devSession?.backendLogs;
  const expoBackendStatus = devSession?.expoBackendStatus ?? devSession?.backendStatus;
  const expoBackendUrl = devSession?.expoBackendUrl ?? devSession?.backendUrl;

  const expoQrUrl = useMemo(() => {
    if (!devSession?.expoUrl || devSession.status !== "ready") {
      return null;
    }

    return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(devSession.expoUrl)}`;
  }, [devSession?.expoUrl, devSession?.status]);

  const refreshProject = useCallback(async () => {
    const response = await fetch(`/api/projects/${project.id}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as { project?: PublicProject; error?: string } | null;
    if (!response.ok || !payload?.project) {
      throw new Error(payload?.error ?? "Failed to refresh project.");
    }

    setProject(payload.project);
  }, [project.id]);

  const refreshDatabaseExplorer = useCallback(
    async (nextTable?: string | null) => {
      setDbLoading(true);
      setDbError(null);

      try {
        const tableParam = nextTable ?? dbSelectedTable;
        const query = tableParam ? `?table=${encodeURIComponent(tableParam)}` : "";
        const response = await fetch(`/api/projects/${project.id}/database${query}`, {
          cache: "no-store"
        });

        const payload = (await response.json().catch(() => null)) as DatabaseResponse | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.error ?? "Failed to load database explorer.");
        }

        setDbTables(payload.tables ?? []);
        setDbSelectedTable(payload.selectedTable ?? null);
        setDbColumns(payload.columns ?? []);
        setDbRows(payload.rows ?? []);
        setDbRowCount(payload.rowCount ?? 0);
        setDbName(payload.database?.databaseName);
      } catch (caught) {
        setDbError(caught instanceof Error ? caught.message : "Failed to load database explorer.");
        setDbRows([]);
      } finally {
        setDbLoading(false);
      }
    },
    [dbSelectedTable, project.id]
  );

  const refreshDevSession = useCallback(
    async (withSpinner = true) => {
      if (!project.devSession?.id) {
        return;
      }

      if (withSpinner) {
        setIsRefreshingDevSession(true);
      }

      setDevSessionError(null);

      try {
        const response = await fetch(`/api/projects/${project.id}/dev-session/status?logLines=300`, {
          cache: "no-store"
        });

        const payload = (await response.json()) as { project?: PublicProject; error?: string };
        if (!response.ok || !payload.project) {
          throw new Error(payload.error ?? "Failed to refresh dev session.");
        }

        setProject(payload.project);
      } catch (caught) {
        setDevSessionError(caught instanceof Error ? caught.message : "Failed to refresh dev session.");
      } finally {
        if (withSpinner) {
          setIsRefreshingDevSession(false);
        }
      }
    },
    [project.devSession?.id, project.id]
  );

  useEffect(() => {
    if (!devSession || (devSession.status !== "starting" && devSession.status !== "ready")) {
      return;
    }

    const timer = setInterval(() => {
      void refreshDevSession(false);
    }, 4000);

    return () => clearInterval(timer);
  }, [devSession, refreshDevSession]);

  useEffect(() => {
    if (activeTab !== "database") {
      return;
    }

    void refreshDatabaseExplorer();
  }, [activeTab, refreshDatabaseExplorer]);

  async function connectStoreWithOAuth() {
    const normalizedDomain = storeDomain.trim();
    if (!normalizedDomain || isConnectingStore) {
      return;
    }

    setIsConnectingStore(true);
    setError(null);

    try {
      const response = await fetch(`/api/shopify/auth?shop=${encodeURIComponent(normalizedDomain)}&projectId=${encodeURIComponent(project.id)}`);

      const payload = (await response.json()) as { authUrl?: string; error?: string };
      if (!response.ok || !payload.authUrl) {
        throw new Error(payload.error ?? "Failed to start Shopify OAuth.");
      }

      window.location.assign(payload.authUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to start Shopify OAuth.");
      setIsConnectingStore(false);
    }
  }

  async function saveCustomerClientId() {
    const trimmedClientId = customerClientIdInput.trim();
    if (!trimmedClientId || isSavingCustomerClientId) {
      return;
    }

    setIsSavingCustomerClientId(true);
    setCustomerClientIdFeedback(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/shopify/customer-auth/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          customerAccountClientId: trimmedClientId
        })
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to save Customer Account client ID.");
      }

      await refreshProject();
      setCustomerClientIdInput("");
      setCustomerClientIdFeedback("Customer Account client ID saved for this store.");
    } catch (caught) {
      setCustomerClientIdFeedback(caught instanceof Error ? caught.message : "Failed to save Customer Account client ID.");
    } finally {
      setIsSavingCustomerClientId(false);
    }
  }

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || isSendingPrompt) {
      return;
    }

    setIsSendingPrompt(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/messages/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          model: selectedModel,
          thinking: selectedThinking
        })
      });

      if (!response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Prompt stream unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotFinal = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          const parsed = JSON.parse(line) as {
            type?: string;
            project?: PublicProject;
            error?: string;
          };

          if (parsed.type === "error") {
            throw new Error(parsed.error ?? "Prompt execution failed.");
          }

          if (parsed.type === "final" && parsed.project) {
            gotFinal = true;
            setProject(parsed.project);
          }
        }
      }

      if (!gotFinal) {
        throw new Error("Prompt stream ended before final project update.");
      }

      setPrompt("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to run prompt.");
    } finally {
      setIsSendingPrompt(false);
    }
  }

  async function startDevSession() {
    if (isStartingDevSession || hasActiveDevSession) {
      return;
    }

    setIsStartingDevSession(true);
    setDevSessionError(null);
    setDevSessionFeedback(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/dev-session/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          install: true,
          useTunnel: true,
          startExpoBackend: true
        })
      });

      const payload = (await response.json()) as { project?: PublicProject; error?: string };
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? "Failed to start dev session.");
      }

      setProject(payload.project);
      setDevSessionFeedback("Dev session started.");
    } catch (caught) {
      setDevSessionError(caught instanceof Error ? caught.message : "Failed to start dev session.");
    } finally {
      setIsStartingDevSession(false);
    }
  }

  async function stopDevSession() {
    if (!project.devSession?.id || isStoppingDevSession) {
      return;
    }

    setIsStoppingDevSession(true);
    setDevSessionError(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/dev-session/stop`, {
        method: "POST"
      });

      const payload = (await response.json()) as { project?: PublicProject; error?: string };
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? "Failed to stop dev session.");
      }

      setProject(payload.project);
      setDevSessionFeedback("Dev session stopped.");
    } catch (caught) {
      setDevSessionError(caught instanceof Error ? caught.message : "Failed to stop dev session.");
    } finally {
      setIsStoppingDevSession(false);
    }
  }

  async function commitDevSessionChanges() {
    if (!project.devSession?.id || isCommittingDevSession) {
      return;
    }

    setIsCommittingDevSession(true);
    setDevSessionError(null);
    setDevSessionFeedback(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/dev-session/apply-and-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          commitMessage: latestRun?.commitMessage,
          runInstall: false
        })
      });

      const payload = (await response.json()) as {
        project?: PublicProject;
        committed?: boolean;
        commitSha?: string;
        error?: string;
      };

      if (!response.ok || !payload.project || typeof payload.committed !== "boolean") {
        throw new Error(payload.error ?? "Failed to commit changes from dev session.");
      }

      setProject(payload.project);
      setDevSessionFeedback(payload.committed ? `Pushed ${payload.commitSha ? payload.commitSha.slice(0, 12) : "latest updates"}.` : "No changes to commit.");
    } catch (caught) {
      setDevSessionError(caught instanceof Error ? caught.message : "Failed to commit changes from dev session.");
    } finally {
      setIsCommittingDevSession(false);
    }
  }

  function getDevSessionStatusLabel(session: DevSessionState): string {
    return session.status;
  }

  return (
    <div className="workspace-v3">
      <section className="workspace-v3-left">
        <div className="workspace-v3-head">
          <div>
            <p className="workspace-brandline">Shopify Mobile Studio</p>
            <h1 className="workspace-title">{project.name}</h1>
          </div>
          <Link className="back-link" href="/">
            Back
          </Link>
        </div>

        <form className="workspace-v3-composer" onSubmit={submitPrompt}>
          <textarea className="text-area" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Keep building" />
          <div className="workspace-v3-composer-row">
            <select className="text-input" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              {LLM_MODEL_OPTIONS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <select className="text-input" value={selectedThinking} onChange={(event) => setSelectedThinking(event.target.value as ThinkingMode)}>
              {THINKING_MODE_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {`Thinking: ${mode}`}
                </option>
              ))}
            </select>
            <button className="button" disabled={isSendingPrompt} type="submit">
              {isSendingPrompt ? "Streaming..." : "Send Prompt"}
            </button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </section>

      <section className="workspace-v3-right">
        <header className="workspace-v3-topbar">
          <p className="meta-line">Workspace {project.id.slice(0, 8)}</p>
          <p className="meta-line">Session: {devSession ? getDevSessionStatusLabel(devSession) : "idle"}</p>
        </header>

        <div className="workspace-v3-main">
          <nav className="workspace-v3-tabs">
            <button className={`tool-tab ${activeTab === "preview" ? "tool-tab-active" : ""}`} onClick={() => setActiveTab("preview")} type="button">
              <span className="tool-tab-glyph">PV</span>
              <span>Preview</span>
            </button>
            <button className={`tool-tab ${activeTab === "mobile" ? "tool-tab-active" : ""}`} onClick={() => setActiveTab("mobile")} type="button">
              <span className="tool-tab-glyph">MB</span>
              <span>Expo Mobile</span>
            </button>
            <button className={`tool-tab ${activeTab === "backend" ? "tool-tab-active" : ""}`} onClick={() => setActiveTab("backend")} type="button">
              <span className="tool-tab-glyph">BE</span>
              <span>Expo Backend</span>
            </button>
            <button className={`tool-tab ${activeTab === "database" ? "tool-tab-active" : ""}`} onClick={() => setActiveTab("database")} type="button">
              <span className="tool-tab-glyph">DB</span>
              <span>Database</span>
            </button>
          </nav>

          <div className="workspace-v3-panel">
            {activeTab === "preview" ? (
              <div className="workspace-v3-preview-only">{expoQrUrl ? <Image alt="Expo Go QR code" className="expo-qr" height={260} src={expoQrUrl} width={260} /> : null}</div>
            ) : null}

            {activeTab === "mobile" ? (
              <div className="run-meta">
                <p className="meta-line">Running: {devSession ? (devSession.status === "ready" || devSession.status === "starting" ? "yes" : "no") : "no"}</p>
                {devSessionFeedback ? <p className="meta-line">{devSessionFeedback}</p> : null}
                {devSessionError ? <p className="error-text">{devSessionError}</p> : null}
                <div className="inline-grid">
                  <button className="button" disabled={isStartingDevSession || hasActiveDevSession} onClick={startDevSession} type="button">
                    {isStartingDevSession ? "Starting..." : "Start Session"}
                  </button>
                  <button className="button" disabled={!devSession || isRefreshingDevSession} onClick={() => refreshDevSession(true)} type="button">
                    {isRefreshingDevSession ? "Refreshing..." : "Refresh"}
                  </button>
                  <button className="button" disabled={!devSession || isCommittingDevSession} onClick={commitDevSessionChanges} type="button">
                    {isCommittingDevSession ? "Committing..." : "Commit Changes"}
                  </button>
                  <button className="button" disabled={!devSession || isStoppingDevSession || devSession.status === "stopped"} onClick={stopDevSession} type="button">
                    {isStoppingDevSession ? "Stopping..." : "Stop Session"}
                  </button>
                </div>
                <div className="log-console workspace-v3-log">{devSession?.logs?.length ? devSession.logs.join("\n") : "Expo mobile logs appear when session is running."}</div>
              </div>
            ) : null}

            {activeTab === "backend" ? (
              <div className="run-meta">
                <p className="meta-line">Running: {expoBackendStatus === "ready" || expoBackendStatus === "starting" ? "yes" : "no"}</p>
                {expoBackendUrl ? (
                  <p className="meta-line">
                    URL: <a href={expoBackendUrl}>{expoBackendUrl}</a>
                  </p>
                ) : null}
                <div className="log-console workspace-v3-log">{expoBackendLogs?.length ? expoBackendLogs.join("\n") : "Expo backend logs appear when backend is running."}</div>
              </div>
            ) : null}

            {activeTab === "database" ? (
              <div className="workspace-v3-db-wrap">
                <div className="run-meta workspace-v3-store-card">
                  <label className="field-label" htmlFor="storeDomainInput">
                    Shopify Store Domain
                  </label>
                  <input
                    id="storeDomainInput"
                    className="text-input"
                    placeholder="your-shop.myshopify.com"
                    value={storeDomain}
                    onChange={(event) => setStoreDomain(event.target.value)}
                  />
                  <button className="button" disabled={isConnectingStore} onClick={connectStoreWithOAuth} type="button">
                    {isConnectingStore ? "Redirecting..." : "Connect via OAuth"}
                  </button>
                  {oauthStatus === "success" ? <p className="meta-line">Shopify OAuth connected{oauthShop ? `: ${oauthShop}` : ""}.</p> : null}
                  {oauthStatus === "error" ? (
                    <p className="error-text">
                      Shopify OAuth failed{oauthReason ? ` (${oauthReason.replaceAll("_", " ")})` : ""}
                      {oauthDetail ? ` - ${oauthDetail.replaceAll("_", " ")}` : ""}. Try again.
                    </p>
                  ) : null}
                  {customerAuth ? (
                    <>
                      <p className="meta-line">Customer Account API client ID: {customerApiHasClientId ? "configured" : "missing"}</p>
                      <input
                        className="text-input"
                        placeholder="Customer Account API client ID"
                        value={customerClientIdInput}
                        onChange={(event) => setCustomerClientIdInput(event.target.value)}
                      />
                      <button
                        className="button"
                        type="button"
                        disabled={isSavingCustomerClientId || !customerClientIdInput.trim()}
                        onClick={saveCustomerClientId}
                      >
                        {isSavingCustomerClientId ? "Saving..." : "Save Customer Client ID"}
                      </button>
                    </>
                  ) : null}
                  {customerClientIdFeedback ? <p className="meta-line">{customerClientIdFeedback}</p> : null}
                </div>

                <div className="workspace-v3-db-studio">
                  <aside className="workspace-v3-db-sidebar">
                    <div className="workspace-v3-db-sidebar-head">
                      <p className="section-kicker">Tables</p>
                      <button className="toolbar-button" onClick={() => void refreshDatabaseExplorer()} type="button">
                        {dbLoading ? "Loading..." : "Refresh"}
                      </button>
                    </div>
                    {dbTables.length > 0 ? (
                      dbTables.map((tableName) => (
                        <button
                          className={`workspace-v3-db-table ${dbSelectedTable === tableName ? "workspace-v3-db-table-active" : ""}`}
                          key={tableName}
                          onClick={() => {
                            setDbSelectedTable(tableName);
                            void refreshDatabaseExplorer(tableName);
                          }}
                          type="button"
                        >
                          {tableName}
                        </button>
                      ))
                    ) : (
                      <p className="meta-line">No tables found.</p>
                    )}
                  </aside>

                  <section className="workspace-v3-db-main">
                    <header className="workspace-v3-db-main-head">
                      <div>
                        <p className="section-kicker">Runtime DB</p>
                        <h3>{dbSelectedTable ?? "No table selected"}</h3>
                      </div>
                      <p className="meta-line">
                        {dbName ? `${dbName} • ` : ""}
                        {dbRowCount} rows
                      </p>
                    </header>

                    {dbError ? <p className="error-text">{dbError}</p> : null}

                    <div className="workspace-v3-db-grid-wrap">
                      <table className="workspace-v3-db-grid">
                        <thead>
                          <tr>
                            {dbColumns.map((column) => (
                              <th key={column.name}>
                                <span>{column.name}</span>
                                <small>{column.type}</small>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dbRows.map((row, rowIndex) => (
                            <tr key={`${dbSelectedTable ?? "table"}-${rowIndex}`}>
                              {dbColumns.map((column) => (
                                <td key={`${rowIndex}-${column.name}`}>{renderCellValue(row[column.name])}</td>
                              ))}
                            </tr>
                          ))}
                          {dbRows.length === 0 ? (
                            <tr>
                              <td className="workspace-v3-db-empty" colSpan={Math.max(dbColumns.length, 1)}>
                                {dbLoading ? "Loading rows..." : "No rows to display."}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
