import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SHOPIFY_AUTH_URL = "https://{shop}/admin/oauth/authorize";
const DEFAULT_SCOPES = "read_products,read_orders,write_checkouts";
const STATE_TTL_MS = 10 * 60 * 1000;

export interface ShopifyOAuthState {
  projectId: string;
  shopDomain: string;
  nonce: string;
  expiresAt: number;
}

function getShopifyStateSecret(): string {
  const secret = process.env.SHOPIFY_OAUTH_STATE_SECRET ?? process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error("Missing SHOPIFY_OAUTH_STATE_SECRET or SHOPIFY_API_SECRET.");
  }

  return secret;
}

function signStatePayload(payloadB64: string): string {
  return createHmac("sha256", getShopifyStateSecret()).update(payloadB64).digest("base64url");
}

export function normalizeShopDomain(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value)) {
    return null;
  }

  return value;
}

export function getAppBaseUrl(fallbackOrigin: string): string {
  return process.env.APP_BASE_URL ?? fallbackOrigin;
}

export function getShopifyScopes(): string {
  return process.env.SHOPIFY_OAUTH_SCOPES ?? DEFAULT_SCOPES;
}

export function createShopifyOAuthState(params: { projectId: string; shopDomain: string }): string {
  const payload: ShopifyOAuthState = {
    projectId: params.projectId,
    shopDomain: params.shopDomain,
    nonce: randomBytes(10).toString("base64url"),
    expiresAt: Date.now() + STATE_TTL_MS
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signStatePayload(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function verifyShopifyOAuthState(rawState: string): ShopifyOAuthState | null {
  const [payloadB64, signature] = rawState.split(".");
  if (!payloadB64 || !signature) {
    return null;
  }

  const expectedSignature = signStatePayload(payloadB64);
  const providedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as ShopifyOAuthState;
    if (!payload.projectId || !payload.shopDomain || !payload.nonce || typeof payload.expiresAt !== "number") {
      return null;
    }

    if (payload.expiresAt < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function buildShopifyAuthorizeUrl(params: {
  shopDomain: string;
  apiKey: string;
  redirectUri: string;
  state: string;
}): string {
  return (
    SHOPIFY_AUTH_URL.replace("{shop}", params.shopDomain) +
    `?client_id=${encodeURIComponent(params.apiKey)}` +
    `&scope=${encodeURIComponent(getShopifyScopes())}` +
    `&redirect_uri=${encodeURIComponent(params.redirectUri)}` +
    `&state=${encodeURIComponent(params.state)}`
  );
}

function createCallbackHmacMessage(searchParams: URLSearchParams): string {
  const sortedEntries = [...searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b));

  const canonicalParams = new URLSearchParams();
  for (const [key, value] of sortedEntries) {
    canonicalParams.append(key, value);
  }

  return canonicalParams.toString();
}

export function verifyShopifyCallbackHmac(searchParams: URLSearchParams): boolean {
  const receivedHmac = searchParams.get("hmac");
  const apiSecret = process.env.SHOPIFY_API_SECRET;

  if (!receivedHmac || !apiSecret) {
    return false;
  }

  const message = createCallbackHmacMessage(searchParams);
  const expectedHmac = createHmac("sha256", apiSecret).update(message).digest("hex");
  const receivedBuffer = Buffer.from(receivedHmac, "utf8");
  const expectedBuffer = Buffer.from(expectedHmac, "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function exchangeShopifyAccessToken(params: {
  shopDomain: string;
  code: string;
}): Promise<{ accessToken: string; scope?: string }> {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET.");
  }

  const response = await fetch(`https://${params.shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      code: params.code
    })
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        scope?: string;
        error_description?: string;
      }
    | null;

  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description ?? "Failed to exchange Shopify OAuth code for token.");
  }

  return {
    accessToken: payload.access_token,
    scope: payload.scope
  };
}
