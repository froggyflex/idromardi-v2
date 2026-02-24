import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../api/client";
import { Trash2 } from "lucide-react";
import { Calendar } from "lucide-react";
import { Save } from "lucide-react";
import { set } from "date-fns";

type Provider = { id: string; nome: string; codice?: string };
type Periodo = { id: string; period_year: number; period_month: number };
type Session = any;

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
  const [genCalc, setGenCalc] = useState<any>(null);
  const [righeCalcoli, setRigheCalcoli] = useState<any[]>([]);
  const [tfCode, setTfCode] = useState<string>("TF1");


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
  
  async function bootstrap() {
    if (!condominioId) return;
    setError(null);

    try {
      const [pRes, perRes, sRes] = await Promise.all([
        api.get("/fatture/providers"),
        api.get(`/fatture/periodi/${condominioId}`),
        api.get(`/fatture/condominio/${condominioId}`), // existing backend route
      ]);

      setProviders(pRes.data || []);
      setPeriodi(perRes.data || []);
      setSessions(sRes.data || []);
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

        setCurrentSession(res.data.session);
        setRigheCalcoli(res.data.righe || []);
        

        //await loadDetail();
        await refreshSessionsList();
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

      console.log("Saving params:", { giorniQf, giorniConsumi, giorniAcconto, varie, giorniCasaInterni });
      await api.put(`/fatture/sessioni/${fatturaId}/parametri`, {
        giorniQF: Number(giorniQf),
        giorniConsumi: Number(giorniConsumi),
        giorniAcconto: Number(giorniAcconto),
        varie: Number(varie),
        giorniCasa: Number(giorniCasaInterni),
      });


      //await loadDetail();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Errore salvataggio");
    } finally {
      setSavingParams(false);
    }
  } 

  // useEffect(() => {
  //   setGiorniCasaInterni(daysBetween(
  //   periodoPrecedente?.data_lettura_casa_idrica,
  //   periodoAttuale?.data_lettura_casa_idrica
  // ));

  // }, [condominioId, periodoPrecedente, periodoAttuale]);
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
    setGiorniAcconto(session.giorni_acconto ?? 0);
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

