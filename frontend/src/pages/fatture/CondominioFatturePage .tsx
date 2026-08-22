import { useEffect, useMemo, useState, Fragment } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../api/client";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileDown,
  FileSpreadsheet,
  FileText,
  Loader2,
  Pencil,
  Search,
  ReceiptText,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Calendar } from "lucide-react";
import { Save } from "lucide-react";
import { parse, set, weeksToDays } from "date-fns";
import { useRef } from "react";
import { ca, se } from "date-fns/locale";
import InvoicePrintCard from "../components/InvoicePrintCard";
import { getVersionFull, listVersions } from "../../api/tariffe";
import { getAuthToken } from "../../auth";
 // @ts-ignore
import { summarizePeriodiAndTariffe } from "../../utils/fattureUtils";


type Provider = { id: string; nome: string; codice?: string };
type Periodo = {
  id: string;
  period_year: number;
  period_month: number;
  data_lettura_operatore?: string | null;
  data_lettura_casa_idrica?: string | null;
};
type ImportedInvoiceDocument = {
    id: string;
    original_filename: string;
    display_name?: string | null;
    numero_bolletta?: string | null;
    codice_fornitura?: string | null;
    codice_cliente?: string | null;
    punto_erogazione?: string | null;
    matricola_contatore?: string | null;
    intestatario?: string | null;
    indirizzo_fornitura?: string | null;
    provider_id?: string | null;
    fornitore_servizi?: string | null;
    bill_type?: string | null;
    data_inizio_periodo?: string | null;
    data_fine_periodo?: string | null;
    consumo_globale_mc?: number | null;
    importo_totale_da_pagare?: number | null;
    parse_status: "uploaded" | "parsed" | "reviewed" | "imported" | "failed";
    validation_status: "pending" | "valid" | "warning" | "error";
    linked_session_id?: string | null;
    parsed_payload_json?: string | null;
    validation_json?: string | null;
    parser_version?: string | null;
    parser_confidence?: number | null;
    parser_error_text?: string | null;
  };
type ImportedDocumentEditForm = {
  providerId: string;
  numeroBolletta: string;
  codiceFornitura: string;
  codiceCliente: string;
  puntoErogazione: string;
  matricolaContatore: string;
  intestatario: string;
  indirizzoFornitura: string;
  fornitoreServizi: string;
  billType: string;
  dataInizioPeriodo: string;
  dataFinePeriodo: string;
  consumoGlobaleMc: string;
  importoTotaleDaPagare: string;
  letturaPrecedente: string;
  letturaAttuale: string;
  giorniQF: string;
  giorniConsumi: string;
  acquedotto: string;
  depFog: string;
  quotaFissa: string;
  oneri: string;
  iva: string;
  totaleLettura: string;
  giorniAcconto: string;
  mcAcconto: string;
  acquedottoAcconto: string;
  depFogAcconto: string;
  quotaFissaAcconto: string;
  oneriAcconto: string;
  ivaAcconto: string;
  totaleAcconto: string;
  mcStorno: string;
  acquedottoStorno: string;
  depFogStorno: string;
  quotaFissaStorno: string;
  oneriStorno: string;
  ivaStorno: string;
  totaleStorno: string;
};
type LetturaItem = {
  data_lettura?: string | null;
  lettura_mc?: number | null;
  consumo_mc?: number | null;
  tipo_lettura?: string | null;
};
type OneriMode = "media" | "non_media" | "all";
type ComponentName =
  | "componente_tariffa_depurazione"
  | "componente_tariffa_fognatura";

type SignMode = "all" | "positive" | "negative";
type PeriodMode = "all" | "acconto" | "non_acconto";
type LegacyAccontoEntry = {
  idUtenza: string;
  importoEuro: number;
  importoMc: number;
  residuoEuro?: number;
  usatoEuro?: number;
  periodoOrigine?: string | null;
};


