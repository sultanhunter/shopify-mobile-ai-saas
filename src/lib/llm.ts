import { AiOutput, applyRuleBasedPromptToProject } from "@/lib/ai-engine";
import { OpencodeSessionState, PreviewModel, PreviewScreen, Project } from "@/lib/models";

type LlmProvider = "opencode-server" | "vertex-server" | "gemini" | "rule-based";

interface LlmProjectUpdateInput {
  project: Project;
  prompt: string;
  model?: string;
  thinking?: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

function getLlmProvider(): LlmProvider {
  const value = (process.env.LLM_PROVIDER ?? "opencode-server").trim().toLowerCase();

  if (value === "opencode-server" || value === "opencode" || value === "opencode-runner") {
    return "opencode-server";
  }

  if (value === "vertex-server" || value === "ai-server") {
    return "vertex-server";
  }

  if (value === "gemini") {
    return "gemini";
  }

  if (value === "rule-based" || value === "rules") {
    return "rule-based";
  }

  throw new Error(
    `Unsupported LLM_PROVIDER \"${value}\". Use \"opencode-server\", \"vertex-server\", \"gemini\", or \"rule-based\".`
  );
}

function normalizePrimaryColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}

function normalizeScreen(screen: unknown, index: number): PreviewScreen {
  if (!screen || typeof screen !== "object") {
    return {
      id: `screen-${index + 1}`,
      title: `Screen ${index + 1}`,
      description: "",
      blocks: []
    };
  }

  const raw = screen as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `screen-${index + 1}`;
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : id;
  const description = typeof raw.description === "string" ? raw.description.trim() : "";

  const blocks = Array.isArray(raw.blocks)
    ? raw.blocks
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  return {
    id,
    title,
    description,
    blocks: [...new Set(blocks)]
  };
}

function normalizePreview(value: unknown, fallback: PreviewModel): PreviewModel {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const raw = value as Record<string, unknown>;
  const appName = typeof raw.appName === "string" && raw.appName.trim() ? raw.appName.trim() : fallback.appName;
  const theme = raw.theme === "light" || raw.theme === "dark" ? raw.theme : fallback.theme;

  const normalizedScreens = Array.isArray(raw.screens)
    ? raw.screens.map((screen, index) => normalizeScreen(screen, index))
    : fallback.screens;

  const dedupedScreens = normalizedScreens.filter(
    (screen, index, all) => all.findIndex((candidate) => candidate.id === screen.id) === index
  );

  return {
    appName,
    theme,
    primaryColor: normalizePrimaryColor(raw.primaryColor, fallback.primaryColor),
    screens: dedupedScreens.length > 0 ? dedupedScreens : fallback.screens
  };
}

function extractJsonObject(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Gemini returned an empty response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1]);
    }

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("Gemini did not return a valid JSON object.");
    }

    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }
}

function buildGeminiPrompt(project: Project, prompt: string): string {
  return [
    "You are editing an Expo Shopify mobile app preview model.",
    "Return STRICT JSON only, with this exact shape:",
    "{\"summary\":\"string\",\"preview\":{\"appName\":\"string\",\"theme\":\"light|dark\",\"primaryColor\":\"#RRGGBB\",\"screens\":[{\"id\":\"string\",\"title\":\"string\",\"description\":\"string\",\"blocks\":[\"string\"]}]}}",
    "Rules:",
    "- Keep existing structure unless user asks to change it.",
    "- Avoid deleting useful screens unless explicitly requested.",
    "- summary must be one sentence describing what changed.",
    "Current preview JSON:",
    JSON.stringify(project.preview),
    "User prompt:",
    prompt
  ].join("\n");
}

interface VertexServerResponse {
  result?: {
    summary?: unknown;
    preview?: unknown;
  };
  error?: string;
}

interface OpenCodeServerResponse {
  result?: {
    summary?: unknown;
    sessionId?: unknown;
    workspacePath?: unknown;
    repoPath?: unknown;
    agent?: unknown;
    files?: unknown;
    changedFiles?: unknown;
  };
  error?: string;
}

interface OpenCodeStreamEnvelope {
  type?: unknown;
  event?: Record<string, unknown>;
  result?: OpenCodeServerResponse["result"];
  error?: unknown;
}

