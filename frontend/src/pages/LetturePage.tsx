import { useState, useEffect, useRef } from "react";
import {
  createOrLoadSession,
  getSessionGrid,
  saveSessionRows,
  closeSession,
  getCondominio,
} from "../api/letture";

import { useParams } from "react-router-dom";
import type { Stato, GridRow, Session } from "../api/letture_interface";

import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

import { registerLocale } from "react-datepicker";
import { it } from "date-fns/locale/it";

registerLocale("it", it);

export default function LetturePage() {

  /* ---------------- PARAMS ---------------- */

  const params = useParams<{ id: string }>();

  if (!params.id) {
    return <div className="p-6">Condominio non valido</div>;
  }

  const condominioId = params.id;

  /* ---------------- STATE ---------------- */

  const [periodYear, setPeriodYear] = useState<number | null>(null);
  const [periodMonth, setPeriodMonth] = useState<number | null>(null);

  const [triggerDate, setTriggerDate] = useState<Date | null>(null);

  const [dataOperatore, setDataOperatore] = useState<Date | null>(null);
  const [dataCasa, setDataCasa] = useState<Date | null>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [states, setStates] = useState<Stato[]>([]);
  const [grid, setGrid] = useState<GridRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [condominioName, setCondominioName] = useState("");

  const lastLoadKeyRef = useRef("");

  /* ---------------- HELPERS ---------------- */

  function toLocalISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseDbDate(value?: string | null): Date | null {
    if (!value) return null;

    const year = Number(value.substring(0, 4));
    const month = Number(value.substring(5, 7));
    const day = Number(value.substring(8, 10));

    return new Date(year, month - 1, day, 12, 0, 0);
  }

  const monthNames = [
    "Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
    "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"
  ];

  /* ---------------- LOAD CONDOMINIO ---------------- */

  useEffect(() => {

    let alive = true;

    async function fetchCondominio() {

      try {

        const data = await getCondominio(condominioId);

        if (!alive) return;

        setCondominioName(data.nome);

      } catch {

        if (!alive) return;

        setCondominioName("");

      }

    }

    fetchCondominio();

    return () => {
      alive = false;
    };

  }, [condominioId]);

  /* ---------------- RESET WHEN CONDOMINIO CHANGES ---------------- */

  useEffect(() => {

    setSession(null);
    setGrid([]);
    setStates([]);

    setDataOperatore(null);
    setDataCasa(null);

    setPeriodYear(null);
    setPeriodMonth(null);

    setTriggerDate(null);

    setDirty(false);

    lastLoadKeyRef.current = "";

  }, [condominioId]);

  /* ---------------- LOAD SESSION FROM LOCATOR DATE ---------------- */

  useEffect(() => {

    if (!condominioId || !triggerDate) return;

    const year = triggerDate.getFullYear();
    const month = triggerDate.getMonth() + 1;

    const key = `${condominioId}::${year}::${month}`;

    if (lastLoadKeyRef.current === key) return;

    lastLoadKeyRef.current = key;

    setPeriodYear(year);
    setPeriodMonth(month);

    (async () => {

      try {

        setLoading(true);

        const sessionRes = await createOrLoadSession({
          idCondominio: condominioId,
          periodYear: year,
          periodMonth: month
        });

        const newSession = sessionRes.session;

        setSession(newSession);

        const savedOp = parseDbDate(newSession.data_lettura_operatore);
        const savedCasa = parseDbDate(newSession.data_lettura_casa_idrica);

        if (savedOp) {
          setDataOperatore(savedOp);
        } else {
          setDataOperatore(triggerDate);
        }

        setDataCasa(savedCasa ?? null);

        const gridPayload = await getSessionGrid(newSession.id);

        setStates(gridPayload.states);
        setGrid(gridPayload.grid);

        setDirty(false);

      } catch (err:any) {

        alert(err?.response?.data?.message || err?.message || "Errore caricamento");

      } finally {

        setLoading(false);

      }

    })();

  }, [triggerDate, condominioId]);

  /* ---------------- GRID UPDATE ---------------- */

  function updateRow(index:number, field:"valore" | "stato", value:string) {

    const updated = [...grid];

    if (field === "valore") {
      updated[index].current.valore = value === "" ? null : Number(value);
    } else {
      updated[index].current.stato = value;
    }

    setGrid(updated);
    setDirty(true);

  }

  /* ---------------- SAVE ---------------- */

  async function handleSave() {

    if (!session || !periodYear || !periodMonth) return;

    if (!dataOperatore) {
      alert("Data operatore obbligatoria");
      return;
    }

    const opISO = toLocalISO(dataOperatore);
    const casaISO = dataCasa ? toLocalISO(dataCasa) : null;

    try {

      setLoading(true);

      await createOrLoadSession({
        idCondominio: condominioId,
        periodYear,
        periodMonth,
        dataOperatore: opISO,
        dataCasaIdrica: casaISO
      });

      await saveSessionRows(
        session.id,
        grid.map((g) => ({
          idUtenza: g.utenza.id,
          valore: g.current.valore,
          stato: g.current.stato
        }))
      );

      setDirty(false);

      alert("Sessione salvata");

    } catch (err:any) {

      alert(err?.response?.data?.message || err?.message);

    } finally {

      setLoading(false);

    }

  }

  /* ---------------- CLOSE SESSION ---------------- */

  async function handleClose() {

    if (!session) return;

    if (!window.confirm("Close this session?")) return;

    await closeSession(session.id);

    setSession({ ...session, stato: "CHIUSA" });

    alert("Session closed");

  }

  /* ---------------- UI ---------------- */

  return (

    <div className="p-6 space-y-6">

    <div className="sticky top-0 z-30 bg-slate-50 pb-3 bg-white p-4 rounded-2xl shadow space-y-4">

      <h1 className="text-lg font-semibold">Inserimento Letture</h1>

      {/* TOP ROW */}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* CONDOMINIO */}

        <div className="bg-slate-100 rounded-lg px-3 py-2">
          <div className="text-xs text-slate-500 uppercase">
            Condominio
          </div>
          <div className="text-sm font-medium">
            {condominioName || "Caricamento..."}
          </div>
        </div>

        {/* LOCATOR */}

        <div className="space-y-1">
          <label className="text-xs text-slate-600">
            Apri periodo
          </label>

          <DatePicker
            selected={triggerDate}
            onChange={(date: Date | null) => setTriggerDate(date)}
            locale="it"
            dateFormat="dd/MM/yyyy"
            className="input w-full"
            disabled={loading}
          />
        </div>

        {/* PERIOD INFO */}

        <div className="grid grid-cols-2 gap-2">

          <div>
            <div className="text-xs text-slate-600">Anno</div>
            <div className="input bg-slate-100">
              {periodYear ?? "-"}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-600">Mese</div>
            <div className="input bg-slate-100">
              {periodMonth ? monthNames[periodMonth - 1] : "-"}
            </div>
          </div>

        </div>

      </div>

      {/* SECOND ROW */}

      {session && (

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* DATA OPERATORE */}

          <div className="space-y-1">
            <label className="text-xs text-slate-600">
              Lettura Operatore
            </label>

            <DatePicker
              selected={dataOperatore}
              onChange={(date: Date | null) => {
                setDataOperatore(date);
                setDirty(true);
              }}
              locale="it"
              dateFormat="dd/MM/yyyy"
              className="input w-full"
              disabled={loading || session?.stato === "CHIUSA"}
            />
          </div>

          {/* CASA IDRICA */}

          <div className="space-y-1">
            <label className="text-xs text-slate-600">
              Casa Idrica
            </label>

            <DatePicker
              selected={dataCasa}
              onChange={(date: Date | null) => {
                setDataCasa(date);
                setDirty(true);
              }}
              locale="it"
              dateFormat="dd/MM/yyyy"
              className="input w-full"
              disabled={loading || session?.stato === "CHIUSA"}
            />
          </div>

          {/* ACTIONS */}

          <div className="flex items-end gap-3">

            <button
              disabled={!dirty || loading || session?.stato === "CHIUSA"}
              onClick={handleSave}
              className="px-4 py-2 bg-green-600 text-white rounded-xl disabled:opacity-40"
            >
              Salva
            </button>

            {loading && (
              <div className="text-xs text-slate-500">
                Caricamento...
              </div>
            )}

          </div>

        </div>

      )}

    </div>

      {/* GRID */}

      {session && (

        <div className="bg-white p-6 rounded-2xl shadow overflow-auto">

      <div className="bg-white rounded-2xl shadow border border-slate-200 overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full min-w-[1200px] text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 z-20 bg-slate-100">
              <tr className="text-slate-700">
                <th className="p-3 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0">
                  Id
                </th>
                <th className="p-3 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0">
                  Utente
                </th>
                <th className="p-3 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0 ">
                  Interno
                </th>
                <th className="p-3 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0 ">
                  Scala
                </th>
                <th className="p-3 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0 ">
                  Matricola Cont.
                </th>
                <th className="p-3 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0  ">
                  Valore Attuale
                </th>
                <th className="p-3 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0 ">
                  Stato
                </th>
                <th className="p-3 text-left font-semibold border-b border-slate-200 bg-slate-50 sticky top-0  ">
                  Periodo Prec.
                </th>
                <th className="p-3 text-left font-semibold border-b border-slate-200 bg-slate-50 sticky top-0  ">
                  Valore Prec.
                </th>
                <th className="p-3 text-left font-semibold border-b border-slate-200 bg-slate-50 sticky top-0  ">
                  Stato Prec.
                </th>
              </tr>
            </thead>

            <tbody>
              {grid.map((row, i) => (
                <tr
                  key={row.utenza.id}
                  className="odd:bg-white even:bg-slate-50/50 hover:bg-blue-50 transition-colors"
                >
                  <td className="p-3 align-top border-b border-slate-100 text-slate-700 font-medium whitespace-nowrap">
                    {row.utenza.id_user}
                  </td>

                  <td className="p-3 align-top border-b border-slate-100">
                    <div className="font-medium text-slate-800 leading-tight">
                      {row.utenza.Nome} {row.utenza.Cognome}
                    </div>
                  </td>

                  <td className="p-3 align-top border-b border-slate-100 text-slate-700 whitespace-nowrap">
                    {row.utenza.Interno || "-"}
                  </td>
                  <td className="p-3 align-top border-b border-slate-100 text-slate-700 whitespace-nowrap">
                    {row.utenza.Scala || "-"}
                  </td>
                  <td className="p-3 align-top border-b border-slate-100 text-slate-700 whitespace-nowrap">
                    {row.utenza.Matricola_Contatore || "-"}
                  </td>
                  <td className="p-3 align-top border-b border-slate-100">
                    <input
                      type="number"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
                      disabled={session.stato === "CHIUSA"}
                      value={row.current.valore ?? ""}
                      onChange={(e) => updateRow(i, "valore", e.target.value)}
                      placeholder="Inserisci valore"
                    />
                  </td>

                  <td className="p-3 align-top border-b border-slate-100">
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
                      disabled={session.stato === "CHIUSA"}
                      value={row.current.stato}
                      onChange={(e) => updateRow(i, "stato", e.target.value)}
                    >
                      {states.map((s) => (
                        <option key={s.codice} value={s.codice}>
                          {s.codice} - {s.descrizione}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="p-3 align-top border-b border-slate-100 text-xs text-slate-500">
                    <div className="space-y-1">
                      {row.history.length > 0 ? (
                        row.history.map((h, idx) => (
                          <div
                            key={idx}
                            className="rounded-md bg-slate-100 px-2 py-1 whitespace-nowrap"
                          >
                            {h.period_month}/{h.period_year}
                          </div>
                        ))
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </div>
                  </td>

                  <td className="p-3 align-top border-b border-slate-100 text-xs text-slate-500">
                    <div className="space-y-1">
                      {row.history.length > 0 ? (
                        row.history.map((h, idx) => (
                          <div
                            key={idx}
                            className="rounded-md bg-slate-100 px-2 py-1 whitespace-nowrap"
                          >
                            {h.valore_lettura ?? "-"}
                          </div>
                        ))
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </div>
                  </td>

                  <td className="p-3 align-top border-b border-slate-100 text-xs text-slate-500">
                    <div className="space-y-1">
                      {row.history.length > 0 ? (
                        row.history.map((h, idx) => (
                          <div
                            key={idx}
                            className="rounded-md bg-slate-100 px-2 py-1 whitespace-nowrap"
                          >
                            {h.stato_lettura || "-"}
                          </div>
                        ))
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

        </div>

      )}

    </div>

  );

}