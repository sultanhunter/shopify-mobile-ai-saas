import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RunnerSdkEntry {
  sdk?: unknown;
  status?: unknown;
}

interface RunnerSdkResponse {
  defaultSdk?: unknown;
  supported?: unknown;
}

function getScaffoldServerBaseUrl(): string {
  const baseUrl =
    process.env.EXPO_SCAFFOLD_SERVER_BASE_URL?.trim() ||
    process.env.RUNNER_SERVER_BASE_URL?.trim() ||
    process.env.AI_SERVER_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("Scaffold server URL is missing.");
  }

  return baseUrl.replace(/\/$/, "");
}

function buildHeaders(): HeadersInit {
  const headers: HeadersInit = {};
  const token =
    (process.env.EXPO_SCAFFOLD_SERVER_TOKEN ?? process.env.RUNNER_SERVER_TOKEN ?? process.env.AI_SERVER_TOKEN)?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function normalizePayload(payload: RunnerSdkResponse | null): {
  defaultSdk: string;
  supported: Array<{ sdk: string; status: "active" | "maintenance" }>;
} {
  const fallback = {
    defaultSdk: "55",
    supported: [{ sdk: "55", status: "active" as const }]
  };

  if (!payload) {
    return fallback;
  }

  const defaultSdk = typeof payload.defaultSdk === "string" && payload.defaultSdk.trim() ? payload.defaultSdk.trim() : "55";
  const supported = Array.isArray(payload.supported)
    ? payload.supported
        .map((entry) => {
          const raw = entry as RunnerSdkEntry;
          const sdk = typeof raw.sdk === "string" ? raw.sdk.trim() : "";
          const status = raw.status === "maintenance" ? "maintenance" : "active";
          if (!sdk) return null;
          return { sdk, status };
        })
        .filter((entry): entry is { sdk: string; status: "active" | "maintenance" } => Boolean(entry))
    : [];

  return {
    defaultSdk,
    supported: supported.length > 0 ? supported : fallback.supported
  };
}

export async function GET() {
  try {
    const response = await fetch(`${getScaffoldServerBaseUrl()}/api/shopify-mobile/scaffold-expo/versions`, {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store"
    });

    const payload = (await response.json().catch(() => null)) as RunnerSdkResponse | null;
    if (!response.ok) {
      return NextResponse.json(normalizePayload(null));
    }

    return NextResponse.json(normalizePayload(payload));
  } catch {
    return NextResponse.json(normalizePayload(null));
  }
}
