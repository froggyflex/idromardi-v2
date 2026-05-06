import { useEffect, useMemo, useState, Fragment } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../api/client";
import { Trash2 } from "lucide-react";
import { Calendar } from "lucide-react";
import { Save } from "lucide-react";
import { parse, set, weeksToDays } from "date-fns";
import { useRef } from "react";
import { ca, se } from "date-fns/locale";
import InvoicePrintCard from "../components/InvoicePrintCard";
 // @ts-ignore
import { summarizePeriodiAndTariffe } from "../../utils/fattureUtils";


type Provider = { id: string; nome: string; codice?: string };
type Periodo = { id: string; period_year: number; period_month: number };
type ImportedInvoiceDocument = {
    id: string;
    original_filename: string;
    numero_bolletta?: string | null;
    codice_fornitura?: string | null;
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


export default function CondominioFatturePage() {

    const importedDocsScrollRef = useRef<HTMLDivElement | null>(null);

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
    const [error, setError] = useState<string | null>(null);
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
   //-------------------------------------------------------

    const canCreate = useMemo(() => {
      return !!condominioId && !!providerId && !!current && !!previous && current !== previous;
    }, [condominioId, providerId, current, previous]);


    const session = detail?.session;
    const contatoreGenerale = detail?.contatoreGenerale ?? {};
    const righe = detail?.righe ?? detail?.grid ?? [];
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

    const [importedDocs, setImportedDocs] = useState<ImportedInvoiceDocument[]>([]);
    const [selectedImportedId, setSelectedImportedId] = useState<string | null>(null);
    const [selectedImportedDoc, setSelectedImportedDoc] = useState<ImportedInvoiceDocument | null>(null);
    const [loadingImportedDocs, setLoadingImportedDocs] = useState(false);
    const [loadingImportedDetail, setLoadingImportedDetail] = useState(false);
    const [creatingImport, setCreatingImport] = useState(false);

    const [importFilename, setImportFilename] = useState("");
    const [importProviderId, setImportProviderId] = useState("");
    const [importFile, setImportFile] = useState<File | null>(null);
    const [uploadingImport, setUploadingImport] = useState(false);
    const [parsingImportId, setParsingImportId] = useState<string | null>(null);
    const [dettaglioByUtenza, setDettaglioByUtenza]  = useState<Record<string, any[]>>({})
    const [importedDocYear, setImportedDocYear] = useState<number | null>(null);
 
    const [exportJob, setExportJob] = useState<any>(null);


    const [pdfPeriods, setPdfPeriods] = useState<Record<string, any[]>>({});
    const [openPeriod, setOpenPeriod] = useState<string | null>(null);
    const [pdfSearch, setPdfSearch] = useState("");

    const [importedSearch, setImportedSearch] = useState("");
    
    const [importedStatusFilter, setImportedStatusFilter] = useState("all");
    const [importedPage, setImportedPage] = useState(1);
    const importedPageSize = 12;

    const filteredImportedDocs = importedDocs.filter((doc: any) => {
      const status = doc.parse_status || "uploaded";

      const search = importedSearch.toLowerCase().trim();

      const matchesSearch =
        !search ||
        String(doc.numero_bolletta || "").toLowerCase().includes(search) ||
        String(doc.original_filename || "").toLowerCase().includes(search) ||
        String(doc.validation_status || "").toLowerCase().includes(search);

      const matchesStatus =
        importedStatusFilter === "all" || status === importedStatusFilter;

      return matchesSearch && matchesStatus;
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

    async function loadRipartizionePdfs() {
      const { data } = await api.get("/fatture/ripartizione-pdfs");
      setPdfPeriods(data.periods || {});
    }

    function viewSinglePdf(id: number) {
      window.open(
        `${api.defaults.baseURL}/fatture/ripartizione-pdfs/${id}/view`,
        "_blank"
      );
    }

    function viewPeriodPdf(periodKey: string) {
      window.open(
        `${api.defaults.baseURL}/fatture/ripartizione-pdfs/period/${periodKey}/view-all`,
        "_blank"
      );
    }

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
  async function parseImportedInvoice(id: string) {
    try {
      setParsingImportId(id);
      setError(null);

      await api.post(`/fatture/imported-documents/${id}/parse`);

      await loadImportedDocuments();
      await loadImportedDocumentDetail(id);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore parsing bolletta");
    } finally {
      setParsingImportId(null);
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
      setImportedDocs(res.data?.items[0] || []);
      console.log("Imported documents loaded:", res.data?.items || []);

    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore caricamento documenti importati");
    } finally {
      setLoadingImportedDocs(false);
    }
  }
function parseItalianDate(value?: string | null): Date | null {
  if (!value) return null;
  const parts = String(value).split("/");
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
      ? parsedSummary.filter(
          (p: any) => String(p?.tipo_lettura ?? "").trim().toLowerCase() === "media"
        )
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
    parsedConsumoFromParsedPayload(parsedSummary);


    console.log("Parsed summary from payload:", parsedSummary);


    const grouped = payload.grouped_letture || {};
    const aGiro = grouped.a_giro;
   

    if (aGiro?.oldest?.lettura_mc != null && aGiro?.newest?.lettura_mc != null) {

      setValPrec(String(aGiro.oldest.lettura_mc));
      setValAtt(String(aGiro.newest.lettura_mc));
      setGiorniConsumi(diffDaysExclusive(aGiro.oldest.data_lettura, aGiro.newest.data_lettura) ?? 0);
      
      
      parseAccontoFromParsedPayload(payloadJson, parsedSummary);
      parseStornoFromParsedPayload(payloadJson);
      parseQFFromParsedPayload(payloadJson);
      setOneriPerequazione(parseOneriPerequazioneFromPayload(payloadJson, parsedSummary, "non_media"));

      setDepFog(getDepFogData(payloadJson, "positive", "non_acconto").totale) //JSON.parse(payloadJson).totale_dep_fog
       

      setParsingAlert?.(null);
      return;
    }

    const availableTypes = Object.keys(grouped);
    const message =
      availableTypes.length > 0
        ? `Nessuna lettura valida di tipo "a_giro" trovata. Tipi disponibili: ${availableTypes.join(", ")}. Seleziona manualmente quali valori usare per Valore Precedente e Valore Attuale.`
        : `Nessuna grouped_letture disponibile nel payload.`;

    alert(message);

    setValPrec(0);
    setValAtt(0);

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
      if(t.tipo_lettura === "a_giro") {
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
function parseAccontoFromParsedPayload(payloadJson?: string | null, parsedSummary?: any) {
  if (!payloadJson) return;

  try {
    const payload = JSON.parse(payloadJson);

    if (!payload?.letture_summary?.ha_acconto) return;

    const isAccontoType = (value: any) =>
      value === "acconto" ||
      value === "acconto_a_giro" ||
      value === "media";

    const accontoPeriod = Array.isArray(payload.periodi_fatturazione)
      ? payload.periodi_fatturazione.find((p: any) => isAccontoType(p?.tipo_lettura))
      : null;

    if (!accontoPeriod) return;

    const dataInizioAcconto = accontoPeriod.data_inizio ?? null;
    const dataFineAcconto = accontoPeriod.data_fine ?? null;

    setGiorniAcconto(diffDaysExclusive(dataInizioAcconto, dataFineAcconto) ?? 0);
    setMcAcconto(Number(accontoPeriod.consumo_mc ?? 0));

    const depFogTotale = Number(
      getDepFogAccontoByOverlap(payload, dataInizioAcconto, dataFineAcconto) ?? 0
    );

    const accontoSummary = Array.isArray(parsedSummary)
      ? parsedSummary.find((t: any) => isAccontoType(t?.tipo_lettura))
      : null;

    const importoPositive = Number(accontoSummary?.totali?.importo_positive ?? 0);

    const ivaAcconto = (importoPositive + depFogTotale + Number(parseOneriPerequazioneFromPayload(payloadJson, parsedSummary, "media"))) * 0.1;
    const totaleAcconto = importoPositive + depFogTotale + ivaAcconto + Number(parseOneriPerequazioneFromPayload(payloadJson, parsedSummary, "media"));
    setOneriPerequazioneAcconto(parseOneriPerequazioneFromPayload(payloadJson, parsedSummary, "media"));
      
    setEurAcconto(importoPositive);
    setIvaAcconto(ivaAcconto);
    setDepfogAcconto(depFogTotale);
    setTotaleAcconto(totaleAcconto);
    
    
  } catch (err) {
    console.error("Errore durante il parsing del payload per l'acconto:", err);
  }
}

  function parseStornoFromParsedPayload(payloadJson?: string | null) {
    if (!payloadJson) return; 
    try {
      const payload = JSON.parse(payloadJson);
      if (payload.summaryTariffeAcquedotto?.quantitaNeg !== 0) {
          setMcStorno(payload.summaryTariffeAcquedotto.quantitaNeg);
          setEurStorno(payload.summaryTariffeAcquedotto.importoNeg);
         
      }
      
    }catch (err) {
      console.error("Errore durante il parsing del payload per l'acconto:", err);
    }
  }    

  function parseQFFromParsedPayload(payloadJson?: string | null) {
    if (!payloadJson) return;
    try {
      const payload = JSON.parse(payloadJson);
      payload.componente_quota_tariffa_acqua.map((c: any) => { 
      if(c.importo > 0) { 
              setGiorniQf(diffDaysExclusive(c.from_date, c.to_date) ?? 0);
              setParsedQF(c.importo);
              
          }
      });
    }catch (err) {
      console.error("Errore durante il parsing del payload per il QF:", err);
    }
  }
    async function loadImportedDocumentDetail(id: string) {
      try {
        setLoadingImportedDetail(true);

        const res = await api.get(`/fatture/imported-documents/${id}`);

        const document = res.data?.document?.[0] || null;

        setSelectedImportedDoc(document);
        setSelectedImportedId(id);

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
      } catch (err: any) {
        setError(err?.response?.data?.error || "Errore caricamento documento importato");
      } finally {
        setLoadingImportedDetail(false);
      }
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
      setImportedDocs(iRes.data?.items || []);
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

  async function loadDetail() {
    if (!condominioId || !fatturaId) {
      setDetail(null);
      return;
    }
    setError(null);
    setLoadingDetail(true);
    try {
      //   backend has /condomini/:condominioId/fatture/:id
      const res = await api.get(`/fatture/condomini/${condominioId}/fatture/${fatturaId}`);

      setDetail(res.data);
       
    } catch (err: any) {
      setDetail(null);
      setError(err?.response?.data?.error || "Errore caricamento fattura");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function refreshSessionsList() {
 
    const res = await api.get(`/fatture/condomini/${condominioId}/fatture/${fatturaId? fatturaId : ""}`);  
    const list = res.data?.sessions ?? res.data; // supports both shapes
    setSessions(Array.isArray(list) ? list : []);
    setDetail(list);
     
  }

  async function handleCreateFattura() {

    
    try {
      setError(null);

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
    const url = `/fatture/${fatturaId}/prospetto.pdf`;
    window.open(api.defaults.baseURL + url, "_blank");
  }


  function daysBetween(d1?: string, d2?: string) {
  if (!d1 || !d2) return 0;

  const date1 = new Date(d1 + "T12:00:00");
  const date2 = new Date(d2 + "T12:00:00");

  const diff = date2.getTime() - date1.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

 

    async function calcola() {
       
      if (!fatturaId) return;

      setLoadingCalc(true);
      setError(null);

      try {
        await saveParams();
  
        const res = await api.post(`/fatture/sessioni/${fatturaId}/calcola`, {
          tfCode,
          annoTariffa: Number(annoTariffa) || null,
          eurStorno: eurStorno? Number(eurStorno) : null,
          parsedQF: parsedQF !== null ? Number(parsedQF) : null,
          totaleParsedWithOneri: totaleDocumentoConOneri? Number(totaleDocumentoConOneri):0
        }); 
        // console.log("Calcolo response:", res.data);
        //await loadDetail();
        await refreshSessionsList();
        setCurrentSession(res.data.session);
        setRigheCalcoli(res.data.righe || []);
        setGenerale(res.data.generale || null);

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
        setError(err?.response?.data?.error || "Errore calcolo: " + (err?.message || "Errore sconosciuto"));
      } finally {
        setLoadingCalc(false);
      }
    }


  async function saveGenerale() {
  if (!fatturaId) return;

  try {
    setSavingGenerale(true);

    await api.put(`/fatture/sessioni/${fatturaId}/contatore-generale`, {
      precedente: valPrec,
      attuale: valAtt,
    });

      await loadDetail();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore salvataggio");
    } finally {
      setSavingGenerale(false);
    }
  }
  async function saveParams() {
    if (!fatturaId) return;

    try {
      setSavingParams(true);

      console.log("Saving params:", { giorniQf, giorniConsumi, giorniAcconto, varie, giorniCasaInterni, mcAcconto, mcStorno });
      if(Number(giorniAcconto) <= 0) {
        setMcAcconto(0);
      }
      await api.put(`/fatture/sessioni/${fatturaId}/parametri`, {
        giorniQF: Number(giorniQf),
        giorniConsumi: Number(giorniConsumi),
        giorniAcconto: Number(giorniAcconto),
        varie: Number(varie),
        giorniCasa: Number(giorniCasaInterni),
        mcAcconto: Number(giorniAcconto) == 0 ? 0 : Number(mcAcconto),
        mcStorno: Number(mcStorno)==0 ? 0 : Number(mcStorno),
        totImpo:Number(session?.tot_acquedotto ?? 0)
      });


      //await loadDetail();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore salvataggio");
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

    setGiorniQf(session.giorni_qf ?? 0);
    setGiorniConsumi(session.giorni_consumi ?? 0);
    setGiorniAcconto(Number(session.giorni_acconto) ?? 0);
    setMcAcconto(Number(session.mcAcconto) ?? 0);
    setGiorniCasaInterni(session.giorni_interni ?? 0);

    setVarie(session.varie ?? 0);
   

  }, [session]);
 
  useEffect(() => {
  if (!session) return;

  setProviderId(session.id_casa_idrica || "");
  setCurrent(session.id_periodo_attuale || "");
  setPrevious(session.id_periodo_precedente || "");
  
    

}, [session]);


const giorniOperatore = daysBetween(
  periodoPrecedente?.data_lettura_operatore,
  periodoAttuale?.data_lettura_operatore
);

const giorniCasaIdrica = daysBetween( 
  periodoPrecedente?.data_lettura_casa_idrica,
  periodoAttuale?.data_lettura_casa_idrica
);
 
const pollRipartizioneJob = (jobId: number) => {
  const interval = window.setInterval(async () => {
    try {
      const { data } = await api.get(`/fatture/export-ripartizione-pdf/jobs/${jobId}`);

      setExportJob(data);

      const total = Number(data.total || 0);
      const processed = Number(data.processed || 0);
      const failed = Number(data.failed || 0);

      if (data.status === "processing") {
        setExportMessage(`Generazione PDF: ${processed}/${total}`);
      }

      if (data.status === "done") {
        window.clearInterval(interval);
        setExportingRipartizioni(false);
        setExportMessage(`PDF generati: ${processed}/${total}. Errori: ${failed}.`);

        // optional: refresh generated PDF list
        await loadRipartizionePdfs?.();
      }

      if (data.status === "error") {
        window.clearInterval(interval);
        setExportingRipartizioni(false);
        setExportMessage(data.error_message || "Errore durante la generazione PDF.");
      }
    } catch (error: any) {
      window.clearInterval(interval);
      setExportingRipartizioni(false);
      setExportMessage(
        error?.response?.data?.error ||
          error?.message ||
          "Errore durante il controllo dello stato del job."
      );
    }
  }, 1500);
};

const logoUrl = `../../images/image.png`;
//  "https://i.postimg.cc/2SDBbptC/idro-logo.jpg"

const handleExportPdf = async () => {
  try {
    setExportingRipartizioni(true);
    setExportMessage("Avvio generazione PDF...");
    setExportJob(null);

    const { data } = await api.post("/fatture/export-ripartizione-pdf/start", {
      righe,
      dettaglioByUtenza,
      trimestreLabel: "07.25 - 01.2025",
      dataLettura: "12/01/2026",
      logoUrl: "https://i.postimg.cc/2SDBbptC/idro-logo.jpg",
      condominioId,
    });

    if (!data.jobId) {
      throw new Error("Job ID non ricevuto dal server.");
    }

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

 
const consumo = Number(valAtt || 0) - Number(valPrec || 0);
const impConsumo = Number(parsedImpCons ?? 0);
const depFogValue = Number(depfog ?? 0);
const quotaFissa = Number(parsedQF ?? session?.tot_qf ?? 0);
const ivaBase = impConsumo + depFogValue + quotaFissa;
const varieValue = Number(varie || 0);



const totals = useMemo(() => {
  const base = righe.reduce(
    (acc: any, r: any) => {
      const row = r.riga || {};

      acc.consumo += Number(row.consumo_totale || 0);
      acc.acq += Number(row.imp_acquedotto || 0);
      acc.fog += Number(row.imp_fognatura || 0);
      acc.dep += Number(row.imp_depurazione || 0);
      acc.qf += Number(row.imp_qf || 0);
      acc.cong += Number(row.conguaglio || 0);
      acc.oneri += Number(row.imp_oneri || 0);
      acc.acconto += Number(row.acconto || 0);
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
      acconto: 0,
      storno: 0,
      totConsAcc: 0,
      iva: 0,
      arr: 0,
      totale: 0,
    }
  );

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

const totaleDocumento = Number(selectedImportedDoc?.importo_totale_da_pagare ?? 0);
const totaleOneri = Number(totals?.oneri ?? 0);

const totaleInterni = Number(totals?.totaleInterni ?? 0);
const totaleDocumentoConOneri = totaleDocumento + totaleOneri;
const deltaTotali = totaleDocumentoConOneri - totaleInterni;

const deltaOk = Math.abs(deltaTotali) < 0.5;
const isGreen:any = totaleDocumentoConOneri? (totaleDocumentoConOneri <= totaleInterni) : false;

return (
    <div className=" ">
      <div className="screen-only">
      {/* SUMMARY */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b shadow-sm">
        <div className="max-w-full px-6 py-4 space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
            <div>
                {/* ERROR */}
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
                    {error}
                  </div>
                )}
              <div className="text-lg font-semibold text-slate-900">Fatturazione | Totale € {Number(selectedDoc || 0).toFixed(2)}</div>

              <div className="text-sm text-slate-500">
            
              </div>

            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">TF</span>
                <select
                  value={tfCode}
                  onChange={(e) => setTfCode(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  disabled={loadingCalc}
                >
                  <option value="TF1">TF1</option>
                  <option value="TF2">TF2</option>
                  <option value="TF3">TF3</option>
                  {/* add more when needed */}
                </select>
              </div>

              <button
                onClick={calcola}
                disabled={loadingCalc}
                className="bg-blue-600 text-white px-5 py-2 rounded-xl hover:bg-blue-700 transition shadow-md disabled:opacity-60"
              >
                {loadingCalc ? "Calcolo..." : "Calcola Contabilità"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Sessioni esistenti
                </div>
            
              </div>

              <div className="shrink-0 rounded-full bg-white border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
                {sessions.length} {sessions.length === 1 ? "sessione" : "sessioni"}
              </div>
            </div>

            {sessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
                Nessuna fattura disponibile.
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1 pr-1">
                {sessions.map((s: any) => (
                  <div
                    key={s.id}
                    className={`group flex-shrink-0 flex items-center gap-2 rounded-full border px-3 py-2 transition ${
                      fatturaId === s.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <button
                      onClick={() =>
                        navigate(`/condomini/${condominioId}/fatture/${s.id}`)
                      }
                      className="flex items-center gap-2 text-left"
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

                      <span className="text-sm font-medium text-slate-800">
                        {String(s.id).slice(0, 8)}...
                      </span>

                      <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                        € {Number(s.grand_total ?? 0).toFixed(2)}
                      </span>
                    </button>

                    {s.stato === "BOZZA" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(s.id);
                        }}
                        className="rounded-full p-1 opacity-60 transition hover:opacity-100 hover:bg-red-50"
                        title="Elimina Bozza"
                      >
                        <Trash2
                          size={14}
                          className="text-red-500 hover:text-red-700 transition"
                        />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div> 
            <br></br>

      {!fatturaId ? (
        <div className="bg-white p-6 rounded-xl shadow">
          <div className="font-semibold">Seleziona una fattura</div>
          {/* <div className="text-sm text-slate-500">
            Crea una nuova fattura oppure aprine una esistente.
          </div>  */}
          <div className="mt-6 border-t pt-5">
          
          <div className="mt-1 text-sm text-slate-500">
            Crea una nuova sessione manuale.
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
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
                    {p.period_month}/{p.period_year}
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
                      {p.period_month}/{p.period_year}
                    </option>
                  ))}
              </select>

              <button
                disabled={!canCreate || loadingCreate}
                onClick={createSession}
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingCreate ? "Creazione..." : "Carica Sessione"}
              </button>
            </div>
          </div>
        </div>
        </div>
      ) : loadingDetail ? (
        <div className="bg-white p-6 rounded-xl shadow">
          Caricamento...
        </div>
      ) : !session ? (
        <div className="bg-white p-6 rounded-xl shadow">
          Sessione non trovata
        </div>
      ) : (
        <>
      
          {/* CONTATORE GENERALE */}
          <div className="bg-white border rounded-2xl p-6 w-full space-y-6">

            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-lg">Imposta Giorni</h3>
            </div>
          {/* ============================= */}
          {/* CONTROLLO CALCOLO + GENERALE */}
          {/* ============================= */}
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
  {/* HEADER */}
  <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
    <div>
      <h3 className="text-xl font-bold tracking-tight text-slate-900">
        Preparazione calcolo
      </h3>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Carica il documento provider, controlla i documenti importati e aggiorna i parametri della sessione.
      </p>
    </div>

    <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
      Configurazione calcolo
    </div>
  </div>

  {/* IMPORT AREA - FULL WIDTH */}
  <div className="border-b border-slate-200 px-6 py-5">
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px_180px] lg:items-end">
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
          File bolletta
        </span>

        <div className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 transition hover:border-slate-400 hover:bg-slate-100">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-800">
              {importFile ? importFile.name : "Seleziona un file PDF"}
            </div>
            <div className="text-xs text-slate-500">
              {importFile ? "Pronto per il caricamento" : "Nessun file selezionato"}
            </div>
          </div>

          <input
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => setImportFile(e.target.files?.[0] || null)}
          />
        </div>
      </label>

      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
          Provider
        </span>

        <select
          className="h-[58px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400"
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
        className="inline-flex h-[58px] items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploadingImport ? "Upload..." : "Carica"}
      </button>
    </div>
  </div>

  {/* MAIN SPLIT */}
  <div className="grid grid-cols-1 gap-6 p-6 xl:grid-cols-2">
    {/* LEFT - DOCUMENTI CARICATI */}
    <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-5 py-4">
        <div>
          <h4 className="text-base font-bold text-slate-900">
            Documenti caricati
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Parsing e importazione dei documenti provider.
          </p>
        </div>

        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
          {filteredImportedDocs.length} / {importedDocs.length}
        </span>
      </div>

      <div className="border-b border-slate-200 p-4">
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
            <option value="uploaded">Uploaded</option>
            <option value="parsed">Parsed</option>
            <option value="imported">Imported</option>
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
          <div className="max-h-[420px] overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    Documento
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    Parsing
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
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

                    const statusClass =
                      status === "imported"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
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
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => loadImportedDocumentDetail(doc.id)}
                            className="max-w-[260px] truncate text-left font-bold text-slate-900 hover:text-blue-700"
                          >
                            {doc.numero_bolletta || doc.original_filename || "Documento"}
                          </button>

                          <div className="mt-1 max-w-[260px] truncate text-xs text-slate-500">
                            {doc.original_filename || "-"}
                          </div>

                          <div className="mt-1 text-xs font-semibold text-slate-700">
                            € {Number(doc.importo_totale_da_pagare || 0).toFixed(2)}
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${statusClass}`}
                          >
                            {status}
                          </span>
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {status !== "parsed" && status !== "imported" && (
                              <button
                                type="button"
                                onClick={() => parseImportedInvoice(doc.id)}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                              >
                                Parsing
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => loadImportedDocumentDetail(doc.id)}
                              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
                            >
                              Carica
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

          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-4 py-3">
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
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="border-b border-slate-200 pb-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Parametri di calcolo
        </div>
        <h4 className="mt-1 text-base font-semibold text-slate-900">
          Impostazioni operative
        </h4>
        <p className="mt-1 text-sm text-slate-500">
          Definisci anno tariffa e giorni usati nel calcolo.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col sm:col-span-2">
          <label className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Anno tariffa
          </label>
          <select
            className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
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
            className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
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
            className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
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
            className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
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
            className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
            value={giorniAcconto}
            onChange={(e) => setGiorniAcconto(e.target.value)}
          />
        </div>
      </div>
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
                <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4 sm:px-6">
                    <h4 className="text-sm font-semibold text-slate-900">Valori principali</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Componenti essenziali della lettura a giro da confrontare con il documento importato.
                    </p>
                  </div>

                  <div className="p-5 sm:p-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-5">
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
                          Quota fissa
                        </div>
                        <div className="mt-2 text-2xl font-bold text-slate-900">
                          € {Number(quotaFissa ?? 0).toFixed(2)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          Ripartizione quota fissa
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
                          € {Number((totaleDocumento ?? 0) - (Number(totaleAcconto) || 0)).toFixed(2)}
                        </div>
                        <div className="mt-1 text-xs text-emerald-700/80">
                          Totale documento al netto dell’acconto
                        </div>
                      </article>
                    </div>
                  </div>
                </section>

                {/* ACCONTO */}
                {mcAcconto > 0 && (
                  <section className="overflow-hidden rounded-[28px] border border-amber-200 bg-white shadow-sm">
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

                        {/* <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Importo acconto
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
                            IVA acconto
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(ivaAcconto ?? 0).toFixed(2)}
                          </div>
                        </article> */}

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
                {Number(mcStorno ?? 0) !== 0 && (
                  <section className="overflow-hidden rounded-[28px] border border-rose-200 bg-white shadow-sm">
                    <div className="border-b border-rose-100 bg-gradient-to-r from-rose-50 to-white px-5 py-4 sm:px-6">
                      <h4 className="text-sm font-semibold text-slate-900">Storno rilevato</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Rettifica collegata ai consumi o agli importi già anticipati.
                      </p>
                    </div>

                    <div className="p-5 sm:p-6">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <article className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-700">
                            Consumo storno
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            {Number(mcStorno ?? 0).toFixed(2)} mc
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Importo storno
                          </div>
                          <div className="mt-2 text-xl font-bold text-slate-900">
                            € {Number(eurStorno ?? 0).toFixed(2)}
                          </div>
                        </article>
                      </div>
                    </div>
                  </section>
                )}
              </div>

              {/* RIGHT */}
              <aside className="xl:col-span-4">
                <div className="sticky top-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
                    <h4 className="text-sm font-semibold text-slate-900">Confronto totali</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Verifica tra importo documento e totale ripartito internamente.
                    </p>
                  </div>

                  <div className="space-y-4 p-5">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                        Totale documento ABC
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
                        Totale ente + oneri
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
                          ? "I totali risultano allineati."
                          : "Scostamento presente tra documento e ripartizione interna."}
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
                <div className="flex flex-wrap items-center gap-3">
                  {/* Export / Print */}
                  <button
                    onClick={handleExportPdf}
                    disabled={exportingRipartizioni}
                    className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold shadow-sm transition
                      ${
                        exportingRipartizioni
                          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                          : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                      }`}
                  >
                    {exportingRipartizioni ? (
                      <>
                        <svg
                          className="h-4 w-4 animate-spin"
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
                            d="M4 12a8 8 0 018-8v8H4z"
                          />
                        </svg>
                        Generazione...
                      </>
                    ) : (
                      <>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 9V2h12v7M6 18h12v4H6z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 14h12"
                          />
                        </svg>
                        Genera bollette
                      </>
                    )}
                  </button>

                  {/* Create Fattura */}
                  <button
                    onClick={() => {
                      setFatturaDate(new Date().toISOString().slice(0, 10));
                      setIsCreateFatturaModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    Registra fattura
                  </button>
                </div>

                  {exportingRipartizioni && exportJob && (
                    <div className="mt-3 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
                        <span>{exportMessage}</span>
                        <span>
                          {exportJob.processed || 0}/{exportJob.total || 0}
                        </span>
                      </div>

                      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
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
        onClick={saveGenerale}
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
                    <h3 className="font-semibold mb-4">Situazione Contatori Interni </h3>
                      <div className="overflow-x-auto">
                          <table className="w-full text-xs border border-slate-200">
                                <thead className="bg-slate-100 sticky top-0 z-20 uppercase shadow-sm">
                                  <tr>
                                    <th className="p-2">ID</th>
                                    <th className="p-2">Utente</th>
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
                                    <th className="p-2">Storno<br></br>EUR</th>
                                    <th className="p-2">Arr</th>
                                    <th className="p-2 font-semibold">Totale</th>
                                  </tr>
                                </thead>

                                <tbody>
                                  {righe.length === 0 && (
                                    <tr>
                                      <td colSpan={21} className="p-4 text-center text-slate-400">
                                        Nessun dato disponibile
                                      </td>
                                    </tr>
                                  )}


                                  {righe.map((r: any, idx: number) => {
                                    
                                    const rowKey = r.id ?? idx;
                                    const isExpanded = !!expandedRows[rowKey];

                                    const utenzaKey = String(r.utenza?.id ?? "").trim();

                                    const tiers = dettaglioByUtenza[utenzaKey] ?? [];

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
                                          className={`border-t cursor-pointer transition-colors ${isExpanded
                                              ? "bg-sky-50"
                                              : idx % 2 === 0
                                                ? "bg-white hover:bg-slate-100"
                                                : "bg-slate-50 hover:bg-slate-100"}`}
                                        >
                                          <td className="p-2 text-right">{r.utenza?.id_user ?? "-"}</td>
                                          <td className="p-2 text-center">
                                            {[r.utenza?.Nome, r.utenza?.Cognome].filter(Boolean).join(" ") || "-"}
                                          </td>
                                          <td className="p-2 text-center">{r.utenza?.Isolato ?? ""}</td>
                                          <td className="p-2 text-center">{r.utenza?.Scala ?? ""}</td>
                                          <td className="p-2 text-center">{r.utenza?.Interno ?? ""}</td>
                                          <td className="p-2 text-center">
                                            {r.riga?.lettura_attuale ?? r.attuale?.valore_lettura ?? "-"}
                                          </td>
                                          <td className="p-2 text-center">
                                            {r.riga?.lettura_precedente ?? r.precedente?.valore_lettura ?? "-"}
                                          </td>
                                          <td className="p-2 text-center">
                                            {r.riga?.stato_attuale ?? r.attuale?.stato_lettura ?? "-"}
                                          </td>
                                          <td className="p-2 text-center">
                                            {Number(r.riga?.consumo_totale ?? 0).toFixed(0)}
                                          </td>
                                          <td className="p-2 text-center">{r.riga?.imp_acquedotto ?? 0}</td>
                                          <td className="p-2 text-center">{r.riga?.imp_fognatura ?? 0}</td>
                                          <td className="p-2 text-center">{r.riga?.imp_depurazione ?? 0}</td>
                                          <td className="p-2 text-center">{r.riga?.imp_qf ?? 0}</td>
                                          <td className="p-2 text-center">{r.riga?.conguaglio ?? 0}</td>
                                          <td className="p-2 text-center">{r.riga?.imp_oneri ?? 0}</td>
                                          <td className="p-2 text-center">0</td>
                                          <td className="p-2 text-center">{r.riga?.imp_iva ?? 0}</td>
                                          <td className="p-2 text-center">
                                            {Number(r.riga?.consumo_acconto ?? 0).toFixed(2)}mc
                                            <br />
                                            {Number(r.riga?.imp_acconto ?? 0).toFixed(2)}
                                          </td>
                                          <td className="p-2 text-center">
                                            {Number(r.riga?.storno_acconto ?? 0).toFixed(2)}
                                          </td>
                                          <td className="p-2 text-center">{r.riga?.imp_arr ?? 0}</td>
                                          <td className="p-2 text-center font-semibold">{r.riga?.totale ?? 0}</td>
                                        </tr>

                                        {isExpanded && (
                                          <tr className="border-t bg-sky-50">
                                            <td colSpan={21} className="p-4">
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
                                    <td className="p-2 text-center">{totals.oneri.toFixed(2)}</td>
                                    <td className="p-2 text-center">0.00</td>
                                    <td className="p-2 text-center">{totals.iva.toFixed(2)}</td>
                                    <td className="p-2 text-center">
                                      {totals.totConsAcc.toFixed(2)}mc
                                      <br />
                                      {totals.acconto.toFixed(2)}
                                    </td>
                                    <td className="p-2 text-center">{totals.storno.toFixed(2)}</td>
                                    <td className="p-2 text-center">{totals.arr.toFixed(2)}</td>
                                    <td
                                      className={`p-2 text-center font-bold ${isGreen ? "text-green-600" : "text-red-600"}`}
                                    >
                                      {totals.totaleInterni.toFixed(2)}
                                    </td>
                                  </tr>
                                </tfoot>
                          </table>
                      </div>
                     <br></br>                
                    {/* GENERATED PDFS */}
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
                                String(file.filename || "").toLowerCase().includes(q) ||
                                String(file.data_lettura || "").toLowerCase().includes(q)
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
                                      placeholder="Cerca per ID utenza, file o data..."
                                      className="mb-4 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none transition focus:border-slate-500"
                                    />

                                    <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200">
                                      <table className="w-full text-sm">
                                        <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                          <tr>
                                            <th className="px-4 py-3 text-left">Utenza</th>
                                            <th className="px-4 py-3 text-left">Interno</th>
                                            <th className="px-4 py-3 text-left">File</th>
                                            <th className="px-4 py-3 text-left">Data lettura</th>
                                            <th className="px-4 py-3 text-right">Azione</th>
                                          </tr>
                                        </thead>

                                        <tbody>
                                          
                                          {pagedFiles.map((file: any) => (
                                            <tr
                                              key={file.id}
                                              className="border-t border-slate-100 transition hover:bg-slate-50"
                                            >
                                              <td className="px-4 py-3 font-semibold text-slate-800">
                                                {file.Nome} {file.Cognome ? `${file.Cognome}` : ""}
                                              </td>
                                              <td className="px-4 py-3 font-semibold text-slate-800">
                                                {file.Interno}
                                              </td>
                                              <td className="px-4 py-3 text-slate-600">
                                                {file.filename}
                                              </td>

                                              <td className="px-4 py-3 text-slate-600">
                                                {file.data_lettura || "-"}
                                              </td>

                                              <td className="px-4 py-3 text-right">
                                                <button
                                                  type="button"
                                                  onClick={() => viewSinglePdf(file.id)}
                                                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                                >
                                                  Visualizza PDF
                                                </button>
                                              </td>
                                            </tr>
                                          ))}

                                          {!filteredFiles.length && (
                                            <tr>
                                              <td
                                                colSpan={4}
                                                className="px-4 py-8 text-center text-sm text-slate-500"
                                              >
                                                Nessuna bolletta trovata.
                                              </td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>


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
                      trimestreLabel={`1`}
                      dataLettura={`1`}
                    />
                  ))}
                </div>
              ))}
      </div> 
    </div>
    

  );
  
}
 

