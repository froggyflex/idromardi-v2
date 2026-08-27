import { NavLink, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode, SVGProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookUser,
  Building2,
  ChevronRight,
  ClipboardCheck,
  Droplets,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  MessagesSquare,
  ReceiptText,
  Tags,
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { clearAuthSession, getAuthUser } from "../auth";
import api from "../api/client";
import { META_UNREAD_REFRESH_EVENT } from "../metaNotifications";

type Props = {
  children: ReactNode;
};

type NavItemProps = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badgeCount?: number;
};

type PipelineStatus = "idle" | "checking" | "ready" | "sleeping" | "error";

const PIPELINE_HEALTH_URL =
  "https://idromardi-ai-693191024735.europe-west1.run.app/health";

const STALE_AFTER_MS = 1000 * 60 * 15; // 15 min

function NavItem({ to, label, icon: Icon, end = false, badgeCount = 0 }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `
        group flex min-h-10 items-center gap-3
        rounded-xl px-3 py-2
        text-sm font-semibold
        transition-all duration-150
        ${
          isActive
            ? "bg-blue-50 text-blue-700 shadow-sm ring-1 ring-inset ring-blue-100"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }
        `
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badgeCount > 0 && (
        <span
          className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm"
          aria-label={`${badgeCount} messaggi non letti`}
          title={`${badgeCount} messaggi non letti`}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
      <ChevronRight
        className="h-3.5 w-3.5 shrink-0 text-current opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-40"
        aria-hidden="true"
      />
    </NavLink>
  );
}

function NavSectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
      <span>{children}</span>
      <span className="h-px flex-1 bg-slate-200/80" />
    </div>
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

  const isStale = !lastReadyAt || status === "sleeping";

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
    const timeout = window.setTimeout(() => void handlePing(), 0);
    return () => window.clearTimeout(timeout);
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
              <div className="text-sm font-semibold text-slate-900">Pipeline documentale</div>
              <div className="mt-1 text-xs text-slate-500">Importazione fatture</div>
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
  const [metaUnreadCount, setMetaUnreadCount] = useState(0);
  const normalizedRole = String(user?.role || (user?.username === "admin" ? "ADMIN" : "")).toUpperCase();
  const canUseMeta = normalizedRole === "ADMIN" || normalizedRole === "REVIEWER";

  const refreshMetaUnread = useCallback(async () => {
    if (!canUseMeta || document.visibilityState !== "visible") return;
    try {
      const response = await api.get<{ total?: number }>("/meta/unread");
      setMetaUnreadCount(Math.max(0, Number(response.data.total || 0)));
    } catch {
      // Navigation must remain usable if Meta is not configured yet.
    }
  }, [canUseMeta]);

  useEffect(() => {
    if (!canUseMeta) return;
    const initialRefresh = window.setTimeout(() => void refreshMetaUnread(), 0);
    const timer = window.setInterval(() => void refreshMetaUnread(), 10_000);
    const refreshWhenVisible = () => void refreshMetaUnread();
    window.addEventListener(META_UNREAD_REFRESH_EVENT, refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
      window.removeEventListener(META_UNREAD_REFRESH_EVENT, refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [canUseMeta, refreshMetaUnread]);

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
        className={`navbarside fixed inset-y-0 left-0 z-[60] flex w-72 flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 lg:shadow-none ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-md shadow-blue-200/60">
              <Droplets className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-bold tracking-tight text-slate-900">
                IDROMARDI 2.0
              </h1>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">
                Gestione operativa
              </p>
            </div>
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
        <nav
          className="flex-1 space-y-6 overflow-y-auto px-4 py-5 scrollbar-thin"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setMobileNavOpen(false);
          }}
        >
          <div>
            <NavSectionTitle>Principale</NavSectionTitle>
            <div className="space-y-1">
              <NavItem to="/" label="Dashboard" icon={LayoutDashboard} />
              <NavItem to="/condomini" label="Condomini" icon={Building2} />
            </div>
          </div>

          {condominioId && (
            <div>
              <NavSectionTitle>Condominio attivo</NavSectionTitle>
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-1.5">
                <NavItem
                  to={`/condomini/${condominioId}`}
                  label="Dettagli"
                  icon={Building2}
                  end
                />
                <NavItem
                  to={`/condomini/${condominioId}/utenze`}
                  label="Utenze"
                  icon={UsersRound}
                />
                <NavItem
                  to={`/condomini/${condominioId}/contatti`}
                  label="Contatti"
                  icon={BookUser}
                />
                <div className="mx-3 my-1.5 h-px bg-slate-200" />
                <NavItem
                  to={`/condomini/${condominioId}/letture`}
                  label="Gestione Letture"
                  icon={Gauge}
                />
                <NavItem
                  to={`/condomini/${condominioId}/fatture`}
                  label="Fatturazione"
                  icon={ReceiptText}
                />
              </div>
            </div>
          )}

          <div>
            <NavSectionTitle>Amministrazione</NavSectionTitle>
            <div className="space-y-1">
              <NavItem to="/admin/tariffe" label="Tariffe Casa Idrica" icon={Tags} />
              <NavItem
                to="/admin/mobile-readings"
                label="Verifica letture mobili"
                icon={ClipboardCheck}
              />
              <NavItem
                to="/admin/meta-business"
                label="Meta Business"
                icon={MessagesSquare}
                badgeCount={metaUnreadCount}
              />
              <NavItem to="/admin/contabilita" label="Contabilità" icon={WalletCards} />
            </div>
          </div>

          <div>
            <NavSectionTitle>Impostazioni</NavSectionTitle>
            <div className="space-y-1">
              <NavItem
                to="/admin/tools"
                label="Geolocalizzazione Condomini"
                icon={MapPinned}
              />
              <NavItem to="/admin/password" label="Password" icon={KeyRound} />
            </div>
          </div>

          <div>
            <NavSectionTitle>Servizi</NavSectionTitle>
            <div className="px-1">
              <PipelineStatusPanel />
            </div>
          </div>
        </nav>

        <div className="border-t border-slate-200/80 bg-slate-50/70 p-4">
          <div className="mb-3 flex items-center gap-3 px-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm">
              <UserRound className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-800">
                {user?.username || "admin"}
              </div>
              <div className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-400">
                {user?.role || "Operatore"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
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
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-slate-900">IDROMARDI 2.0</div>
            <div className="truncate text-xs text-slate-500">
              {condominioId ? "Gestione condominio" : "Pannello operativo"}
            </div>
          </div>
          {canUseMeta && (
            <NavLink
              to="/admin/meta-business"
              aria-label={metaUnreadCount > 0 ? `Meta Business, ${metaUnreadCount} messaggi non letti` : "Meta Business"}
              title={metaUnreadCount > 0 ? `${metaUnreadCount} messaggi non letti` : "Meta Business"}
              className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              <MessagesSquare className="h-5 w-5" />
              {metaUnreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 py-0.5 text-[9px] font-bold leading-none text-white ring-2 ring-white">
                  {metaUnreadCount > 99 ? "99+" : metaUnreadCount}
                </span>
              )}
            </NavLink>
          )}
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
