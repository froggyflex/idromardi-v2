import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  Check,
  Clipboard,
  Clock3,
  FileText,
  Gauge,
  History,
  Loader2,
  ReceiptText,
  Search,
  UsersRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import api from "../api/client";

type SearchScope = "all" | "condomini" | "utenze" | "periodi" | "fatture" | "documenti";
type ResultType = "condominio" | "utenza" | "periodo" | "fattura" | "documento";

type SearchItem = {
  type: ResultType;
  id: string;
  source?: "generated" | "imported";
  sourceId?: string;
  condominioId?: string | null;
  billingSessionId?: string | null;
  title: string;
  subtitle?: string | null;
  status?: string | null;
  code?: string | null;
  condominioCode?: string | null;
  administrator?: string | null;
  activeUsers?: number;
  nuae?: string | null;
  userNumber?: string | null;
  meterNumber?: string | null;
  apartment?: string | null;
  staircase?: string | null;
  block?: string | null;
  inverseMeter?: boolean;
  previousPeriod?: string | null;
  currentPeriod?: string | null;
  tariffCode?: string | null;
  amount?: number | null;
  invoiceNumber?: string | null;
  progressiveNumber?: string | null;
  description?: string | null;
  documentDate?: string | null;
  documentType?: string | null;
  fileSize?: number | null;
  provider?: string | null;
  supplyCode?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type SearchResponse = {
  query: string;
  scope: SearchScope;
  groups: Partial<Record<Exclude<SearchScope, "all">, SearchItem[]>>;
  hasMore: Partial<Record<Exclude<SearchScope, "all">, boolean>>;
  total: number;
};

type ScopeConfig = {
  key: SearchScope;
  label: string;
  singular: string;
  icon: LucideIcon;
};

const SCOPE_CONFIG: ScopeConfig[] = [
  { key: "all", label: "Tutto", singular: "Risultato", icon: Search },
  { key: "condomini", label: "Condomini", singular: "Condominio", icon: Building2 },
  { key: "utenze", label: "Utenze e contatori", singular: "Utenza", icon: UsersRound },
  { key: "periodi", label: "Periodi", singular: "Periodo", icon: Gauge },
  { key: "fatture", label: "Fatture", singular: "Fattura", icon: ReceiptText },
  { key: "documenti", label: "Documenti", singular: "Documento", icon: FileText },
];

const RESULT_CONFIG: Record<ResultType, { label: string; icon: LucideIcon; tone: string }> = {
  condominio: { label: "Condominio", icon: Building2, tone: "bg-blue-50 text-blue-700" },
  utenza: { label: "Utenza", icon: UsersRound, tone: "bg-cyan-50 text-cyan-700" },
  periodo: { label: "Periodo", icon: Gauge, tone: "bg-amber-50 text-amber-700" },
  fattura: { label: "Fattura", icon: ReceiptText, tone: "bg-emerald-50 text-emerald-700" },
  documento: { label: "Documento", icon: FileText, tone: "bg-slate-100 text-slate-700" },
};

const GROUP_ORDER: Array<Exclude<SearchScope, "all">> = [
  "condomini",
  "utenze",
  "periodi",
  "fatture",
  "documenti",
];

const RECENT_SEARCHES_KEY = "idromardi_global_search_recent";

function readRecentSearches() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

function formatMoney(value?: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed);
}

