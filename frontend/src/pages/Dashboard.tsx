import { useEffect, useMemo, useState, type ReactNode } from "react";
import api from "../api/client";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import {
  Cell,
  Pie,
  PieChart as RePieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  Activity,
  Building2,
  Clock3,
  FileText,
  Gauge,
  MapPin,
  PieChart,
  ReceiptText,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import "leaflet/dist/leaflet.css";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

type MapRow = {
  id: string;
  codice: number | string;
  nome?: string;
  indirizzo: string;
  citta?: string;
  latitude: number | string;
  longitude: number | string;
};

type RecentAction = {
  id: string;
  type: "letture" | "condominio" | "fatturazione" | "tariffe";
  label: string;
  title: string;
  detail?: string;
  date: string;
};

type DashboardStats = {
  condomini: {
    total: number;
    active: number;
    geolocated: number;
    missingGeo: number;
  };
  utenze: {
    total: number;
    active: number;
  };
  activeUtenze: Array<{
    anno: number;
    utenti_attivi: number;
  }>;
  details: {
    fatture: {
      total: number;
      calcolate: number;
      confermate: number;
      totale_calcolato: number;
    };
    letture: {
      total: number;
      bozze: number;
      chiuse: number;
    };
    tariffe: {
      total: number;
    };
    latestPeriod: {
      period_month: number;
      period_year: number;
      stato: string;
      condominio_nome?: string;
      condominio_codice?: number | string;
      updated_at?: string;
    } | null;
  };
  recentActions: RecentAction[];
};

const defaultCenter: [number, number] = [40.8065, 14.2055];
const chartColors = ["#2563eb", "#cbd5e1"];

function normalizeSearch(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function rowMatchesSearch(row: MapRow, term: string) {
  const haystack = normalizeSearch(
    [row.codice, row.nome, row.indirizzo, row.citta].filter(Boolean).join(" ")
  );
  return haystack.includes(term);
}

function FitBounds({
  data,
}: {
  data: Array<MapRow & { latitude: number; longitude: number }>;
}) {
  const map = useMap();

  useEffect(() => {
    window.setTimeout(() => map.invalidateSize(), 80);
    if (!data.length) return;

    const bounds = L.latLngBounds(data.map((c) => [c.latitude, c.longitude]));
    if (data.length === 1) {
      map.setView([data[0].latitude, data[0].longitude], 15);
    } else {
      map.fitBounds(bounds, { padding: [38, 38], maxZoom: 15 });
    }
  }, [data, map]);

  return null;
}

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat("it-IT").format(Number(value || 0));
}

function formatCurrency(value: number | undefined) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value || 0));
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatPeriod(month?: number, year?: number) {
  if (!month || !year) return "Nessun periodo";
  return `${String(month).padStart(2, "0")}/${year}`;
}

