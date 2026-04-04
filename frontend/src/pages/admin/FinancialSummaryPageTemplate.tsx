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
  descrizione: string | null;
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


type ProformaRow = {
  id: string;
  condominio_id: string | null;
  fattura_id: string | null;
  numero_progressivo: number;
  numero: string;
  descrizione: string | null;
  data_documento: string;
  importo: number;
  stato: string;
  source_import_file_id: string | null;
  condominio: string;
  fattura_numero: string | null;
};

type FatturaRow = {
  id: string;
  numero: string;
  descrizione: string | null;
  data_documento: string;
  importo: number;
  stato: string;
  condominio: string;
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
  const [annullingId, setAnnullingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeDetailSection, setActiveDetailSection] = useState<"PROFORMA" | "FATTURA" | "PAGAMENTO" | null>(null);
  
 

  const [proformasRows, setProformasRows] = useState<ProformaRow[]>([]);
  const [fattureRows, setFattureRows] = useState<FatturaRow[]>([]);
  const [loadingProformas, setLoadingProformas] = useState(false);
  const [loadingFatture, setLoadingFatture] = useState(false);

  const [proformaSearch, setProformaSearch] = useState("");
  const [proformaStatusFilter, setProformaStatusFilter] = useState("TUTTI");

  const [linkingProforma, setLinkingProforma] = useState<ProformaRow | null>(null);
  const [selectedFatturaId, setSelectedFatturaId] = useState("");
  const [linking, setLinking] = useState(false);

  const selectedCondominioIds = selectedCondomini.map((c) => c.id);
  
  
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
 

    useEffect(() => {
    if (activeDetailSection === "PROFORMA") {
      void loadProformasRows();
      void loadFattureRows();
    }
    if (activeDetailSection === "FATTURA") {
      void loadFattureRows();
    }
  }, [activeDetailSection]);

    async function loadProformasRows() {
    try {
      setLoadingProformas(true);
      const { data } = await api.get("/financial-summary/proformas");
      setProformasRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore nel caricamento proforme.");
    } finally {
      setLoadingProformas(false);
    }
  }

  async function loadFattureRows() {
    try {
      setLoadingFatture(true);
      const { data } = await api.get("/financial-summary/fatture");
      setFattureRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore nel caricamento fatture.");
    } finally {
      setLoadingFatture(false);
    }
  }
  async function collegaProformaAFattura() {
    if (!linkingProforma?.id || !selectedFatturaId) {
      setError("Seleziona una fattura.");
      return;
    }

    try {
      setLinking(true);
      setError("");

      await api.post(`/financial-summary/proformas/${linkingProforma.id}/collega-fattura`, {
        fatturaId: selectedFatturaId,
      });

      setLinkingProforma(null);
      setSelectedFatturaId("");

      await loadProformasRows();
      await loadFattureRows();
      await loadRecentRows();
      await loadSummary();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore durante il collegamento della proforma.");
    } finally {
      setLinking(false);
    }
  }

  
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

  async function annullaProforma(id: string) {
    const reason = window.prompt("Motivo annullamento proforma:");
    if (reason === null) return;

    try {
      setAnnullingId(id);
      setError("");

      await api.post(`/financial-summary/${id}/annulla`, { reason });

      await loadSummary();
      await loadRecentRows();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore durante l'annullamento.");
    } finally {
      setAnnullingId(null);
    }
  }

  async function deleteProforma(id: string) {
    const ok = window.confirm(
      "Eliminare definitivamente questa proforma? Consentito solo per righe sicure."
    );
    if (!ok) return;

    try {
      setDeletingId(id);
      setError("");

      await api.delete(`/financial-summary/${id}`);

      await loadSummary();
      await loadRecentRows();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore durante l'eliminazione.");
    } finally {
      setDeletingId(null);
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

      if (selectedImportedDoc) {
        if (activeImportTab === "PROFORMA") {
          parseImportedProforma(selectedImportedDoc.id);
        } else {
          parseImportedFattura(selectedImportedDoc.id);
        }
      }

    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore nel caricamento dei file proforma.");
    } finally {
      setUploading(false);
    }
  }
 
  function parseImportedFattura(id: string) {
    throw new Error("Function not implemented.");
  }
 
  const filteredProformasRows = useMemo(() => {
    return proformasRows.filter((row) => {
      const q = proformaSearch.trim().toLowerCase();

      const matchesSearch =
        !q ||
        [
          row.numero,
          row.condominio || "",
          row.descrizione || "",
          row.fattura_numero || "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      const matchesStatus =
        proformaStatusFilter === "TUTTI" || row.stato === proformaStatusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [proformasRows, proformaSearch, proformaStatusFilter]);


  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 quick-sand">
      <div className="mx-auto max-w-8xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Dashboard proforme · fatture · incassi
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Riepilogo documenti e incassi</h1>
       
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

        <div className="space-y-6 bg-gradient-to-b from-slate-100 via-slate-50 to-slate-100/80 p-1 rounded-[36px]">
          {/* Summary cards */}
          <section className="grid gap-4 xl:grid-cols-3">
            {summaryCards.map((card) => (
              <article
                key={card.key}
                className="group relative overflow-hidden rounded-[30px] border border-slate-300/70 bg-gradient-to-b from-white via-slate-50 to-slate-100/80 shadow-[0_12px_30px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
              >
                <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${card.accent}`} />

                <div className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {card.eyebrow}
                      </div>

                      <h2 className="mt-3 text-lg font-bold tracking-tight text-slate-900">
                        {card.title}
                      </h2>
                    </div>

                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border border-slate-300/70 bg-slate-200/80 text-2xl text-slate-700 shadow-inner">
                      {card.icon}
                    </div>
                  </div>

                  <div className="mt-7 flex items-end justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                        Totale
                      </div>
                      <div className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
                        {loadingSummary ? "..." : card.amount}
                      </div>
                    </div>

                    <button
                      className={`inline-flex items-center rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${card.border} ${card.text} bg-white/90 shadow-sm hover:bg-white`}
                        onClick={() =>
                          setActiveDetailSection(
                            card.key === "proforma"
                              ? "PROFORMA"
                              : card.key === "fatture"
                              ? "FATTURA"
                              : "PAGAMENTO"
                          )
                        }
                    >
                      Dettagli
                    </button>
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-slate-100/80 px-5 py-3 sm:px-6">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Panoramica aggiornata</span>
                    <span className="font-semibold text-slate-700">Dashboard</span>
                  </div>
                </div>
              </article>
            ))}
          </section>

          {activeDetailSection === "PROFORMA" ? (
            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-xl font-bold">Dettaglio proforme</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Elenco completo delle proforme con possibilità di collegarle a una fattura.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    value={proformaSearch}
                    onChange={(e) => setProformaSearch(e.target.value)}
                    placeholder="Cerca numero, condominio, descrizione..."
                    className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
                  />
                  <select
                    value={proformaStatusFilter}
                    onChange={(e) => setProformaStatusFilter(e.target.value)}
                    className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="TUTTI">Tutti gli stati</option>
                    <option value="BOZZA">Bozza</option>
                    <option value="EMESSA">Emessa</option>
                    <option value="COLLEGATA">Collegata</option>
                    <option value="PARZIALMENTE_SALDATA">Parzialmente saldata</option>
                    <option value="SALDATA">Saldata</option>
                    <option value="ANNULLATA">Annullata</option>
                  </select>

                  <button
                    onClick={() => setActiveDetailSection(null)}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                  >
                    Chiudi sezione
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      <th className="px-6 py-4">Numero</th>
                      <th className="px-6 py-4">Condominio</th>
                      <th className="px-6 py-4">Descrizione</th>
                      <th className="px-6 py-4">Data</th>
                      <th className="px-6 py-4">Importo</th>
                      <th className="px-6 py-4">Stato</th>
                      <th className="px-6 py-4">Fattura associata</th>
                      <th className="px-6 py-4 text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingProformas ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                          Caricamento proforme...
                        </td>
                      </tr>
                    ) : filteredProformasRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                          Nessuna proforma trovata.
                        </td>
                      </tr>
                    ) : (
                      filteredProformasRows.map((row) => (
                        <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-6 py-4 font-semibold text-slate-800">{row.numero}</td>
                          <td className="px-6 py-4 text-slate-700">{row.condominio || "-"}</td>
                          <td className="px-6 py-4 text-slate-700">{row.descrizione || "-"}</td>
                          <td className="px-6 py-4 text-slate-500">{formatDate(row.data_documento)}</td>
                          <td className="px-6 py-4 font-semibold text-slate-900">{euro(Number(row.importo || 0))}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusClass[row.stato] || "bg-slate-100 text-slate-700 ring-slate-200"}`}>
                              {String(row.stato || "").replaceAll("_", " ")}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-700">{row.fattura_numero || "-"}</td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setLinkingProforma(row);
                                setSelectedFatturaId("");
                              }}
                              disabled={row.stato === "ANNULLATA"}
                              className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 disabled:opacity-50"
                            >
                              Collega a fattura
                            </button>
                              <button
                                onClick={() => annullaProforma(row.id)}
                                disabled={row.stato === "ANNULLATA"}
                                className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
                              >
                                {annullingId === row.id ? "..." : "Annulla"}
                              </button>

                              <button
                                onClick={() => deleteProforma(row.id)}
                                disabled={deletingId === row.id}
                                className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                              >
                                {deletingId === row.id ? "..." : "Elimina"}
                              </button>

                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}


          {/* Main command center */}
          <section className="overflow-hidden rounded-[34px] border border-slate-300/70 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
            {/* Header */}
            

            {/* Table */}
            {/* <div className="overflow-x-auto bg-white">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100/95 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 backdrop-blur">
                  <tr>
                    <th className="px-6 py-4">Tipo</th>
                    <th className="px-6 py-4">Numero</th>
                    <th className="px-6 py-4">Condominio</th>
                    <th className="px-6 py-4">Origine</th>
                    <th className="px-6 py-4">Stato</th>
                    <th className="px-6 py-4">Data</th>
                    <th className="px-6 py-4 text-right">Importo</th>
                    <th className="px-6 py-4 text-right">Azioni</th>
                  </tr>
                </thead>

                <tbody>
                  {loadingRows ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-500">
                        Caricamento movimenti...
                      </td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-500">
                        Nessun movimento trovato.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row, index) => (
                      <tr
                        key={row.id}
                        className={`transition ${
                          index % 2 === 0 ? "bg-white" : "bg-slate-50/60"
                        } hover:bg-slate-100/80`}
                      >
                        <td className="px-6 py-4">
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                            {labelType(row.type)}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-900">{row.number || "-"}</div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="max-w-[260px] truncate text-slate-700">
                            {row.condominio || "-"}
                          </div>
                        </td>

                        <td className="px-6 py-4 text-slate-500">{labelSource(row.source)}</td>

                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                              statusClass[row.status] ||
                              "bg-slate-100 text-slate-700 ring-slate-200"
                            }`}
                          >
                            {row.status.replaceAll("_", " ")}
                          </span>
                        </td>

                        <td className="px-6 py-4 text-slate-500">{formatDate(row.date)}</td>

                        <td className="px-6 py-4 text-right font-bold text-slate-900">
                          {euro(row.amount)}
                        </td>

                        <td className="px-6 py-4">
                          {row.type === "PROFORMA" ? (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => annullaProforma(row.id)}
                                disabled={annullingId === row.id}
                                className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
                              >
                                {annullingId === row.id ? "..." : "Annulla"}
                              </button>

                              <button
                                onClick={() => deleteProforma(row.id)}
                                disabled={deletingId === row.id}
                                className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                              >
                                {deletingId === row.id ? "..." : "Elimina"}
                              </button>
                            </div>
                          ) : (
                            <div className="text-right text-xs text-slate-400">-</div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div> */}
          </section>

          {/* Associate modal */}
          {isAssociateModalOpen && selectedImportedDoc ? (
            <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/70 backdrop-blur-md">
              <div className="flex min-h-full items-center justify-center p-3 sm:p-6">
                <div className="relative flex w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border border-white/20 bg-white shadow-[0_40px_120px_rgba(15,23,42,0.45)]">
                  {/* Ambient background */}
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute inset-x-0 top-0 h-44 bg-gradient-to-r from-sky-100 via-cyan-50 to-emerald-100" />
                    <div className="absolute -left-16 top-12 h-40 w-40 rounded-full bg-sky-200/40 blur-3xl" />
                    <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-emerald-200/30 blur-3xl" />
                    <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-violet-200/20 blur-3xl" />
                  </div>

                  <div className="relative flex max-h-[calc(100vh-24px)] flex-col sm:max-h-[calc(100vh-48px)]">
                    {/* Header */}
                    <div className="shrink-0 border-b border-slate-200/70 bg-white/80 px-4 py-4 backdrop-blur-xl sm:px-8 sm:py-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/90 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 shadow-sm">
                            <span className="h-2 w-2 rounded-full bg-sky-500" />
                            Associazione documento
                          </div>

                          <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                            Associa il documento ai condomini
                          </h3>

                          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:text-[15px]">
                            Seleziona uno o più condomini e crea automaticamente una nuova
                            proforma per ciascuno, partendo dal documento importato.
                          </p>
                        </div>

                        <button
                          onClick={() => setIsAssociateModalOpen(false)}
                          className="inline-flex h-11 shrink-0 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
                        >
                          Chiudi
                        </button>
                      </div>
                    </div>

                    {/* Body */}
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1.25fr_0.75fr] lg:p-8">
                        {/* Left column */}
                        <div className="space-y-6">
                          {/* Document preview */}
                          <section className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
                            <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-sky-50 px-5 py-4">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                  Documento importato
                                </div>
                                <div className="mt-1 text-sm font-medium text-slate-700">
                                  Anteprima dei dati che verranno usati per la creazione
                                </div>
                              </div>

                              <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                                Ready
                              </div>
                            </div>

                            <div className="grid gap-4 p-5 sm:grid-cols-2">
                              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Numero
                                </div>
                                <div className="mt-2 break-words text-sm font-semibold text-slate-900">
                                  {selectedImportedDoc.extracted?.numero || "-"}
                                </div>
                              </div>

                              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Data
                                </div>
                                <div className="mt-2 text-sm font-semibold text-slate-900">
                                  {selectedImportedDoc.extracted?.data_documento || "-"}
                                </div>
                              </div>

                              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:col-span-2">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Descrizione
                                </div>
                                <div className="mt-2 break-words text-sm leading-6 text-slate-700">
                                  {selectedImportedDoc.extracted?.descrizione || "-"}
                                </div>
                              </div>

                              <div className="rounded-[24px] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-5 text-white shadow-[0_20px_50px_rgba(15,23,42,0.25)] sm:col-span-2">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                                  Importo documento
                                </div>
                                <div className="mt-2 text-3xl font-bold tracking-tight">
                                  {selectedImportedDoc.extracted?.importo != null
                                    ? euro(selectedImportedDoc.extracted.importo)
                                    : "-"}
                                </div>
                              </div>
                            </div>
                          </section>

                          {/* Search */}
                          <section className="rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                            <div className="mb-4">
                              <div className="text-sm font-semibold text-slate-900">
                                Cerca condominio
                              </div>
                              <div className="mt-1 text-sm text-slate-500">
                                Filtra per indirizzo, nome o riferimento utile.
                              </div>
                            </div>

                            <div className="relative">
                              <input
                                value={condominiSearch}
                                onChange={(e) => setCondominiSearch(e.target.value)}
                                placeholder="Scrivi indirizzo o riferimento..."
                                className="h-12 w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                              />
                            </div>
                          </section>

                          {/* Condomini list */}
                          <section className="rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-base font-semibold text-slate-950">
                                  Condomini disponibili
                                </div>
                                <div className="mt-1 text-sm text-slate-500">
                                  Tocca un elemento per selezionarlo o deselezionarlo.
                                </div>
                              </div>

                              <div className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                                {filteredCondomini.length} risultati
                              </div>
                            </div>

                            <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                              {loadingCondomini ? (
                                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                                  Caricamento condomini...
                                </div>
                              ) : filteredCondomini.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
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
                                      className={`group w-full rounded-[22px] border p-4 text-left transition-all ${
                                        isSelected
                                          ? "border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 shadow-[0_10px_25px_rgba(16,185,129,0.10)]"
                                          : "border-slate-200 bg-slate-50/70 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
                                      }`}
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <div
                                            className={`break-words text-sm font-semibold ${
                                              isSelected ? "text-emerald-950" : "text-slate-900"
                                            }`}
                                          >
                                            {c.indirizzo}
                                          </div>

                                          {"amministratore" in c && c.amministratore ? (
                                            <div className="mt-1 break-words text-xs leading-5 text-slate-500">
                                              Amministratore: {c.amministratore}
                                            </div>
                                          ) : (
                                            <div className="mt-1 text-xs text-slate-400">
                                              Nessun amministratore indicato
                                            </div>
                                          )}
                                        </div>

                                        <div
                                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition ${
                                            isSelected
                                              ? "border-emerald-500 bg-emerald-500 text-white"
                                              : "border-slate-300 bg-white text-slate-400 group-hover:border-slate-400"
                                          }`}
                                        >
                                          {isSelected ? "✓" : ""}
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </section>
                        </div>

                        {/* Right column */}
                        <div className="space-y-6">
                          <section className="rounded-[30px] border border-slate-200/80 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800 p-5 text-white shadow-[0_25px_60px_rgba(15,23,42,0.28)] lg:sticky lg:top-0">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-white">
                                  Riepilogo selezione
                                </div>
                                <div className="mt-1 text-sm text-slate-300">
                                  Controlla cosa stai per generare.
                                </div>
                              </div>

                              <div className="rounded-2xl bg-white/10 px-3 py-2 text-lg font-bold text-white ring-1 ring-white/15">
                                {selectedCondomini.length}
                              </div>
                            </div>

                            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Condomini selezionati
                                </div>
                                <div className="mt-2 text-3xl font-bold tracking-tight text-white">
                                  {selectedCondomini.length}
                                </div>
                              </div>

                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Proforme da creare
                                </div>
                                <div className="mt-2 text-3xl font-bold tracking-tight text-white">
                                  {selectedCondomini.length}
                                </div>
                              </div>
                            </div>

                            <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                Azione prevista
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-200">
                                Verrà generata una proforma distinta per ogni condominio
                                selezionato, utilizzando i dati del documento importato come base.
                              </p>
                            </div>

                            <div className="mt-5">
                              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                Condomini selezionati
                              </div>

                              {selectedCondomini.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-4 py-8 text-center text-sm text-slate-300">
                                  Nessun condominio selezionato.
                                </div>
                              ) : (
                                <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                                  {selectedCondomini.map((c, index) => (
                                    <div
                                      key={c.id}
                                      className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3"
                                    >
                                      <div className="flex min-w-0 items-center gap-3">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
                                          {index + 1}
                                        </div>

                                        <div className="min-w-0">
                                          <div className="truncate text-sm font-semibold text-white">
                                            {c.indirizzo}
                                          </div>
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => toggleCondominio(c)}
                                        className="shrink-0 rounded-xl px-2.5 py-1.5 text-sm font-semibold text-emerald-200 transition hover:bg-white/10 hover:text-white"
                                      >
                                        Rimuovi
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </section>

                          {error ? (
                            <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700 shadow-sm">
                              {error}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="shrink-0 border-t border-slate-200/80 bg-white/85 px-4 py-4 backdrop-blur sm:px-8">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm text-slate-600">
                          {selectedCondomini.length === 0 ? (
                            "Seleziona almeno un condominio per continuare."
                          ) : (
                            <>
                              Stai per creare{" "}
                              <span className="font-semibold text-slate-950">
                                {selectedCondomini.length}
                              </span>{" "}
                              proforma dal documento selezionato.
                            </>
                          )}
                        </div>

                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => setIsAssociateModalOpen(false)}
                            className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                          >
                            Annulla
                          </button>

                          <button
                            onClick={() =>
                              promoteImportedProformaWithCondomini(selectedImportedDoc.id)
                            }
                            disabled={promoting || selectedCondomini.length === 0}
                            className="rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(15,23,42,0.24)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {promoting ? "Creazione..." : "Conferma e crea proforme"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <section className="grid gap-5 xl:grid-cols-1">
  
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
                          
                          <th className="px-4 py-3">Dettaglio</th>
                          <th className="px-4 py-3">Importo</th>
                          <th className="px-4 py-3">Data Documento</th>
                          <th className="px-4 py-3">Data Importazione</th>
                          <th className="px-4 py-3">Azioni</th>
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
                                    loadImportedDocumentDetail(doc.id);
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
 
                              <td className="px-4 py-3 align-middle">
                                <div className="text-sm text-slate-500">
                                  {doc.descrizione !== null ? doc.descrizione : "-"}
                                </div>
                              </td>
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
                              <td className="px-4 py-3 align-middle">
                                <div className="text-sm text-slate-500">
                                  {
                                    (doc.parse_status === "CARICATO" || doc.parse_status === "COMPLETATO") && (
                                      <button
                                        onClick={() => {
                                          if (activeImportTab === "PROFORMA") {
                                            parseImportedProforma(doc.id);
                                          } else {
                                            parseImportedFattura(doc.id);
                                          }
                                        }}
                                        disabled={parsingImportId === doc.id}
                                        className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50 hover:shadow-md disabled:translate-y-0 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
                                      >
                                        {parsingImportId === doc.id ? (
                                          <>
                                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                                            Parsing...
                                          </>
                                        ) : (
                                          <>
                                            <span className="text-base leading-none">✦</span>
                                            Esegui parser
                                          </>
                                        )}
                                      </button>
                                    )
                                  }
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
{/* 
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
                      </button> */}
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

          {linkingProforma ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
              <div className="border-b border-slate-200 px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Collega proforma a fattura</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Una proforma può appartenere a una sola fattura. Una fattura può avere più proforme.
                    </p>
                  </div>
                  <button
                    onClick={() => setLinkingProforma(null)}
                    className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600"
                  >
                    Chiudi
                  </button>
                </div>
              </div>

              <div className="space-y-4 p-6">
                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  <div><span className="font-semibold">Proforma:</span> {linkingProforma.numero}</div>
                  <div><span className="font-semibold">Condominio:</span> {linkingProforma.condominio || "-"}</div>
                  <div><span className="font-semibold">Importo:</span> {euro(Number(linkingProforma.importo || 0))}</div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Seleziona fattura
                  </label>
                  <select
                    value={selectedFatturaId}
                    onChange={(e) => setSelectedFatturaId(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="">Seleziona una fattura</option>
                    {fattureRows.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.numero} · {f.condominio || "-"} · {euro(Number(f.importo || 0))}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
                <button
                  onClick={() => setLinkingProforma(null)}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  Annulla
                </button>
                <button
                  onClick={collegaProformaAFattura}
                  disabled={linking || !selectedFatturaId}
                  className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {linking ? "Collegamento..." : "Conferma collegamento"}
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