export interface OpenCodeUiEvent {
  kind: "text" | "tool" | "status";
  text: string;
}

function getAiServerBaseUrl(): string {
  const baseUrl = process.env.RUNNER_SERVER_BASE_URL?.trim() || process.env.AI_SERVER_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("RUNNER_SERVER_BASE_URL is missing.");
  }

  return baseUrl.replace(/\/$/, "");
}

function buildAiServerHeaders(): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json"
  };

  const token = process.env.RUNNER_SERVER_TOKEN?.trim() || process.env.AI_SERVER_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function getAiServerTimeoutMs(): number {
  const requestTimeoutMs = Number(process.env.RUNNER_SERVER_TIMEOUT_MS ?? process.env.AI_SERVER_TIMEOUT_MS ?? "600000");
  return Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 600000;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") {
      output[key] = raw;
    }
  }

  return output;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

async function generateWithOpenCodeServer(input: LlmProjectUpdateInput): Promise<AiOutput> {
  if (!input.project.github.enabled || !input.project.github.repoUrl) {
    throw new Error("GitHub repository is required before using OpenCode prompt sessions.");
  }

  const response = await fetch(`${getAiServerBaseUrl()}/api/shopify-mobile/opencode/prompt`, {
    method: "POST",
    headers: buildAiServerHeaders(),
      body: JSON.stringify({
        projectId: input.project.id,
        repoUrl: input.project.github.repoUrl,
        branch: "main",
        prompt: input.prompt,
        model: input.model,
        thinking: input.thinking
    })
  });

  const payload = (await response.json().catch(() => null)) as OpenCodeServerResponse | null;
  if (!response.ok || !payload?.result) {
    throw new Error(payload?.error ?? "OpenCode prompt execution failed.");
  }

  const summary =
    typeof payload.result.summary === "string" && payload.result.summary.trim()
      ? payload.result.summary.trim()
      : "Applied updates using the Shopify App Builder agent.";

  const opencodeSession: OpencodeSessionState | undefined =
    typeof payload.result.sessionId === "string" &&
    typeof payload.result.workspacePath === "string" &&
    typeof payload.result.repoPath === "string" &&
    typeof payload.result.agent === "string"
      ? {
          sessionId: payload.result.sessionId,
          workspacePath: payload.result.workspacePath,
          repoPath: payload.result.repoPath,
          agent: payload.result.agent,
          updatedAt: new Date().toISOString()
        }
      : undefined;

  return {
    preview: input.project.preview,
    summary,
    files: asStringRecord(payload.result.files),
    changedFiles: asStringArray(payload.result.changedFiles),
    opencodeSession
  };
}

