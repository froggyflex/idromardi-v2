import { useEffect, useMemo, useRef, useState } from "react";
import api from "../../api/client";
import { th } from "date-fns/locale/th";
import { Fragment } from "react";

type PrintMode = "color" | "bw";

type SummaryResponse = {
  summary: {
    totaleInsolutoProforme: number;
    totaleInsolutoFatture: number;
    totaleIncassato: number;
  };
};
type PaymentRow = {
  id: string;
  numero_progressivo: number;
  numero: string;
  payment_method: string;
  stato: string;
  data_pagamento: string;
  importo: number;
  descrizione: string | null;
  numero_allocazioni: number;
  totale_allocato: number;
};

type PaymentSortKey =
  | "numero"
  | "payment_method"
  | "data_pagamento"
  | "importo"
  | "totale_allocato"
  | "stato"
  | "descrizione";

type SortDirection = "asc" | "desc";

type PaymentDetail = {
  id: string;
  numero_progressivo: number;
  numero: string;
  payment_method: string;
  stato: string;
  data_pagamento: string;
  importo: number;
  descrizione: string | null;
  allocations: Array<{
    id: string;
    payment_id: string;
    fattura_id: string;
    fattura_numero: string;
    fattura_importo: number;
    condominio: string;
    importo_allocato: number;
    data_allocazione: string;
    descrizione: string | null;
  }>;
};

function SortablePaymentHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: PaymentSortKey;
  activeKey: PaymentSortKey;
  direction: SortDirection;
  onSort: (key: PaymentSortKey) => void;
  align?: "left" | "right";
}) {
  const active = activeKey === sortKey;
  return (
    <th
      className={`px-6 py-4 ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex w-full items-center gap-1.5 transition hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
          align === "right" ? "justify-end" : "justify-start"
        }`}
        title={`Ordina per ${label}`}
      >
        <span>{label}</span>
        <span className={`text-[11px] ${active ? "text-slate-800" : "text-slate-300"}`} aria-hidden="true">
          {active ? (direction === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
type FatturaDetail = {
  id: string;
  condominio_id: string;
  numero_progressivo: number;
  numero: string;
  descrizione: string | null;
  data_documento: string;
  importo: number;
  import_numero: string | null;
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
    condominio_id: string;
    condominio: string;
  }>;
  available_proformas: Array<{
    id: string;
    numero: string;
    descrizione: string | null;
    data_documento: string;
    importo: number;
    stato: string;
    condominio_id: string;
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

type ImportedDoc = {
  id: number;
  batch_id: number | null;
  original_filename: string | null;
  parse_status: string | null;
  review_status: string | null;
  descrizione: string | null;
  numero: string | null;
  data_documento: string | null;
  importo: number | null;
  uploadedAt: string | null;
  processedAt?: string | null;
  type: string | null;
  validation_errors?: string[];
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
  type: string;
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
  import_numero: string | null;
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

  const [importedDocs, setImportedDocs] = useState<ImportedDoc[]>([]);
  const [selectedImportedDoc, setSelectedImportedDoc] = useState<ImportedProformaDetail | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingImportedDocs, setLoadingImportedDocs] = useState(false);
  const [parsingImportId, setParsingImportId] = useState<string | null>(null);
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([]);
  const [isAssociateModalOpen, setIsAssociateModalOpen] = useState(false);

  const [condomini, setCondomini] = useState<any[]>([]);
  const [condominiSearch, setCondominiSearch] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [activeImportTab, setActiveImportTab] = useState<"PROFORMA" | "FATTURA">("FATTURA");
  const [selectedCondomini, setSelectedCondomini] = useState<{ id: string; indirizzo: string }[]>([]);
  const [fatturaCondominioSearch, setFatturaCondominioSearch] = useState("");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [loadingCondomini, setLoadingCondomini] = useState(false);


  const [promoting, setPromoting] = useState(false);
  const [annullingId, setAnnullingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeDetailSection, setActiveDetailSection] = useState<"PROFORMA" | "FATTURA" | "PAGAMENTO" | null>(null);
  const [isFatturaDetailModalOpen, setIsFatturaDetailModalOpen] = useState(false);
 

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
  const [annullingFatturaId, setAnnullingFatturaId] = useState<string | null>(null);
  const [isManageFatturaModalOpen, setIsManageFatturaModalOpen] = useState(false);
  const [selectedProformaIdsForExistingFattura, setSelectedProformaIdsForExistingFattura] = useState<string[]>([]);
  const [linkingProformasToFattura, setLinkingProformasToFattura] = useState(false);
  const [isRegisterPaymentModalOpen, setIsRegisterPaymentModalOpen] = useState(false);
  const [registerPaymentTargetFattura, setRegisterPaymentTargetFattura] = useState<any | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    importo: "",
    paymentMethod: "BONIFICO",
    dataPagamento: new Date().toISOString().slice(0, 10),
    descrizione: "",
  });
  const [registeringPayment, setRegisteringPayment] = useState(false);
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [openPrintMenuId, setOpenPrintMenuId] = useState<number | null>(null);

  const [paymentsRows, setPaymentsRows] = useState<PaymentRow[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);

  const [selectedPaymentDetail, setSelectedPaymentDetail] = useState<PaymentDetail | null>(null);
  const [loadingPaymentDetail, setLoadingPaymentDetail] = useState(false);

  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("TUTTI");
  const [paymentSortKey, setPaymentSortKey] = useState<PaymentSortKey>("data_pagamento");
  const [paymentSortDirection, setPaymentSortDirection] = useState<SortDirection>("desc");

  const [importedDocsPage, setImportedDocsPage] = useState(1);
  const [importedDocsPageSize] = useState(25);
  const [importedDocsTotal, setImportedDocsTotal] = useState(0);
  const [importedDocsTotalPages, setImportedDocsTotalPages] = useState(1);
 
  const importedTableScrollRef = useRef<HTMLDivElement | null>(null);
  const importedTableScrollTopRef = useRef(0);

  const [isCreateManualProformaModalOpen, setIsCreateManualProformaModalOpen] = useState(false);
  const [creatingManualProforma, setCreatingManualProforma] = useState(false);
  const [manualProformaForm, setManualProformaForm] = useState({
    condominioId: "",
    descrizione: "",
    dataDocumento: new Date().toISOString().slice(0, 10),
    importo: "",
  });

  const [isCreateManualFatturaModalOpen, setIsCreateManualFatturaModalOpen] = useState(false);
  const [creatingManualFattura, setCreatingManualFattura] = useState(false);
  const [manualFatturaForm, setManualFatturaForm] = useState({
    condominioId: "",
    descrizione: "",
    dataDocumento: new Date().toISOString().slice(0, 10),
    importo: "",
  });
  const [manualFatturaProformaSearch, setManualFatturaProformaSearch] = useState("");
  const [selectedProformaIdsForManualFattura, setSelectedProformaIdsForManualFattura] = useState<string[]>([]);

  const availableProformasForManualFattura = useMemo(() => {
    return proformasRows.filter(
      (p: any) => !p.fattura_id && p.stato !== "ANNULLATA"
    );
  }, [proformasRows]);
  const menuRef = useRef<HTMLDivElement | null>(null);

useEffect(() => {
  function handleClickOutside(event: MouseEvent) {
    if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
      setOpenPrintMenuId(null);
    }
  }

  if (openPrintMenuId !== null) {
    document.addEventListener("click", handleClickOutside);
  }

  return () => {
    document.removeEventListener("click", handleClickOutside);
  };
}, [openPrintMenuId]);

  const filteredAvailableProformasForManualFattura = useMemo(() => {
    const q = manualFatturaProformaSearch.trim().toLowerCase();
    if (!q) return availableProformasForManualFattura;

    return availableProformasForManualFattura.filter((p: any) =>
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
  }, [availableProformasForManualFattura, manualFatturaProformaSearch]);

    async function printProformaPdf(proformaId: String) {
    try {
      const response = await api.get(`/financial-summary/proforme/${proformaId}/print`, {
        responseType: "blob",
      });

      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);

      window.open(url, "_blank", "noopener,noreferrer");

      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 10000);
    } catch (err: any) {
      setError(
        err?.response?.data?.error || "Errore generando il PDF della proforma."
      );
    }
  }
  async function printFatturaPdf(fatturaId: String, mode: "color" | "bw") {
    try {
      const response = await api.get(`/financial-summary/fatture/${fatturaId}/print`, {
        responseType: "blob",
        params: { mode },
      });

      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);

      window.open(url, "_blank", "noopener,noreferrer");

      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 10000);
    } catch (err: any) {
      setError(
        err?.response?.data?.error || "Errore generando il PDF della fattura."
      );
    }
  }

  async function createManualProforma() {
  const importo = Number(manualProformaForm.importo);

  if (!manualProformaForm.condominioId) {
    setError("Seleziona un condominio.");
    return;
  }

  if (!manualProformaForm.descrizione.trim()) {
    setError("Inserisci una descrizione.");
    return;
  }

  if (!manualProformaForm.dataDocumento) {
    setError("Inserisci una data.");
    return;
  }

  if (!Number.isFinite(importo) || importo <= 0) {
    setError("Importo non valido.");
    return;
  }

  try {
    setCreatingManualProforma(true);
    setError("");

    await api.post("/financial-summary/manual-proforma/", {
      condominioId: manualProformaForm.condominioId,
      descrizione: manualProformaForm.descrizione,
      dataDocumento: manualProformaForm.dataDocumento,
      importo,
    });

    setIsCreateManualProformaModalOpen(false);
    setManualProformaForm({
      condominioId: "",
      descrizione: "",
      dataDocumento: new Date().toISOString().slice(0, 10),
      importo: "",
    });

    await Promise.all([
      loadSummary(),
      loadRecentRows(),
      loadProformasRows(),
    ]);
  } catch (err: any) {
    console.error("createManualProforma error:", err?.response?.data || err);
    setError(
      err?.response?.data?.error || "Errore durante la creazione manuale della proforma."
    );
  } finally {
    setCreatingManualProforma(false);
  }
}

async function createManualFattura() {
  const importo = Number(manualFatturaForm.importo);

  if (!manualFatturaForm.condominioId) {
    setError("Seleziona un condominio.");
    return;
  }

  if (!manualFatturaForm.descrizione.trim()) {
    setError("Inserisci una descrizione.");
    return;
  }

  if (!manualFatturaForm.dataDocumento) {
    setError("Inserisci una data.");
    return;
  }

  if (!Number.isFinite(importo) || importo <= 0) {
    setError("Importo non valido.");
    return;
  }

  try {
    setCreatingManualFattura(true);
    setError("");

    await api.post("/financial-summary/manual-fattura/", {
      condominioId: manualFatturaForm.condominioId,
      descrizione: manualFatturaForm.descrizione,
      dataDocumento: manualFatturaForm.dataDocumento,
      importo,
      proformaIds: selectedProformaIdsForManualFattura,
    });

    setIsCreateManualFatturaModalOpen(false);
    setManualFatturaForm({
      condominioId: "",
      descrizione: "",
      dataDocumento: new Date().toISOString().slice(0, 10),
      importo: "",
    });
    setManualFatturaProformaSearch("");
    setSelectedProformaIdsForManualFattura([]);

    await Promise.all([
      loadSummary(),
      loadRecentRows(),
      loadProformasRows(),
      loadFattureRows(),
    ]);
  } catch (err: any) {
    console.error("createManualFattura error:", err?.response?.data || err);
    setError(
      err?.response?.data?.error || "Errore durante la creazione manuale della fattura."
    );
  } finally {
    setCreatingManualFattura(false);
  }
}

  async function handlePrint(id: number, mode: PrintMode) {
    try {
      setPrintingId(id);
      setOpenPrintMenuId(null);

      await printFatturaPdf(String(id), mode);
    } finally {
      setPrintingId(null);
    }
  }

  function rememberImportedTableScroll() {
    if (importedTableScrollRef.current) {
      importedTableScrollTopRef.current = importedTableScrollRef.current.scrollTop;
    }
  }

  async function registraPagamentoFattura() {
    if (!registerPaymentTargetFattura?.id) {
      setError("Fattura non valida.");
      return;
    }

    const importo = Number(paymentForm.importo);

    if (!Number.isFinite(importo) || importo <= 0) {
      setError("Importo pagamento non valido.");
      return;
    }

    if (!paymentForm.paymentMethod) {
      setError("Metodo di pagamento mancante.");
      return;
    }

    if (!paymentForm.dataPagamento) {
      setError("Data pagamento mancante.");
      return;
    }

    try {
      setRegisteringPayment(true);
      setError("");

      await api.post(`/financial-summary/${registerPaymentTargetFattura.id}/registra-pagamento`, {
        importo,
        paymentMethod: paymentForm.paymentMethod,
        dataPagamento: paymentForm.dataPagamento,
        descrizione: paymentForm.descrizione,
      });

      const currentFatturaId = registerPaymentTargetFattura.id;

      setIsRegisterPaymentModalOpen(false);
      setRegisterPaymentTargetFattura(null);

      await Promise.all([
        loadSummary(),
        loadRecentRows(),
        loadFattureRows(),
        selectedFatturaDetail?.id === currentFatturaId
          ? loadFatturaDetail(currentFatturaId)
          : Promise.resolve(),
      ]);
    } catch (err: any) {
      console.error("registraPagamentoFattura error:", err?.response?.data || err);
      setError(
        err?.response?.data?.error || "Errore durante la registrazione del pagamento."
      );
    } finally {
      setRegisteringPayment(false);
    }
  }

  async function loadPaymentsRows() {
  try {
    setLoadingPayments(true);
    const { data } = await api.get("/financial-summary/payments");
    setPaymentsRows(Array.isArray(data) ? data : []);
  } catch (err: any) {
    setError(err?.response?.data?.error || "Errore nel caricamento dei pagamenti.");
  } finally {
    setLoadingPayments(false);
  }
}

