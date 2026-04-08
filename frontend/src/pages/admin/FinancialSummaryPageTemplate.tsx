import { useEffect, useMemo, useState } from "react";
import api from "../../api/client";
import { th } from "date-fns/locale/th";
import { Fragment } from "react";

type SummaryResponse = {
  summary: {
    totaleInsolutoProforme: number;
    totaleInsolutoFatture: number;
    totaleIncassato: number;
  };
};

type FatturaDetail = {
  id: string;
  condominio_id: string;
  numero_progressivo: number;
  numero: string;
  descrizione: string | null;
  data_documento: string;
  importo: number;
  stato: string;
  condominio: string;
  totale_proforme_collegate: number;
  residuo_da_associare: number;
  eccedenza_proforme: number;
  copertura_completa: boolean;
  proformas: Array<{
    id: string;
    numero: string;
    descrizione: string | null;
    data_documento: string;
    importo: number;
    stato: string;
    condominio: string;
  }>;
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
  validation_errors: any;
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

type ImportedFatturaItem = {
  id: string;
  original_filename: string;
  parse_status: string;
  review_status: string;
  numero: string | null;
  data_documento: string | null;
  importo: number | null;
  uploaded_at: string;
};

type ImportedFatturaDetail = {
  id: string;
  original_filename: string;
  parse_status: string;
  review_status: string;
  parsed_result: any;
  extracted: {
    numero: string | null;
    data_documento: string | null;
    descrizione: string | null;
    importo: number | null;
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
  
  const [importedFattureDocs, setImportedFattureDocs] = useState<ImportedFatturaItem[]>([]);
  const [selectedImportedFatturaDoc, setSelectedImportedFatturaDoc] = useState<ImportedFatturaDetail | null>(null);
 
 
  const [loadingImportedFattureDocs, setLoadingImportedFattureDocs] = useState(false);
  const [parsingFatturaImportId, setParsingFatturaImportId] = useState<string | null>(null);

  const [isCreateFatturaModalOpen, setIsCreateFatturaModalOpen] = useState(false);
  const [selectedFatturaCondominioId, setSelectedFatturaCondominioId] = useState("");
  const [selectedProformaIdsForFattura, setSelectedProformaIdsForFattura] = useState<string[]>([]);
  const [promotingFattura, setPromotingFattura] = useState(false);
  const [fatturaProformaSearch, setFatturaProformaSearch] = useState("");
  const [expandedImportedRows, setExpandedImportedRows] = useState<Record<string, boolean>>({});
  
  const [fatturaSearch, setFatturaSearch] = useState("");
  const [fatturaStatusFilter, setFatturaStatusFilter] = useState("TUTTI");
  const [selectedFatturaDetail, setSelectedFatturaDetail] = useState<FatturaDetail | null>(null);
  const [loadingFatturaDetail, setLoadingFatturaDetail] = useState(false);
  
  
const filteredFattureRows = useMemo(() => {
  return fattureRows.filter((row: any) => {
    const q = fatturaSearch.trim().toLowerCase();

    const matchesSearch =
      !q ||
      [
        row.numero,
        row.condominio || "",
        row.descrizione || "",
        String(row.importo || ""),
        String(row.totale_proforme_collegate || ""),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);

    const matchesStatus =
      fatturaStatusFilter === "TUTTI" || row.stato === fatturaStatusFilter;

    return matchesSearch && matchesStatus;
  });
}, [fattureRows, fatturaSearch, fatturaStatusFilter]);

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

  async function loadFatturaDetail(id: string) {
    try {
      setLoadingFatturaDetail(true);
      const { data } = await api.get(`/financial-summary/fatture/${id}`);
      setSelectedFatturaDetail(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore nel caricamento dettaglio fattura.");
    } finally {
      setLoadingFatturaDetail(false);
    }
  }
  function toggleImportedRow(id: string) {
    setExpandedImportedRows((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }
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


  const availableProformasForFattura = useMemo(() => {
    return proformasRows.filter((p) => !p.fattura_id && p.stato !== "ANNULLATA");
  }, [proformasRows]);

  const filteredAvailableProformasForFattura = useMemo(() => {
    const q = fatturaProformaSearch.trim().toLowerCase();
    if (!q) return availableProformasForFattura;

    return availableProformasForFattura.filter((p) =>
      [
        p.numero,
        p.condominio || "",
        p.descrizione || "",
        String(p.importo || ""),
        p.stato || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [availableProformasForFattura, fatturaProformaSearch]);
  useEffect(() => {
    void loadImportedFattureDocuments();
  }, []);

  // useEffect(() => {
  //   if (importedFattureDocs.length > 0 && !selectedImportedFatturaDoc) {
  //     void loadImportedFatturaDocumentDetail(importedFattureDocs[0].id);
  //   }
  // }, [importedFattureDocs, selectedImportedFatturaDoc]);

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

      if (!linkingProforma?.id) {
        setError("Proforma non valida");
        return;
      }

      if (!selectedFatturaId) {
        setError("Seleziona una fattura");
        return;
      }
 
      try {
        setLinking(true);
        setError("");

        await api.post(`/financial-summary/${linkingProforma.id}/collega-fattura`, {
          fatturaId: selectedFatturaId,
        });

        
        // CLOSE MODAL
         
        setLinkingProforma(null);
        setSelectedFatturaId("");

         
        await Promise.all([
          loadProformasRows(),
          loadFattureRows(),
          loadRecentRows(),
          loadSummary(),
        ]);

      } catch (err: any) {
        console.error("❌ LINK ERROR:", err);

        setError(
          err?.response?.data?.error ||
          "Errore durante il collegamento"
        );
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
async function loadImportedFattureDocuments() {
  try {
    setLoadingImportedFattureDocs(true);
    const { data } = await api.get("/financial-summary/fatture");
    setImportedFattureDocs(Array.isArray(data) ? data : []);
  } catch (err: any) {
    setError(err?.response?.data?.error || "Errore caricando i documenti fattura importati.");
  } finally {
    setLoadingImportedFattureDocs(false);
  }
}

async function loadImportedFatturaDocumentDetail(id: string) {
  try {
    const { data } = await api.get(`/financial-summary/imported-documents/${id}`);
    setSelectedImportedFatturaDoc(data);
  } catch (err: any) {
    setError(err?.response?.data?.error || "Errore caricando il dettaglio del documento fattura.");
  }
}

async function uploadFatturaFiles() {
  
  if (!selectedUploadFiles.length) {
    setError("Seleziona almeno un file PDF.");
    return;
  }

  try {
    setUploading(true);
    setError("");

    const formData = new FormData();
    selectedUploadFiles.forEach((file) => formData.append("files", file));

    await api.post("/financial-summary/imported-documents/uploadf", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    setSelectedUploadFiles([]);
    
    await loadImportedDocuments();

  } catch (err: any) {
    setError(err?.response?.data?.error || "Errore nel caricamento dei file fattura.");
  } finally {
    setUploading(false);
  }
}
 
    async function promoteImportedFattura() {

      if (!selectedImportedDoc?.id) {
        setError("Documento fattura non selezionato.");
        return;
      }

      if (!selectedFatturaCondominioId) {
        setError("Seleziona un condominio.");
        return;
      }

      try {
        setPromotingFattura(true);
        setError("");

        await api.post(`/financial-summary/imported-documents/${selectedImportedDoc.id}/promotef`, {
          condominioId: selectedFatturaCondominioId,
          proformaIds: selectedProformaIdsForFattura,
        });

        setIsCreateFatturaModalOpen(false);
        setSelectedFatturaCondominioId("");
        setSelectedProformaIdsForFattura([]);

        await loadImportedFattureDocuments();
        await loadImportedFatturaDocumentDetail(selectedImportedDoc.id);
        await loadSummary();
        await loadRecentRows();
        await loadProformasRows();
        await loadFattureRows();
      } catch (err: any) {
        setError(err?.response?.data?.error || "Errore durante la creazione della fattura.");
      } finally {
        setPromotingFattura(false);
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

      // if (selectedImportedDoc) {
      //   if (activeImportTab === "PROFORMA") {
      //     parseImportedProforma(selectedImportedDoc.id);
      //   } else {
      //     parseImportedFattura(selectedImportedDoc.id);
      //   }
      // }

    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore nel caricamento dei file proforma.");
    } finally {
      setUploading(false);
    }
  }

  async function parseImportedFattura(id: string) {
    try {
      setParsingImportId(id);
      setError("");

      await api.post(`/financial-summary/imported-documents/${id}/parsef`);

      await loadImportedDocuments();
      await loadImportedDocumentDetail(id);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore parsing fattura.");
    } finally {
      setParsingImportId(null);
    }
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
                    {/* <span className="font-semibold text-slate-700">Dashboard</span> */}
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
                                disabled={row.stato === "ANNULLATA" || row.fattura_numero != null}
                                className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 disabled:opacity-50"
                              >
                                Collega a fattura
                              </button>
                                {/* <button
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
                                </button> */}

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

            {activeDetailSection === "FATTURA" ? (
  <section className="space-y-6">
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-xl font-bold">Dettaglio fatture</h3>
          <p className="mt-1 text-sm text-slate-500">
            Elenco completo delle fatture con copertura da proforme collegate.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={fatturaSearch}
            onChange={(e) => setFatturaSearch(e.target.value)}
            placeholder="Cerca numero, condominio, descrizione..."
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
          />

          <select
            value={fatturaStatusFilter}
            onChange={(e) => setFatturaStatusFilter(e.target.value)}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
          >
            <option value="TUTTI">Tutti gli stati</option>
            <option value="BOZZA">Bozza</option>
            <option value="EMESSA">Emessa</option>
            <option value="PARZIALMENTE_PAGATA">Parzialmente pagata</option>
            <option value="PAGATA">Pagata</option>
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
              <th className="px-6 py-4 text-right">Importo fattura</th>
              <th className="px-6 py-4 text-right">Credito associato</th>
              <th className="px-6 py-4 text-right">Residuo</th>
              <th className="px-6 py-4 text-right">Eccedenza</th>
              <th className="px-6 py-4">Stato</th>
              <th className="px-6 py-4 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {loadingFatture ? (
              <tr>
                <td colSpan={10} className="px-6 py-8 text-center text-slate-500">
                  Caricamento fatture...
                </td>
              </tr>
            ) : filteredFattureRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-8 text-center text-slate-500">
                  Nessuna fattura trovata.
                </td>
              </tr>
            ) : (
              filteredFattureRows.map((row: any) => (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-6 py-4 font-semibold text-slate-800">{row.numero}</td>
                  <td className="px-6 py-4 text-slate-700">{row.condominio || "-"}</td>
                  <td className="px-6 py-4 text-slate-700">{row.descrizione || "-"}</td>
                  <td className="px-6 py-4 text-slate-500">{formatDate(row.data_documento)}</td>

                  <td className="px-6 py-4 text-right font-semibold text-slate-900">
                    {euro(Number(row.importo || 0))}
                  </td>

                  <td className="px-6 py-4 text-right font-semibold text-fuchsia-700">
                    {euro(Number(row.totale_proforme_collegate || 0))}
                  </td>

                  <td className="px-6 py-4 text-right font-semibold text-amber-700">
                    {euro(Number(row.residuo_da_associare || 0))}
                  </td>

                  <td className="px-6 py-4 text-right font-semibold text-rose-700">
                    {euro(Number(row.eccedenza_proforme || 0))}
                  </td>

                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                        statusClass[row.stato] || "bg-slate-100 text-slate-700 ring-slate-200"
                      }`}
                    >
                      {String(row.stato || "").replaceAll("_", " ")}
                    </span>
                  </td>

                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => void loadFatturaDetail(row.id)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                    >
                      Apri dettaglio
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>

    {selectedFatturaDetail ? (
      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-xl font-bold">Dettaglio fattura {selectedFatturaDetail.numero}</h3>
            <p className="mt-1 text-sm text-slate-500">
              Vista delle proforme collegate e del credito residuo da associare.
            </p>
          </div>

          <button
            onClick={() => setSelectedFatturaDetail(null)}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
          >
            Chiudi dettaglio
          </button>
        </div>

        <div className="grid gap-4 p-6 lg:grid-cols-4">
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Importo fattura
            </div>
            <div className="mt-2 text-xl font-bold text-slate-900">
              {euro(selectedFatturaDetail.importo)}
            </div>
          </div>

          <div className="rounded-2xl bg-fuchsia-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-700">
              Credito associato
            </div>
            <div className="mt-2 text-xl font-bold text-fuchsia-800">
              {euro(selectedFatturaDetail.totale_proforme_collegate)}
            </div>
          </div>

          <div className="rounded-2xl bg-amber-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
              Residuo da coprire
            </div>
            <div className="mt-2 text-xl font-bold text-amber-800">
              {euro(selectedFatturaDetail.residuo_da_associare)}
            </div>
          </div>

          <div className="rounded-2xl bg-rose-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">
              Eccedenza
            </div>
            <div className="mt-2 text-xl font-bold text-rose-800">
              {euro(selectedFatturaDetail.eccedenza_proforme)}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto border-t border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-6 py-4">Numero proforma</th>
                <th className="px-6 py-4">Condominio</th>
                <th className="px-6 py-4">Descrizione</th>
                <th className="px-6 py-4">Data</th>
                <th className="px-6 py-4 text-right">Importo</th>
                <th className="px-6 py-4">Stato</th>
              </tr>
            </thead>
            <tbody>
              {loadingFatturaDetail ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    Caricamento dettaglio...
                  </td>
                </tr>
              ) : selectedFatturaDetail.proformas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    Nessuna proforma collegata.
                  </td>
                </tr>
              ) : (
                selectedFatturaDetail.proformas.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-6 py-4 font-semibold text-slate-800">{p.numero}</td>
                    <td className="px-6 py-4 text-slate-700">{p.condominio || "-"}</td>
                    <td className="px-6 py-4 text-slate-700">{p.descrizione || "-"}</td>
                    <td className="px-6 py-4 text-slate-500">{formatDate(p.data_documento)}</td>
                    <td className="px-6 py-4 text-right font-semibold text-slate-900">
                      {euro(p.importo)}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                          statusClass[p.stato] || "bg-slate-100 text-slate-700 ring-slate-200"
                        }`}
                      >
                        {String(p.stato || "").replaceAll("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    ) : null}
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
  
            <aside className="space-y-4">
              {/* =========================================================
                  1) COMPACT TOP BAR + UPLOAD
              ========================================================= */}
              <section className="sticky top-0 z-30 rounded-[24px] border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur sm:px-5">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                      Import documenti
                    </div>

                    <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                      {area.title}
                    </h3>

                    <p className="mt-1 text-sm text-slate-600">
                      {area.description}
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 xl:min-w-[640px] xl:flex-row xl:items-center xl:justify-end">
                    <div className="flex-1 xl:flex-none">
                      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-100 p-1.5">
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
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50">
                        <span className="text-base leading-none">⬆</span>
                        <span>Seleziona PDF</span>
                        <input
                          type="file"
                          multiple
                          accept="application/pdf"
                          onChange={(e) => setSelectedUploadFiles(Array.from(e.target.files || []))}
                          className="hidden"
                        />
                      </label>

                      <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                        <span className="text-base leading-none">📄</span>
                        <span>{selectedUploadFiles.length} file</span>
                      </div>

                      <button
                        onClick={() => {
                          if (activeImportTab === "PROFORMA") {
                            uploadProformaFiles();
                          } else if (activeImportTab === "FATTURA") {
                            uploadFatturaFiles();
                          }
                        }}
                        disabled={uploading || selectedUploadFiles.length === 0}
                        className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="text-base leading-none">✦</span>
                        <span>{uploading ? "Caricamento..." : "Carica"}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {selectedUploadFiles.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
                    {selectedUploadFiles.slice(0, 8).map((file, index) => (
                      <div
                        key={`${file.name}-${index}`}
                        className="max-w-full rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
                      >
                        <span className="block max-w-[220px] truncate">{file.name}</span>
                      </div>
                    ))}

                    {selectedUploadFiles.length > 8 ? (
                      <div className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                        +{selectedUploadFiles.length - 8} altri
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              {/* =========================================================
                  2) MAIN TABLE WORKSPACE
              ========================================================= */}
              <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Documenti importati</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Le funzioni principali sono caricamento, parser e dettaglio espandibile.
                    </p>
                  </div>

                  <div className="w-full md:w-80">
                    <input
                      type="text"
                      value={importedDocsSearch}
                      onChange={(e) => setImportedDocsSearch(e.target.value)}
                      placeholder="Cerca per numero, file o stato..."
                      className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  {loadingImportedDocs ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      Caricamento documenti...
                    </div>
                  ) : filteredImportedDocs.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      {importedDocs.length === 0
                        ? "Nessun documento importato."
                        : "Nessun documento trovato con questo filtro."}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="max-h-[620px] overflow-auto">
                        <table className="min-w-full text-sm">
                          <thead className="sticky top-0 z-10 bg-slate-100/95 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700 backdrop-blur">
                            <tr className="border-b border-slate-200">
                              <th className="w-[56px] px-4 py-3"></th>
                              <th className="px-4 py-3">Numero</th>
                              <th className="px-4 py-3">File</th>
                              <th className="px-4 py-3">Parse</th>
                              <th className="px-4 py-3">Importo</th>
                              <th className="px-4 py-3">Stato</th>
                              <th className="px-4 py-3 text-right">Azioni</th>
                            </tr>
                          </thead>

                          <tbody>
                            {filteredImportedDocs.map((doc, index) => {
                              const isSelected = selectedImportedDoc?.id === doc.id;
                              const isExpanded = !!expandedImportedRows[doc.id];

                              const creationStatusLabel =
                                doc.review_status === "APPROVATO" || doc.review_status === "CREATO"
                                  ? "Creata"
                                  : "Da approvare";

                              return (
                                <Fragment key={doc.id}>
                                  <tr
                                    className={[
                                      "border-b border-slate-200 transition-all duration-150",
                                      isSelected
                                        ? "bg-blue-50"
                                        : index % 2 === 0
                                        ? "bg-white hover:bg-slate-50"
                                        : "bg-slate-50/60 hover:bg-slate-100/70",
                                    ].join(" ")}
                                  >
                                    <td className="px-4 py-3">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleImportedRow(doc.id);
                                        }}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                                        title={isExpanded ? "Comprimi" : "Espandi"}
                                      >
                                        <span
                                          className={`text-sm transition-transform duration-200 ${
                                            isExpanded ? "rotate-90" : ""
                                          }`}
                                        >
                                          ›
                                        </span>
                                      </button>
                                    </td>

                                    <td
                                      className="cursor-pointer px-4 py-3 font-semibold text-slate-800"
                                      onClick={() => loadImportedDocumentDetail(doc.id)}
                                    >
                                      {doc.numero || "-"}
                                    </td>

                                    <td
                                      className="cursor-pointer px-4 py-3"
                                      onClick={() => loadImportedDocumentDetail(doc.id)}
                                    >
                                      <div
                                        className="max-w-[260px] truncate text-slate-600"
                                        title={doc.original_filename || ""}
                                      >
                                        {doc.original_filename || "-"}
                                      </div>
                                    </td>

                                    <td
                                      className="cursor-pointer px-4 py-3"
                                      onClick={() => loadImportedDocumentDetail(doc.id)}
                                    >
                                      <span
                                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getParseStatusClasses(
                                          doc.parse_status
                                        )}`}
                                      >
                                        {doc.parse_status || "-"}
                                      </span>
                                    </td>

                                    <td
                                      className="cursor-pointer px-4 py-3 font-medium text-slate-700"
                                      onClick={() => loadImportedDocumentDetail(doc.id)}
                                    >
                                      {doc.importo !== null ? `${doc.importo.toFixed(2)} €` : "-"}
                                    </td>

                                    <td
                                      className="cursor-pointer px-4 py-3"
                                      onClick={() => loadImportedDocumentDetail(doc.id)}
                                    >
                                      <span
                                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                          creationStatusLabel === "Creata"
                                            ? "bg-emerald-100 text-emerald-700"
                                            : "bg-amber-100 text-amber-700"
                                        }`}
                                      >
                                        {creationStatusLabel}
                                      </span>
                                    </td>

                                    <td className="px-4 py-3">
                                      <div className="flex items-center justify-end gap-2">
                                        {(doc.parse_status === "CARICATO" ||
                                          doc.parse_status === "COMPLETATO" ||
                                          doc.parse_status === "COMPLETATO_CON_ERRORI") && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (activeImportTab === "PROFORMA") {
                                                parseImportedProforma(doc.id);
                                              } else {
                                                parseImportedFattura(doc.id);
                                              }
                                            }}
                                            disabled={parsingImportId === doc.id}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            title="Esegui parser"
                                          >
                                            {parsingImportId === doc.id ? (
                                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                                            ) : (
                                              <span className="text-sm">✦</span>
                                            )}
                                          </button>
                                        )}

                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            loadImportedDocumentDetail(doc.id);
                                            toggleImportedRow(doc.id);
                                          }}
                                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                                          title={isExpanded ? "Chiudi dettaglio" : "Apri dettaglio"}
                                        >
                                          <span className="text-sm">≡</span>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>

                                  {isExpanded ? (
                                    <tr className="border-b border-slate-200 bg-slate-50/70">
                                      <td colSpan={7} className="px-4 pb-4 pt-0">
                                        <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
                                          <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
                                            <div className="space-y-4">
                                              <div className="grid gap-3 sm:grid-cols-2">
                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                                    Numero
                                                  </div>
                                                  <div className="mt-1 text-sm font-semibold text-slate-900">
                                                    {doc.numero || doc?.numero || "-"}
                                                  </div>
                                                </div>

                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                                    Importo
                                                  </div>
                                                  <div className="mt-1 text-sm font-semibold text-slate-900">
                                                    {doc.importo !== null
                                                      ? `${doc.importo.toFixed(2)} €`
                                                      : doc?.importo != null
                                                      ? euro(doc.importo)
                                                      : "-"}
                                                  </div>
                                                </div>
                                              </div>

                                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                                  Descrizione / dettaglio
                                                </div>
                                                <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                                                  {doc.descrizione ||
                                                    doc?.descrizione ||
                                                    "Nessun dettaglio disponibile."}
                                                </div>
                                              </div>
                                            </div>

                                            <div className="space-y-4">
                                              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                                  Validazione
                                                </div>

                                                <div className="mt-3">
                                                  {doc.validation_errors?.length ? (
                                                    <ul className="space-y-2 text-sm text-rose-700">
                                                      {doc.validation_errors.map((err: string, idx: number) => (
                                                        <li key={`${err}-${idx}`}>• {err}</li>
                                                      ))}
                                                    </ul>
                                                  ) : (
                                                    <div className="text-sm font-medium text-emerald-700">
                                                      Nessun errore bloccante rilevato.
                                                    </div>
                                                  )}
                                                </div>
                                              </div>

                                              <div className="flex flex-wrap gap-3">
                                                {/* <button
                                                  type="button"
                                                  onClick={() => loadImportedDocumentDetail(doc.id)}
                                                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                                                >
                                                  Apri nel pannello
                                                </button> */}

                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    loadImportedDocumentDetail(doc.id);

                                                    if (activeImportTab === "PROFORMA") {
                                                      setSelectedCondomini([]);
                                                      setCondominiSearch("");
                                                      setCondomini([]);
                                                      setIsAssociateModalOpen(true);
                                                      void loadCondomini();
                                                      return;
                                                    }

                                                    if (activeImportTab === "FATTURA") {
                                                      setSelectedFatturaCondominioId("");
                                                      setSelectedProformaIdsForFattura([]);
                                                      setCondominiSearch("");
                                                      setCondomini([]);
                                                      setIsCreateFatturaModalOpen(true);
                                                      void loadCondomini();
                                                      void loadProformasRows();
                                                    }
                                                  }}
                                                  disabled={isLocked}
                                                  className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                  {activeImportTab === "PROFORMA"
                                                    ? "Approva e crea proforma"
                                                    : "Approva e crea fattura"}
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  ) : null}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* =========================================================
                  3) COMPACT REVIEW + ACTION PANEL
              ========================================================= */}
              <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                {!selectedImportedDoc ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                    Seleziona un documento per vedere il dettaglio e avviare le azioni.
                  </div>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                    {/* <div className="space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Documento selezionato
                          </div>

                          <h3 className="mt-3 truncate text-lg font-bold text-slate-900">
                            {selectedImportedDoc.original_filename || "Documento"}
                          </h3>

                          <div className="mt-2 flex flex-wrap gap-2">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getParseStatusClasses(
                                selectedImportedDoc.parse_status
                              )}`}
                            >
                              {selectedImportedDoc.parse_status || "-"}
                            </span>

                            {selectedImportedDoc.review_status ? (
                              <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                {selectedImportedDoc.review_status}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-slate-950 px-4 py-3 text-white">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Importo
                          </div>
                          <div className="mt-1 text-2xl font-bold tracking-tight">
                            {selectedImportedDoc.extracted?.importo != null
                              ? euro(selectedImportedDoc.extracted.importo)
                              : "-"}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Numero
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {selectedImportedDoc.extracted?.numero || "-"}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Data documento
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {selectedImportedDoc.extracted?.data_documento || "-"}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Descrizione
                          </div>
                          <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                            {selectedImportedDoc.extracted?.descrizione || "-"}
                          </div>
                        </div>
                      </div>
                    </div> */}

                    {/* <div className="rounded-[22px] border border-slate-200 bg-slate-950 p-4 text-white">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Azioni documento
                      </div>

                      <div className="mt-2 text-lg font-bold tracking-tight">
                        {activeImportTab === "PROFORMA"
                          ? "Approvazione proforma"
                          : "Approvazione fattura"}
                      </div>

                      <div className="mt-4">
                        {selectedImportedDoc.validation_errors?.length ? (
                          <ul className="space-y-2 text-sm text-rose-300">
                            {selectedImportedDoc.validation_errors.map((err, idx) => (
                              <li key={`${err}-${idx}`}>• {err}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-300">
                            Nessun errore bloccante rilevato.
                          </div>
                        )}
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Tipo
                          </div>
                          <div className="mt-1 text-sm font-semibold text-white">
                            {activeImportTab === "PROFORMA" ? "Proforma" : "Fattura"}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Stato
                          </div>
                          <div className="mt-1 text-sm font-semibold text-white">
                            {isLocked ? "Bloccato" : "Pronto"}
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 flex flex-col gap-3">
                        <button
                          onClick={() => {
                            if (activeImportTab === "PROFORMA") {
                              setSelectedCondomini([]);
                              setCondominiSearch("");
                              setCondomini([]);
                              setIsAssociateModalOpen(true);
                              void loadCondomini();
                              return;
                            }

                            if (activeImportTab === "FATTURA") {
                              setSelectedFatturaCondominioId("");
                              setSelectedProformaIdsForFattura([]);
                              setCondominiSearch("");
                              setCondomini([]);
                              setIsCreateFatturaModalOpen(true);
                              void loadCondomini();
                              void loadProformasRows();
                            }
                          }}
                          className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={isLocked}
                        >
                          {isLocked
                            ? activeImportTab === "PROFORMA"
                              ? "Proforma già creata"
                              : "Fattura già creata"
                            : activeImportTab === "PROFORMA"
                            ? "Approva e crea proforma"
                            : "Approva e crea fattura"}
                        </button>

                        <button
                          onClick={() => {
                            if (activeImportTab === "PROFORMA") {
                              parseImportedProforma(selectedImportedDoc.id);
                            } else {
                              parseImportedFattura(selectedImportedDoc.id);
                            }
                          }}
                          disabled={parsingImportId === selectedImportedDoc.id}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {parsingImportId === selectedImportedDoc.id ? "Parsing..." : "Esegui parser"}
                        </button>
                      </div>
                    </div> */}
                  </div>
                )}
              </section>
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

          {isCreateFatturaModalOpen && selectedImportedDoc && activeImportTab === "FATTURA" ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
              <div className="w-full max-w-6xl rounded-3xl bg-white shadow-2xl">
                <div className="border-b border-slate-200 px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Crea fattura</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Seleziona il condominio della fattura e associa una o più proforme esistenti, anche provenienti da condomini diversi.
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setIsCreateFatturaModalOpen(false);
                        setSelectedFatturaCondominioId("");
                        setSelectedProformaIdsForFattura([]);
                        setFatturaProformaSearch("");
                      }}
                      className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      Chiudi
                    </button>
                  </div>
                </div>

                <div className="grid gap-6 p-6 xl:grid-cols-[360px_1fr]">
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Documento da approvare
                      </div>

                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        <div>
                          <span className="font-semibold">Numero:</span>{" "}
                          {selectedImportedDoc.extracted?.numero || "-"}
                        </div>
                        <div>
                          <span className="font-semibold">Data:</span>{" "}
                          {selectedImportedDoc.extracted?.data_documento || "-"}
                        </div>
                        <div>
                          <span className="font-semibold">Descrizione:</span>{" "}
                          {selectedImportedDoc.extracted?.descrizione || "-"}
                        </div>
                        <div>
                          <span className="font-semibold">Importo:</span>{" "}
                          {selectedImportedDoc.extracted?.importo != null
                            ? euro(selectedImportedDoc.extracted.importo)
                            : "-"}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Condominio della fattura
                      </label>

                      <select
                        value={selectedFatturaCondominioId}
                        onChange={(e) => setSelectedFatturaCondominioId(e.target.value)}
                        className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
                      >
                        <option value="">Seleziona un condominio</option>
                        {condomini.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.indirizzo}
                          </option>
                        ))}
                      </select>

                      <p className="mt-2 text-xs text-slate-500">
                        La fattura viene intestata a un condominio, ma può includere proforme di condomini diversi dello stesso amministratore.
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Riepilogo associazione
                      </div>

                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        <div>
                          <span className="font-semibold">Condominio selezionato:</span>{" "}
                          {selectedFatturaCondominioId
                            ? condomini.find((c) => String(c.id) === String(selectedFatturaCondominioId))
                                ?.indirizzo || "-"
                            : "-"}
                        </div>

                        <div>
                          <span className="font-semibold">Proforme selezionate:</span>{" "}
                          {selectedProformaIdsForFattura.length}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-800">
                            Proforme associabili
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Cerca e seleziona le proforme da collegare alla fattura.
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <input
                            value={fatturaProformaSearch}
                            onChange={(e) => setFatturaProformaSearch(e.target.value)}
                            placeholder="Cerca numero, condominio, descrizione..."
                            className="h-10 w-full min-w-[260px] rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
                          />
                          <button
                            onClick={() => void loadProformasRows()}
                            className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                          >
                            Aggiorna
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                        <div className="max-h-[420px] overflow-auto">
                          <table className="min-w-full text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              <tr>
                                <th className="px-4 py-3">Sel.</th>
                                <th className="px-4 py-3">Numero</th>
                                <th className="px-4 py-3">Condominio</th>
                                <th className="px-4 py-3">Descrizione</th>
                                <th className="px-4 py-3">Importo</th>
                                <th className="px-4 py-3">Stato</th>
                              </tr>
                            </thead>
                            <tbody>
                              {loadingProformas ? (
                                <tr>
                                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                                    Caricamento proforme...
                                  </td>
                                </tr>
                              ) : filteredAvailableProformasForFattura.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                                    Nessuna proforma disponibile.
                                  </td>
                                </tr>
                              ) : (
                                filteredAvailableProformasForFattura.map((p) => {
                                  const checked = selectedProformaIdsForFattura.includes(p.id);

                                  return (
                                    <tr
                                      key={p.id}
                                      className={`border-t border-slate-100 ${
                                        checked ? "bg-fuchsia-50" : "hover:bg-slate-50"
                                      }`}
                                    >
                                      <td className="px-4 py-3">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedProformaIdsForFattura((prev) => [...prev, p.id]);
                                            } else {
                                              setSelectedProformaIdsForFattura((prev) =>
                                                prev.filter((id) => id !== p.id)
                                              );
                                            }
                                          }}
                                        />
                                      </td>
                                      <td className="px-4 py-3 font-semibold text-slate-800">
                                        {p.numero}
                                      </td>
                                      <td className="px-4 py-3 text-slate-700">
                                        {p.condominio || "-"}
                                      </td>
                                      <td className="px-4 py-3 text-slate-700">
                                        {p.descrizione || "-"}
                                      </td>
                                      <td className="px-4 py-3 font-semibold text-slate-900">
                                        {euro(Number(p.importo || 0))}
                                      </td>
                                      <td className="px-4 py-3">
                                        <span
                                          className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${
                                            statusClass[p.stato] ||
                                            "bg-slate-100 text-slate-700 ring-slate-200"
                                          }`}
                                        >
                                          {String(p.stato || "").replaceAll("_", " ")}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Proforme selezionate
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedProformaIdsForFattura.length === 0 ? (
                          <div className="text-sm text-slate-500">Nessuna proforma selezionata.</div>
                        ) : (
                          availableProformasForFattura
                            .filter((p) => selectedProformaIdsForFattura.includes(p.id))
                            .map((p) => (
                              <span
                                key={p.id}
                                className="inline-flex items-center gap-2 rounded-full bg-fuchsia-100 px-3 py-2 text-sm font-medium text-fuchsia-800"
                              >
                                {p.numero}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelectedProformaIdsForFattura((prev) =>
                                      prev.filter((id) => id !== p.id)
                                    )
                                  }
                                  className="text-fuchsia-700"
                                >
                                  ×
                                </button>
                              </span>
                            ))
                        )}
                      </div>
                      
                  {error ? (
                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  ) : null}
                    </div>
                  </div>
                  
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
                  <button
                    onClick={() => {
                      setIsCreateFatturaModalOpen(false);
                      setSelectedFatturaCondominioId("");
                      setSelectedProformaIdsForFattura([]);
                      setFatturaProformaSearch("");
                    }}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Annulla
                  </button>

                  <button
                    onClick={promoteImportedFattura}
                    disabled={promotingFattura || !selectedFatturaCondominioId}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {promotingFattura ? "Creazione..." : "Conferma e crea fattura"}
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