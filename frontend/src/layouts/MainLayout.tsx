import { NavLink, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode, SVGProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { clearAuthSession, getAuthUser } from "../auth";

type Props = {
  children: ReactNode;
};

type NavItemProps = {
  to: string;
  label: string;
  end?: boolean;
};

type PipelineStatus = "idle" | "checking" | "ready" | "sleeping" | "error";

const PIPELINE_HEALTH_URL =
  "https://idromardi-ai-693191024735.europe-west1.run.app/health";

const STALE_AFTER_MS = 1000 * 60 * 15; // 15 min

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

function PulseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 12h4l2.2-4.5L13 17l2.2-5H21"
      />
    </svg>
  );
}

function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v4h4M20 20v-4h-4" />
    </svg>
  );
}

function formatLastPing(date: Date | null) {
  if (!date) return "Mai verificata";

  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

async function pingPipelineHealth() {
  const response = await fetch(PIPELINE_HEALTH_URL, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Health check fallito (${response.status})`);
  }

  return true;
}

function PipelineStatusPanel() {
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [lastReadyAt, setLastReadyAt] = useState<Date | null>(null);
  const [message, setMessage] = useState("Pipeline non ancora verificata.");

  const isStale = useMemo(() => {
    if (!lastReadyAt) return true;
    return Date.now() - lastReadyAt.getTime() > STALE_AFTER_MS;
  }, [lastReadyAt]);

  const handlePing = useCallback(async () => {
    try {
      setStatus("checking");
      setMessage("Controllo stato pipeline in corso...");

      await pingPipelineHealth();

      const now = new Date();
      setLastReadyAt(now);
      setStatus("ready");
      setMessage("Pipeline pronta a ricevere file.");
    } catch (error) {
      console.error("Errore health check pipeline:", error);
      setStatus("error");
      setMessage("Pipeline non raggiungibile o non ancora pronta.");
    }
  }, []);

  useEffect(() => {
    handlePing();
  }, [handlePing]);

  useEffect(() => {
    if (!lastReadyAt) return;

    const interval = window.setInterval(() => {
      const stale = Date.now() - lastReadyAt.getTime() > STALE_AFTER_MS;
      if (stale) {
        setStatus((prev) => (prev === "checking" ? prev : "sleeping"));
        setMessage("Ultimo controllo non recente. Conviene eseguire un ping.");
      }
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [lastReadyAt]);

  const theme =
    status === "ready"
      ? {
          wrap: "border-emerald-200 bg-emerald-50/70",
          iconBox: "bg-emerald-100 text-emerald-700",
          badge: "bg-emerald-100 text-emerald-700",
          button:
            "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50",
          label: "Pipeline pronta",
        }
      : status === "checking"
      ? {
          wrap: "border-amber-200 bg-amber-50/70",
          iconBox: "bg-amber-100 text-amber-700",
          badge: "bg-amber-100 text-amber-700",
          button:
            "border-amber-200 bg-white text-amber-700 hover:bg-amber-50",
          label: "Verifica in corso",
        }
      : status === "error"
      ? {
          wrap: "border-rose-200 bg-rose-50/70",
          iconBox: "bg-rose-100 text-rose-700",
          badge: "bg-rose-100 text-rose-700",
          button:
            "border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
          label: "Pipeline non disponibile",
        }
      : status === "sleeping"
      ? {
          wrap: "border-slate-200 bg-slate-100/80",
          iconBox: "bg-slate-200 text-slate-700",
          badge: "bg-slate-200 text-slate-700",
          button:
            "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          label: "Possibile sleep",
        }
      : {
          wrap: "border-slate-200 bg-white",
          iconBox: "bg-slate-100 text-slate-600",
          badge: "bg-slate-100 text-slate-600",
          button:
            "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          label: "Non verificata",
        };

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${theme.wrap}`}>
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${theme.iconBox}`}
        >
          <PulseIcon className={`h-5 w-5 ${status === "checking" ? "animate-pulse" : ""}`} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">
               
              </div>
              <div className="mt-1 text-xs text-slate-500">
                 
              </div>
            </div>

            <span
              className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${theme.badge}`}
            >
              {theme.label}
            </span>
          </div>

          <p className="mt-3 text-sm leading-5 text-slate-700">{message}</p>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500">
              Ultimo check: {formatLastPing(lastReadyAt)}
              {isStale && lastReadyAt ? " • da aggiornare" : ""}
            </div>

<button
  type="button"
  onClick={handlePing}
  disabled={status === "checking"}
  title="Verifica / riattiva pipeline"
  className={`
    inline-flex items-center justify-center
    h-9 w-9
    rounded-xl border
    transition
    disabled:cursor-not-allowed disabled:opacity-60
    ${theme.button}
  `}
>
  <RefreshIcon
    className={`h-4 w-4 ${
      status === "checking" ? "animate-spin" : ""
    }`}
  />
</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MainLayout({ children }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const match = location.pathname.match(/^\/condomini\/([^/]+)/);
  const condominioId = match?.[1];
  const user = getAuthUser();
  const mainRef = useRef<HTMLElement | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  function handleLogout() {
    clearAuthSession();
    navigate("/login", { replace: true });
  }

  return (
    <div className="relative flex h-screen h-dvh overflow-hidden bg-slate-50">
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Chiudi menu di navigazione"
          className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside
        id="main-navigation"
        className={`navbarside fixed inset-y-0 left-0 z-[60] flex w-72 flex-col border-r border-slate-200 bg-slate-50 shadow-xl transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 lg:shadow-none ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-6">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-800">
              IDROMARDI 2.0
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Sistema Gestione Contabilità
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Chiudi menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-6 overflow-y-auto">
          <div className="space-y-1">
            <NavItem to="/" label="Dashboard" />
            <NavItem to="/condomini" label="Condomini" />
          </div>

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

              <div className="space-y-1 pt-4">
                <div className="px-3 text-xs text-slate-400 uppercase tracking-wider pb-2">
                  Gestione Letture
                </div>

                <NavItem
                  to={`/condomini/${condominioId}/letture`}
                  label="Gestione Letture"
                />
                <NavItem
                  to={`/condomini/${condominioId}/fatture`}
                  label="Fatturazione"
                />
              </div>
            </>
          )}

          <div className="border-t border-slate-200 pt-6">
            <div className="px-3 text-xs text-slate-400 uppercase tracking-wider pb-2">
              Amministrazione
            </div>

            <div className="space-y-1">
              <NavItem to="/admin/tariffe" label="Tariffe Casa Idrica" />
              <NavItem to="/admin/mobile-readings" label="Verifica letture mobili" />
              <NavItem to="/admin/meta-business" label="Meta Business" />
              <NavItem to="/admin/contabilita" label="Contabilità" />
            </div>

            <div className="mt-5 px-3 text-xs text-slate-400 uppercase tracking-wider pb-2">
              Impostazioni
            </div>

            <div className="space-y-1">
              <NavItem
                to="/admin/tools"
                label="Geolocalizzazione Condomini"
              />
              <NavItem to="/admin/password" label="Password" />
            </div>

            <div className="mt-5 px-1">
              <PipelineStatusPanel />
            </div>
          </div>
        </nav>

        <div className="border-t border-slate-200 px-4 py-4">
          <div className="mb-2 text-xs text-slate-500">
            Operatore: <span className="font-semibold text-slate-700">{user?.username || "admin"}</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Esci
          </button>
        </div>
      </aside>

      <main
        ref={mainRef}
        onScroll={(event) => setShowScrollTop(event.currentTarget.scrollTop > 500)}
        className="min-w-0 flex-1 overflow-auto p-3 sm:p-4 lg:p-6"
      >
        <div className="sticky top-0 z-50 -mx-3 -mt-3 mb-3 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-3 shadow-sm backdrop-blur sm:-mx-4 sm:-mt-4 sm:px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Apri menu"
            aria-controls="main-navigation"
            aria-expanded={mobileNavOpen}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-slate-900">IDROMARDI 2.0</div>
            <div className="truncate text-xs text-slate-500">
              {condominioId ? "Gestione condominio" : "Pannello operativo"}
            </div>
          </div>
        </div>
        {children}
      </main>

      {showScrollTop && (
        <button
          type="button"
          onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Torna in cima"
          title="Torna in cima"
          className="fixed bottom-6 right-6 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 15 6-6 6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
