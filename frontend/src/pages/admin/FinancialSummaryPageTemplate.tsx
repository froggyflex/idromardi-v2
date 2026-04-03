import { useEffect, useMemo, useState } from "react";
import api from "../../api/client";
import { th } from "date-fns/locale/th";

type SummaryResponse = {
  summary: {
    totaleInsolutoProforme: number;
    totaleInsolutoFatture: number;
    totaleIncassato: number;
  };
};

type RecentRow = {
  id: string;
  type: "PROFORMA" | "FATTURA" | "PAGAMENTO";
  number: string;
  condominio: string;
  customer: string | null;
  source: "MANUALE" | "UPLOAD_PARSER";
  status: string;
  paymentMethod: "BONIFICO" | "CONTANTI" | "CARTA" | null;
  date: string;
  amount: number;
};

type ImportedProformaItem = {
  id: string;
  original_filename: string;
  parse_status: string;
  review_status: string;
  numero: string | null;
  data_documento: string | null;
  importo: number | null;
  uploaded_at: string;
};

type ImportedProformaDetail = {
  id: string;
  original_filename: string;
  stored_filename?: string | null;
  mime_type?: string | null;
  file_path?: string | null;
  parse_status: string;
  uploaded_at: string;
  processed_at?: string | null;
  item_id?: string | null;
  review_status: string;
  parsed_result: any;
  extracted: {
    numero: string | null;
    data_documento: string | null;
    descrizione: string | null;
    importo: number | null;
    payment_method: string | null;
  };
  validation_errors: string[];
};

type RecentResponse = {
  rows: RecentRow[];
};

function euro(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value || 0));
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("it-IT").format(d);
}

function labelType(type: RecentRow["type"]) {
  if (type === "PROFORMA") return "Proforma";
  if (type === "FATTURA") return "Fattura";
  return "Pagamento";
}

function labelSource(source: RecentRow["source"]) {
  return source === "UPLOAD_PARSER" ? "Upload parser" : "Manuale";
}

function labelPaymentMethod(method: RecentRow["paymentMethod"]) {
  if (!method) return "-";
  if (method === "BONIFICO") return "Bonifico";
  if (method === "CONTANTI") return "Contanti";
  return "Carta";
}

const statusClass: Record<string, string> = {
  BOZZA: "bg-slate-100 text-slate-700 ring-slate-200",
  EMESSA: "bg-amber-50 text-amber-700 ring-amber-200",
  COLLEGATA: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  PARZIALMENTE_SALDATA: "bg-sky-50 text-sky-700 ring-sky-200",
  SALDATA: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PARZIALMENTE_PAGATA: "bg-sky-50 text-sky-700 ring-sky-200",
  PAGATA: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  REGISTRATO: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PARZIALMENTE_ALLOCATO: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  ALLOCATO: "bg-lime-50 text-lime-700 ring-lime-200",
  ANNULLATA: "bg-rose-50 text-rose-700 ring-rose-200",
  ANNULLATO: "bg-rose-50 text-rose-700 ring-rose-200",
  STORNATO: "bg-rose-50 text-rose-700 ring-rose-200",
};

