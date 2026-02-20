import { Routes, Route } from "react-router-dom";
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

function App() {
  return (
    <MainLayout>
      <Routes>

        {/* Dashboard */}
        <Route path="/" element={<Dashboard />} />

        {/* Condomini */}
        <Route path="/condomini" element={<CondominiList />} />
        <Route path="/condomini/new" element={<CondominioCreate />} />
        <Route path="/condomini/:id" element={<CondominioOverview />} />
        <Route path="/condomini/:id/edit" element={<CondominioEdit />} />
        <Route path="/condomini/:id/contatti" element={<CondominioContatti />} />
        <Route path="/condomini/:id/utenze" element={<CondominioUtenze />} />
        <Route path="/condomini/:id/letture" element={<LetturePage />} />   
       <Route path="/condomini/:condominioId/fatture" element={<CondominioFatturePage />} />
        <Route path="/condomini/:condominioId/fatture/:id" element={<CondominioFatturePage />} />
         
          
      
        {/* Admin */}
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/tools" element={<AdminTools />} />
        <Route path="/admin/tariffe" element={<AdminTariffe />} />  
      </Routes>
    </MainLayout>
  );
}

export default App;