function setMcAcconto(value: string): void {
  throw new Error("Function not implemented.");
}


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

  {/* TOP BAR */}
  <div className="flex items-center justify-between">
    <div>
      <div className="text-xl font-semibold">Fatture</div>
      <div className="text-sm text-slate-500">
        Condominio: {condominioId}
      </div>
    </div>
    <button
      onClick={() => navigate(`/condomini/${condominioId}/fatture`)}
      className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50"
      disabled={!condominioId}
    >
      Nuova / Lista
    </button>
  </div>

  {/* ERROR */}
  {error && (
    <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
      {error}
    </div>
  )}
 

  {/* SESSION CONTROL BAR */}
  <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-6">

    <div className="grid grid-cols-12 gap-8">

      {/* CREATE */}
      <div className="col-span-12 lg:col-span-5 space-y-4">
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
      </div>

      {/* EXISTING */}
      <div className="col-span-12 lg:col-span-7 space-y-4">
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
      </div>

    </div>
  </div>

  {/* DETAIL SECTION */}
  {!fatturaId ? (
    <div className="bg-white p-6 rounded-xl shadow">
      <div className="font-semibold">Seleziona una fattura</div>
      <div className="text-sm text-slate-500">
        Crea una nuova fattura oppure aprine una esistente.
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

 
{/* SUMMARY */}
<div className="sticky top-0 z-40 bg-white border-b shadow-sm">
  <div className="max-w-full px-6 py-4 flex justify-between items-center">

    <div>
      <div className="text-lg font-semibold">Fattura</div>
      <div className="text-sm text-slate-500">
        Stato:
        <span className="ml-2 px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-700">
          {session.stato}
        </span>
      </div>
    </div>

  <div className="flex items-center gap-3">
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">TF</span>
      <select
        value={tfCode}
        onChange={(e) => setTfCode(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm bg-white"
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
</div>



{/* CONTATORE GENERALE */}
<div className="bg-white border rounded-2xl p-6 w-full space-y-6">

  <div className="flex justify-between items-center">
    <h3 className="font-semibold text-lg">Imposta Giorni</h3>

  </div>
  {/* ============================= */}
  {/* 1️⃣ SEZIONE GIORNI           */}
  {/* ============================= */}
  <div className="bg-white border rounded-2xl p-6 space-y-6 ">

    {/* <div className="text-lg font-semibold">Parametri Giorni</div> */}

    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
      <div>
        <label className="text-xs text-slate-500">Giorni QF</label>
        <input
          type="number"
          className="w-full px-3 py-2 border rounded-xl"
          value={giorniQf}
          onChange={(e) => setGiorniQf(e.target.value)}
        />
      </div>

      <div>
        <label className="text-xs text-slate-500">Giorni Consumi</label>
        <input
          type="number"
          className="w-full px-3 py-2 border rounded-xl"
          value={giorniConsumi}
          onChange={(e) => setGiorniConsumi(e.target.value)}
        />
      </div>

      <div>
        <label className="text-xs text-slate-500">Giorni Interni</label>
        <input
          type="number"
          className="w-full px-3 py-2 border rounded-xl"
          value={giorniCasaInterni}
          onChange={(e) => setGiorniCasaInterni(e.target.value)}
        />
      </div>

      <div>
        <label className="text-xs text-slate-500">Giorni Acconto</label>
        <input
          type="number"
          className="w-full px-3 py-2 border rounded-xl"
          value={giorniAcconto}
          onChange={(e) => setGiorniAcconto(e.target.value)}
        />
      </div>
    </div>
  </div>
  {/* ============================= */}
  {/* 2️⃣ SEZIONE ACCONTO           */}
  {/* ============================= */}
  {Number(giorniAcconto) > 0 && (
    <div className="bg-white border rounded-2xl p-6 space-y-6">
      <div className="text-lg font-semibold">Gestione Acconto</div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div>
          <label className="text-xs text-slate-500">
            MC da aggiungere (Acconto)
          </label>
          <input
            type="number"
            className="w-full px-3 py-2 border rounded-xl"
            value={0}
            onChange={(e) => setMcAcconto(e.target.value)}
          />
        </div>

        <div className="flex items-end">
          <div className="text-sm text-slate-500">
            Verrà ripartito proporzionalmente sugli interni.
          </div>
        </div>
      </div>
    </div>
  )}


  {/* INPUT SECTION */}
      <div className="text-lg font-semibold">
      Situazione Contatore Generale
    </div>
  <div className="grid grid-cols-3 gap-6">

    <div>
      <label className="text-xs text-slate-500">Lettura Attuale</label>
      <input
        type="number"
        className="w-full border rounded px-2 py-2"
        value={valAtt}
        onChange={(e) => setValAtt(e.target.value)}
      />
    </div>

    <div>
      <label className="text-xs text-slate-500">Lettura Precedente</label>
      <input
        type="number"
        className="w-full border rounded px-2 py-2"
        value={valPrec}
        onChange={(e) => setValPrec(e.target.value)}
      />
 
    </div>

    <div className="flex items-end">
      
      <button
        onClick={saveGenerale}
        disabled={savingGenerale}
        className="bg-blue-600 text-white px-4 py-2 rounded-lg disabled:opacity-50 hover:bg-blue-700 transition flex items-center gap-2"
      >
        <Save size={18} />
        {savingGenerale ? "Salvando..." : "Salva Generale"}
        
      </button>


      <div>
        

        
      </div>
      
    </div>
    
  </div>

{/* CALCULATION BREAKDOWN */}
<div className="bg-slate-50 rounded-2xl p-6 space-y-6 border">

  <div className="text-lg font-semibold text-slate-700">
    Dettaglio Calcolo
  </div>

  {/* PRIMARY VALUES */}
  <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">

    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="text-xs text-slate-500 uppercase tracking-wide">
        Consumo
      </div>
      <div className="text-2xl font-bold text-slate-800 mt-1">
        {Number(valAtt || 0) - Number(valPrec || 0)}
      </div>
      <div className="text-xs text-slate-400">mc</div>
    </div>

    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="text-xs text-slate-500 uppercase tracking-wide">
        Imp. Cons.
      </div>
      <div className="text-lg font-semibold mt-1">
        € {Number(session?.tot_acquedotto ?? 0).toFixed(2)}
      </div>
    </div>

    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="text-xs text-slate-500 uppercase tracking-wide">
        Dep.
      </div>
      <div className="text-lg font-semibold mt-1">
        € {(Number(session?.tot_fognatura ?? 0) +
            Number(session?.tot_depurazione ?? 0)).toFixed(2)}
      </div>
    </div>

    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="text-xs text-slate-500 uppercase tracking-wide">
        Q.F
      </div>
      <div className="text-lg font-semibold mt-1">
        € {Number(session?.tot_qf ?? 0).toFixed(2)}
      </div>
    </div>

  </div>

  {/* SECONDARY VALUES */}
  <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">

    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="text-xs text-slate-500 uppercase tracking-wide">
        IVA
      </div>
      <div className="text-lg font-semibold mt-1">
        € {Number(session?.tot_iva ?? 0).toFixed(2)}
      </div>
    </div>

    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="text-xs text-slate-500 uppercase tracking-wide">
        Varie
      </div>
      <div className="text-lg font-semibold mt-1">
        €               <input
                type="number"
                className=" px-3 py-2 border rounded-xl"
                value={varie}
                onChange={(e) => setVarie(e.target.value)}
              />
      </div>
    </div>

    {/* <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="text-xs text-slate-500 uppercase tracking-wide">
        Tot. Oneri
      </div>
      <div className="text-lg font-semibold mt-1">
        € {Number(session?.tot_oneri ?? 0).toFixed(2)}
      </div>
    </div> */}

    <div className="bg-blue-600 rounded-xl p-4 text-white shadow-md">
      <div className="text-xs uppercase tracking-wide opacity-80">
        Gran Totale
      </div>
      <div className="text-2xl font-bold mt-1">
        € {Number(session?.grand_total ?? 0).toFixed(2)}
      </div>
    </div>

  </div>

</div>


</div>


        {/* QF SECTION */}
        <div className="bg-white border rounded-xl p-4 space-y-4">
          <div className="text-sm font-semibold text-slate-600">
            Giorni Operatore - Giorni Casa Idrica
          </div>
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  
  {/* Operatore */}
  <div className="bg-white border rounded-lg p-4 space-y-2">
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
  </div>

  {/* Casa Idrica */}
  <div className="bg-white border rounded-lg p-4 space-y-2">
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
  </div>

</div>

 
 </div>

      {/* OPERATIONS PANEL */}
      <div className="bg-white rounded-2xl shadow p-6 space-y-6">

        <div className="text-lg font-semibold">
          Operazioni Fatturazione
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">

          {/* <button
            onClick={calcola}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition"
          >
            Calcola
          </button> */}

          <button
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition"
          >
            Stampa Prospetto
          </button>

          <button
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition"
          >
            Stampa Bollette
          </button>

          {/* <button
            className="bg-slate-700 text-white px-4 py-2 rounded-xl hover:bg-slate-800 transition"
          >
            Conguaglio
          </button> */}

          {/* <button
            className="bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 transition"
          >
            Salva Tabulato
          </button> */}

          {/* <button
            className="bg-purple-600 text-white px-4 py-2 rounded-xl hover:bg-purple-700 transition"
          >
            Registra Storico
          </button> */}

        </div>
      </div>
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
 

