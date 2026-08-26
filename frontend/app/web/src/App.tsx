import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { ProtectedRoute } from "./app/ProtectedRoute";
import { SessionProvider } from "./app/session";
import { AdminOrgsPage } from "./features/admin/AdminOrgsPage";
import { AdminUsersPage } from "./features/admin/AdminUsersPage";
import { AuthCallbackPage, ForgotPasswordPage, LoginPage } from "./features/auth/LoginPage";
import { LandingPage } from "./features/marketing/LandingPage";
import { InvitePage } from "./features/onboarding/InvitePage";
import { PendingPage } from "./features/onboarding/PendingPage";
import { OrgPage } from "./features/orgs/OrgPage";
import { OrgsPage } from "./features/orgs/OrgsPage";
import { RoleCatalogueProvider } from "./features/orgs/roleLabels";
import { ProjectsPage } from "./features/projects/ProjectsPage";
import { StudioPage } from "./features/studio/StudioPage";

export function App() {
  return (
    <SessionProvider>
      <RoleCatalogueProvider>
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/signin" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />

        {/* Signed in, no chrome */}
        <Route element={<ProtectedRoute />}>
          <Route path="/pending" element={<PendingPage />} />
        </Route>

        {/* Signed in, with the app shell */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/orgs" element={<OrgsPage />} />
            <Route path="/orgs/:orgId" element={<OrgPage />} />
            <Route path="/orgs/:orgId/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<StudioPage />} />
          </Route>
        </Route>

        {/* Platform admins */}
        <Route element={<ProtectedRoute requirePlatformAdmin />}>
          <Route element={<AppShell />}>
            <Route path="/admin/orgs" element={<AdminOrgsPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
          </Route>
        </Route>

        <Route path="/app" element={<Navigate to="/orgs" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </RoleCatalogueProvider>
    </SessionProvider>
  );
}