function getActionTheme(type: RecentAction["type"]) {
  if (type === "letture") {
    return {
      icon: Gauge,
      badge: "bg-sky-50 text-sky-700 border-sky-200",
      iconBox: "bg-sky-100 text-sky-700",
    };
  }

  if (type === "fatturazione") {
    return {
      icon: ReceiptText,
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
      iconBox: "bg-emerald-100 text-emerald-700",
    };
  }

  if (type === "tariffe") {
    return {
      icon: Settings,
      badge: "bg-amber-50 text-amber-700 border-amber-200",
      iconBox: "bg-amber-100 text-amber-700",
    };
  }

  return {
    icon: Building2,
    badge: "bg-slate-50 text-slate-700 border-slate-200",
    iconBox: "bg-slate-100 text-slate-700",
  };
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [mapData, setMapData] = useState<MapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mapSearch, setMapSearch] = useState("");

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      try {
        setLoading(true);
        setError("");

        const [statsRes, mapRes] = await Promise.all([
          api.get("/dashboard/stats"),
          api.get("/dashboard/map"),
        ]);

        if (!active) return;
        setStats(statsRes.data);
        setMapData(mapRes.data || []);
      } catch (err) {
        console.error("Dashboard load error:", err);
        if (active) setError("Non riesco a caricare i dati dashboard.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, []);

  const validMapData = useMemo(
    () =>
      mapData
        .filter((c) => {
          const lat = Number(c.latitude);
          const lng = Number(c.longitude);

          return (
            !Number.isNaN(lat) &&
            !Number.isNaN(lng) &&
            lat !== 0 &&
            lng !== 0 &&
            lat > 35 &&
            lat < 47 &&
            lng > 6 &&
            lng < 19
          );
        })
        .map((c) => ({
          ...c,
          latitude: Number(c.latitude),
          longitude: Number(c.longitude),
        })),
    [mapData]
  );

  const latestYear = stats?.activeUtenze?.length
    ? stats.activeUtenze[stats.activeUtenze.length - 1]
    : null;

  const normalizedMapSearch = normalizeSearch(mapSearch);
  const mapSearchMatches = useMemo(
    () =>
      normalizedMapSearch.length >= 2
        ? validMapData.filter((row) => rowMatchesSearch(row, normalizedMapSearch))
        : [],
    [normalizedMapSearch, validMapData]
  );
  const focusedMapData =
    normalizedMapSearch.length >= 2 && mapSearchMatches.length
      ? mapSearchMatches
      : validMapData;
  const isSearchingMap = normalizedMapSearch.length >= 2;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Dashboard
          </h1>
          <p className="text-xs text-slate-500">
            Stato operativo della piattaforma, documenti e attivita principali.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
          <Clock3 className="h-3.5 w-3.5 text-slate-400" />
          Aggiornato ora
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          title="Condomini attivi"
          value={loading ? "-" : formatNumber(stats?.condomini?.active)}
          detail={`${formatNumber(stats?.condomini?.total)} totali`}
          icon={Building2}
          tone="blue"
        />
        <MetricCard
          title="Utenze attive"
          value={loading ? "-" : formatNumber(stats?.utenze?.active)}
          detail={`${formatNumber(stats?.utenze?.total)} totali`}
          icon={Users}
          tone="emerald"
        />
        <MetricCard
          title="Fatturazione"
          value={loading ? "-" : formatCurrency(stats?.details?.fatture?.totale_calcolato)}
          detail={`${formatNumber(stats?.details?.fatture?.total)} sessioni`}
          icon={ReceiptText}
          tone="slate"
        />
        <MetricCard
          title="Mappa"
          value={loading ? "-" : formatNumber(validMapData.length)}
          detail={`${formatNumber(
            Math.max(0, Number(stats?.condomini?.active || 0) - validMapData.length)
          )} da geolocalizzare`}
          icon={MapPin}
          tone="amber"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,0.45fr)]">
        <Panel
          title="Mappa condomini"
          subtitle={`${formatNumber(validMapData.length)} condomini con coordinate valide`}
          icon={MapPin}
          compact
          fill
        >
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={mapSearch}
                onChange={(event) => setMapSearch(event.target.value)}
                placeholder="Cerca codice, nome, indirizzo o citta..."
                className="h-10 w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-10 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              {mapSearch && (
                <button
                  type="button"
                  onClick={() => setMapSearch("")}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  title="Pulisci ricerca"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
              {isSearchingMap
                ? `${formatNumber(mapSearchMatches.length)} risultati`
                : `${formatNumber(validMapData.length)} in mappa`}
            </div>
          </div>

          <div className="dashboard-map-shell relative overflow-hidden rounded-xl border border-slate-200">
            <MapContainer
              center={defaultCenter}
              zoom={12}
              className="dashboard-map"
              style={{ height: "100%", minHeight: 640, width: "100%" }}
              scrollWheelZoom
            >
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <FitBounds data={focusedMapData} />

              <MarkerClusterGroup
                chunkedLoading
                showCoverageOnHover={false}
                maxClusterRadius={44}
                iconCreateFunction={(cluster: { getChildCount: () => number }) =>
                  L.divIcon({
                    html: `<div class="custom-cluster">${cluster.getChildCount()}</div>`,
                    className: "cluster-wrapper",
                    iconSize: L.point(44, 44, true),
                  })
                }
              >
                {(isSearchingMap && mapSearchMatches.length ? mapSearchMatches : validMapData).map((c) => (
                  <Marker key={c.id} position={[c.latitude, c.longitude]}>
                    <Popup>
                      <strong>
                        {c.nome || `ID ${c.codice}`}
                      </strong>
                      <br />
                      Codice {c.codice}
                      <br />
                      {c.indirizzo}
                      {c.citta ? (
                        <>
                          <br />
                          {c.citta}
                        </>
                      ) : null}
                    </Popup>
                  </Marker>
                ))}
              </MarkerClusterGroup>
            </MapContainer>

            {isSearchingMap && !mapSearchMatches.length && (
              <div className="pointer-events-none absolute inset-x-4 top-4 rounded-xl border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs font-semibold text-amber-800 shadow-sm">
                Nessun condominio trovato per "{mapSearch.trim()}".
              </div>
            )}

            {!isSearchingMap && !validMapData.length && (
              <div className="pointer-events-none absolute inset-x-4 top-4 rounded-xl border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs font-semibold text-amber-800 shadow-sm">
                Nessuna coordinata valida da mostrare.
              </div>
            )}
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel
            title="Dettaglio operativo"
            subtitle="Indicatori rapidi"
            icon={FileText}
            compact
          >
            <div className="grid grid-cols-2 gap-2">
              <DetailItem
                label="Letture aperte"
                value={formatNumber(stats?.details?.letture?.bozze)}
                helper={`${formatNumber(stats?.details?.letture?.chiuse)} chiuse`}
              />
              <DetailItem
                label="Sessioni calcolate"
                value={formatNumber(stats?.details?.fatture?.calcolate)}
                helper={`${formatNumber(stats?.details?.fatture?.confermate)} confermate`}
              />
              <DetailItem
                label="Versioni tariffe"
                value={formatNumber(stats?.details?.tariffe?.total)}
                helper="Casa idrica"
              />
              <DetailItem
                label="Ultimo periodo"
                value={formatPeriod(
                  stats?.details?.latestPeriod?.period_month,
                  stats?.details?.latestPeriod?.period_year
                )}
                helper={stats?.details?.latestPeriod?.condominio_nome || "Nessun dato"}
              />
            </div>
          </Panel>

          <Panel
            title="Fatturazione utenze"
            subtitle="Sessioni fatturate per anno"
            icon={PieChart}
            compact
          >
            <div className="grid grid-cols-1 gap-2">
              {stats?.activeUtenze?.length ? (
                stats.activeUtenze.map((year) => (
                  <ChartMiniCard
                    key={year.anno}
                    year={year.anno}
                    active={year.utenti_attivi}
                    total={Number(stats?.utenze?.total || 0)}
                    latest={latestYear?.anno === year.anno}
                  />
                ))
              ) : (
                <EmptyState>Nessun dato di fatturazione disponibile.</EmptyState>
              )}
            </div>
          </Panel>

          <Panel
            title="Ultime azioni"
            subtitle="Ultime 5 operazioni"
            icon={Activity}
            compact
          >
            <div className="space-y-2">
              {stats?.recentActions?.length ? (
                stats.recentActions.map((action) => (
                  <ActionRow key={action.id} action={action} />
                ))
              ) : (
                <EmptyState>Nessuna attivita recente.</EmptyState>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: "blue" | "emerald" | "slate" | "amber";
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-700",
    amber: "bg-amber-50 text-amber-700",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {title}
          </div>
          <div className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">
            {value}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">{detail}</div>
        </div>
        <div className={`rounded-xl p-2 ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  icon: Icon,
  children,
  compact = false,
  fill = false,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  children: ReactNode;
  compact?: boolean;
  fill?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${
        fill ? "flex h-full min-h-[760px] flex-col" : ""
      }`}
    >
      <div className={`flex items-start gap-2 border-b border-slate-200 ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
        <div className="rounded-lg bg-slate-100 p-1.5 text-slate-600">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className={`${compact ? "p-3" : "p-5"} ${fill ? "flex flex-1 flex-col" : ""}`}>
        {children}
      </div>
    </section>
  );
}

function ChartMiniCard({
  year,
  active,
  total,
  latest,
}: {
  year: number;
  active: number;
  total: number;
  latest: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="h-20 w-20 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <RePieChart>
            <Pie
              data={[
                { name: "Fatturate", value: active },
                { name: "Non fatturate", value: Math.max(0, total - active) },
              ]}
              dataKey="value"
              innerRadius={23}
              outerRadius={35}
              paddingAngle={2}
            >
              <Cell fill={chartColors[0]} />
              <Cell fill={chartColors[1]} />
            </Pie>
            <Tooltip />
          </RePieChart>
        </ResponsiveContainer>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-slate-900">{year}</div>
          {latest && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              Ultimo
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {formatNumber(active)} utenze fatturate
        </div>
      </div>
    </div>
  );
}

function ActionRow({ action }: { action: RecentAction }) {
  const theme = getActionTheme(action.type);
  const Icon = theme.icon;

  return (
    <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-2.5">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${theme.iconBox}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${theme.badge}`}>
            {action.label}
          </span>
          <span className="shrink-0 text-[11px] text-slate-400">
            {formatDateTime(action.date)}
          </span>
        </div>
        <div className="mt-1 truncate text-xs font-semibold text-slate-900">
          {action.title}
        </div>
        {action.detail && (
          <div className="mt-1 truncate text-xs text-slate-500">{action.detail}</div>
        )}
      </div>
    </div>
  );
}

function DetailItem({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
      <div className="mt-0.5 truncate text-xs text-slate-500">{helper}</div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
      {children}
    </div>
  );
}
