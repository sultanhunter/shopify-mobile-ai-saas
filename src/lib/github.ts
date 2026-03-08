import { GithubState } from "@/lib/models";

const GITHUB_API_BASE = "https://api.github.com";
const BINARY_BASE64_PREFIX = "__binary_base64__:";

interface GithubRepositoryInfo {
  owner: string;
  repo: string;
  repoUrl: string;
  defaultBranch: string;
}

interface CommitResult {
  lastCommitSha?: string;
  warnings: string[];
}

function getGithubConfig() {
  return {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER
  };
}

export function isGithubConfigured(): boolean {
  const config = getGithubConfig();
  return Boolean(config.token);
}

async function githubRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const config = getGithubConfig();

  if (!config.token) {
    return { ok: false, status: 400, error: "GITHUB_TOKEN is missing" };
  }

  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {})
    }
  });

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const maybeMessage =
      typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as { message: string }).message)
        : `GitHub API request failed (${response.status})`;

    return { ok: false, status: response.status, error: maybeMessage };
  }

  return { ok: true, status: response.status, data: parsed as T };
}

function sanitizeRepoName(input: string): string {
  const slug = input.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/(^-|-$)/g, "");
  return slug.length > 0 ? slug : "shopify-mobile-app";
}

async function resolveAuthenticatedOwner(): Promise<string | undefined> {
  const result = await githubRequest<{ login: string }>("/user");
  if (!result.ok || !result.data?.login) {
    return undefined;
  }

  return result.data.login;
}

export async function ensureProjectRepository(
  projectName: string,
  projectId: string
): Promise<{ github: GithubState; warnings: string[] }> {
  const warnings: string[] = [];

  if (!isGithubConfigured()) {
    return {
      github: {
        enabled: false,
        error: "GitHub sync disabled because GITHUB_TOKEN is not configured."
      },
      warnings
    };
  }

  const repoName = `${sanitizeRepoName(projectName)}-${projectId.slice(0, 6)}`;
  const config = getGithubConfig();

  let created:
    | {
        full_name: string;
        html_url: string;
        default_branch: string;
        name: string;
        owner: { login: string };
      }
    | undefined;

  if (config.owner) {
    const orgCreate = await githubRequest<{
      full_name: string;
      html_url: string;
      default_branch: string;
      name: string;
      owner: { login: string };
    }>(`/orgs/${config.owner}/repos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: repoName,
        private: true,
        description: "Auto-generated Expo app from Shopify mobile AI builder"
      })
    });

    if (orgCreate.ok && orgCreate.data) {
      created = orgCreate.data;
    } else if (orgCreate.status === 422) {
      warnings.push("Repository already existed; using existing repository.");
    } else {
      warnings.push(orgCreate.error ?? "Could not create org repository.");
    }
  }

  if (!created) {
    const userCreate = await githubRequest<{
      full_name: string;
      html_url: string;
      default_branch: string;
      name: string;
      owner: { login: string };
    }>("/user/repos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: repoName,
        private: true,
        description: "Auto-generated Expo app from Shopify mobile AI builder"
      })
    });

    if (userCreate.ok && userCreate.data) {
      created = userCreate.data;
    } else if (userCreate.status === 422) {
      warnings.push("Repository already existed; attempting to load it.");
    } else {
      return {
        github: {
          enabled: false,
          error: userCreate.error ?? "Could not create repository."
        },
        warnings
      };
    }
  }

  if (!created) {
    const owner = config.owner ?? (await resolveAuthenticatedOwner());
    if (!owner) {
      return {
        github: {
          enabled: false,
          error: "Repository exists but owner is unknown. Set GITHUB_OWNER."
        },
        warnings
      };
    }

    const existing = await githubRequest<{
      full_name: string;
      html_url: string;
      default_branch: string;
      name: string;
      owner: { login: string };
    }>(`/repos/${owner}/${repoName}`);

    if (!existing.ok || !existing.data) {
      return {
        github: {
          enabled: false,
          error: existing.error ?? "Repository exists but could not be loaded."
        },
        warnings
      };
    }

    created = existing.data;
  }

  return {
    github: {
      enabled: true,
      owner: created.owner.login,
      repo: created.name,
      repoUrl: created.html_url,
      defaultBranch: created.default_branch
    },
    warnings
  };
}

async function getContentSha(
  owner: string,
  repo: string,
  filePath: string,
  branch?: string
): Promise<string | undefined> {
  const branchQuery = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const response = await githubRequest<{ sha: string }>(
    `/repos/${owner}/${repo}/contents/${filePath}${branchQuery}`
  );

  if (!response.ok) {
    return undefined;
  }

  return response.data?.sha;
}

async function upsertFile(params: {
  owner: string;
  repo: string;
  path: string;
  content: string;
  branch?: string;
  commitMessage: string;
}): Promise<{ commitSha?: string; error?: string }> {
  const encodedPath = params.path
    .split("/")
    .map((chunk) => encodeURIComponent(chunk))
    .join("/");

  const existingSha = await getContentSha(params.owner, params.repo, encodedPath, params.branch);

  const encodedContent = params.content.startsWith(BINARY_BASE64_PREFIX)
    ? params.content.slice(BINARY_BASE64_PREFIX.length)
    : Buffer.from(params.content, "utf8").toString("base64");

  const response = await githubRequest<{
    commit: { sha: string };
  }>(`/repos/${params.owner}/${params.repo}/contents/${encodedPath}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: params.commitMessage,
      content: encodedContent,
      branch: params.branch,
      sha: existingSha
    })
  });

  if (!response.ok) {
    return { error: response.error ?? `Failed to update ${params.path}` };
  }

  return { commitSha: response.data?.commit.sha };
}

export async function commitFiles(params: {
  repository: GithubRepositoryInfo;
  files: Record<string, string>;
  commitMessage: string;
}): Promise<CommitResult> {
  const warnings: string[] = [];
  let lastCommitSha: string | undefined;

  const fileEntries = Object.entries(params.files);
  for (const [filePath, content] of fileEntries) {
    const result = await upsertFile({
      owner: params.repository.owner,
      repo: params.repository.repo,
      branch: params.repository.defaultBranch,
      path: filePath,
      content,
      commitMessage: params.commitMessage
    });

    if (result.error) {
      warnings.push(result.error);
      continue;
    }

    if (result.commitSha) {
      lastCommitSha = result.commitSha;
    }
  }

  return { lastCommitSha, warnings };
}
