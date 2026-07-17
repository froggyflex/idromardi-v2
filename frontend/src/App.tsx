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
import { isAuthenticated } from "./auth";

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function App() {
  return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Dashboard */}
        <Route
          path="*"
          element={
            <RequireAuth>
              <MainLayout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />

                  <Route path="/condomini" element={<CondominiList />} />
                  <Route path="/condomini/new" element={<CondominioCreate />} />
                  <Route path="/condomini/:id" element={<CondominioOverview />} />
                  <Route path="/condomini/:id/edit" element={<CondominioEdit />} />
                  <Route path="/condomini/:id/contatti" element={<CondominioContatti />} />
                  <Route path="/condomini/:id/utenze" element={<CondominioUtenze />} />
                  <Route path="/condomini/:id/letture" element={<LetturePage />} />
                  <Route path="/condomini/:condominioId/fatture" element={<CondominioFatturePage />} />
                  <Route path="/condomini/:condominioId/fatture/:id" element={<CondominioFatturePage />} />

                  <Route path="/admin" element={<AdminDashboard />} />
                  <Route path="/admin/tools" element={<AdminTools />} />
                  <Route path="/admin/tariffe" element={<AdminTariffe />} />
                  <Route path="/admin/contabilita" element={<FinancialSummaryPageTemplate />} />
                  <Route path="/admin/password" element={<PasswordSettings />} />
                  <Route path="/admin/mobile-readings" element={<MobileReadingsReview />} />
                </Routes>
              </MainLayout>
            </RequireAuth>
          }
        />
      </Routes>
  );
}

export default App;