export default function FinancialSummaryPageTemplate() {
  const [summary, setSummary] = useState({
    totaleInsolutoProforme: 0,
    totaleInsolutoFatture: 0,
    totaleIncassato: 0,
  });

  const [recentRows, setRecentRows] = useState<RecentRow[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("TUTTI");
  const [statusFilter, setStatusFilter] = useState("TUTTI");

  const [importedDocs, setImportedDocs] = useState<ImportedProformaItem[]>([]);
  const [selectedImportedDoc, setSelectedImportedDoc] = useState<ImportedProformaDetail | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingImportedDocs, setLoadingImportedDocs] = useState(false);
  const [parsingImportId, setParsingImportId] = useState<string | null>(null);
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([]);
  const [isAssociateModalOpen, setIsAssociateModalOpen] = useState(false);

  const [condomini, setCondomini] = useState<any[]>([]);
  const [condominiSearch, setCondominiSearch] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [activeImportTab, setActiveImportTab] = useState<"PROFORMA" | "FATTURA">("PROFORMA");
  const [selectedCondomini, setSelectedCondomini] = useState<{ id: string; indirizzo: string }[]>([]);

  const [loadingCondomini, setLoadingCondomini] = useState(false);

  const [promoting, setPromoting] = useState(false);
  

  
  const summaryCards = [
    {
      key: "proforma",
      eyebrow: "INSOLUTI",
      title: "Totale insoluto PROFORMA",
      amount: euro(summary.totaleInsolutoProforme),
      accent: "from-blue-700 to-blue-600",
      border: "border-blue-500",
      text: "text-blue-700",
      icon: "📄",
    },
    {
      key: "fatture",
      eyebrow: "INSOLUTI",
      title: "Totale insoluto FATTURE",
      amount: euro(summary.totaleInsolutoFatture),
      accent: "from-fuchsia-800 to-purple-700",
      border: "border-fuchsia-500",
      text: "text-fuchsia-700",
      icon: "🧾",
    },
    {
      key: "incassato",
      eyebrow: "INCASSATO",
      title: "Totale INCASSATO",
      amount: euro(summary.totaleIncassato),
      accent: "from-lime-600 to-green-600",
      border: "border-lime-500",
      text: "text-lime-700",
      icon: "€",
    },
  ];

  const quickActions = [
    {
      key: "new-proforma",
      title: "Nuova proforma",
      description: "Inserimento manuale di una proforma singola.",
      badge: "Manuale",
    },
    {
      key: "new-fattura",
      title: "Nuova fattura",
      description: "Inserimento manuale di una fattura singola.",
      badge: "Manuale",
    },
    {
      key: "upload-proforme",
      title: "Carica batch proforme",
      description: "Upload multiplo file per parser proforma.",
      badge: "Batch upload",
    },
    {
      key: "upload-fatture",
      title: "Carica batch fatture",
      description: "Upload multiplo file per parser fatture.",
      badge: "Batch upload",
    },
  ];

  const importAreaConfig = {
    PROFORMA: {
      title: "Area parser proforma",
      description:
        "Carica un PDF, lancialo nel parser e visualizza il risultato estratto prima di decidere cosa fare.",
      uploadTitle: "Upload PDF proforma",
      uploadDescription:
        "Per ora supporta il flusso PDF → parser → revisione risultato.",
      uploadButtonLabel: "Carica PDF proforma",
      parseButtonLabel: "Esegui parser",
      createButtonLabel: "Approva e crea proforma",
      createdButtonLabel: "Proforma già creata",
    },
    FATTURA: {
      title: "Area parser fattura",
      description:
        "Carica una fattura PDF, avvia il parser e verifica i dati estratti prima della registrazione.",
      uploadTitle: "Upload PDF fattura",
      uploadDescription:
        "Flusso PDF → parser → revisione risultato → creazione fattura.",
      uploadButtonLabel: "Carica PDF fattura",
      parseButtonLabel: "Esegui parser",
      createButtonLabel: "Approva e crea fattura",
      createdButtonLabel: "Fattura già creata",
  },
} as const;

const area = importAreaConfig[activeImportTab];
  

  const [importedDocsSearch, setImportedDocsSearch] = useState("");

  const filteredImportedDocs = useMemo(() => {
    const q = importedDocsSearch.trim().toLowerCase();

    if (!q) return importedDocs;

    return importedDocs.filter((doc) => {
      const numero = String(doc.numero || "").toLowerCase();
      const filename = String(doc.original_filename || "").toLowerCase();
      const parseStatus = String(doc.parse_status || "").toLowerCase();
      const reviewStatus = String(doc.review_status || "").toLowerCase();

      return (
        numero.includes(q) ||
        filename.includes(q) ||
        parseStatus.includes(q) ||
        reviewStatus.includes(q)
      );
    });
  }, [importedDocs, importedDocsSearch]);

  const filteredCondomini = useMemo(() => {
  const q = condominiSearch.trim().toLowerCase();
    if (!q) return condomini;

    return condomini.filter((c) =>
      String(c.indirizzo || "").toLowerCase().includes(q)
    );
  }, [condomini, condominiSearch]);

  useEffect(() => {
    void loadDashboard();
    void loadImportedDocuments();
  }, []);

  useEffect(() => {
  if (importedDocs.length > 0 && !selectedImportedDoc) {
    void loadImportedDocumentDetail(importedDocs[0].id);
  }
  }, [importedDocs]);
 
  function getParseStatusClasses(status?: string) {
    switch (status) {
      case "COMPLETATO":
        return "bg-purple-50 text-purple-700 ring-1 ring-purple-200";
      case "COMPLETATO_PROMOSSO":
        return "bg-green-50 text-green-700 ring-1 ring-green-200";
      case "COMPLETATO_CON_ERRORI":
        return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
      case "IN_ELABORAZIONE":
        return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
      default:
        return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
    }
  }

  function getReviewStatusClasses(status?: string) {
    switch (status) {
      case "APPROVATO":
        return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
      case "DA_REVISIONARE":
        return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
      case "SCARTATO":
        return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
      default:
        return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
    }
  }

  async function loadDashboard() {
    setError("");
    await Promise.all([loadSummary(), loadRecentRows()]);
  }

  async function loadCondomini() {
    try {
      setLoadingCondomini(true);
      const { data } = await api.get("/financial-summary/list");
      setCondomini(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore nel caricamento condomini.");
    } finally {
      setLoadingCondomini(false);
    }
  }


  async function promoteImportedProformaWithCondomini(fileId: string) {
    const selectedCondominioIds = selectedCondomini.map((c) => c.id);
    try {

      if (!selectedCondominioIds.length) {
        setError("Seleziona almeno un condominio.");
        return;
      }

      setPromoting(true);
      setError("");

      const { data } = await api.post(`/financial-summary/imported-documents/${fileId}/promote`, {
        condominioIds: selectedCondominioIds,
      });

      console.log("Promote result:", data);

      setIsAssociateModalOpen(false);
      setSelectedCondomini([]);
      setCondominiSearch("");
      setCondomini([]);

      await loadImportedDocuments();
      await loadImportedDocumentDetail(fileId);
      await loadSummary();
      await loadRecentRows();
    } catch (err: any) {
      console.error("Promote error:", err?.response?.data || err);
      setError(err?.response?.data?.error || "Errore durante la creazione delle proforme.");
    } finally {
      setPromoting(false);
    }
  }
  function toggleCondominio(condominio: { id: string; indirizzo: string }) {
    setSelectedCondomini((prev) =>
      prev.some((c) => c.id === condominio.id)
        ? prev.filter((c) => c.id !== condominio.id)
        : [...prev, condominio]
    );
  }
  async function loadSummary() {
    try {
      setLoadingSummary(true);
      const { data } = await api.get<SummaryResponse>("/financial-summary");
      console.log("Riepilogo caricato:", data);
      setSummary({
        totaleInsolutoProforme: Number(data?.summary?.totaleInsolutoProforme || 0),
        totaleInsolutoFatture: Number(data?.summary?.totaleInsolutoFatture || 0),
        totaleIncassato: Number(data?.summary?.totaleIncassato || 0),
      });
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore durante il caricamento del riepilogo.");
    } finally {
      setLoadingSummary(false);
    }
  }
async function loadImportedDocuments() {
  try {
    setLoadingImportedDocs(true);
    const { data } = await api.get("/financial-summary/imported-documents");
    setImportedDocs(Array.isArray(data) ? data : []);
    
  } catch (err: any) {
    setError(err?.response?.data?.error || "Errore caricando i documenti proforma importati.");
  } finally {
    setLoadingImportedDocs(false);
  }
}

async function promoteImportedProforma(id: string) {
  try {
    setError("");

    const { data } = await api.post(`/imported-documents/${id}/promote`);
    console.log("Promote result:", data);

    await loadImportedDocuments();
    await loadImportedDocumentDetail(id);
    await loadSummary();
    await loadRecentRows();
  } catch (err: any) {
    console.error("Promote error:", err?.response?.data || err);
    setError(err?.response?.data?.error || "Errore durante la creazione della proforma.");
  }
}

async function loadImportedDocumentDetail(id: string) {
  
  try {
    const { data } = await api.get(`/financial-summary/imported-documents/${id}`);
 
    setSelectedImportedDoc(data);
    if(data?.parse_status == "COMPLETATO_PROMOSSO") {
      setIsLocked(true);
    } else {
      setIsLocked(false);
    }
    console.log("Dettaglio documento importato:", data.parse_status);  
  } catch (err: any) {
    setError(err?.response?.data?.error || "Errore caricando il dettaglio del documento.");
  }
}
 
async function parseImportedProforma(id: string) {
  try {
    setParsingImportId(id);
    setError("");

    await api.post(`/financial-summary/imported-documents/${id}/parse`);

    await loadImportedDocuments();
    await loadImportedDocumentDetail(id);
  } catch (err: any) {
    setError(err?.response?.data?.error || "Errore parsing proforma.");
  } finally {
    setParsingImportId(null);
  }
}
  async function loadRecentRows() {
    try {
      setLoadingRows(true);
      const { data } = await api.get<RecentResponse>("/financial-summary/recent");
      setRecentRows(Array.isArray(data?.rows) ? data.rows : []);
      console.log("Movimenti recenti caricati:", data);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore durante il caricamento dei movimenti recenti.");
    } finally {
      setLoadingRows(false);
    }
  }

  const filteredRows = useMemo(() => {
    return recentRows.filter((row) => {
      const matchesSearch =
        !search.trim() ||
        [row.number, row.condominio, row.customer || "", labelType(row.type), labelSource(row.source)]
          .join(" ")
          .toLowerCase()
          .includes(search.trim().toLowerCase());

      const matchesType = typeFilter === "TUTTI" || row.type === typeFilter;
      const matchesStatus = statusFilter === "TUTTI" || row.status === statusFilter;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [recentRows, search, typeFilter, statusFilter]);

  function handleQuickAction(actionKey: string) {
    if (actionKey === "new-proforma") {
      console.log("TODO: apri modal nuova proforma");
      return;
    }
    if (actionKey === "new-fattura") {
      console.log("TODO: apri modal nuova fattura");
      return;
    }
    if (actionKey === "upload-proforme") {
      console.log("TODO: apri modal nuova proforma");
      return;
       
    }
    if (actionKey === "upload-fatture") {
      console.log("TODO: apri upload batch fatture");
    }
  }
  async function uploadProformaFiles() {
    if (!selectedUploadFiles.length) {
      setError("Seleziona almeno un file PDF.");
      return;
    }

    try {
      setUploading(true);
      setError("");

      const formData = new FormData();
      selectedUploadFiles.forEach((file) => {
        formData.append("files", file);
      });

      await api.post("/financial-summary/imported-documents/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setSelectedUploadFiles([]);
      await loadImportedDocuments();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore nel caricamento dei file proforma.");
    } finally {
      setUploading(false);
    }
  }





  function parseImportedFattura(id: string) {
    throw new Error("Function not implemented.");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Dashboard proforme · fatture · incassi
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Riepilogo documenti e incassi</h1>
              <p className="max-w-3xl text-sm text-slate-600 sm:text-base">
                Vista unificata per proforme, fatture e pagamenti con staging parser e inserimento manuale.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* <button className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50">
                Esporta riepilogo
              </button>
              <button className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800">
                Configura parser
              </button> */}
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </header>

        <section className="grid gap-5 xl:grid-cols-3">
          {summaryCards.map((card) => (
            <article
              key={card.key}
              className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className={`bg-gradient-to-br ${card.accent} p-6 text-white`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                      {card.eyebrow}
                    </div>
                    <div className="max-w-[14rem] text-3xl leading-none">{card.icon}</div>
                  </div>

                  <button className="rounded-2xl bg-white/20 px-3 py-2 text-sm font-semibold backdrop-blur transition hover:bg-white/30">
                    +
                  </button>
                </div>

                <div className="mt-8 space-y-2">
                  <h2 className="max-w-xs text-2xl font-bold leading-tight">{card.title}</h2>
                  <div className="text-right text-3xl font-bold tracking-tight">
                    {loadingSummary ? "..." : card.amount}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 p-5">
                <button
                  className={`w-full rounded-2xl border ${card.border} bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide ${card.text} transition hover:opacity-85`}
                >
                  Dettagli per condominio
                </button>
              </div>
            </article>
          ))}
        </section>

        {/* <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="xl:col-span-2 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-xl font-bold">Struttura logica iniziale</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Una fattura può aggregare più proforme. Un pagamento può coprire più fatture.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                Base per il dominio
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <div className="rounded-3xl border border-blue-200 bg-blue-50 p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Proforma</div>
                <div className="mt-3 text-lg font-bold text-slate-900">Documento preliminare</div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                  <li>• Caricabile da parser o inseribile manualmente</li>
                  <li>• Collegabile a una sola fattura</li>
                  <li>• Numerazione sicura, mai riutilizzata</li>
                </ul>
              </div>

              <div className="rounded-3xl border border-fuchsia-200 bg-fuchsia-50 p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-700">Fattura</div>
                <div className="mt-3 text-lg font-bold text-slate-900">Documento contabile centrale</div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                  <li>• Può collegarsi a più proforme</li>
                  <li>• Può ricevere più pagamenti</li>
                  <li>• Stato ricalcolato dalle allocazioni</li>
                </ul>
              </div>

              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Pagamento</div>
                <div className="mt-3 text-lg font-bold text-slate-900">Movimento finanziario</div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                  <li>• Metodo reale: bonifico, contanti, carta</li>
                  <li>• Un pagamento può essere allocato su più fatture</li>
                  <li>• Parser sempre con fase di revisione</li>
                </ul>
              </div>
            </div>
          </div>
        </section> */}

        <section className="grid gap-5 xl:grid-cols-1">
          {/* <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xl font-bold">Azioni operative</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Inserimento manuale e upload batch separati per tipo documento.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                Wiring pronto
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {quickActions.map((action) => (
                <button
                  key={action.key}
                  onClick={() => handleQuickAction(action.key)}
                  className="group rounded-3xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:border-slate-300 hover:bg-white hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 ring-1 ring-slate-200">
                      {action.badge}
                    </span>
                    <span className="text-xl transition group-hover:translate-x-1">→</span>
                  </div>
                  <div className="mt-4 text-lg font-bold text-slate-900">{action.title}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{action.description}</p>
                </button>
              ))}
            </div>
          </div> */}
 
          <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold">{area.title}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {area.description}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-1.5">
              {(["PROFORMA", "FATTURA"] as const).map((tab) => {
                const active = activeImportTab === tab;

                return (
                  <button
                    key={tab}
                    onClick={() => setActiveImportTab(tab)}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                        : "text-slate-600 hover:bg-slate-200/70"
                    }`}
                  >
                    {tab === "PROFORMA" ? "Proforme" : "Fatture"}
                  </button>
                );
              })}
            </div>

<div className="mt-5 rounded-3xl border border-dashed border-blue-300 bg-blue-50 p-5">
  <div className="space-y-4">
    <div>
      <div className="text-sm font-semibold text-blue-800">{area.uploadTitle}</div>
      <div className="mt-1 text-sm text-blue-700/80">{area.uploadDescription}</div>
    </div>

    <div className="flex flex-col gap-3">
      <input
        type="file"
        multiple
        accept="application/pdf"
        onChange={(e) => setSelectedUploadFiles(Array.from(e.target.files || []))}
        className="block w-full rounded-2xl border border-blue-200 bg-white px-4 py-3 text-sm text-slate-700"
      />

      <button
        onClick={() => {
          if (activeImportTab === "PROFORMA") {
            uploadProformaFiles();
          } else {
            uploadProformaFiles();
          }
        }}
        disabled={uploading}
        className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {uploading ? "Caricamento..." : area.uploadButtonLabel}
      </button>
    </div>
  </div>
</div>

            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Documenti importati</h3>
                  <p className="text-xs text-slate-500">
                    Seleziona un documento per vedere il dettaglio parserizzato.
                  </p>
                </div>

                <div className="w-full sm:w-80">
                  <input
                    type="text"
                    value={importedDocsSearch}
                    onChange={(e) => setImportedDocsSearch(e.target.value)}
                    placeholder="Cerca per numero, file o stato..."
                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
                  />
                </div>
              </div>

              {loadingImportedDocs ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
                  Caricamento documenti...
                </div>
              ) : filteredImportedDocs.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500">
                  {importedDocs.length === 0
                    ? "Nessun documento importato."
                    : "Nessun documento trovato con questo filtro."}
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-300 bg-slate-100 shadow-sm">
                  <div className="max-h-[520px] overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-200/95 backdrop-blur text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                        <tr className="border-b border-slate-300">
                          <th className="px-4 py-3">Numero</th>
                          <th className="px-4 py-3">File</th>
                          <th className="px-4 py-3">Parse</th>
                          
                          {/* <th className="px-4 py-3">Review</th> */}
                          <th className="px-4 py-3">Importo</th>
                          <th className="px-4 py-3">Data Documento</th>
                          <th className="px-4 py-3">Data Importazione</th>
                        </tr>
                      </thead>

                      <tbody>
                        {filteredImportedDocs.map((doc, index) => {
                          const isSelected = selectedImportedDoc?.id === doc.id;

                          function loadImportedFatturaDetail(id: string) {
                            throw new Error("Function not implemented.");
                          }
 
                          return (
                            <tr
                              key={doc.id}
                              onClick={() => {
                                    if (activeImportTab === "PROFORMA") {
                                    loadImportedDocumentDetail(doc.id);
                                  } else {
                                    loadImportedFatturaDetail(doc.id);
                                  }
                              }}
                              className={[
                                "cursor-pointer border-b border-slate-200 transition-all duration-150",
                                isSelected
                                  ? "bg-blue-100 shadow-[inset_4px_0_0_0_rgb(37,99,235)]"
                                  : index % 2 === 0
                                  ? "bg-white hover:bg-slate-100"
                                  : "bg-slate-50 hover:bg-slate-100",
                              ].join(" ")}
                            >
                              <td className="px-4 py-3 align-middle">
                                <div
                                  className={`font-semibold ${
                                    isSelected ? "text-blue-900" : "text-slate-800"
                                  }`}
                                >
                                  {doc.numero || "-"}
                                </div>
                              </td>

                              <td className="px-4 py-3 align-middle">
                                <div
                                  className={`max-w-[280px] truncate ${
                                    isSelected ? "text-slate-800" : "text-slate-600"
                                  }`}
                                >
                                  {doc.original_filename || "-"}
                                </div>
                              </td>

                              <td className="px-4 py-3 align-middle">
                                <span
                                  className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getParseStatusClasses(
                                    doc.parse_status
                                  )}`}
                                >
                                  {doc.parse_status || "-"}
                                </span>
                              </td>

                              {/* <td className="px-4 py-3 align-middle">
                                <span
                                  className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getReviewStatusClasses(
                                    doc.review_status
                                  )}`}
                                >
                                  {doc.review_status || "-"}
                                </span>
                              </td> */}
                              <td className="px-4 py-3 align-middle">
                                <div className="text-sm text-slate-500">
                                  {doc.importo !== null ? doc.importo.toFixed(2) + " €" : "-"}
                                </div>
                              </td>
                              <td className="px-4 py-3 align-middle">
                                <div className="text-sm text-slate-500">
                                  {doc.data_documento || "-"}
                                </div>
                              </td>
                              <td className="px-4 py-3 align-middle">
                                <div className="text-sm text-slate-500">
                                  {doc.uploaded_at || "-"}
                                </div>
                              </td>

                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
 

              <div className="rounded-3xl border border-slate-200 bg-white p-4">
                {!selectedImportedDoc ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    Seleziona un documento per vedere il dettaglio e avviare il parser.
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="text-lg font-bold text-slate-900">
                          {selectedImportedDoc.original_filename}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          Stato parse: {selectedImportedDoc.parse_status} · Revisione: {selectedImportedDoc.review_status}
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          if (activeImportTab === "PROFORMA") {
                            parseImportedProforma(selectedImportedDoc.id);
                          } else {
                            parseImportedFattura(selectedImportedDoc.id);
                          }
                        }}
                        disabled={parsingImportId === selectedImportedDoc.id}
                        className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {parsingImportId === selectedImportedDoc.id ? "Parsing..." : "Esegui parser"}
                      </button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Campi estratti
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <div><span className="font-semibold">Numero:</span> {selectedImportedDoc.extracted?.numero || "-"}</div>
                          <div><span className="font-semibold">Data:</span> {selectedImportedDoc.extracted?.data_documento || "-"}</div>
                          <div><span className="font-semibold">Descrizione:</span> {selectedImportedDoc.extracted?.descrizione || "-"}</div>
                          <div><span className="font-semibold">Importo:</span> {selectedImportedDoc.extracted?.importo != null ? euro(selectedImportedDoc.extracted.importo) : "-"}</div>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Validazione
                        </div>
                        <div className="mt-3">
                          {selectedImportedDoc.validation_errors?.length ? (
                            <ul className="space-y-2 text-sm text-rose-700">
                              {selectedImportedDoc.validation_errors.map((err, idx) => (
                                <li key={`${err}-${idx}`}>• {err}</li>
                              ))}
                            </ul>
                          ) : (
                            <div className="text-sm text-emerald-700">Nessun errore bloccante rilevato.</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Risultato parser JSON
                      </div>
                      <pre className="mt-3 max-h-[360px] overflow-auto rounded-2xl bg-slate-900 p-4 text-xs text-slate-100">
          {JSON.stringify(selectedImportedDoc.parsed_result, null, 2)}
                      </pre>
                    </div>

                    <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => {
                        if (activeImportTab === "PROFORMA") {
                          setSelectedCondomini([]);
                          setCondominiSearch("");
                          setIsAssociateModalOpen(true);
                          void loadCondomini();
                        } else {
                          setSelectedCondomini([]);
                          setCondominiSearch("");
                          setIsAssociateModalOpen(true); //TODO: modal specifico per fattura con selezione fattura da associare
                          void loadCondomini();
                        }
                      }}
                      className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"
                      disabled={isLocked}
                    >
                       {isLocked ? "Proforma già creato" : "Approva e crea proforma"}
                    </button>
                      {/* <button className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                        Rifiuta
                      </button> */}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-xl font-bold">Movimenti recenti</h3>
              <p className="mt-1 text-sm text-slate-500">
                Lista unificata dei documenti e movimenti più recenti.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca numero, condominio, cliente..."
                className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none ring-0 placeholder:text-slate-400 focus:border-slate-400"
              />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
              >
                <option value="TUTTI">Tutti i tipi</option>
                <option value="PROFORMA">Proforma</option>
                <option value="FATTURA">Fattura</option>
                <option value="PAGAMENTO">Pagamento</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
              >
                <option value="TUTTI">Tutti gli stati</option>
                <option value="BOZZA">Bozza</option>
                <option value="EMESSA">Emessa</option>
                <option value="COLLEGATA">Collegata</option>
                <option value="PARZIALMENTE_PAGATA">Parzialmente pagata</option>
                <option value="PAGATA">Pagata</option>
                <option value="REGISTRATO">Registrato</option>
                <option value="ALLOCATO">Allocato</option>
                <option value="ANNULLATA">Annullata</option>
                <option value="ANNULLATO">Annullato</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-6 py-4">Tipo</th>
                  <th className="px-6 py-4">Numero</th>
                  <th className="px-6 py-4">Condominio</th>
                  <th className="px-6 py-4">Cliente</th>
                  <th className="px-6 py-4">Origine</th>
                  <th className="px-6 py-4">Metodo</th>
                  <th className="px-6 py-4">Stato</th>
                  <th className="px-6 py-4">Data</th>
                  <th className="px-6 py-4 text-right">Importo</th>
                </tr>
              </thead>
              <tbody>
                {loadingRows ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center text-slate-500">
                      Caricamento movimenti...
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center text-slate-500">
                      Nessun movimento trovato.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-6 py-4 font-semibold text-slate-800">{labelType(row.type)}</td>
                      <td className="px-6 py-4 text-slate-700">{row.number}</td>
                      <td className="px-6 py-4 text-slate-700">{row.condominio}</td>
                      <td className="px-6 py-4 text-slate-700">{row.customer || "-"}</td>
                      <td className="px-6 py-4 text-slate-500">{labelSource(row.source)}</td>
                      <td className="px-6 py-4 text-slate-500">{labelPaymentMethod(row.paymentMethod)}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                            statusClass[row.status] || "bg-slate-100 text-slate-700 ring-slate-200"
                          }`}
                        >
                          {row.status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500">{formatDate(row.date)}</td>
                      <td className="px-6 py-4 text-right font-semibold text-slate-900">
                        {euro(row.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {isAssociateModalOpen && selectedImportedDoc ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
              <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl">
                <div className="border-b border-slate-200 px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Associa proforma ai condomini</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Seleziona uno o più condomini. Verrà creata una riga in proformas per ciascun condominio selezionato.
                      </p>
                    </div>
                    <button
                      onClick={() => setIsAssociateModalOpen(false)}
                      className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600"
                    >
                      Chiudi
                    </button>
                  </div>
                </div>

                <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1fr]">
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Documento da approvare
                      </div>
                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        <div><span className="font-semibold">Numero:</span> {selectedImportedDoc.extracted?.numero || "-"}</div>
                        <div><span className="font-semibold">Data:</span> {selectedImportedDoc.extracted?.data_documento || "-"}</div>
                        <div><span className="font-semibold">Descrizione:</span> {selectedImportedDoc.extracted?.descrizione || "-"}</div>
                        <div><span className="font-semibold">Importo:</span> {selectedImportedDoc.extracted?.importo != null ? euro(selectedImportedDoc.extracted.importo) : "-"}</div>
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Cerca condominio
                      </label>
                      <input
                        value={condominiSearch}
                        onChange={(e) => setCondominiSearch(e.target.value)}
                        placeholder="Scrivi indirizzo o riferimento..."
                        className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
                      />
                    </div>

                    <div className="max-h-72 space-y-2 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3  ">
                      {loadingCondomini ? (
                        <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500">
                          Caricamento condomini...
                        </div>
                      ) : filteredCondomini.length === 0 ? (
                        <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500">
                          Nessun condominio trovato.
                        </div>
                      ) : (
                        filteredCondomini.map((c) => {
                          const isSelected = selectedCondomini.some((x) => x.id === c.id);

                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => toggleCondominio(c)}
                              className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                                isSelected
                                  ? "border-emerald-300 bg-emerald-50"
                                  : "border-slate-200 bg-white hover:border-slate-300"
                              }`}
                            >
                              <div className="text-sm font-semibold text-slate-800">
                                {c.indirizzo}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Condomini selezionati
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedCondomini.length === 0 ? (
                          <div className="text-sm text-slate-500">Nessun condominio selezionato.</div>
                        ) : (
                          selectedCondomini.map((c) => (
                            <span
                              key={c.id}
                              className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-2 text-sm font-medium text-emerald-800"
                            >
                              {c.indirizzo}
                              <button
                                type="button"
                                onClick={() => toggleCondominio(c)}
                                className="text-emerald-700"
                              >
                                ×
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-sm text-slate-600">
                        Verranno create <span className="font-semibold text-slate-900">{selectedCondomini.length}</span> proforme.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
                  <button
                    onClick={() => setIsAssociateModalOpen(false)}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                  >
                    Annulla
                  </button>
                  <button
                    onClick={() => promoteImportedProformaWithCondomini(selectedImportedDoc.id)}
                    disabled={promoting || selectedCondomini.length === 0}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {promoting ? "Creazione..." : "Conferma e crea proforme"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}