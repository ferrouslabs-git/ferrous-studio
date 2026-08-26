// Cognito Hosted UI auth, wired against the app/auth/ backend module
// (mounted at /api/um — see backend/app/main.py). There is no dev-login
// bypass here on purpose: per this template's convention, local dev always
// authenticates against the real STAGING Cognito pool (see
// infra/scripts/create-local-dev-user.ps1) — there is no local Cognito to
// bypass to.
//
// Flow:
//   1. Redirect to the Cognito Hosted UI (getLoginUrl/getSignupUrl).
//   2. Cognito redirects back to /auth/callback?code=... .
//   3. handleCallback() exchanges the code for tokens directly against
//      Cognito's public token endpoint (the app client has no secret), then
//      calls POST /api/um/sync (creates/updates the user row) and
//      POST /api/um/cookie/store-refresh (persists the refresh token
//      server-side behind an HttpOnly cookie — it never touches localStorage).
//   4. The access token is kept in memory + localStorage and silently
//      refreshed via POST /api/um/token/refresh (cookie + CSRF-protected)
//      shortly before it expires.

const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN as string | undefined;
const CLIENT_ID = import.meta.env.VITE_COGNITO_APP_CLIENT_ID as string | undefined;
const REDIRECT_URI =
  (import.meta.env.VITE_COGNITO_REDIRECT_URI as string | undefined) ||
  `${window.location.origin}/auth/callback`;
const LOGOUT_URI =
  (import.meta.env.VITE_COGNITO_LOGOUT_URI as string | undefined) || `${window.location.origin}/`;
const SCOPES = "openid profile email";

const TOKEN_KEY = "auth_access_token";
const EXPIRES_KEY = "auth_access_token_expires_at";
const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export interface UserInfo {
  id: string;
  email: string;
  name: string | null;
  cognito_sub: string;
  is_platform_admin: boolean;
}

let currentUser: UserInfo | null = null;
let refreshInFlight: Promise<string | null> | null = null;

function requireConfig(): { domain: string; clientId: string } {
  if (!COGNITO_DOMAIN || !CLIENT_ID) {
    throw new Error(
      "Cognito is not configured: set VITE_COGNITO_DOMAIN and VITE_COGNITO_APP_CLIENT_ID " +
        "(see frontend/app/web/.env.local.example). This template never falls back to a " +
        "default pool — a missing config must fail loudly, not silently point at someone " +
        "else's Cognito pool."
    );
  }
  return { domain: COGNITO_DOMAIN, clientId: CLIENT_ID };
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function storeAccessToken(accessToken: string, expiresInSeconds: number): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(EXPIRES_KEY, String(Date.now() + expiresInSeconds * 1000));
}

function clearAccessToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRES_KEY);
  currentUser = null;
}

function getStoredToken(): { token: string; expiresAt: number } | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiresAtRaw = localStorage.getItem(EXPIRES_KEY);
  if (!token || !expiresAtRaw) return null;
  return { token, expiresAt: Number(expiresAtRaw) };
}

function isExpiringSoon(expiresAt: number): boolean {
  return Date.now() > expiresAt - REFRESH_SKEW_MS;
}

function getLoginUrl(): string {
  const { domain, clientId } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
  });
  return `${domain}/login?${params.toString()}`;
}

function getSignupUrl(): string {
  const { domain, clientId } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
  });
  return `${domain}/signup?${params.toString()}`;
}

function getForgotPasswordUrl(): string {
  const { domain, clientId } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
  });
  return `${domain}/forgotPassword?${params.toString()}`;
}

async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  id_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const { domain, clientId } = requireConfig();
  const response = await fetch(`${domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!response.ok) {
    throw new Error(`Cognito token exchange failed: ${response.status}`);
  }
  return response.json();
}

/** Handle the `?code=` redirect from the Hosted UI: exchange it for tokens,
 * sync the user into our database, and persist the refresh token server-side. */
async function handleCallback(code: string): Promise<void> {
  const tokens = await exchangeCodeForTokens(code);
  storeAccessToken(tokens.access_token, tokens.expires_in);

  await fetch("/api/um/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  await fetch("/api/um/cookie/store-refresh", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.access_token}`,
    },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
}

/** Silently exchange the HttpOnly refresh cookie for a new access token. */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const csrfToken = readCookie("auth_csrf_token");
    if (!csrfToken) {
      clearAccessToken();
      return null;
    }
    try {
      const response = await fetch("/api/um/token/refresh", {
        method: "POST",
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRF-Token": csrfToken,
        },
      });
      if (!response.ok) {
        clearAccessToken();
        return null;
      }
      const tokens = await response.json();
      storeAccessToken(tokens.access_token, tokens.expires_in ?? 3600);
      return tokens.access_token as string;
    } catch {
      clearAccessToken();
      return null;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/** Return a usable access token, refreshing it first if it's missing or about to expire. */
async function getValidToken(): Promise<string | null> {
  const stored = getStoredToken();
  if (stored && !isExpiringSoon(stored.expiresAt)) return stored.token;
  return refreshAccessToken();
}

/** Synchronous check for route guarding before the async refresh resolves. */
function isAuthenticated(): boolean {
  return getStoredToken() !== null || readCookie("auth_csrf_token") !== null;
}

async function fetchUserInfo(): Promise<UserInfo | null> {
  const token = await getValidToken();
  if (!token) {
    currentUser = null;
    return null;
  }
  const response = await fetch("/api/um/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    currentUser = null;
    return null;
  }
  currentUser = (await response.json()) as UserInfo;
  return currentUser;
}

function getCurrentUser(): UserInfo | null {
  return currentUser;
}

function isPlatformAdmin(): boolean {
  return currentUser?.is_platform_admin ?? false;
}

/** Call this on a 401 from any API call: the session is no longer valid. */
function handleExpiredSession(): void {
  clearAccessToken();
  window.location.href = "/signin";
}

async function logout(): Promise<void> {
  try {
    await fetch("/api/um/cookie/clear-refresh", { method: "POST", credentials: "include" });
  } catch {
    // best-effort — proceed to clear client state and sign out of Cognito regardless
  }
  clearAccessToken();
  const { domain, clientId } = requireConfig();
  const params = new URLSearchParams({ client_id: clientId, logout_uri: LOGOUT_URI });
  window.location.href = `${domain}/logout?${params.toString()}`;
}

export const authService = {
  getLoginUrl,
  getSignupUrl,
  getForgotPasswordUrl,
  handleCallback,
  getValidToken,
  isAuthenticated,
  fetchUserInfo,
  getCurrentUser,
  isPlatformAdmin,
  handleExpiredSession,
  logout,
};
