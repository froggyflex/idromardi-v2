import { NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type NavItemProps = {
  to: string;
  label: string;
  end?: boolean;
};

function NavItem({ to, label, end = false }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `
        flex items-center
        px-3 py-2
        rounded-md
        text-sm font-medium
        transition-colors
        ${
          isActive
            ? "bg-blue-600 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
        }
        `
      }
    >
      {label}
    </NavLink>
  );
}

export default function MainLayout({ children }: Props) {
  const location = useLocation();
  const match = location.pathname.match(/^\/condomini\/([^/]+)/);
  const condominioId = match?.[1];

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col">

        {/* Logo */}
        <div className="px-6 py-6 border-b border-slate-200">
          <h1 className="text-lg font-semibold text-slate-800 tracking-tight">
            IDROMARDI 2.0
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Sistema Gestione Contabilità
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-6">

          {/* Primary */}
          <div className="space-y-1">
            <NavItem to="/" label="Dashboard" />
            <NavItem to="/condomini" label="Condomini" />
          </div>

          {/* Condominio Context */}
          {condominioId && (
            <>
              <div className="space-y-1">
                <div className="px-3 text-xs text-slate-400 uppercase tracking-wider pb-2">
                  Condominio
                </div>

                <NavItem
                  to={`/condomini/${condominioId}`}
                  label="Dettagli"
                  end
                />
                <NavItem
                  to={`/condomini/${condominioId}/utenze`}
                  label="Utenze"
                />
                <NavItem
                  to={`/condomini/${condominioId}/contatti`}
                  label="Contatti"
                />
              </div>

              {/* Inserimento Letture */}
              <div className="space-y-1 pt-4">
                <div className="px-3 text-xs text-slate-400 uppercase tracking-wider pb-2">
                  Gestione Letture
                </div>

                <NavItem
                  to={`/condomini/${condominioId}/letture`}
                  label="Gestione Letture"
                />
                <NavItem to={`/condomini/${condominioId}/fatture`} label="Fatturazione" />
              </div>
            </>
          )}

          {/* Divider */}
          <div className="border-t border-slate-200 pt-6">
            <div className="px-3 text-xs text-slate-400 uppercase tracking-wider pb-2">
              Amministrazione
            </div>

            <div className="space-y-1">
              <NavItem
                to="/admin/tools"
                label="Strumenti Sistema"
              />
              <NavItem to="/admin/tariffe" label="Tariffe Casa Idrica" />
            </div>
          </div>
        </nav>
      </aside>

      <main className="flex-1 p-6 overflow-auto">
        {children}
      </main>
    </div>
  );
}