export async function streamOpenCodeProjectUpdate(
  project: Project,
  prompt: string,
  options: { model?: string; thinking?: string } | undefined,
  onEvent: (event: OpenCodeUiEvent) => void
): Promise<AiOutput> {
  if (!project.github.enabled || !project.github.repoUrl) {
    throw new Error("GitHub repository is required before using OpenCode prompt sessions.");
  }

  const response = await fetch(`${getAiServerBaseUrl()}/api/shopify-mobile/opencode/prompt/stream`, {
    method: "POST",
    headers: buildAiServerHeaders(),
    body: JSON.stringify({
      projectId: project.id,
      repoUrl: project.github.repoUrl,
      branch: "main",
      prompt,
      model: options?.model,
      thinking: options?.thinking
    })
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Failed to open OpenCode stream.");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let finalResult: OpenCodeServerResponse["result"] | undefined;

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

      let parsed: OpenCodeStreamEnvelope;
      try {
        parsed = JSON.parse(line) as OpenCodeStreamEnvelope;
      } catch {
        continue;
      }

      if (parsed.type === "error") {
        throw new Error(typeof parsed.error === "string" ? parsed.error : "OpenCode stream failed.");
      }

      if (parsed.type === "result" && parsed.result) {
        finalResult = parsed.result;
        continue;
      }

      if (parsed.type === "event" && parsed.event) {
        const eventType = typeof parsed.event.type === "string" ? parsed.event.type : "event";
        if (eventType === "text") {
          const maybeText = parsed.event.part && typeof parsed.event.part === "object"
            ? (parsed.event.part as { text?: unknown }).text
            : undefined;
          if (typeof maybeText === "string" && maybeText.trim()) {
            onEvent({ kind: "text", text: maybeText.trim() });
          }
          continue;
        }

        if (eventType === "tool_use") {
          const part = parsed.event.part as { tool?: unknown; state?: unknown } | undefined;
          const toolName = typeof part?.tool === "string" ? part.tool : "tool";
          onEvent({ kind: "tool", text: `${toolName} completed` });
          continue;
        }

        if (eventType === "step_start") {
          onEvent({ kind: "status", text: "Agent step started" });
        }
      }
    }
  }

  if (!finalResult) {
    throw new Error("OpenCode stream ended without a final result.");
  }

  const summary =
    typeof finalResult.summary === "string" && finalResult.summary.trim()
      ? finalResult.summary.trim()
      : "Applied updates using the Shopify App Builder agent.";

  const opencodeSession: OpencodeSessionState | undefined =
    typeof finalResult.sessionId === "string" &&
    typeof finalResult.workspacePath === "string" &&
    typeof finalResult.repoPath === "string" &&
    typeof finalResult.agent === "string"
      ? {
          sessionId: finalResult.sessionId,
          workspacePath: finalResult.workspacePath,
          repoPath: finalResult.repoPath,
          agent: finalResult.agent,
          updatedAt: new Date().toISOString()
        }
      : undefined;

  return {
    preview: project.preview,
    summary,
    files: asStringRecord(finalResult.files),
    changedFiles: asStringArray(finalResult.changedFiles),
    opencodeSession
  };
}

async function generateWithVertexServer(input: LlmProjectUpdateInput): Promise<AiOutput> {
  const timeoutMs = getAiServerTimeoutMs();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;

  try {
    response = await fetch(`${getAiServerBaseUrl()}/api/shopify-mobile/generate-preview`, {
      method: "POST",
      headers: buildAiServerHeaders(),
      body: JSON.stringify({
        projectId: input.project.id,
        prompt: input.prompt,
        model: input.model,
        preview: input.project.preview
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Runner server timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => null)) as VertexServerResponse | null;
  if (!response.ok || !payload?.result) {
    throw new Error(payload?.error ?? "Runner server generation failed.");
  }

  const preview = normalizePreview(payload.result.preview, input.project.preview);
  const summary =
    typeof payload.result.summary === "string" && payload.result.summary.trim()
      ? payload.result.summary.trim()
      : "Updated the app structure and preview model based on your request.";

  return {
    preview,
    summary
  };
}

async function generateWithGemini(input: LlmProjectUpdateInput): Promise<AiOutput> {
  const apiKey = process.env.VERTEX_API_KEY ?? process.env.GEMINI_API_KEY;
  const model = input.model ?? process.env.LLM_MODEL ?? "gemini-2.5-flash";

  if (!apiKey) {
    throw new Error("VERTEX_API_KEY (or GEMINI_API_KEY) is missing.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildGeminiPrompt(input.project, input.prompt)
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    }
  );

  const payload = (await response.json().catch(() => null)) as GeminiResponse | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Gemini request failed.");
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
  const parsed = extractJsonObject(text) as Record<string, unknown>;

  const preview = normalizePreview(parsed.preview, input.project.preview);
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "Updated the app structure and preview model based on your request.";

  return {
    preview,
    summary
  };
}

export async function generateProjectUpdate(
  project: Project,
  prompt: string,
  options?: { model?: string; thinking?: string }
): Promise<AiOutput> {
  const provider = getLlmProvider();
  const input: LlmProjectUpdateInput = {
    project,
    prompt,
    model: options?.model?.trim() || undefined,
    thinking: options?.thinking?.trim() || undefined
  };

  if (provider === "rule-based") {
    return applyRuleBasedPromptToProject(project, prompt);
  }

  if (provider === "opencode-server") {
    return generateWithOpenCodeServer(input);
  }

  if (provider === "vertex-server") {
    return generateWithVertexServer(input);
  }

  return generateWithGemini(input);
}
