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
  /* ---------------- PARAMS (TYPE-SAFE) ---------------- */

  const params = useParams<{ id: string }>();
  if (!params.id) {
    return <div className="p-6">Condominio non valido</div>;
  }
  const condominioId: string = params.id;

  /* ---------------- STATE ---------------- */

  const [periodYear, setPeriodYear] = useState<number | null>(null);
  const [periodMonth, setPeriodMonth] = useState<number | null>(null);

  const [dataOperatore, setDataOperatore] = useState<Date | null>(null);
  const [dataCasa, setDataCasa] = useState<Date | null>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [states, setStates] = useState<Stato[]>([]);
  const [grid, setGrid] = useState<GridRow[]>([]);

  const [loading, setLoading] = useState<boolean>(false);
  const [dirty, setDirty] = useState<boolean>(false);

  const [condominioName, setCondominioName] = useState<string>("");

  // Prevent duplicate auto-load calls in React StrictMode / fast re-renders
  const lastLoadKeyRef = useRef<string>("");

  /* ---------------- HELPERS ---------------- */

  function toLocalISO(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

function parseDbDate(value?: string | null): Date | null {
  if (!value) return null;

  const year = Number(value.substring(0, 4));
  const month = Number(value.substring(5, 7));
  const day = Number(value.substring(8, 10));

  return new Date(year, month - 1, day, 12, 0, 0);
}

async function loadSession(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1, 12);
  const safeISO = toLocalISO(firstDay);

  const sessionRes = await createOrLoadSession({
    idCondominio: condominioId,
    periodYear: year,
    periodMonth: month
  });

  const newSession = sessionRes.session;
  setSession(newSession);

  // Hydrate strictly from DB values
  const opStr = newSession.data_lettura_operatore;
  const casaStr = newSession.data_lettura_casa_idrica;

  setDataOperatore(
    opStr ? new Date(opStr + "T12:00:00") : firstDay
  );

  setDataCasa(
    casaStr ? new Date(casaStr + "T12:00:00") : firstDay
  );

  const gridPayload = await getSessionGrid(newSession.id);
  setGrid(gridPayload.grid);
}

//  useEffect(() => {
//   if (!periodYear || !periodMonth) return;

//   const firstDay = new Date(periodYear, periodMonth - 1, 1, 12, 0, 0);

//   setDataOperatore(null);
//   setDataCasa(null);

// }, [periodYear, periodMonth]);

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

  /* ---------------- RESET ON CONDOMINIO CHANGE ---------------- */

  useEffect(() => {
    setSession(null);
    setGrid([]);
    setStates([]);
    setDataOperatore(null);
    setDataCasa(null);
    setDirty(false);
    lastLoadKeyRef.current = "";
  }, [condominioId]);

  /* ---------------- AUTO LOAD WHEN MONTH SELECTED ----------------
     Requirement: "load condominio with respective readings when I select the month.
     If there is no session then initialize one as per usual"
  */

