import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../api/client";
import { Trash2 } from "lucide-react";
import { Calendar } from "lucide-react";
import { Save } from "lucide-react";
import { set, weeksToDays } from "date-fns";

type Provider = { id: string; nome: string; codice?: string };
type Periodo = { id: string; period_year: number; period_month: number };
type Session = any;
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

type LettureResolution =
  | {
      ok: true;
      valPrec: string;
      valAtt: string;
      warning?: string;
      grouped: Record<string, { oldest: LetturaItem; newest: LetturaItem; items: LetturaItem[] }>;
    }
  | {
      ok: false;
      reason: "missing_a_giro" | "invalid_a_giro_values" | "no_letture";
      message: string;
      availableTypes: string[];
      grouped: Record<string, { oldest: LetturaItem; newest: LetturaItem; items: LetturaItem[] }>;
    };
export default function CondominioFatturePage() {
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
    const [mcAcconto, setMcAcconto] = useState<number>(0);
    const [selectedDoc, setSelectedDoc] = useState<number | null>(null);

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
    const [varie, setVarie] = useState<number | string>(0);
    const [giorniCasaInterni, setGiorniCasaInterni] = useState<number | string>(0);
    const [dataQfFrom, setDataQfFrom] = useState("");
    const [dataQfTo, setDataQfTo] = useState("");
    const [dataConsFrom, setDataConsFrom] = useState("");
    const [dataConsTo, setDataConsTo] = useState("");
    const [savingParams, setSavingParams] = useState(false);


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
      console.log("Imported documents loaded:", res.data?.items[0] || []);
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
function assignStateFromParsedPayload(payloadJson?: string | null) {
  if (!payloadJson) return;

  try {
    const payload = JSON.parse(payloadJson);

    setDataQfFrom(payload.data_inizio_periodo || "");
    setDataQfTo(payload.data_fine_periodo || "");
    setDataConsFrom(payload.data_inizio_periodo || "");
    setDataConsTo(payload.data_fine_periodo || "");

    const grouped = payload.grouped_letture || {};
    const aGiro = grouped.a_giro;

    if (aGiro?.oldest?.lettura_mc != null && aGiro?.newest?.lettura_mc != null) {

      setValPrec(String(aGiro.oldest.lettura_mc));
      setValAtt(String(aGiro.newest.lettura_mc));
      setGiorniQf(diffDaysInclusive(aGiro.oldest.data_lettura, aGiro.newest.data_lettura) ?? 0);
      setGiorniConsumi(diffDaysExclusive(aGiro.oldest.data_lettura, aGiro.newest.data_lettura) ?? 0);

      

      if (payload.letture_summary?.ha_acconto) {
        console.warn(
          `Acconto rilevato: tipo ${payload.letture_summary?.tipo_lettura_acconto}, ` +
          `valore ${payload.letture_summary?.valore_acconto}, ` +
          `consumo ${payload.letture_summary?.consumo_acconto}`
        );
         payload.periodi_fatturazione.map((p: any) => {
          if (p.tipo_lettura === "acconto" || p.tipo_lettura === "acconto_a_giro" || p.tipo_lettura === "media") {
            setGiorniAcconto(diffDaysExclusive(p.data_inizio , p.data_fine ) ?? 0);
            setMcAcconto(p.consumo_mc ?? 0);
          }
         });
      }

      setParsingAlert?.(null);
      return;
    }

    const availableTypes = Object.keys(grouped);
    const message =
      availableTypes.length > 0
        ? `Nessuna lettura valida di tipo "a_giro" trovata. Tipi disponibili: ${availableTypes.join(", ")}. Seleziona manualmente quali valori usare per Valore Precedente e Valore Attuale.`
        : `Nessuna grouped_letture disponibile nel payload.`;

    console.warn(message);

    setValPrec("");
    setValAtt("");

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
  async function loadImportedDocumentDetail(id: string) {
    try {
      setLoadingImportedDetail(true);
      const res = await api.get(`/fatture/imported-documents/${id}`);
      setSelectedImportedDoc(res.data?.document[0] || null);
      setSelectedImportedId(id);

      const payload =
                 typeof selectedImportedDoc?.parsed_payload_json === "string"
                  ? JSON.parse(selectedImportedDoc.parsed_payload_json)
                  : selectedImportedDoc?.parsed_payload_json;

      setSelectedDoc(res.data?.document[0].importo_totale_da_pagare);
      
      assignStateFromParsedPayload(res.data?.document[0]?.parsed_payload_json);
      console.log("Imported document detail loaded:", selectedImportedDoc || null);

      
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore caricamento documento importato");
    } finally {
      setLoadingImportedDetail(false);
    }
  }

  async function createImportedDocument() {
    if (!condominioId || !importFilename) return;

    try {
      setCreatingImport(true);
      setError(null);

      const res = await api.post("/fatture/imported-documents", {
        condominioId,
        providerId: importProviderId || null,
        originalFilename: importFilename,
        storedFilename: null,
        mimeType: "application/pdf",
        fileSizeBytes: null,
        fileHash: null,
      });

      const newId = res.data?.document?.id;
      await loadImportedDocuments();

      if (newId) {
        await loadImportedDocumentDetail(newId);
      }

      setImportFilename("");
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore creazione documento importato");
    } finally {
      setCreatingImport(false);
    }
  }

    async function linkImportedToCurrentSession(importedId: string, sessionId: string) {

      console.log("Linking imported document to session:", { importedId, sessionId });

      
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
      await refreshSessionsList();

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
      console.log("Fattura detail loaded:", res.data);
    } catch (err: any) {
      setDetail(null);
      setError(err?.response?.data?.error || "Errore caricamento fattura");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function refreshSessionsList() {
    const res = await api.get(`/fatture/condomini/${condominioId}/fatture/${fatturaId}`);  
    const list = res.data?.sessions ?? res.data; // supports both shapes
    setSessions(Array.isArray(list) ? list : []);
    setDetail(list);
    console.log("Calcolo sessione result:", list);

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

      await refreshSessionsList();
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
        });
 
        //await loadDetail();
        await refreshSessionsList();
        setCurrentSession(res.data.session);
        setRigheCalcoli(res.data.righe || []);
        setGenerale(res.data.generale || null);


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

      console.log("Saving params:", { giorniQf, giorniConsumi, giorniAcconto, varie, giorniCasaInterni, mcAcconto });
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
    console.log("Session data changed, updating giorni parameters:", session);
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
    Number(session?.tot_iva || 0);

  const oneriGenerale = Number(session?.tot_oneri || 0);

  const generalePlusOneri = Number(
    (generalWithoutOneri + oneriGenerale).toFixed(2)
  );

  const isGreen = generalePlusOneri <= totaleInterni;

  return {
    ...base,
    totaleInterni,
    generalePlusOneri,
    isGreen,
  };
}, [righe, session]);

 


  return (
<div className="w-full px-6 py-6 space-y-6">



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
</div><abbr title=""></abbr>

  {/* TOP BAR */}
<div className="space-y-6">
   
  <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
    <div className="xl:col-span-5">
      <div className="bg-white rounded-2xl shadow p-5 h-full">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              Importa Bolletta
            </div>
            <div className="mt-1 text-sm text-slate-500 leading-relaxed">
              Carica un documento e preparalo per il parsing.
            </div>
          </div>

          <div className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            Upload
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">
              File bolletta
            </label>

            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-4 transition hover:border-slate-400">
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.json"
                className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              />
              <div className="mt-2 text-xs text-slate-500">
                Formati supportati: PDF, immagini e JSON.
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">
              Provider
            </label>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-400"
              value={importProviderId}
              onChange={(e) => setImportProviderId(e.target.value)}
            >
              <option value="">Provider opzionale</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl bg-white border border-slate-200 px-3 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Stato
              </div>
              <div className="mt-1 text-sm font-medium text-slate-800">
                {uploadingImport
                  ? "Upload in corso..."
                  : importFile
                  ? "Pronto al caricamento"
                  : "Nessun file selezionato"}
              </div>
            </div>

            <div className="rounded-xl bg-white border border-slate-200 px-3 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                File selezionato
              </div>
              <div className="mt-1 text-sm font-medium text-slate-800 truncate">
                {importFile ? importFile.name : "-"}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4 border-t pt-4">
          <div className="text-xs text-slate-500 leading-relaxed max-w-[220px]">
            Dopo il caricamento, il documento apparirà nella lista importata.
          </div>

          <button
            onClick={uploadImportedInvoice}
            disabled={!importFile || uploadingImport}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploadingImport ? "Upload..." : "Carica documento"}
          </button>
        </div>
      </div>
    </div>

    <div className="xl:col-span-7">
      <div className="bg-white rounded-2xl shadow p-5 h-full">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              Documenti Importati
            </div>
            <div className="mt-1 text-sm text-slate-500">
              Seleziona un documento per lavorarci nel workspace.
            </div>
          </div>

          <div className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {importedDocs.length} {importedDocs.length === 1 ? "documento" : "documenti"}
          </div>
        </div>

        {loadingImportedDocs ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500 text-center">
            Caricamento documenti...
          </div>
        ) : importedDocs.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500 text-center">
            Nessun documento importato.
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[420px] overflow-y-auto pr-1">
            {importedDocs.map((doc: any) => (
              <div
                key={doc.id}
                className={`rounded-2xl border p-4 transition cursor-pointer ${
                  selectedImportedDoc?.id === doc.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
                onClick={() => loadImportedDocumentDetail(doc.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {doc.numero_bolletta || doc.original_filename || "Documento"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 truncate">
                      {doc.original_filename || "-"}
                    </div>
                  </div>

                  <div className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                    {doc.parse_status || "uploaded"}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">
                      Totale
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      € {Number(doc.importo_totale_da_pagare || 0).toFixed(2)}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">
                      Validazione
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {doc.validation_status || "pending"}
                    </div>
                  </div>
                </div>

                {doc.parse_status !== "parsed" && doc.parse_status !== "imported" && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        parseImportedInvoice(doc.id);
                      }}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Esegui parsing
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>

  <div className="bg-white rounded-2xl shadow p-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-lg font-semibold text-slate-900">
          Anteprima Documento Importato
        </div>
        <div className="mt-1 text-sm text-slate-500 leading-relaxed">
          Lavora sul documento selezionato o crea una sessione manuale.
        </div>
      </div>

      <div className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
        Operazioni
      </div>
    </div>

    {selectedImportedDoc ? (
      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
             
            <div className="mt-1 text-sm text-slate-500">
              Controlla i dati estratti prima di collegare il documento a una sessione.
            </div>
          </div>

          <div className="rounded-full bg-white border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
            {selectedImportedDoc.validation_status || "pending"}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Numero Bolletta
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900 break-words">
              {selectedImportedDoc.numero_bolletta || "-"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Codice Fornitura
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900 break-words">
              {selectedImportedDoc.codice_fornitura || "-"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Totale Documento
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              € {Number(selectedImportedDoc.importo_totale_da_pagare || 0).toFixed(2)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Consumo
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {selectedImportedDoc.consumo_globale_mc ?? "-"} mc
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Stato Parsing
            </div>
            <div className="mt-1 text-sm font-medium text-slate-800">
              {selectedImportedDoc.parse_status || "-"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Documento
            </div>
            <div className="mt-1 text-sm font-medium text-slate-800 truncate">
              {selectedImportedDoc.original_filename || "-"}
            </div>
          </div>
        </div>

        {fatturaId && (
          <div className="mt-5 flex justify-end border-t pt-4">
            <button
              onClick={() => linkImportedToCurrentSession(selectedImportedDoc.id, fatturaId)}
              className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              Collega alla sessione aperta
            </button>
          </div>
        )}
      </div>
    ) : (
      <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500 text-center">
        Seleziona un documento importato per vedere l’anteprima.
      </div>
    )}

  
  </div>
</div>

  {/* SESSION CONTROL BAR */}
  {/* <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-6"> */}

    {/* <div className="grid grid-cols-12 gap-8"> */}

      {/* CREATE */}
      {/* <div className="col-span-12 lg:col-span-5 space-y-4">
        <div className="font-semibold">Crea Fattura</div>



        <div className="flex flex-wrap gap-3">
          <select
            className="border rounded px-3 py-2 w-48"
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
            className="border rounded px-3 py-2 w-40"
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
            className="border rounded px-3 py-2 w-40"
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
            className="bg-blue-600 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {loadingCreate ? "Creazione..." : "Crea"}
          </button>
        </div>
      </div> */}

      {/* EXISTING */}
      {/* <div className="col-span-12 lg:col-span-7 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Fatture Esistenti</div>
          <button
            onClick={refreshSessionsList}
            className="text-sm px-3 py-1 rounded border bg-white hover:bg-slate-50"
          >
            Aggiorna
          </button>
        </div>

        {sessions.length === 0 ? (
          <div className="text-sm text-slate-500">
            Nessuna fattura.
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto">
            {sessions.map((s: any) => (
             <div
              key={s.id}
              className={`relative min-w-[220px] p-3 rounded-xl border text-left ${
                fatturaId === s.id
                  ? "border-blue-500 bg-blue-50"
                  : "bg-white hover:bg-slate-50"
              }`}
            >
              <button
                onClick={() =>
                  navigate(`/condomini/${condominioId}/fatture/${s.id}`)
                }
                className="w-full text-left"
              >
                <div className="text-xs uppercase font-medium">
                  {s.stato}
                </div>
                <div className="text-sm break-all">
                  {s.id.slice(0, 8)}...
                </div>
                <div className="text-sm font-semibold">
                  € {s.grand_total ?? 0}
                </div>
              </button>

              {s.stato === "BOZZA" && (
              <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(s.id);
                    }}
                    className="absolute top-2 right-2 opacity-60 hover:opacity-100 transition"
                    title="Elimina Bozza"
                  >
                    <Trash2
                      size={16}
                      className="text-red-500 hover:text-red-700 transition"
                    />
                  </button>
              )}
            </div>

            ))}
          </div>
        )}
      </div> */}

    {/* </div> */}
  {/* </div> */}

  {/* DETAIL SECTION */}
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
<div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm">
  <div className="mb-4">
    <h3 className="text-[15px] font-semibold text-slate-900">
      Parametri Calcolo e Contatore Generale
    </h3>
    <p className="mt-1 text-sm text-slate-500">
      Imposta i parametri di calcolo e aggiorna il contatore generale.
    </p>
  </div>

  <div className="overflow-x-auto">
    <div className="flex min-w-max items-end gap-5">

      {/* BLOCCO PRINCIPALE - CONTATORE GENERALE */}
      <div className="rounded-2xl border border-slate-300 bg-gradient-to-br from-slate-50 to-white px-4 py-3 shadow-sm ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Contatore Generale
            </div>
            <div className="mt-0.5 text-sm text-slate-600">
              Valori principali da aggiornare
            </div>
          </div>

          <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
            Consumo: {Math.max(0, Number(valAtt || 0) - Number(valPrec || 0))}
          </div>
        </div>

        <div className="flex items-end gap-4">
          <div className="flex flex-col">
            <label className="mb-1.5 text-xs font-semibold tracking-wide text-slate-700">
              Lettura Attuale
            </label>
            <input
              type="number"
              className="h-11 w-[132px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 shadow-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              value={valAtt}
              onChange={(e) => setValAtt(e.target.value)}
            />
          </div>

          <div className="flex flex-col">
            <label className="mb-1.5 text-xs font-semibold tracking-wide text-slate-700">
              Lettura Precedente
            </label>
            <input
              type="number"
              className="h-11 w-[132px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 shadow-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              value={valPrec}
              onChange={(e) => setValPrec(e.target.value)}
            />
          </div>

          <div className="flex flex-col">
            <label className="mb-1.5 text-xs font-semibold text-transparent select-none">
              Azione
            </label>
            <button
              onClick={saveGenerale}
              disabled={savingGenerale}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:-translate-y-[1px] hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={16} />
              {savingGenerale ? "Salvando..." : "Salva Generale"}
            </button>
          </div>
        </div>
      </div>


      {/* DIVIDER */}
      <div className="h-14 w-px self-center bg-slate-200" />

      {/* PARAMETRI SECONDARI */}
      <div className="flex items-end gap-5">
        <div className="flex flex-col">
          <label className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Giorni QF
          </label>
          <input
            type="number"
            className="h-10 w-[88px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all duration-200 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
            value={giorniQf}
            onChange={(e) => setGiorniQf(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Giorni Consumi
          </label>
          <input
            type="number"
            className="h-10 w-[88px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all duration-200 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
            value={giorniConsumi}
            onChange={(e) => setGiorniConsumi(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Giorni Interni
          </label>
          <input
            type="number"
            className="h-10 w-[88px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all duration-200 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
            value={giorniCasaInterni}
            onChange={(e) => setGiorniCasaInterni(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Giorni Acconto
          </label>
          <input
            type="number"
            className="h-10 w-[88px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all duration-200 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
            value={giorniAcconto}
            onChange={(e) => setGiorniAcconto(e.target.value)}
          />
        </div>

        {Number(giorniAcconto) > 0 && (
          <>
            <div className="h-10 w-px self-end bg-slate-200" />

            <div className="flex flex-col">
              <label className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                MC Acconto
              </label>
              <input
                type="number"
                className="h-10 w-[96px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all duration-200 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
                value={mcAcconto}
                onChange={(e) => setMcAcconto(Number(e.target.value))}
              />
            </div>
 
          </>
        )}
      </div>
    </div>
  </div>
</div>
{/* CALCULATION BREAKDOWN */}
<div className="bg-slate-50 rounded-2xl p-6 space-y-6 border border-slate-200">
  <div className="flex items-center justify-between gap-4">
    <div>
      <div className="text-lg font-semibold text-slate-800">
        Dettaglio Calcolo
      </div>
      <div className="text-sm text-slate-500">
        Riepilogo valori di calcolo e confronto con il totale documento.
      </div>
    </div>
  </div>

  <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
    {/* LEFT SIDE */}
    <div className="xl:col-span-9 space-y-6">
      {/* PRIMARY VALUES */}
      <div>
        <div className="text-sm font-semibold text-slate-700 mb-3">
          Valori principali
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
            <div className="text-xs text-slate-500 uppercase tracking-wide">
              Consumo
            </div>
            <div className="text-2xl font-bold text-slate-800 mt-1">
              {Number(valAtt || 0) - Number(valPrec || 0)}
            </div>
            <div className="text-xs text-slate-400 mt-1">mc</div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
            <div className="text-xs text-slate-500 uppercase tracking-wide">
              Imp. Cons.
            </div>
            <div className="text-lg font-semibold text-slate-800 mt-2">
              € {Number(session?.tot_acquedotto ?? 0).toFixed(2)}  
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
            <div className="text-xs text-slate-500 uppercase tracking-wide">
              Dep.
            </div>
            <div className="text-lg font-semibold text-slate-800 mt-2">
              € {(Number(session?.tot_fognatura ?? 0) + Number(session?.tot_depurazione ?? 0)).toFixed(2)}
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
            <div className="text-xs text-slate-500 uppercase tracking-wide">
              Q.F
            </div>
            <div className="text-lg font-semibold text-slate-800 mt-2">
              € {Number(session?.tot_qf ?? 0).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* SECONDARY VALUES */}
      <div>
        <div className="text-sm font-semibold text-slate-700 mb-3">
          Valori secondari
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
            <div className="text-xs text-slate-500 uppercase tracking-wide">
              IVA
            </div>
            <div className="text-lg font-semibold text-slate-800 mt-2">
              € {Number(session?.tot_iva ?? 0).toFixed(2)}
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
            <div className="text-xs text-slate-500 uppercase tracking-wide">
              Varie
            </div>
            <div className="mt-3">
              <input
                type="number"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-800 bg-white"
                value={varie}
                onChange={(e) => setVarie(e.target.value)}
                placeholder="Inserisci valore"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ACCONTO */}
      {generale?.consumoAcconto > 0 && (
        <div>
          <div className="text-sm font-semibold text-slate-700 mb-3">
            Dati acconto
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-5 gap-0 border-b bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <div className="px-4 py-3">Cons. Acconto</div>
              <div className="px-4 py-3">Imp. Acconto</div>
              <div className="px-4 py-3">Dep. Acconto</div>
              <div className="px-4 py-3">Iva Acconto</div>
              <div className="px-4 py-3">Tot. Acconto</div>
            </div>

            <div className="grid grid-cols-5 gap-0 text-sm text-slate-800">
              <div className="px-4 py-3 border-t">{generale.consumoAcconto}</div>
              <div className="px-4 py-3 border-t">{generale.impConsAcc}</div>
              <div className="px-4 py-3 border-t">{generale.depFogAcc}</div>
              <div className="px-4 py-3 border-t">{generale.ivaAcc}</div>
              <div className="px-4 py-3 border-t font-semibold">{generale.totAcc}</div>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* RIGHT SIDE COMPARISON */}
    <div className="xl:col-span-3">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 h-full">
        <div className="text-sm font-semibold text-slate-800">
          Confronto Totali
        </div>
        <div className="text-xs text-slate-500 mt-1">
          Verifica tra il totale del documento importato e il totale calcolato.
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Totale ABC
            </div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              € {Number(selectedImportedDoc?.importo_totale_da_pagare || 0).toFixed(2)}
            </div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-600 px-4 py-4 text-white shadow-sm">
            <div className="text-[11px] uppercase tracking-wide opacity-80">
              Gran Totale
            </div>
            <div className="mt-1 text-2xl font-bold">
              € {Number(session?.grand_total ?? 0).toFixed(2)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Delta
            </div>
            <div
              className={`mt-1 text-xl font-bold ${
                Math.abs(
                  Number(session?.grand_total ?? 0) -
                    Number(selectedImportedDoc?.importo_totale_da_pagare || 0)
                ) < 0.01
                  ? "text-emerald-600"
                  : "text-amber-600"
              }`}
            >
              €{" "}
              {(
                Number(session?.grand_total ?? 0) -
                Number(selectedImportedDoc?.importo_totale_da_pagare || 0)
              ).toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>


</div>


 {/* QF SECTION */}
        {/* <div className="bg-white border rounded-xl p-4 space-y-4">
          <div className="text-sm font-semibold text-slate-600">
            Giorni Operatore - Giorni Casa Idrica
          </div>
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
   */}
  {/* Operatore */}
  {/* <div className="bg-white border rounded-lg p-4 space-y-2">
    <div className="text-sm font-medium text-blue-600">
      Operatore
    </div>

    <div className="text-sm">
      {periodoPrecedente?.data_lettura_operatore ?? "-"} →{" "}
      {periodoAttuale?.data_lettura_operatore ?? "-"}
    </div>

    <div className="text-sm font-semibold">
      Giorni: {giorniOperatore}
    </div>
  </div> */}

  {/* Casa Idrica */}
  {/* <div className="bg-white border rounded-lg p-4 space-y-2">
    <div className="text-sm font-medium text-indigo-600">
      Casa Idrica
    </div>

    <div className="text-sm">
      {periodoPrecedente?.data_lettura_casa_idrica ?? "-"} →{" "}
      {periodoAttuale?.data_lettura_casa_idrica ?? "-"}
    </div>

    <div className="text-sm font-semibold">
      Giorni: {giorniCasaIdrica}
    </div>
  </div> */}

{/* </div> */}

 
 {/* </div> */}

      {/* OPERATIONS PANEL */}
      {/* <div className="bg-white rounded-2xl shadow p-6 space-y-6">

        <div className="text-lg font-semibold">
          Operazioni Fatturazione
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
 

          <button
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition"
            onClick={() => onStampaProspetto(fatturaId)}
          >
            Stampa Prospetto
          </button>

          <button
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition"
          >
            Stampa Bollette
          </button>
 
        </div>
      </div> */}


      {/* CONTATORI INTERNI */}
      <div className="bg-white border rounded-2xl p-6">
        <h3 className="font-semibold mb-4">      Situazione Contatori Interni 
</h3>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-slate-200">
            <thead className="bg-slate-100 sticky top-0 z-20 uppercase shadow-sm">
              <tr>
                <th className="p-2 sticky left-0 bg-slate-100 z-30">ID</th>
                <th className="p-2 sticky left-[60px] bg-slate-100 z-30">Utente</th>
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
                <th className="p-2">IVA</th>
                <th className="p-2">Acconto</th>
                <th className="p-2">Storno</th>
                <th className="p-2">Arr</th>
                <th className="p-2 font-semibold">Totale</th>
              </tr>
            </thead>

            <tbody>
              {righe.length === 0 && (
                <tr>
                  <td colSpan={14} className="p-4 text-center text-slate-400">
                    Nessun dato disponibile
                  </td>
                </tr>
              )}

              {console.log("Righe contatori interni:", righe)}
              {righe.map((r: any, idx: number) => (
                
                <tr key={r.id ?? idx} className="border-t odd:bg-white even:bg-slate-50">
                  <td className="p-2 text-right">{r.utenza.id_user ?? "-"}</td>
                  <td className="p-2 text-center">{r.utenza.Nome + " " + (r.utenza.Cognome ?? "-")}</td>
                  <td className="p-2 text-center">{r.utenza.Isolato ?? ""}</td>
                  <td className="p-2 text-center">{r.utenza.Scala ?? ""}</td>
                  <td className="p-2 text-center">{r.utenza.Interno ?? ""}</td>
                  <td className="p-2 text-center">{r.riga?.lettura_attuale ?? r.attuale?.valore_lettura}</td>
                  <td className="p-2 text-center">{r.riga?.lettura_precedente ?? r.precedente?.valore_lettura}</td>
                  
                  <td className="p-2 text-center">{r.riga?.stato_attuale ?? r.attuale?.stato_lettura}</td>
                  <td className="p-2 text-center">{parseInt(r.riga?.consumo_totale ?? 0)}</td>
                  <td className="p-2 text-center">{r.riga?.imp_acquedotto ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_fognatura ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_depurazione ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_qf ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.conguaglio ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_oneri ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_iva ?? 0}</td>

                  <td className="p-2 text-center">{r.riga?.imp_acconto ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_storno ?? 0}</td>
                  
                  <td className="p-2 text-center">{r.riga?.imp_arr ?? 0}</td>
                  <td className="p-2 text-center font-semibold">{r.riga?.totale ?? 0}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-200 font-semibold">
              <tr>
                <td colSpan={8} className="p-2 text-right">TOTALE</td>
                <td className="p-2 text-center">{totals.consumo.toFixed(0)}</td>
                <td className="p-2 text-center">{totals.acq.toFixed(2)}</td>
                <td className="p-2 text-center">{totals.fog.toFixed(2)}</td>
                <td className="p-2 text-center">{totals.dep.toFixed(2)}</td>
                <td className="p-2 text-center">{totals.qf.toFixed(2)}</td>
                <td className="p-2 text-center">{totals.cong.toFixed(2)}</td>
                <td className="p-2 text-center">{totals.oneri.toFixed(2)}</td>
                <td className="p-2 text-center">{totals.iva.toFixed(2)}</td>

                <td className="p-2 text-center">{totals.acconto.toFixed(2)}</td>
                <td className="p-2 text-center">{totals.storno.toFixed(2)}</td>
                <td className="p-2 text-center">{totals.arr.toFixed(2)}</td>
 
                <td
                  className={`p-2 text-center font-bold ${
                    totals.isGreen ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {totals.totaleInterni.toFixed(2)}
                </td>
              </tr>
          </tfoot>
          </table>
        </div>
      </div>

    </>
  )}
</div>

  );
}
 

