export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  runId?: string;
}

export interface PreviewScreen {
  id: string;
  title: string;
  description: string;
  blocks: string[];
}

export interface PreviewModel {
  appName: string;
  theme: "light" | "dark";
  primaryColor: string;
  screens: PreviewScreen[];
}

export interface ShopifyConnection {
  shopDomain?: string;
  connectedAt: string;
  customerAuth?: ShopifyCustomerAuthState;
}

export type ShopifyCustomerAuthMethod = "shopify_hosted" | "customer_account_api";

export type ShopifyHostedAccountType = "new" | "legacy" | "disabled" | "unknown";

export type ShopifyCustomerAuthSessionStatus =
  | "pending"
  | "completed"
  | "failed"
  | "expired"
  | "consumed";

export interface ShopifyCustomerAuthSession {
  id: string;
  status: ShopifyCustomerAuthSessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  codeVerifier?: string;
  tokenPayloadEncrypted?: string;
  error?: string;
}

export interface ShopifyHostedAuthDetails {
  accountsEnabled: boolean;
  accountType: ShopifyHostedAccountType;
  loginUrl: string;
  accountUrl: string;
}

export interface ShopifyCustomerAccountApiConfig {
  enabled: boolean;
  clientId?: string;
  scopes: string[];
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  revocationEndpoint?: string;
  endSessionEndpoint?: string;
  callbackUrl?: string;
}

export interface ShopifyCustomerAuthState {
  detectedAt: string;
  activeMethod: ShopifyCustomerAuthMethod;
  recommendedMethod: ShopifyCustomerAuthMethod;
  supportedMethods: ShopifyCustomerAuthMethod[];
  hosted: ShopifyHostedAuthDetails;
  customerAccountApi: ShopifyCustomerAccountApiConfig;
  sessions?: ShopifyCustomerAuthSession[];
}

export interface GithubState {
  enabled: boolean;
  owner?: string;
  repo?: string;
  repoUrl?: string;
  defaultBranch?: string;
  lastCommitSha?: string;
  lastCommitMessage?: string;
  lastSyncedAt?: string;
  error?: string;
}

export interface AiRun {
  id: string;
  prompt: string;
  summary: string;
  changedFiles: string[];
  status: "completed" | "completed_with_warnings";
  commitMessage: string;
  createdAt: string;
}

export type DevSessionStatus = "starting" | "ready" | "failed" | "stopped";

export interface WorkspaceLayout {
  mobileAppDir: string;
  expoBackendDir: string;
  expoBackendPort: number;
  expoBackendStartCommand: string;
  backendDir?: string;
  backendPort?: number;
  backendStartCommand?: string;
}

export interface DevSessionState {
  id: string;
  status: DevSessionStatus;
  expoBackendStatus?: DevSessionStatus;
  backendStatus?: DevSessionStatus;
  branch: string;
  workspacePath: string;
  repoPath: string;
  packageManager: string;
  installCommand: string;
  expoUrl?: string;
  webUrl?: string;
  proxiedWebUrl?: string;
  expoBackendUrl?: string;
  backendUrl?: string;
  expoBackendPort?: number;
  backendPort?: number;
  error?: string;
  logs: string[];
  expoBackendLogs?: string[];
  backendLogs?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OpencodeSessionState {
  sessionId: string;
  workspacePath: string;
  repoPath: string;
  agent: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  expoSdk?: string;
  preview: PreviewModel;
  fileIndex: string[];
  messages: ChatMessage[];
  runs: AiRun[];
  devSession?: DevSessionState;
  opencodeSession?: OpencodeSessionState;
  workspaceLayout?: WorkspaceLayout;
  store?: ShopifyConnection;
  github: GithubState;
}

export interface PublicStoreConnection {
  shopDomain?: string;
  connectedAt: string;
  hasAccessToken: boolean;
  customerAuth?: PublicShopifyCustomerAuthState;
}

export interface PublicShopifyCustomerAccountApiConfig {
  enabled: boolean;
  hasClientId: boolean;
  scopes: string[];
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
}

export interface PublicShopifyCustomerAuthState {
  detectedAt: string;
  activeMethod: ShopifyCustomerAuthMethod;
  recommendedMethod: ShopifyCustomerAuthMethod;
  supportedMethods: ShopifyCustomerAuthMethod[];
  hosted: ShopifyHostedAuthDetails;
  customerAccountApi: PublicShopifyCustomerAccountApiConfig;
}

export interface PublicProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  expoSdk?: string;
  preview: PreviewModel;
  messages: ChatMessage[];
  runs: AiRun[];
  devSession?: DevSessionState;
  opencodeSession?: OpencodeSessionState;
  workspaceLayout?: WorkspaceLayout;
  store?: PublicStoreConnection;
  github: GithubState;
  fileIndex: string[];
}
