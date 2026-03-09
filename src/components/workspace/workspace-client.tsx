"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ChatMessage, DevSessionState, PublicProject } from "@/lib/models";

interface WorkspaceClientProps {
  initialProject: PublicProject;
}

type ThinkingMode = "low" | "medium" | "high" | "xHigh";

const LLM_MODEL_OPTIONS = ["gpt-5.4"];
const THINKING_MODE_OPTIONS: ThinkingMode[] = ["low", "medium", "high", "xHigh"];

const OPERATIONAL_MESSAGE_PREFIXES = [
  "Project initialized.",
  "Ready. Prompt me",
  "Dev session started (",
  "Dev session stopped.",
  "Dev session no longer exists on runner.",
  "Dev session was already gone on runner",
  "Dev session not found on runner during commit.",
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

export function WorkspaceClient({ initialProject }: WorkspaceClientProps) {
  const [project, setProject] = useState<PublicProject>(initialProject);
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(LLM_MODEL_OPTIONS[0]);
  const [selectedThinking, setSelectedThinking] = useState<ThinkingMode>("medium");
  const [isSendingPrompt, setIsSendingPrompt] = useState(false);
  const [isStartingDevSession, setIsStartingDevSession] = useState(false);
  const [isRefreshingDevSession, setIsRefreshingDevSession] = useState(false);
  const [isStoppingDevSession, setIsStoppingDevSession] = useState(false);
  const [isCommittingDevSession, setIsCommittingDevSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devSessionFeedback, setDevSessionFeedback] = useState<string | null>(null);
  const [devSessionError, setDevSessionError] = useState<string | null>(null);
  const [streamedResponse, setStreamedResponse] = useState("");
  const [streamEvents, setStreamEvents] = useState<string[]>([]);
  const [selectedCodeFile, setSelectedCodeFile] = useState(initialProject.fileIndex[0] ?? "");
  const [isLoadingCode, setIsLoadingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeContent, setCodeContent] = useState("");
  const [isBinaryCode, setIsBinaryCode] = useState(false);

  const latestRun = project.runs[0];
  const devSession = project.devSession;
  const hasActiveDevSession = Boolean(devSession && (devSession.status === "starting" || devSession.status === "ready"));

  const visibleMessages = useMemo(
    () => project.messages.filter((message) => !isOperationalMessage(message)).slice(-24),
    [project.messages]
  );
  const projectActivityLogs = useMemo(
    () => project.messages.filter(isOperationalMessage).map(formatLogLine).slice(-60),
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

  useEffect(() => {
    if (project.fileIndex.length === 0) {
      if (selectedCodeFile) {
        setSelectedCodeFile("");
      }
      return;
    }

    if (!selectedCodeFile || !project.fileIndex.includes(selectedCodeFile)) {
      setSelectedCodeFile(project.fileIndex[0]);
    }
  }, [project.fileIndex, selectedCodeFile]);

  useEffect(() => {
    if (!selectedCodeFile) {
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
  }, [project.id, selectedCodeFile]);

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
          useTunnel: true
        })
      });

      const payload = (await response.json()) as { project?: PublicProject; error?: string };
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? "Failed to start dev session.");
      }

      setProject(payload.project);
      setDevSessionFeedback("Dev session started. Waiting for preview URL...");
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
      setDevSessionFeedback(
        payload.committed
          ? `Pushed ${payload.commitSha ? payload.commitSha.slice(0, 12) : "latest updates"}.`
          : "No file changes to commit."
      );
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
    <div className="workspace-shell">
      <section className="chat-column">
        <div className="panel-head">
          <Link className="back-link" href="/">
            Back to projects
          </Link>
          <h1 className="panel-title">{project.name}</h1>
          <p className="panel-subtitle">AI chat with streaming responses via OpenCode.</p>
        </div>

        <div className="chat-main">
          <div className="messages chat-history">
            {visibleMessages.length > 0 ? (
              visibleMessages.map((message) => (
                <div className={`msg msg-${message.role}`} key={message.id}>
                  {message.content}
                </div>
              ))
            ) : (
              <p className="meta-line">No chat replies yet. Project activity logs are shown in the right panel.</p>
            )}
          </div>

          <div className="run-meta live-stream-panel">
            <h3>Live AI Stream</h3>
            <div className="log-console live-stream-console">
              {liveStreamLines.length > 0 ? liveStreamLines.join("\n\n") : "Awaiting streamed response..."}
            </div>
          </div>
        </div>

        <form className="composer" onSubmit={submitPrompt}>
          <textarea
            className="text-area"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Build a Shopify loyalty flow with points wallet and order tracking timeline."
          />
          <select className="text-input" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
            {LLM_MODEL_OPTIONS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <select
            className="text-input"
            value={selectedThinking}
            onChange={(event) => setSelectedThinking(event.target.value as ThinkingMode)}
          >
            {THINKING_MODE_OPTIONS.map((mode) => (
              <option key={mode} value={mode}>
                {`Thinking: ${mode}`}
              </option>
            ))}
          </select>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="button" disabled={isSendingPrompt} type="submit">
            {isSendingPrompt ? "Streaming..." : "Send Prompt"}
          </button>
        </form>
      </section>

      <aside className="preview-column">
        <div className="run-meta">
          <h3>Global Console</h3>
          <p className="meta-line">Status: {devSession ? getDevSessionStatusLabel(devSession) : "not running"}</p>
          <div className="inline-grid">
            <button className="button" disabled={isStartingDevSession || hasActiveDevSession} onClick={startDevSession} type="button">
              {isStartingDevSession ? "Starting..." : "Start"}
            </button>
            <button
              className="button"
              disabled={!devSession || isRefreshingDevSession}
              onClick={() => refreshDevSession(true)}
              type="button"
            >
              {isRefreshingDevSession ? "Refreshing..." : "Refresh"}
            </button>
            <button
              className="button"
              disabled={!devSession || isCommittingDevSession}
              onClick={commitDevSessionChanges}
              type="button"
            >
              {isCommittingDevSession ? "Committing..." : "Commit Changes"}
            </button>
            <button
              className="button"
              disabled={!devSession || isStoppingDevSession || devSession.status === "stopped"}
              onClick={stopDevSession}
              type="button"
            >
              {isStoppingDevSession ? "Stopping..." : "Stop"}
            </button>
          </div>
          {devSessionFeedback ? <p className="meta-line">{devSessionFeedback}</p> : null}
          {devSessionError ? <p className="error-text">{devSessionError}</p> : null}
          {devSession?.error ? <p className="error-text">Runner: {devSession.error}</p> : null}
          <details className="log-details" open>
            <summary>Project activity logs</summary>
            <div className="log-console">{projectActivityLogs.length ? projectActivityLogs.join("\n") : "No project activity yet."}</div>
          </details>
          <div className="log-console">{devSession?.logs?.length ? devSession.logs.join("\n") : "No dev logs yet."}</div>
        </div>

        <div className="run-meta">
          <h3>Repository Code</h3>
          <p className="meta-line">Branch: {branchName}</p>
          <select
            className="text-input"
            value={selectedCodeFile}
            onChange={(event) => setSelectedCodeFile(event.target.value)}
            disabled={project.fileIndex.length === 0}
          >
            {project.fileIndex.length === 0 ? <option value="">No files available</option> : null}
            {project.fileIndex.map((filePath) => (
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

        <div className="preview-stage">
          <div className="preview-canvas">
            {expoQrUrl ? (
              <div className="expo-qr-wrap">
                <Image alt="Expo Go QR code" className="expo-qr" height={300} src={expoQrUrl} width={300} />
                <p className="meta-line">Scan with Expo Go</p>
              </div>
            ) : (
              <p className="meta-line">Start/refresh dev session until QR appears.</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
