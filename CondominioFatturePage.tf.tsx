import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../api/client";
import { Trash2 } from "lucide-react";
import { Calendar } from "lucide-react";
import { Save } from "lucide-react";

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
    if (!condominioId) return;

    // Sessions list endpoint (must return an array)
    const sRes = await api.get(`/fatture/condominio/${condominioId}`);
    const list = (sRes.data?.sessions ?? sRes.data?.list ?? sRes.data) ?? [];
    setSessions(Array.isArray(list) ? list : []);
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

  async function testGenerale() {
    if (!fatturaId) return;
    try {
      const res = await api.get(`/fatture/sessioni/${fatturaId}/calcola-generale`);
     
      setGenCalc(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Errore calcolo generale");
    }
  }

    async function calcola() {
      if (!fatturaId) return;

      setLoadingCalc(true);
      setError(null);

      try {
        await saveParams();
        const res = await api.post(
          `/fatture/sessioni/${fatturaId}/calcola`
        ); 

        setCurrentSession(res.data.session);
        //setRighe(res.data.righe || []);

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

      await api.put(`/fatture/sessioni/${fatturaId}/parametri`, {
        giorniQF: Number(giorniQf),
        giorniConsumi: Number(giorniConsumi),
        giorniAcconto: Number(giorniAcconto),
        varie: Number(varie),
      });

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
    setGiorniAcconto(session.giorni_acconto ?? 0);
    setVarie(session.varie ?? 0);
  }, [session]);
 

const giorniOperatore = daysBetween(
  periodoPrecedente?.data_lettura_operatore,
  periodoAttuale?.data_lettura_operatore
);

const giorniCasa = daysBetween(
  periodoPrecedente?.data_lettura_casa_idrica,
  periodoAttuale?.data_lettura_casa_idrica
);
 
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

  <button
  onClick={testGenerale}
  className="border px-3 py-2 rounded-lg bg-white hover:bg-slate-50"
>
  Test Calcolo Generale
</button>

  {genCalc && (
  <div className="bg-white border rounded-xl p-4 text-sm">
    <div className="font-semibold mb-2">Debug Generale (Legacy)</div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div><div className="text-slate-500 text-xs">Consumo</div><div className="font-medium">{genCalc.meta.consumo}</div></div>
      <div><div className="text-slate-500 text-xs">totNuc</div><div className="font-medium">{genCalc.meta.totNuc}</div></div>
      <div><div className="text-slate-500 text-xs">numNuae</div><div className="font-medium">{genCalc.meta.numNuae}</div></div>
      <div><div className="text-slate-500 text-xs">YearDays</div><div className="font-medium">{genCalc.meta.yearDays}</div></div>

      <div><div className="text-slate-500 text-xs">Cap Agev</div><div className="font-medium">{genCalc.generale.caps.con_agev}</div></div>
      <div><div className="text-slate-500 text-xs">Cap Base</div><div className="font-medium">{genCalc.generale.caps.co_fbase}</div></div>
      <div><div className="text-slate-500 text-xs">Cap Fascia</div><div className="font-medium">{genCalc.generale.caps.fascia}</div></div>

      <div><div className="text-slate-500 text-xs">Imp. Cons</div><div className="font-medium">€ {genCalc.generale.impCons.toFixed(2)}</div></div>
      <div><div className="text-slate-500 text-xs">Dep+Fog</div><div className="font-medium">€ {genCalc.generale.depFog.toFixed(2)}</div></div>
      <div><div className="text-slate-500 text-xs">QF Tot</div><div className="font-medium">€ {genCalc.generale.qfTot.toFixed(2)}</div></div>
      <div><div className="text-slate-500 text-xs">IVA</div><div className="font-medium">€ {genCalc.generale.iva.toFixed(2)}</div></div>

      <div className="col-span-2 md:col-span-4 border-t pt-2">
        <div className="text-slate-500 text-xs">Totale</div>
        <div className="text-lg font-bold">€ {genCalc.generale.totale.toFixed(2)}</div>
      </div>
    </div>
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
      <div className="bg-gradient-to-r from-slate-50 to-white border rounded-2xl p-6 space-y-6">

        {/* HEADER */}

        <div className="flex justify-between items-center">
          <div>
            <div className="text-lg font-semibold">Fattura</div>
            <div className="text-sm text-slate-500">
              Stato:
              <span className="ml-2 px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-700">
                {session.stato}
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            {/* <button
              onClick={saveParams}
              className="bg-slate-700 text-white px-4 py-2 rounded-xl"
            >
              {savingParams ? "Salvataggio..." : "Salva Parametri"}
            </button> */}

            {/* <button
              onClick={calcola}
              className="bg-blue-600 text-white px-5 py-2 rounded-xl"
            >
              Calcola
            </button> */}
          </div>
        </div>

        {/* QF SECTION */}
        <div className="bg-white border rounded-xl p-4 space-y-4">
          <div className="text-sm font-semibold text-slate-600">
            Periodo QF
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
      Giorni: {giorniCasa}
    </div>
  </div>

</div>

          <div className="grid grid-cols-4 gap-6">

            {/* <div>
              <label className="text-xs text-slate-500">Data Da</label>
              <div className="relative">
                <Calendar size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  className="w-full pl-10 pr-3 py-2 border rounded-xl"
                  value={dataQfFrom}
                  onChange={(e) => {
                    const newFrom = e.target.value;
                    setDataQfFrom(newFrom);

                    const days = calcDays(newFrom, dataQfTo);
                    setGiorniQf(days);
                  }}
                />
              </div>
            </div> */}

            {/* <div>
              <label className="text-xs text-slate-500">Data A</label>
              <div className="relative">
                <Calendar size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  className="w-full pl-10 pr-3 py-2 border rounded-xl"
                  value={dataQfTo}
                  onChange={(e) => {
                    const newTo = e.target.value;
                    setDataQfTo(newTo);

                    const days = calcDays(dataQfFrom, newTo);
                    setGiorniQf(days);
                  }}
                />
              </div>
            </div> */}

            {/* <div>
              <label className="text-xs text-slate-500">Giorni QF</label>
              <input
                type="number"
                className="w-full px-3 py-2 border rounded-xl"
                value={giorniQf}
                onChange={(e) => setGiorniQf(e.target.value)}
              />
            </div> */}

            {/* <div className="flex items-end">
              <div>
                <div className="text-xs text-slate-500">Calcolati</div>
                <div className="text-lg font-semibold">
                  {calcDays(dataQfFrom, dataQfTo)}
                </div>
              </div>
              
            </div> */}
            

          </div>
        </div>


      </div>


{/* CONTATORE GENERALE */}
<div className="bg-white border rounded-2xl p-6 w-full space-y-6">

  <div className="flex justify-between items-center">
    <h3 className="font-semibold text-lg">Contatore Generale</h3>

  </div>

            {/* OTHER PARAMETERS */}
        <div className="bg-white border rounded-xl p-4">
          <div className="grid grid-cols-4 gap-6">
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
              <label className="text-xs text-slate-500">Varie</label>
              <input
                type="number"
                className="w-full px-3 py-2 border rounded-xl"
                value={varie}
                onChange={(e) => setVarie(e.target.value)}
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
          <button
            onClick={calcola}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition"
          >
            Calcola
          </button>
  {/* INPUT SECTION */}
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
        € {Number(session?.varie ?? 0).toFixed(2)}
      </div>
    </div>

    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="text-xs text-slate-500 uppercase tracking-wide">
        Tot. Oneri
      </div>
      <div className="text-lg font-semibold mt-1">
        € {Number(session?.tot_oneri ?? 0).toFixed(2)}
      </div>
    </div>

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




      {/* OPERATIONS PANEL */}
      <div className="bg-white rounded-2xl shadow p-6 space-y-6">

        <div className="text-lg font-semibold">
          Operazioni Fatturazione
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">

          <button
            onClick={calcola}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition"
          >
            Calcola
          </button>

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

          <button
            className="bg-slate-700 text-white px-4 py-2 rounded-xl hover:bg-slate-800 transition"
          >
            Conguaglio
          </button>

          <button
            className="bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 transition"
          >
            Salva Tabulato
          </button>

          <button
            className="bg-purple-600 text-white px-4 py-2 rounded-xl hover:bg-purple-700 transition"
          >
            Registra Storico
          </button>

        </div>
      </div>
      {/* CONTATORI INTERNI */}
      <div className="bg-white border rounded-2xl p-6">
        <h3 className="font-semibold mb-4">Contatori Interni</h3>

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
                  <td className="p-2 text-center">{r.utenza.Isolato ?? "-"}</td>
                  <td className="p-2 text-center">{r.utenza.Scala ?? "-"}</td>
                  <td className="p-2 text-center">{r.utenza.Interno ?? "-"}</td>
                  <td className="p-2 text-center">{r.riga?.lettura_attuale ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.lettura_precedente ?? 0}</td>
                  
                  <td className="p-2 text-center">{r.riga?.stato_attuale ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.consumo_totale ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_acquedotto ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_fognatura ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_depurazione ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_qf ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_oneri ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_iva ?? 0}</td>
                  <td className="p-2 text-center">{r.riga?.imp_arr ?? 0}</td>
                  <td className="p-2 text-center font-semibold">{r.riga?.totale ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </>
  )}
</div>

  );
}
function setRighe(righe: any) {
  throw new Error("Function not implemented.");
}

