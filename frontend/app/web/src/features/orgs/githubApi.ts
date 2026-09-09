// Client for /api/studio/github/* and a project's repository link (backend
// app/studio/github.py).
//
// The connection is per organisation and shared by every project in it (see
// OrgGitHubPage.tsx); the repository link is per project (see
// features/project/RepositorySection.tsx). Installing the GitHub App leaves
// the app entirely -- `startConnect` returns a URL for the browser to
// navigate to, and GitHub sends the user back to Organisation ▸ GitHub with a
// ?github= outcome (see CONNECT_OUTCOMES below).
import { apiDelete, apiGet, apiPost, apiPut } from "../../core/api";
import { Project } from "../projects/projectsApi";

/** The organisation's GitHub App installation. */
export interface GitHubConnection {
  /** Whether this deployment has a GitHub App at all. */
  configured: boolean;
  /** Whether this organisation has installed it. */
  connected: boolean;
  installation_id: number | null;
  /** The GitHub account the App is installed on. */
  account_login: string | null;
  account_type: string | null;
  /** "all" or "selected" -- how much of that account we can see. */
  repository_selection: string | null;
  connected_at: string | null;
  /** Who ran the install flow, if that user can still be resolved. No name
   *  lookup here -- show the date alone when only the id is known. */
  connected_by: string | null;
  /** GitHub's own page for changing which repositories we may see. */
  manage_url: string | null;
}

export interface GitHubRepository {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  description: string | null;
  pushed_at: string | null;
}

export interface RepositoryCommit {
  sha: string;
  message: string;
  author: string | null;
  committed_at: string | null;
  html_url: string | null;
}

/**
 * How the stored link and GitHub currently compare.
 *
 * `ok` and `unlinked` are the ordinary states; the rest each mean the page
 * should say something, and the server sends the sentence in `message`.
 *
 * There is no "renamed": the link is held by id, so a rename on GitHub's side
 * survives it and the server just refreshes the cached name.
 */
export type RepositoryState = "unlinked" | "ok" | "unreachable" | "disconnected" | "unavailable";

export interface ProjectRepository {
  state: RepositoryState;
  repo_id: number | null;
  repo_full_name: string | null;
  html_url: string | null;
  description: string | null;
  private: boolean | null;
  /** GitHub's current default branch. A live readout, never stored. */
  default_branch: string | null;
  latest_commit: RepositoryCommit | null;
  message: string | null;
}

export const getConnection = () => apiGet<GitHubConnection>("/studio/github/connection");

/**
 * Where to send the browser to install the App.
 *
 * A URL rather than a redirect: this call carries the bearer token, and
 * following a redirect with fetch would forward that header to github.com.
 * The flow always starts on, and returns to, Organisation ▸ GitHub now, so
 * there is nothing left to tell it where to come back to.
 */
export const startConnect = () => apiPost<{ url: string }>("/studio/github/connect", {});

export const disconnectGitHub = () => apiDelete("/studio/github/connection");

export const listRepositories = () => apiGet<GitHubRepository[]>("/studio/github/repositories");

/** The linked repository as it stands now. Calls out to GitHub, so it is its
 *  own request rather than part of the project payload. */
export const getProjectRepository = (projectId: string) =>
  apiGet<ProjectRepository>(`/studio/projects/${projectId}/repository`);

export const linkRepository = (projectId: string, repoId: number) =>
  apiPut<Project>(`/studio/projects/${projectId}/repository`, { repo_id: repoId });

export const unlinkRepository = (projectId: string) =>
  apiDelete(`/studio/projects/${projectId}/repository`);

/**
 * What the ?github= parameter on the return trip means.
 *
 * The callback cannot render anything itself -- it is a redirect -- so it says
 * how the install went in the URL and the page turns that into a sentence.
 * Anything unrecognised is ignored rather than shown raw, since the query
 * string is trivially editable by whoever is looking at it.
 */
export const CONNECT_OUTCOMES: Record<string, { tone: "ok" | "warn"; message: string }> = {
  connected: { tone: "ok", message: "GitHub connected." },
  requested: {
    tone: "warn",
    message: "Installation requested. An owner of the GitHub account has to approve it.",
  },
  denied: {
    tone: "warn",
    message: "That installation belongs to a GitHub account you do not have access to.",
  },
  failed: { tone: "warn", message: "GitHub could not complete the connection." },
};
