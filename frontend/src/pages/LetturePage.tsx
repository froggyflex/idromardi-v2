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

function formatManualDate(date: Date | null): string {
  if (!date) return "";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

function parseManualDate(value: string): Date | null {
  const text = normalizeDateText(value);
  if (!text) return null;

  let day: number;
  let month: number;
  let year: number;

  const european = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (european) {
    day = Number(european[1]);
    month = Number(european[2]);
    year = Number(european[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    return null;
  }

  if (year < 100) {
    year += year >= 70 ? 1900 : 2000;
  }

  const parsed = new Date(year, month - 1, day, 12, 0, 0);
  const valid =
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day;

  return valid ? parsed : null;
}

function normalizeDateText(value: string): string {
  const text = value.trim();
  const digits = text.replace(/\D/g, "");

  if (/^\d{8}$/.test(digits)) {
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  if (/^\d{6}$/.test(digits)) {
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/20${digits.slice(4)}`;
  }

  return text;
}

type ManualDatePickerProps = {
  selected: Date | null;
  onChange: (date: Date | null) => void;
  disabled?: boolean;
  placeholder?: string;
};

function ManualDatePicker({
  selected,
  onChange,
  disabled = false,
  placeholder = "gg/mm/aaaa",
}: ManualDatePickerProps) {
  const [text, setText] = useState(formatManualDate(selected));
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setText(formatManualDate(selected));
    setHasError(false);
  }, [selected]);

  function commitManualValue(value: string) {
    const nextText = normalizeDateText(value);

    if (!nextText) {
      setText("");
      setHasError(false);
      onChange(null);
      return;
    }

    const parsed = parseManualDate(nextText);

    if (!parsed) {
      setHasError(true);
      return;
    }

    setText(formatManualDate(parsed));
    setHasError(false);
    onChange(parsed);
  }

  return (
    <div>
      <DatePicker
        selected={selected}
        onChange={(date: Date | null) => {
          setText(formatManualDate(date));
          setHasError(false);
          onChange(date);
        }}
        onChangeRaw={(event) => {
          const value = (event?.target as HTMLInputElement | null)?.value ?? "";
          setText(value);
          setHasError(false);
        }}
        onBlur={() => commitManualValue(text)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitManualValue(text);
          }
        }}
        onFocus={(event) => {
          const input = event.target as HTMLInputElement;
          window.setTimeout(() => input.select(), 0);
        }}
        value={text}
        locale="it"
        dateFormat="dd/MM/yyyy"
        showMonthDropdown
        showYearDropdown
        dropdownMode="select"
        scrollableYearDropdown
        yearDropdownItemNumber={20}
        placeholderText={placeholder}
        className={`input w-full ${hasError ? "border-red-400 ring-2 ring-red-100" : ""}`}
        disabled={disabled}
        isClearable={!disabled}
        shouldCloseOnSelect
        showPopperArrow={false}
        calendarStartDay={1}
      />
      {hasError && (
        <div className="mt-1 text-xs font-medium text-red-600">
          Usa il formato gg/mm/aaaa.
        </div>
      )}
    </div>
  );
}

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

  function latestHistory(row: GridRow) {
    return row.history?.[0] ?? null;
  }

  function formatPeriodLabel(history: GridRow["history"][number] | null) {
    if (!history) return "-";

    const month = monthNames[Number(history.period_month) - 1] ?? history.period_month;
    return `${month} ${history.period_year}`;
  }

  function isEvidentState(value?: string | null) {
    return ["Y", "C"].includes(String(value || "").toUpperCase());
  }

  function stateBadgeClass(value?: string | null) {
    const code = String(value || "").toUpperCase();

    if (code === "Y") {
      return "border-red-200 bg-red-50 text-red-700";
    }

    if (code === "C") {
      return "border-amber-200 bg-amber-50 text-amber-700";
    }

    return "border-slate-200 bg-slate-100 text-slate-600";
  }

  function getPossibleConsumption(row: GridRow) {
    const previous = latestHistory(row)?.valore_lettura;
    const current = row.current.valore;

    if (previous === null || previous === undefined || current === null || current === undefined) {
      return "";
    }

    return String(Number(current) - Number(previous));
  }

  function getHistoryAverage(row: GridRow) {
    const values = (row.history || [])
      .slice(0, 4)
      .map((history) => Number(history.consumo_storico))
      .filter((value) => Number.isFinite(value));

    if (!values.length) return null;

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

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

  function updateConsumption(index: number, value: string) {
    const updated = [...grid];
    const previous = latestHistory(updated[index])?.valore_lettura;

    if (previous === null || previous === undefined || value === "") {
      updated[index].current.valore = null;
    } else {
      updated[index].current.valore = Number(previous) + Number(value);
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

          <ManualDatePicker
            selected={triggerDate}
            onChange={(date: Date | null) => setTriggerDate(date)}
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

            <ManualDatePicker
              selected={dataOperatore}
              onChange={(date: Date | null) => {
                setDataOperatore(date);
                setDirty(true);
              }}
              disabled={loading || session?.stato === "CHIUSA"}
            />
          </div>

          {/* CASA IDRICA */}

          <div className="space-y-1">
            <label className="text-xs text-slate-600">
              Casa Idrica
            </label>

            <ManualDatePicker
              selected={dataCasa}
              onChange={(date: Date | null) => {
                setDataCasa(date);
                setDirty(true);
              }}
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
          <table className="w-full min-w-[1520px] text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 z-20 bg-slate-100">
              <tr className="text-slate-700">
                <th className="px-3 py-2 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0">
                  Id
                </th>
                <th className="px-3 py-2 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0">
                  Utente / Contatore
                </th>
                <th className="px-3 py-2 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0">
                  Interno
                </th>
                <th className="px-3 py-2 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0">
                  Lettura attuale
                </th>
                <th className="px-3 py-2 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0">
                  Consumo
                </th>
                <th className="px-3 py-2 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0">
                  Stato attuale
                </th>
                <th className="px-3 py-2 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0">
                  Media 4
                </th>
                {[1, 2, 3, 4].map((slot) => (
                  <th
                    key={slot}
                    className="px-3 py-2 text-left font-semibold border-b border-slate-200 bg-slate-50 sticky top-0"
                  >
                    Prec. {slot}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {grid.map((row, i) => {
                const previous = latestHistory(row);
                const hasEvidentHistory = row.history.some((h) =>
                  isEvidentState(h.stato_lettura)
                );
                const currentStateEvident = isEvidentState(row.current.stato);
                const historyAverage = getHistoryAverage(row);

                return (
                  <tr
                    key={row.utenza.id}
                    className={`transition-colors hover:bg-blue-50 ${
                      hasEvidentHistory || currentStateEvident
                        ? "bg-amber-50/50"
                        : "odd:bg-white even:bg-slate-50/50"
                    }`}
                  >
                    <td className="px-3 py-2 align-middle border-b border-slate-100 text-slate-700 font-medium whitespace-nowrap">
                      {row.utenza.id_user}
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-slate-100">
                      <div className="font-semibold text-slate-800 leading-tight">
                        {row.utenza.Nome} {row.utenza.Cognome}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span>Scala {row.utenza.Scala || "-"}</span>
                        <span>Mat. {row.utenza.Matricola_Contatore || "-"}</span>
                      </div>
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-slate-100 text-slate-700 whitespace-nowrap">
                      {row.utenza.Interno || "-"}
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-slate-100">
                      <input
                        type="number"
                        className="h-9 w-28 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
                        disabled={session.stato === "CHIUSA"}
                        value={row.current.valore ?? ""}
                        onChange={(e) => updateRow(i, "valore", e.target.value)}
                        placeholder="Lettura"
                      />
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-slate-100">
                      <input
                        type="number"
                        className="h-9 w-24 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
                        disabled={session.stato === "CHIUSA" || !previous}
                        value={getPossibleConsumption(row)}
                        onChange={(e) => updateConsumption(i, e.target.value)}
                        placeholder="mc"
                      />
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-slate-100">
                      <select
                        className={`h-9 w-36 rounded-lg border bg-white px-2 text-sm text-slate-800 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400 ${
                          currentStateEvident ? "border-amber-300 bg-amber-50 font-bold text-amber-800" : "border-slate-300"
                        }`}
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

                    <td className="px-3 py-2 align-middle border-b border-slate-100">
                      <div className="rounded-lg border border-slate-200 bg-white px-2 py-1">
                        <div className="text-[11px] font-semibold text-slate-500">
                          Consumo medio
                        </div>
                        <div className="text-sm font-bold text-slate-900">
                          {historyAverage === null ? "-" : `${historyAverage.toFixed(1)} mc`}
                        </div>
                      </div>
                    </td>

                    {[0, 1, 2, 3].map((slot) => {
                      const history = row.history?.[slot] ?? null;
                      const state = history?.stato_lettura || "-";
                      const historicalConsumption =
                        history?.consumo_storico === null ||
                        history?.consumo_storico === undefined ||
                        history?.consumo_storico === ""
                          ? null
                          : Number(history.consumo_storico);
                      const consumptionLabel =
                        history?.consumo_source === "fatturato"
                          ? "Fatturato"
                          : history?.consumo_source === "calcolato"
                          ? "Calcolato"
                          : "Consumo";

                      return (
                        <td
                          key={slot}
                          className="px-3 py-2 align-middle border-b border-slate-100"
                        >
                          {history ? (
                            <div
                              className={`rounded-lg border px-2 py-1.5 ${
                                isEvidentState(state)
                                  ? "border-amber-200 bg-amber-50"
                                  : "border-slate-200 bg-white"
                              }`}
                            >
                              <div className="text-[11px] font-semibold text-slate-500">
                                {formatPeriodLabel(history)}
                              </div>
                              <div className="mt-0.5 flex items-center justify-between gap-2">
                                <span className="text-sm font-bold text-slate-900">
                                  {history.valore_lettura ?? "-"}
                                </span>
                                <span
                                  className={`inline-flex min-w-8 items-center justify-center rounded-full border px-2 py-0.5 text-xs font-bold ${stateBadgeClass(state)}`}
                                  title={isEvidentState(state) ? "Stato precedente da verificare" : undefined}
                                >
                                  {state}
                                </span>
                              </div>
                              <div className="mt-1 text-[11px] font-semibold text-slate-500">
                                {consumptionLabel}:{" "}
                                <span className="text-slate-800">
                                  {historicalConsumption === null || !Number.isFinite(historicalConsumption)
                                    ? "-"
                                    : `${historicalConsumption.toFixed(1)} mc`}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-slate-400">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

        </div>

      )}

    </div>

  );

}
