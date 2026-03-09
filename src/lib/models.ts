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
  shopDomain: string;
  accessToken?: string;
  accessTokenEncrypted?: string;
  connectedAt: string;
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

export interface DevSessionState {
  id: string;
  status: DevSessionStatus;
  branch: string;
  workspacePath: string;
  repoPath: string;
  packageManager: string;
  installCommand: string;
  expoUrl?: string;
  webUrl?: string;
  proxiedWebUrl?: string;
  error?: string;
  logs: string[];
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
  files: Record<string, string>;
  messages: ChatMessage[];
  runs: AiRun[];
  devSession?: DevSessionState;
  opencodeSession?: OpencodeSessionState;
  store?: ShopifyConnection;
  github: GithubState;
}

export interface PublicStoreConnection {
  shopDomain: string;
  connectedAt: string;
  hasAccessToken: boolean;
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
  store?: PublicStoreConnection;
  github: GithubState;
  fileIndex: string[];
}
