import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ShopifyCustomerAuthMethod,
  ShopifyCustomerAuthSession,
  ShopifyCustomerAuthState,
  ShopifyHostedAccountType,
} from "@/lib/models";

const SHOPIFY_ADMIN_API_VERSION = "2024-10";
const CUSTOMER_AUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface ShopifyShopResponse {
  shop?: {
    customer_accounts_enabled?: boolean;
  };
}

interface OpenIdConfiguration {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
}

interface CustomerAuthStatePayload {
  projectId: string;
  shopDomain: string;
  sessionId: string;
  nonce: string;
  expiresAt: number;
}

interface ShopifyCustomerTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface ShopifyCustomerTokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string;
}

function getShopifyStateSecret(): string {
  const secret = process.env.SHOPIFY_OAUTH_STATE_SECRET ?? process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error("Missing SHOPIFY_OAUTH_STATE_SECRET or SHOPIFY_API_SECRET.");
  }

  return secret;
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", getShopifyStateSecret()).update(payloadB64).digest("base64url");
}

function getAppBaseUrl(fallbackOrigin: string): string {
  return process.env.NEXTJS_APP_BASE_URL?.trim() || process.env.APP_BASE_URL?.trim() || fallbackOrigin;
}

function getCustomerApiClientId(): string | undefined {
  const clientId =
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID?.trim() || process.env.SHOPIFY_API_KEY?.trim() || undefined;

  return clientId || undefined;
}

export function getCustomerApiScopes(): string[] {
  const raw = process.env.SHOPIFY_CUSTOMER_ACCOUNT_SCOPES?.trim() || "openid,email,profile";

  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

export function getCustomerAuthCallbackUrl(fallbackOrigin: string): string {
  const configured = process.env.SHOPIFY_CUSTOMER_AUTH_CALLBACK_URL?.trim();
  if (configured) {
    return configured;
  }

  return `${getAppBaseUrl(fallbackOrigin).replace(/\/$/, "")}/api/shopify/customer-auth/callback`;
}

function normalizeMethod(raw: string | undefined): ShopifyCustomerAuthMethod | undefined {
  if (raw === "shopify_hosted" || raw === "customer_account_api") {
    return raw;
  }

  return undefined;
}

async function fetchAccountsEnabled(shopDomain: string, accessToken: string): Promise<boolean | undefined> {
  const response = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/shop.json?fields=customer_accounts_enabled`,
    {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json().catch(() => null)) as ShopifyShopResponse | null;
  if (typeof payload?.shop?.customer_accounts_enabled !== "boolean") {
    return undefined;
  }

  return payload.shop.customer_accounts_enabled;
}

async function probeHostedAccountType(shopDomain: string, accountsEnabled: boolean): Promise<ShopifyHostedAccountType> {
  if (!accountsEnabled) {
    return "disabled";
  }

  try {
    const response = await fetch(`https://${shopDomain}/account/login`, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
    });

    const redirectLocation = response.headers.get("location")?.toLowerCase() ?? "";
    if (redirectLocation.includes("shopify.com") || redirectLocation.includes("/challenge")) {
      return "new";
    }

    const body = (await response.text().catch(() => "")).toLowerCase();
    if (body.includes("customer[password]") || body.includes("/account/login")) {
      return "legacy";
    }

    if (body.includes("shopify") && body.includes("customer account")) {
      return "new";
    }
  } catch {
    return "unknown";
  }

  return "unknown";
}

