interface ExpoScaffoldResult {
  sdk?: string;
  files: Record<string, string>;
  warnings: string[];
}

interface ScaffoldPayload {
  sdk?: string;
  files?: Record<string, string>;
  warnings?: string[];
  error?: string;
}

function getScaffoldServerBaseUrl(): string | undefined {
  return (
    process.env.EXPO_SCAFFOLD_SERVER_BASE_URL?.trim() ||
    process.env.RUNNER_SERVER_BASE_URL?.trim() ||
    process.env.AI_SERVER_BASE_URL?.trim() ||
    undefined
  );
}

export async function createExpoScaffoldFiles(projectName: string, sdk: string): Promise<ExpoScaffoldResult> {
  const baseUrl = getScaffoldServerBaseUrl();
  if (!baseUrl) {
    return {
      files: {},
      warnings: ["Scaffold server URL not configured. Falling back to generated source files only."]
    };
  }

  const requestTimeoutMs = Number(process.env.EXPO_SCAFFOLD_TIMEOUT_MS ?? "240000");
  const timeoutMs = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 240000;

  const headers: HeadersInit = {
    "Content-Type": "application/json"
  };

  const token =
    (process.env.EXPO_SCAFFOLD_SERVER_TOKEN ?? process.env.RUNNER_SERVER_TOKEN ?? process.env.AI_SERVER_TOKEN)?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;

  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/shopify-mobile/scaffold-expo`, {
      method: "POST",
      headers,
      body: JSON.stringify({ projectName, sdk }),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        files: {},
        warnings: [`Scaffold generation timed out after ${Math.round(timeoutMs / 1000)}s.`]
      };
    }

    return {
      files: {},
      warnings: [error instanceof Error ? error.message : "Unknown scaffold generation error"]
    };
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => null)) as ScaffoldPayload | null;
  if (!response.ok || !payload?.files) {
    return {
      files: {},
      warnings: [payload?.error ?? "Failed to create Expo scaffold from external Node server."]
    };
  }

  return {
    sdk: typeof payload.sdk === "string" ? payload.sdk : undefined,
    files: payload.files,
    warnings: Array.isArray(payload.warnings) ? payload.warnings : []
  };
}
