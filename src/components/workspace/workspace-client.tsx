"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { MobilePreview } from "@/components/workspace/mobile-preview";
import { ChatMessage, DevSessionState, PublicProject } from "@/lib/models";

interface WorkspaceClientProps {
  initialProject: PublicProject;
}

type ThinkingMode = "low" | "medium" | "high" | "xHigh";
type CodeViewerScope = "expo" | "backend";
type RightWorkspaceTab = "preview" | "code" | "runtime" | "store" | "logs";

const LLM_MODEL_OPTIONS = ["gpt-5.4"];
const THINKING_MODE_OPTIONS: ThinkingMode[] = ["low", "medium", "high", "xHigh"];

const OPERATIONAL_MESSAGE_PREFIXES = [
  "Project initialized.",
  "Ready. Prompt me",
  "Dev session started (",
  "Dev session stopped",
  "Dev session no longer exists on runner.",
  "Dev session was already gone on runner",
  "Dev session not found on runner during commit.",
  "Store setup:",
  "Store setup failed:",
  "Store connected:",
  "Expo scaffold warnings:"
];

function isOperationalMessage(message: ChatMessage): boolean {
  if (message.role === "system") {
    return true;
  }

  return OPERATIONAL_MESSAGE_PREFIXES.some((prefix) => message.content.startsWith(prefix));
}

function formatLogLine(message: ChatMessage): string {
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  return `[${time}] ${message.content}`;
}

function normalizeWorkspaceDir(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "." || trimmed === "./") {
    return ".";
  }

  return trimmed.replace(/^\.\//, "").replace(/\/$/, "") || fallback;
}

function isFileInsideDir(filePath: string, dir: string): boolean {
  if (dir === ".") {
    return true;
  }

  return filePath === dir || filePath.startsWith(`${dir}/`);
}