function formatFileSize(value?: number | null) {
  if (value == null || value < 0) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB`;
}

function statusTone(status?: string | null) {
  const normalized = String(status || "").toUpperCase();
  if (["ATTIVO", "ATTIVA", "CALCOLATA", "EMESSA", "PAGATA", "COMPLETATO"].includes(normalized)) {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }
  if (["BOZZA", "IN_ELABORAZIONE", "PARZIALMENTE_PAGATA"].includes(normalized)) {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }
  if (["ANNULLATA", "CHIUSA", "ERRORE"].includes(normalized)) {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function itemDetails(item: SearchItem): Array<[string, ReactNode]> {
  const common: Array<[string, ReactNode | null]> = [];
  if (item.type === "condominio") {
    common.push(
      ["Codice", item.code || "-"],
      ["Utenze attive", item.activeUsers ?? "-"],
      ["Amministratore", item.administrator || "-"],
      ["NUAE", item.nuae || "-"]
    );
  }
  if (item.type === "utenza") {
    common.push(
      ["ID utenza", item.userNumber || "-"],
      ["Matricola", item.meterNumber || "-"],
      ["Posizione", [item.block && `Is. ${item.block}`, item.staircase && `Scala ${item.staircase}`, item.apartment && `Int. ${item.apartment}`].filter(Boolean).join(" · ") || "-"],
      ["Contatore", item.inverseMeter ? "Inverso" : "Standard"]
    );
  }
  if (item.type === "periodo") {
    common.push(
      ["Periodo precedente", item.previousPeriod || "-"],
      ["Periodo attuale", item.currentPeriod || "-"],
      ["Tariffa", item.tariffCode || "-"],
      ["Totale", formatMoney(item.amount) || "-"]
    );
  }
  if (item.type === "fattura") {
    common.push(
      ["Numero", item.invoiceNumber || item.progressiveNumber || "-"],
      ["Data documento", formatDate(item.documentDate) || "-"],
      ["Importo", formatMoney(item.amount) || "-"],
      ["Descrizione", item.description || "-"]
    );
  }
  if (item.type === "documento") {
    common.push(
      ["Origine", item.source === "generated" ? "Generato dalla piattaforma" : "Importato"],
      ["Tipo", item.documentType || "Documento"],
      ["Data", formatDate(item.createdAt) || "-"],
      ["Dimensione", formatFileSize(item.fileSize) || "-"]
    );
  }
  return common.filter((entry): entry is [string, ReactNode] => entry[1] != null);
}

export default function GlobalSearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialScope = searchParams.get("scope") as SearchScope;
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [scope, setScope] = useState<SearchScope>(
    SCOPE_CONFIG.some((item) => item.key === initialScope) ? initialScope : "all"
  );
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches);
  const [copiedValue, setCopiedValue] = useState("");
  const [openingDocumentId, setOpeningDocumentId] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const normalizedQuery = query.trim();
    const timer = window.setTimeout(async () => {
      const params: Record<string, string> = {};
      if (normalizedQuery) params.q = normalizedQuery;
      if (scope !== "all") params.scope = scope;
      setSearchParams(params, { replace: true });

      if (!normalizedQuery) {
        setResponse(null);
        setError("");
        setLoading(false);
        return;
      }

      const currentRequest = ++requestId.current;
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get<SearchResponse>("/search", {
          params: { q: normalizedQuery, scope, limit: scope === "all" ? 6 : 30 },
        });
        if (requestId.current === currentRequest) setResponse(data);
      } catch (requestError: any) {
        if (requestId.current === currentRequest) {
          setError(requestError?.response?.data?.error || "Ricerca non disponibile. Riprova tra poco.");
          setResponse(null);
        }
      } finally {
        if (requestId.current === currentRequest) setLoading(false);
      }
    }, 280);

    return () => window.clearTimeout(timer);
  }, [query, scope, setSearchParams]);

  const flatResults = useMemo(
    () => GROUP_ORDER.flatMap((key) => response?.groups?.[key] || []),
    [response]
  );

  useEffect(() => {
    if (!flatResults.length) {
      setSelectedKey("");
      return;
    }
    const stillPresent = flatResults.some((item) => `${item.type}:${item.id}` === selectedKey);
    if (!stillPresent) setSelectedKey(`${flatResults[0].type}:${flatResults[0].id}`);
  }, [flatResults, selectedKey]);

  const selectedItem = flatResults.find((item) => `${item.type}:${item.id}` === selectedKey) || null;

  function saveRecentSearch(value: string) {
    const normalized = value.trim();
    if (!normalized) return;
    const next = [normalized, ...recentSearches.filter((item) => item.toLocaleLowerCase("it-IT") !== normalized.toLocaleLowerCase("it-IT"))].slice(0, 6);
    setRecentSearches(next);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    saveRecentSearch(query);
  }

  function primaryPath(item: SearchItem) {
    if (item.type === "condominio") return `/condomini/${item.condominioId}`;
    if (item.type === "utenza") return `/condomini/${item.condominioId}/utenze?utenza=${encodeURIComponent(item.id)}`;
    if (item.type === "periodo") return `/condomini/${item.condominioId}/fatture/${item.id}`;
    if (item.type === "fattura") return `/admin/contabilita?fattura=${encodeURIComponent(item.id)}`;
    if (item.billingSessionId && item.condominioId) return `/condomini/${item.condominioId}/fatture/${item.billingSessionId}`;
    if (item.condominioId) return `/condomini/${item.condominioId}/fatture`;
    return "/admin/contabilita";
  }

  async function openItem(item: SearchItem) {
    saveRecentSearch(query);
    if (item.type === "documento" && item.source === "generated") {
      setOpeningDocumentId(item.id);
      try {
        const result = await api.get(`/fatture/generated-documents/${item.id}/view`, {
          responseType: "blob",
        });
        const url = URL.createObjectURL(result.data);
        window.open(url, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (documentError: any) {
        setError(documentError?.response?.data?.error || "Impossibile aprire il documento.");
      } finally {
        setOpeningDocumentId("");
      }
      return;
    }
    navigate(primaryPath(item));
  }

  async function copy(text?: string | null) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedValue(text);
    window.setTimeout(() => setCopiedValue(""), 1600);
  }

  function copyCandidate(item: SearchItem) {
    return item.meterNumber || item.invoiceNumber || item.code || item.progressiveNumber || null;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 pb-8">
      <header className="border-b border-slate-200 pb-4">
        <div className="flex flex-col gap-1 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-blue-600">Archivio operativo</div>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">Ricerca globale</h2>
            <p className="mt-1 text-sm text-slate-500">
              Trova condomini, utenti, contatori, periodi, fatture e documenti da un unico punto.
            </p>
          </div>
          {response && query.trim() ? (
            <div className="text-sm text-slate-500">
              <span className="font-semibold text-slate-900">{response.total}</span> risultati visualizzati
            </div>
          ) : null}
        </div>
      </header>

      <section aria-label="Ricerca" className="border-b border-slate-200 pb-4">
        <form onSubmit={submitSearch} className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome, indirizzo, matricola, numero fattura, periodo o documento..."
            aria-label="Cerca in tutta la piattaforma"
            className="h-14 w-full rounded-lg border border-slate-300 bg-white pl-12 pr-24 text-base text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              title="Cancella ricerca"
              aria-label="Cancella ricerca"
              className="absolute right-12 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="submit"
            title="Avvia ricerca"
            aria-label="Avvia ricerca"
            className="absolute right-2 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md bg-blue-600 text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
          </button>
        </form>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Tipi di risultato">
          {SCOPE_CONFIG.map((item) => {
            const Icon = item.icon;
            const count = item.key === "all"
              ? response?.total
              : response?.groups?.[item.key as Exclude<SearchScope, "all">]?.length;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={scope === item.key}
                onClick={() => setScope(item.key)}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition ${
                  scope === item.key
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
                {count != null && query.trim() ? (
                  <span className={scope === item.key ? "text-blue-100" : "text-slate-400"}>{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} className="font-semibold hover:underline">Chiudi</button>
        </div>
      ) : null}

      {!query.trim() ? (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Search className="h-5 w-5" />
            </div>
            <h3 className="mt-4 font-semibold text-slate-900">Cerca in tutta la gestione</h3>
            <p className="mt-1 max-w-lg text-sm leading-6 text-slate-500">
              Puoi usare anche dati parziali: cognome, matricola contatore, indirizzo, codice condominio o numero fattura.
            </p>
          </div>
          <RecentSearches values={recentSearches} onSelect={setQuery} onClear={() => {
            setRecentSearches([]);
            localStorage.removeItem(RECENT_SEARCHES_KEY);
          }} />
        </section>
      ) : loading && !response ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-2">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-lg bg-slate-200/70" />)}
          </div>
          <div className="h-72 animate-pulse rounded-lg bg-slate-200/70" />
        </div>
      ) : response?.total === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-6 text-center">
          <Search className="h-7 w-7 text-slate-400" />
          <h3 className="mt-3 font-semibold text-slate-900">Nessun risultato per “{response.query}”</h3>
          <p className="mt-1 text-sm text-slate-500">Prova con una parte del nome, della matricola o del numero documento.</p>
        </div>
      ) : response ? (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            {GROUP_ORDER.map((groupKey) => {
              const items = response.groups[groupKey] || [];
              if (!items.length) return null;
              const config = SCOPE_CONFIG.find((item) => item.key === groupKey)!;
              const GroupIcon = config.icon;
              return (
                <section key={groupKey} aria-labelledby={`search-group-${groupKey}`}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 id={`search-group-${groupKey}`} className="flex items-center gap-2 text-sm font-bold text-slate-800">
                      <GroupIcon className="h-4 w-4 text-slate-500" aria-hidden="true" />
                      {config.label}
                      <span className="font-normal text-slate-400">{items.length}</span>
                    </h3>
                    {scope === "all" && response.hasMore[groupKey] ? (
                      <button type="button" onClick={() => setScope(groupKey)} className="text-xs font-semibold text-blue-700 hover:underline">
                        Vedi altri risultati
                      </button>
                    ) : null}
                  </div>
                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                    {items.map((item) => {
                      const itemKey = `${item.type}:${item.id}`;
                      const config = RESULT_CONFIG[item.type];
                      const Icon = config.icon;
                      const selected = selectedKey === itemKey;
                      const copied = copiedValue && copiedValue === copyCandidate(item);
                      return (
                        <div key={itemKey} className={`flex items-stretch border-b border-slate-100 last:border-b-0 ${selected ? "bg-blue-50/70" : "hover:bg-slate-50"}`}>
                          <button
                            type="button"
                            onClick={() => setSelectedKey(itemKey)}
                            onDoubleClick={() => void openItem(item)}
                            className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                          >
                            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${config.tone}`}>
                              <Icon className="h-5 w-5" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-semibold text-slate-900">{item.title}</span>
                                {item.inverseMeter ? <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-700 ring-1 ring-inset ring-cyan-200">Inverso</span> : null}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-slate-500">{item.subtitle || config.label}</span>
                              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                {item.meterNumber ? <span>Matricola {item.meterNumber}</span> : null}
                                {item.currentPeriod ? <span>Periodo {item.currentPeriod}</span> : null}
                                {item.amount != null ? <span>{formatMoney(item.amount)}</span> : null}
                                {item.documentDate ? <span>{formatDate(item.documentDate)}</span> : null}
                              </span>
                            </span>
                            {item.status ? <span className={`hidden shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ring-1 ring-inset sm:inline-flex ${statusTone(item.status)}`}>{String(item.status).replaceAll("_", " ")}</span> : null}
                          </button>
                          <div className="flex shrink-0 items-center gap-1 border-l border-slate-100 px-2">
                            {copyCandidate(item) ? (
                              <button type="button" onClick={() => void copy(copyCandidate(item))} title={`Copia ${copyCandidate(item)}`} aria-label={`Copia ${copyCandidate(item)}`} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 transition hover:bg-white hover:text-slate-700">
                                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Clipboard className="h-4 w-4" />}
                              </button>
                            ) : null}
                            <button type="button" onClick={() => void openItem(item)} title="Apri risultato" aria-label={`Apri ${item.title}`} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-blue-600 transition hover:bg-white hover:text-blue-800">
                              {openingDocumentId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

          <aside className="sticky top-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            {selectedItem ? (
              <>
                <div className="border-b border-slate-200 px-5 py-4">
                  <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{RESULT_CONFIG[selectedItem.type].label}</div>
                  <h3 className="mt-1 text-lg font-bold text-slate-900">{selectedItem.title}</h3>
                  <p className="mt-1 text-sm leading-5 text-slate-500">{selectedItem.subtitle}</p>
                  {selectedItem.status ? <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${statusTone(selectedItem.status)}`}>{String(selectedItem.status).replaceAll("_", " ")}</span> : null}
                </div>
                <dl className="divide-y divide-slate-100 px-5">
                  {itemDetails(selectedItem).map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3 text-sm">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="min-w-0 break-words text-right font-medium text-slate-800">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="space-y-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
                  <button type="button" onClick={() => void openItem(selectedItem)} disabled={openingDocumentId === selectedItem.id} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60">
                    {openingDocumentId === selectedItem.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    {selectedItem.type === "documento" && selectedItem.source === "generated" ? "Visualizza PDF" : "Apri nella gestione"}
                  </button>
                  {selectedItem.condominioId && selectedItem.type !== "condominio" ? (
                    <button type="button" onClick={() => navigate(`/condomini/${selectedItem.condominioId}`)} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
                      <Building2 className="h-4 w-4" /> Apri condominio
                    </button>
                  ) : null}
                  {selectedItem.condominioId && selectedItem.type === "condominio" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => navigate(`/condomini/${selectedItem.condominioId}/letture`)} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"><Gauge className="h-4 w-4" /> Letture</button>
                      <button type="button" onClick={() => navigate(`/condomini/${selectedItem.condominioId}/fatture`)} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"><ReceiptText className="h-4 w-4" /> Fatturazione</button>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="p-6 text-center text-sm text-slate-500">Seleziona un risultato per vedere dettagli e azioni.</div>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function RecentSearches({ values, onSelect, onClear }: { values: string[]; onSelect: (value: string) => void; onClear: () => void }) {
  return (
    <aside className="border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800"><History className="h-4 w-4 text-slate-500" /> Ricerche recenti</h3>
        {values.length ? <button type="button" onClick={onClear} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancella</button> : null}
      </div>
      {values.length ? (
        <div className="mt-3 divide-y divide-slate-100">
          {values.map((value) => (
            <button key={value} type="button" onClick={() => onSelect(value)} className="flex w-full items-center gap-3 py-3 text-left text-sm text-slate-700 transition hover:text-blue-700">
              <Clock3 className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{value}</span>
              <ArrowRight className="h-4 w-4 text-slate-300" />
            </button>
          ))}
        </div>
      ) : <p className="mt-3 text-sm leading-6 text-slate-500">Le ricerche confermate compariranno qui per essere riutilizzate rapidamente.</p>}
    </aside>
  );
}