async function discoverOpenIdConfiguration(shopDomain: string): Promise<OpenIdConfiguration | undefined> {
  const paths = [
    "/.well-known/openid-configuration",
    "/account/.well-known/openid-configuration",
    "/customer-auth/.well-known/openid-configuration",
  ];

  for (const path of paths) {
    const url = `https://${shopDomain}${path}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json().catch(() => null)) as OpenIdConfiguration | null;
      if (!payload?.authorization_endpoint || !payload?.token_endpoint) {
        continue;
      }

      return payload;
    } catch {
      continue;
    }
  }

  return undefined;
}

function pruneSessions(sessions: ShopifyCustomerAuthSession[] | undefined): ShopifyCustomerAuthSession[] | undefined {
  if (!sessions || sessions.length === 0) {
    return undefined;
  }

  const now = Date.now();
  const pruned = sessions
    .filter((session) => {
      if (["consumed", "expired"].includes(session.status)) {
        return false;
      }

      const expiresAtMs = Date.parse(session.expiresAt);
      if (Number.isFinite(expiresAtMs) && expiresAtMs < now && session.status === "pending") {
        return false;
      }

      return true;
    })
    .slice(-20);

  return pruned.length > 0 ? pruned : undefined;
}

export async function detectCustomerAuthState(params: {
  shopDomain: string;
  accessToken?: string;
  fallbackOrigin: string;
  current?: ShopifyCustomerAuthState;
}): Promise<ShopifyCustomerAuthState> {
  const current = params.current;

  let accountsEnabled = current?.hosted.accountsEnabled ?? true;
  if (params.accessToken) {
    const detected = await fetchAccountsEnabled(params.shopDomain, params.accessToken);
    if (typeof detected === "boolean") {
      accountsEnabled = detected;
    }
  }

  const hostedType = await probeHostedAccountType(params.shopDomain, accountsEnabled);
  const openIdConfig = await discoverOpenIdConfiguration(params.shopDomain);
  const clientId = getCustomerApiClientId() || current?.customerAccountApi.clientId;
  const scopes = getCustomerApiScopes();
  const customerApiEnabled = Boolean(
    accountsEnabled && openIdConfig?.authorization_endpoint && openIdConfig?.token_endpoint && clientId
  );

  const supportedMethods: ShopifyCustomerAuthMethod[] = [];
  if (accountsEnabled) {
    supportedMethods.push("shopify_hosted");
  }
  if (customerApiEnabled) {
    supportedMethods.push("customer_account_api");
  }

  if (supportedMethods.length === 0) {
    supportedMethods.push("shopify_hosted");
  }

  const recommendedMethod: ShopifyCustomerAuthMethod = customerApiEnabled
    ? "customer_account_api"
    : "shopify_hosted";
  const persistedActiveMethod = normalizeMethod(current?.activeMethod);
  const activeMethod =
    persistedActiveMethod && supportedMethods.includes(persistedActiveMethod)
      ? persistedActiveMethod
      : recommendedMethod;

  return {
    detectedAt: new Date().toISOString(),
    activeMethod,
    recommendedMethod,
    supportedMethods,
    hosted: {
      accountsEnabled,
      accountType: hostedType,
      loginUrl: `https://${params.shopDomain}/account/login`,
      accountUrl: `https://${params.shopDomain}/account`,
    },
    customerAccountApi: {
      enabled: customerApiEnabled,
      clientId,
      scopes,
      issuer: openIdConfig?.issuer,
      authorizationEndpoint: openIdConfig?.authorization_endpoint,
      tokenEndpoint: openIdConfig?.token_endpoint,
      revocationEndpoint: openIdConfig?.revocation_endpoint,
      endSessionEndpoint: openIdConfig?.end_session_endpoint,
      callbackUrl: getCustomerAuthCallbackUrl(params.fallbackOrigin),
    },
    sessions: pruneSessions(current?.sessions),
  };
}

export function createCustomerAuthState(params: {
  projectId: string;
  shopDomain: string;
  sessionId: string;
  expiresAtMs?: number;
}): string {
  const payload: CustomerAuthStatePayload = {
    projectId: params.projectId,
    shopDomain: params.shopDomain,
    sessionId: params.sessionId,
    nonce: randomBytes(10).toString("base64url"),
    expiresAt: params.expiresAtMs ?? Date.now() + CUSTOMER_AUTH_STATE_TTL_MS,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signPayload(payloadB64);

  return `${payloadB64}.${signature}`;
}

export function verifyCustomerAuthState(rawState: string): CustomerAuthStatePayload | null {
  const [payloadB64, signature] = rawState.split(".");
  if (!payloadB64 || !signature) {
    return null;
  }

  const expectedSignature = signPayload(payloadB64);
  const providedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as CustomerAuthStatePayload;
    if (
      !payload.projectId ||
      !payload.shopDomain ||
      !payload.sessionId ||
      !payload.nonce ||
      typeof payload.expiresAt !== "number"
    ) {
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

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  return {
    codeVerifier,
    codeChallenge,
  };
}

export function buildCustomerAuthorizeUrl(params: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("scope", params.scopes.join(" "));
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

function normalizeTokenSet(payload: ShopifyCustomerTokenResponse): ShopifyCustomerTokenSet {
  if (!payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "Customer auth token response missing access_token");
  }

  let expiresAt: string | undefined;
  if (typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) && payload.expires_in > 0) {
    expiresAt = new Date(Date.now() + payload.expires_in * 1000).toISOString();
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    idToken: payload.id_token,
    tokenType: payload.token_type,
    scope: payload.scope,
    expiresAt,
  };
}

async function postTokenRequest(
  tokenEndpoint: string,
  body: URLSearchParams
): Promise<ShopifyCustomerTokenSet> {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const payload = (await response.json().catch(() => null)) as ShopifyCustomerTokenResponse | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error_description ?? payload?.error ?? "Failed customer auth token request");
  }

  return normalizeTokenSet(payload);
}

export async function exchangeCustomerAuthCode(params: {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<ShopifyCustomerTokenSet> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", params.clientId);
  body.set("code", params.code);
  body.set("redirect_uri", params.redirectUri);
  body.set("code_verifier", params.codeVerifier);

  return postTokenRequest(params.tokenEndpoint, body);
}

export async function refreshCustomerAuthToken(params: {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
}): Promise<ShopifyCustomerTokenSet> {
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("client_id", params.clientId);
  body.set("refresh_token", params.refreshToken);

  return postTokenRequest(params.tokenEndpoint, body);
}