export function WorkspaceClient({ initialProject }: WorkspaceClientProps) {
  const searchParams = useSearchParams();
  const [project, setProject] = useState<PublicProject>(initialProject);
  const [prompt, setPrompt] = useState("");
  const [storeDomain, setStoreDomain] = useState(initialProject.store?.shopDomain ?? "");
  const [selectedModel, setSelectedModel] = useState(LLM_MODEL_OPTIONS[0]);
  const [selectedThinking, setSelectedThinking] = useState<ThinkingMode>("medium");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<RightWorkspaceTab>("preview");
  const [codeViewerScope, setCodeViewerScope] = useState<CodeViewerScope>("expo");
  const [isSendingPrompt, setIsSendingPrompt] = useState(false);
  const [isConnectingStore, setIsConnectingStore] = useState(false);
  const [isStartingDevSession, setIsStartingDevSession] = useState(false);
  const [isRefreshingDevSession, setIsRefreshingDevSession] = useState(false);
  const [isStoppingDevSession, setIsStoppingDevSession] = useState(false);
  const [isCommittingDevSession, setIsCommittingDevSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devSessionFeedback, setDevSessionFeedback] = useState<string | null>(null);
  const [devSessionError, setDevSessionError] = useState<string | null>(null);
  const [streamedResponse, setStreamedResponse] = useState("");
  const [streamEvents, setStreamEvents] = useState<string[]>([]);
  const [repoFiles, setRepoFiles] = useState<string[]>(initialProject.fileIndex ?? []);
  const [selectedCodeFile, setSelectedCodeFile] = useState("");
  const [isLoadingCode, setIsLoadingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeContent, setCodeContent] = useState("");
  const [isBinaryCode, setIsBinaryCode] = useState(false);
  const [customerClientIdInput, setCustomerClientIdInput] = useState("");
  const [isSavingCustomerClientId, setIsSavingCustomerClientId] = useState(false);
  const [customerClientIdFeedback, setCustomerClientIdFeedback] = useState<string | null>(null);

  const oauthStatus = searchParams.get("shopify_oauth");
  const oauthShop = searchParams.get("shop");
  const oauthReason = searchParams.get("reason");
  const oauthDetail = searchParams.get("detail");

  const latestRun = project.runs[0];
  const devSession = project.devSession;
  const customerAuth = project.store?.customerAuth;
  const hasActiveDevSession = Boolean(devSession && (devSession.status === "starting" || devSession.status === "ready"));

  const visibleMessages = useMemo(
    () => project.messages.filter((message) => !isOperationalMessage(message)).slice(-24),
    [project.messages]
  );

  const projectActivityLogs = useMemo(
    () => project.messages.filter(isOperationalMessage).map(formatLogLine).slice(-80),
    [project.messages]
  );

  const liveStreamLines = useMemo(() => {
    const lines: string[] = [];

    if (streamedResponse.trim()) {
      lines.push(`[assistant] ${streamedResponse.trim()}`);
    }

    for (const entry of streamEvents) {
      lines.push(`[event] ${entry}`);
    }

    return lines;
  }, [streamEvents, streamedResponse]);

  const expoQrUrl = useMemo(() => {
    if (!devSession?.expoUrl || devSession.status !== "ready") {
      return null;
    }

    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(devSession.expoUrl)}`;
  }, [devSession?.expoUrl, devSession?.status]);

  const branchName = project.github.defaultBranch ?? "main";
  const customerApiHasClientId = Boolean(customerAuth?.customerAccountApi.hasClientId);
  const mobileCodeRoot = useMemo(
    () => normalizeWorkspaceDir(project.workspaceLayout?.mobileAppDir, "mobile"),
    [project.workspaceLayout?.mobileAppDir]
  );
  const backendCodeRoot = useMemo(
    () => normalizeWorkspaceDir(project.workspaceLayout?.expoBackendDir ?? project.workspaceLayout?.backendDir, "expo-backend"),
    [project.workspaceLayout?.expoBackendDir, project.workspaceLayout?.backendDir]
  );

  const expoCodeFiles = useMemo(() => {
    if (mobileCodeRoot === ".") {
      if (backendCodeRoot === ".") {
        return repoFiles;
      }

      return repoFiles.filter((filePath) => !isFileInsideDir(filePath, backendCodeRoot));
    }

    return repoFiles.filter((filePath) => isFileInsideDir(filePath, mobileCodeRoot));
  }, [backendCodeRoot, mobileCodeRoot, repoFiles]);

  const backendCodeFiles = useMemo(() => {
    if (backendCodeRoot === ".") {
      return repoFiles;
    }

    return repoFiles.filter((filePath) => isFileInsideDir(filePath, backendCodeRoot));
  }, [backendCodeRoot, repoFiles]);

  const visibleCodeFiles = codeViewerScope === "expo" ? expoCodeFiles : backendCodeFiles;
  const runtimeBackendUrl = devSession?.expoBackendUrl ?? devSession?.backendUrl;

  const workspaceTabs: Array<{ id: RightWorkspaceTab; label: string; glyph: string }> = [
    { id: "preview", label: "Preview", glyph: "PV" },
    { id: "code", label: "Code", glyph: "CD" },
    { id: "runtime", label: "Runtime", glyph: "RT" },
    { id: "store", label: "Store", glyph: "ST" },
    { id: "logs", label: "Logs", glyph: "LG" }
  ];

  const refreshProject = useCallback(async () => {
    const response = await fetch(`/api/projects/${project.id}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as { project?: PublicProject; error?: string } | null;
    if (!response.ok || !payload?.project) {
      throw new Error(payload?.error ?? "Failed to refresh project.");
    }

    setProject(payload.project);
  }, [project.id]);

  const refreshRepoFiles = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${project.id}/files`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as { files?: string[]; error?: string } | null;
      if (!response.ok || !Array.isArray(payload?.files)) {
        return;
      }

      setRepoFiles(payload.files);
    } catch {
      // keep previous list
    }
  }, [project.id]);

  useEffect(() => {
    void refreshRepoFiles();
  }, [refreshRepoFiles]);

  useEffect(() => {
    setCustomerClientIdFeedback(null);
  }, [project.id]);

  useEffect(() => {
    if (activeWorkspaceTab !== "code") {
      return;
    }

    if (visibleCodeFiles.length === 0) {
      if (selectedCodeFile) {
        setSelectedCodeFile("");
      }
      return;
    }

    if (!selectedCodeFile || !visibleCodeFiles.includes(selectedCodeFile)) {
      setSelectedCodeFile(visibleCodeFiles[0]);
    }
  }, [activeWorkspaceTab, selectedCodeFile, visibleCodeFiles]);

  useEffect(() => {
    if (activeWorkspaceTab !== "code" || !selectedCodeFile) {
      setCodeContent("");
      setCodeError(null);
      setIsBinaryCode(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      setIsLoadingCode(true);
      setCodeError(null);

      try {
        const response = await fetch(`/api/projects/${project.id}/code?path=${encodeURIComponent(selectedCodeFile)}`, {
          cache: "no-store"
        });

        const payload = (await response.json()) as {
          content?: string;
          isBinary?: boolean;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load file content.");
        }

        if (cancelled) {
          return;
        }

        setIsBinaryCode(Boolean(payload.isBinary));
        setCodeContent(typeof payload.content === "string" ? payload.content : "");
      } catch (caught) {
        if (cancelled) {
          return;
        }

        setCodeError(caught instanceof Error ? caught.message : "Failed to load file content.");
        setCodeContent("");
        setIsBinaryCode(false);
      } finally {
        if (!cancelled) {
          setIsLoadingCode(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceTab, project.id, selectedCodeFile]);

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
        const response = await fetch(`/api/projects/${project.id}/dev-session/status?logLines=200`, {
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
    setStreamedResponse("");
    setStreamEvents([]);

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
            event?: { kind?: string; text?: string };
            project?: PublicProject;
            error?: string;
          };

          if (parsed.type === "error") {
            throw new Error(parsed.error ?? "Prompt execution failed.");
          }

          if (parsed.type === "stream" && parsed.event) {
            const eventPayload = parsed.event;
            const eventText = typeof eventPayload.text === "string" ? eventPayload.text : undefined;

            if (eventPayload.kind === "text" && eventText) {
              setStreamedResponse(eventText);
            } else if (eventText) {
              setStreamEvents((current) => [...current.slice(-24), eventText]);
            }
            continue;
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
      void refreshRepoFiles();
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
      setDevSessionFeedback("Dev session started. Waiting for mobile and backend URLs...");
      void refreshRepoFiles();
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
      void refreshRepoFiles();
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
      setDevSessionFeedback(
        payload.committed ? `Pushed ${payload.commitSha ? payload.commitSha.slice(0, 12) : "latest updates"}.` : "No file changes to commit."
      );
      void refreshRepoFiles();
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
    <div className="workspace-v2">
      <section className="workspace-chat-pane">
        <div className="workspace-chat-head">
          <div>
            <p className="workspace-brandline">Shopify Mobile Studio</p>
            <h1 className="workspace-title">{project.name}</h1>
            <p className="workspace-subtitle">AI prompt-first workspace. Tools and runtime tabs are on the right.</p>
          </div>
          <Link className="back-link" href="/">
            Back
          </Link>
        </div>

        <div className="workspace-chat-history">
          {visibleMessages.length > 0 ? (
            visibleMessages.map((message) => (
              <div className={`msg msg-${message.role}`} key={message.id}>
                {message.content}
              </div>
            ))
          ) : (
            <p className="meta-line">No chat replies yet. Send a prompt to start building.</p>
          )}

          <div className={`run-meta live-stream-panel ${isSendingPrompt ? "streaming-active" : ""}`}>
            <h3>Live AI Stream</h3>
            <div className="log-console live-stream-console">{liveStreamLines.length > 0 ? liveStreamLines.join("\n\n") : "Awaiting streamed response..."}</div>
          </div>
        </div>

        <form className="workspace-composer" onSubmit={submitPrompt}>
          <textarea className="text-area" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Keep building" />
          <div className="workspace-composer-row">
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

      <section className="workspace-main-pane">
        <header className="workspace-main-topbar">
          <div className="workspace-topbar-left">
            <span className="status-light" />
            <p>Session: {devSession ? getDevSessionStatusLabel(devSession) : "idle"}</p>
          </div>
          <div className="workspace-topbar-right">
            <p className="meta-line">Store: {project.store?.connectedAt ? "connected" : "not connected"}</p>
            <p className="meta-line">Workspace {project.id.slice(0, 8)}</p>
          </div>
        </header>

        <div className="workspace-main-body">
          <nav className="workspace-tool-rail">
            {workspaceTabs.map((tab) => (
              <button
                className={`tool-tab ${activeWorkspaceTab === tab.id ? "tool-tab-active" : ""}`}
                key={tab.id}
                onClick={() => setActiveWorkspaceTab(tab.id)}
                type="button"
              >
                <span className="tool-tab-glyph">{tab.glyph}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className="workspace-tab-wrap">
            <div className="workspace-tab-toolbar">
              {activeWorkspaceTab === "preview" ? (
                <>
                  <div className="toolbar-pills">
                    <span className="toolbar-pill toolbar-pill-active">iOS</span>
                    <span className="toolbar-pill">Web</span>
                    <span className="toolbar-pill">Simulator</span>
                  </div>
                  <button
                    className="toolbar-button"
                    disabled={!devSession?.expoUrl}
                    onClick={() => {
                      if (devSession?.expoUrl) {
                        window.open(devSession.expoUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                    type="button"
                  >
                    Open on mobile
                  </button>
                </>
              ) : (
                <>
                  <h3 className="workspace-tab-title">{workspaceTabs.find((tab) => tab.id === activeWorkspaceTab)?.label}</h3>
                  <p className="meta-line">Branch: {branchName}</p>
                </>
              )}
            </div>

            <div className="workspace-tab-content">
              {activeWorkspaceTab === "preview" ? (
                <div className="preview-workbench">
                  <div className="preview-device-stage">
                    <MobilePreview preview={project.preview} />
                  </div>
                  <aside className="preview-side-card">
                    <p className="meta-line">Expo backend: {devSession?.expoBackendStatus ?? devSession?.backendStatus ?? "not running"}</p>
                    {runtimeBackendUrl ? (
                      <p className="meta-line">
                        Backend URL: <a href={runtimeBackendUrl}>{runtimeBackendUrl}</a>
                      </p>
                    ) : null}
                    <div className="inline-grid">
                      <button className="button" disabled={isStartingDevSession || hasActiveDevSession} onClick={startDevSession} type="button">
                        {isStartingDevSession ? "Starting..." : "Start"}
                      </button>
                      <button className="button" disabled={!devSession || isRefreshingDevSession} onClick={() => refreshDevSession(true)} type="button">
                        {isRefreshingDevSession ? "Refreshing..." : "Refresh"}
                      </button>
                    </div>
                    {expoQrUrl ? (
                      <div className="expo-qr-wrap">
                        <Image alt="Expo Go QR code" className="expo-qr" height={220} src={expoQrUrl} width={220} />
                        <p className="meta-line">Scan with Expo Go</p>
                      </div>
                    ) : (
                      <p className="meta-line">Start dev session to view live app on device.</p>
                    )}
                  </aside>
                </div>
              ) : null}

              {activeWorkspaceTab === "code" ? (
                <div className="run-meta">
                  <div className="inline-grid">
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        setCodeViewerScope("expo");
                        setActiveWorkspaceTab("code");
                      }}
                    >
                      Expo Files
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        setCodeViewerScope("backend");
                        setActiveWorkspaceTab("code");
                      }}
                    >
                      Backend Files
                    </button>
                  </div>
                  <select className="text-input" value={selectedCodeFile} onChange={(event) => setSelectedCodeFile(event.target.value)}>
                    {visibleCodeFiles.length === 0 ? <option value="">No files available</option> : null}
                    {visibleCodeFiles.map((filePath) => (
                      <option key={filePath} value={filePath}>
                        {filePath}
                      </option>
                    ))}
                  </select>
                  {codeError ? <p className="error-text">{codeError}</p> : null}
                  <div className="log-console code-console">
                    {isLoadingCode
                      ? "Loading file..."
                      : isBinaryCode
                        ? "Binary file preview is not supported in viewer."
                        : codeContent || "No file selected."}
                  </div>
                </div>
              ) : null}

              {activeWorkspaceTab === "runtime" ? (
                <div className="run-meta">
                  <p className="meta-line">Status: {devSession ? getDevSessionStatusLabel(devSession) : "not running"}</p>
                  {devSessionFeedback ? <p className="meta-line">{devSessionFeedback}</p> : null}
                  {devSessionError ? <p className="error-text">{devSessionError}</p> : null}
                  {devSession?.error ? <p className="error-text">Runner: {devSession.error}</p> : null}
                  <div className="inline-grid">
                    <button className="button" disabled={isStartingDevSession || hasActiveDevSession} onClick={startDevSession} type="button">
                      {isStartingDevSession ? "Starting..." : "Start Session"}
                    </button>
                    <button className="button" disabled={!devSession || isRefreshingDevSession} onClick={() => refreshDevSession(true)} type="button">
                      {isRefreshingDevSession ? "Refreshing..." : "Refresh Status"}
                    </button>
                    <button className="button" disabled={!devSession || isCommittingDevSession} onClick={commitDevSessionChanges} type="button">
                      {isCommittingDevSession ? "Committing..." : "Commit Changes"}
                    </button>
                    <button className="button" disabled={!devSession || isStoppingDevSession || devSession.status === "stopped"} onClick={stopDevSession} type="button">
                      {isStoppingDevSession ? "Stopping..." : "Stop Session"}
                    </button>
                  </div>
                  <div className="log-console">{devSession?.logs?.length ? devSession.logs.join("\n") : "No mobile dev logs yet."}</div>
                </div>
              ) : null}

              {activeWorkspaceTab === "store" ? (
                <div className="run-meta">
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
                  {customerAuth ? <p className="meta-line">Customer auth method: {customerAuth.activeMethod}</p> : null}
                  {customerAuth ? <p className="meta-line">Customer Account API client ID: {customerApiHasClientId ? "configured" : "missing"}</p> : null}
                  {customerAuth ? (
                    <>
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
              ) : null}

              {activeWorkspaceTab === "logs" ? (
                <div className="run-meta">
                  <details className="log-details" open>
                    <summary>Project activity logs</summary>
                    <div className="log-console">{projectActivityLogs.length ? projectActivityLogs.join("\n") : "No project activity yet."}</div>
                  </details>
                  <details className="log-details" open>
                    <summary>Mobile dev logs</summary>
                    <div className="log-console">{devSession?.logs?.length ? devSession.logs.join("\n") : "No mobile dev logs yet."}</div>
                  </details>
                  <details className="log-details" open>
                    <summary>Expo backend logs</summary>
                    <div className="log-console">
                      {(devSession?.expoBackendLogs ?? devSession?.backendLogs)?.length
                        ? (devSession?.expoBackendLogs ?? devSession?.backendLogs)?.join("\n")
                        : "No expo backend logs yet."}
                    </div>
                  </details>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