async function loadPaymentDetail(id: string) {
  try {
    setLoadingPaymentDetail(true);
    const { data } = await api.get(`/financial-summary/payments/${id}`);
    setSelectedPaymentDetail(data);
  } catch (err: any) {
    setError(err?.response?.data?.error || "Errore nel caricamento del dettaglio pagamento.");
  } finally {
    setLoadingPaymentDetail(false);
  }
}

  function openRegisterPaymentModal(fattura: any) {
    setRegisterPaymentTargetFattura(fattura);
    setPaymentForm({
      importo: String(Number(fattura.importo || 0) || ""),
      paymentMethod: "BONIFICO",
      dataPagamento: new Date().toISOString().slice(0, 10),
      descrizione: "",
    });
    setIsRegisterPaymentModalOpen(true);
  }
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

  const formatAmount = (value: any) => {
    if (value == null || value === "") return "";

    let str = String(value)
      .replace("EUR", "")
      .replace("€", "")
      .replace(/\s/g, "");

    // If it contains BOTH '.' and ',' → assume European format (1.234,56)
    if (str.includes(".") && str.includes(",")) {
      str = str.replace(/\./g, "").replace(",", ".");
    }
    // If it contains ONLY ',' → decimal comma (92,42)
    else if (str.includes(",")) {
      str = str.replace(",", ".");
    }
    // If it contains ONLY '.' → assume decimal dot (92.42)
    // → do nothing

    const num = Number(str);

    if (Number.isNaN(num)) return value;

    return (
      new Intl.NumberFormat("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(num) + " €"
    );
  };
 
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

  const extractSearchFromDescription = (description: any) => {
  const text = String(description ?? "").trim();
    if (!text) return "";

    const normalized = text
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ", ")
      .trim();

    const stopWords =
      "(?=\\s+(?:periodo|fatturazione|consumi|relativi|relativo|condominio|sito)\\b|$)";

    const patterns = [
      new RegExp(`\\balla\\s+((?:via|viale|corso|piazza)\\s+.*?)${stopWords}`, "i"),
      new RegExp(`\\b((?:via|viale|corso|piazza)\\s+.*?)(?:,\\s*\\d{5}\\s*-\\s*[A-Za-zÀ-ÿ' ]+)?${stopWords}`, "i"),
      new RegExp(`\\b((?:via|viale|corso|piazza)\\s+[^,]+(?:,\\s*[^,]+){0,2})`, "i"),
    ];

    let extracted = "";

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        extracted = match[1];
        break;
      }
    }

    if (!extracted) return "";

    return extracted
      .replace(/,\s*\d{5}\s*-\s*[A-Za-zÀ-ÿ' ]+/i, "")
      .replace(/\b\d{5}\b\s*-\s*[A-Za-zÀ-ÿ' ]+/i, "")
      .replace(/\s+,/g, ",")
      .replace(/,+/g, ",")
      .replace(/,\s*$/g, "")
      .trim();
  };
  
    async function annullaFattura(id: string) {
    const reason = window.prompt("Motivo annullamento fattura:");
    if (reason === null) return;

    try {
      setAnnullingFatturaId(id);
      setError("");

      await api.post(`/financial-summary/${id}/annullaF`, { reason });

      if (selectedFatturaDetail?.id === id) {
        setSelectedFatturaDetail(null);
      }

      await Promise.all([
        loadSummary(),
        loadRecentRows(),
        loadProformasRows(),
        loadFattureRows(),
      ]);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore durante l'annullamento della fattura.");
    } finally {
      setAnnullingFatturaId(null);
    }
  }

async function loadFatturaDetail(id: string) {
  try {
    setLoadingFatturaDetail(true);
    setError("");
    setIsFatturaDetailModalOpen(true);

    const { data } = await api.get(`/financial-summary/fatture/${id}`);
    setSelectedFatturaDetail(data);
  } catch (err: any) {
    setSelectedFatturaDetail(null);
    setIsFatturaDetailModalOpen(false);
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

  const filteredAvailableProformasForExistingFattura = useMemo(() => {
    const q = fatturaProformaSearch.trim().toLowerCase();
    const list = selectedFatturaDetail?.available_proformas || [];

    if (!q) return list;

    return list.filter((p) =>
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
  }, [selectedFatturaDetail, fatturaProformaSearch]);

  const [fatturaAssociatedProformaSearch, setFatturaAssociatedProformaSearch] = useState("");

  const filteredAssociatedProformasForExistingFattura = useMemo(() => {
    const q = fatturaAssociatedProformaSearch.trim().toLowerCase();
    const list = selectedFatturaDetail?.proformas || [];

    if (!q) return list;

    return list.filter((p) =>
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
  }, [selectedFatturaDetail, fatturaAssociatedProformaSearch]);

  const normalizeDocType = (doc: any) => String(doc.type || "").trim().toUpperCase();

  useEffect(() => {
    function handleClickOutside() {
      setOpenMenuId(null);
    }

    if (openMenuId !== null) {
      window.addEventListener("click", handleClickOutside);
    }

    return () => {
      window.removeEventListener("click", handleClickOutside);
    };
  }, [openMenuId]);

  useEffect(() => {
    function handleEsc(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsFatturaDetailModalOpen(false);
        setSelectedFatturaDetail(null);
      }
    }

    if (isFatturaDetailModalOpen) {
      window.addEventListener("keydown", handleEsc);
    }

    return () => {
      window.removeEventListener("keydown", handleEsc);
    };
  }, [isFatturaDetailModalOpen]);
  const filteredImportedDocs = useMemo(() => {
    const q = importedDocsSearch.trim().toLowerCase();

    if (!q) return importedDocs;

    return importedDocs.filter((doc) => {
      const numero = String(doc.numero ?? "").toLowerCase();
      const filename = String(doc.original_filename ?? "").toLowerCase();
      const parseStatus = String(doc.parse_status ?? "").toLowerCase();
      const reviewStatus = String(doc.review_status ?? "").toLowerCase();
      const type = String(doc.type ?? "").toLowerCase();

      return (
        numero.includes(q) ||
        filename.includes(q) ||
        parseStatus.includes(q) ||
        reviewStatus.includes(q) ||
        type.includes(q)
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


  async function handleResetProforma(p: any) {
  try {
    await api.put(`/financial-summary/proforme/${p.id}/reset-to-emessa`);

    
    if (selectedFatturaDetail) {
      await loadFatturaDetail(selectedFatturaDetail.id);
    }

  } catch (err: any) {
    setError(err?.response?.data?.error || "Errore aggiornando la proforma.");
  }
}


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

useEffect(() => {
  if (!selectedImportedDoc) return;

  const isModalOpen =
    isAssociateModalOpen || isCreateFatturaModalOpen;

  if (!isModalOpen) return;

  const description = selectedImportedDoc.extracted?.descrizione;



  const extracted = extractSearchFromDescription(description);
  console.log("Extracted search term:", { extracted });
  if (!extracted) return;

  // route the value to the correct search field
  if (isAssociateModalOpen) {
    setCondominiSearch(extracted);
  }

  if (isCreateFatturaModalOpen) {
    setFatturaCondominioSearch(extracted);
      console.log("Extracting search from description:", { description });
  }
}, [
  isAssociateModalOpen,
  isCreateFatturaModalOpen,
  selectedImportedDoc
]);

  useEffect(() => {
    void loadDashboard();
    void loadImportedDocuments();
  }, []);

  useEffect(() => {
  if (importedDocs.length > 0 && !selectedImportedDoc) {
    void loadImportedDocumentDetail(String(importedDocs[0].id));
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

  async function handleDeleteImportedDoc(fileId: string) {
  const ok = window.confirm("Eliminare questo documento importato?");
  if (!ok) return;

  try {
    setError("");

    if (selectedImportedDoc?.id === fileId) {
      setSelectedImportedDoc(null);
    }

    if (activeImportTab === "PROFORMA") {
      await api.delete(`/financial-summary/imported-documents/proforma/${fileId}`);
    } else {
      await api.delete(`/financial-summary/imported-documents/fattura/${fileId}`);
    }

    await loadImportedDocuments();
  } catch (err: any) {
    console.error("deleteImportedDocument error:", err?.response?.data || err);
    setError(
      err?.response?.data?.error ||
        "Errore durante l'eliminazione del documento importato."
    );
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
  
      setLinkingProforma(null);
      setSelectedFatturaId("");
  
      await Promise.all([
        loadProformasRows(),
        loadFattureRows(),
        loadRecentRows(),
        loadSummary(),
      ]);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore durante il collegamento");
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

 

      setIsAssociateModalOpen(false);
      setSelectedCondomini([]);
      setCondominiSearch("");
      setCondomini([]);

      await loadImportedDocuments();
      await loadImportedDocumentDetail(fileId);
      await loadSummary();
      await loadRecentRows();
      await loadProformasRows();

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

async function collegaProformeAFatturaEsistente() {
  if (!selectedFatturaDetail?.id) {
    setError("Fattura non valida.");
    return;
  }

  if (!selectedProformaIdsForExistingFattura.length) {
    setError("Seleziona almeno una proforma.");
    return;
  }

  try {
    setLinkingProformasToFattura(true);
    setError("");

    await api.post(`/financial-summary/${selectedFatturaDetail.id}/collega-proforme`, {
      proformaIds: selectedProformaIdsForExistingFattura,
    });

    const fatturaId = selectedFatturaDetail.id;

    setIsManageFatturaModalOpen(false);
    setSelectedProformaIdsForExistingFattura([]);
    setFatturaProformaSearch("");
    setFatturaAssociatedProformaSearch("");

    await Promise.all([
      loadSummary(),
      loadRecentRows(),
      loadProformasRows(),
      loadFattureRows(),
      loadFatturaDetail(fatturaId),
    ]);
  } catch (err: any) {
    console.error("❌ collegaProformeAFatturaEsistente", err?.response?.data || err);
    setError(
      err?.response?.data?.error ||
        "Errore durante il collegamento delle proforme alla fattura."
    );
  } finally {
    setLinkingProformasToFattura(false);
  }
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
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));


async function waitForImportedFilesCompletion(
  uploadedIds: string[],
  maxAttempts = 12,
  delayMs = 700
) {
  if (!uploadedIds.length) {
    await loadImportedDocuments(1, activeImportTab, importedDocsSearch);
    return true;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rows = await loadImportedDocuments();

    const uploadedRows = rows.filter((row: any) => uploadedIds.includes(row.id));

    const allReady =
      uploadedRows.length === uploadedIds.length &&
      uploadedRows.every((row: any) => String(row.numero ?? "").trim() !== "");

    if (allReady) {
      return true;
    }

    await sleep(delayMs);
  }

  return false;
}

  async function loadImportedDocuments(
    page = importedDocsPage,
    tab = activeImportTab,
    search = importedDocsSearch
  ) {
    try {
      setLoadingImportedDocs(true);
      setError("");

      const { data } = await api.get("/financial-summary/imported-documents", {
        params: {
          page,
          pageSize: importedDocsPageSize,
          documentType: tab,
          search,
        },
      });

      setImportedDocs(Array.isArray(data?.items) ? data.items : []);
      setImportedDocsPage(Number(data?.page || 1));
      setImportedDocsTotal(Number(data?.total || 0));
      setImportedDocsTotalPages(Number(data?.totalPages || 1));

      return Array.isArray(data?.items) ? data.items : [];
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
          "Errore caricando i documenti importati."
      );
      return [];
    } finally {
      setLoadingImportedDocs(false);
    }
  }

  // Tab change -> reset page
  useEffect(() => {
    setImportedDocsPage(1);
    void loadImportedDocuments(1, activeImportTab, importedDocsSearch);
  }, [activeImportTab]);

  // Page change
  useEffect(() => {
    void loadImportedDocuments(importedDocsPage, activeImportTab, importedDocsSearch);
  }, [importedDocsPage]);

  // Search change with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setImportedDocsPage(1);
      void loadImportedDocuments(1, activeImportTab, importedDocsSearch);
    }, 350);

    return () => clearTimeout(timer);
  }, [importedDocsSearch]);

  const visibleDocs = useMemo(() => importedDocs, [importedDocs]);
 
  async function loadImportedDocumentDetail(id: string) {
    
    try {
      const { data } = await api.get(`/financial-summary/imported-documents/${id}`);
  
      console.log("Documento importato selezionato:", data);
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
      setManualProformaForm({
        condominioId: "",
        descrizione: "",
        dataDocumento: new Date().toISOString().slice(0, 10),
        importo: "",
      });
      setIsCreateManualProformaModalOpen(true);
      void loadCondomini();
      return;
    }

    if (actionKey === "new-fattura") {
      setManualFatturaForm({
        condominioId: "",
        descrizione: "",
        dataDocumento: new Date().toISOString().slice(0, 10),
        importo: "",
      });
      setManualFatturaProformaSearch("");
      setSelectedProformaIdsForManualFattura([]);
      setIsCreateManualFatturaModalOpen(true);
      void loadCondomini();
      void loadProformasRows();
      return;
    }

    if (actionKey === "upload-proforme") {
      return;
    }

    if (actionKey === "upload-fatture") {
      return;
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
    selectedUploadFiles.forEach((file) => {
      formData.append("files", file);
    });

    const { data } = await api.post(
      "/financial-summary/imported-documents/uploadf",
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      }
    );

    setSelectedUploadFiles([]);

    const uploadedIds = Array.isArray(data?.files)
      ? data.files.map((f: any) => f.id).filter(Boolean)
      : [];

    const completed = await waitForImportedFilesCompletion(uploadedIds);

    if (!completed) {
      console.warn(
        "Non tutti i documenti risultano completati entro il tempo previsto. Ricarico comunque la lista."
      );
      setImportedDocsPage(1);
      await loadImportedDocuments(1, activeImportTab, importedDocsSearch);
    }
  } catch (err: any) {
    setError(
      err?.response?.data?.error ||
        "Errore nel caricamento dei file proforma."
    );
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

        await loadImportedFattureDocuments();//this we might not need
        await loadImportedFatturaDocumentDetail(selectedImportedDoc.id); //this we might not need

        await loadImportedDocuments();
        await loadImportedDocumentDetail(selectedImportedDoc.id);
        await loadSummary();
        await loadRecentRows();
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

    const { data } = await api.post(
      "/financial-summary/imported-documents/upload",
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      }
    );

    setSelectedUploadFiles([]);

    const uploadedIds = Array.isArray(data?.files)
      ? data.files.map((f: any) => f.id).filter(Boolean)
      : [];

    const completed = await waitForImportedFilesCompletion(uploadedIds);

    if (!completed) {
      console.warn(
        "Non tutti i documenti risultano completati entro il tempo previsto. Ricarico comunque la lista."
      );
      setImportedDocsPage(1);

      // await loadImportedDocuments(1, activeImportTab, importedDocsSearch);
    }
  } catch (err: any) {
    setError(
      err?.response?.data?.error ||
        "Errore nel caricamento dei file proforma."
    );
  } finally {
    setUploading(false);
  }
}
  async function parseImportedFattura(id: string) {
    try {
      setParsingImportId(id);
      setError("");

      await api.post(`/financial-summary/imported-documents/${id}/parsef`);

      setImportedDocsPage(1);
      await loadImportedDocuments(1, activeImportTab, importedDocsSearch);
      await loadImportedDocumentDetail(id);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore parsing fattura.");
    } finally {
      setParsingImportId(null);
    }
  }
   const filteredFatturaRows = useMemo(() => {
    return fattureRows.filter((row) => {
      const q = fatturaSearch.trim().toLowerCase();

      const matchesSearch =
        !q ||
        [
          row.numero,
          row.condominio || "",
          row.descrizione || "",
           
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      const matchesStatus =
        fatturaStatusFilter === "TUTTI" || row.stato === fatturaStatusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [fattureRows, fatturaSearch, fatturaStatusFilter]);

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

    // state
    const [proformaPage, setProformaPage] = useState(1);
    const [proformaRowsPerPage, setProformaRowsPerPage] = useState(10);

    const [fatturaPage, setFatturaPage] = useState(1);
    const [fatturaRowsPerPage, setFatturaRowsPerPage] = useState(10);

    // reset page when filters/search change
    useEffect(() => {
      setProformaPage(1);
    }, [proformaSearch, proformaStatusFilter]);

    // pagination
    const totalProformaPages = Math.max(
      1,
      Math.ceil(filteredProformasRows.length / proformaRowsPerPage)
    );

    
    const paginatedProformasRows = useMemo(() => {
      const start = (proformaPage - 1) * proformaRowsPerPage;
      const end = start + proformaRowsPerPage;
      return filteredProformasRows.slice(start, end);
    }, [filteredProformasRows, proformaPage, proformaRowsPerPage]);

    const paginatedFatturaRows = useMemo(() => {
      const start = (fatturaPage - 1) * fatturaRowsPerPage;
      const end = start + fatturaRowsPerPage;
      return filteredFatturaRows.slice(start, end);

    }, [filteredFatturaRows, fatturaPage, fatturaRowsPerPage]);

    const totalFatturaPages = Math.max(
          1,
          Math.ceil(filteredFattureRows.length / fatturaRowsPerPage)
    );

    useEffect(() => {
      if (proformaPage > totalProformaPages) {
        setProformaPage(totalProformaPages);
      }
    }, [proformaPage, totalProformaPages]);

 

    useEffect(() => {
      setFatturaPage(1);
    }, [fatturaSearch, fatturaStatusFilter]);

    
  
    useEffect(() => {
      if (fatturaPage > totalFatturaPages) {
        setFatturaPage(totalFatturaPages);
      }
    }, [fatturaPage, totalFatturaPages]);

    useEffect(() => {
    if (!isManageFatturaModalOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isManageFatturaModalOpen]);

  useEffect(() => {
  if (activeDetailSection === "PAGAMENTO") {
    void loadPaymentsRows();
  }
  }, [activeDetailSection]);

  useEffect(() => {
    if (!selectedPaymentDetail) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedPaymentDetail(null);
    };

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedPaymentDetail]);

  function handlePaymentSort(key: PaymentSortKey) {
    if (key === paymentSortKey) {
      setPaymentSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setPaymentSortKey(key);
    setPaymentSortDirection(key === "data_pagamento" ? "desc" : "asc");
  }

  const filteredPaymentsRows = useMemo(() => {
    const filtered = paymentsRows.filter((row) => {
      const q = paymentSearch.trim().toLowerCase();

      const matchesSearch =
        !q ||
        [
          row.numero,
          row.payment_method || "",
          row.descrizione || "",
          String(row.importo || ""),
          String(row.totale_allocato || ""),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      const matchesStatus =
        paymentStatusFilter === "TUTTI" || row.stato === paymentStatusFilter;

      return matchesSearch && matchesStatus;
    });

    return filtered.sort((left, right) => {
      let comparison = 0;

      if (paymentSortKey === "importo" || paymentSortKey === "totale_allocato") {
        comparison = Number(left[paymentSortKey] || 0) - Number(right[paymentSortKey] || 0);
      } else if (paymentSortKey === "data_pagamento") {
        const leftTime = new Date(left.data_pagamento).getTime();
        const rightTime = new Date(right.data_pagamento).getTime();
        comparison = (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);
      } else {
        comparison = String(left[paymentSortKey] || "").localeCompare(
          String(right[paymentSortKey] || ""),
          "it",
          { numeric: true, sensitivity: "base" }
        );
      }

      return paymentSortDirection === "asc" ? comparison : -comparison;
    });
  }, [
    paymentsRows,
    paymentSearch,
    paymentStatusFilter,
    paymentSortKey,
    paymentSortDirection,
  ]);


  function handleCreateManualCard(cardKey: string) {
    if (cardKey === "proforma") {
      setManualProformaForm({
        condominioId: "",
        descrizione: "",
        dataDocumento: new Date().toISOString().slice(0, 10),
        importo: "",
      });
      setIsCreateManualProformaModalOpen(true);
      void loadCondomini();
      return;
    }

    if (cardKey === "fatture") {
      setManualFatturaForm({
        condominioId: "",
        descrizione: "",
        dataDocumento: new Date().toISOString().slice(0, 10),
        importo: "",
      });
      setIsCreateManualFatturaModalOpen(true);
      void loadCondomini();
      return;
    }
  }

   


  function handleOpenDetailSection(cardKey: string) {
    rememberImportedTableScroll();

    setActiveDetailSection(
      cardKey === "proforma"
        ? "PROFORMA"
        : cardKey === "fatture"
        ? "FATTURA"
        : "PAGAMENTO"
    );
  }

  const [showPromotedDocs, setShowPromotedDocs] = useState(false);

const renderImportedTableSection = (
  title: string,
  subtitle: string,
  docs: ImportedDoc[]
) => {
  const activeDocs = docs.filter(
    (doc) => (doc.review_status || "DA REVISIONARE") !== "PROMOSSO"
  );

  const promotedDocs = docs.filter(
    (doc) => (doc.review_status || "DA REVISIONARE") === "PROMOSSO"
  );

  const renderImportedDocRow = (
    doc: ImportedDoc,
    index: number,
    isPromotedGroup = false
  ) => {
    const isSelected = selectedImportedDoc?.id === String(doc.id);
    const isExpanded = !!expandedImportedRows[String(doc.id)];
    const creationStatusLabel = doc.review_status || "DA REVISIONARE";
    const hasNumero = !!String(doc.numero ?? "").trim();
    const normalizedType = normalizeDocType(doc);

    return (
      <Fragment key={`${isPromotedGroup ? "promoted" : "active"}-${doc.id}`}>
        <tr
          className={[
            "border-b border-slate-200 transition-all duration-150",
            isPromotedGroup ? "opacity-75" : "",
            isSelected
              ? "bg-blue-50"
              : index % 2 === 0
              ? "bg-white hover:bg-slate-50"
              : "bg-slate-50/60 hover:bg-slate-100/70",
          ].join(" ")}
          onClick={(e) => {
            e.stopPropagation();
            toggleImportedRow(String(doc.id));
          }}
        >
          <td className="px-4 py-3">
            <button
              type="button"
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

          <td className="px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800">
                {doc.numero || "-"}
              </span>

              {!hasNumero && (
                <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                  Da parsare
                </span>
              )}
            </div>
          </td>

          <td className="px-4 py-3">
            <div
              className="max-w-[260px] truncate text-slate-600"
              title={doc.original_filename || ""}
            >
              {doc.original_filename || "-"}
            </div>
          </td>

          <td className="px-4 py-3">{doc.type || "-"}</td>

          <td className="px-4 py-3">
            {doc.data_documento
              ? new Date(doc.data_documento).toLocaleDateString("it-IT")
              : "-"}
          </td>

          <td className="px-4 py-3 font-medium text-slate-700">
            {formatAmount(doc.importo)}
          </td>

          <td className="px-4 py-3">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                creationStatusLabel === "PROMOSSO"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {creationStatusLabel}
            </span>
          </td>

          <td className="px-4 py-3">
            <div className="flex items-center justify-end gap-2">
              {!isPromotedGroup &&
                (doc.parse_status === "CARICATO" ||
                  doc.parse_status === "COMPLETATO" ||
                  doc.parse_status === "COMPLETATO_CON_ERRORI") && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();

                      if (normalizedType === "PROFORMA") {
                        parseImportedProforma(String(doc.id));
                      } else {
                        parseImportedFattura(String(doc.id));
                      }
                    }}
                    disabled={parsingImportId === String(doc.id)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Esegui parser"
                  >
                    {parsingImportId === String(doc.id) ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                    ) : (
                      <span className="text-sm">✦</span>
                    )}
                  </button>
                )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteImportedDoc(String(doc.id));
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                title="Elimina documento"
              >
                <span className="text-sm">✕</span>
              </button>

              {!isPromotedGroup && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();

                    loadImportedDocumentDetail(String(doc.id));

                    if (normalizedType === "PROFORMA") {
                      setSelectedCondomini([]);
                      setCondominiSearch("");
                      setCondomini([]);
                      setIsAssociateModalOpen(true);
                      void loadCondomini();
                    } else if (normalizedType === "FATTURA") {
                      setSelectedFatturaCondominioId("");
                      setSelectedProformaIdsForFattura([]);
                      setCondominiSearch("");
                      setCondomini([]);
                      setIsCreateFatturaModalOpen(true);
                      void loadCondomini();
                      void loadProformasRows();
                    }
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  title="Conferma"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path
                      fillRule="evenodd"
                      d="M16.704 5.29a1 1 0 010 1.42l-7.2 7.2a1 1 0 01-1.42 0l-3.2-3.2a1 1 0 111.42-1.42l2.49 2.49 6.49-6.49a1 1 0 011.42 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>
          </td>
        </tr>

        {isExpanded ? (
          <tr className="border-b border-slate-200 bg-slate-50/70">
            <td colSpan={8} className="px-4 pb-4 pt-0">
              <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          Numero
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {doc.numero || "-"}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          Importo
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {formatAmount(doc.importo)}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Descrizione / dettaglio
                      </div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                        {doc.descrizione || "Nessun dettaglio disponibile."}
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
                      {doc.parse_status === "COMPLETATO_PROMOSSO" ||
                      creationStatusLabel === "PROMOSSO" ? (
                        <span className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-500">
                          Documento già elaborato
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            loadImportedDocumentDetail(String(doc.id));

                            if (normalizedType === "PROFORMA") {
                              setSelectedCondomini([]);
                              setCondominiSearch("");
                              setCondomini([]);
                              setIsAssociateModalOpen(true);
                              void loadCondomini();
                            } else if (normalizedType === "FATTURA") {
                              setSelectedFatturaCondominioId("");
                              setSelectedProformaIdsForFattura([]);
                              setCondominiSearch("");
                              setCondomini([]);
                              setIsCreateFatturaModalOpen(true);
                              void loadCondomini();
                              void loadProformasRows();
                            }
                          }}
                          className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {normalizedType === "PROFORMA"
                            ? "Approva e crea proforma"
                            : normalizedType === "FATTURA"
                            ? "Approva e crea fattura"
                            : "Azione non disponibile"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-blue-50/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>

        <div className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
          {docs.length} document{docs.length === 1 ? "o" : "i"}
        </div>
      </div>

      {loadingImportedDocs ? (
        <div className="px-5 py-10 text-center">
          <div className="mx-auto max-w-md">
            <div className="text-sm font-semibold text-slate-700">
              Caricamento documenti...
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Sto caricando la pagina corrente.
            </p>
          </div>
        </div>
      ) : docs.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="mx-auto max-w-md">
            <div className="text-sm font-semibold text-slate-700">
              Nessun documento presente
            </div>
            <p className="mt-2 text-sm text-slate-500">
              In questa sezione non ci sono documenti che corrispondono al filtro corrente.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div ref={importedTableScrollRef} className="max-h-[620px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100/95 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700 backdrop-blur">
                <tr className="border-b border-slate-200">
                  <th className="w-[56px] px-4 py-3"></th>
                  <th className="px-4 py-3">Numero</th>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Importo</th>
                  <th className="px-4 py-3">Stato</th>
                  <th className="px-4 py-3 text-right">Azioni</th>
                </tr>
              </thead>

              <tbody>
                {activeDocs.length > 0 ? (
                  activeDocs.map((doc, index) =>
                    renderImportedDocRow(doc, index)
                  )
                ) : (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      Nessun documento attivo da lavorare.
                    </td>
                  </tr>
                )}

                {promotedDocs.length > 0 && (
                  <>
                    <tr className="bg-slate-100">
                      <td colSpan={8} className="px-4 py-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowPromotedDocs((prev) => !prev);
                          }}
                          className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          <span className="flex items-center gap-2">
                            <span>Documenti già elaborati</span>

                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                              {promotedDocs.length}
                            </span>
                          </span>

                          <span
                            className={`text-lg transition-transform duration-200 ${
                              showPromotedDocs ? "rotate-90" : ""
                            }`}
                          >
                            ›
                          </span>
                        </button>
                      </td>
                    </tr>

                    {showPromotedDocs &&
                      promotedDocs.map((doc, index) =>
                        renderImportedDocRow(doc, index, true)
                      )}
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-500">
              Pagina {importedDocsPage} di {importedDocsTotalPages}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setImportedDocsPage((p) => Math.max(1, p - 1))}
                disabled={importedDocsPage <= 1 || loadingImportedDocs}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Precedente
              </button>

              <button
                onClick={() =>
                  setImportedDocsPage((p) =>
                    Math.min(importedDocsTotalPages, p + 1)
                  )
                }
                disabled={
                  importedDocsPage >= importedDocsTotalPages || loadingImportedDocs
                }
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Successiva
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
};
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
                {/* Header */}
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

                {/* Body */}
                <div className="mt-7 border-t border-slate-200/80 pt-5">
                  <div className="grid gap-5 md:grid-cols-[1fr_220px] md:items-end">
                    {/* Total */}
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Totale
                      </div>

                      <div className="mt-2 text-4xl font-bold leading-none tracking-tight text-slate-900">
                        {loadingSummary ? (
                          <span className="animate-pulse text-slate-400">...</span>
                        ) : (
                          formatAmount(card.amount)
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => handleCreateManualCard(card.key)}
                        className={`group inline-flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${card.border} ${card.text} bg-white shadow-sm hover:-translate-y-[1px] hover:bg-white hover:shadow-md active:scale-[0.99]`}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:bg-slate-200">
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                          </svg>
                        </span>

                        <span className="flex-1 text-left">
                          {card.key === "proforma"
                            ? "Nuovo proforma"
                            : card.key === "fatture"
                            ? "Nuova fattura"
                            : "Nuovo pagamento"}
                        </span>
                      </button>

                      <button
                        onClick={() => handleOpenDetailSection(card.key)}
                        className="inline-flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-[1px] hover:bg-white hover:shadow-md active:scale-[0.99]"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-500 ring-1 ring-slate-200">
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M3.75 12h16.5" strokeLinecap="round" />
                            <path
                              d="M13.5 5.25L20.25 12 13.5 18.75"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>

                        <span className="flex-1 text-left">Dettagli</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 bg-slate-100/80 px-5 py-3 sm:px-6">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Panoramica aggiornata</span>
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

                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
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

                    <select
                      value={proformaRowsPerPage}
                      onChange={(e) => {
                        setProformaRowsPerPage(Number(e.target.value));
                        setProformaPage(1);
                      }}
                      className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
                    >
                      <option value={5}>5 righe</option>
                      <option value={10}>10 righe</option>
                      <option value={20}>20 righe</option>
                      <option value={50}>50 righe</option>
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
                        paginatedProformasRows.map((row) => (
                          <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-6 py-4 font-semibold text-slate-800">{row.numero}</td>
                            <td className="px-6 py-4 text-slate-700">{row.condominio || "-"}</td>
                            <td className="px-6 py-4 text-slate-700">{row.descrizione || "-"}</td>
                            <td className="px-6 py-4 text-slate-500">{formatDate(row.data_documento)}</td>
                            <td className="px-6 py-4 font-semibold text-slate-900">
                              {euro(Number(row.importo || 0))}
                            </td>
                            <td className="px-6 py-4">
                              <span
                                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                                  statusClass[row.stato] ||
                                  "bg-slate-100 text-slate-700 ring-slate-200"
                                }`}
                              >
                                {String(row.stato || "").replaceAll("_", " ")}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-slate-700">{row.fattura_numero || "-"}</td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                  {row.stato === "EMESSA" ? (
                                    <>
                                      {/* ANNULLA */}
                                      <button
                                        onClick={() => annullaProforma(row.id)}
                                        disabled={annullingId === row.id}
                                        title="Annulla proforma"
                                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-700 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {annullingId === row.id ? (
                                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700" />
                                        ) : (
                                          <svg
                                            viewBox="0 0 24 24"
                                            className="h-4 w-4"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                          >
                                            <path
                                              d="M6 6l12 12M18 6L6 18"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                            />
                                          </svg>
                                        )}
                                      </button>

                                      {/* ELIMINA */}
                                      <button
                                        onClick={() => deleteProforma(row.id)}
                                        disabled={deletingId === row.id}
                                        title="Elimina proforma"
                                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {deletingId === row.id ? (
                                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-rose-300 border-t-rose-700" />
                                        ) : (
                                          <svg
                                            viewBox="0 0 24 24"
                                            className="h-4 w-4"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                          >
                                            <path
                                              d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                            />
                                          </svg>
                                        )}
                                      </button>
                                    </>
                                  ) : (
                                    <div className="px-2 text-xs text-slate-400">-</div>
                                  )}

                                  {/* ASSOCIA */}
                                  <button
                                    onClick={() => {
                                      setLinkingProforma(row);
                                      setSelectedFatturaId("");
                                    }}
                                    disabled={row.stato === "ANNULLATA" || row.fattura_numero != null}
                                    title="Associa a fattura"
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      className="h-4 w-4"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                    >
                                      <path
                                        d="M10 13a5 5 0 007.07 0l1.41-1.41a5 5 0 00-7.07-7.07L10 5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                      <path
                                        d="M14 11a5 5 0 00-7.07 0L5.52 12.41a5 5 0 107.07 7.07L14 19"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </button>

                                  {/* STAMPA */}
                                  <button
                                    onClick={() => void printProformaPdf((row.id))}
                                    disabled={row.stato === "ANNULLATA" || row.fattura_numero != null}
                                    title="Stampa proforma"
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sky-700 shadow-sm transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      className="h-4 w-4"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                    >
                                      <path
                                        d="M7 9V4h10v5M6 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-1"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                      <path
                                        d="M7 14h10v6H7z"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {!loadingProformas && filteredProformasRows.length > 0 ? (
                  <div className="flex flex-col gap-4 border-t border-slate-200 px-5 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
                    <div className="text-sm text-slate-500">
                      Mostrando{" "}
                      <span className="font-semibold text-slate-700">
                        {(proformaPage - 1) * proformaRowsPerPage + 1}
                      </span>{" "}
                      -{" "}
                      <span className="font-semibold text-slate-700">
                        {Math.min(proformaPage * proformaRowsPerPage, filteredProformasRows.length)}
                      </span>{" "}
                      di{" "}
                      <span className="font-semibold text-slate-700">
                        {filteredProformasRows.length}
                      </span>{" "}
                      proforme
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setProformaPage((p) => Math.max(1, p - 1))}
                        disabled={proformaPage === 1}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Precedente
                      </button>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
                        Pagina {proformaPage} di {totalProformaPages}
                      </div>

                      <button
                        onClick={() =>
                          setProformaPage((p) => Math.min(totalProformaPages, p + 1))
                        }
                        disabled={proformaPage === totalProformaPages}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Successiva
                      </button>
                    </div>
                  </div>
                ) : null}
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

                    <select
                      value={fatturaRowsPerPage}
                      onChange={(e) => {
                        setFatturaRowsPerPage(Number(e.target.value));
                        setFatturaPage(1);
                      }}
                      className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
                    >
                      <option value={5}>5 righe</option>
                      <option value={10}>10 righe</option>
                      <option value={20}>20 righe</option>
                      <option value={50}>50 righe</option>
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
                        ) : paginatedFatturaRows.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="px-6 py-8 text-center text-slate-500">
                              Nessuna fattura trovata.
                            </td>
                          </tr>
                        ) : (
                          paginatedFatturaRows.map((row: any) => (
                            
                            <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                              <td className="px-6 py-4 font-semibold text-slate-800">{row.import_numero || row.numero}</td>
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
                                <div className=" ">
                                  <div className="flex items-center gap-2">

                                    {/* VIEW */}
                                    <button
                                      onClick={() => void loadFatturaDetail(row.id)}
                                      title="Apri dettaglio"
                                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-100 hover:text-slate-900"
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="h-4 w-4"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                      >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z" />
                                        <circle cx="12" cy="12" r="3" />
                                      </svg>
                                    </button>

                                    {/* PAYMENT */}
                                    <button
                                      onClick={() => openRegisterPaymentModal(row)}
                                      disabled={row.stato === "ANNULLATA" || row.stato === "PAGATA"}
                                      title="Registra pagamento"
                                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600 shadow-sm transition hover:bg-emerald-100 hover:text-emerald-700 disabled:opacity-40"
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="h-4 w-4"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                      >
                                        <rect x="2" y="5" width="20" height="14" rx="2" />
                                        <path d="M2 10h20" />
                                      </svg>
                                    </button>

                                    {/* CANCEL */}
                                    <button
                                      onClick={() => void annullaFattura(row.id)}
                                      disabled={annullingFatturaId === row.id}
                                      title="Annulla fattura"
                                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600 shadow-sm transition hover:bg-amber-100 hover:text-amber-700 disabled:opacity-40"
                                    >
                                      {annullingFatturaId === row.id ? (
                                        <span className="text-xs">...</span>
                                      ) : (
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          className="h-4 w-4"
                                          fill="none"
                                          viewBox="0 0 24 24"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                        >
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
                                        </svg>
                                      )}
                                    </button>

                                    <div
                                      className="relative inline-flex"
                                      ref={menuRef}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setOpenPrintMenuId(openPrintMenuId === row.id ? null : row.id)
                                        }
                                        disabled={
                                          row.stato === "ANNULLATA" ||
                                          row.fattura_numero != null ||
                                          printingId === row.id
                                        }
                                        title="Stampa fattura"
                                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sky-700 shadow-sm transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {printingId === row.id ? (
                                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                                            <circle
                                              cx="12"
                                              cy="12"
                                              r="10"
                                              stroke="currentColor"
                                              strokeWidth="3"
                                              fill="none"
                                              opacity="0.25"
                                            />
                                            <path
                                              d="M22 12a10 10 0 00-10-10"
                                              stroke="currentColor"
                                              strokeWidth="3"
                                              fill="none"
                                            />
                                          </svg>
                                        ) : (
                                          <svg
                                            viewBox="0 0 24 24"
                                            className="h-4 w-4"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                          >
                                            <path
                                              d="M7 9V4h10v5M6 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-1"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                            />
                                            <path
                                              d="M7 14h10v6H7z"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                            />
                                          </svg>
                                        )}
                                      </button>

                                      {openPrintMenuId === row.id && (
                                        <div className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                                          <button
                                            type="button"
                                            onClick={() => handlePrint(row.id, "color")}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-sky-50 hover:text-sky-700"
                                          >
                                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
                                              <svg
                                                viewBox="0 0 24 24"
                                                className="h-4 w-4"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                              >
                                                <path d="M7 9V4h10v5" strokeLinecap="round" strokeLinejoin="round" />
                                                <path
                                                  d="M6 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-1"
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                />
                                                <path d="M7 14h10v6H7z" strokeLinecap="round" strokeLinejoin="round" />
                                              </svg>
                                            </span>
                                            <span>Stampa normale</span>
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => handlePrint(row.id, "bw")}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                                          >
                                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                                              <svg
                                                viewBox="0 0 24 24"
                                                className="h-4 w-4"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                              >
                                                <circle cx="12" cy="12" r="9" />
                                                <path d="M12 3v18" strokeLinecap="round" />
                                              </svg>
                                            </span>
                                            <span>Bianco e nero</span>
                                          </button>
                                        </div>
                                      )}
                                    </div>

                                  </div>

                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  {!loadingFatture && filteredFatturaRows.length > 0 ? (
                    <div className="flex flex-col gap-4 border-t border-slate-200 px-5 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
                      <div className="text-sm text-slate-500">
                        Mostrando{" "}
                        <span className="font-semibold text-slate-700">
                          {(fatturaPage - 1) * fatturaRowsPerPage + 1}
                        </span>{" "}
                        -{" "}
                        <span className="font-semibold text-slate-700">
                          {Math.min(fatturaPage * fatturaRowsPerPage, filteredFatturaRows.length)}
                        </span>{" "}
                        di{" "}
                        <span className="font-semibold text-slate-700">
                          {filteredFatturaRows.length}
                        </span>{" "}
                        fatture
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setFatturaPage((p) => Math.max(1, p - 1))}
                          disabled={fatturaPage === 1}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Precedente
                        </button>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
                          Pagina {fatturaPage} di {totalFatturaPages}
                        </div>

                        <button
                          onClick={() =>
                            setFatturaPage((p) => Math.min(totalFatturaPages, p + 1))
                          }
                          disabled={fatturaPage === totalFatturaPages}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Successiva
                        </button>
                      </div>
                    </div>
                  ) : null}

                  </div>
                </section>

                {isFatturaDetailModalOpen ? (
                  <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-md"
                    onClick={() => {
                      setIsFatturaDetailModalOpen(false);
                      setSelectedFatturaDetail(null);
                    }}
                  >
                    <div
                      className="relative flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-sky-50/60 px-6 py-5 sm:px-8">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                              Dettaglio fattura
                            </div>

                            <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
                              {selectedFatturaDetail
                                ? `Fattura ${selectedFatturaDetail.numero}`
                                : "Caricamento dettaglio"}
                            </h2>

                            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                              Vista completa della fattura, delle proforme collegate e del credito residuo ancora da associare.
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-3">
                            <button
                              onClick={() => {
                                if (!selectedFatturaDetail) return;

                                setSelectedProformaIdsForExistingFattura([]);
                                setFatturaProformaSearch("");
                                setRegisterPaymentTargetFattura(selectedFatturaDetail);
                                setPaymentForm({
                                  importo: String(Number(selectedFatturaDetail.importo || 0).toFixed(2)),
                                  paymentMethod: "BONIFICO",
                                  dataPagamento: new Date().toISOString().slice(0, 10),
                                  descrizione: `Pagamento fattura ${selectedFatturaDetail.numero || ""}`.trim(),
                                });

                                setIsFatturaDetailModalOpen(false);

                                requestAnimationFrame(() => {
                                  setIsManageFatturaModalOpen(true);
                                });
                              }}
                              className="inline-flex items-center justify-center rounded-2xl border border-fuchsia-300 bg-fuchsia-50 px-4 py-3 text-sm font-semibold text-fuchsia-700 transition hover:border-fuchsia-400 hover:bg-fuchsia-100"
                            >
                              Associa proforme
                            </button>

                            <button
                              onClick={() => {
                                setIsFatturaDetailModalOpen(false);
                                setSelectedFatturaDetail(null);
                              }}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                              title="Chiudi dettaglio"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-5 w-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto bg-slate-50/60">
                        {loadingFatturaDetail || !selectedFatturaDetail ? (
                          <div className="flex min-h-[320px] items-center justify-center px-6 py-10">
                            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-500 shadow-sm">
                              <svg
                                className="h-5 w-5 animate-spin text-sky-600"
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                                />
                              </svg>
                              Caricamento dettaglio...
                            </div>
                          </div>
                        ) : (
                          <section className="space-y-6 p-6 sm:p-8">
                            <div className="grid gap-4 xl:grid-cols-4">
                              <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                  Importo fattura
                                </div>
                                <div className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
                                  {euro(selectedFatturaDetail.importo)}
                                </div>
                                <p className="mt-2 text-xs text-slate-500">
                                  Valore totale del documento emesso.
                                </p>
                              </article>

                              <article className="rounded-[24px] border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 to-white p-5 shadow-sm">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fuchsia-700">
                                  Credito associato
                                </div>
                                <div className="mt-3 text-2xl font-bold tracking-tight text-fuchsia-800">
                                  {euro(selectedFatturaDetail.totale_proforme_collegate)}
                                </div>
                                <p className="mt-2 text-xs text-fuchsia-600/80">
                                  Totale dei proforma già collegati alla fattura.
                                </p>
                              </article>

                              <article className="rounded-[24px] border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">
                                  Residuo da coprire
                                </div>
                                <div className="mt-3 text-2xl font-bold tracking-tight text-amber-800">
                                  {euro(selectedFatturaDetail.residuo_da_associare)}
                                </div>
                                <p className="mt-2 text-xs text-amber-700/80">
                                  Importo ancora scoperto da associare.
                                </p>
                              </article>

                              <article className="rounded-[24px] border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-5 shadow-sm">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-700">
                                  Eccedenza
                                </div>
                                <div className="mt-3 text-2xl font-bold tracking-tight text-rose-800">
                                  {euro(selectedFatturaDetail.eccedenza_proforme)}
                                </div>
                                <p className="mt-2 text-xs text-rose-700/80">
                                  Credito oltre il necessario rispetto all’importo fattura.
                                </p>
                              </article>
                            </div>
                             <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                  Descrizione
                                </div>
                                <div className="mt-3 text-2xl tracking-tight text-slate-900">
                                  {selectedFatturaDetail.descrizione}
                                </div>
 
                              </article>
                            <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                              <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <h3 className="text-lg font-bold text-slate-900">
                                    Proforme collegate
                                  </h3>
                                  <p className="mt-1 text-sm text-slate-500">
                                    Elenco completo delle proforme già associate a questa fattura.
                                  </p>
                                </div>

                                <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                                  {selectedFatturaDetail.proformas.length} elementi
                                </div>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                  <thead className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                    <tr>
                                      <th className="px-6 py-4">Numero proforma</th>
                                      <th className="px-6 py-4">Condominio</th>
                                      <th className="px-6 py-4">Descrizione</th>
                                      <th className="px-6 py-4">Data</th>
                                      <th className="px-6 py-4 text-right">Importo</th>
                                      <th className="px-6 py-4">Stato</th>
                                    </tr>
                                  </thead>

                                  <tbody className="divide-y divide-slate-100">
                                    {selectedFatturaDetail.proformas.length === 0 ? (
                                      <tr>
                                        <td colSpan={6} className="px-6 py-14 text-center">
                                          <div className="mx-auto max-w-md">
                                            <div className="text-sm font-semibold text-slate-700">
                                              Nessuna proforma collegata
                                            </div>
                                            <p className="mt-2 text-sm text-slate-500">
                                              Questa fattura non ha ancora proforme associate. Usa il pulsante in alto per collegarle.
                                            </p>
                                          </div>
                                        </td>
                                      </tr>
                                    ) : (
                                      selectedFatturaDetail.proformas.map((p: any) => (
                                        <tr key={p.id} className="transition hover:bg-slate-50/80">
                                          <td className="px-6 py-4">
                                            <div className="font-semibold text-slate-800">{p.numero}</div>
                                          </td>

                                          <td className="px-6 py-4 text-slate-700">
                                            {p.condominio || "-"}
                                          </td>

                                          <td className="px-6 py-4 text-slate-700">
                                            <div className="max-w-[320px] truncate">
                                              {p.descrizione || "-"}
                                            </div>
                                          </td>

                                          <td className="px-6 py-4 text-slate-500">
                                            {formatDate(p.data_documento)}
                                          </td>

                                          <td className="px-6 py-4 text-right font-semibold text-slate-900">
                                            {euro(p.importo)}
                                          </td>

                                          <td className="px-6 py-4">
                                            {p.stato === "COLLEGATA" ? (
                                              <button
                                                onClick={() => {
                                                  if (!confirm("Rimuovere la proforma dalla fattura?")) return;
                                                  handleResetProforma(p);
                                                }}
                                                className="inline-flex items-center gap-2 rounded-full bg-fuchsia-100 px-3 py-1 text-xs font-semibold text-fuchsia-700 ring-1 ring-fuchsia-200 transition hover:bg-fuchsia-200"
                                              >
                                                {String(p.stato).replaceAll("_", " ")}
                                                <span className="text-[10px] opacity-70">(reset)</span>
                                              </button>
                                            ) : (
                                              <span
                                                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                                                  statusClass[p.stato] || "bg-slate-100 text-slate-700 ring-slate-200"
                                                }`}
                                              >
                                                {String(p.stato || "").replaceAll("_", " ")}
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          </section>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
            {activeDetailSection === "PAGAMENTO" ? (
              <section className="space-y-6">
                <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-xl font-bold">Dettaglio incassato</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Elenco completo dei pagamenti registrati e delle allocazioni sulle fatture.
                      </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <input
                        value={paymentSearch}
                        onChange={(e) => setPaymentSearch(e.target.value)}
                        placeholder="Cerca numero, metodo, descrizione..."
                        className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
                      />

                      <select
                        value={paymentStatusFilter}
                        onChange={(e) => setPaymentStatusFilter(e.target.value)}
                        className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-400"
                      >
                        <option value="TUTTI">Tutti gli stati</option>
                        <option value="REGISTRATO">Registrato</option>
                        <option value="PARZIALMENTE_ALLOCATO">Parzialmente allocato</option>
                        <option value="ALLOCATO">Allocato</option>
                        <option value="ANNULLATO">Annullato</option>
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
                          <SortablePaymentHeader label="Numero" sortKey="numero" activeKey={paymentSortKey} direction={paymentSortDirection} onSort={handlePaymentSort} />
                          <SortablePaymentHeader label="Metodo" sortKey="payment_method" activeKey={paymentSortKey} direction={paymentSortDirection} onSort={handlePaymentSort} />
                          <SortablePaymentHeader label="Data" sortKey="data_pagamento" activeKey={paymentSortKey} direction={paymentSortDirection} onSort={handlePaymentSort} />
                          <SortablePaymentHeader label="Importo" sortKey="importo" activeKey={paymentSortKey} direction={paymentSortDirection} onSort={handlePaymentSort} align="right" />
                          <SortablePaymentHeader label="Totale allocato" sortKey="totale_allocato" activeKey={paymentSortKey} direction={paymentSortDirection} onSort={handlePaymentSort} align="right" />
                          <SortablePaymentHeader label="Stato" sortKey="stato" activeKey={paymentSortKey} direction={paymentSortDirection} onSort={handlePaymentSort} />
                          <SortablePaymentHeader label="Descrizione" sortKey="descrizione" activeKey={paymentSortKey} direction={paymentSortDirection} onSort={handlePaymentSort} />
                          <th className="px-6 py-4 text-right">Azioni</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingPayments ? (
                          <tr>
                            <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                              Caricamento pagamenti...
                            </td>
                          </tr>
                        ) : filteredPaymentsRows.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                              Nessun pagamento trovato.
                            </td>
                          </tr>
                        ) : (
                          filteredPaymentsRows.map((row) => (
                            <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                              <td className="px-6 py-4 font-semibold text-slate-800">{row.numero}</td>
                              <td className="px-6 py-4 text-slate-700">{row.payment_method || "-"}</td>
                              <td className="px-6 py-4 text-slate-500">{formatDate(row.data_pagamento)}</td>
                              <td className="px-6 py-4 text-right font-semibold text-slate-900">
                                {euro(row.importo)}
                              </td>
                              <td className="px-6 py-4 text-right font-semibold text-emerald-700">
                                {euro(row.totale_allocato)}
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
                              <td className="px-6 py-4 text-slate-700">{row.descrizione || "-"}</td>
                              <td className="px-6 py-4 text-right">
                                <button
                                  onClick={() => void loadPaymentDetail(row.id)}
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

                {selectedPaymentDetail ? (
                  <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-[2px]"
                    onMouseDown={() => setSelectedPaymentDetail(null)}
                  >
                  <section
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="payment-detail-title"
                    onMouseDown={(event) => event.stopPropagation()}
                    className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.28)]"
                  >
                    <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 id="payment-detail-title" className="text-xl font-bold">Dettaglio pagamento {selectedPaymentDetail.numero}</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          Allocazioni del pagamento sulle fatture collegate.
                        </p>
                      </div>

                      <button
                        onClick={() => setSelectedPaymentDetail(null)}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                      >
                        Chiudi dettaglio
                      </button>
                    </div>

                    <div className="grid gap-4 p-6 lg:grid-cols-4">
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Importo pagamento
                        </div>
                        <div className="mt-2 text-xl font-bold text-slate-900">
                          {euro(selectedPaymentDetail.importo)}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-emerald-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                          Metodo
                        </div>
                        <div className="mt-2 text-xl font-bold text-emerald-800">
                          {selectedPaymentDetail.payment_method || "-"}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-sky-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">
                          Data pagamento
                        </div>
                        <div className="mt-2 text-xl font-bold text-sky-800">
                          {formatDate(selectedPaymentDetail.data_pagamento)}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Stato
                        </div>
                        <div className="mt-2">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                              statusClass[selectedPaymentDetail.stato] ||
                              "bg-slate-100 text-slate-700 ring-slate-200"
                            }`}
                          >
                            {String(selectedPaymentDetail.stato || "").replaceAll("_", " ")}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto border-t border-slate-200">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          <tr>
                            <th className="px-6 py-4">Fattura</th>
                            <th className="px-6 py-4">Condominio</th>
                            <th className="px-6 py-4 text-right">Importo fattura</th>
                            <th className="px-6 py-4 text-right">Importo allocato</th>
                            <th className="px-6 py-4">Data allocazione</th>
                            <th className="px-6 py-4">Descrizione</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loadingPaymentDetail ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                                Caricamento dettaglio...
                              </td>
                            </tr>
                          ) : selectedPaymentDetail.allocations.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                                Nessuna allocazione trovata.
                              </td>
                            </tr>
                          ) : (
                            selectedPaymentDetail.allocations.map((a) => (
                              <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-6 py-4 font-semibold text-slate-800">{a.fattura_numero}</td>
                                <td className="px-6 py-4 text-slate-700">{a.condominio || "-"}</td>
                                <td className="px-6 py-4 text-right font-semibold text-slate-900">
                                  {euro(a.fattura_importo)}
                                </td>
                                <td className="px-6 py-4 text-right font-semibold text-emerald-700">
                                  {euro(a.importo_allocato)}
                                </td>
                                <td className="px-6 py-4 text-slate-500">
                                  {formatDate(a.data_allocazione)}
                                </td>
                                <td className="px-6 py-4 text-slate-700">{a.descrizione || "-"}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  </div>
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
            <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/65 backdrop-blur-[10px]">
              <div className="flex min-h-full items-center justify-center p-3 sm:p-6">
                <div className="relative flex w-full max-w-7xl flex-col overflow-hidden rounded-[34px] border border-white/20 bg-white shadow-[0_35px_120px_rgba(15,23,42,0.30)]">
                  {/* Soft ambient */}
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-r from-sky-50 via-cyan-50 to-emerald-50" />
                    <div className="absolute -left-12 top-8 h-40 w-40 rounded-full bg-sky-200/30 blur-3xl" />
                    <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-emerald-200/25 blur-3xl" />
                    <div className="absolute bottom-0 left-1/3 h-36 w-36 rounded-full bg-violet-200/15 blur-3xl" />
                  </div>

                  <div className="relative flex max-h-[calc(100vh-24px)] flex-col sm:max-h-[calc(100vh-48px)]">
                    {/* Header */}
                    <div className="shrink-0 border-b border-slate-200/80 bg-white/80 px-4 py-4 backdrop-blur-xl sm:px-8 sm:py-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 shadow-sm">
                            <span className="h-2 w-2 rounded-full bg-sky-500" />
                            Associazione documento
                          </div>

                          <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 sm:text-[32px]">
                            Associa il documento ai condomini
                          </h3>

                          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:text-[15px]">
                            Seleziona uno o più condomini e genera automaticamente una nuova
                            proforma per ciascuno usando i dati del documento importato.
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
                      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[1.35fr_0.75fr] xl:p-8">
                        {/* Left column */}
                        <div className="space-y-6">
                          {/* Document hero */}
                          <section className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-white/90 shadow-[0_12px_35px_rgba(15,23,42,0.06)]">
                            <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 bg-gradient-to-r from-white via-slate-50 to-sky-50 px-5 py-4">
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                  Documento importato
                                </div>
                                <div className="mt-1 text-sm font-medium text-slate-700">
                                  Dati estratti usati per la generazione
                                </div>
                              </div>

                              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                Pronto
                              </div>
                            </div>

                            <div className="grid gap-4 p-5 sm:grid-cols-2">
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Numero
                                </div>
                                <div className="mt-2 break-words text-sm font-semibold text-slate-900">
                                  {selectedImportedDoc.extracted?.numero || "-"}
                                </div>
                              </div>

                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Data
                                </div>
                                <div className="mt-2 text-sm font-semibold text-slate-900">
                                  {selectedImportedDoc.extracted?.data_documento || "-"}
                                </div>
                              </div>

                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4 sm:col-span-2">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Descrizione
                                </div>
                                <div className="mt-2 break-words text-sm leading-6 text-slate-700">
                                  {selectedImportedDoc.extracted?.descrizione || "-"}
                                </div>
                              </div>

                              <div className="rounded-[26px] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-5 text-white shadow-[0_20px_50px_rgba(15,23,42,0.20)] sm:col-span-2">
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
                          <section className="rounded-[30px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                            <div className="mb-4">
                              <div className="text-sm font-semibold text-slate-900">
                                Cerca condominio
                              </div>
                              <div className="mt-1 text-sm text-slate-500">
                                Filtra per indirizzo, amministratore o riferimento utile.
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
                          <section className="rounded-[30px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-base font-semibold text-slate-950">
                                  Condomini disponibili
                                </div>
                                <div className="mt-1 text-sm text-slate-500">
                                  Seleziona uno o più condomini da associare.
                                </div>
                              </div>

                              <div className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                                {filteredCondomini.length} risultati
                              </div>
                            </div>

                            <div className="max-h-[380px] space-y-3 overflow-y-auto pr-1">
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
                                      className={`group w-full rounded-[24px] border p-4 text-left transition-all ${
                                        isSelected
                                          ? "border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 shadow-[0_12px_28px_rgba(16,185,129,0.10)]"
                                          : "border-slate-200 bg-slate-50/80 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
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
                                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition ${
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
                          <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.08)] xl:sticky xl:top-0">
                            <div className="border-b border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-5 py-5 text-white">
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
                            </div>

                            <div className="space-y-5 p-5">
                              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                    Condomini selezionati
                                  </div>
                                  <div className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
                                    {selectedCondomini.length}
                                  </div>
                                </div>

                                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                    Proforme da creare
                                  </div>
                                  <div className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
                                    {selectedCondomini.length}
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-[22px] border border-slate-200 bg-sky-50/70 p-4">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Azione prevista
                                </div>
                                <p className="mt-2 text-sm leading-6 text-slate-700">
                                  Verrà generata una proforma distinta per ogni condominio
                                  selezionato, usando i dati del documento importato come base.
                                </p>
                              </div>

                              <div>
                                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Condomini selezionati
                                </div>

                                {selectedCondomini.length === 0 ? (
                                  <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                                    Nessun condominio selezionato.
                                  </div>
                                ) : (
                                  <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                                    {selectedCondomini.map((c, index) => (
                                      <div
                                        key={c.id}
                                        className="flex items-center justify-between gap-3 rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-3"
                                      >
                                        <div className="flex min-w-0 items-center gap-3">
                                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
                                            {index + 1}
                                          </div>

                                          <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-slate-900">
                                              {c.indirizzo}
                                            </div>
                                          </div>
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => toggleCondominio(c)}
                                          className="shrink-0 rounded-xl px-2.5 py-1.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                                        >
                                          Rimuovi
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {error ? (
                                <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                                  {error}
                                </div>
                              ) : null}
                            </div>
                          </section>
                        </div>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="shrink-0 border-t border-slate-200/80 bg-white/90 px-4 py-4 backdrop-blur sm:px-8">
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
                            className="rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(15,23,42,0.18)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
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
                  {/* <div>
                    <h3 className="text-sm font-semibold text-slate-900">Documenti importati</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Le funzioni principali sono caricamento, parser e dettaglio espandibile.
                    </p>
                  </div> */}

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
                      <div className="mb-4 flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                        <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                          <button
                            onClick={() => setActiveImportTab("PROFORMA")}
                            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                              activeImportTab === "PROFORMA"
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                            }`}
                          >
                            Proforme
                          </button>

                          <button
                            onClick={() => setActiveImportTab("FATTURA")}
                            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                              activeImportTab === "FATTURA"
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                            }`}
                          >
                            Fatture
                          </button>
                        </div>
{/* 
                        <input
                          value={importedDocsSearch}
                          onChange={(e) => setImportedDocsSearch(e.target.value)}
                          placeholder="Cerca numero, file, descrizione..."
                          className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-slate-400 sm:max-w-sm"
                        /> */}
                      </div>
                      <div className="space-y-8">
                        {renderImportedTableSection(
                          activeImportTab === "PROFORMA" ? "PROFORMA IMPORTATI" : "FATTURE IMPORTATE",
                          activeImportTab === "PROFORMA"
                            ? "In alto trovi i documenti del tipo proforma ordinati dal backend per priorità di parsing, numero e data."
                            : "In alto trovi i documenti del tipo fattura ordinati dal backend per priorità di parsing, numero e data.",
                          importedDocs
                        )}
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
          {/* cazz */}
          {isCreateFatturaModalOpen && selectedImportedDoc && activeImportTab === "FATTURA" ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-4 backdrop-blur-[2px]">
              <div className="relative flex h-[98vh] w-full max-w-[1450px] flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.18)]">
                <div className="h-1.5 w-full bg-gradient-to-r from-fuchsia-400 via-violet-500 to-indigo-500" />

                {/* header */}
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
                  <div className="min-w-0">
                    <div className="inline-flex items-center rounded-full border border-fuchsia-200 bg-fuchsia-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-fuchsia-700">
                      Approvazione documento
                    </div>

                    <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-900">
                      Crea fattura
                    </h3>

                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                      Seleziona il condominio della fattura e collega una o più proforme esistenti.
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setIsCreateFatturaModalOpen(false);
                      setSelectedFatturaCondominioId("");
                      setSelectedProformaIdsForFattura([]);
                      setFatturaProformaSearch("");
                      setFatturaCondominioSearch("");
                    }}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                    title="Chiudi"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* body */}
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                    <div className="space-y-5">
                      
                      {/* TOP STRIP: document details + condominio + quick totals */}
                      <section className="grid gap-4 xl:grid-cols-[1.25fr_1fr_0.9fr]">
                        {/* document details */}
                        <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Documento da approvare
                          </div>

                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                Numero
                              </div>
                              <div className="mt-1 text-sm font-semibold text-slate-900">
                                {selectedImportedDoc.extracted?.numero || "-"}
                              </div>
                            </div>

                            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                Data
                              </div>
                              <div className="mt-1 text-sm font-semibold text-slate-900">
                                {selectedImportedDoc.extracted?.data_documento || "-"}
                              </div>
                            </div>

                            <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 px-4 py-3 shadow-sm sm:col-span-2">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-700">
                                Importo
                              </div>
                              <div className="mt-1 text-lg font-extrabold text-fuchsia-800">
                                {selectedImportedDoc.extracted?.importo != null
                                  ? euro(selectedImportedDoc.extracted.importo)
                                  : "-"}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Descrizione
                            </div>
                            <div className="mt-1 text-sm leading-6 text-slate-700">
                              {selectedImportedDoc.extracted?.descrizione || "-"}
                            </div>
                          </div>
                        </div>

                        {/* searchable condominio selector */}
                        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                          <label className="mb-2 block text-sm font-semibold text-slate-700">
                            Condominio della fattura
                          </label>

                          <input
                            type="text"
                            value={fatturaCondominioSearch}
                            onChange={(e) => setFatturaCondominioSearch(e.target.value)}
                            placeholder="Cerca indirizzo..."
                            className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-100"
                          />

                          <div className="mt-2 max-h-48 overflow-auto rounded-2xl border border-slate-200 bg-white">
                            <button
                              type="button"
                              onClick={() => setSelectedFatturaCondominioId("")}
                              className={`block w-full px-4 py-3 text-left text-sm transition hover:bg-slate-50 ${
                                !selectedFatturaCondominioId
                                  ? "bg-fuchsia-50 font-semibold text-fuchsia-700"
                                  : "text-slate-700"
                              }`}
                            >
                              Nessun condominio selezionato
                            </button>

                            {condomini
                              .filter((c) =>
                                `${c.indirizzo || ""}`.toLowerCase().includes(fatturaCondominioSearch.toLowerCase())
                              )
                              .map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedFatturaCondominioId(String(c.id));
                                    setFatturaCondominioSearch(c.indirizzo || "");
                                  }}
                                  className={`block w-full px-4 py-3 text-left text-sm transition hover:bg-slate-50 ${
                                    String(selectedFatturaCondominioId) === String(c.id)
                                      ? "bg-fuchsia-50 font-semibold text-fuchsia-700"
                                      : "text-slate-700"
                                  }`}
                                >
                                  {c.indirizzo}
                                </button>
                              ))}
                          </div>

                          <p className="mt-3 text-xs leading-5 text-slate-500">
                            La fattura viene intestata a un condominio, ma può includere proforme di condomini diversi dello stesso amministratore.
                          </p>
                        </div>

                        {/* quick summary */}
                        <div className="rounded-[24px] border border-fuchsia-200 bg-fuchsia-50 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-700">
                            Riepilogo
                          </div>

                          <div className="mt-4 space-y-3">
                            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-fuchsia-200/70">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                Condominio selezionato
                              </div>
                              <div className="mt-1 text-sm font-semibold text-slate-900">
                                {selectedFatturaCondominioId
                                  ? condomini.find((c) => String(c.id) === String(selectedFatturaCondominioId))
                                      ?.indirizzo || "-"
                                  : "-"}
                              </div>
                            </div>

                            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-fuchsia-200/70">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                Proforme selezionate
                              </div>
                              <div className="mt-1 text-sm font-semibold text-slate-900">
                                {selectedProformaIdsForFattura.length}
                              </div>
                            </div>

                            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-fuchsia-200/70">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-700">
                                Totale selezionato
                              </div>
                              <div className="mt-1 text-lg font-extrabold text-fuchsia-800">
                                {new Intl.NumberFormat("it-IT", {
                                  style: "currency",
                                  currency: "EUR",
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }).format(
                                  availableProformasForFattura
                                    .filter((p) => selectedProformaIdsForFattura.includes(p.id))
                                    .reduce((sum, p) => sum + Number(p.importo || 0), 0)
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </section>

                      {/* TABLE */}
                      <section className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
                        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
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
                              className="h-11 w-full min-w-[280px] rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-100"
                            />
                            <button
                              onClick={() => void loadProformasRows()}
                              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                            >
                              Aggiorna
                            </button>
                          </div>
                        </div>

                        <div className="max-h-[360px] overflow-auto">
                          <table className="min-w-full text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              <tr className="border-b border-slate-200">
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
                                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                                    Caricamento proforme...
                                  </td>
                                </tr>
                              ) : filteredAvailableProformasForFattura.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                                    Nessuna proforma disponibile.
                                  </td>
                                </tr>
                              ) : (
                                filteredAvailableProformasForFattura.map((p, index) => {
                                  const checked = selectedProformaIdsForFattura.includes(p.id);

                                  return (
                                    <tr
                                      key={p.id}
                                      className={`border-b border-slate-100 transition ${
                                        checked
                                          ? "bg-fuchsia-50"
                                          : index % 2 === 0
                                          ? "bg-white hover:bg-slate-50"
                                          : "bg-slate-50/60 hover:bg-slate-100/70"
                                      }`}
                                    >
                                      <td className="px-4 py-3">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedProformaIdsForFattura((prev) =>
                                                prev.includes(p.id) ? prev : [...prev, p.id]
                                              );
                                            } else {
                                              setSelectedProformaIdsForFattura((prev) =>
                                                prev.filter((id) => id !== p.id)
                                              );
                                            }
                                          }}
                                          className="h-4 w-4 rounded border-slate-300 text-fuchsia-600 focus:ring-fuchsia-500"
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
                      </section>

                      {/* SELECTED AREA UNDER TABLE */}
                      <section className="rounded-[24px] border border-fuchsia-200 bg-fuchsia-50 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-700">
                          Proforme selezionate
                        </div>

                        <div className="mt-3 max-h-32 overflow-auto pr-1">
                          <div className="flex flex-wrap gap-2">
                            {selectedProformaIdsForFattura.length === 0 ? (
                              <div className="text-sm text-slate-500">Nessuna proforma selezionata.</div>
                            ) : (
                              availableProformasForFattura
                                .filter((p) => selectedProformaIdsForFattura.includes(p.id))
                                .map((p) => (
                                  <span
                                    key={p.id}
                                    className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-medium text-fuchsia-800 ring-1 ring-fuchsia-200"
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
                        </div>

                        {error ? (
                          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            {error}
                          </div>
                        ) : null}
                      </section>
                    </div>
                  </div>
                </div>

                {/* footer */}
                <div className="flex shrink-0 flex-col-reverse items-stretch justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                  <div className="text-xs text-slate-500">
                    Verifica condominio e proforme collegate prima della conferma.
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setIsCreateFatturaModalOpen(false);
                        setSelectedFatturaCondominioId("");
                        setSelectedProformaIdsForFattura([]);
                        setFatturaProformaSearch("");
                        setFatturaCondominioSearch("");
                      }}
                      className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      Annulla
                    </button>

                    <button
                      onClick={promoteImportedFattura}
                      disabled={promotingFattura || !selectedFatturaCondominioId}
                      className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {promotingFattura ? "Creazione..." : "Conferma e crea fattura"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isManageFatturaModalOpen && selectedFatturaDetail ? (
            <div className="fixed inset-0 z-50 overflow-hidden">
              {/* Backdrop */}
              <div
                className="absolute inset-0 bg-slate-950/55 backdrop-blur-[3px]"
                onClick={() => {
                  setIsManageFatturaModalOpen(false);
                  setSelectedProformaIdsForExistingFattura([]);
                  setFatturaProformaSearch("");
                }}
              />

              {/* Modal shell */}
              <div className="relative flex h-full w-full items-center justify-center p-4 lg:p-6">
                <div
                  className="relative flex h-[92vh] w-full max-w-[1800px] flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-slate-50 shadow-[0_25px_80px_rgba(15,23,42,0.30)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-5 sm:px-7">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="inline-flex items-center rounded-full border border-fuchsia-200 bg-fuchsia-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-fuchsia-700">
                          Gestione collegamenti
                        </div>

                        <h3 className="mt-3 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                          Associa proforme alla fattura{" "}
                          <span className="text-fuchsia-700">{selectedFatturaDetail.numero}</span>
                        </h3>

                        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                          Seleziona le proforme da collegare per coprire il residuo della fattura.
                          La parte sinistra mostra ciò che è già associato, mentre a destra puoi
                          scegliere nuove proforme disponibili.
                        </p>
                      </div>

                      <button
                        onClick={() => {
                          setIsManageFatturaModalOpen(false);
                          setSelectedProformaIdsForExistingFattura([]);
                          setFatturaProformaSearch("");
                        }}
                        className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        Chiudi
                      </button>
                    </div>

                    {/* Top summary */}
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Totale fattura
                        </div>
                        <div className="mt-1 text-lg font-bold text-slate-900">
                          {euro(Number(selectedFatturaDetail.importo || 0))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Già associato
                        </div>
                        <div className="mt-1 text-lg font-bold text-emerald-700">
                          {euro(
                            filteredAssociatedProformasForExistingFattura.reduce(
                              (sum, p) => sum + Number(p.importo || 0),
                              0
                            )
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Selezionate ora
                        </div>
                        <div className="mt-1 text-lg font-bold text-fuchsia-700">
                          {euro(
                            filteredAvailableProformasForExistingFattura
                              .filter((p) => selectedProformaIdsForExistingFattura.includes(p.id))
                              .reduce((sum, p) => sum + Number(p.importo || 0), 0)
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Numero selezioni
                        </div>
                        <div className="mt-1 text-lg font-bold text-slate-900">
                          {selectedProformaIdsForExistingFattura.length}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-6">
                    <div className="grid h-full gap-6 xl:grid-cols-[1fr_1fr]">
                      {/* LEFT */}
                      <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                              <h4 className="text-base font-bold text-slate-900">
                                Proforme già associate
                              </h4>
                              <p className="mt-1 text-sm text-slate-500">
                                Elenco delle proforme già collegate a questa fattura.
                              </p>
                            </div>

                            <div className="w-full lg:w-[280px]">
                              <input
                                value={fatturaAssociatedProformaSearch}
                                onChange={(e) => setFatturaAssociatedProformaSearch(e.target.value)}
                                placeholder="Cerca tra le associate..."
                                className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-auto">
                          <table className="min-w-full text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 shadow-sm">
                              <tr>
                                <th className="px-4 py-3">Numero</th>
                                <th className="px-4 py-3">Condominio</th>
                                <th className="px-4 py-3">Descrizione</th>
                                <th className="px-4 py-3 text-right">Importo</th>
                                <th className="px-4 py-3">Stato</th>
                              </tr>
                            </thead>

                            <tbody>
                              {filteredAssociatedProformasForExistingFattura.length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                                    Nessuna proforma già associata.
                                  </td>
                                </tr>
                              ) : (
                                filteredAssociatedProformasForExistingFattura.map((p, idx) => (
                                  <tr
                                    key={p.id}
                                    className={`border-t border-slate-100 transition ${
                                      idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                                    } hover:bg-slate-50`}
                                  >
                                    <td className="px-4 py-3 font-semibold text-slate-800">
                                      {p.numero}
                                    </td>
                                    <td className="px-4 py-3 text-slate-700">
                                      {p.condominio || "-"}
                                    </td>
                                    <td className="px-4 py-3 text-slate-700">
                                      {p.descrizione || "-"}
                                    </td>
                                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                      {euro(Number(p.importo || 0))}
                                    </td>
                                    <td className="px-4 py-3">
                                      <span
                                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
                                          statusClass[p.stato] ||
                                          "bg-slate-100 text-slate-700 ring-slate-200"
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

                      {/* RIGHT */}
                      <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                              <h4 className="text-base font-bold text-slate-900">
                                Proforme disponibili da associare
                              </h4>
                              <p className="mt-1 text-sm text-slate-500">
                                Seleziona solo le proforme ancora non collegate a una fattura.
                              </p>
                            </div>

                            <div className="w-full lg:w-[280px]">
                              <input
                                value={fatturaProformaSearch}
                                onChange={(e) => setFatturaProformaSearch(e.target.value)}
                                placeholder="Cerca tra le disponibili..."
                                className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-auto">
                          <table className="min-w-full text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 shadow-sm">
                              <tr>
                                <th className="w-[72px] px-4 py-3">Sel.</th>
                                <th className="px-4 py-3">Numero</th>
                                <th className="px-4 py-3">Condominio</th>
                                <th className="px-4 py-3">Descrizione</th>
                                <th className="px-4 py-3 text-right">Importo</th>
                                <th className="px-4 py-3">Stato</th>
                              </tr>
                            </thead>

                            <tbody>
                              {filteredAvailableProformasForExistingFattura.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                                    Nessuna proforma disponibile.
                                  </td>
                                </tr>
                              ) : (
                                filteredAvailableProformasForExistingFattura.map((p, idx) => {
                                  const checked = selectedProformaIdsForExistingFattura.includes(p.id);

                                  return (
                                    <tr
                                      key={p.id}
                                      className={`border-t border-slate-100 transition ${
                                        checked
                                          ? "bg-fuchsia-50/70"
                                          : idx % 2 === 0
                                          ? "bg-white"
                                          : "bg-slate-50/50"
                                      } hover:bg-fuchsia-50/40`}
                                    >
                                      <td className="px-4 py-3">
                                        <label className="flex items-center justify-center">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setSelectedProformaIdsForExistingFattura((prev) =>
                                                  prev.includes(p.id) ? prev : [...prev, p.id]
                                                );
                                              } else {
                                                setSelectedProformaIdsForExistingFattura((prev) =>
                                                  prev.filter((id) => id !== p.id)
                                                );
                                              }
                                            }}
                                            className="h-4 w-4 rounded border-slate-300 text-fuchsia-600 focus:ring-fuchsia-500"
                                          />
                                        </label>
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
                                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                        {euro(Number(p.importo || 0))}
                                      </td>
                                      <td className="px-4 py-3">
                                        <span
                                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
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
                      </section>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-slate-500">
                        {selectedProformaIdsForExistingFattura.length > 0 ? (
                          <>
                            Hai selezionato{" "}
                            <span className="font-semibold text-slate-900">
                              {selectedProformaIdsForExistingFattura.length}
                            </span>{" "}
                            proforme.
                          </>
                        ) : (
                          "Nessuna proforma selezionata."
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => {
                            setIsManageFatturaModalOpen(false);
                            setSelectedProformaIdsForExistingFattura([]);
                            setFatturaProformaSearch("");
                          }}
                          className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          Annulla
                        </button>

                        <button
                          onClick={collegaProformeAFatturaEsistente}
                          disabled={
                            linkingProformasToFattura || !selectedProformaIdsForExistingFattura.length
                          }
                          className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {linkingProformasToFattura ? "Collegamento..." : "Conferma collegamento"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isRegisterPaymentModalOpen && registerPaymentTargetFattura ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]">
              <div className="relative w-full max-w-4xl overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.18)]">
                {/* top accent */}
                <div className="h-1.5 w-full bg-gradient-to-r from-emerald-400 via-sky-400 to-blue-500" />

                {/* header */}
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 sm:px-7">
                  <div className="min-w-0">
                    <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                      Registrazione pagamento
                    </div>

                    <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
                      Registra pagamento fattura
                    </h3>

                    <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                      Il pagamento verrà registrato e allocato interamente sulla fattura selezionata.
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setIsRegisterPaymentModalOpen(false);
                      setRegisterPaymentTargetFattura(null);
                    }}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                    title="Chiudi"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* body */}
                <div className="grid gap-6 px-6 py-6 sm:px-7 lg:grid-cols-[360px_minmax(0,1fr)]">
                  {/* left summary */}
                  <aside className="space-y-4">
                    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50/80">
                      <div className="border-b border-slate-200 bg-white/80 px-5 py-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Fattura selezionata
                        </div>
                        <div className="mt-2 text-lg font-bold text-slate-900">
                          {registerPaymentTargetFattura.numero || "-"}
                        </div>
                      </div>

                      <div className="space-y-4 px-5 py-5">
                        <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Condominio
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-800">
                            {registerPaymentTargetFattura.condominio || "-"}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Importo fattura
                            </div>
                            <div className="mt-1 text-base font-bold text-slate-900">
                              {euro(Number(registerPaymentTargetFattura.importo || 0))}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Credito associato
                            </div>
                            <div className="mt-1 text-base font-bold text-slate-900">
                              {euro(Number(registerPaymentTargetFattura.totale_proforme_collegate || 0))}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm sm:col-span-2 lg:col-span-1 xl:col-span-2">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                              Residuo da pagare
                            </div>
                            <div className="mt-1 text-lg font-extrabold text-emerald-800">
                              {euro(Number(registerPaymentTargetFattura.residuo_da_associare || 0))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </aside>

                  {/* right form */}
                  <section className="space-y-5">
                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">
                          Importo pagamento
                        </label>
                        <div className="relative">
                         
                          <input
                            type="number"
                            step="0.01"
                              value={paymentForm.importo}
                              onChange={(e) =>
                                setPaymentForm((prev) => ({ ...prev, importo: e.target.value }))
                              }
                            className="h-12 w-full rounded-2xl border border-slate-300 bg-white pl-9 pr-4 text-sm font-semibold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                            placeholder="0.00"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">
                          Metodo di pagamento
                        </label>
                        <select
                          value={paymentForm.paymentMethod}
                          onChange={(e) =>
                            setPaymentForm((prev) => ({ ...prev, paymentMethod: e.target.value }))
                          }
                          className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                        >
                          <option value="BONIFICO">Bonifico</option>
                          <option value="CONTANTI">Contanti</option>
                          <option value="CARTA">Carta</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">
                          Data pagamento
                        </label>
                        <input
                          type="date"
                          value={paymentForm.dataPagamento}
                          onChange={(e) =>
                            setPaymentForm((prev) => ({ ...prev, dataPagamento: e.target.value }))
                          }
                          className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                        />
                      </div>

                      <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Allocazione
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">
                          Questo pagamento sarà registrato direttamente sulla fattura corrente senza ripartizione multipla.
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Descrizione
                      </label>
                      <textarea
                        value={paymentForm.descrizione}
                        onChange={(e) =>
                          setPaymentForm((prev) => ({ ...prev, descrizione: e.target.value }))
                        }
                        rows={5}
                        placeholder="Es. saldo fattura tramite bonifico bancario"
                        className="w-full rounded-[24px] border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                      />
                    </div>
                  </section>
                </div>

                {/* footer */}
                <div className="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-6 py-4 sm:flex-row sm:items-center sm:px-7">
                  <div className="text-xs text-slate-500">
                    Verifica importo e data prima della conferma.
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setIsRegisterPaymentModalOpen(false);
                        setRegisterPaymentTargetFattura(null);
                      }}
                      className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      Annulla
                    </button>

                    <button
                      onClick={registraPagamentoFattura}
                      disabled={registeringPayment}
                      className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {registeringPayment ? "Registrazione..." : "Conferma pagamento"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isCreateManualProformaModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]">
              <div className="relative w-full max-w-3xl overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.18)]">
                <div className="h-1.5 w-full bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500" />

                {/* header */}
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 sm:px-7">
                  <div className="min-w-0">
                    <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                      Creazione manuale
                    </div>

                    <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
                      Nuovo proforma
                    </h3>

                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      Inserisci i dati principali e genera manualmente un nuovo proforma.
                    </p>
                  </div>

                  <button
                    onClick={() => setIsCreateManualProformaModalOpen(false)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                    title="Chiudi"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* body */}
                <div className="grid gap-6 px-6 py-6 sm:px-7 lg:grid-cols-[1fr_320px]">
                  {/* form */}
                  <div className="space-y-5">
                    {/* searchable condominio */}
                    <div className="relative">
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Condominio
                      </label>

                      <input
                        type="text"
                        value={condominiSearch}
                        onChange={(e) => setCondominiSearch(e.target.value)}
                        placeholder="Cerca indirizzo condominio..."
                        className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                      />

                      <div className="mt-2 max-h-56 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <button
                          type="button"
                          onClick={() =>
                            setManualProformaForm((prev) => ({ ...prev, condominioId: "" }))
                          }
                          className={`block w-full px-4 py-3 text-left text-sm transition hover:bg-slate-50 ${
                            !manualProformaForm.condominioId
                              ? "bg-sky-50 font-semibold text-sky-700"
                              : "text-slate-700"
                          }`}
                        >
                          Nessun condominio selezionato
                        </button>

                        {condomini
                          .filter((c) =>
                            `${c.indirizzo || ""}`.toLowerCase().includes(condominiSearch.toLowerCase())
                          )
                          .map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setManualProformaForm((prev) => ({
                                  ...prev,
                                  condominioId: String(c.id),
                                }));
                                setCondominiSearch(c.indirizzo || "");
                              }}
                              className={`block w-full px-4 py-3 text-left text-sm transition hover:bg-slate-50 ${
                                String(manualProformaForm.condominioId) === String(c.id)
                                  ? "bg-sky-50 font-semibold text-sky-700"
                                  : "text-slate-700"
                              }`}
                            >
                              {c.indirizzo}
                            </button>
                          ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Descrizione
                      </label>
                      <textarea
                        value={manualProformaForm.descrizione}
                        onChange={(e) =>
                          setManualProformaForm((prev) => ({ ...prev, descrizione: e.target.value }))
                        }
                        rows={5}
                        placeholder="Es. proforma per ripartizione costi, acconto, saldo..."
                        className="w-full rounded-[24px] border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                      />
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">
                          Data documento
                        </label>
                        <input
                          type="date"
                          value={manualProformaForm.dataDocumento}
                          onChange={(e) =>
                            setManualProformaForm((prev) => ({
                              ...prev,
                              dataDocumento: e.target.value,
                            }))
                          }
                          className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">
                          Importo
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                            €
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            value={manualProformaForm.importo}
                            onChange={(e) =>
                              setManualProformaForm((prev) => ({ ...prev, importo: e.target.value }))
                            }
                            placeholder="0,00"
                            className="h-12 w-full rounded-2xl border border-slate-300 bg-white pl-9 pr-4 text-sm font-medium text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* side summary */}
                  <aside className="space-y-4">
                    <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Riepilogo
                      </div>

                      <div className="mt-4 space-y-3">
                        <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Condominio selezionato
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-800">
                            {condomini.find(
                              (c) => String(c.id) === String(manualProformaForm.condominioId)
                            )?.indirizzo || "-"}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Data
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-800">
                            {manualProformaForm.dataDocumento || "-"}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                            Importo previsto
                          </div>
                          <div className="mt-1 text-lg font-extrabold text-sky-800">
                            {manualProformaForm.importo
                              ? new Intl.NumberFormat("it-IT", {
                                  style: "currency",
                                  currency: "EUR",
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }).format(Number(manualProformaForm.importo || 0))
                              : "€ 0,00"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </aside>
                </div>

                {/* footer */}
                <div className="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-6 py-4 sm:flex-row sm:items-center sm:px-7">
                  <div className="text-xs text-slate-500">
                    Controlla condominio, data e importo prima della conferma.
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setIsCreateManualProformaModalOpen(false)}
                      className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      Annulla
                    </button>

                    <button
                      onClick={createManualProforma}
                      disabled={creatingManualProforma}
                      className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {creatingManualProforma ? "Creazione..." : "Conferma proforma"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isCreateManualFatturaModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-4 backdrop-blur-[2px]">
              <div className="relative flex h-[92vh] w-full max-w-[1380px] flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.18)]">
                <div className="h-1.5 w-full bg-gradient-to-r from-fuchsia-400 via-violet-500 to-indigo-500" />

                {/* header */}
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
                  <div className="min-w-0">
                    <div className="inline-flex items-center rounded-full border border-fuchsia-200 bg-fuchsia-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-fuchsia-700">
                      Creazione manuale
                    </div>

                    <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-900">
                      Nuova fattura
                    </h3>

                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                      Crea manualmente una fattura e, se necessario, collega una o più proforme già esistenti.
                    </p>
                  </div>

                  <button
                    onClick={() => setIsCreateManualFatturaModalOpen(false)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                    title="Chiudi"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* body */}
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                    <div className="space-y-5">
                      {/* TOP STRIP */}
                      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr_0.9fr]">
                        {/* dati fattura */}
                        <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Dati fattura
                          </div>

                          <div className="mt-4 space-y-4">
                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700">
                                Condominio
                              </label>

                              <input
                                type="text"
                                value={condominiSearch}
                                onChange={(e) => setCondominiSearch(e.target.value)}
                                placeholder="Cerca indirizzo condominio..."
                                className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-100"
                              />

                              <div className="mt-2 max-h-44 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setManualFatturaForm((prev) => ({ ...prev, condominioId: "" }))
                                  }
                                  className={`block w-full px-4 py-3 text-left text-sm transition hover:bg-slate-50 ${
                                    !manualFatturaForm.condominioId
                                      ? "bg-fuchsia-50 font-semibold text-fuchsia-700"
                                      : "text-slate-700"
                                  }`}
                                >
                                  Nessun condominio selezionato
                                </button>

                                {condomini
                                  .filter((c) =>
                                    `${c.indirizzo || ""}`.toLowerCase().includes(condominiSearch.toLowerCase())
                                  )
                                  .map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => {
                                        setManualFatturaForm((prev) => ({
                                          ...prev,
                                          condominioId: String(c.id),
                                        }));
                                        setCondominiSearch(c.indirizzo || "");
                                      }}
                                      className={`block w-full px-4 py-3 text-left text-sm transition hover:bg-slate-50 ${
                                        String(manualFatturaForm.condominioId) === String(c.id)
                                          ? "bg-fuchsia-50 font-semibold text-fuchsia-700"
                                          : "text-slate-700"
                                      }`}
                                    >
                                      {c.indirizzo}
                                    </button>
                                  ))}
                              </div>
                            </div>

                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700">
                                Descrizione
                              </label>
                              <textarea
                                value={manualFatturaForm.descrizione}
                                onChange={(e) =>
                                  setManualFatturaForm((prev) => ({ ...prev, descrizione: e.target.value }))
                                }
                                rows={4}
                                placeholder="Es. fattura periodo, saldo, conguaglio, ripartizione..."
                                className="w-full rounded-[20px] border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-100"
                              />
                            </div>
                          </div>
                        </div>

                        {/* date + amount */}
                        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Parametri documento
                          </div>

                          <div className="mt-4 grid gap-4">
                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700">
                                Data documento
                              </label>
                              <input
                                type="date"
                                value={manualFatturaForm.dataDocumento}
                                onChange={(e) =>
                                  setManualFatturaForm((prev) => ({
                                    ...prev,
                                    dataDocumento: e.target.value,
                                  }))
                                }
                                className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-100"
                              />
                            </div>

                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700">
                                Importo
                              </label>
                              <div className="relative">
                                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                                  €
                                </span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={manualFatturaForm.importo}
                                  onChange={(e) =>
                                    setManualFatturaForm((prev) => ({ ...prev, importo: e.target.value }))
                                  }
                                  placeholder="0,00"
                                  className="h-11 w-full rounded-2xl border border-slate-300 bg-white pl-9 pr-4 text-sm font-medium text-slate-800 outline-none transition focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-100"
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* summary */}
                        <div className="rounded-[24px] border border-fuchsia-200 bg-fuchsia-50 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-700">
                            Riepilogo rapido
                          </div>

                          <div className="mt-4 space-y-3">
                            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-fuchsia-200/70">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                Condominio selezionato
                              </div>
                              <div className="mt-1 text-sm font-semibold text-slate-900">
                                {condomini.find(
                                  (c) => String(c.id) === String(manualFatturaForm.condominioId)
                                )?.indirizzo || "-"}
                              </div>
                            </div>

                            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-fuchsia-200/70">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                Data
                              </div>
                              <div className="mt-1 text-sm font-semibold text-slate-900">
                                {manualFatturaForm.dataDocumento || "-"}
                              </div>
                            </div>

                            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-fuchsia-200/70">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-700">
                                Importo fattura
                              </div>
                              <div className="mt-1 text-lg font-extrabold text-fuchsia-800">
                                {manualFatturaForm.importo
                                  ? new Intl.NumberFormat("it-IT", {
                                      style: "currency",
                                      currency: "EUR",
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    }).format(Number(manualFatturaForm.importo || 0))
                                  : "€ 0,00"}
                              </div>
                            </div>
                          </div>
                        </div>
                      </section>

                      {/* TABLE */}
                      <section className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
                        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-semibold text-slate-800">
                              Proforme disponibili da associare
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              Seleziona una o più proforme già esistenti da collegare alla fattura.
                            </div>
                          </div>

                          <input
                            value={manualFatturaProformaSearch}
                            onChange={(e) => setManualFatturaProformaSearch(e.target.value)}
                            placeholder="Cerca numero, condominio, descrizione..."
                            className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-100 sm:max-w-[320px]"
                          />
                        </div>

                        <div className="max-h-[360px] overflow-auto">
                          <table className="min-w-full text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              <tr className="border-b border-slate-200">
                                <th className="px-4 py-3">Sel.</th>
                                <th className="px-4 py-3">Numero</th>
                                <th className="px-4 py-3">Condominio</th>
                                <th className="px-4 py-3">Descrizione</th>
                                <th className="px-4 py-3 text-right">Importo</th>
                                <th className="px-4 py-3">Stato</th>
                              </tr>
                            </thead>

                            <tbody>
                              {filteredAvailableProformasForManualFattura.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                                    Nessuna proforma disponibile.
                                  </td>
                                </tr>
                              ) : (
                                filteredAvailableProformasForManualFattura.map((p: any, index: number) => {
                                  const checked = selectedProformaIdsForManualFattura.includes(p.id);

                                  return (
                                    <tr
                                      key={p.id}
                                      className={`border-b border-slate-100 transition ${
                                        checked
                                          ? "bg-fuchsia-50"
                                          : index % 2 === 0
                                          ? "bg-white hover:bg-slate-50"
                                          : "bg-slate-50/60 hover:bg-slate-100/70"
                                      }`}
                                    >
                                      <td className="px-4 py-3">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedProformaIdsForManualFattura((prev) =>
                                                prev.includes(p.id) ? prev : [...prev, p.id]
                                              );
                                            } else {
                                              setSelectedProformaIdsForManualFattura((prev) =>
                                                prev.filter((id) => id !== p.id)
                                              );
                                            }
                                          }}
                                          className="h-4 w-4 rounded border-slate-300 text-fuchsia-600 focus:ring-fuchsia-500"
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

                                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                        {euro(Number(p.importo || 0))}
                                      </td>

                                      <td className="px-4 py-3">
                                        <span
                                          className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${
                                            statusClass[p.stato] || "bg-slate-100 text-slate-700 ring-slate-200"
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
                      </section>

                      {/* SELECTED AREA */}
                      <section className="rounded-[24px] border border-fuchsia-200 bg-fuchsia-50 p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-700">
                              Proforme selezionate
                            </div>

                            <div className="mt-3 max-h-32 overflow-auto pr-1">
                              <div className="flex flex-wrap gap-2">
                                {selectedProformaIdsForManualFattura.length === 0 ? (
                                  <div className="text-sm text-slate-500">
                                    Nessuna proforma selezionata.
                                  </div>
                                ) : (
                                  availableProformasForManualFattura
                                    .filter((p: any) => selectedProformaIdsForManualFattura.includes(p.id))
                                    .map((p: any) => (
                                      <span
                                        key={p.id}
                                        className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-medium text-fuchsia-800 ring-1 ring-fuchsia-200"
                                      >
                                        {p.numero}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setSelectedProformaIdsForManualFattura((prev) =>
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
                            </div>
                          </div>

                          <div className="min-w-[220px] rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-fuchsia-200/70">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-700">
                              Totale proforme selezionate
                            </div>
                            <div className="mt-1 text-lg font-extrabold text-slate-900">
                              {new Intl.NumberFormat("it-IT", {
                                style: "currency",
                                currency: "EUR",
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }).format(
                                availableProformasForManualFattura
                                  .filter((p: any) => selectedProformaIdsForManualFattura.includes(p.id))
                                  .reduce((sum: number, p: any) => sum + Number(p.importo || 0), 0)
                              )}
                            </div>
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>
                </div>

                {/* footer */}
                <div className="flex shrink-0 flex-col-reverse items-stretch justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                  <div className="text-xs text-slate-500">
                    Verifica importo, condominio e proforme collegate prima della conferma.
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setIsCreateManualFatturaModalOpen(false)}
                      className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      Annulla
                    </button>

                    <button
                      onClick={createManualFattura}
                      disabled={creatingManualFattura}
                      className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {creatingManualFattura ? "Creazione..." : "Conferma fattura"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

        </section>


      </div>
    </div>
  );
  
}