export default function CondominioFatturePage() {

    const importedDocsScrollRef = useRef<HTMLDivElement | null>(null);
    const parsingAlertRef = useRef<HTMLDivElement | null>(null);

    const navigate = useNavigate();
    const { condominioId, id: fatturaId } = useParams();

    const [providers, setProviders] = useState<Provider[]>([]);
    const [periodi, setPeriodi] = useState<Periodo[]>([]);
    const [sessions, setSessions] = useState<any[]>([]);     // list view
    const [currentSession, setCurrentSession] = useState<any | null>(null); // detail view
    const [providerId, setProviderId] = useState("");
    const [current, setCurrent] = useState("");
    const [previous, setPrevious] = useState("");
    const [detail, setDetail] = useState<any>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [loadingCreate, setLoadingCreate] = useState(false);
    const [loadingCalc, setLoadingCalc] = useState(false);
    const [autoCalculatingSessionId, setAutoCalculatingSessionId] = useState<string | null>(null);
    const [pendingAutoCalculateSessionId, setPendingAutoCalculateSessionId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [calculationNotice, setCalculationNotice] = useState<string | null>(null);
    const [valPrec, setValPrec] = useState<number | string>("");
    const [valAtt, setValAtt] = useState<number | string>("");
    const [savingGenerale, setSavingGenerale] = useState(false);
    const [generale, setGenerale] = useState<any>(null);
    const [righeCalcoli, setRigheCalcoli] = useState<any[]>([]);
    const [tfCode, setTfCode] = useState<string>("TF1");
    const [isCreateFatturaModalOpen, setIsCreateFatturaModalOpen] = useState(false);
    const [fatturaDate, setFatturaDate] = useState(new Date().toISOString().slice(0, 10));
    const [creatingFattura, setCreatingFattura] = useState(false);
    const [exportingRipartizioni, setExportingRipartizioni] = useState(false);
    const [exportMessage, setExportMessage] = useState("");
    const [pdfPage, setPdfPage] = useState(1);
    const pdfPageSize = 20;
    const [expandedRows, setExpandedRows] = useState<Record<string | number, boolean>>({});
    const [manualConsumptions, setManualConsumptions] = useState<Record<string, string>>({});
    const loadedTfSessionRef = useRef<string | null>(null);
    const selectedTfCodeRef = useRef<string>("TF1");
    const manualTfOverrideRef = useRef<{ sessionId: string | null; tfCode: string | null }>({
      sessionId: null,
      tfCode: null,
    });
    const autoCalculatedSessionRef = useRef<string | null>(null);

    const toggleRow = (rowKey: string | number) => {
      setExpandedRows((prev) => ({
        ...prev,
        [rowKey]: !prev[rowKey],
      }));
    };
    //consumo values
    const [parsedImpCons, setParsedImpCons] = useState<number>(0);
    const [depfog, setDepFog] = useState<number>(0);

    //-------------------------------------------------------
    //storno values
    const [mcStorno, setMcStorno] = useState<number>(0);
    const [eurStorno, setEurStorno] = useState<number>(0);
    const [acquedottoStorno, setAcquedottoStorno] = useState<number>(0);
    const [depfogStorno, setDepfogStorno] = useState<number>(0);
    const [ivaStorno, setIvaStorno] = useState<number>(0);
    const [oneriPerequazioneStorno, setOneriPerequazioneStorno] = useState<number>(0);
    const [totaleStorno, setTotaleStorno] = useState<number>(0);
    //-------------------------------------------------------


    const [selectedDoc, setSelectedDoc] = useState<number | null>(null);
    const [parsedQF, setParsedQF] = useState<number | null>(null);

    // Acconto values
    const [eurAcconto, setEurAcconto] = useState<number>(0);
    const [depfogAcconto, setDepfogAcconto] = useState<number>(0);
    const [ivaAcconto, setIvaAcconto] = useState<number>(0);
    const [totaleAcconto, setTotaleAcconto] = useState<number>(0);
    const [mcAcconto, setMcAcconto] = useState<number>(0);
    const [oneriPerequazioneAcconto, setOneriPerequazioneAcconto] = useState<number | string>(0);
    const [legacyAcconti, setLegacyAcconti] = useState<LegacyAccontoEntry[]>([]);
    const [legacyDraft, setLegacyDraft] = useState<Record<string, { euro: string; mc: string }>>({});
    const [legacyPeriodoOrigine, setLegacyPeriodoOrigine] = useState("");
    const [legacyEditorOpen, setLegacyEditorOpen] = useState(false);
    const [loadingLegacy, setLoadingLegacy] = useState(false);
    const [savingLegacy, setSavingLegacy] = useState(false);
   //-------------------------------------------------------

    const canCreate = useMemo(() => {
      return !!condominioId && !!providerId && !!current && !!previous && current !== previous;
    }, [condominioId, providerId, current, previous]);


    const session = detail?.session;
    const contatoreGenerale = detail?.contatoreGenerale ?? {};
    const normalizeFatturaRow = (row: any) => {
      const sourceUtenza = row?.utenza || {};
      const flatName = String(row?.utente || "").trim();
      const [flatNome, ...flatCognomeParts] = flatName.split(/\s+/).filter(Boolean);

      if (row?.utenza || row?.riga) {
        return {
          ...row,
          utenza: {
            ...sourceUtenza,
            id: sourceUtenza?.id ?? row?.id_utenza,
            id_user: sourceUtenza?.id_user ?? row?.id_user,
            Nome: sourceUtenza?.Nome ?? sourceUtenza?.nome ?? flatNome ?? "",
            Cognome:
              sourceUtenza?.Cognome ??
              sourceUtenza?.cognome ??
              flatCognomeParts.join(" ") ??
              "",
            Isolato: sourceUtenza?.Isolato ?? sourceUtenza?.isolato ?? "",
            Scala: sourceUtenza?.Scala ?? sourceUtenza?.scala ?? "",
            Interno: sourceUtenza?.Interno ?? sourceUtenza?.interno ?? "",
            doppio_contatore:
              sourceUtenza?.doppio_contatore ?? row?.doppio_contatore,
          },
        };
      }

      return {
        utenza: {
          id: row?.id_utenza,
          id_user: row?.id_user,
          Nome: row?.utente || row?.nome || "",
          Cognome: row?.cognome || "",
          Isolato: row?.Isolato ?? row?.isolato ?? "",
          Scala: row?.Scala ?? row?.scala ?? "",
          Interno: row?.Interno ?? row?.interno ?? "",
          doppio_contatore: row?.doppio_contatore,
        },
        attuale:
          row?.lettura_attuale !== undefined || row?.stato_attuale !== undefined
            ? {
                valore_lettura: row?.lettura_attuale,
                stato_lettura: row?.stato_attuale,
              }
            : null,
        precedente:
          row?.lettura_precedente !== undefined || row?.stato_precedente !== undefined
            ? {
                valore_lettura: row?.lettura_precedente,
                stato_lettura: row?.stato_precedente,
              }
            : null,
        riga: row,
      };
    };

    const gridRows = Array.isArray(detail?.grid) ? detail.grid : [];
    const calculatedRows = Array.isArray(detail?.righe) ? detail.righe : [];
    const righe = (gridRows.length > 0 ? gridRows : calculatedRows).map(normalizeFatturaRow);
    const legacyEditorRows = righe.filter((row: any, index: number, all: any[]) => {
      const id = String(row?.utenza?.id || row?.id_utenza || "");
      return id && all.findIndex((candidate) => String(candidate?.utenza?.id || candidate?.id_utenza || "") === id) === index;
    });
    const legacyDraftTotal = Object.values(legacyDraft).reduce(
      (sum, entry) => sum + (Number(entry.euro) || 0),
      0
    );
    const legacyResidualTotal = legacyAcconti.reduce(
      (sum, entry) => sum + Number(entry.residuoEuro ?? entry.importoEuro ?? 0),
      0
    );
    const periodoAttuale = detail?.periodoAttuale ?? null;
    const periodoPrecedente = detail?.periodoPrecedente ?? null;
    const consumoGenerale =
      contatoreGenerale?.attuale != null && contatoreGenerale?.precedente != null
        ? Number(contatoreGenerale.attuale) - Number(contatoreGenerale.precedente)
        : 0;
    const [giorniQf, setGiorniQf] = useState<number | string>(0);
    const [giorniConsumi, setGiorniConsumi] = useState<number | string>(0);
    const [giorniAcconto, setGiorniAcconto] = useState<number | string>(0);
    const [oneriPerequazione, setOneriPerequazione] = useState<number | string>(0);

    const [varie, setVarie] = useState<number | string>(0);
    const [giorniCasaInterni, setGiorniCasaInterni] = useState<number | string>(0);
    // const [dataQfFrom, setDataQfFrom] = useState("");
    // const [dataQfTo, setDataQfTo] = useState("");
    // const [dataConsFrom, setDataConsFrom] = useState("");
    // const [dataConsTo, setDataConsTo] = useState("");
    const [savingParams, setSavingParams] = useState(false);
    const [annoTariffa, setAnnoTariffa] = useState<number | string>(0);

    const [parsingAlert, setParsingAlert] = useState<null | {
      type: "warning";
      message: string;
      availableTypes: string[];
      grouped: Record<string, { oldest: LetturaItem; newest: LetturaItem; items: LetturaItem[] }>;
    }>(null);

    useEffect(() => {
      if (!parsingAlert) return;

      window.setTimeout(() => {
        parsingAlertRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 80);
    }, [parsingAlert]);

    const [importedDocs, setImportedDocs] = useState<ImportedInvoiceDocument[]>([]);
    const [selectedImportedId, setSelectedImportedId] = useState<string | null>(null);
    const [selectedImportedDoc, setSelectedImportedDoc] = useState<ImportedInvoiceDocument | null>(null);
    const [loadingImportedDocs, setLoadingImportedDocs] = useState(false);
    const [loadingImportedDetail, setLoadingImportedDetail] = useState(false);
    const [editingImportedDoc, setEditingImportedDoc] = useState(false);
    const [savingImportedDoc, setSavingImportedDoc] = useState(false);
    const [importedDocEdit, setImportedDocEdit] = useState<ImportedDocumentEditForm | null>(null);
    const [creatingImport, setCreatingImport] = useState(false);

    const [importFilename, setImportFilename] = useState("");
    const [importProviderId, setImportProviderId] = useState("");
    const [importFile, setImportFile] = useState<File | null>(null);
    const [uploadingImport, setUploadingImport] = useState(false);
    const [parsingImportId, setParsingImportId] = useState<string | null>(null);
    const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
    const [dettaglioByUtenza, setDettaglioByUtenza]  = useState<Record<string, any[]>>({})
    const [importedDocYear, setImportedDocYear] = useState<number | null>(null);
 
    const [exportJob, setExportJob] = useState<any>(null);


    const [pdfPeriods, setPdfPeriods] = useState<Record<string, any[]>>({});
    const [generatedDocuments, setGeneratedDocuments] = useState<any[]>([]);
    const [openPeriod, setOpenPeriod] = useState<string | null>(null);
    const [pdfSearch, setPdfSearch] = useState("");
    const [activeTariffPreview, setActiveTariffPreview] = useState<any | null>(null);
    const [loadingTariffPreview, setLoadingTariffPreview] = useState(false);
    const [periodSearch, setPeriodSearch] = useState("");
    const [sessionPanelOpen, setSessionPanelOpen] = useState(!fatturaId);

    const [importedSearch, setImportedSearch] = useState("");
    
    const [importedStatusFilter, setImportedStatusFilter] = useState("all");
    const [importedPage, setImportedPage] = useState(1);
    const importedPageSize = 3;

    const filteredImportedDocs = importedDocs.filter((doc: any) => {
      const status = doc.parse_status || "uploaded";

      const search = importedSearch.toLowerCase().trim();

      const matchesSearch =
        !search ||
        getImportedDocumentName(doc).toLowerCase().includes(search) ||
        String(doc.numero_bolletta || "").toLowerCase().includes(search) ||
        String(doc.original_filename || "").toLowerCase().includes(search) ||
        String(doc.validation_status || "").toLowerCase().includes(search);

      const matchesStatus =
        importedStatusFilter === "all" || status === importedStatusFilter;

      return matchesSearch && matchesStatus;
    });

    const filteredSessions = sessions.filter((s: any) => {
      const search = periodSearch.toLowerCase().trim();
      if (!search) return true;

      const linkedDoc = getSessionLinkedImportedDocument(s);
      const periodLabel = getImportedDocumentPeriodLabel(linkedDoc);

      return [
        periodLabel,
        getImportedDocumentName(linkedDoc || ({} as ImportedInvoiceDocument)),
        s.id,
        s.tf_code,
        s.tf,
        s.stato,
        String(s.grand_total ?? ""),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });

    const importedTotalPages = Math.max(
      1,
      Math.ceil(filteredImportedDocs.length / importedPageSize)
    );

    const paginatedImportedDocs = filteredImportedDocs.slice(
      (importedPage - 1) * importedPageSize,
      importedPage * importedPageSize
    );

    useEffect(() => {
      setImportedPage(1);
    }, [importedSearch, importedStatusFilter]);

    useEffect(() => {
      setSessionPanelOpen(!fatturaId);
    }, [fatturaId]);

    async function loadRipartizionePdfs() {
      if (!condominioId || !fatturaId) {
        setPdfPeriods({});
        return;
      }

      const { data } = await api.get("/fatture/ripartizione-pdfs", {
        params: { condominioId, fatturaId },
      });
      setPdfPeriods(data.periods || {});
    }

    async function loadGeneratedDocuments() {
      if (!condominioId || !fatturaId) {
        setGeneratedDocuments([]);
        return;
      }

      const { data } = await api.get("/fatture/generated-documents", {
        params: {
          condominioId,
          fatturaId,
          documentTypes: "prospetto,bollette_complete",
          latestPerType: 1,
        },
      });

      setGeneratedDocuments(data.documents || []);
    }

    function viewSinglePdf(id: number) {
      const params = new URLSearchParams();
      const token = getAuthToken();

      if (condominioId) {
        params.set("condominioId", String(condominioId));
      }

      if (fatturaId) {
        params.set("fatturaId", String(fatturaId));
      }

      if (token) {
        params.set("authToken", token);
      }

      window.open(
        `${api.defaults.baseURL}/fatture/ripartizione-pdfs/${id}/view?${params.toString()}`,
        "_blank"
      );
    }

    function viewPeriodPdf(periodKey: string) {
      const params = new URLSearchParams();
      const token = getAuthToken();

      if (condominioId) {
        params.set("condominioId", String(condominioId));
      }

      if (fatturaId) {
        params.set("fatturaId", String(fatturaId));
      }

      if (token) {
        params.set("authToken", token);
      }

      window.open(
        `${api.defaults.baseURL}/fatture/ripartizione-pdfs/period/${periodKey}/view-all?${params.toString()}`,
        "_blank"
      );
    }

    function viewGeneratedDocument(id: string) {
      const params = new URLSearchParams();
      const token = getAuthToken();

      if (condominioId) {
        params.set("condominioId", String(condominioId));
      }

      if (token) {
        params.set("authToken", token);
      }

      window.open(
        `${api.defaults.baseURL}/fatture/generated-documents/${id}/view?${params.toString()}`,
        "_blank"
      );
    }

    useEffect(() => {
      if (!condominioId || !fatturaId) {
        setPdfPeriods({});
        setOpenPeriod(null);
        return;
      }

      let cancelled = false;

      api
        .get("/fatture/ripartizione-pdfs", {
          params: { condominioId, fatturaId },
        })
        .then(({ data }) => {
          if (!cancelled) {
            setPdfPeriods(data.periods || {});
            setOpenPeriod(null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPdfPeriods({});
            setOpenPeriod(null);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [condominioId, fatturaId]);

    useEffect(() => {
      loadGeneratedDocuments().catch(() => setGeneratedDocuments([]));
    }, [condominioId, fatturaId]);

   const years: any[] = [];
   years.length = 0; // clear array while keeping reference
   years.push(selectedImportedDoc?.data_fine_periodo ? new Date(selectedImportedDoc.data_fine_periodo).getFullYear() : new Date().getFullYear()); // current year
   years.push(selectedImportedDoc?.data_inizio_periodo ? new Date(selectedImportedDoc.data_inizio_periodo).getFullYear()-1 : new Date().getFullYear() - 1  ); // previous year
   years.push(selectedImportedDoc?.data_fine_periodo ? new Date(selectedImportedDoc.data_fine_periodo).getFullYear() + 1 : new Date().getFullYear() + 1); // next year
   years.sort((a, b) => a - b);
  
   const handleImportedDocsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
   const el = importedDocsScrollRef.current;
    if (!el) return;

    const canScrollHorizontally = el.scrollWidth > el.clientWidth;
    if (!canScrollHorizontally) return;

    // Trap the wheel inside this container
    e.preventDefault();
    e.stopPropagation();

    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    el.scrollLeft += delta;
   } ;

  function chunkArray<T>(arr: T[], size: number) {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  } 

  function normalizeImportedDocuments(value: any): ImportedInvoiceDocument[] {
    if (Array.isArray(value?.[0])) {
      return value[0];
    }

    return Array.isArray(value) ? value : [];
  }

  function normalizeTfCode(value: any): string {
    const code = String(value || "TF1").trim().toUpperCase();

    if (code === "NONE") return "TF1";
    if (code === "EQUAL" || code === "TF2N") return "TF2";
    if (code === "PROP" || code === "TF3N") return "TF3";
    if (["TF1", "TF2", "TF3"].includes(code)) return code;

    return "TF1";
  }

  function applyTfCode(value: any) {
    const normalized = normalizeTfCode(value);
    selectedTfCodeRef.current = normalized;
    setTfCode(normalized);
    return normalized;
  }

  async function persistTfCode(value: any, sessionId: string | null = fatturaId || null) {
    if (!sessionId) return;

    const normalized = applyTfCode(value);
    manualTfOverrideRef.current = {
      sessionId,
      tfCode: normalized,
    };

    try {
      await api.put(`/fatture/sessioni/${sessionId}/parametri`, {
        tfCode: normalized,
      });
      setSessions((prev) =>
        prev.map((s: any) =>
          String(s.id) === String(sessionId) ? { ...s, tf_code: normalized } : s
        )
      );
      setCurrentSession((prev: any) =>
        prev && String(prev.id) === String(sessionId)
          ? { ...prev, tf_code: normalized }
          : prev
      );
      setDetail((prev: any) =>
        prev?.session && String(prev.session.id) === String(sessionId)
          ? { ...prev, session: { ...prev.session, tf_code: normalized } }
          : prev
      );
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore salvataggio TF");
      throw err;
    }
  }

  function formatImportedDocDate(value?: string | null) {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function cleanImportedFilename(value?: string | null) {
    if (!value) return "Documento";

    return String(value)
      .replace(/\.[^.]+$/, "")
      .replace(/^file-\d+-\d+/i, "Documento")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Documento";
  }

  function getImportedDocumentName(doc: ImportedInvoiceDocument) {
    if (doc.display_name?.trim()) {
      return doc.display_name.trim();
    }

    if (doc.numero_bolletta || doc.data_inizio_periodo || doc.data_fine_periodo) {
      const from = formatImportedDocDate(doc.data_inizio_periodo);
      const to = formatImportedDocDate(doc.data_fine_periodo);
      const period = from && to ? `Periodo ${from} - ${to}` : `Periodo ${from || to}`;
      const number = doc.numero_bolletta ? `Bolletta n. ${doc.numero_bolletta}` : "";

      return [period, number].filter(Boolean).join(" · ");
    }

    return cleanImportedFilename(doc.original_filename);
  }

  function formatAvailablePeriodLabel(period: Periodo) {
    const fullDate =
      period.data_lettura_operatore || period.data_lettura_casa_idrica;
    const formattedDate = formatImportedDocDate(fullDate);

    if (formattedDate) return formattedDate;

    return `${String(period.period_month).padStart(2, "0")}/${period.period_year}`;
  }

  function getImportedDocumentPeriodLabel(doc?: ImportedInvoiceDocument | null) {
    if (!doc) return "Periodo TXT non disponibile";

    const from = formatImportedDocDate(doc.data_inizio_periodo);
    const to = formatImportedDocDate(doc.data_fine_periodo);

    if (from && to) return `${from} - ${to}`;
    return from || to || "Periodo TXT non disponibile";
  }

  function getBillingProviderCode(
    doc?: ImportedInvoiceDocument | null,
    sessionRow?: any
  ): string {
    const hydricProviderId =
      doc?.provider_id || sessionRow?.id_casa_idrica || sessionRow?.provider_id || "";
    const provider = providers.find(
      (item) => String(item.id) === String(hydricProviderId)
    );
    const providerText = [
      provider?.codice,
      provider?.nome,
      doc?.fornitore_servizi,
    ]
      .filter(Boolean)
      .join(" ")
      .toUpperCase();

    if (/\bASIS\b|SALERNITAN|SALERNITA|IMPIANTI\s+E\s+RETI/.test(providerText)) {
      return "ASIS";
    }
    if (/\bABC\b|ACQUA\s+BENE\s+COMUNE/.test(providerText)) {
      return "ABC";
    }

    const configuredCode = String(provider?.codice || "").trim().toUpperCase();
    return configuredCode && configuredCode.length <= 12 ? configuredCode : "ABC";
  }

  function isAsisBillingDocument(
    doc?: ImportedInvoiceDocument | null,
    sessionRow?: any
  ): boolean {
    return getBillingProviderCode(doc, sessionRow) === "ASIS";
  }

  function findSessionById(sessionId?: string | null) {
    if (!sessionId) return null;

    if (session && String(session.id || "") === String(sessionId)) {
      return session;
    }

    if (currentSession && String(currentSession.id || "") === String(sessionId)) {
      return currentSession;
    }

    const fromList = sessions.find((item: any) => String(item?.id || "") === String(sessionId));
    return fromList || null;
  }

  function buildImportedDocumentFromSession(sessionRow: any) {
    if (!sessionRow?.linked_imported_document_id && !sessionRow?.imported_document_id) {
      return null;
    }

    return {
      id: sessionRow.linked_imported_document_id || sessionRow.imported_document_id,
      original_filename: sessionRow.linked_imported_original_filename,
      numero_bolletta: sessionRow.linked_imported_numero_bolletta,
      data_inizio_periodo: sessionRow.linked_imported_data_inizio_periodo,
      data_fine_periodo: sessionRow.linked_imported_data_fine_periodo,
      importo_totale_da_pagare: sessionRow.linked_imported_importo_totale_da_pagare,
      linked_session_id: sessionRow.id,
    } as ImportedInvoiceDocument;
  }

  function getLinkedImportedDocument(sessionId?: string | null) {
    if (!sessionId) return null;

    const sessionRow = findSessionById(sessionId);
    const sessionDocumentId =
      sessionRow?.imported_document_id || sessionRow?.linked_imported_document_id || null;

    const fromList =
      importedDocs.find((doc: any) => String(doc?.linked_session_id || "") === String(sessionId)) ||
      (sessionDocumentId
        ? importedDocs.find((doc: any) => String(doc?.id || "") === String(sessionDocumentId))
        : null);

    if (
      selectedImportedDoc?.id &&
      (String(selectedImportedDoc.linked_session_id || "") === String(sessionId) ||
        (sessionDocumentId && String(selectedImportedDoc.id) === String(sessionDocumentId)))
    ) {
      return { ...selectedImportedDoc, linked_session_id: sessionId };
    }

    if (fromList) {
      return { ...fromList, linked_session_id: sessionId };
    }

    if (
      detail?.linkedImportedDocument?.id &&
      detail?.session?.id &&
      String(detail.session.id) === String(sessionId)
    ) {
      return { ...detail.linkedImportedDocument, linked_session_id: sessionId };
    }

    return buildImportedDocumentFromSession(sessionRow);
  }

  function getSessionLinkedImportedDocument(session: any) {
    const linkedFromList = getLinkedImportedDocument(session?.id);
    if (linkedFromList) return linkedFromList;

    return buildImportedDocumentFromSession(session);
  }

  function resolveGiorniCasaInterniValue() {
    return (
      positiveNumberOrNull(giorniCasaInterni) ??
      positiveNumberOrNull(session?.giorni_interni) ??
      resolveGiorniInterniFromPeriods(periodoPrecedente, periodoAttuale) ??
      0
    );
  }

  function resolveSelectedImportedDocumentForSession(sessionId: string) {
    const linked = getLinkedImportedDocument(sessionId);
    if (linked) return linked;

    if (
      detail?.linkedImportedDocument?.id &&
      String(session?.id || "") === String(sessionId)
    ) {
      return detail.linkedImportedDocument;
    }

    if (
      selectedImportedDoc?.id &&
      (!selectedImportedDoc?.linked_session_id ||
        String(selectedImportedDoc.linked_session_id) === String(sessionId))
    ) {
      return selectedImportedDoc;
    }

    return null;
  }

  function getParsedCalculationParams(payloadJson?: string | null, parsedSummary?: any) {
    if (!payloadJson) return {};

    try {
      const payload = typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
      const summary = parsedSummary ?? summarizePeriodiAndTariffe(payload || null);
      const grouped = payload?.grouped_letture || {};
      const aGiro = grouped.a_giro;
      const mediaLike = grouped.media || grouped.acconto || grouped.acconto_a_giro;
      const hasAGiro = hasAGiroConsumption(payload, summary);
      const resolvedAcconto = resolveAccontoPeriodFromPayload(payload, summary);
      const mainPeriod = hasAGiro ? null : getEstimatedConsumptionPeriod(payload, summary);
      const mainOldest = hasAGiro ? null : mediaLike?.oldest;
      const mainNewest = hasAGiro ? null : mediaLike?.newest;
      const manual = payload?.manual_overrides || {};

      return {
        giorniQF: manualNumber(manual.giorni_qf) ?? deriveGiorniQfFromPayload(payload),
        giorniConsumi:
          manualNumber(manual.giorni_consumi) ??
          (aGiro?.oldest?.data_lettura && aGiro?.newest?.data_lettura
            ? diffDaysExclusive(aGiro.oldest.data_lettura, aGiro.newest.data_lettura)
            : mainOldest?.data_lettura && mainNewest?.data_lettura
            ? diffDaysExclusive(mainOldest.data_lettura, mainNewest.data_lettura)
            : mainPeriod?.data_inizio && mainPeriod?.data_fine
            ? diffDaysExclusive(mainPeriod.data_inizio, mainPeriod.data_fine)
            : null),
        giorniAcconto:
          manualNumber(manual?.acconto?.giorni) ??
          (hasAGiro && resolvedAcconto?.dataInizio && resolvedAcconto?.dataFine
            ? diffDaysExclusive(resolvedAcconto.dataInizio, resolvedAcconto.dataFine)
            : 0),
        mcAcconto:
          manualNumber(manual?.acconto?.mc) ??
          (hasAGiro && resolvedAcconto?.consumo !== undefined && resolvedAcconto?.consumo !== null
            ? Number(resolvedAcconto.consumo)
            : 0),
      };
    } catch {
      return {};
    }
  }

  function getParsedPayloadObject(payloadJson?: string | null) {
    if (!payloadJson) return null;
    try {
      return typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
    } catch {
      return null;
    }
  }

  function manualNumber(value: any): number | null {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isMainAcquedottoTariffRow(row: any) {
    const code = String(row?.codice_componente || row?.component_code || "").toUpperCase();
    const text = `${code} ${row?.descrizione || ""} ${row?.quota_descrizione || ""}`.toUpperCase();
    const isOneri =
      /\bONERI\b/.test(text) ||
      /\bPEREQUAZIONE\b/.test(text) ||
      /^C_(UI[1-4]|MTI3)/.test(code) ||
      code.includes("_UI") ||
      code.includes("_MTI3");

    if (isOneri) return false;

    return (
      code.startsWith("C_TARI") ||
      text.includes("TARIFFA ACQUEDOTTO") ||
      text.includes("TARIFFA ACQUA") ||
      text.includes("QUOTA VARIABILE ACQUEDOTTO")
    );
  }

  function getStornoValuesFromPayload(payload: any) {
    const money = (value: number) =>
      Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
    const manual = payload?.manual_overrides?.storno;
    if (manual && Object.values(manual).some((value) => manualNumber(value) !== null)) {
      const positiveMagnitude = (value: any) => Math.abs(manualNumber(value) ?? 0);
      const acquedotto = positiveMagnitude(manual.acquedotto);
      const depFog = positiveMagnitude(manual.dep_fog);
      const quotaFissa = positiveMagnitude(manual.quota_fissa);
      const oneri = positiveMagnitude(manual.oneri);
      const iva = positiveMagnitude(manual.iva);
      const totale = manualNumber(manual.totale) ?? money(acquedotto + depFog + quotaFissa + oneri + iva);
      return {
        mc: positiveMagnitude(manual.mc),
        acquedotto,
        depurazione: 0,
        fognatura: 0,
        depFog,
        quotaFissa,
        oneri,
        iva,
        totale: Math.abs(totale),
        euro: Math.abs(totale),
        source: "manual_positive_override",
      };
    }
    const sumNegativeRows = (key: string, predicate?: (row: any) => boolean) => {
      const rows = Array.isArray(payload?.[key]) ? payload[key] : [];
      const negativeRows = rows.filter(
        (row: any) => Number(row?.importo || 0) < 0 && (!predicate || predicate(row))
      );
      const explicitRows = negativeRows.filter((row: any) => row?.is_storno_acconto);
      const targetRows = negativeRows;

      return {
        rows: targetRows,
        importo: targetRows.reduce(
          (sum: number, row: any) => sum + Number(row?.importo || 0),
          0
        ),
        quantita: targetRows.reduce(
          (sum: number, row: any) => sum - Math.abs(Number(row?.quantita || 0)),
          0
        ),
        explicit: explicitRows.length > 0,
      };
    };

    const summary = payload?.summaryTariffeAcquedotto || {};
    const acquedottoRows = sumNegativeRows(
      "componente_tariffa_acquedotto",
      isMainAcquedottoTariffRow
    );
    const depurazioneRows = sumNegativeRows("componente_tariffa_depurazione");
    const fognaturaRows = sumNegativeRows("componente_tariffa_fognatura");
    const oneriRows = sumNegativeRows("oneri_perequazione");
    const quotaFissaRows = sumNegativeRows("componente_quota_tariffa_acqua");
    const hasComponentRows =
      acquedottoRows.rows.length > 0 ||
      depurazioneRows.rows.length > 0 ||
      fognaturaRows.rows.length > 0 ||
      oneriRows.rows.length > 0 ||
      quotaFissaRows.rows.length > 0;

    const summaryAcquedotto =
      Number(summary.importoStorno || 0) || Number(summary.importoNeg || 0);
    const summaryMc =
      Number(summary.quantitaStorno || 0) || Number(summary.quantitaNeg || 0);
    const acquedotto = money(
      acquedottoRows.rows.length
        ? acquedottoRows.importo
        : summaryAcquedotto > 0
        ? -summaryAcquedotto
        : summaryAcquedotto
    );
    const mc = Number(
      (
        acquedottoRows.rows.length
          ? acquedottoRows.quantita
          : summaryMc > 0
          ? -summaryMc
          : summaryMc
      ).toFixed(3)
    );
    const depurazione = money(depurazioneRows.importo);
    const fognatura = money(fognaturaRows.importo);
    const depFog = money(depurazione + fognatura);
    const oneri = money(oneriRows.importo);
    const quotaFissa = money(quotaFissaRows.importo);
    const iva = money((acquedotto + depFog + quotaFissa + oneri) * 0.1);
    const totale = money(acquedotto + depFog + quotaFissa + oneri + iva);

    return {
      mc,
      acquedotto,
      depurazione,
      fognatura,
      depFog,
      quotaFissa,
      oneri,
      iva,
      totale,
      euro: totale,
      source: hasComponentRows
        ? acquedottoRows.explicit || depurazioneRows.explicit || fognaturaRows.explicit || oneriRows.explicit
          ? "component_rows_explicit"
          : "component_rows_negative"
        : acquedotto || mc
        ? "summary"
        : "none",
    };
  }

  function parseManualConsumptions(value: any): Record<string, string> {
    try {
      const raw = typeof value === "string" ? JSON.parse(value || "{}") : value || {};
      return Object.entries(raw).reduce((acc: Record<string, string>, [key, val]) => {
        if (val !== null && val !== undefined && val !== "") {
          acc[String(key)] = String(val);
        }
        return acc;
      }, {});
    } catch {
      return {};
    }
  }

  function getManualConsumptionPayload() {
    return Object.entries(manualConsumptions).reduce((acc: Record<string, number>, [key, val]) => {
      if (val === "") return acc;
      const parsed = Number(val);
      if (Number.isFinite(parsed) && parsed >= 0) {
        acc[key] = parsed;
      }
      return acc;
    }, {});
  }

  async function parseImportedInvoice(id: string) {
    try {
      setParsingImportId(id);
      setError(null);

      await api.post(`/fatture/imported-documents/${id}/parse`);

      await loadImportedDocuments();
      await loadImportedDocumentForSession(id);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore parsing bolletta");
    } finally {
      setParsingImportId(null);
    }
  }

  async function deleteImportedInvoice(doc: ImportedInvoiceDocument) {
    const label = doc.numero_bolletta || doc.original_filename || "questo documento";
    const importedNote =
      doc.parse_status === "imported"
        ? "\n\nIl documento risulta gia importato: verra rimosso da questa lista, non dalla fattura gia creata."
        : "";

    const confirmed = window.confirm(
      `Eliminare ${label}?${importedNote}`
    );

    if (!confirmed) return;

    try {
      setDeletingImportId(doc.id);
      setError(null);

      await api.delete(`/fatture/imported-documents/${doc.id}`);

      setImportedDocs((current) => current.filter((item) => item.id !== doc.id));

      if (selectedImportedDoc?.id === doc.id) {
        setSelectedImportedDoc(null);
        setSelectedImportedId(null);
        setImportedDocEdit(null);
        setEditingImportedDoc(false);
        setSelectedDoc(null);
        setAnnoTariffa("");
        setImportedDocYear(null);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore eliminazione documento");
    } finally {
      setDeletingImportId(null);
    }
  }

  async function uploadImportedInvoice() {
    if (!condominioId || !importFile) return;

    try {
      setUploadingImport(true);
      setError(null);

      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("condominioId", String(condominioId));
      if (importProviderId) {
        formData.append("providerId", String(importProviderId));
      }

      const res = await api.post("/fatture/imported-documents/upload", formData);

      const doc = res.data?.document;
      await loadImportedDocuments();

      if (doc?.id) {
        await loadImportedDocumentDetail(String(doc.id));
      }

      setImportFile(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore upload bolletta");
    } finally {
      setUploadingImport(false);
    }
  }
  async function loadImportedDocuments() {
    if (!condominioId) return;
    try {
      setLoadingImportedDocs(true);
      const res = await api.get(`/fatture/imported-documents/condominio/${condominioId}`);
      setImportedDocs(normalizeImportedDocuments(res.data?.items));
      console.log("Imported documents loaded:", res.data?.items || []);

    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore caricamento documenti importati");
    } finally {
      setLoadingImportedDocs(false);
    }
  }
function parseItalianDate(value?: string | null): Date | null {
  if (!value) return null;

  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [yyyy, mm, dd] = raw.slice(0, 10).split("-").map(Number);
    if (!dd || !mm || !yyyy) return null;

    const dt = new Date(yyyy, mm - 1, dd);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const parts = raw.split("/");
  if (parts.length !== 3) return null;

  const [dd, mm, yyyy] = parts.map(Number);
  if (!dd || !mm || !yyyy) return null;

  const dt = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function diffDaysInclusive(from?: string | null, to?: string | null): number | null {
  const start = parseItalianDate(from);
  const end = parseItalianDate(to);

  if (!start || !end) return null;

  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.round((end.getTime() - start.getTime()) / msPerDay);

  return diff >= 0 ? diff + 1 : null;
}

function diffDaysExclusive(from?: string | null, to?: string | null): number | null {
  const start = parseItalianDate(from);
  const end = parseItalianDate(to);

  if (!start || !end) return null;

  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.round((end.getTime() - start.getTime()) / msPerDay);

  return diff >= 0 ? diff : null;
}

function firstDateValue(source: any, keys: string[]): string | null {
  if (!source) return null;

  for (const key of keys) {
    const value = source?.[key];
    if (!value) continue;

    const parsed = parseItalianDate(String(value));
    if (parsed) return String(value);
  }

  return null;
}

function getPeriodStartDate(period: any): string | null {
  return firstDateValue(period, ["data_inizio", "from_date", "start_date"]);
}

function getPeriodEndDate(period: any): string | null {
  return firstDateValue(period, ["data_fine", "to_date", "end_date"]);
}

function getReadingDate(reading: any): string | null {
  return firstDateValue(reading, ["data_lettura", "date", "data"]);
}

function getInternalPeriodDate(period: any): string | null {
  return firstDateValue(period, [
    "dataCasaIdrica",
    "data_lettura_casa_idrica",
    "data_casa_idrica",
    "dataOperatore",
    "data_lettura_operatore",
    "data_operatore",
  ]);
}

function formatItalianDateValue(value?: string | null): string {
  const date = parseItalianDate(value);
  if (!date) return value ? String(value) : "";

  return date.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatPeriodMonthYear(period: any): string {
  const periodDate = getInternalPeriodDate(period);
  const parsedDate = parseItalianDate(periodDate);

  if (parsedDate) {
    return `${String(parsedDate.getMonth() + 1).padStart(2, "0")}/${parsedDate.getFullYear()}`;
  }

  const month = Number(period?.period_month || 0);
  const year = Number(period?.period_year || 0);

  if (month && year) {
    return `${String(month).padStart(2, "0")}/${year}`;
  }

  return "";
}

function buildRipartizionePeriodLabel(periodoPrecedente?: any, periodoAttuale?: any): string {
  const from = formatPeriodMonthYear(periodoPrecedente);
  const to = formatPeriodMonthYear(periodoAttuale);

  if (from && to) return `${from} - ${to}`;
  return from || to || "-";
}

function buildRipartizioneDataLettura(periodoAttuale?: any): string {
  return formatItalianDateValue(getInternalPeriodDate(periodoAttuale)) || "-";
}

function resolveGiorniInterniFromPeriods(
  periodoPrecedente?: any,
  periodoAttuale?: any
): number | null {
  const from = getInternalPeriodDate(periodoPrecedente);
  const to = getInternalPeriodDate(periodoAttuale);
  return diffDaysExclusive(from, to);
}

function positiveNumberOrNull(value: any): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getTotaleOneriPerequazione(payload: any): number {
  const rows = Array.isArray(payload?.oneri_perequazione)
    ? payload.oneri_perequazione
    : [];

  return rows.reduce((sum: number, row: any) => {
    return sum + Number(row?.importo ?? 0);
  }, 0);

}
function rangesOverlap(
  startA?: string | null,
  endA?: string | null,
  startB?: string | null,
  endB?: string | null
): boolean {
  const aStart = toDateObj(startA);
  const aEnd = toDateObj(endA);
  const bStart = toDateObj(startB);
  const bEnd = toDateObj(endB);

  if (!aStart || !aEnd || !bStart || !bEnd) return false;

  return aStart <= bEnd && aEnd >= bStart;
}

function parseOneriPerequazioneFromPayload(
  payloadJson?: string | null,
  parsedSummary?: any[],
  mode: OneriMode = "all"
): number {
  if (!payloadJson) return 0;

  try {
    const payload = JSON.parse(payloadJson);

    const oneriRows = Array.isArray(payload?.oneri_perequazione)
      ? payload.oneri_perequazione
      : [];

    if (mode === "all") {
      return oneriRows.reduce((sum: number, row: any) => {
        return sum + Number(row?.importo ?? 0);
      }, 0);
    }

    const mediaPeriods = Array.isArray(parsedSummary)
      ? parsedSummary.filter((p: any) => isAccontoLike(p?.tipo_lettura))
      : [];

    const filteredRows = oneriRows.filter((row: any) => {
      const overlapsMedia = mediaPeriods.some((period: any) =>
        rangesOverlap(
          row?.from_date,
          row?.to_date,
          period?.data_inizio,
          period?.data_fine
        )
      );

      if (mode === "media") return overlapsMedia;
      if (mode === "non_media") return !overlapsMedia;

      return true;
    });

    return filteredRows.reduce((sum: number, row: any) => {
      return sum + Number(row?.importo ?? 0);
    }, 0);
  } catch (err) {
    console.error("Errore durante il parsing degli oneri di perequazione:", err);
    return 0;
  }
}

function hasOneriPerequazioneRows(payloadJson?: string | null): boolean {
  if (!payloadJson) return false;

  try {
    const payload =
      typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;

    return (
      manualNumber(payload?.manual_overrides?.main?.oneri) !== null ||
      manualNumber(payload?.manual_overrides?.acconto?.oneri) !== null ||
      Array.isArray(payload?.oneri_perequazione) && payload.oneri_perequazione.length > 0
    );
  } catch (err) {
    return false;
  }
}

function isAccontoLike(tipo: any): boolean {
  const t = String(tipo ?? "").trim().toLowerCase();
  return t === "media" || t === "acconto" || t === "acconto_a_giro";
}

function getComponentTariffData(
  payloadJson?: string | null,
  componentName: ComponentName = "componente_tariffa_depurazione",
  signMode: SignMode = "all",
  periodMode: PeriodMode = "all"
): { totale: number; rows: any[] } {
  if (!payloadJson) return { totale: 0, rows: [] };

  try {
    const payload = JSON.parse(payloadJson);

    const rows = Array.isArray(payload?.[componentName])
      ? payload[componentName]
      : [];

    const periodi = Array.isArray(payload?.periodi_fatturazione)
      ? payload.periodi_fatturazione
      : [];

    const accontoPeriods = periodi.filter((p: any) => isAccontoLike(p?.tipo_lettura));

    const filteredRows = rows.filter((row: any) => {
      const importo = Number(row?.importo ?? 0);

      const signOk =
        signMode === "all" ||
        (signMode === "positive" && importo > 0) ||
        (signMode === "negative" && importo < 0);

      if (!signOk) return false;

      if (periodMode === "all") return true;

      const overlapsAcconto = accontoPeriods.some((period: any) =>
        rangesOverlap(
          row?.from_date,
          row?.to_date,
          period?.data_inizio,
          period?.data_fine
        )
      );

      if (periodMode === "acconto") return overlapsAcconto;
      if (periodMode === "non_acconto") return !overlapsAcconto;

      return true;
    });

    const totale = filteredRows.reduce((sum: number, row: any) => {
      return sum + Number(row?.importo ?? 0);
    }, 0);

    return { totale, rows: filteredRows };
  } catch (err) {
    console.error(`Errore durante il parsing di ${componentName}:`, err);
    return { totale: 0, rows: [] };
  }
}
function getDepFogData(
  payloadJson?: string | null,
  signMode: SignMode = "all",
  periodMode: PeriodMode = "all"
): { totale: number; dep: number; fog: number; depRows: any[]; fogRows: any[] } {
  const depData = getComponentTariffData(
    payloadJson,
    "componente_tariffa_depurazione",
    signMode,
    periodMode
  );

  const fogData = getComponentTariffData(
    payloadJson,
    "componente_tariffa_fognatura",
    signMode,
    periodMode
  );

  return {
    totale: depData.totale + fogData.totale,
    dep: depData.totale,
    fog: fogData.totale,
    depRows: depData.rows,
    fogRows: fogData.rows,
  };
}

function assignStateFromParsedPayload(payloadJson?: string | null) {
  if (!payloadJson) return;

  try {
    const payload = JSON.parse(payloadJson);
    console.log("Assigning state from parsed payload:", payload);

    const parsedSummary = summarizePeriodiAndTariffe(payload || null);
    const parsedBuckets = getParsedBuckets(payload, parsedSummary);
    if (parsedBuckets.aGiro.hasPeriod) {
      setParsedImpCons(parsedBuckets.aGiro.acquedotto);
      setDepFog(parsedBuckets.aGiro.depFog);
      setOneriPerequazione(parsedBuckets.aGiro.oneri);
    } else if (parsedBuckets.acconto.hasPeriod) {
      setParsedImpCons(parsedBuckets.acconto.acquedotto);
      setDepFog(parsedBuckets.acconto.depFog);
      setOneriPerequazione(parsedBuckets.acconto.oneri);
    } else {
      parsedConsumoFromParsedPayload(parsedSummary);
    }
    parseAccontoFromParsedPayload(payloadJson, parsedSummary);
    parseStornoFromParsedPayload(payloadJson);

    const manual = payload?.manual_overrides || {};
    const manualMain = manual?.main || {};
    const manualPrevious = manualNumber(manualMain.lettura_precedente);
    const manualCurrent = manualNumber(manualMain.lettura_attuale);
    const manualConsumption = manualNumber(manualMain.consumo_mc);
    if (manualNumber(manualMain.acquedotto) !== null) setParsedImpCons(Number(manualMain.acquedotto));
    if (manualNumber(manualMain.dep_fog) !== null) setDepFog(Number(manualMain.dep_fog));
    if (manualNumber(manualMain.oneri) !== null) setOneriPerequazione(Number(manualMain.oneri));
    if (manualNumber(manual.giorni_qf) !== null) setGiorniQf(Number(manual.giorni_qf));
    if (manualNumber(manual.giorni_consumi) !== null) setGiorniConsumi(Number(manual.giorni_consumi));
    if (manualPrevious !== null) setValPrec(String(manualPrevious));
    if (manualCurrent !== null) setValAtt(String(manualCurrent));
    else if (manualPrevious !== null && manualConsumption !== null) {
      setValAtt(String(manualPrevious + manualConsumption));
    } else if (manualPrevious === null && manualConsumption !== null) {
      setValPrec("0");
      setValAtt(String(manualConsumption));
    }


    console.log("Parsed summary from payload:", parsedSummary);


    const grouped = payload.grouped_letture || {};
    const aGiro = grouped.a_giro;
   

    if (aGiro?.oldest?.lettura_mc != null && aGiro?.newest?.lettura_mc != null) {

      if (manualPrevious === null) setValPrec(String(aGiro.oldest.lettura_mc));
      if (manualCurrent === null && manualConsumption === null) setValAtt(String(aGiro.newest.lettura_mc));
      if (manualNumber(manual.giorni_consumi) === null) {
        setGiorniConsumi(diffDaysExclusive(aGiro.oldest.data_lettura, aGiro.newest.data_lettura) ?? 0);
      }
      
      
      if (manualNumber(manual.giorni_qf) === null) parseQFFromParsedPayload(payloadJson);
      if (!parsedBuckets.aGiro.hasPeriod) {
        setOneriPerequazione(parseOneriPerequazioneFromPayload(payloadJson, parsedSummary, "non_media"));
        setDepFog(getDepFogData(payloadJson, "positive", "non_acconto").totale); //JSON.parse(payloadJson).totale_dep_fog
      }
       

      setParsingAlert?.(null);
      return;
    }

    const estimatedOnly = !hasAGiroConsumption(payload, parsedSummary);
    const estimatedReadings = grouped.media || grouped.acconto || grouped.acconto_a_giro;

    if (
      estimatedOnly &&
      estimatedReadings?.oldest?.lettura_mc != null &&
      estimatedReadings?.newest?.lettura_mc != null
    ) {
      if (manualPrevious === null) setValPrec(String(estimatedReadings.oldest.lettura_mc));
      if (manualCurrent === null && manualConsumption === null) setValAtt(String(estimatedReadings.newest.lettura_mc));
      if (manualNumber(manual.giorni_consumi) === null) {
        setGiorniConsumi(
          diffDaysExclusive(
            estimatedReadings.oldest.data_lettura,
            estimatedReadings.newest.data_lettura
          ) ?? 0
        );
      }
      if (manualNumber(manual.giorni_qf) === null) parseQFFromParsedPayload(payloadJson);
      setParsingAlert?.(null);
      return;
    }

    if (manualPrevious !== null || manualCurrent !== null || manualConsumption !== null) {
      setParsingAlert?.(null);
      return;
    }

    const availableTypes = Object.keys(grouped);
    const message =
      availableTypes.length > 0
        ? `Nessuna lettura valida di tipo "a_giro" trovata. Tipi disponibili: ${availableTypes.join(", ")}. Seleziona manualmente quali valori usare per Valore Precedente e Valore Attuale.`
        : `Nessuna grouped_letture disponibile nel payload.`;

    if (typeof setParsingAlert === "function") {
      setParsingAlert({
        type: "warning",
        message,
        grouped,
        availableTypes,
      });
    }
  } catch (err) {
    console.error("Errore durante il parsing del payload:", err);
  }
}

function applyParsedReadingBucket(type: string) {
  const bucket = parsingAlert?.grouped?.[type];
  const oldest = bucket?.oldest;
  const newest = bucket?.newest;

  if (oldest?.lettura_mc == null || newest?.lettura_mc == null) {
    setError(`La lettura "${type}" non contiene valori sufficienti.`);
    return;
  }

  setValPrec(String(oldest.lettura_mc));
  setValAtt(String(newest.lettura_mc));
  setGiorniConsumi(diffDaysExclusive(oldest.data_lettura, newest.data_lettura) ?? 0);
  setParsingAlert(null);
  setError(null);
}

  function parseItalianDateToIso(dateStr?: string | null): string | null {
    if (!dateStr || typeof dateStr !== "string") return null;

    const parts = dateStr.trim().split("/");
    if (parts.length !== 3) return null;

    const [dd, mm, yyyy] = parts;
    if (!dd || !mm || !yyyy) return null;

    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  function normalizeDate(dateStr?: string | null): string | null {
    if (!dateStr) return null;

    // already ISO-like
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
      return dateStr.trim();
    }

    // italian format dd/mm/yyyy
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr.trim())) {
      return parseItalianDateToIso(dateStr);
    }

    return null;
  }
 
  function parsedConsumoFromParsedPayload(parsedSummary?: any){
    parsedSummary?.map((t: any) => {
      if(String(t.tipo_lettura ?? "").trim().toLowerCase() === "a_giro") {
        setParsedImpCons(t.totali.importo_positive)
      }   
    })
  }
 function toDateObj(dateStr?: string | null): Date | null {
  const normalized = normalizeDate(dateStr);
  if (!normalized) return null;

  const d = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getDepFogAccontoByOverlap(
  payload: any,
  dataInizio: string | null,
  dataFine: string | null
): number {
  if (!payload || !dataInizio || !dataFine) return 0;

  const start = toDateObj(dataInizio);
  const end = toDateObj(dataFine);
  if (!start || !end) return 0;

  const dep = Array.isArray(payload.componente_tariffa_depurazione)
    ? payload.componente_tariffa_depurazione
    : [];

  const fog = Array.isArray(payload.componente_tariffa_fognatura)
    ? payload.componente_tariffa_fognatura
    : [];

  const overlaps = (row: any) => {
    const rowStart = toDateObj(row?.from_date);
    const rowEnd = toDateObj(row?.to_date);
    if (!rowStart || !rowEnd) return false;

    return rowStart <= end && rowEnd >= start;
  };

  const sumRows = (rows: any[]) =>
    rows.reduce((sum, row) => {
      if (overlaps(row)) {
        return sum + Number(row?.importo ?? 0);
      }
      return sum;
    }, 0);

  return sumRows(dep) + sumRows(fog);
}

function resetAccontoFromParsedPayload() {
  setGiorniAcconto(0);
  setMcAcconto(0);
  setEurAcconto(0);
  setIvaAcconto(0);
  setDepfogAcconto(0);
  setTotaleAcconto(0);
  setOneriPerequazioneAcconto(0);
}

function resetParsedDocumentState() {
  setSelectedImportedId(null);
  setSelectedImportedDoc(null);
  setImportedDocEdit(null);
  setEditingImportedDoc(false);
  setSelectedDoc(null);
  setImportedDocYear(null);
  setParsedImpCons(0);
  setDepFog(0);
  setParsedQF(null);
  setOneriPerequazione(0);
  setMcStorno(0);
  setEurStorno(0);
  setAcquedottoStorno(0);
  setDepfogStorno(0);
  setIvaStorno(0);
  setOneriPerequazioneStorno(0);
  setTotaleStorno(0);
  resetAccontoFromParsedPayload();
}

function resolveAccontoPeriodFromPayload(payload: any, parsedSummary?: any) {
  if (!hasAGiroConsumption(payload, parsedSummary)) {
    return null;
  }

  const periodi = Array.isArray(payload?.periodi_fatturazione)
    ? payload.periodi_fatturazione
    : [];

  const accontoPeriodIndex = periodi.findIndex((p: any) =>
    isAccontoLike(p?.tipo_lettura)
  );
  const accontoPeriod =
    accontoPeriodIndex >= 0 ? periodi[accontoPeriodIndex] : null;
  const previousPeriod =
    accontoPeriodIndex > 0 ? periodi[accontoPeriodIndex - 1] : null;

  const accontoSummary = Array.isArray(parsedSummary)
    ? parsedSummary.find((t: any) => isAccontoLike(t?.tipo_lettura))
    : null;

  const grouped = payload?.grouped_letture || {};
  const groupedAcconto =
    grouped.media ||
    grouped.acconto ||
    grouped.acconto_a_giro ||
    null;

  const letture = Array.isArray(payload?.letture) ? payload.letture : [];
  const sortedLetture = [...letture]
    .filter((reading: any) => getReadingDate(reading))
    .sort((a: any, b: any) => {
      const ad = parseItalianDate(getReadingDate(a));
      const bd = parseItalianDate(getReadingDate(b));
      return (ad?.getTime() ?? 0) - (bd?.getTime() ?? 0);
    });

  const accontoReading = sortedLetture.find((reading: any) =>
    isAccontoLike(reading?.tipo_lettura)
  );

  const explicitEnd =
    getPeriodEndDate(accontoPeriod) ??
    getPeriodEndDate(accontoSummary) ??
    getReadingDate(groupedAcconto?.newest) ??
    getReadingDate(accontoReading);

  const explicitStart =
    getPeriodStartDate(accontoPeriod) ??
    getPeriodStartDate(accontoSummary);

  const previousPeriodEnd = getPeriodEndDate(previousPeriod);

  const previousReadingBeforeAcconto = explicitEnd
    ? [...sortedLetture]
        .reverse()
        .find((reading: any) => {
          const readingDate = parseItalianDate(getReadingDate(reading));
          const endDate = parseItalianDate(explicitEnd);
          return (
            readingDate &&
            endDate &&
            readingDate < endDate &&
            !isAccontoLike(reading?.tipo_lettura)
          );
        })
    : null;

  const groupedAgiRoEnd = getReadingDate(grouped?.a_giro?.newest);
  const groupedAccontoStart = getReadingDate(groupedAcconto?.oldest);
  const groupedAccontoEnd = getReadingDate(groupedAcconto?.newest);
  const groupedStart =
    groupedAccontoStart && groupedAccontoStart !== groupedAccontoEnd
      ? groupedAccontoStart
      : null;

  const dataInizio =
    explicitStart ??
    previousPeriodEnd ??
    getReadingDate(previousReadingBeforeAcconto) ??
    groupedAgiRoEnd ??
    groupedStart;
  const dataFine = explicitEnd ?? groupedAccontoEnd;

  const consumo = Number(
    accontoPeriod?.consumo_mc ??
      accontoSummary?.consumo_periodo_mc ??
      payload?.letture_summary?.consumo_acconto ??
      accontoReading?.consumo_mc ??
      groupedAcconto?.newest?.consumo_mc ??
      0
  );

  if (!accontoPeriod && !accontoSummary && !groupedAcconto && !accontoReading) {
    return null;
  }

  return {
    dataInizio,
    dataFine,
    consumo,
    accontoSummary,
  };
}

function sumRows(rows: any[]) {
  return rows.reduce(
    (acc: any, row: any) => {
      acc.quantita += Number(row?.quantita ?? 0);
      acc.importo += Number(row?.importo ?? 0);
      return acc;
    },
    { quantita: 0, importo: 0 }
  );
}

function dateTime(value?: string | null): number | null {
  const date = parseItalianDate(value);
  return date ? date.getTime() : null;
}

function getParsedComponentImportoByConsumption(
  payload: any,
  componentName: string,
  consumoAcconto: number,
  accontoEnd?: string | null
): number | null {
  const targetMc = Math.abs(Number(consumoAcconto || 0));
  if (!targetMc) return null;

  const rows = Array.isArray(payload?.[componentName])
    ? payload[componentName].filter((row: any) => Number(row?.importo ?? 0) > 0)
    : [];

  if (!rows.length) return null;

  const tolerance = Math.max(0.01, targetMc * 0.002);
  const accontoEndTime = dateTime(accontoEnd);

  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const key = `${row?.from_date ?? ""}|${row?.to_date ?? ""}`;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }

  const matchingGroup = [...grouped.values()]
    .map((groupRows) => {
      const total = sumRows(groupRows);
      return {
        ...total,
        from: groupRows[0]?.from_date ?? null,
        to: groupRows[0]?.to_date ?? null,
        endTime: dateTime(groupRows[0]?.to_date),
      };
    })
    .filter((total) => Math.abs(Math.abs(Number(total.quantita || 0)) - targetMc) <= tolerance)
    .sort((a, b) => {
      if (accontoEndTime !== null) {
        const aDistance = a.endTime !== null ? Math.abs(a.endTime - accontoEndTime) : Number.MAX_SAFE_INTEGER;
        const bDistance = b.endTime !== null ? Math.abs(b.endTime - accontoEndTime) : Number.MAX_SAFE_INTEGER;
        if (aDistance !== bDistance) return aDistance - bDistance;
      }

      return Number(b.endTime || 0) - Number(a.endTime || 0);
    })[0];

  if (matchingGroup) return Number(matchingGroup.importo || 0);

  const exactRow = rows
    .filter((row: any) => Math.abs(Math.abs(Number(row?.quantita ?? 0)) - targetMc) <= tolerance)
    .sort((a: any, b: any) => Number(dateTime(b?.to_date) || 0) - Number(dateTime(a?.to_date) || 0))[0];

  return exactRow ? Number(exactRow.importo ?? 0) : null;
}

function sameDate(a?: string | null, b?: string | null) {
  const at = dateTime(a);
  const bt = dateTime(b);
  return at !== null && bt !== null && at === bt;
}

function isContainedInPeriod(row: any, period: any) {
  const rowStart = dateTime(row?.from_date);
  const rowEnd = dateTime(row?.to_date);
  const periodStart = dateTime(period?.data_inizio);
  const periodEnd = dateTime(period?.data_fine);

  return (
    rowStart !== null &&
    rowEnd !== null &&
    periodStart !== null &&
    periodEnd !== null &&
    rowStart >= periodStart &&
    rowEnd <= periodEnd
  );
}

function closeQuantity(a: any, b: any) {
  const target = Math.abs(Number(b || 0));
  if (!target) return false;
  return Math.abs(Math.abs(Number(a || 0)) - target) <= Math.max(0.01, target * 0.002);
}

function getTypedPeriod(parsedSummary: any[] | undefined, tipo: "a_giro" | "media") {
  return Array.isArray(parsedSummary)
    ? parsedSummary.find((period: any) => String(period?.tipo_lettura || "").toLowerCase() === tipo)
    : null;
}

function hasAGiroConsumption(payload: any, parsedSummary?: any) {
  const grouped = payload?.grouped_letture || {};
  if (grouped?.a_giro?.oldest && grouped?.a_giro?.newest) return true;

  return Array.isArray(parsedSummary)
    ? parsedSummary.some((period: any) => {
        const tipo = String(period?.tipo_lettura || "").trim().toLowerCase();
        return tipo === "a_giro" && Number(period?.consumo_periodo_mc ?? 0) > 0;
      })
    : false;
}

function getEstimatedConsumptionPeriod(payload: any, parsedSummary?: any) {
  const summaryPeriod = Array.isArray(parsedSummary)
    ? parsedSummary.find((period: any) => isAccontoLike(period?.tipo_lettura))
    : null;
  if (summaryPeriod) return summaryPeriod;

  return Array.isArray(payload?.periodi_fatturazione)
    ? payload.periodi_fatturazione.find((period: any) => isAccontoLike(period?.tipo_lettura))
    : null;
}

function sumComponentForPeriod(
  payload: any,
  componentName: string,
  period: any,
  consumoMc: number,
  sign: "positive" | "negative" = "positive"
) {
  const rows = Array.isArray(payload?.[componentName]) ? payload[componentName] : [];
  if (!rows.length) return 0;

  const signedRows = rows.filter((row: any) => {
    const importo = Number(row?.importo ?? 0);
    if (sign === "positive") return importo > 0;
    return importo < 0;
  });

  const exactPeriodRows = signedRows.filter((row: any) => {
    const exactDates =
      sameDate(row?.from_date, period?.data_inizio) &&
      sameDate(row?.to_date, period?.data_fine);

    if (!exactDates) return false;

    if (Number(row?.quantita || 0) === 0 || !consumoMc) return true;

    return Math.abs(Number(row?.quantita || 0)) <= Math.abs(Number(consumoMc || 0));
  });

  if (exactPeriodRows.length) {
    return exactPeriodRows.reduce((sum: number, row: any) => sum + Number(row?.importo ?? 0), 0);
  }

  const containedPeriodRows = signedRows.filter((row: any) =>
    isContainedInPeriod(row, period)
  );

  if (containedPeriodRows.length) {
    return containedPeriodRows.reduce((sum: number, row: any) => sum + Number(row?.importo ?? 0), 0);
  }

  return getParsedComponentImportoByConsumption(
    payload,
    componentName,
    consumoMc,
    period?.data_fine
  ) ?? 0;
}

function sumOneriForPeriod(payload: any, period: any, sign: "positive" | "negative" = "positive") {
  const rows = Array.isArray(payload?.oneri_perequazione) ? payload.oneri_perequazione : [];

  return rows
    .filter((row: any) => {
      const importo = Number(row?.importo ?? 0);
      const signOk = sign === "positive" ? importo > 0 : importo < 0;

      return signOk && (
        (
          sameDate(row?.from_date, period?.data_inizio) &&
          sameDate(row?.to_date, period?.data_fine)
        ) ||
        isContainedInPeriod(row, period)
      );
    })
    .reduce((sum: number, row: any) => sum + Number(row?.importo ?? 0), 0);
}

function getParsedBuckets(payload: any, parsedSummary: any[] | undefined) {
  const aGiroPeriod = getTypedPeriod(parsedSummary, "a_giro");
  const mediaPeriod = getTypedPeriod(parsedSummary, "media");

  const aGiroMc = Number(aGiroPeriod?.consumo_periodo_mc ?? 0);
  const mediaMc = Number(mediaPeriod?.consumo_periodo_mc ?? 0);

  const bucketFor = (period: any, consumoMc: number) => {
    if (!period) {
      return {
        hasPeriod: false,
        consumoMc: 0,
        acquedotto: 0,
        depurazione: 0,
        fognatura: 0,
        depFog: 0,
        oneri: 0,
      };
    }

    const acquedotto = sumComponentForPeriod(
      payload,
      "componente_tariffa_acquedotto",
      period,
      consumoMc
    );
    const depurazione = sumComponentForPeriod(
      payload,
      "componente_tariffa_depurazione",
      period,
      consumoMc
    );
    const fognatura = sumComponentForPeriod(
      payload,
      "componente_tariffa_fognatura",
      period,
      consumoMc
    );
    const oneri = sumOneriForPeriod(payload, period);

    return {
      hasPeriod: true,
      consumoMc,
      acquedotto,
      depurazione,
      fognatura,
      depFog: depurazione + fognatura,
      oneri,
    };
  };

  const aGiro = bucketFor(aGiroPeriod, aGiroMc);
  const manualMain = payload?.manual_overrides?.main;
  const hasManualMain =
    manualMain && Object.values(manualMain).some((value) => manualNumber(value) !== null);

  return {
    aGiro: hasManualMain
      ? {
          ...aGiro,
          hasPeriod: true,
          consumoMc: manualNumber(manualMain.consumo_mc) ?? aGiro.consumoMc,
          acquedotto: manualNumber(manualMain.acquedotto) ?? aGiro.acquedotto,
          depFog: manualNumber(manualMain.dep_fog) ?? aGiro.depFog,
          oneri: manualNumber(manualMain.oneri) ?? aGiro.oneri,
        }
      : aGiro,
    acconto: bucketFor(mediaPeriod, mediaMc),
  };
}

function getParsedQuotaFissaRowsTotal(payload: any) {
  const rows = Array.isArray(payload?.componente_quota_tariffa_acqua)
    ? payload.componente_quota_tariffa_acqua
    : [];

  return rows
    .filter((row: any) => Number(row?.importo || 0) !== 0)
    .reduce((sum: number, row: any) => sum + Number(row?.importo || 0), 0);
}

function getParsedQuotaFissaFromPayload(payload: any) {
  const manual = payload?.manual_overrides || {};
  const mainQf = manualNumber(manual?.main?.quota_fissa);
  const accontoQf = manualNumber(manual?.acconto?.quota_fissa);
  const stornoQf = manualNumber(manual?.storno?.quota_fissa);
  const sectionValues = [mainQf, accontoQf, stornoQf];
  const hasSectionQf = sectionValues.some((value) => value !== null);

  if (hasSectionQf) {
    return (
      Math.abs(Number(mainQf || 0)) +
      Math.abs(Number(accontoQf || 0)) -
      Math.abs(Number(stornoQf || 0))
    );
  }

  return getParsedQuotaFissaRowsTotal(payload);
}

function getStornoValuesForCalculation(payload: any) {
  const displayed = getStornoValuesFromPayload(payload);
  const deduction = (value: any) => {
    const parsed = manualNumber(value);
    return parsed === null || parsed === 0 ? 0 : -Math.abs(parsed);
  };

  return {
    ...displayed,
    mc: deduction(displayed.mc),
    acquedotto: deduction(displayed.acquedotto),
    depurazione: deduction(displayed.depurazione),
    fognatura: deduction(displayed.fognatura),
    depFog: deduction(displayed.depFog),
    quotaFissa: deduction(displayed.quotaFissa),
    oneri: deduction(displayed.oneri),
    iva: deduction(displayed.iva),
    totale: deduction(displayed.totale),
    euro: deduction(displayed.euro),
    source: displayed.source === "none" ? "none" : `${displayed.source}_deduction`,
  };
}

function getFornituraSummaryByType(payload: any, tipo: "a_giro" | "media") {
  const manualTotal =
    tipo === "a_giro"
      ? manualNumber(payload?.manual_overrides?.main?.totale)
      : manualNumber(payload?.manual_overrides?.acconto?.totale);
  if (manualTotal !== null) {
    return { tipo_lettura: tipo, totale_fornitura: manualTotal, source: "manual_override" };
  }

  const summaries = Array.isArray(payload?.forniture_summary)
    ? payload.forniture_summary
    : [];

  const direct = summaries.find(
    (item: any) => String(item?.tipo_lettura || "").toLowerCase() === tipo
  );

  if (direct) return direct;

  const grouped = payload?.grouped_letture || {};
  const target =
    tipo === "media"
      ? grouped.media || grouped.acconto || grouped.acconto_a_giro
      : grouped.a_giro;
  const targetMc = Number(target?.newest?.consumo_mc || 0);

  if (!targetMc) return null;

  return summaries.find(
    (item: any) => Math.abs(Number(item?.consumo_mc || 0) - targetMc) <= 0.01
  ) || null;
}

function parseAccontoFromParsedPayload(payloadJson?: string | null, parsedSummary?: any) {
  if (!payloadJson) return;

  try {
    const parsedAcconto = getAccontoValuesFromParsedPayload(payloadJson, parsedSummary);

    if (!parsedAcconto) {
      resetAccontoFromParsedPayload();
      return;
    }

    setGiorniAcconto(parsedAcconto.giorni);
    setMcAcconto(parsedAcconto.mc);
    setOneriPerequazioneAcconto(parsedAcconto.oneri);
      
    setEurAcconto(parsedAcconto.acquedotto);
    setIvaAcconto(parsedAcconto.iva);
    setDepfogAcconto(parsedAcconto.depFog);
    setTotaleAcconto(parsedAcconto.totale);
    
    
  } catch (err) {
    console.error("Errore durante il parsing del payload per l'acconto:", err);
  }
}

function getAccontoValuesFromParsedPayload(payloadJson?: string | null, parsedSummary?: any) {
  if (!payloadJson) return null;

  try {
    const payload = JSON.parse(payloadJson);
    const manual = payload?.manual_overrides?.acconto;
    if (manual && Object.values(manual).some((value) => manualNumber(value) !== null)) {
      const acquedotto = manualNumber(manual.acquedotto) ?? 0;
      const depFog = manualNumber(manual.dep_fog) ?? 0;
      const quotaFissa = manualNumber(manual.quota_fissa) ?? 0;
      const oneri = manualNumber(manual.oneri) ?? 0;
      const iva = manualNumber(manual.iva) ?? 0;
      return {
        giorni: manualNumber(manual.giorni) ?? 0,
        mc: manualNumber(manual.mc) ?? 0,
        acquedotto,
        depFog,
        quotaFissa,
        oneri,
        iva,
        totale: manualNumber(manual.totale) ?? acquedotto + depFog + quotaFissa + oneri + iva,
      };
    }
    const summary = parsedSummary ?? summarizePeriodiAndTariffe(payload || null);
    const resolvedAcconto = resolveAccontoPeriodFromPayload(payload, summary);

    if (!resolvedAcconto) return null;

    const buckets = getParsedBuckets(payload, summary);
    const acquedotto = Number(
      buckets.acconto.acquedotto || resolvedAcconto.accontoSummary?.totali?.importo_positive || 0
    );
    const depFog = Number(buckets.acconto.depFog || 0);
    const oneri = Number(buckets.acconto.oneri || 0);
    const iva = (acquedotto + depFog + oneri) * 0.1;

    return {
      giorni: diffDaysExclusive(resolvedAcconto.dataInizio ?? null, resolvedAcconto.dataFine ?? null) ?? 0,
      mc: Number(resolvedAcconto.consumo ?? 0),
      acquedotto,
      depFog,
      quotaFissa: 0,
      oneri,
      iva,
      totale: acquedotto + depFog + oneri + iva,
    };
  } catch {
    return null;
  }
}

  function parseStornoFromParsedPayload(payloadJson?: string | null) {
    if (!payloadJson) return; 
    try {
      const payload = JSON.parse(payloadJson);
      const parsedStorno = getStornoValuesFromPayload(payload);
      if (parsedStorno.mc !== 0 || parsedStorno.totale !== 0) {
          setMcStorno(parsedStorno.mc);
          setAcquedottoStorno(parsedStorno.acquedotto);
          setDepfogStorno(parsedStorno.depFog);
          setIvaStorno(parsedStorno.iva);
          setOneriPerequazioneStorno(parsedStorno.oneri);
          setTotaleStorno(parsedStorno.totale);
          setEurStorno(parsedStorno.totale);
      } else {
          setMcStorno(0);
          setAcquedottoStorno(0);
          setDepfogStorno(0);
          setIvaStorno(0);
          setOneriPerequazioneStorno(0);
          setTotaleStorno(0);
          setEurStorno(0);
      }
      
    }catch (err) {
      console.error("Errore durante il parsing del payload per lo storno:", err);
    }
  }    

  function deriveGiorniQfFromPayload(payload: any): number | null {
    const rows = Array.isArray(payload?.componente_quota_tariffa_acqua)
      ? payload.componente_quota_tariffa_acqua
      : [];

    const intervals = rows
      .filter((row: any) => Number(row?.importo || 0) !== 0)
      .map((row: any) => {
        const start = parseItalianDate(row?.from_date);
        const end = parseItalianDate(row?.to_date);
        const days = diffDaysInclusive(row?.from_date, row?.to_date);

        return start && end && days !== null
          ? {
              ...row,
              start,
              end,
              days,
              importo: Number(row?.importo || 0),
            }
          : null;
      })
      .filter(Boolean);

    if (!intervals.length) return null;

    const signedRows = intervals.filter((row: any) => row.importo < 0);
    if (signedRows.length) {
      const total = intervals.reduce((sum: number, row: any) => {
        return sum + (row.importo < 0 ? -row.days : row.days);
      }, 0);
      return Math.max(0, Math.round(total));
    }

    const ordered = [...intervals].sort((a: any, b: any) => b.days - a.days);
    const main = ordered[0];
    const containedAdjustments = ordered.slice(1).filter((row: any) => {
      return row.start >= main.start && row.end <= main.end;
    });

    if (containedAdjustments.length) {
      const adjustmentDays = containedAdjustments.reduce(
        (sum: number, row: any) => sum + row.days,
        0
      );
      return Math.max(0, Math.round(main.days - adjustmentDays));
    }

    return Math.round(
      intervals.reduce((sum: number, row: any) => sum + row.days, 0)
    );
  }

  function parseQFFromParsedPayload(payloadJson?: string | null) {
    if (!payloadJson) return;
    try {
      const payload = JSON.parse(payloadJson);
      const giorni = deriveGiorniQfFromPayload(payload);
      if (giorni !== null) {
        setGiorniQf(giorni);
      }
      setParsedQF(null);
    }catch (err) {
      console.error("Errore durante il parsing del payload per il QF:", err);
    }
  }

  function editValue(value: any): string {
    return value === null || value === undefined ? "" : String(value);
  }

  function buildImportedDocumentEditForm(document: ImportedInvoiceDocument): ImportedDocumentEditForm {
    const payloadJson =
      typeof document.parsed_payload_json === "string"
        ? document.parsed_payload_json
        : document.parsed_payload_json
        ? JSON.stringify(document.parsed_payload_json)
        : null;
    const payload = getParsedPayloadObject(payloadJson) || {};
    const manual = payload?.manual_overrides || {};
    const summary = summarizePeriodiAndTariffe(payload || null);
    const buckets = getParsedBuckets(payload, summary);
    const main = manual?.main || {};
    const groupedMain = payload?.grouped_letture?.a_giro ||
      payload?.grouped_letture?.media ||
      payload?.grouped_letture?.acconto || {};
    const acconto = getAccontoValuesFromParsedPayload(payloadJson || undefined, summary);
    const storno = getStornoValuesFromPayload(payload);
    const params = getParsedCalculationParams(payloadJson || undefined, summary);
    const anagrafica = payload?.anagrafica || {};
    const mainQuotaFissa =
      manualNumber(main.quota_fissa) ?? getParsedQuotaFissaRowsTotal(payload);
    const mainIva = manualNumber(main.iva);
    const parsedMainSupply = getFornituraSummaryByType(payload, "a_giro");
    const mainSupplyTotal =
      manualNumber(main.totale) ??
      (parsedMainSupply ? Number(parsedMainSupply.totale_fornitura || 0) : null);
    const hasStornoValues = storno?.source && storno.source !== "none";
    const positiveStornoEditValue = (value: any) => {
      const parsed = manualNumber(value);
      return editValue(parsed === null ? null : Math.abs(parsed));
    };

    return {
      providerId: editValue(document.provider_id),
      numeroBolletta: editValue(document.numero_bolletta ?? payload?.numero_bolletta),
      codiceFornitura: editValue(document.codice_fornitura ?? payload?.codice_fornitura),
      codiceCliente: editValue(document.codice_cliente ?? anagrafica?.codice_cliente),
      puntoErogazione: editValue(document.punto_erogazione ?? payload?.punto_erogazione),
      matricolaContatore: editValue(document.matricola_contatore ?? anagrafica?.matricola_contatore),
      intestatario: editValue(document.intestatario ?? anagrafica?.intestatario),
      indirizzoFornitura: editValue(document.indirizzo_fornitura ?? anagrafica?.indirizzo_fornitura),
      fornitoreServizi: editValue(document.fornitore_servizi ?? payload?.fornitore_servizi),
      billType: editValue(document.bill_type || payload?.bill_type || "unknown"),
      dataInizioPeriodo: editValue(document.data_inizio_periodo).slice(0, 10),
      dataFinePeriodo: editValue(document.data_fine_periodo).slice(0, 10),
      consumoGlobaleMc: editValue(document.consumo_globale_mc ?? payload?.consumo_globale_mc),
      importoTotaleDaPagare: editValue(document.importo_totale_da_pagare ?? payload?.importo_totale_da_pagare),
      letturaPrecedente: editValue(manualNumber(main.lettura_precedente) ?? groupedMain?.oldest?.lettura_mc),
      letturaAttuale: editValue(manualNumber(main.lettura_attuale) ?? groupedMain?.newest?.lettura_mc),
      giorniQF: editValue(manualNumber(manual.giorni_qf) ?? params?.giorniQF),
      giorniConsumi: editValue(manualNumber(manual.giorni_consumi) ?? params?.giorniConsumi),
      acquedotto: editValue(manualNumber(main.acquedotto) ?? buckets.aGiro.acquedotto),
      depFog: editValue(manualNumber(main.dep_fog) ?? buckets.aGiro.depFog),
      quotaFissa: editValue(mainQuotaFissa),
      oneri: editValue(manualNumber(main.oneri) ?? buckets.aGiro.oneri),
      iva: editValue(mainIva),
      totaleLettura: editValue(mainSupplyTotal),
      giorniAcconto: editValue(acconto?.giorni),
      mcAcconto: editValue(acconto?.mc),
      acquedottoAcconto: editValue(acconto?.acquedotto),
      depFogAcconto: editValue(acconto?.depFog),
      quotaFissaAcconto: editValue(manualNumber(manual?.acconto?.quota_fissa) ?? acconto?.quotaFissa),
      oneriAcconto: editValue(acconto?.oneri),
      ivaAcconto: editValue(manualNumber(manual?.acconto?.iva)),
      totaleAcconto: editValue(acconto?.totale),
      mcStorno: positiveStornoEditValue(hasStornoValues ? storno?.mc : null),
      acquedottoStorno: positiveStornoEditValue(hasStornoValues ? storno?.acquedotto : null),
      depFogStorno: positiveStornoEditValue(hasStornoValues ? storno?.depFog : null),
      quotaFissaStorno: positiveStornoEditValue(hasStornoValues ? storno?.quotaFissa : null),
      oneriStorno: positiveStornoEditValue(hasStornoValues ? storno?.oneri : null),
      ivaStorno: positiveStornoEditValue(manual?.storno?.iva),
      totaleStorno: positiveStornoEditValue(hasStornoValues ? storno?.totale : null),
    };
  }

  function openImportedDocumentEditor(document: ImportedInvoiceDocument) {
    setImportedDocEdit(buildImportedDocumentEditForm(document));
    setEditingImportedDoc(true);
    setError(null);
  }

  function updateImportedDocumentEdit(field: keyof ImportedDocumentEditForm, value: string) {
    setImportedDocEdit((previous) => previous ? { ...previous, [field]: value } : previous);
  }

  async function saveImportedDocumentManualEdit() {
    if (!selectedImportedDoc?.id || !importedDocEdit) return;

    const optionalNumber = (value: string, label: string) => {
      if (value.trim() === "") return null;
      const parsed = Number(value.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${label}: inserisci un numero valido non negativo.`);
      }
      return parsed;
    };

    try {
      setSavingImportedDoc(true);
      setError(null);
      const form = importedDocEdit;
      if (form.dataInizioPeriodo && form.dataFinePeriodo && form.dataInizioPeriodo > form.dataFinePeriodo) {
        throw new Error("La data di inizio periodo non può essere successiva alla data di fine.");
      }

      const currentPayload = getParsedPayloadObject(selectedImportedDoc.parsed_payload_json) || {};
      const mainConsumption = optionalNumber(form.consumoGlobaleMc, "Consumo globale");
      const previousReading = optionalNumber(form.letturaPrecedente, "Lettura precedente");
      const currentReading = optionalNumber(form.letturaAttuale, "Lettura attuale");
      const inferredConsumption =
        previousReading !== null && currentReading !== null
          ? currentReading - previousReading
          : mainConsumption;
      if (inferredConsumption !== null && inferredConsumption < 0) {
        throw new Error("La lettura attuale non può essere inferiore alla lettura precedente.");
      }

      const manualOverrides = {
        schema_version: 2,
        edited_at: new Date().toISOString(),
        giorni_qf: optionalNumber(form.giorniQF, "Giorni QF"),
        giorni_consumi: optionalNumber(form.giorniConsumi, "Giorni consumi"),
        main: {
          lettura_precedente: previousReading,
          lettura_attuale: currentReading,
          consumo_mc: inferredConsumption,
          acquedotto: optionalNumber(form.acquedotto, "Acquedotto"),
          dep_fog: optionalNumber(form.depFog, "Depurazione e fognatura"),
          quota_fissa: optionalNumber(form.quotaFissa, "Quota fissa"),
          oneri: optionalNumber(form.oneri, "Oneri"),
          iva: optionalNumber(form.iva, "IVA lettura a giro"),
          totale: optionalNumber(form.totaleLettura, "Totale lettura"),
        },
        acconto: {
          giorni: optionalNumber(form.giorniAcconto, "Giorni acconto"),
          mc: optionalNumber(form.mcAcconto, "Consumo acconto"),
          acquedotto: optionalNumber(form.acquedottoAcconto, "Acquedotto acconto"),
          dep_fog: optionalNumber(form.depFogAcconto, "Depurazione e fognatura acconto"),
          quota_fissa: optionalNumber(form.quotaFissaAcconto, "Quota fissa acconto"),
          oneri: optionalNumber(form.oneriAcconto, "Oneri acconto"),
          iva: optionalNumber(form.ivaAcconto, "IVA acconto"),
          totale: optionalNumber(form.totaleAcconto, "Totale acconto"),
        },
        storno: {
          mc: optionalNumber(form.mcStorno, "Consumo storno"),
          acquedotto: optionalNumber(form.acquedottoStorno, "Acquedotto storno"),
          dep_fog: optionalNumber(form.depFogStorno, "Depurazione e fognatura storno"),
          quota_fissa: optionalNumber(form.quotaFissaStorno, "Quota fissa storno"),
          oneri: optionalNumber(form.oneriStorno, "Oneri storno"),
          iva: optionalNumber(form.ivaStorno, "IVA storno"),
          totale: optionalNumber(form.totaleStorno, "Totale storno"),
        },
      };
      const parsedPayload = {
        ...currentPayload,
        numero_bolletta: form.numeroBolletta.trim() || null,
        codice_fornitura: form.codiceFornitura.trim() || null,
        punto_erogazione: form.puntoErogazione.trim() || null,
        fornitore_servizi: form.fornitoreServizi.trim() || null,
        bill_type: form.billType || "unknown",
        consumo_globale_mc: mainConsumption,
        importo_totale_da_pagare: optionalNumber(form.importoTotaleDaPagare, "Totale documento"),
        anagrafica: {
          ...(currentPayload?.anagrafica || {}),
          codice_cliente: form.codiceCliente.trim() || null,
          matricola_contatore: form.matricolaContatore.trim() || null,
          intestatario: form.intestatario.trim() || null,
          indirizzo_fornitura: form.indirizzoFornitura.trim() || null,
        },
        manual_overrides: manualOverrides,
      };
      const existingValidation = getParsedPayloadObject(selectedImportedDoc.validation_json) || {};
      const response = await api.put(
        `/fatture/imported-documents/${selectedImportedDoc.id}/parsed-result`,
        {
          providerId: form.providerId || null,
          numeroBolletta: form.numeroBolletta.trim() || null,
          codiceFornitura: form.codiceFornitura.trim() || null,
          codiceCliente: form.codiceCliente.trim() || null,
          puntoErogazione: form.puntoErogazione.trim() || null,
          matricolaContatore: form.matricolaContatore.trim() || null,
          intestatario: form.intestatario.trim() || null,
          indirizzoFornitura: form.indirizzoFornitura.trim() || null,
          fornitoreServizi: form.fornitoreServizi.trim() || null,
          billType: form.billType || "unknown",
          dataInizioPeriodo: form.dataInizioPeriodo || null,
          dataFinePeriodo: form.dataFinePeriodo || null,
          consumoGlobaleMc: mainConsumption,
          importoTotaleDaPagare: optionalNumber(form.importoTotaleDaPagare, "Totale documento"),
          parserVersion: selectedImportedDoc.parser_version || "manual-entry-v1",
          parserConfidence: 1,
          parseStatus: selectedImportedDoc.parse_status === "imported" ? "imported" : "reviewed",
          validationStatus: "valid",
          parsedPayload,
          validation: {
            ...existingValidation,
            manual_review: { edited_at: manualOverrides.edited_at, source: "fatturazione" },
          },
          parserErrorText: null,
        }
      );
      const rawDocument = response.data?.document;
      const savedDocument = (Array.isArray(rawDocument) ? rawDocument[0] : rawDocument) || selectedImportedDoc;
      setSelectedImportedDoc(savedDocument);
      setSelectedImportedId(savedDocument.id);
      setImportedDocs((previous) => previous.map((item) =>
        String(item.id) === String(savedDocument.id) ? { ...item, ...savedDocument } : item
      ));
      setSelectedDoc(savedDocument.importo_totale_da_pagare ?? null);
      assignStateFromParsedPayload(savedDocument.parsed_payload_json);
      setImportedDocEdit(buildImportedDocumentEditForm(savedDocument));
      setEditingImportedDoc(false);
      if (savedDocument.data_fine_periodo) {
        const year = new Date(savedDocument.data_fine_periodo).getFullYear();
        setImportedDocYear(year);
        setAnnoTariffa(String(year));
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Errore salvataggio dati manuali");
    } finally {
      setSavingImportedDoc(false);
    }
  }

    async function loadImportedDocumentDetail(id: string) {
      try {
        setLoadingImportedDetail(true);

        const res = await api.get(`/fatture/imported-documents/${id}`);

        const rawDocument = res.data?.document;
        const document = Array.isArray(rawDocument) ? rawDocument[0] || null : rawDocument || null;

        setSelectedImportedDoc(document);
        setSelectedImportedId(id);
        setEditingImportedDoc(false);
        setImportedDocEdit(document ? buildImportedDocumentEditForm(document) : null);

        if (!document) {
          setSelectedDoc(null);
          setAnnoTariffa("");
          setImportedDocYear(null);
          return;
        }

        const payload =
          typeof document.parsed_payload_json === "string"
            ? JSON.parse(document.parsed_payload_json)
            : document.parsed_payload_json;

        const year = document.data_fine_periodo
          ? new Date(document.data_fine_periodo).getFullYear()
          : new Date().getFullYear();

        setImportedDocYear(year);
        setAnnoTariffa(String(year));

        setSelectedDoc(document.importo_totale_da_pagare);

        assignStateFromParsedPayload(document.parsed_payload_json);

        console.log("Imported document detail loaded:", document);
        console.log("Parsed payload:", payload);
        return document;
      } catch (err: any) {
        setError(err?.response?.data?.error || "Errore caricamento documento importato");
        return null;
      } finally {
        setLoadingImportedDetail(false);
      }
    }

  async function loadImportedDocumentForSession(id: string) {
    const document = await loadImportedDocumentDetail(id);

    if (document?.id && fatturaId) {
      await ensureImportedDocumentLinkedToSession(document, String(fatturaId));
      await persistImportedDocumentParamsForSession(document, String(fatturaId));
      await refreshSessionsList();
      await loadDetail();
    }

    return document;
  }
  
  async function linkImportedToCurrentSession(importedId: string, sessionId: string) {
  
    try {
      await api.post(`/fatture/imported-documents/${importedId}/link-session`, {
        sessionId,
      });

      await loadImportedDocuments();
      await loadImportedDocumentDetail(importedId);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore collegamento documento-sessione");
    }
  }

  async function ensureImportedDocumentLinkedToSession(doc: ImportedInvoiceDocument | null, sessionId: string) {
    if (!doc?.id || !sessionId) return null;

    const res = await api.post(`/fatture/imported-documents/${doc.id}/link-session`, {
      sessionId,
    });

    const linkedDocument = Array.isArray(res.data?.document)
      ? res.data.document[0] || doc
      : res.data?.document || doc;

    setImportedDocs((prev) =>
      prev.map((item: any) => ({
        ...item,
        linked_session_id:
          String(item.id) === String(doc.id)
            ? sessionId
            : String(item.linked_session_id || "") === String(sessionId)
            ? null
            : item.linked_session_id,
      }))
    );
    setSelectedImportedDoc((prev: any) =>
      prev && String(prev.id) === String(doc.id)
        ? { ...prev, ...linkedDocument, linked_session_id: sessionId }
        : prev
    );
    setSessions((prev) =>
      prev.map((s: any) =>
        String(s.id) === String(sessionId)
          ? {
              ...s,
              linked_imported_document_id: doc.id,
              linked_imported_original_filename: linkedDocument?.original_filename || doc.original_filename,
              linked_imported_numero_bolletta: linkedDocument?.numero_bolletta || doc.numero_bolletta,
              linked_imported_data_inizio_periodo:
                linkedDocument?.data_inizio_periodo || doc.data_inizio_periodo,
              linked_imported_data_fine_periodo:
                linkedDocument?.data_fine_periodo || doc.data_fine_periodo,
              linked_imported_importo_totale_da_pagare:
                linkedDocument?.importo_totale_da_pagare || doc.importo_totale_da_pagare,
            }
          : s
      )
    );

    return linkedDocument;
  }

  async function persistImportedDocumentParamsForSession(
    doc: ImportedInvoiceDocument | null,
    sessionId: string
  ) {
    if (!doc?.parsed_payload_json || !sessionId) return;

    const parsedParams = getParsedCalculationParams(doc.parsed_payload_json);
    const parsedPayload = getParsedPayloadObject(doc.parsed_payload_json);
    const parsedStorno = getStornoValuesFromPayload(parsedPayload);
    const resolvedTfCode = normalizeTfCode(selectedTfCodeRef.current || tfCode || session?.tf_code);

    await api.put(`/fatture/sessioni/${sessionId}/parametri`, {
      giorniQF: parsedParams.giorniQF ?? 0,
      giorniConsumi: parsedParams.giorniConsumi ?? 0,
      giorniAcconto: parsedParams.giorniAcconto ?? 0,
      giorniCasa: resolveGiorniCasaInterniValue(),
      mcAcconto: parsedParams.mcAcconto ?? 0,
      mcStorno: parsedStorno.mc || Number(mcStorno || 0),
      varie: Number(varie || 0),
      tfCode: resolvedTfCode,
      manualConsumptions: getManualConsumptionPayload(),
    });
  }

  async function bootstrap() {
    if (!condominioId) return;
    setError(null);

    try {
      const [pRes, perRes, sRes, iRes] = await Promise.all([
        api.get("/fatture/providers"),
        api.get(`/fatture/periodi/${condominioId}`),
        api.get(`/fatture/condominio/${condominioId}`),  
        api.get(`/fatture/imported-documents/condominio/${condominioId}`),
      ]);

      setProviders(pRes.data || []);
      setPeriodi(perRes.data || []);
      setSessions(sRes.data || []);
      setImportedDocs(normalizeImportedDocuments(iRes.data?.items));
      loadImportedDocuments();

       
      console.log(sRes.data)
 

    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore caricamento dati");
    }
  }

  async function handleDelete(id: string) {
    const confirmDelete = window.confirm(
      "Sei sicuro di voler eliminare questa bozza?"
    );

    if (!confirmDelete) return;

    try {
      await api.delete(`/fatture/sessioni/${id}`);
      await bootstrap();

      if (fatturaId === id) {
        navigate(`/condomini/${condominioId}/fatture`);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore eliminazione");
    }
  }

  async function loadLegacyAcconti() {
    if (!fatturaId) {
      setLegacyAcconti([]);
      setLegacyDraft({});
      setLegacyPeriodoOrigine("");
      return;
    }

    setLoadingLegacy(true);
    try {
      const { data } = await api.get(`/fatture/sessioni/${fatturaId}/acconti-legacy`);
      const entries: LegacyAccontoEntry[] = Array.isArray(data?.entries) ? data.entries : [];
      const draft: Record<string, { euro: string; mc: string }> = {};
      entries.forEach((entry) => {
        draft[String(entry.idUtenza)] = {
          euro: Number(entry.importoEuro || 0).toFixed(2),
          mc: Number(entry.importoMc || 0) > 0 ? String(Number(entry.importoMc)) : "",
        };
      });
      setLegacyAcconti(entries);
      setLegacyDraft(draft);
      setLegacyPeriodoOrigine(data?.periodoOrigine || "");
      if (entries.length) setLegacyEditorOpen(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore caricamento saldi della piattaforma precedente");
    } finally {
      setLoadingLegacy(false);
    }
  }

  function updateLegacyDraft(idUtenza: string, field: "euro" | "mc", value: string) {
    setLegacyDraft((current) => ({
      ...current,
      [idUtenza]: {
        euro: current[idUtenza]?.euro || "",
        mc: current[idUtenza]?.mc || "",
        [field]: value,
      },
    }));
  }

  async function saveLegacyAccontiAndRecalculate() {
    if (!fatturaId) return;
    setSavingLegacy(true);
    setError(null);

    try {
      const entries = Object.entries(legacyDraft)
        .map(([idUtenza, values]) => ({
          idUtenza,
          importoEuro: Math.max(0, Number(values.euro) || 0),
          importoMc: Math.max(0, Number(values.mc) || 0),
        }))
        .filter((entry) => entry.importoEuro > 0 || entry.importoMc > 0);

      await api.put(`/fatture/sessioni/${fatturaId}/acconti-legacy`, {
        periodoOrigine: legacyPeriodoOrigine,
        entries,
      });
      await calcola();
      await loadLegacyAcconti();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Errore salvataggio saldi iniziali");
    } finally {
      setSavingLegacy(false);
    }
  }

  useEffect(() => {
    loadLegacyAcconti();
  }, [fatturaId]);

  async function loadDetail() {
    if (!condominioId || !fatturaId) {
      setDetail(null);
      setCurrentSession(null);
      setGenerale(null);
      setRigheCalcoli([]);
      setDettaglioByUtenza({});
      setCalculationNotice(null);
      return;
      }
      setError(null);
      setCalculationNotice(null);
      setLoadingDetail(true);
    try {
      //   backend has /condomini/:condominioId/fatture/:id
      const res = await api.get(`/fatture/condomini/${condominioId}/fatture/${fatturaId}`);

      setDetail(res.data);
      setCalculationNotice(res.data?.calculationWarnings?.[0]?.message || null);
      setCurrentSession(res.data?.session || null);
      setRigheCalcoli(res.data?.righe || res.data?.grid || []);
      const linkedDocumentId =
        res.data?.linkedImportedDocument?.id || res.data?.session?.imported_document_id;
      if (linkedDocumentId) {
        await loadImportedDocumentDetail(String(linkedDocumentId));
      }
       
    } catch (err: any) {
      setDetail(null);
      setCurrentSession(null);
      setRigheCalcoli([]);
      setGenerale(null);
      setDettaglioByUtenza({});
      setError(err?.response?.data?.error || "Errore caricamento fattura");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function refreshSessionsList() {
    if (!condominioId) return;

    const sessionsRes = await api.get(`/fatture/condominio/${condominioId}`);
    setSessions(Array.isArray(sessionsRes.data) ? sessionsRes.data : []);

    if (fatturaId) {
      const detailRes = await api.get(`/fatture/condomini/${condominioId}/fatture/${fatturaId}`);
      setDetail(detailRes.data);
      setCurrentSession(detailRes.data?.session || null);
      setRigheCalcoli(detailRes.data?.righe || detailRes.data?.grid || []);
      const linkedDocumentId =
        detailRes.data?.linkedImportedDocument?.id || detailRes.data?.session?.imported_document_id;
      if (linkedDocumentId) {
        await loadImportedDocumentDetail(String(linkedDocumentId));
      }
    }
  }

  function handleSelectSession(s: any) {
    autoCalculatedSessionRef.current = null;
    applyTfCode(s.tf_code || s.tf || selectedTfCodeRef.current);
    const linkedDoc = getSessionLinkedImportedDocument(s);
    if (linkedDoc?.id) {
      setSelectedImportedDoc(linkedDoc);
      setSelectedImportedId(String(linkedDoc.id));
    }
    setPendingAutoCalculateSessionId(String(s.id));
    navigate(`/condomini/${condominioId}/fatture/${s.id}`);
  }

  async function handleCreateFattura() {

    
    try {
      setError(null);
      setCalculationNotice(null);

      if (!condominioId) {
        setError("Condominio non valido.");
        return;
      }

      if (!canCreate) {
        setError("La fattura non può essere creata con i dati attuali.");
        return;
      }

      if (!fatturaDate) {
        setError("Seleziona una data per la fattura.");
        return;
      }

      setLoadingCreate(true);
      setCreatingFattura(true);

      await api.post(`/financial-summary/imported-documents/01/promotef`, {
        condominioId,
        proformaIds: [],
        fatturaDate,
        totaleOneri,
        current, 
        previous, 
      });

      setIsCreateFatturaModalOpen(false);

      // opzionale: reset data dopo successo
      // setFatturaDate(new Date().toISOString().slice(0, 10));
 
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Errore creazione");
    } finally {
      setLoadingCreate(false);
      setCreatingFattura(false);
    }
  }
  async function createSession() {
   
    if (!condominioId || !canCreate) return;

    setLoadingCreate(true);
    setError(null);
    try {
      const res = await api.post("/fatture/sessioni", {
        idCondominio: condominioId,
        idCasaIdrica: providerId,
        idPeriodoAttuale: current,
        idPeriodoPrecedente: previous,
        giorniQF: 0,
        giorniConsumi: 0,
        giorniAcconto: 0,
        varie: 0,
      });

      const newId = res?.data?.session?.id;
    
      if (!newId) throw new Error("Creazione fattura riuscita ma manca session.id");

      //await refreshSessionsList();
      await bootstrap();
      navigate(`/condomini/${condominioId}/fatture/${newId}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Errore creazione");
    } finally {
      setLoadingCreate(false);
    }
  }

  async function onStampaProspetto(fatturaId: string) {
    // Open in new tab
    const params = new URLSearchParams();
    const token = getAuthToken();
    if (token) {
      params.set("authToken", token);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const url = `/fatture/${fatturaId}/prospetto.pdf${suffix}`;
    window.open(api.defaults.baseURL + url, "_blank");
    window.setTimeout(() => {
      loadGeneratedDocuments().catch(() => undefined);
    }, 2500);
  }


  function daysBetween(d1?: string, d2?: string) {
  if (!d1 || !d2) return 0;

  const date1 = new Date(d1 + "T12:00:00");
  const date2 = new Date(d2 + "T12:00:00");

  const diff = date2.getTime() - date1.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

 

    function normalizeOptionalReading(value: number | string, label: string): number | null {
      if (value === "" || value === null || value === undefined) return null;

      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${label} non valida`);
      }

      return parsed;
    }

    async function calcola(options: {
      sessionIdOverride?: string;
      tfCodeOverride?: string;
      skipSave?: boolean;
      auto?: boolean;
    } = {}) {
       
      const targetSessionId = options.sessionIdOverride || fatturaId;
      if (!targetSessionId) return;

      setLoadingCalc(true);
      if (options.auto) {
        setAutoCalculatingSessionId(targetSessionId);
      }
      setError(null);
      setCalculationNotice(null);

      try {
        let calculationDocument: any =
          resolveSelectedImportedDocumentForSession(targetSessionId);

        if (!calculationDocument?.id && importedDocs.length > 0) {
          throw new Error("Seleziona o collega il documento TXT da usare per questa sessione prima del calcolo.");
        }

        if (calculationDocument?.id && !calculationDocument?.parsed_payload_json) {
          const docRes = await api.get(`/fatture/imported-documents/${calculationDocument.id}`);
          const rawDocument = docRes.data?.document;
          calculationDocument = Array.isArray(rawDocument)
            ? rawDocument[0] || calculationDocument
            : rawDocument || calculationDocument;
          setSelectedImportedDoc(calculationDocument);
          setSelectedImportedId(calculationDocument.id);
        }

        if (calculationDocument?.id) {
          calculationDocument =
            (await ensureImportedDocumentLinkedToSession(calculationDocument, targetSessionId)) ||
            calculationDocument;
        }

        const parsedPayloadForCalc = calculationDocument?.parsed_payload_json;
        if (calculationDocument?.id && !parsedPayloadForCalc) {
          throw new Error("Documento collegato senza payload parsed. Ricarica o riparsa il TXT prima del calcolo.");
        }
        if (parsedPayloadForCalc) {
          assignStateFromParsedPayload(parsedPayloadForCalc);
        }
        const parsedPayloadObject = getParsedPayloadObject(parsedPayloadForCalc);
        const parsedSummaryForCalc = parsedPayloadObject
          ? summarizePeriodiAndTariffe(parsedPayloadObject || null)
          : undefined;
        const parsedBucketsForCalc = parsedPayloadObject
          ? getParsedBuckets(parsedPayloadObject, parsedSummaryForCalc)
          : null;
        const parsedStornoForCalc = getStornoValuesForCalculation(parsedPayloadObject);
        const parsedDocumentTotalForCalc = Number(
          calculationDocument?.importo_totale_da_pagare ??
            totaleDocumento ??
            0
        );
        const parsedMainBucketForCalc =
          parsedBucketsForCalc?.aGiro?.hasPeriod
            ? parsedBucketsForCalc.aGiro
            : parsedBucketsForCalc?.acconto?.hasPeriod
            ? parsedBucketsForCalc.acconto
            : null;
        const parsedFornituraAGiroForCalc = parsedPayloadObject
          ? getFornituraSummaryByType(parsedPayloadObject, "a_giro")
          : null;
        const parsedTotaleLetturaAGiroForCalc =
          Number(parsedFornituraAGiroForCalc?.totale_fornitura || 0) ||
          Number(parsedDocumentTotalForCalc || 0) - Number(totaleAcconto || 0);
        const parsedQuotaFissaForCalc = parsedPayloadObject
          ? getParsedQuotaFissaFromPayload(parsedPayloadObject)
          : 0;
        const manualQfSectionsForCalc = [
          manualNumber(parsedPayloadObject?.manual_overrides?.main?.quota_fissa),
          manualNumber(parsedPayloadObject?.manual_overrides?.acconto?.quota_fissa),
          manualNumber(parsedPayloadObject?.manual_overrides?.storno?.quota_fissa),
        ];
        const isAsisDocumentForCalc = isAsisBillingDocument(
          calculationDocument,
          findSessionById(targetSessionId)
        );
        const useParsedQuotaFissaForCalc =
          isAsisDocumentForCalc ||
          manualQfSectionsForCalc.some((value) => value !== null);
        const parsedOneriNormaleForCalc =
          parsedMainBucketForCalc?.oneri ?? Number(oneriPerequazione || 0);
        const parsedParamsForCalc = getParsedCalculationParams(parsedPayloadForCalc);
        const manualTfForSession =
          manualTfOverrideRef.current.sessionId === targetSessionId
            ? manualTfOverrideRef.current.tfCode
            : null;
        const selectedTfCode = normalizeTfCode(
          manualTfForSession ||
            options.tfCodeOverride ||
            selectedTfCodeRef.current ||
            tfCode ||
            session?.tf_code
        );

        if (!options.skipSave) {
          await saveGenerale({ reload: false });
          await saveParams({
            sessionIdOverride: targetSessionId,
            giorniQF: parsedParamsForCalc.giorniQF,
            giorniConsumi: parsedParamsForCalc.giorniConsumi,
            giorniAcconto: parsedParamsForCalc.giorniAcconto,
            mcAcconto: parsedParamsForCalc.mcAcconto,
            giorniCasa: resolveGiorniCasaInterniValue(),
            tfCode: selectedTfCode,
            manualConsumptions: getManualConsumptionPayload(),
          });
        }

        const parsedHasOneri = hasOneriPerequazioneRows(
          parsedPayloadForCalc
        );
        const parsedAccontoForCalc = getAccontoValuesFromParsedPayload(
          parsedPayloadForCalc
        );
        const calcMcAcconto = parsedAccontoForCalc?.mc ?? Number(mcAcconto || 0);
        const hasParsedAccontoForCalc = Boolean(
          parsedAccontoForCalc &&
          (
            Number(calcMcAcconto || 0) !== 0 ||
            Number(parsedAccontoForCalc.totale || 0) !== 0 ||
            Number(parsedAccontoForCalc.quotaFissa || 0) !== 0 ||
            Number(parsedAccontoForCalc.iva || 0) !== 0
          )
        );
  
        const res = await api.post(`/fatture/sessioni/${targetSessionId}/calcola`, {
          tfCode: selectedTfCode,
          annoTariffa: Number(annoTariffa) || null,
          eurStorno: parsedPayloadObject
            ? parsedStornoForCalc.euro
            : eurStorno
            ? Number(eurStorno)
            : null,
          parsedQF: useParsedQuotaFissaForCalc ? parsedQuotaFissaForCalc : null,
          parsedAccontoImporto: hasParsedAccontoForCalc
            ? Number(parsedAccontoForCalc?.acquedotto ?? eurAcconto ?? 0)
            : null,
          parsedAccontoDepFog: hasParsedAccontoForCalc
            ? Number(parsedAccontoForCalc?.depFog ?? depfogAcconto ?? 0)
            : null,
          parsedAccontoTotale: hasParsedAccontoForCalc
            ? Number(parsedAccontoForCalc?.totale ?? totaleAcconto ?? 0)
            : null,
          parsedOneriPerequazione: parsedHasOneri ? Number(parsedOneriNormaleForCalc || 0) : null,
          parsedOneriPerequazioneAcconto: parsedHasOneri
            ? Number(parsedAccontoForCalc?.oneri ?? oneriPerequazioneAcconto ?? 0)
            : null,
          // The backend adds condominium-configured oneri separately.
          // This value must remain the untouched ABC document total.
          totaleParsedWithOneri: parsedDocumentTotalForCalc,
          importedDocumentId: calculationDocument?.id || null,
          calculationContext: {
            importedDocumentId: calculationDocument?.id || null,
            importedDocumentName: calculationDocument ? getImportedDocumentName(calculationDocument) : null,
            tfCode: selectedTfCode,
            annoTariffa: Number(annoTariffa) || null,
            giorniQF: parsedParamsForCalc.giorniQF ?? null,
            giorniConsumi: parsedParamsForCalc.giorniConsumi ?? null,
            giorniAcconto: parsedParamsForCalc.giorniAcconto ?? null,
            giorniInterni: resolveGiorniCasaInterniValue(),
            mcAcconto: parsedParamsForCalc.mcAcconto ?? null,
            mcStorno: parsedPayloadObject
              ? parsedStornoForCalc.mc
              : Number(mcStorno || 0),
            eurStorno: parsedPayloadObject
              ? parsedStornoForCalc.euro
              : Number(eurStorno || 0),
            parsedStornoAcquedotto: parsedStornoForCalc.acquedotto ?? Number(acquedottoStorno || 0),
            parsedStornoDepFog: parsedStornoForCalc.depFog ?? Number(depfogStorno || 0),
            parsedStornoQuotaFissa: parsedStornoForCalc.quotaFissa ?? 0,
            parsedStornoIva: parsedStornoForCalc.iva ?? Number(ivaStorno || 0),
            parsedOneriPerequazioneStorno:
              parsedStornoForCalc.oneri ?? Number(oneriPerequazioneStorno || 0),
            parsedStornoTotale: parsedStornoForCalc.totale ?? Number(totaleStorno || eurStorno || 0),
            stornoBreakdown: {
              mc: parsedPayloadObject
                ? parsedStornoForCalc.mc
                : Number(mcStorno || 0),
              acquedotto: parsedStornoForCalc.acquedotto ?? Number(acquedottoStorno || 0),
              depurazione: parsedStornoForCalc.depurazione ?? 0,
              fognatura: parsedStornoForCalc.fognatura ?? 0,
              depFog: parsedStornoForCalc.depFog ?? Number(depfogStorno || 0),
              quotaFissa: parsedStornoForCalc.quotaFissa ?? 0,
              iva: parsedStornoForCalc.iva ?? Number(ivaStorno || 0),
              oneri: parsedStornoForCalc.oneri ?? Number(oneriPerequazioneStorno || 0),
              totale: parsedStornoForCalc.totale ?? Number(totaleStorno || eurStorno || 0),
              source: parsedStornoForCalc.source || "request",
            },
            parsedConsumoNormale: parsedMainBucketForCalc?.consumoMc ?? null,
            parsedAcquedottoNormale: parsedMainBucketForCalc?.acquedotto ?? null,
            parsedDepFogNormale: parsedMainBucketForCalc?.depFog ?? null,
            parsedQuotaFissa: useParsedQuotaFissaForCalc ? parsedQuotaFissaForCalc : null,
            parsedIvaNormale:
              manualNumber(parsedPayloadObject?.manual_overrides?.main?.iva) ??
              (isAsisDocumentForCalc ? 0 : null),
            parsedVarie: Number(varie || 0),
            parsedTotaleLetturaAGiro: Number.isFinite(parsedTotaleLetturaAGiroForCalc)
              ? parsedTotaleLetturaAGiroForCalc
              : null,
            parsedAccontoImporto: parsedAccontoForCalc?.acquedotto ?? null,
            parsedAccontoDepFog: parsedAccontoForCalc?.depFog ?? null,
            parsedAccontoQuotaFissa: parsedAccontoForCalc?.quotaFissa ?? null,
            parsedAccontoIva: parsedAccontoForCalc?.iva ?? null,
            parsedAccontoTotale: parsedAccontoForCalc?.totale ?? null,
            parsedOneriPerequazione: parsedHasOneri ? Number(parsedOneriNormaleForCalc || 0) : null,
            parsedOneriPerequazioneAcconto: parsedHasOneri
              ? Number(parsedAccontoForCalc?.oneri ?? oneriPerequazioneAcconto ?? 0)
              : null,
            totaleDocumento: parsedDocumentTotalForCalc,
          }
        }); 
        // console.log("Calcolo response:", res.data);
        //await loadDetail();
        await refreshSessionsList();
        setCurrentSession(res.data.session);
        applyTfCode(selectedTfCode);
        if (manualTfOverrideRef.current.sessionId === targetSessionId) {
          manualTfOverrideRef.current = { sessionId: null, tfCode: null };
        }
        setSessions((prev) =>
          prev.map((s: any) =>
            String(s.id) === String(targetSessionId)
              ? {
                  ...s,
                  ...(res.data.session || {}),
                  tf_code: selectedTfCode,
                  grand_total: res.data.session?.grand_total ?? s.grand_total,
                }
              : s
          )
        );
        loadedTfSessionRef.current = String(res.data?.session?.id || targetSessionId || "");
        setRigheCalcoli(res.data.righe || []);
        setGenerale(res.data.generale || null);
        setDetail((prev: any) => ({
          ...(prev || {}),
          ...res.data,
          righe: res.data.righe || [],
          session: res.data.session || prev?.session || null,
        }));
        setCalculationNotice(res.data?.calculationWarnings?.[0]?.message || null);

        const newDettaglio: Record<string, any[]> = {};

        for (const group of res.data.generale?.dettaglio ?? []) {
          if (!Array.isArray(group) || group.length === 0) continue;

          console.log(group)

          for (const item of group) {
            const key = String(item?.key ?? "").trim();
            if (!key) continue;

            if (!newDettaglio[key]) {
              newDettaglio[key] = []; 
            }

            newDettaglio[key].push(item);
          }
        }

        for (const key of Object.keys(newDettaglio)) {
          newDettaglio[key] = newDettaglio[key]
            .filter((item) => String(item?.key ?? "").trim() === key)
            .sort((a, b) => Number(a?.ordine ?? 0) - Number(b?.ordine ?? 0));
        }

        setDettaglioByUtenza(newDettaglio);
               

      } catch (err: any) {
        const responseData = err?.response?.data;
        const checks = responseData?.accountingChecks;
        const checkDetails = checks
          ? [
              Math.abs(Number(checks.txtStornoConservationResidual || 0)) > 0.01
                ? `storno TXT non riconciliato EUR ${Number(
                    checks.txtStornoConservationResidual || 0
                  ).toFixed(2)}`
                : null,
              Math.abs(Number(checks.creditOveruseResidual || 0)) > 0.01
                ? `credito applicato oltre il residuo disponibile EUR ${Number(
                    checks.creditOveruseResidual || 0
                  ).toFixed(2)}`
                : null,
              Array.isArray(checks.rowFormulaErrors) && checks.rowFormulaErrors.length
                ? `${checks.rowFormulaErrors.length} righe con totale incoerente`
                : null,
              Array.isArray(checks.minimumErrors) && checks.minimumErrors.length
                ? `${checks.minimumErrors.length} righe sotto il minimo`
                : null,
            ]
              .filter(Boolean)
              .join("; ")
          : "";
        const baseMessage =
          responseData?.error ||
          "Errore calcolo: " + (err?.message || "Errore sconosciuto");
        const dependencyDetails =
          responseData?.code === "LATER_BILLING_PERIOD_DEPENDENCY" &&
          Array.isArray(responseData?.dependencies)
            ? responseData.dependencies
                .map((period: any) => `${period.mese}/${period.anno} (${period.stato})`)
                .join(", ")
            : "";
        const fullMessage = dependencyDetails
          ? `${baseMessage} Periodi successivi: ${dependencyDetails}.`
          : baseMessage;
        setError(checkDetails ? `${fullMessage} Dettagli: ${checkDetails}.` : fullMessage);
      } finally {
        setLoadingCalc(false);
        if (options.auto) {
          setAutoCalculatingSessionId(null);
        }
      }
    }


  async function saveGenerale(options: { reload?: boolean } = {}) {
  if (!fatturaId) return;

  try {
    setSavingGenerale(true);

    const precedente = normalizeOptionalReading(valPrec, "Lettura precedente");
    const attuale = normalizeOptionalReading(valAtt, "Lettura attuale");

    if (precedente === null && attuale === null) {
      return;
    }

    if (precedente !== null && attuale !== null && attuale < precedente) {
      throw new Error("La lettura attuale non puo essere inferiore alla precedente");
    }

    await api.put(`/fatture/sessioni/${fatturaId}/contatore-generale`, {
      precedente,
      attuale,
    });

    if (options.reload !== false) {
      await loadDetail();
    }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Errore salvataggio");
      throw err;
    } finally {
      setSavingGenerale(false);
    }
  }
  async function saveParams(options: {
    sessionIdOverride?: string;
    giorniQF?: number | null;
    giorniConsumi?: number | null;
    giorniAcconto?: number | null;
    giorniCasa?: number | null;
    mcAcconto?: number | null;
    tfCode?: string;
    manualConsumptions?: Record<string, number>;
  } = {}) {
    const targetSessionId = options.sessionIdOverride || fatturaId;
    if (!targetSessionId) return;

    try {
      setSavingParams(true);

      const resolvedGiorniCasa = options.giorniCasa ?? resolveGiorniCasaInterniValue();
      const resolvedGiorniQF = options.giorniQF ?? positiveNumberOrNull(giorniQf) ?? positiveNumberOrNull(session?.giorni_qf) ?? 0;
      const resolvedGiorniConsumi = options.giorniConsumi ?? positiveNumberOrNull(giorniConsumi) ?? positiveNumberOrNull(session?.giorni_consumi) ?? 0;
      const resolvedGiorniAcconto = options.giorniAcconto ?? positiveNumberOrNull(giorniAcconto) ?? positiveNumberOrNull(session?.giorni_acconto) ?? 0;
      const resolvedMcAcconto = options.mcAcconto ?? positiveNumberOrNull(mcAcconto) ?? positiveNumberOrNull(session?.mcAcconto) ?? 0;
      const resolvedTfCode = normalizeTfCode(options.tfCode || selectedTfCodeRef.current || tfCode);

      console.log("Saving params:", { giorniQf: resolvedGiorniQF, giorniConsumi: resolvedGiorniConsumi, giorniAcconto: resolvedGiorniAcconto, varie, giorniCasaInterni: resolvedGiorniCasa, mcAcconto: resolvedMcAcconto, mcStorno });
      await api.put(`/fatture/sessioni/${targetSessionId}/parametri`, {
        giorniQF: resolvedGiorniQF,
        giorniConsumi: resolvedGiorniConsumi,
        giorniAcconto: resolvedGiorniAcconto,
        varie: Number(varie),
        giorniCasa: resolvedGiorniCasa,
        mcAcconto: resolvedMcAcconto,
        mcStorno: Number(mcStorno)==0 ? 0 : Number(mcStorno),
        tfCode: resolvedTfCode,
        manualConsumptions: options.manualConsumptions ?? getManualConsumptionPayload(),
        totImpo:Number(session?.tot_acquedotto ?? 0)
      });


      //await loadDetail();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore salvataggio");
      throw err;
    } finally {
      setSavingParams(false);
    }
  } 
 
  useEffect(() => {
    bootstrap();
  }, [condominioId]);

  useEffect(() => {
    loadDetail();
  }, [condominioId, fatturaId]);

  useEffect(() => {
    if (contatoreGenerale) {
      setValPrec(contatoreGenerale.precedente ?? "");
      setValAtt(contatoreGenerale.attuale ?? "");
    }
  }, [contatoreGenerale]);


  useEffect(() => {
    
    if (!session) return;

    if (loadedTfSessionRef.current !== String(session.id || "")) {
      applyTfCode(session.tf_code || session.tf);
      loadedTfSessionRef.current = String(session.id || "");
    }
    const linkedDoc = getLinkedImportedDocument(session.id);
    const parsedParams =
      linkedDoc?.parsed_payload_json
        ? getParsedCalculationParams(linkedDoc.parsed_payload_json)
        : {};

    setGiorniQf(parsedParams.giorniQF ?? session.giorni_qf ?? 0);
    setGiorniConsumi(parsedParams.giorniConsumi ?? session.giorni_consumi ?? 0);
    setGiorniAcconto(parsedParams.giorniAcconto ?? Number(session.giorni_acconto) ?? 0);
    setMcAcconto(parsedParams.mcAcconto ?? Number(session.mcAcconto) ?? 0);
    setGiorniCasaInterni(
      positiveNumberOrNull(session.giorni_interni) ??
        resolveGiorniInterniFromPeriods(periodoPrecedente, periodoAttuale) ??
        0
    );
    setManualConsumptions(parseManualConsumptions(session.manual_consumptions_json));

    setVarie(session.varie ?? 0);
   

  }, [session, selectedImportedDoc?.id, selectedImportedDoc?.parsed_payload_json, importedDocs]);

  useEffect(() => {
    if (!fatturaId) return;

    const linkedDoc = getLinkedImportedDocument(fatturaId);

    if (!linkedDoc?.id) {
      return;
    }

    if (
      String(selectedImportedId || "") === String(linkedDoc.id) &&
      selectedImportedDoc?.parsed_payload_json
    ) {
      return;
    }

    loadImportedDocumentDetail(String(linkedDoc.id)).catch(() => undefined);
  }, [
    fatturaId,
    importedDocs,
    sessions,
    detail?.linkedImportedDocument?.id,
    session?.imported_document_id,
    selectedImportedId,
    selectedImportedDoc?.parsed_payload_json,
  ]);

  useEffect(() => {
    if (!pendingAutoCalculateSessionId || !fatturaId) return;
    if (String(pendingAutoCalculateSessionId) !== String(fatturaId)) return;
    if (loadingDetail || loadingImportedDetail || loadingCalc) return;
    if (!session?.id || String(session.id) !== String(pendingAutoCalculateSessionId)) return;

    const linkedDoc = getLinkedImportedDocument(pendingAutoCalculateSessionId);
    if (linkedDoc && String(selectedImportedDoc?.id || "") !== String(linkedDoc.id)) {
      return;
    }

    const targetTf = normalizeTfCode(session?.tf_code || session?.tf || selectedTfCodeRef.current);
    const autoKey = `${pendingAutoCalculateSessionId}:${targetTf}:${linkedDoc?.id || "no-doc"}`;

    if (autoCalculatedSessionRef.current === autoKey) return;

    autoCalculatedSessionRef.current = autoKey;
    setPendingAutoCalculateSessionId(null);

    calcola({
      sessionIdOverride: pendingAutoCalculateSessionId,
      tfCodeOverride: targetTf,
      skipSave: false,
      auto: true,
    }).catch(() => undefined);
  }, [
    pendingAutoCalculateSessionId,
    fatturaId,
    loadingDetail,
    loadingImportedDetail,
    loadingCalc,
    selectedImportedDoc?.id,
    importedDocs,
    sessions,
    session?.id,
    session?.tf_code,
    session?.tf,
  ]);

  useEffect(() => {
    const giorniInterniDaPeriodi = resolveGiorniInterniFromPeriods(
      periodoPrecedente,
      periodoAttuale
    );

    if (giorniInterniDaPeriodi !== null) {
      setGiorniCasaInterni(giorniInterniDaPeriodi);
    }
  }, [
    periodoPrecedente?.id,
    periodoPrecedente?.dataCasaIdrica,
    periodoPrecedente?.data_lettura_casa_idrica,
    periodoPrecedente?.dataOperatore,
    periodoPrecedente?.data_lettura_operatore,
    periodoAttuale?.id,
    periodoAttuale?.dataCasaIdrica,
    periodoAttuale?.data_lettura_casa_idrica,
    periodoAttuale?.dataOperatore,
    periodoAttuale?.data_lettura_operatore,
  ]);
 
  useEffect(() => {
  if (!session) return;

  setProviderId(session.id_casa_idrica || "");
  setCurrent(session.id_periodo_attuale || "");
  setPrevious(session.id_periodo_precedente || "");
  
    

}, [session]);

  useEffect(() => {
    let cancelled = false;

    async function loadActiveTariffPreview() {
      const year = Number(annoTariffa || importedDocYear || periodoAttuale?.period_year || 0);

      if (!providerId || !year) {
        setActiveTariffPreview(null);
        return;
      }

      try {
        setLoadingTariffPreview(true);
        const versionsResult = await listVersions(providerId);
        const versions = versionsResult.versions || [];
        const version =
          versions.find((item: any) => Number(item.anno) === year) ||
          versions.find((item: any) => {
            const from = item.valid_from ? new Date(`${item.valid_from}T00:00:00`) : null;
            const to = item.valid_to ? new Date(`${item.valid_to}T00:00:00`) : null;
            const probe = new Date(`${year}-07-01T00:00:00`);
            return from && probe >= from && (!to || probe <= to);
          }) ||
          null;

        if (!version) {
          if (!cancelled) setActiveTariffPreview(null);
          return;
        }

        const full = await getVersionFull(version.id);
        const categories = full.categories || [];
        const category =
          categories.find((cat: any) => String(cat.codice || "").toUpperCase() === "RESIDENTE") ||
          categories[0] ||
          null;

        if (!cancelled) {
          setActiveTariffPreview({
            version: full.version,
            category,
          });
        }
      } catch (err) {
        if (!cancelled) setActiveTariffPreview(null);
      } finally {
        if (!cancelled) setLoadingTariffPreview(false);
      }
    }

    loadActiveTariffPreview();

    return () => {
      cancelled = true;
    };
  }, [providerId, annoTariffa, importedDocYear, periodoAttuale?.period_year]);


 
const ripartizionePollRef = useRef<number | null>(null); 
const ripartizionePollGenerationRef = useRef(0);
const pollRipartizioneJob = (jobId: number) => {
  const pollGeneration = ++ripartizionePollGenerationRef.current;
  if (ripartizionePollRef.current) {
    window.clearTimeout(ripartizionePollRef.current);
  }
  let consecutivePollErrors = 0;

  const poll = async () => {
    try {
      const { data } = await api.get(
        `/fatture/export-ripartizione-pdf/jobs/${jobId}`
      );
      if (pollGeneration !== ripartizionePollGenerationRef.current) return;
      consecutivePollErrors = 0;

      setExportJob(data);

      const total = Number(data.total || 0);
      const processed = Number(data.processed || 0);
      const failed = Number(data.failed || 0);

      if (data.status === "pending") {
        setExportMessage("Preparazione generazione PDF...");
      }

      if (data.status === "processing") {
        setExportMessage(
          total > 0 && processed >= total
            ? "Finalizzazione e salvataggio PDF..."
            : `Generazione PDF: ${processed}/${total}`
        );
      }

      if (data.status === "done") {
        ripartizionePollRef.current = null;
        setExportingRipartizioni(false);
        setExportMessage(
          failed > 0
            ? `Generazione completata con ${failed} errori.`
            : "Bollette generate e salvate correttamente."
        );

        await Promise.allSettled([
          Promise.resolve(loadRipartizionePdfs?.()),
          Promise.resolve(loadGeneratedDocuments?.()),
        ]);
        return;
      }

      if (data.status === "error") {
        ripartizionePollRef.current = null;
        setExportingRipartizioni(false);
        setExportMessage(
          data.error_message || "Errore durante la generazione PDF."
        );
        return;
      }

      ripartizionePollRef.current = window.setTimeout(poll, 1000);
    } catch (error: any) {
      if (pollGeneration !== ripartizionePollGenerationRef.current) return;
      consecutivePollErrors += 1;

      if (consecutivePollErrors < 3) {
        setExportMessage("Connessione temporaneamente instabile, nuovo tentativo...");
        ripartizionePollRef.current = window.setTimeout(poll, 1500);
        return;
      }

      ripartizionePollRef.current = null;
      setExportingRipartizioni(false);
      setExportMessage(
        error?.response?.data?.error ||
          error?.message ||
          "Errore durante il controllo dello stato del job."
      );
    }
  };

  void poll();
};

useEffect(() => {
  return () => {
    ripartizionePollGenerationRef.current += 1;
    if (ripartizionePollRef.current) {
      window.clearTimeout(ripartizionePollRef.current);
    }
  };
}, []);

const configuredApiBaseUrl = String(api.defaults.baseURL || "");
const apiBaseUrl = configuredApiBaseUrl.startsWith("http")
  ? configuredApiBaseUrl.replace(/\/api\/?$/, "")
  : "";
const logoUrl = apiBaseUrl ? `${apiBaseUrl}/images/logo_colorato.png` : "";
const ripartizionePeriodLabel = buildRipartizionePeriodLabel(periodoPrecedente, periodoAttuale);
const ripartizioneDataLettura = buildRipartizioneDataLettura(periodoAttuale);

const handleExportPdf = async () => {
  try {
    setExportingRipartizioni(true);
    setExportMessage("Avvio generazione PDF...");
    setExportJob(null);

    const { data } = await api.post("/fatture/export-ripartizione-pdf/start", {
      righe,
      dettaglioByUtenza,
      trimestreLabel: ripartizionePeriodLabel,
      dataLettura: ripartizioneDataLettura,
      logoUrl: logoUrl || undefined,
      condominioId,
      fatturaId,
    });

    if (!data.jobId) {
      throw new Error("Job ID non ricevuto dal server.");
    }

    setExportJob({
      id: data.jobId,
      status: data.status || "pending",
      total: Number(data.total || 0),
      processed: 0,
      saved: 0,
      failed: 0,
    });
    setExportMessage("Generazione PDF in corso...");
    pollRipartizioneJob(data.jobId);
  } catch (error: any) {
    console.error("Errore avvio export PDF:", error);
    setExportingRipartizioni(false);
    setExportMessage(
      error?.response?.data?.error ||
        error?.message ||
        "Errore durante l'avvio della generazione PDF."
    );
  }
};

const pages = chunkArray(righe, 2);
const dettaglio = generale?.dettaglio ?? [];

const activeImportedDocument = fatturaId
  ? resolveSelectedImportedDocumentForSession(String(fatturaId))
  : selectedImportedDoc;
const activeBillingProviderCode = getBillingProviderCode(activeImportedDocument, session);

const selectedParsedPayload = useMemo(() => {
  if (!activeImportedDocument?.parsed_payload_json) return null;

  try {
    return typeof activeImportedDocument.parsed_payload_json === "string"
      ? JSON.parse(activeImportedDocument.parsed_payload_json)
      : activeImportedDocument.parsed_payload_json;
  } catch (err) {
    return null;
  }
}, [activeImportedDocument?.parsed_payload_json]);

 
const consumo = Number(valAtt || 0) - Number(valPrec || 0);
const impConsumo = Number(parsedImpCons ?? 0);
const depFogValue = Number(depfog ?? 0);
const parsedQuotaFissaFromPayload = getParsedQuotaFissaFromPayload(selectedParsedPayload);
const quotaFissaSession = Number(session?.tot_qf ?? 0);
const quotaFissa = quotaFissaSession > 0 ? quotaFissaSession : parsedQuotaFissaFromPayload;
const quotaFissaAccontoValue = Number(
  selectedParsedPayload?.manual_overrides?.acconto?.quota_fissa ?? 0
);
const quotaFissaStornoValue = Number(
  selectedParsedPayload?.manual_overrides?.storno?.quota_fissa ?? 0
);
const oneriAGiro = Number(oneriPerequazione || 0);
const fornituraAGiro = getFornituraSummaryByType(selectedParsedPayload, "a_giro");
const totaleFornituraAGiroDaTxt = Number(fornituraAGiro?.totale_fornitura || 0);
const totaleFornituraAGiroDaDifferenza =
  Number(activeImportedDocument?.importo_totale_da_pagare || 0) > 0 &&
  Number(totaleAcconto || 0) > 0
    ? Math.round(
        (Number(activeImportedDocument?.importo_totale_da_pagare || 0) -
          Number(totaleAcconto || 0) +
          Number.EPSILON) *
          100
      ) / 100
    : 0;
const totaleFornituraAGiro =
  totaleFornituraAGiroDaTxt > 0
    ? totaleFornituraAGiroDaTxt
    : totaleFornituraAGiroDaDifferenza > 0
    ? totaleFornituraAGiroDaDifferenza
    : 0;
const ivaBase = impConsumo + depFogValue + quotaFissa + oneriAGiro;
const manualIvaAGiro = manualNumber(selectedParsedPayload?.manual_overrides?.main?.iva);
const ivaAGiro = manualIvaAGiro ?? (
  isAsisBillingDocument(activeImportedDocument, session)
    ? 0
    : Math.round((ivaBase * 0.1 + Number.EPSILON) * 100) / 100
);
const varieValue = Number(varie || 0);
const totaleLetturaAGiroCalcolato =
  Math.round(
    (impConsumo + depFogValue + quotaFissa + oneriAGiro + ivaAGiro + varieValue + Number.EPSILON) *
      100
  ) / 100;
const totaleLetturaAGiro =
  totaleFornituraAGiro > 0 ? totaleFornituraAGiro : totaleLetturaAGiroCalcolato;

const numberOrNull = (value: any) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isSnapshotSession =
  String(session?.stato || "").toUpperCase() === "CALCOLATA" ||
  String(session?.stato || "").toUpperCase() === "CONFERMATA";

const getLiveLetturaAttuale = (row: any) =>
  isSnapshotSession
    ? numberOrNull(row?.riga?.lettura_attuale) ??
      numberOrNull(row?.attuale?.valore_lettura)
    : numberOrNull(row?.attuale?.valore_lettura) ??
      numberOrNull(row?.riga?.lettura_attuale);

const getLiveLetturaPrecedente = (row: any) =>
  isSnapshotSession
    ? numberOrNull(row?.riga?.lettura_precedente) ??
      numberOrNull(row?.precedente?.valore_lettura)
    : numberOrNull(row?.precedente?.valore_lettura) ??
      numberOrNull(row?.riga?.lettura_precedente);

const getLiveStatoAttuale = (row: any) =>
  isSnapshotSession
    ? row?.riga?.stato_attuale ?? row?.attuale?.stato_lettura ?? "-"
    : row?.attuale?.stato_lettura ?? row?.riga?.stato_attuale ?? "-";

const getRowUtenzaId = (row: any) => String(row?.riga?.id_utenza || row?.utenza?.id || "");

const isManualConsumptionRow = (row: any) =>
  String(getLiveStatoAttuale(row) || "").trim().toUpperCase() === "Y";

const getManualConsumptionValue = (row: any) => {
  const key = getRowUtenzaId(row);
  if (!key) return null;
  return numberOrNull(manualConsumptions[key]);
};

const updateManualConsumption = (row: any, value: string) => {
  const key = getRowUtenzaId(row);
  if (!key) return;

  setManualConsumptions((prev) => ({
    ...prev,
    [key]: value,
  }));
};

const persistManualConsumptions = () => {
  if (!fatturaId) return;
  saveParams({ manualConsumptions: getManualConsumptionPayload() }).catch(() => undefined);
};

const getLiveRowConsumption = (row: any) => {
  if (isManualConsumptionRow(row)) {
    const manual = getManualConsumptionValue(row);
    if (manual !== null) return manual;
  }

  if (isSnapshotSession && row?.riga) {
    return Number(row?.riga?.consumo_totale || 0);
  }

  const attuale = getLiveLetturaAttuale(row);
  const precedente = getLiveLetturaPrecedente(row);

  if (attuale !== null && precedente !== null) {
    return attuale - precedente;
  }

  return Number(row?.riga?.consumo_totale || 0);
};

const hasStaleCalculatedReadings = (row: any) => {
  if (isSnapshotSession) return false;

  const riga = row?.riga;
  if (!riga) return false;

  const liveAttuale = numberOrNull(row?.attuale?.valore_lettura);
  const livePrecedente = numberOrNull(row?.precedente?.valore_lettura);

  const savedAttuale = numberOrNull(riga?.lettura_attuale);
  const savedPrecedente = numberOrNull(riga?.lettura_precedente);
  const liveStato = row?.attuale?.stato_lettura ?? null;
  const savedStato = riga?.stato_attuale ?? null;

  return (
    (liveAttuale !== null && savedAttuale !== null && liveAttuale !== savedAttuale) ||
    (livePrecedente !== null && savedPrecedente !== null && livePrecedente !== savedPrecedente) ||
    (liveStato !== null && savedStato !== null && liveStato !== savedStato)
  );
};

const hasStaleManualConsumption = (row: any) => {
  if (!isManualConsumptionRow(row)) return false;
  const manual = getManualConsumptionValue(row);
  if (manual === null) return false;
  const stored = numberOrNull(row?.riga?.consumo_totale);
  return stored !== null && Math.abs(manual - stored) > 0.001;
};



const totals = useMemo(() => {
  const base = righe.reduce(
    (acc: any, r: any) => {
      const row = r.riga || {};

      acc.consumo += getLiveRowConsumption(r);
      acc.acq += Number(row.imp_acquedotto || 0);
      acc.fog += Number(row.imp_fognatura || 0);
      acc.dep += Number(row.imp_depurazione || 0);
      acc.qf += Number(row.imp_qf || 0);
      acc.cong += Number(row.conguaglio || 0);
      acc.oneri += Number(row.imp_oneri || 0);
      acc.oneriConfigurati += Number(
        row.imp_oneri_base_display ??
          row.configured_oneri ??
          row.imp_oneri ??
          0
      );
      acc.acconto += Number(row.acconto || 0);
      acc.accontoAcq += Number(row.imp_acconto || 0);
      acc.accontoDepFog += Number(row.depfog_acconto || 0);
      acc.storno += Number(row.storno_acconto || 0);
      acc.totConsAcc += Number(row.consumo_acconto || 0);
      acc.iva += Number(row.imp_iva || 0);
      acc.arr += Number(row.imp_arr || 0);
      acc.totale += Number(row.totale || 0);

      return acc;
    },
    {
      consumo: 0,
      acq: 0,
      fog: 0,
      dep: 0,
      qf: 0,
      cong: 0,
      oneri: 0,
      oneriConfigurati: 0,
      acconto: 0,
      accontoAcq: 0,
      accontoDepFog: 0,
      storno: 0,
      totConsAcc: 0,
      iva: 0,
      arr: 0,
      totale: 0,
    }
  );

  base.accontoVisibile = Number((base.accontoAcq + base.accontoDepFog).toFixed(2));
  base.accontoExtra = Number((base.acconto - base.accontoVisibile).toFixed(2));

  const totaleInterni = Number(base.totale.toFixed(2));

  const generalWithoutOneri =
    Number(session?.tot_acquedotto || 0) +
    Number(session?.tot_fognatura || 0) +
    Number(session?.tot_depurazione || 0) +
    Number(session?.tot_qf || 0) +
    Number(session?.varie || 0) +
    Number(session?.tot_iva || 0);

  const oneriGenerale = Number(session?.tot_oneri || 0);

  const generalePlusOneri = Number(
    (generalWithoutOneri + oneriGenerale).toFixed(2)
  );

  
  return {
    ...base,
    totaleInterni,
    generalePlusOneri,
 
  };
}, [righe, session]);

const totaleDocumento = Number(activeImportedDocument?.importo_totale_da_pagare ?? 0);
const totaleOneri = Number(totals?.oneriConfigurati ?? 0);
const selectedDocHasParsedOneri = hasOneriPerequazioneRows(
  activeImportedDocument?.parsed_payload_json
);
const totaleParsedOneriPereq = Number(oneriPerequazione || 0);
const displayedOneriPereqShares = useMemo(() => {
  const shares = new Map<any, number>();
  if (!selectedDocHasParsedOneri) return shares;

  const chargeableRows = righe.filter(
    (row: any) => Number(row?.riga?.consumo_totale || 0) > 0
  );
  if (!chargeableRows.length) return shares;

  const totalCents = Math.round(Math.abs(totaleParsedOneriPereq) * 100);
  const sign = totaleParsedOneriPereq < 0 ? -1 : 1;
  const weights = chargeableRows.map((row: any) =>
    Math.max(0, Number(row?.riga?.consumo_totale || 0))
  );
  const totalWeight = weights.reduce((sum: number, value: number) => sum + value, 0);
  if (totalWeight <= 0) return shares;

  const rawShares = weights.map((weight: number) => (totalCents * weight) / totalWeight);
  const cents = rawShares.map((value: number) => Math.floor(value));
  const assigned = cents.reduce((sum: number, value: number) => sum + value, 0);
  const order = rawShares
    .map((value: number, index: number) => ({
      index,
      remainder: value - Math.floor(value),
    }))
    .sort((a: any, b: any) => b.remainder - a.remainder);

  for (let i = 0; i < totalCents - assigned; i += 1) {
    cents[order[i % order.length].index] += 1;
  }

  chargeableRows.forEach((row: any, index: number) => {
    shares.set(row, sign * (cents[index] / 100));
  });

  return shares;
}, [righe, selectedDocHasParsedOneri, totaleParsedOneriPereq]);

const totaleInterni = Number(totals?.totaleInterni ?? 0);
const totaleDocumentoConOneri = Number(
  (totaleDocumento + totaleOneri).toFixed(2)
);
const deltaTotali = Number((totaleInterni - totaleDocumento).toFixed(2));
const deltaRispettoOneri = Number((deltaTotali - totaleOneri).toFixed(2));

const deltaOk =
  totaleDocumento > 0 && Math.abs(deltaRispettoOneri) <= 0.01;
const isGreen = totaleDocumentoConOneri > 0 && deltaOk;

const getRowOneriPerequazione = (row: any) =>
  Number(row?.riga?.imp_oneri_perequazione_display ?? NaN) >= 0
    ? Number(row?.riga?.imp_oneri_perequazione_display || 0)
    : selectedDocHasParsedOneri && Number(row?.riga?.consumo_totale || 0) > 0
    ? Number(displayedOneriPereqShares.get(row) || 0)
    : 0;

const getRowOneri = (row: any) =>
  Number(row?.riga?.imp_oneri_base_display ?? NaN) >= 0
    ? Number(row?.riga?.imp_oneri_base_display || 0)
    : selectedDocHasParsedOneri
    ? Math.max(0, Number(row?.riga?.imp_oneri ?? 0) - getRowOneriPerequazione(row))
    : Number(row?.riga?.imp_oneri ?? 0);

const getDisplayedRowTotal = (row: any) => {
  const storedTotal = row?.riga?.totale;
  if (
    storedTotal !== null &&
    storedTotal !== undefined &&
    storedTotal !== "" &&
    Number.isFinite(Number(storedTotal))
  ) {
    return roundMoney(Number(storedTotal));
  }

  return getExpectedRowTotal(row);
};

const getMinimumPayableAmount = (row: any) => {
  const r = row?.riga || {};
  const qf = Number(r.imp_qf || 0);
  const fromBackend = Number(r.minimum_payable || 0);

  if (fromBackend > 0) return fromBackend;

  return roundMoney(getRowOneri(row) + qf + qf * 0.1);
};

const getMinimumPayableBreakdown = (row: any) => {
  const r = row?.riga || {};
  const qf = Number(r.imp_qf || 0);
  const oneri = getRowOneri(row);
  const ivaQf = roundMoney(qf * 0.1);
  const minimum = getMinimumPayableAmount(row);

  return {
    qf,
    oneri,
    ivaQf,
    minimum,
    label: `Minimo: oneri EUR ${oneri.toFixed(2)} + QF EUR ${qf.toFixed(2)} + IVA QF EUR ${ivaQf.toFixed(2)} = EUR ${minimum.toFixed(2)}`,
  };
};

const isMinimumPayableApplied = (row: any) => {
  const r = row?.riga || {};
  if (Number(r.minimum_payable_applied || 0) === 1) return true;

  const storno = Number(r.storno_acconto || 0);
  const total = getDisplayedRowTotal(row);
  const minimum = getMinimumPayableAmount(row);

  return storno < 0 && minimum > 0 && Math.abs(total - minimum) <= 0.05;
};

const isRecuperoReadingRow = (row: any) => {
  if (Number(row?.riga?.recupero_lettura || 0) === 1) return true;

  const stato = String(row?.riga?.stato_attuale ?? row?.attuale?.stato_lettura ?? "").toUpperCase();
  const current = numberOrNull(row?.riga?.lettura_attuale ?? row?.attuale?.valore_lettura);
  const previous = numberOrNull(row?.riga?.lettura_precedente ?? row?.precedente?.valore_lettura);

  return stato !== "S" && current !== null && previous !== null && current < previous;
};

const roundMoney = (value: number) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const getExpectedRowTotal = (row: any) => {
  const r = row?.riga || {};

  return roundMoney(
    Number(r.imp_acquedotto || 0) +
      Number(r.imp_fognatura || 0) +
      Number(r.imp_depurazione || 0) +
      Number(r.imp_qf || 0) +
      getRowOneri(row) +
      getRowOneriPerequazione(row) +
      Number(r.imp_iva || 0) +
      Number(r.conguaglio || 0) +
      Number(r.imp_arr || 0) +
      Number(r.acconto || 0) +
      Number(r.storno_acconto || 0)
  );
};

const getRowTotalDelta = (row: any) =>
  roundMoney(getDisplayedRowTotal(row) - getExpectedRowTotal(row));

const isRowTotalOk = (row: any) => Math.abs(getRowTotalDelta(row)) <= 0.01;

const getRowStornoMc = (row: any) => {
  const persisted = Number(row?.riga?.storno_mc_applicato || 0);
  if (Math.abs(persisted) > 0.0004) return persisted;

  const rowStornoEuro = Number(row?.riga?.storno_txt_aggiuntivo || 0);
  const totalStornoEuro = righe.reduce(
    (sum: number, item: any) =>
      sum + Number(item?.riga?.storno_txt_aggiuntivo || 0),
    0
  );
  const totalStornoMc = Number(mcStorno || 0);

  if (!rowStornoEuro || !totalStornoEuro || !totalStornoMc) {
    return 0;
  }

  return (rowStornoEuro / totalStornoEuro) * totalStornoMc;
};

const getStornoTransitionLabel = (status: any) => {
  const labels: Record<string, string> = {
    NESSUNO: "Nessuno storno TXT per l'utenza",
    LEGACY_PARZIALE_MINIMO: "Acconto legacy applicato parzialmente per il minimo",
    LEGACY_CARENZA_ASSORBITA: "Differenza legacy assorbita",
    LEGACY_ECCESSO_DIFFERITO: "Acconto legacy applicato; eccedenza TXT rinviata",
    LEGACY_ESATTO: "TXT allineato all'acconto legacy",
    RESIDUO_ASSORBITO_TXT_DIFFERITO: "Residuo precedente assorbito; nuovo TXT rinviato",
    RESIDUO_ASSORBITO: "Residuo precedente assorbito",
    TXT_PARZIALE_DIFFERITO: "TXT applicato parzialmente; residuo rinviato",
    TXT_APPLICATO: "TXT applicato",
  };
  return labels[String(status || "")] || "Calcolo storno ordinario";
};

const totaleOneriPereqVisibile = righe.reduce(
  (sum: number, row: any) => sum + getRowOneriPerequazione(row),
  0
);
const totaleOneriVisibile = righe.reduce(
  (sum: number, row: any) => sum + getRowOneri(row),
  0
);
const totaleInterniVisibile = righe.reduce(
  (sum: number, row: any) => sum + getDisplayedRowTotal(row),
  0
);

const totalAudit = useMemo(() => {
  const rowErrors = righe.filter((row: any) => row?.riga && !isRowTotalOk(row));
  const expectedRowsTotal = roundMoney(
    righe.reduce((sum: number, row: any) => sum + getExpectedRowTotal(row), 0)
  );
  const storedRowsTotal = roundMoney(
    righe.reduce((sum: number, row: any) => sum + Number(row?.riga?.totale || 0), 0)
  );
  const displayedRowsTotal = roundMoney(
    righe.reduce((sum: number, row: any) => sum + getDisplayedRowTotal(row), 0)
  );
  const reconciledOk =
    totaleDocumentoConOneri <= 0 ||
    Math.abs(displayedRowsTotal - totaleDocumentoConOneri) <= 0.01;

  return {
    rowErrors,
    expectedRowsTotal,
    storedRowsTotal,
    displayedRowsTotal,
    rowsOk: rowErrors.length === 0,
    reconciledOk,
    totalsOk:
      Math.abs(expectedRowsTotal - storedRowsTotal) <= 0.01 &&
      Math.abs(displayedRowsTotal - totaleInterniVisibile) <= 0.01 &&
      reconciledOk,
  };
}, [
  righe,
  selectedDocHasParsedOneri,
  displayedOneriPereqShares,
  totaleInterniVisibile,
  totaleDocumentoConOneri,
]);

const activeTariffCategory = activeTariffPreview?.category || null;
const activeTariffScaglioni = Array.isArray(activeTariffCategory?.scaglioni)
  ? [...activeTariffCategory.scaglioni].sort(
      (a: any, b: any) => Number(a?.ordine || 0) - Number(b?.ordine || 0)
    )
  : [];
const activeTariffQfTotal = Array.isArray(activeTariffCategory?.quote_fisse)
  ? activeTariffCategory.quote_fisse.reduce(
      (sum: number, item: any) => sum + Number(item?.importo || 0),
      0
    )
  : 0;
const activeSessionSummary = sessions.find(
  (item: any) => String(item?.id || "") === String(fatturaId || "")
);
const activeSessionDocument = activeSessionSummary
  ? getSessionLinkedImportedDocument(activeSessionSummary)
  : null;
const activeSessionPeriod = activeSessionDocument
  ? getImportedDocumentPeriodLabel(activeSessionDocument)
  : "";
const formatTariffNumber = (value: any, decimals = 4) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(decimals) : "-";
};
const formatScaglioneRange = (scaglione: any) => {
  const from = Number(scaglione?.mc_da_base ?? 0);
  const to = scaglione?.mc_a_base === null || scaglione?.mc_a_base === undefined
    ? "∞"
    : Number(scaglione.mc_a_base);
  return `${from}-${to}`;
};
const isSessionPreparing = Boolean(
  loadingDetail ||
    loadingImportedDetail ||
    autoCalculatingSessionId ||
    pendingAutoCalculateSessionId
);

return (
    <div className="relative" aria-busy={isSessionPreparing}>
      {isSessionPreparing && (
        <div
          className="fixed inset-0 z-[100] flex cursor-wait items-center justify-center bg-slate-950/35 px-4 backdrop-blur-[2px]"
          role="status"
          aria-live="polite"
        >
          <div className="flex max-w-sm items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-2xl">
            <Loader2 size={22} className="shrink-0 animate-spin text-blue-600" />
            <div>
              <div className="font-semibold text-slate-900">Preparazione sessione</div>
              <div className="mt-0.5 text-sm text-slate-500">
                Attendere prego, sto caricando documento, tariffa e calcoli.
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="screen-only" inert={isSessionPreparing}>
      {(error || calculationNotice) && (
        <div className="space-y-2 px-4 pt-3">
          {error && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <div className="min-w-0 flex-1">{error}</div>
              <button type="button" onClick={() => setError(null)} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-red-500 transition hover:bg-red-100" aria-label="Chiudi errore" title="Chiudi">
                <X size={15} />
              </button>
            </div>
          )}
          {calculationNotice && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900">
              <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-wide">Suggerimento sul TF</div>
                <div className="mt-0.5 text-sm text-amber-800">{calculationNotice}</div>
              </div>
              <button type="button" onClick={() => setCalculationNotice(null)} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-amber-600 transition hover:bg-amber-100" aria-label="Chiudi suggerimento" title="Chiudi">
                <X size={15} />
              </button>
            </div>
          )}
        </div>
      )}
      {/* SUMMARY */}
      <div className="sticky top-0 z-50 -mt-px border-y border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="max-w-full space-y-1.5 px-4 py-2">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <h1 className="text-base font-bold text-slate-900">Fatturazione</h1>
                {activeSessionPeriod && (
                  <span className="truncate text-xs font-medium text-slate-500">
                    Periodo {activeBillingProviderCode} {activeSessionPeriod}
                  </span>
                )}
                <span className="text-sm font-bold text-slate-900">
                  Totale € {Number(selectedDoc || 0).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <label htmlFor="tf-code" className="text-xs font-semibold text-slate-500">TF</label>
                <select
                  id="tf-code"
                  value={tfCode}
                  onChange={(e) => {
                    persistTfCode(e.target.value).catch(() => undefined);
                  }}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  disabled={loadingCalc}
                >
                  <option value="TF1">TF1</option>
                  <option value="TF2">TF2</option>
                  <option value="TF3">TF3</option>
                </select>
              </div>

              <button
                onClick={() => calcola()}
                disabled={loadingCalc}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingCalc ? "Calcolo..." : "Calcola Contabilità"}
              </button>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-max items-center gap-2">
              <span className="font-semibold uppercase tracking-[0.14em] text-slate-500">
                Tariffa applicata
              </span>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                {normalizeTfCode(tfCode)}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-medium">
                {activeTariffPreview?.version?.anno || annoTariffa || "-"}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-medium">
                {activeTariffCategory?.codice || "Categoria -"}
              </span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                QF totale € {formatTariffNumber(activeTariffQfTotal, 2)}
              </span>
            </div>

            <div className="flex min-w-max items-center gap-1.5">
              {loadingTariffPreview ? (
                <span className="text-slate-400">Caricamento tariffa...</span>
              ) : activeTariffScaglioni.length > 0 ? (
                activeTariffScaglioni.slice(0, 5).map((scaglione: any) => (
                  <span
                    key={scaglione.id || `${scaglione.ordine}-${scaglione.nome}`}
                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-700"
                    title={scaglione.nome || ""}
                  >
                    {scaglione.nome || `S${scaglione.ordine}`}: {formatScaglioneRange(scaglione)} mc
                    {" · "}€ {formatTariffNumber(scaglione.prezzo_acquedotto, 4)}
                  </span>
                ))
              ) : (
                <span className="text-slate-400">Scaglioni non disponibili</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-full px-4 pt-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className={`flex items-center justify-between gap-4 ${sessionPanelOpen ? "mb-3" : ""}`}>
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Periodi di fatturazione
                </div>
                {sessionPanelOpen && (
                  <div className="mt-1 text-xs text-slate-500">
                    Ogni periodo mantiene il proprio TXT associato e i dati calcolati.
                  </div>
                )}
            
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                  {filteredSessions.length} / {sessions.length}
                </span>
                <button
                  type="button"
                  onClick={() => setSessionPanelOpen((open) => !open)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  aria-expanded={sessionPanelOpen}
                >
                  {sessionPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {sessionPanelOpen ? "Nascondi" : "Mostra periodi"}
                </button>
              </div>
            </div>

            {sessionPanelOpen && (
            <div>
            <div className="relative mb-3">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={periodSearch}
                onChange={(e) => setPeriodSearch(e.target.value)}
                placeholder="Cerca periodo, TXT, TF o totale..."
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {sessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
                Nessun periodo di fatturazione salvato.
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
                Nessun periodo trovato con questa ricerca.
              </div>
            ) : (
              <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
                {filteredSessions.map((s: any) => {
                  const linkedDoc = getSessionLinkedImportedDocument(s);
                  const linkedDocName = linkedDoc ? getImportedDocumentName(linkedDoc) : "Nessun documento collegato";
                  const linkedDocPeriod = getImportedDocumentPeriodLabel(linkedDoc);
                  const isAutoLoading = String(autoCalculatingSessionId || pendingAutoCalculateSessionId || "") === String(s.id);

                  return (
                  <div
                    key={s.id}
                    className={`group relative w-full rounded-lg border p-3 transition ${
                      fatturaId === s.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <button
                      onClick={() => handleSelectSession(s)}
                      disabled={isAutoLoading || loadingCalc}
                      className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 pr-7 text-left disabled:cursor-wait sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                    >
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          s.stato === "BOZZA"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {s.stato}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-800">
                          Periodo {getBillingProviderCode(linkedDoc, s)}: {linkedDocPeriod}
                        </span>
                        <span
                            className={`mt-0.5 block break-words text-[11px] leading-4 ${
                            linkedDoc ? "text-slate-500" : "text-amber-600"
                          }`}
                          title={linkedDocName}
                        >
                          Doc: {linkedDocName}
                        </span>
                      </span>

                      {/* <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                        € {Number(s.grand_total ?? 0).toFixed(2)}
                      </span> */}

                      <span className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                        {normalizeTfCode(s.tf_code || s.tf)}
                      </span>

                      <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                        Apri
                      </span>

                      {isAutoLoading && (
                        <Loader2 size={16} className="animate-spin text-blue-600" />
                      )}
                      </span>
                    </button>

                    {s.stato === "BOZZA" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(s.id);
                        }}
                        className="absolute right-2 top-2 rounded-full p-1 opacity-60 transition hover:bg-red-50 hover:opacity-100"
                        title="Elimina Bozza"
                        disabled={isAutoLoading}
                      >
                        <Trash2
                          size={14}
                          className="text-red-500 hover:text-red-700 transition"
                        />
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
            </div>
            )}

          </div>
        </div>
            <div className="h-3" />

      {!fatturaId ? (
        <div className="mx-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="font-semibold">Apri un nuovo periodo di fatturazione</div>
          {/* <div className="text-sm text-slate-500">
            Crea una nuova fattura oppure aprine una esistente.
          </div>  */}
          <div className="mt-3 border-t pt-3">
          
          <div className="mt-1 text-sm text-slate-500">
            Scegli casa idrica, periodo attuale e periodo precedente per aprire o creare lo snapshot di fatturazione.
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <select
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
              >
                <option value="">Casa Idrica</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>

              <select
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              >
                <option value="">Periodo Attuale</option>
                {periodi.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatAvailablePeriodLabel(p)}
                  </option>
                ))}
              </select>

              <select
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                value={previous}
                onChange={(e) => setPrevious(e.target.value)}
              >
                <option value="">Periodo Prec.</option>
                {periodi
                  .filter((p) => p.id !== current)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatAvailablePeriodLabel(p)}
                    </option>
                  ))}
              </select>

              <button
                disabled={!canCreate || loadingCreate}
                onClick={createSession}
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingCreate ? "Caricamento..." : "Carica periodo"}
              </button>
            </div>
          </div>
        </div>
        </div>
      ) : loadingDetail ? (
        <div className="bg-white p-6 rounded-xl shadow">
          Attendere prego, sto caricando lo snapshot della sessione...
        </div>
      ) : !session ? (
        <div className="bg-white p-6 rounded-xl shadow">
          Sessione non trovata
        </div>
      ) : (
        <>
      
          {/* CONTATORE GENERALE */}
          <div className="w-full space-y-4 px-4 pb-6">
          {/* ============================= */}
          {/* CONTROLLO CALCOLO + GENERALE */}
          {/* ============================= */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
  {/* HEADER */}
  <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h3 className="text-base font-bold text-slate-900">
        Preparazione calcolo
      </h3>
      <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
        Documento provider e parametri della sessione.
      </p>
    </div>

    <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
      Configurazione calcolo
    </div>
  </div>

  {/* IMPORT AREA - FULL WIDTH */}
  <div className="border-b border-slate-200 px-4 py-3">
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px_132px] lg:items-end">
      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
          File bolletta
        </span>

        <div className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 transition hover:border-slate-400 hover:bg-slate-100">
          <FileText className="h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-slate-800">
              {importFile ? importFile.name : "Seleziona un file"}
            </div>
            <div className="truncate text-[10px] text-slate-500">
              {importFile ? "Pronto per il caricamento" : "Nessun file selezionato"}
            </div>
          </div>

          <input
            type="file"
            accept=".pdf,.txt"
            className="hidden"
            onChange={(e) => setImportFile(e.target.files?.[0] || null)}
          />
        </div>
      </label>

      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Provider
        </span>

        <select
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          value={importProviderId}
          onChange={(e) => setImportProviderId(e.target.value)}
        >
          <option value="">Opzionale</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={uploadImportedInvoice}
        disabled={!importFile || uploadingImport}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Upload className="h-4 w-4" />
        {uploadingImport ? "Caricamento..." : "Carica"}
      </button>
    </div>
  </div>

  {/* MAIN SPLIT */}
  <div className="grid grid-cols-1 items-start gap-4 p-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)]">
    {/* LEFT - DOCUMENTI CARICATI */}
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900">
            Documenti caricati
          </h4>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Analisi e associazione dei documenti provider.
          </p>
        </div>

        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
          {filteredImportedDocs.length} / {importedDocs.length}
        </span>
      </div>

      <div className="border-b border-slate-200 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={importedSearch}
            onChange={(e) => setImportedSearch(e.target.value)}
            placeholder="Cerca documento o file..."
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />

          <select
            value={importedStatusFilter}
            onChange={(e) => setImportedStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          >
            <option value="all">Tutti</option>
            <option value="uploaded">Da analizzare</option>
            <option value="parsed">Analizzati</option>
            <option value="reviewed">Corretti manualmente</option>
            <option value="imported">Associati</option>
          </select>
        </div>
      </div>

      {loadingImportedDocs ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          Caricamento documenti...
        </div>
      ) : importedDocs.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          Nessun documento caricato.
        </div>
      ) : (
        <>
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full table-fixed divide-y divide-slate-200 text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th className="w-[54%] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Nome documento
                  </th>
                  <th className="w-[20%] px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Stato analisi
                  </th>
                  <th className="w-[26%] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Azioni
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {paginatedImportedDocs.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-500">
                      Nessun documento trovato.
                    </td>
                  </tr>
                ) : (
                  paginatedImportedDocs.map((doc: any) => {
                    const status = doc.parse_status || "uploaded";
                    const documentName = getImportedDocumentName(doc);
                    const statusLabel =
                      status === "imported"
                        ? "Associato"
                        : status === "reviewed"
                        ? "Corretto manualmente"
                        : status === "parsed"
                        ? "Analizzato"
                        : status === "failed"
                        ? "Errore"
                        : "Da analizzare";

                    const statusClass =
                      status === "imported"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : status === "reviewed"
                        ? "bg-amber-50 text-amber-700 ring-amber-200"
                        : status === "parsed"
                        ? "bg-blue-50 text-blue-700 ring-blue-200"
                        : "bg-slate-100 text-slate-700 ring-slate-200";

                    return (
                      <tr
                        key={doc.id}
                        className={`transition ${
                          selectedImportedDoc?.id === doc.id
                            ? "bg-blue-50/70"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => loadImportedDocumentForSession(doc.id)}
                            className="block w-full truncate text-left font-bold text-slate-900 hover:text-blue-700"
                          >
                            {documentName}
                          </button>

                          <div className="mt-0.5 w-full truncate text-[10px] text-slate-500">
                            File: {doc.original_filename || "-"}
                          </div>

                          <div className="mt-0.5 text-[11px] font-semibold text-slate-700">
                            € {Number(doc.importo_totale_da_pagare || 0).toFixed(2)}
                          </div>
                        </td>

                        <td className="px-2 py-2.5">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${statusClass}`}
                          >
                            {statusLabel}
                          </span>
                        </td>

                        <td className="px-3 py-2.5">
                          <div className="flex justify-end gap-1">
                            {status !== "parsed" && status !== "reviewed" && status !== "imported" && (
                              <button
                                type="button"
                                onClick={() => parseImportedInvoice(doc.id)}
                                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                              >
                                Analizza
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => loadImportedDocumentForSession(doc.id)}
                              className="rounded-lg bg-slate-900 px-2.5 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
                            >
                              Usa
                            </button>

                            <button
                              type="button"
                              onClick={() => deleteImportedInvoice(doc)}
                              disabled={deletingImportId === doc.id}
                              title="Elimina documento"
                              aria-label="Elimina documento"
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-3 py-2">
            <div className="text-xs text-slate-500">
              Pagina {importedPage} di {importedTotalPages}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={importedPage === 1}
                onClick={() => setImportedPage((p) => Math.max(1, p - 1))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Precedente
              </button>

              <button
                type="button"
                disabled={importedPage === importedTotalPages}
                onClick={() => setImportedPage((p) => Math.min(importedTotalPages, p + 1))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Successiva
              </button>
            </div>
          </div>
        </>
      )}
    </div>

    {/* RIGHT - IMPOSTAZIONI OPERATIVE */}
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="border-b border-slate-200 pb-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Parametri di calcolo
        </div>
        <h4 className="mt-0.5 text-sm font-semibold text-slate-900">
          Impostazioni operative
        </h4>
        <p className="mt-0.5 text-xs text-slate-500">
          Definisci anno tariffa e giorni usati nel calcolo.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 sm:col-span-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Documento associato al periodo
          </span>
          <span className={`mt-1 truncate text-sm font-semibold ${activeImportedDocument ? "text-slate-900" : "text-amber-700"}`}>
            {activeImportedDocument ? getImportedDocumentName(activeImportedDocument) : "Nessun TXT associato"}
          </span>
        </div>

        <div className="flex flex-col sm:col-span-2">
          <label className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Anno tariffa
          </label>
          <select
            className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            value={annoTariffa}
            onChange={(e) => setAnnoTariffa(e.target.value)}
          >
            <option value="">Anno Tariffa</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year === importedDocYear ? `Anno Corrente (${year})` : year}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Giorni QF
          </label>
          <input
            type="number"
            className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            value={giorniQf}
            onChange={(e) => setGiorniQf(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Giorni consumi
          </label>
          <input
            type="number"
            className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            value={giorniConsumi}
            onChange={(e) => setGiorniConsumi(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Giorni interni
          </label>
          <input
            type="number"
            className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            value={giorniCasaInterni}
            onChange={(e) => setGiorniCasaInterni(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Giorni acconto
          </label>
          <input
            type="number"
            className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            value={giorniAcconto}
            onChange={(e) => setGiorniAcconto(e.target.value)}
          />
        </div>
      </div>
    </div>

    {/* FULL WIDTH - MODIFICA MANUALE DATI ESTRATTI */}
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white xl:col-span-2">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-amber-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-amber-700" />
            <h4 className="text-sm font-bold text-slate-900">Inserimento e correzione manuale</h4>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Correggi i campi normalmente estratti dal PDF. I valori salvati sostituiscono quelli del parser nel calcolo.
          </p>
        </div>
        <button
          type="button"
          disabled={!selectedImportedDoc || loadingImportedDetail}
          onClick={() => {
            if (!selectedImportedDoc) return;
            if (editingImportedDoc) {
              setImportedDocEdit(buildImportedDocumentEditForm(selectedImportedDoc));
              setEditingImportedDoc(false);
            } else {
              openImportedDocumentEditor(selectedImportedDoc);
            }
          }}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-bold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil className="h-4 w-4" />
          {editingImportedDoc ? "Annulla modifica" : "Modifica dati estratti"}
        </button>
      </div>

      {!selectedImportedDoc ? (
        <div className="px-4 py-6 text-center text-sm text-slate-500">
          Seleziona un documento caricato per inserire o correggere i dati.
        </div>
      ) : !editingImportedDoc || !importedDocEdit ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-4">
          {[
            ["Bolletta", selectedImportedDoc.numero_bolletta || "-"],
            ["Fornitura", selectedImportedDoc.codice_fornitura || "-"],
            ["Periodo", `${selectedImportedDoc.data_inizio_periodo?.slice(0, 10) || "-"} → ${selectedImportedDoc.data_fine_periodo?.slice(0, 10) || "-"}`],
            ["Totale", `€ ${Number(selectedImportedDoc.importo_totale_da_pagare || 0).toFixed(2)}`],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
              <div className="mt-0.5 truncate font-semibold text-slate-800">{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-5 p-4">
          <section>
            <h5 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Documento e fornitura</h5>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Provider
                <select
                  value={importedDocEdit.providerId}
                  onChange={(event) => updateImportedDocumentEdit("providerId", event.target.value)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                >
                  <option value="">Non specificato</option>
                  {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.nome}</option>)}
                </select>
              </label>
              {([
                ["numeroBolletta", "Numero bolletta"],
                ["codiceFornitura", "Codice fornitura"],
                ["codiceCliente", "Codice cliente"],
                ["puntoErogazione", "Punto erogazione"],
                ["matricolaContatore", "Matricola contatore"],
                ["intestatario", "Intestatario"],
                ["indirizzoFornitura", "Indirizzo fornitura"],
                ["fornitoreServizi", "Fornitore servizi"],
              ] as Array<[keyof ImportedDocumentEditForm, string]>).map(([field, label]) => (
                <label key={field} className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                  {label}
                  <input
                    value={importedDocEdit[field]}
                    onChange={(event) => updateImportedDocumentEdit(field, event.target.value)}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                  />
                </label>
              ))}
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Tipo bolletta
                <select
                  value={importedDocEdit.billType}
                  onChange={(event) => updateImportedDocumentEdit("billType", event.target.value)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                >
                  <option value="unknown">Non specificato</option>
                  <option value="actual">Consumi effettivi</option>
                  <option value="estimated">Consumi stimati</option>
                  <option value="mixed">Mista</option>
                </select>
              </label>
              {([
                ["dataInizioPeriodo", "Inizio periodo", "date"],
                ["dataFinePeriodo", "Fine periodo", "date"],
                ["consumoGlobaleMc", "Consumo globale (mc)", "number"],
                ["importoTotaleDaPagare", "Totale documento (€)", "number"],
              ] as Array<[keyof ImportedDocumentEditForm, string, string]>).map(([field, label, type]) => (
                <label key={field} className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                  {label}
                  <input
                    type={type}
                    step={type === "number" ? "0.01" : undefined}
                    min={type === "number" ? "0" : undefined}
                    value={importedDocEdit[field]}
                    onChange={(event) => updateImportedDocumentEdit(field, event.target.value)}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                  />
                </label>
              ))}
            </div>
          </section>

          {([
            {
              title: "Lettura a giro",
              fields: [
                ["letturaPrecedente", "Lettura precedente"], ["letturaAttuale", "Lettura attuale"],
                ["giorniQF", "Giorni QF"], ["giorniConsumi", "Giorni consumi"],
                ["acquedotto", "Acquedotto (€)"], ["depFog", "Depurazione + fognatura (€)"],
                ["quotaFissa", "Quota fissa (€)"], ["oneri", "Oneri (€)"],
                ["iva", "IVA (€)"], ["totaleLettura", "Totale lettura (€)"],
              ],
            },
            {
              title: "Acconto",
              fields: [
                ["giorniAcconto", "Giorni"], ["mcAcconto", "Consumo (mc)"],
                ["acquedottoAcconto", "Acquedotto (€)"], ["depFogAcconto", "Depurazione + fognatura (€)"],
                ["quotaFissaAcconto", "Quota fissa (€)"], ["oneriAcconto", "Oneri perequazione (€)"],
                ["ivaAcconto", "IVA (€)"], ["totaleAcconto", "Totale (€)"],
              ],
            },
            {
              title: "Storno",
              fields: [
                ["mcStorno", "Consumo (mc)"], ["acquedottoStorno", "Acquedotto (€)"],
                ["depFogStorno", "Depurazione + fognatura (€)"], ["quotaFissaStorno", "Quota fissa (€)"],
                ["oneriStorno", "Oneri perequazione (€)"],
                ["ivaStorno", "IVA (€)"], ["totaleStorno", "Totale (€)"],
              ],
            },
          ] as Array<{ title: string; fields: Array<[keyof ImportedDocumentEditForm, string]> }>).map((group) => (
            <section key={group.title} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <h5 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{group.title}</h5>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {group.fields.map(([field, label]) => (
                  <label key={field} className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                    {label}
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={importedDocEdit[field]}
                      onChange={(event) => updateImportedDocumentEdit(field, event.target.value)}
                      className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                    />
                  </label>
                ))}
              </div>
            </section>
          ))}

          <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Il documento verrà marcato come corretto manualmente; i dati originali del file restano disponibili nel payload.
            </p>
            <button
              type="button"
              onClick={saveImportedDocumentManualEdit}
              disabled={savingImportedDoc}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingImportedDoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {savingImportedDoc ? "Salvataggio..." : "Salva correzioni"}
            </button>
          </div>
        </div>
      )}
    </div>
  </div>
</section>

          {/* CALCULATION BREAKDOWN */}
          <div className="rounded-[28px] border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-6 shadow-sm sm:p-7">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xl font-bold tracking-tight text-slate-900">
                  Dettaglio calcolo
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-slate-500">
                  Riepilogo dei valori utilizzati nel calcolo, con evidenza di acconto, storno e confronto finale con il documento importato.
                </p>
              </div>

              <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                Controllo contabilità
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
              {/* LEFT */}
              <div className="xl:col-span-8 space-y-6">
                {/* VALORI PRINCIPALI */}
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4 sm:px-6">
                    <h4 className="text-sm font-semibold text-slate-900">Valori principali</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Componenti essenziali della lettura a giro da confrontare con il documento importato.
                    </p>
                  </div>

                  <div className="p-5 sm:p-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                      <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-[1px] hover:shadow-sm">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          Consumo mc
                        </div>
                        <div className="mt-2 text-3xl font-bold text-slate-900">
                          {Number(consumo ?? 0).toFixed(0)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          Consumo totale lettura a giro
                        </div>
                      </article>

                      <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-[1px] hover:shadow-sm">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          Acquedotto
                        </div>
                        <div className="mt-2 text-2xl font-bold text-slate-900">
                          € {Number(impConsumo ?? 0).toFixed(2)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          Importo lettura a giro
                        </div>
                      </article>

                      <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-[1px] hover:shadow-sm">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          Quota fissa
                        </div>
                        <div className="mt-2 text-2xl font-bold text-slate-900">
                          € {Number(quotaFissa ?? 0).toFixed(2)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {quotaFissaSession > 0 ? "Ripartizione quota fissa" : "Quota fissa da TXT"}
                        </div>
                      </article>

                      <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-[1px] hover:shadow-sm">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          Oneri perequazione
                        </div>
                        <div className="mt-2 text-2xl font-bold text-slate-900">
                          € {Number(oneriPerequazione ?? 0).toFixed(2)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          Oneri attribuiti alla lettura a giro
                        </div>
                      </article>

                      <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-[1px] hover:shadow-sm">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          IVA lettura a giro
                        </div>
                        <div className="mt-2 text-2xl font-bold text-slate-900">
                          € {Number(ivaAGiro ?? 0).toFixed(2)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {manualIvaAGiro !== null ? "Valore inserito manualmente" : activeBillingProviderCode === "ASIS" ? "Da inserire manualmente" : "Calcolo IVA corrente"}
                        </div>
                      </article>

                      <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-[1px] hover:shadow-sm">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          Varie
                        </div>
                        <div className="mt-3">
                          <input
                            type="number"
                            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                            value={varie}
                            onChange={(e) => setVarie(e.target.value)}
                            placeholder="Inserisci valore"
                          />
                        </div>
                        <div className="mt-2 text-xs text-slate-400">
                          Valore attuale: € {Number(varieValue ?? 0).toFixed(2)}
                        </div>
                      </article>

                      <article className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 transition hover:-translate-y-[1px] hover:shadow-sm">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                          Totale lettura a giro
                        </div>
                        <div className="mt-2 text-2xl font-bold text-slate-900">
                          € {Number(totaleLetturaAGiro ?? 0).toFixed(2)}
                        </div>
                        <div className="mt-1 text-xs text-emerald-700/80">
                          {totaleFornituraAGiro > 0
                            ? totaleFornituraAGiroDaTxt > 0
                              ? "Totale fornitura a_giro dal TXT"
                              : "Totale documento meno acconto"
                            : "Solo letture a_giro, senza acconto o storno"}
                        </div>
                      </article>
                    </div>
                  </div>
                </section>

                {/* ACCONTO */}
                {(Number(mcAcconto || 0) !== 0 || Number(totaleAcconto || 0) !== 0 || quotaFissaAccontoValue !== 0) && (
                  <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
                    <div className="border-b border-amber-100 bg-gradient-to-r from-amber-50 to-white px-5 py-4 sm:px-6">
                      <h4 className="text-sm font-semibold text-slate-900">Acconto rilevato</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Dati estratti dal documento per il periodo di acconto individuato.
                      </p>
                    </div>

                    <div className="p-5 sm:p-6">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">
                            Consumo acconto
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            {Number(mcAcconto ?? 0).toFixed(2)} mc
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Acquedotto acconto
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(eurAcconto ?? 0).toFixed(2)}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Dep./Fog. acconto
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(depfogAcconto ?? 0).toFixed(2)}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Quota fissa acconto
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {quotaFissaAccontoValue.toFixed(2)}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            IVA acconto
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(ivaAcconto ?? 0).toFixed(2)}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Oneri perequazione acconto
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(oneriPerequazioneAcconto ?? 0).toFixed(2)}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                            Totale acconto
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(totaleAcconto ?? 0).toFixed(2)}
                          </div>
                        </article>
                      </div>
                    </div>
                  </section>
                )}

                {/* STORNO */}
                {(Number(mcStorno ?? 0) !== 0 || Number(totaleStorno || eurStorno || 0) !== 0) && (
                  <section className="overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-sm">
                    <div className="border-b border-rose-100 bg-gradient-to-r from-rose-50 to-white px-5 py-4 sm:px-6">
                      <h4 className="text-sm font-semibold text-slate-900">Storno rilevato</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Rettifica collegata ai consumi o agli importi già anticipati.
                      </p>
                    </div>

                    <div className="p-5 sm:p-6">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <article className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-700">
                            Consumo storno
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            {Number(mcStorno ?? 0).toFixed(2)} mc
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Acquedotto storno
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(acquedottoStorno ?? 0).toFixed(2)}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Dep./Fog. storno
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(depfogStorno ?? 0).toFixed(2)}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Quota fissa storno
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {quotaFissaStornoValue.toFixed(2)}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            IVA storno
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(ivaStorno ?? 0).toFixed(2)}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Oneri perequazione storno
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(oneriPerequazioneStorno ?? 0).toFixed(2)}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-700">
                            Totale storno
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(totaleStorno || eurStorno || 0).toFixed(2)}
                          </div>
                        </article>
                      </div>
                    </div>
                  </section>
                )}
              </div>

              {/* RIGHT */}
              <aside className="xl:col-span-4">
                <div className="sticky top-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
                    <h4 className="text-sm font-semibold text-slate-900">Confronto totali</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Verifica tra importo documento e totale ripartito internamente.
                    </p>
                  </div>

                  <div className="space-y-4 p-5">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                        Totale documento {activeBillingProviderCode}
                      </div>
                      <div className="mt-2 text-2xl font-bold text-slate-900">
                        € {totaleDocumento.toFixed(2)}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                        Dovuto incasso
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {activeBillingProviderCode} € {totaleDocumento.toFixed(2)} + oneri condominio € {totaleOneri.toFixed(2)}
                      </div>
                      <div className="mt-2 text-2xl font-bold text-slate-900">
                        € {totaleDocumentoConOneri.toFixed(2)}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-700 to-blue-600 px-4 py-5 text-white shadow-sm">
                      <div className="text-[11px] uppercase tracking-[0.16em] opacity-80">
                        Totale interni
                      </div>
                      <div className="mt-2 text-3xl font-bold">
                        € {totaleInterni.toFixed(2)}
                      </div>
                    </div>

                    <div
                      className={`rounded-2xl border px-4 py-5 ${
                        deltaOk
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-amber-200 bg-amber-50"
                      }`}
                    >
                      <div
                        className={`text-[11px] uppercase tracking-[0.16em] ${
                          deltaOk ? "text-emerald-700" : "text-amber-700"
                        }`}
                      >
                        Delta
                      </div>
                      <div
                        className={`mt-2 text-3xl font-bold ${
                          deltaOk ? "text-emerald-700" : "text-amber-700"
                        }`}
                      >
                        € {deltaTotali.toFixed(2)}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {deltaOk
                          ? `Il delta corrisponde agli oneri condominio (€ ${totaleOneri.toFixed(2)}).`
                          : `Delta atteso: oneri condominio € ${totaleOneri.toFixed(2)}. Scostamento residuo € ${deltaRispettoOneri.toFixed(2)}.`}
                      </div>
                    </div>
                  </div>
                </div>
              </aside>
            </div>  
          </div>

          {selectedImportedId !== null && (
            <>
              <div className="space-y-6">
                {/* ACTION BAR */}
                <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Documenti di ripartizione
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={handleExportPdf}
                        disabled={exportingRipartizioni}
                        className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {exportingRipartizioni ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                        {exportingRipartizioni ? "Generazione..." : "Genera bollette"}
                      </button>

                      <button
                        onClick={() => fatturaId && onStampaProspetto(String(fatturaId))}
                        disabled={!fatturaId}
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 text-sm font-bold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        <FileSpreadsheet className="h-4 w-4" />
                        Genera prospetto
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Chiusura sessione
                    </div>
                    <button
                      onClick={() => {
                        setFatturaDate(new Date().toISOString().slice(0, 10));
                        setIsCreateFatturaModalOpen(true);
                      }}
                      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 sm:w-auto"
                    >
                      <ReceiptText className="h-4 w-4" />
                      Registra fattura
                    </button>
                  </div>
                </div>

                  {exportingRipartizioni && exportJob && (
                    <div className="mt-3 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
                        <span>{exportMessage}</span>
                        <span>
                          {exportJob.total
                            ? `${Math.round((Number(exportJob.processed || 0) / Number(exportJob.total)) * 100)}%`
                            : "0%"}
                        </span>
                      </div>

                      <div
                        className="h-2 overflow-hidden rounded-full bg-slate-200"
                        role="progressbar"
                        aria-label="Avanzamento generazione bollette"
                        aria-valuemin={0}
                        aria-valuemax={Number(exportJob.total || 0)}
                        aria-valuenow={Number(exportJob.processed || 0)}
                      >
                        <div
                          className="h-full rounded-full bg-slate-900 transition-all duration-500"
                          style={{
                            width: `${
                              exportJob.total
                                ? Math.min(
                                    100,
                                    Math.round((Number(exportJob.processed || 0) / Number(exportJob.total)) * 100)
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </div>

                      {Number(exportJob.failed || 0) > 0 && (
                        <div className="mt-2 text-xs font-medium text-red-600">
                          {exportJob.failed} PDF non generati.
                        </div>
                      )}
                    </div>
                  )}

                  {!exportingRipartizioni && exportMessage && (
                    <div className="mt-3 text-sm font-medium text-slate-600">
                      {exportMessage}
                    </div>
                  )}

              </div>

              {parsingAlert && (
                <div
                  ref={parsingAlertRef}
                  className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="font-bold">Lettura a giro non trovata</div>
                      <div className="mt-1 max-w-4xl text-xs leading-5 text-amber-800">
                        {parsingAlert.message}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setParsingAlert(null)}
                      className="self-start rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-100"
                    >
                      Chiudi
                    </button>
                  </div>

                  {parsingAlert.availableTypes.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {parsingAlert.availableTypes.map((type) => {
                        const bucket = parsingAlert.grouped?.[type];
                        const oldest = bucket?.oldest;
                        const newest = bucket?.newest;
                        const canApply =
                          oldest?.lettura_mc != null && newest?.lettura_mc != null;

                        return (
                          <button
                            key={type}
                            type="button"
                            disabled={!canApply}
                            onClick={() => applyParsedReadingBucket(type)}
                            className="rounded-xl border border-amber-200 bg-white p-3 text-left transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <div className="text-xs font-black uppercase tracking-wide text-amber-700">
                              Usa {type}
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <div className="font-bold text-slate-500">Precedente</div>
                                <div className="font-semibold text-slate-900">
                                  {oldest?.lettura_mc ?? "-"} mc
                                </div>
                                <div className="text-slate-500">
                                  {oldest?.data_lettura || "-"}
                                </div>
                              </div>
                              <div>
                                <div className="font-bold text-slate-500">Attuale</div>
                                <div className="font-semibold text-slate-900">
                                  {newest?.lettura_mc ?? "-"} mc
                                </div>
                                <div className="text-slate-500">
                                  {newest?.data_lettura || "-"}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="bg-white border rounded-2xl p-6">
                {/* CONTATORE GENERALE RIBBON */}
<div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
  <div className="flex flex-col gap-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-4 py-4 text-white lg:flex-row lg:items-center lg:justify-between">
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">
        Contatore generale
      </div>

      <div className="mt-1 text-sm font-semibold">
        Valori di riferimento per il calcolo dei contatori interni
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <div className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-300">
          Lettura attuale
        </div>
        <input
          type="number"
          value={valAtt}
          onChange={(e) => setValAtt(e.target.value)}
          className="mt-1 w-28 rounded-lg border border-white/20 bg-white px-2 py-1 text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-white/40"
        />
      </div>

      <div className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-300">
          Lettura precedente
        </div>
        <input
          type="number"
          value={valPrec}
          onChange={(e) => setValPrec(e.target.value)}
          className="mt-1 w-28 rounded-lg border border-white/20 bg-white px-2 py-1 text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-white/40"
        />
      </div>

      <div className="rounded-xl bg-emerald-400/15 px-4 py-2 ring-1 ring-emerald-300/30">
        <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-100">
          Consumo generale
        </div>
        <div className="mt-1 text-lg font-black text-white">
          {Math.max(0, Number(valAtt || 0) - Number(valPrec || 0))} mc
        </div>
      </div>

      <button
        onClick={() => saveGenerale()}
        disabled={savingGenerale}
        className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-slate-900 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Save size={16} />
        {savingGenerale ? "Salvando..." : "Salva"}
      </button>
    </div>
  </div>

  <div className="grid grid-cols-2 divide-x divide-slate-200 border-t border-slate-200 bg-slate-50 text-xs sm:grid-cols-4">
    <div className="px-4 py-2">
      <span className="font-bold text-slate-500">Interni:</span>{" "}
      <span className="font-semibold text-slate-900">
        {righe.length}
      </span>
    </div>

    <div className="px-4 py-2">
      <span className="font-bold text-slate-500">Consumo interni:</span>{" "}
      <span className="font-semibold text-slate-900">
        {totals.consumo.toFixed(0)} mc
      </span>
    </div>

    <div className="px-4 py-2">
      <span className="font-bold text-slate-500">Totale interni:</span>{" "}
      <span className={`font-semibold ${isGreen ? "text-emerald-600" : "text-red-600"}`}>
        € {totals.totaleInterni.toFixed(2)}
      </span>
    </div>

    <div className="px-4 py-2">
      <span className="font-bold text-slate-500">Stato:</span>{" "}
      <span className={`font-semibold ${isGreen ? "text-emerald-600" : "text-red-600"}`}>
        {isGreen ? "Allineato" : "Da verificare"}
      </span>
    </div>
  </div>
</div>

                    {fatturaId && (
                      <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                              Passaggio dalla piattaforma precedente
                            </div>
                            <h3 className="mt-0.5 text-sm font-bold text-slate-900">
                              Acconti precedenti per utenza
                            </h3>
                            <p className="mt-0.5 text-xs text-slate-500">
                              Quando il TXT contiene storno, l'acconto legacy sostituisce la quota TXT dell'utenza; senza storno TXT il saldo resta invariato.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setLegacyEditorOpen((open) => !open)}
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                          >
                            {legacyEditorOpen ? "Chiudi" : legacyAcconti.length ? "Modifica saldi" : "Inserisci saldi"}
                          </button>
                        </div>

                        <div className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/70 sm:grid-cols-4">
                          <div className="px-4 py-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Storno nel TXT</div>
                            <div className="mt-0.5 font-semibold text-slate-900">EUR {Math.abs(Number(eurStorno || 0)).toFixed(2)}</div>
                          </div>
                          <div className="px-4 py-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Saldo legacy inserito</div>
                            <div className="mt-0.5 font-semibold text-slate-900">EUR {legacyDraftTotal.toFixed(2)}</div>
                          </div>
                          <div className="px-4 py-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Residuo disponibile</div>
                            <div className="mt-0.5 font-semibold text-slate-900">EUR {legacyResidualTotal.toFixed(2)}</div>
                          </div>
                          <div className="px-4 py-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Esito previsto</div>
                            <div className={`mt-0.5 text-xs font-bold ${Math.abs(Number(eurStorno || 0)) > 0 ? "text-emerald-700" : "text-amber-700"}`}>
                              {Math.abs(Number(eurStorno || 0)) > 0
                                ? legacyDraftTotal > 0
                                  ? "Acconto legacy in sostituzione della quota TXT; eccedenze rinviate"
                                  : "Solo storno TXT; nessun saldo precedente inserito"
                                : "Nessun saldo legacy o residuo consumato senza storno TXT"}
                            </div>
                          </div>
                        </div>

                        {legacyEditorOpen && (
                          <div className="px-4 py-4">
                            <div className="mb-4 grid gap-4 md:grid-cols-[minmax(240px,420px)_1fr] md:items-end">
                              <label className="block">
                                <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                  Periodo della bolletta precedente
                                </span>
                                <input
                                  type="text"
                                  value={legacyPeriodoOrigine}
                                  onChange={(event) => setLegacyPeriodoOrigine(event.target.value)}
                                  placeholder="Esempio: 07/2025 - 10/2025"
                                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                />
                              </label>
                              <p className="text-xs leading-5 text-slate-500">
                                Il minimo fatturabile resta sempre oneri + QF + IVA QF. La parte non applicabile non viene persa: rimane credito nominativo per un periodo successivo.
                              </p>
                            </div>

                            <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200">
                              <table className="w-full min-w-[720px] text-sm">
                                <thead className="sticky top-0 z-10 bg-slate-100 text-[11px] uppercase tracking-wide text-slate-600">
                                  <tr>
                                    <th className="px-3 py-2 text-left">ID</th>
                                    <th className="px-3 py-2 text-left">Utenza</th>
                                    <th className="px-3 py-2 text-left">Interno</th>
                                    <th className="px-3 py-2 text-right">Acconto precedente EUR</th>
                                    <th className="px-3 py-2 text-right">MC opzionali</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {legacyEditorRows.map((row: any) => {
                                    const idUtenza = String(row?.utenza?.id || row?.id_utenza || "");
                                    const values = legacyDraft[idUtenza] || { euro: "", mc: "" };
                                    return (
                                      <tr key={idUtenza} className="border-t border-slate-100 even:bg-slate-50/60">
                                        <td className="px-3 py-2 text-slate-500">{row?.utenza?.id_user || "-"}</td>
                                        <td className="px-3 py-2 font-medium text-slate-900">
                                          {[row?.utenza?.Nome, row?.utenza?.Cognome].filter(Boolean).join(" ") || "-"}
                                        </td>
                                        <td className="px-3 py-2 text-slate-600">{row?.utenza?.Interno || "-"}</td>
                                        <td className="px-3 py-2 text-right">
                                          <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={values.euro}
                                            onChange={(event) => updateLegacyDraft(idUtenza, "euro", event.target.value)}
                                            className="h-9 w-28 rounded-lg border border-slate-200 px-2 text-right font-semibold outline-none focus:border-blue-400"
                                          />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <input
                                            type="number"
                                            min="0"
                                            step="0.001"
                                            value={values.mc}
                                            onChange={(event) => updateLegacyDraft(idUtenza, "mc", event.target.value)}
                                            className="h-9 w-28 rounded-lg border border-slate-200 px-2 text-right outline-none focus:border-blue-400"
                                          />
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            <div className="mt-4 flex items-center justify-end gap-3">
                              {loadingLegacy && <span className="text-xs text-slate-500">Caricamento...</span>}
                              <button
                                type="button"
                                onClick={saveLegacyAccontiAndRecalculate}
                                disabled={savingLegacy || loadingCalc}
                                className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
                              >
                                {savingLegacy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Salva e ricalcola
                              </button>
                            </div>
                          </div>
                        )}
                      </section>
                    )}

                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <h3 className="font-semibold">Situazione Contatori Interni</h3>

                      <div
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                          totalAudit.rowsOk && totalAudit.totalsOk
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        Righe:{" "}
                        {totalAudit.rowsOk
                          ? `OK (${righe.filter((row: any) => row?.riga).length}/${righe.filter((row: any) => row?.riga).length})`
                          : `${totalAudit.rowErrors.length} da verificare`}{" "}
                        · Totali:{" "}
                        {totalAudit.totalsOk ? "OK" : "Da verificare"}
                      </div>
                    </div>
                      <div className="max-h-[68vh] overflow-auto rounded-lg border border-slate-200 bg-white">
                          <table className="w-full min-w-[1900px] text-xs">
                                <thead className="sticky top-0 z-30 bg-slate-100 text-[10px] uppercase tracking-wide text-slate-600 shadow-sm">
                                  <tr>
                                    <th className="sticky left-0 z-40 w-14 min-w-14 bg-slate-100 p-2">ID</th>
                                    <th className="sticky left-14 z-40 min-w-[220px] bg-slate-100 p-2 shadow-[2px_0_0_0_rgb(226_232_240)]">Utente</th>
                                    <th className="p-2">Isolato</th>
                                    <th className="p-2">Scala</th>
                                    <th className="p-2">Interno</th>
                                    <th className="p-2">Lett Att</th>
                                    <th className="p-2">Lett Prec</th>
                                    <th className="p-2">Stato</th>
                                    <th className="p-2">Consumo</th>

                                    <th className="p-2">Acq</th>
                                    <th className="p-2">Fog</th>
                                    <th className="p-2">Dep</th>
                                    <th className="p-2">QF</th>
                                    <th className="p-2">Cong.</th>
                                    <th className="p-2">Oneri</th>
                                    <th className="p-2">Oneri <br></br>Pereq.</th>
                                    <th className="p-2">IVA</th>
                                    <th className="p-2">Acconto<br></br>MC/EUR</th>
                                    <th className="p-2">Acconto<br></br>Dep/Fog</th>
                                    <th className="p-2">Storno<br></br>MC/EUR</th>
                                    <th className="p-2">Arr</th>
                                    <th className="p-2 font-semibold">Totale</th>
                                  </tr>
                                </thead>

                                <tbody>
                                  {righe.length === 0 && (
                                    <tr>
                                      <td colSpan={22} className="p-4 text-center text-slate-400">
                                        Nessun dato disponibile
                                      </td>
                                    </tr>
                                  )}


                                  {righe.map((r: any, idx: number) => {
                                    
                                    const rowKey = r.id ?? idx;
                                    const isExpanded = !!expandedRows[rowKey];
                                    const staleReadings =
                                      hasStaleCalculatedReadings(r) ||
                                      hasStaleManualConsumption(r);

                                    const utenzaKey = String(r.utenza?.id ?? "").trim();

                                    const tiers = dettaglioByUtenza[utenzaKey] ?? [];
                                    const minimumPayableApplied = isMinimumPayableApplied(r);
                                    const minimumPayableBreakdown = getMinimumPayableBreakdown(r);
                                    const minimumCreditEuro = Number(r.riga?.minimum_payable_credit_euro || 0);
                                    const minimumCreditMc = Number(r.riga?.minimum_payable_credit_mc || 0);
                                    const recuperoReading = isRecuperoReadingRow(r);
                                    const recuperoNote =
                                      r.riga?.recupero_note ||
                                      "Lettura attuale inferiore alla precedente: consumo portato a recupero";

                                    const uniqueTiers = tiers.filter(
                                      (tier: any, index: number, arr: any[]) =>
                                        index ===
                                        arr.findIndex(
                                          (t) =>
                                            String(t?.label ?? "").trim().toLowerCase() === String(tier?.label ?? "").trim().toLowerCase() &&
                                            Number(t?.ordine ?? -1) === Number(tier?.ordine ?? -1)
                                        )
                                    );
                                    // console.log(uniqueTiers)
                                    return (
                                      <Fragment key={rowKey}>
                                        <tr
                                          onClick={() => toggleRow(rowKey)}
                                          className={`border-t cursor-pointer transition-colors ${
                                            staleReadings
                                              ? "bg-orange-50 hover:bg-orange-100"
                                              : !isRowTotalOk(r)
                                              ? "bg-amber-50 hover:bg-amber-100"
                                              : isExpanded
                                              ? "bg-sky-50"
                                              : idx % 2 === 0
                                                ? "bg-white hover:bg-slate-100"
                                                : "bg-slate-50 hover:bg-slate-100"}`}
                                        >
                                          <td className="sticky left-0 z-20 w-14 min-w-14 bg-inherit p-2 text-right">{r.utenza?.id_user ?? "-"}</td>
                                          <td className="sticky left-14 z-20 min-w-[220px] bg-inherit p-2 text-center shadow-[2px_0_0_0_rgb(226_232_240)]">
                                            {[r.utenza?.Nome, r.utenza?.Cognome].filter(Boolean).join(" ") || "-"}
                                            {staleReadings && (
                                              <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-orange-700">
                                                Da ricalcolare
                                              </div>
                                            )}
                                            {minimumPayableApplied && (
                                              <div
                                                className="mx-auto mt-1 inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700"
                                                title={minimumPayableBreakdown.label}
                                              >
                                                Minimo
                                              </div>
                                            )}
                                            {recuperoReading && (
                                              <div
                                                className="mx-auto mt-1 inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-700"
                                                title={recuperoNote}
                                              >
                                                Recupero
                                              </div>
                                            )}
                                          </td>
                                          <td className="p-2 text-center">{r.utenza?.Isolato ?? ""}</td>
                                          <td className="p-2 text-center">{r.utenza?.Scala ?? ""}</td>
                                          <td className="p-2 text-center">{r.utenza?.Interno ?? ""}</td>
                                          <td className="p-2 text-center">
                                            {getLiveLetturaAttuale(r) ?? "-"}
                                          </td>
                                          <td className="p-2 text-center">
                                            {getLiveLetturaPrecedente(r) ?? "-"}
                                          </td>
                                          <td className="p-2 text-center">
                                            {getLiveStatoAttuale(r)}
                                          </td>
                                          <td className="p-2 text-center">
                                            {isManualConsumptionRow(r) ? (
                                              <div className="flex flex-col items-center gap-1">
                                                <input
                                                  type="number"
                                                  min="0"
                                                  step="0.01"
                                                  value={
                                                    manualConsumptions[getRowUtenzaId(r)] ??
                                                    String(Number(getLiveRowConsumption(r) ?? 0))
                                                  }
                                                  onChange={(e) => updateManualConsumption(r, e.target.value)}
                                                  onBlur={persistManualConsumptions}
                                                  className="h-8 w-20 rounded-lg border border-amber-300 bg-amber-50 px-2 text-center text-xs font-bold text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                                                  title="Consumo manuale definitivo per stato Y"
                                                />
                                                <span className="text-[9px] font-bold uppercase tracking-wide text-amber-700">
                                                  Manuale
                                                </span>
                                              </div>
                                            ) : (
                                              Number(getLiveRowConsumption(r) ?? 0).toFixed(0)
                                            )}
                                          </td>
                                          <td className="p-2 text-center">{r.riga?.imp_acquedotto ?? 0}</td>
                                          <td className="p-2 text-center">{r.riga?.imp_fognatura ?? 0}</td>
                                          <td className="p-2 text-center">{r.riga?.imp_depurazione ?? 0}</td>
                                          <td className="p-2 text-center">{r.riga?.imp_qf ?? 0}</td>
                                          <td className="p-2 text-center">{r.riga?.conguaglio ?? 0}</td>
                                          <td className="p-2 text-center">
                                            {getRowOneri(r).toFixed(2)}
                                          </td>
                                          <td className="p-2 text-center">
                                            {getRowOneriPerequazione(r).toFixed(2)}
                                          </td>
                                          <td className="p-2 text-center">{r.riga?.imp_iva ?? 0}</td>
                                          <td className="p-2 text-center">
                                            {Number(r.riga?.consumo_acconto ?? 0).toFixed(2)}mc
                                            <br />
                                            {Number(r.riga?.imp_acconto ?? 0).toFixed(2)}
                                          </td>
                                          <td className="p-2 text-center">
                                            {Number(r.riga?.depfog_acconto ?? 0).toFixed(2)}
                                          </td>
                                          <td className="p-2 text-center">
                                            {getRowStornoMc(r).toFixed(2)}mc
                                            <br />
                                            <span className="font-bold">{Number(r.riga?.storno_acconto ?? 0).toFixed(2)}</span>
                                            {r.riga?.storno_transition_status && (
                                              <div className="mt-1 space-y-0.5 text-[9px] leading-tight text-slate-500">
                                                <div>TXT rich. {Number(r.riga?.storno_txt_richiesto || 0).toFixed(2)}</div>
                                                {Math.abs(Number(r.riga?.storno_legacy || 0)) > 0.004 && (
                                                  <div>Legacy {Number(r.riga?.storno_legacy || 0).toFixed(2)}</div>
                                                )}
                                                {Math.abs(Number(r.riga?.storno_pregresso || 0)) > 0.004 && (
                                                  <div>Residuo {Number(r.riga?.storno_pregresso || 0).toFixed(2)}</div>
                                                )}
                                                {Number(r.riga?.credito_storno_differito || 0) > 0.004 && (
                                                  <div className="font-semibold text-amber-700">
                                                    Rinviato +{Number(r.riga?.credito_storno_differito || 0).toFixed(2)}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </td>
                                          <td className="p-2 text-center">{r.riga?.imp_arr ?? 0}</td>
                                          <td className="p-2 text-center font-semibold">
                                            {getDisplayedRowTotal(r).toFixed(2)}
                                          </td>
                                        </tr>

                                        {isExpanded && (
                                          <tr className="border-t bg-sky-50">
                                            <td colSpan={22} className="p-4">
                                              <div className="grid grid-cols-1 gap-4 md:grid-cols-1">
                                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                                    Dettaglio Consumi
                                                  </div>

                                                  <div className="space-y-1 text-sm text-slate-700">
                                                    {uniqueTiers.length === 0 ? (
                                                      <div className="text-slate-400">Nessun dettaglio disponibile</div>
                                                    ) : (
                                                      uniqueTiers.map((tier: any, i: number) => {
                                                        const raw = String(tier.label ?? "").trim().toLowerCase();

                                                        const labelMap: Record<string, string> = {
                                                          agev: "Agevolata",
                                                          agevolata: "Agevolata",
                                                          "1a": "Agevolata",
                                                          base: "Base",
                                                          "2a": "Base",
                                                          "3a": "3ª Fascia",
                                                          "4a": "4ª Fascia",
                                                          "5a": "5ª Fascia",
                                                          "3": "3ª Fascia",
                                                          fascia1: "1ª Fascia",
                                                          fascia2: "2ª Fascia",
                                                          fascia3: "3ª Fascia",
                                                          ecc: "Eccedenza",
                                                          eccedenza: "Eccedenza",
                                                          bonus: "Bonus Idrico",
                                                          bonus_idrico: "Bonus Idrico",
                                                        };

                                                        const uiLabel = labelMap[raw] || tier.label || `Scaglione ${tier.ordine ?? i + 1}`;

                                                        return (
                                                          <div
                                                            key={`${utenzaKey}-${tier.ordine ?? "x"}-${raw}-${i}`}
                                                            className="grid grid-cols-3 items-center gap-2 border-b border-slate-100 pb-1"
                                                          >
                                                            <span className="font-medium">{uiLabel}</span>
                                                            <span className="text-center">
                                                              {Number(tier.mc_allocati ?? 0).toFixed(2)} mc
                                                            </span>
                                                            <span className="text-right">
                                                              {Number(tier.importo ?? 0).toFixed(2)} €
                                                            </span>
                                                          </div>
                                                        );
                                                      })
                                                    )}

                                                    <div className="mt-2 border-t pt-2 flex items-center justify-between text-base font-bold text-slate-900">

                                                      <span>Totale Consumo</span>
                                                      <span>{Number(r.riga?.imp_acquedotto ?? 0).toFixed(2)} €</span>
                                                    </div>
                                                    {(Math.abs(Number(r.riga?.storno_acconto || 0)) > 0.004 ||
                                                      minimumCreditEuro > 0 ||
                                                      r.riga?.storno_transition_status) && (
                                                      <div className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-700">
                                                        <div className="mb-2 font-bold uppercase tracking-wide text-slate-500">
                                                          Tracciamento storno
                                                        </div>
                                                        <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 font-semibold text-sky-800">
                                                          {getStornoTransitionLabel(r.riga?.storno_transition_status)}
                                                        </div>
                                                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                                          <span>TXT richiesto: EUR {Number(r.riga?.storno_txt_richiesto || 0).toFixed(2)}</span>
                                                          <span>TXT applicato direttamente: EUR {Number(r.riga?.storno_txt_aggiuntivo || 0).toFixed(2)}</span>
                                                          <span>TXT compensato dal legacy: EUR {Number(r.riga?.storno_txt_compensato_legacy || 0).toFixed(2)}</span>
                                                          <span>
                                                            Acconto legacy applicato
                                                            {r.riga?.storno_legacy_periodo ? ` (${r.riga.storno_legacy_periodo})` : ""}: EUR {Number(r.riga?.storno_legacy || 0).toFixed(2)}
                                                          </span>
                                                          <span>Differenza legacy assorbita: EUR {Number(r.riga?.storno_carenza_assorbita || 0).toFixed(2)}</span>
                                                          <span>Residuo precedente disponibile: EUR {Number(r.riga?.credito_storno_ingresso || 0).toFixed(2)}</span>
                                                          <span>Residuo precedente assorbito: EUR {Number(r.riga?.credito_storno_assorbito || 0).toFixed(2)}</span>
                                                          <span>Nuovo residuo rinviato: EUR {Number(r.riga?.credito_storno_differito || 0).toFixed(2)}</span>
                                                          <span>Totale applicato: EUR {Number(r.riga?.storno_acconto || 0).toFixed(2)}</span>
                                                          <span>Residuo totale disponibile: EUR {Number(r.riga?.credito_storno_residuo || 0).toFixed(2)}</span>
                                                        </div>
                                                      </div>
                                                    )}
                                                    {minimumPayableApplied && (
                                                      <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-800">
                                                        <div className="font-bold uppercase tracking-wide">
                                                          Minimo fatturabile applicato
                                                        </div>
                                                        <div className="mt-1">
                                                          {minimumPayableBreakdown.label}. Il valore puo differire tra utenze quando la quota oneri assegnata non e identica.
                                                        </div>
                                                        {(minimumCreditEuro > 0 || minimumCreditMc > 0) && (
                                                          <div className="mt-1 font-semibold">
                                                            Credito residuo salvato: EUR {minimumCreditEuro.toFixed(2)}
                                                            {minimumCreditMc > 0 ? ` / ${minimumCreditMc.toFixed(2)} mc` : ""}
                                                          </div>
                                                        )}
                                                      </div>
                                                    )}
                                                    {recuperoReading && (
                                                      <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-800">
                                                        <div className="font-bold uppercase tracking-wide">
                                                          Lettura in recupero
                                                        </div>
                                                        <div className="mt-1">
                                                          {recuperoNote}
                                                        </div>
                                                        <div className="mt-1">
                                                          Se lo stato non e S, la lettura attuale viene allineata alla precedente e il consumo base resta 0. Con stato Y resta possibile inserire un consumo manuale.
                                                        </div>
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>

                                                {/* <div className="rounded-lg border border-slate-200 bg-white p-3">
                            
                            </div> */}
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                                <tfoot className="bg-slate-200 font-semibold">
                                  <tr>
                                    <td colSpan={8} className="p-2 text-right">
                                      TOTALE
                                    </td>
                                    <td className="p-2 text-center">{totals.consumo.toFixed(0)}</td>
                                    <td className="p-2 text-center">{totals.acq.toFixed(2)}</td>
                                    <td className="p-2 text-center">{totals.fog.toFixed(2)}</td>
                                    <td className="p-2 text-center">{totals.dep.toFixed(2)}</td>
                                    <td className="p-2 text-center">{totals.qf.toFixed(2)}</td>
                                    <td className="p-2 text-center">{totals.cong.toFixed(2)}</td>
                                    <td className="p-2 text-center">{totaleOneriVisibile.toFixed(2)}</td>
                                    <td className="p-2 text-center">{totaleOneriPereqVisibile.toFixed(2)}</td>
                                    <td className="p-2 text-center">{totals.iva.toFixed(2)}</td>
                                    <td colSpan={2} className="p-2 text-center align-middle">
                                      <div className="mx-auto max-w-[230px] rounded-md border border-slate-300 bg-white/70 px-2 py-1.5 shadow-sm">
                                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                          Tot. acconto
                                        </div>
                                        <div className="text-sm font-extrabold text-slate-900">
                                          {totals.acconto.toFixed(2)}
                                        </div>
                                        <div className="mt-1 grid grid-cols-2 gap-2 border-t border-slate-200 pt-1 text-[11px] leading-tight text-slate-700">
                                          <div>
                                            <div className="font-bold text-slate-900">
                                              {totals.totConsAcc.toFixed(2)}mc
                                            </div>
                                            <div>Acq {totals.accontoAcq.toFixed(2)}</div>
                                          </div>
                                          <div>
                                            <div className="font-bold text-slate-900">
                                              Dep/Fog
                                            </div>
                                            <div>{totals.accontoDepFog.toFixed(2)}</div>
                                          </div>
                                        </div>
                                        <div className="mt-1 border-t border-slate-200 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                          IVA/Oneri {totals.accontoExtra.toFixed(2)}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="p-2 text-center">
                                      {Number(mcStorno || 0).toFixed(2)}mc
                                      <br />
                                      {totals.storno.toFixed(2)}
                                    </td>
                                    <td className="p-2 text-center">{totals.arr.toFixed(2)}</td>
                                    <td
                                      className={`p-2 text-center font-bold ${isGreen ? "text-green-600" : "text-red-600"}`}
                                    >
                                      {totaleInterniVisibile.toFixed(2)}
                                    </td>
                                  </tr>
                                </tfoot>
                          </table>
                      </div>
                     <br></br>                
                    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-base font-bold text-slate-900">
                            Documenti generati salvati
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            Prospetto e bollette complete salvati su archivio permanente.
                          </p>
                        </div>

                        <button
                          onClick={loadGeneratedDocuments}
                          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                          Aggiorna
                        </button>
                      </div>

                      {generatedDocuments.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                          <p className="text-sm font-semibold text-slate-700">
                            Nessun documento salvato.
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Genera un prospetto o le bollette per archiviarli.
                          </p>
                        </div>
                      ) : (
                        <div className="grid gap-3 lg:grid-cols-2">
                          {generatedDocuments.map((doc: any) => {
                            const tipo =
                              doc.document_type === "prospetto"
                                ? "Prospetto"
                                : doc.document_type === "bollette_complete"
                                  ? "Bollette complete"
                                  : doc.document_type;

                            return (
                              <div
                                key={doc.id}
                                className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-slate-800">{tipo}</span>
                                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">
                                      {doc.period_label || "-"}
                                    </span>
                                  </div>
                                  <div className="mt-1 truncate text-sm text-slate-600">
                                    {doc.filename}
                                  </div>
                                </div>
                                <div className="shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => viewGeneratedDocument(doc.id)}
                                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                    >
                                      Visualizza PDF
                                    </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    {/* Legacy per-user PDF list hidden for now. The archive section above
                        shows the latest prospetto and complete bollette for the session. */}
                    {false && (
                    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-base font-bold text-slate-900">
                            Bollette di ripartizione generate
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            Visualizza le bollette per periodo oppure apri un singolo PDF.
                          </p>
                        </div>

                        <button
                          onClick={loadRipartizionePdfs}
                          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                          Aggiorna
                        </button>
                      </div>

                      {Object.entries(pdfPeriods).length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                          <p className="text-sm font-semibold text-slate-700">
                            Nessuna bolletta generata.
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Clicca aggiorna se avevi già generato le bollette
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {Object.entries(pdfPeriods).map(([periodKey, files]) => {
                            const isOpen = openPeriod === periodKey;

                            const filteredFiles = (files as any[]).filter((file: any) => {
                              
                              const q = pdfSearch.toLowerCase().trim();

                              if (!q) return true;
                            
                              return (
                                String(file.Nome || "").toLowerCase().includes(q) ||
                                String(file.Cognome || "").toLowerCase().includes(q) ||
                                String(file.Interno || "").toLowerCase().includes(q) ||
                                String(file.filename || "").toLowerCase().includes(q)
                              );
                            });

                            const totalPdfPages = Math.max(1, Math.ceil(filteredFiles.length / pdfPageSize));

                            const pagedFiles = filteredFiles.slice(
                              (pdfPage - 1) * pdfPageSize,
                              pdfPage * pdfPageSize
                            );
                            return (
                              <div
                                key={periodKey}
                                className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60"
                              >
                                {/* PERIOD HEADER */}
                                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                                  <button
                                    type="button"
                                    onClick={() => setOpenPeriod(isOpen ? null : periodKey)}
                                    className="text-left"
                                  >
                                    <div className="text-sm font-bold text-slate-900">
                                      Periodo {periodKey}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">
                                      {(files as any[]).length} bollette generate
                                    </div>
                                  </button>

                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => viewPeriodPdf(periodKey)}
                                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                                    >
                                      Visualizza PDF completo
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenPeriod(isOpen ? null : periodKey);
                                        setPdfPage(1);
                                      }}
                                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                    >
                                      {isOpen ? "Chiudi" : "Apri"}
                                    </button>
                                  </div>
                                </div>

                                {/* PERIOD BODY */}
                                {isOpen && (
                                  <div className="border-t border-slate-200 bg-white p-4">
                                    <input
                                      value={pdfSearch}
                                      onChange={(e) => {
                                        setPdfSearch(e.target.value);
                                        setPdfPage(1);
                                      }}
                                      placeholder="Cerca per utenza, interno o file..."
                                      className="mb-4 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none transition focus:border-slate-500"
                                    />

                                    <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200 bg-white">
                                      <div className="sticky top-0 grid grid-cols-[minmax(180px,260px)_80px_minmax(240px,420px)_150px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        <div>Utenza</div>
                                        <div>Interno</div>
                                        <div>File</div>
                                        <div className="text-right">Azione</div>
                                      </div>

                                      <div className="divide-y divide-slate-100">
                                        {pagedFiles.map((file: any) => (
                                          <div
                                            key={file.id}
                                            className="grid grid-cols-[minmax(180px,260px)_80px_minmax(240px,420px)_150px] items-center gap-4 px-4 py-3 text-sm transition hover:bg-slate-50"
                                          >
                                            <div className="truncate font-semibold text-slate-800">
                                              {file.Nome} {file.Cognome ? `${file.Cognome}` : ""}
                                            </div>
                                            <div className="font-semibold text-slate-800">
                                              {file.Interno}
                                            </div>
                                            <div className="truncate text-slate-600">
                                              {file.filename}
                                            </div>
                                            <div className="text-right">
                                              <button
                                                type="button"
                                                onClick={() => viewSinglePdf(file.id)}
                                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                              >
                                                Visualizza PDF
                                              </button>
                                            </div>
                                          </div>
                                        ))}

                                        {!filteredFiles.length && (
                                          <div className="px-4 py-8 text-center text-sm text-slate-500">
                                            Nessuna bolletta trovata.
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                      <div className="mt-4 flex items-center justify-between text-sm">
                                      <div className="text-slate-500">
                                        Pagina {pdfPage} di {totalPdfPages} · {filteredFiles.length} bollette
                                      </div>

                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          disabled={pdfPage <= 1}
                                          onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
                                          className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                          Precedente
                                        </button>

                                        <button
                                          type="button"
                                          disabled={pdfPage >= totalPdfPages}
                                          onClick={() => setPdfPage((p) => Math.min(totalPdfPages, p + 1))}
                                          className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                          Successiva
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                    )}
              </div></>
            )}

          {isCreateFatturaModalOpen ? (
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
              onClick={() => {
                if (creatingFattura) return;
                setIsCreateFatturaModalOpen(false);
              }}
            >
              <div
                className="w-full max-w-md overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-sky-50 px-6 py-5">
                  <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                    Creazione fattura
                  </div>

                  <h3 className="mt-4 text-xl font-bold text-slate-900">
                    Seleziona la data della fattura
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Prima di creare la fattura, scegli la data documento da associare.
                  </p>
                </div>

                <div className="space-y-5 px-6 py-6">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      Data fattura
                    </label>
                    <input
                      type="date"
                      value={fatturaDate}
                      onChange={(e) => setFatturaDate(e.target.value)}
                      className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    La data selezionata verrà salvata come data documento della nuova fattura.
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
                  <button
                    onClick={() => setIsCreateFatturaModalOpen(false)}
                    disabled={creatingFattura}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Annulla
                  </button>

                  <button
                    onClick={handleCreateFattura}
                    disabled={creatingFattura}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {creatingFattura ? "Creazione..." : "Conferma e crea"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          </div>
      
        </>
      )}

      <br></br>


  
         <br></br>

      {/* DETAIL SECTION */}


      </div>
      <div className="print-only">
              {pages.map((page, pageIndex) => (
                <div key={pageIndex} className="print-page">
                  {page.map((r:any, idx) => (
                    <InvoicePrintCard
                      key={`${r?.id ?? r?.utenza?.id_user ?? idx}-${pageIndex}`}
                      r={r}
                      logoUrl="/images/idromardi-logo.png"
                      trimestreLabel={ripartizionePeriodLabel}
                      dataLettura={ripartizioneDataLettura}
                    />
                  ))}
                </div>
              ))}
      </div> 
    </div>
    

  );
  
}
 
