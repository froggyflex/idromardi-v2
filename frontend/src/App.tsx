import { Navigate, Routes, Route, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import MainLayout from "./layouts/MainLayout";

import Dashboard from "./pages/Dashboard";

import CondominiList from "./pages/CondominiList";
import CondominioOverview from "./pages/CondominioOverview";
import CondominioEdit from "./pages/CondominioEdit";
import CondominioCreate from "./pages/CondominioCreate";
import CondominioContatti from "./pages/CondominioContatti";

import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminTools from "./pages/admin/AdminTools";
import CondominioUtenze from "./pages/CondominioUtenze";
import LetturePage from "./pages/LetturePage";
import AdminTariffe from "./pages/admin/AdminTariffe";
import CondominioFatturePage from "./pages/fatture/CondominioFatturePage ";
import FinancialSummaryPageTemplate from "./pages/admin/FinancialSummaryPageTemplate";
import LoginPage from "./pages/LoginPage";
import PasswordSettings from "./pages/admin/PasswordSettings";
import MobileReadingsReview from "./pages/admin/MobileReadingsReview";
import MetaBusinessPage from "./pages/admin/MetaBusinessPage";
import DocumentNumberSettings from "./pages/admin/DocumentNumberSettings";
import BollettaTemplateEditor from "./pages/admin/BollettaTemplateEditor";
import GlobalSearchPage from "./pages/GlobalSearchPage";
import AmministratoriAccounts from "./pages/admin/AmministratoriAccounts";
import PcloudStorageTest from "./pages/admin/PcloudStorageTest";
import AmministratorePortal from "./pages/AmministratorePortal";
import { getAuthRole, getAuthUser, clearAuthSession, isAuthenticated } from "./auth";

function RequireAdmin({ children }: { children: ReactNode }) {
  // Read the current session when the route mounts, rather than capturing the
  // logged-out role while App constructs the route elements before login.
  return getAuthRole() === "ADMIN" ? children : <Navigate to="/" replace />;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const user = getAuthUser();
  if (user?.mustChangePassword && !user?.impersonation) {
    if (location.pathname !== "/password-change") return <Navigate to="/password-change" replace />;
    return <div className="min-h-screen bg-slate-100 p-6"><div className="mx-auto max-w-xl"><PasswordSettings /><button className="mt-4 text-sm text-slate-600 underline" onClick={() => { clearAuthSession(); window.location.href = "/login"; }}>Esci</button></div></div>;
  }
  if (getAuthRole(user) === "AMMINISTRATORE") return <AmministratorePortal />;

  return children;
}

function App() {
  return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/password-change" element={<RequireAuth><PasswordSettings /></RequireAuth>} />

        {/* Dashboard */}
        <Route
          path="*"
          element={
            <RequireAuth>
              <MainLayout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />

                  <Route path="/condomini" element={<CondominiList />} />
                  <Route path="/ricerca" element={<GlobalSearchPage />} />
                  <Route path="/condomini/new" element={<CondominioCreate />} />
                  <Route path="/condomini/:id" element={<CondominioOverview />} />
                  <Route path="/condomini/:id/edit" element={<CondominioEdit />} />
                  <Route path="/condomini/:id/contatti" element={<CondominioContatti />} />
                  <Route path="/condomini/:id/utenze" element={<CondominioUtenze />} />
                  <Route path="/condomini/:id/letture" element={<LetturePage />} />
                  <Route path="/condomini/:condominioId/fatture" element={<CondominioFatturePage />} />
                  <Route path="/condomini/:condominioId/fatture/:id" element={<CondominioFatturePage />} />

                  <Route path="/admin" element={<AdminDashboard />} />
                  <Route path="/admin/amministratori" element={<RequireAdmin><AmministratoriAccounts /></RequireAdmin>} />
                  <Route path="/admin/pcloud-test" element={<RequireAdmin><PcloudStorageTest /></RequireAdmin>} />
                  <Route path="/admin/tools" element={<AdminTools />} />
                  <Route path="/admin/tariffe" element={<AdminTariffe />} />
                  <Route path="/admin/contabilita" element={<FinancialSummaryPageTemplate />} />
                  <Route path="/admin/password" element={<PasswordSettings />} />
                  <Route path="/admin/document-numbers" element={<DocumentNumberSettings />} />
                  <Route path="/admin/bolletta-templates" element={<BollettaTemplateEditor />} />
                  <Route path="/admin/mobile-readings" element={<MobileReadingsReview />} />
                  <Route path="/admin/meta-business" element={<MetaBusinessPage />} />
                </Routes>
              </MainLayout>
            </RequireAuth>
          }
        />
      </Routes>
  );
}

export default App;
