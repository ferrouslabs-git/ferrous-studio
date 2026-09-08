import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { HomeRedirect } from "./app/HomeRedirect";
import { ProtectedRoute } from "./app/ProtectedRoute";
import { SessionProvider } from "./app/session";
import { AdminDatasetsPage } from "./features/admin/AdminDatasetsPage";
import { AdminOrgsPage } from "./features/admin/AdminOrgsPage";
import { AdminProjectsPage } from "./features/admin/AdminProjectsPage";
import { AdminUsersPage } from "./features/admin/AdminUsersPage";
import { AuthCallbackPage, ForgotPasswordPage, LoginPage } from "./features/auth/LoginPage";
import { LandingPage } from "./features/marketing/LandingPage";
import { InvitePage } from "./features/onboarding/InvitePage";
import { PendingPage } from "./features/onboarding/PendingPage";
import { OrgPage } from "./features/orgs/OrgPage";
import { RoleCatalogueProvider } from "./features/orgs/roleLabels";
import { DiagramsPage } from "./features/project/diagrams/DiagramsPage";
import { DocumentsPage } from "./features/project/documents/DocumentsPage";
import { EpicsPage } from "./features/project/epics/EpicsPage";
import { FeedbackPage } from "./features/project/feedback/FeedbackPage";
import { PersonasPage } from "./features/project/personas/PersonasPage";
import { PlanPage } from "./features/project/plan/PlanPage";
import { LegacyProjectRedirect, ProjectLayout } from "./features/project/ProjectLayout";
import { ProjectDetailsPage } from "./features/project/ProjectDetailsPage";
import { RoadmapPage } from "./features/project/roadmap/RoadmapPage";
import { UseCaseDiagramPage } from "./features/project/usecases/UseCaseDiagramPage";
import { AuditLogPage } from "./features/project/wireframes/AuditLogPage";
import { WireframesPage } from "./features/project/wireframes/WireframesPage";
import { ProjectsPage } from "./features/projects/ProjectsPage";
import { PreviewPage } from "./features/studio/PreviewPage";
import { SnapshotPreviewPage } from "./features/studio/SnapshotPreviewPage";
import { StudioPage } from "./features/studio/StudioPage";

// The diagram editor carries maxGraph; keep it (and its import-time DOM
// access) out of the main chunk and out of the prerender build.
const DiagramEditorPage = lazy(() =>
  import("./features/diagrams/DiagramEditorPage").then((m) => ({ default: m.DiagramEditorPage })),
);

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
            <Route path="/orgs" element={<HomeRedirect />} />
            {/* The organisation's people are its own menu entry; the bare
                organisation path is kept for older links and lands there. */}
            <Route path="/orgs/:orgId" element={<Navigate to="users" replace />} />
            <Route path="/orgs/:orgId/users" element={<OrgPage />} />
            <Route path="/orgs/:orgId/projects" element={<ProjectsPage />} />

            {/* A project: its own menu replaces the organisation's. */}
            <Route path="/orgs/:orgId/projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<Navigate to="details" replace />} />
              <Route path="details" element={<ProjectDetailsPage />} />
              <Route path="use-cases" element={<UseCaseDiagramPage />} />
              <Route path="personas" element={<PersonasPage />} />
              <Route path="diagrams" element={<DiagramsPage />} />
              <Route
                path="diagrams/:diagramId"
                element={
                  <Suspense fallback={<div className="page muted">Loading editor…</div>}>
                    <DiagramEditorPage />
                  </Suspense>
                }
              />
              <Route path="wireframes" element={<WireframesPage />} />
              <Route path="wireframes/:wireframeId" element={<StudioPage />} />
              <Route path="wireframes/:wireframeId/preview" element={<PreviewPage />} />
              <Route path="wireframes/:wireframeId/snapshots/:versionId/preview" element={<SnapshotPreviewPage />} />
              <Route path="wireframes/:wireframeId/audit" element={<AuditLogPage />} />
              <Route path="documents" element={<DocumentsPage />} />
              <Route path="plan" element={<PlanPage />} />
              <Route path="roadmap" element={<RoadmapPage />} />
              <Route path="epics" element={<EpicsPage />} />
              <Route path="feedback" element={<FeedbackPage />} />
            </Route>

            {/* Older links without the organisation. */}
            <Route path="/projects/:projectId" element={<LegacyProjectRedirect />} />
          </Route>
        </Route>

        {/* Platform admins */}
        <Route element={<ProtectedRoute requirePlatformAdmin />}>
          <Route element={<AppShell />}>
            <Route path="/admin/orgs" element={<AdminOrgsPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/projects" element={<AdminProjectsPage />} />
            <Route path="/admin/datasets" element={<AdminDatasetsPage />} />
          </Route>
        </Route>

        <Route path="/app" element={<Navigate to="/orgs" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </RoleCatalogueProvider>
    </SessionProvider>
  );
}