useEffect(() => {
  if (!condominioId || !periodYear || !periodMonth) return;

  const key = `${condominioId}::${periodYear}::${periodMonth}`;
  if (lastLoadKeyRef.current === key) return;
  lastLoadKeyRef.current = key;

  (async () => {
    try {
      setLoading(true);

      // 1️⃣ Try loading session WITHOUT forcing dates
      const sessionRes = await createOrLoadSession({
        idCondominio: condominioId,
        periodYear,
        periodMonth,
        dataOperatore: undefined,
        dataCasaIdrica: undefined,
      });

      let newSession: Session = sessionRes.session;

      // 2️⃣ If DB has no dates (new session), then set first day ONCE
      if (!newSession.data_lettura_operatore) {
        const firstDay = new Date(periodYear, periodMonth - 1, 1, 12, 0, 0, 0);
        const safeDate = toLocalISO(firstDay);

        const updatedRes = await createOrLoadSession({
          idCondominio: condominioId,
          periodYear,
          periodMonth,
          dataOperatore: safeDate,
          dataCasaIdrica: null,
        });

        newSession = updatedRes.session;
      }

      setSession(newSession);

      const firstDay = new Date(periodYear, periodMonth - 1, 1, 12, 0, 0, 0);

      const op = parseDbDate(newSession.data_lettura_operatore);
      const casa = parseDbDate(newSession.data_lettura_casa_idrica);

      setDataOperatore(op ?? firstDay);
      setDataCasa(casa ?? firstDay);

      const gridPayload = await getSessionGrid(newSession.id);
      setStates(gridPayload.states);
      setGrid(gridPayload.grid);

      setDirty(false);

    } catch (err: any) {
      alert(err?.response?.data?.message || err?.message || "Errore caricamento");
    } finally {
      setLoading(false);
    }
  })();

}, [condominioId, periodYear, periodMonth]);


  /* ---------------- UPDATE GRID ---------------- */

  function updateRow(index: number, field: "valore" | "stato", value: string) {
    const updated = [...grid];

    if (field === "valore") {
      updated[index].current.valore = value === "" ? null : Number(value);
    } else {
      updated[index].current.stato = value;
    }

    setGrid(updated);
    setDirty(true);
  }

  /* ---------------- SAVE (HEADER + ROWS) ---------------- */

  async function handleSave() {
    if (!session || !periodYear || !periodMonth) return;

    if (!dataOperatore || !dataCasa) {
      alert("Le date devono essere valorizzate");
      return;
    }

    const opISO = toLocalISO(dataOperatore);
    const casaISO = toLocalISO(dataCasa);

    console.log("Saving with dates:", { opISO, casaISO });
    // Extra safety validation
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!dateRegex.test(opISO) || !dateRegex.test(casaISO)) {
      alert("Formato data non valido");
      return;
    }

    try {
      setLoading(true);

      await createOrLoadSession({
        idCondominio: condominioId,
        periodYear,
        periodMonth,
        dataOperatore: opISO,
        dataCasaIdrica: casaISO,
      });

      await saveSessionRows(
        session.id,
        grid.map((g) => ({
          idUtenza: g.utenza.id,
          valore: g.current.valore,
          stato: g.current.stato,
        }))
      );

      setDirty(false);
      alert("Sessione salvata");
    } catch (err: any) {
      alert(err?.response?.data?.message || err?.message);
    } finally {
      setLoading(false);
    }
  }


  /* ---------------- CLOSE ---------------- */

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
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl shadow space-y-6">
        <h1 className="text-xl font-semibold">Inserimento Letture</h1>

        {/* Condominio */}
        <div className="bg-slate-100 rounded-xl px-4 py-3">
          <div className="text-xs text-slate-500 uppercase tracking-wider">
            Condominio selezionato
          </div>
          <div className="text-sm font-medium text-slate-800">
            {condominioName || "Caricamento..."}
          </div>
        </div>

        {/* Period Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-600">
              Anno di riferimento
            </label>
            <select
              value={periodYear ?? ""}
              onChange={(e) =>
                setPeriodYear(e.target.value ? Number(e.target.value) : null)
              }
              className="input"
              disabled={loading}
            >
              <option value="">Seleziona anno</option>
              {Array.from({ length: 10 }, (_, i) => {
                const y = new Date().getFullYear() - 5 + i;
                return (
                  <option key={y} value={y}>
                    {y}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-600">
              Mese di riferimento
            </label>
            <select
              className="input"
              value={periodMonth ?? ""}
              onChange={(e) =>{
                const newMonth = Number(e.target.value);
                setPeriodMonth(newMonth);

                if (periodYear && newMonth) {
                  loadSession(periodYear, newMonth);
                }
              }}
              disabled={loading}
            >
              <option value="">Seleziona mese</option>
              {[
                "Gennaio",
                "Febbraio",
                "Marzo",
                "Aprile",
                "Maggio",
                "Giugno",
                "Luglio",
                "Agosto",
                "Settembre",
                "Ottobre",
                "Novembre",
                "Dicembre",
              ].map((m, index) => (
                <option key={index + 1} value={index + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Dates Section */}
        {periodMonth && periodYear && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-600">
                Data Lettura Operatore
              </label>
              <DatePicker
                selected={dataOperatore}
                onChange={(date: Date | null) => {
                  setDataOperatore(date);
                  setDirty(true);
                }}
                locale="it"
                dateFormat="dd/MM/yyyy"
                className="input"
                openToDate={new Date(periodYear, periodMonth - 1, 1)}
                disabled={loading || session?.stato === "CHIUSA"}
              />
              <p className="text-xs text-slate-400">
                Giorno in cui sono state rilevate le letture.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-600">
                Data Riferimento Casa Idrica
              </label>
              <DatePicker
                selected={dataCasa}
                onChange={(date: Date | null) => {
                  setDataCasa(date);
                  setDirty(true);
                }}
                locale="it"
                dateFormat="dd/MM/yyyy"
                className="input"
                openToDate={new Date(periodYear, periodMonth - 1, 1)}
                disabled={loading || session?.stato === "CHIUSA"}
              />
              <p className="text-xs text-slate-400">
                Data ufficiale comunicata dall’ente idrico.
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Kept as a manual refresh (optional, now not required) */}
          {/* <button
            onClick={() => {
              // force reload even if same month selected
              lastLoadKeyRef.current = "";
              if (periodYear && periodMonth) {
                // trigger by re-setting same values (no-op), so directly call effect logic by setting key empty + toggling loading:
                // simplest: just call reload by setting loading and calling createOrLoadSession again
                // But to avoid duplicate code, we just clear key and setPeriodMonth to same value via state setter
                setPeriodMonth((m) => (m ? m : m));
              }
            }}
            disabled={loading || !periodYear || !periodMonth}
            className="px-5 py-2 rounded-xl border bg-white hover:bg-slate-50"
          >
            Aggiorna
          </button> */}

          <button
            disabled={!dirty || loading || session?.stato === "CHIUSA"}
            onClick={handleSave}
            className="px-4 py-2 bg-green-600 text-white rounded-xl disabled:opacity-40"
          >
            Salva Sessione
          </button>

          {/* {session && (
            <button
              onClick={handleClose}
              disabled={loading || session.stato === "CHIUSA"}
              className="px-4 py-2 bg-amber-600 text-white rounded-xl disabled:opacity-40"
            >
              Chiudi Sessione
            </button>
          )} */}

          {loading && (
            <div className="text-sm text-slate-500">Caricamento...</div>
          )}
        </div>
      </div>

      {/* Grid */}
      {session && (
        <div className="bg-white p-6 rounded-2xl shadow overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2 text-left">Id</th>
                <th className="p-2 text-left">Utente</th>
                <th className="p-2 text-left">Interno</th>
                <th className="p-2 text-left">Valore Attuale</th>
                <th className="p-2 text-left">Stato</th>
                <th className="p-2 text-left">Valore Precedente</th>
              </tr>
            </thead>
            <tbody>
              {grid.map((row, i) => (
                <tr key={row.utenza.id} className="border-b hover:bg-gray-50">
                  <td className="p-2">{row.utenza.id_user}</td>
                  <td className="p-2">
                    {row.utenza.Nome} {row.utenza.Cognome}
                  </td>
                  <td className="p-2">{row.utenza.Interno}</td>

                  <td className="p-2">
                    <input
                      type="number"
                      className="input"
                      disabled={session.stato === "CHIUSA"}
                      value={row.current.valore ?? ""}
                      onChange={(e) => updateRow(i, "valore", e.target.value)}
                    />
                  </td>

                  <td className="p-2">
                    <select
                      className="input"
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

                  <td className="p-2 text-xs text-gray-600">
                    {row.history.map((h, idx) => (
                      <div key={idx}>
                        {h.period_month}/{h.period_year} →{" "}
                        {h.valore_lettura ?? "-"} ({h.stato_lettura})
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
