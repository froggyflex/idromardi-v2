import { useState, useEffect, useRef } from "react";
import {
  createOrLoadSession,
  getSessionGrid,
  saveSessionRows,
  closeSession,
  getCondominio,
  listReadingSessions,
  cancelReadingSession,
  cancelSessionReading,
} from "../api/letture";
import type { ReadingSessionSummary } from "../api/letture";

import { useParams } from "react-router-dom";
import type { Stato, GridRow, Session } from "../api/letture_interface";
import MobileAssignmentControls from "./components/MobileAssignmentControls";
import CondominioIdentity from "./components/CondominioIdentity";
import {
  calculateReadingConsumption,
  isInverseMeter,
  readingFromConsumption,
} from "../utils/readingConsumption";

import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

import { registerLocale } from "react-datepicker";
import { it } from "date-fns/locale/it";
import { CalendarClock, FolderOpen, RotateCcw, Trash2 } from "lucide-react";

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
  periodMarkers?: Array<{
    date: Date;
    status: "BOZZA" | "CHIUSA";
  }>;
};

function ManualDatePicker({
  selected,
  onChange,
  disabled = false,
  placeholder = "gg/mm/aaaa",
  periodMarkers = [],
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

  const periodMarkerByDate = new Map(
    periodMarkers.map((marker) => [formatManualDate(marker.date), marker.status])
  );

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
        wrapperClassName="w-full"
        className={`input w-full ${hasError ? "border-red-400 ring-2 ring-red-100" : ""}`}
        disabled={disabled}
        isClearable={!disabled}
        shouldCloseOnSelect
        showPopperArrow={false}
        calendarStartDay={1}
        dayClassName={(date) => {
          const status = periodMarkerByDate.get(formatManualDate(date));
          if (status === "CHIUSA") return "reading-period-day reading-period-day--closed";
          if (status === "BOZZA") return "reading-period-day reading-period-day--draft";
          return "";
        }}
        renderDayContents={(day, date) => {
          const status = date
            ? periodMarkerByDate.get(formatManualDate(date))
            : undefined;
          const title = status
            ? `Periodo già presente (${status === "CHIUSA" ? "chiuso" : "bozza"})`
            : undefined;
          return <span title={title}>{day}</span>;
        }}
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
  const [editedRowIds, setEditedRowIds] = useState<Set<string>>(() => new Set());

  const [condominioName, setCondominioName] = useState("");
  const [existingPeriods, setExistingPeriods] = useState<ReadingSessionSummary[]>([]);

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

  const periodCalendarMarkers = existingPeriods.flatMap((period) => {
    const date = parseDbDate(
      period.data_lettura_operatore || period.data_lettura_casa_idrica
    );
    return date ? [{ date, status: period.stato }] : [];
  });

  const latestRegisteredPeriod = existingPeriods.find(
    (period) => Number(period.registered_rows || 0) > 0
  ) ?? null;

  const isLatestPeriodOpen =
    latestRegisteredPeriod !== null &&
    periodYear === Number(latestRegisteredPeriod.period_year) &&
    periodMonth === Number(latestRegisteredPeriod.period_month);

  function getPeriodLocatorDate(period: ReadingSessionSummary): Date {
    return (
      parseDbDate(
        period.data_lettura_operatore || period.data_lettura_casa_idrica
      ) ||
      new Date(
        Number(period.period_year),
        Number(period.period_month) - 1,
        1,
        12,
        0,
        0
      )
    );
  }

  function openRegisteredPeriod(period: ReadingSessionSummary) {
    if (dirty && !window.confirm("Sono presenti modifiche non salvate. Aprire un altro periodo?")) {
      return;
    }

    setTriggerDate(getPeriodLocatorDate(period));
  }

  async function refreshExistingPeriods() {
    const periods = await listReadingSessions(condominioId);
    setExistingPeriods(periods);
  }

  /* ---------------- LOAD CONDOMINIO ---------------- */

  useEffect(() => {

    let alive = true;
    setCondominioName("");

    async function fetchCondominio() {

      try {

        const [data, periods] = await Promise.all([
          getCondominio(condominioId),
          listReadingSessions(condominioId),
        ]);

        if (!alive) return;

        setCondominioName(data.nome || data.indirizzo || `ID ${condominioId}`);
        setExistingPeriods(periods);

      } catch {

        if (!alive) return;

        setCondominioName(`ID ${condominioId} (nome non disponibile)`);

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
    setExistingPeriods([]);

    setDataOperatore(null);
    setDataCasa(null);

    setPeriodYear(null);
    setPeriodMonth(null);

    setTriggerDate(null);

    setDirty(false);
    setEditedRowIds(new Set());

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
        setEditedRowIds(new Set());

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

    const fullDate =
      history.data_lettura_operatore || history.data_lettura_casa_idrica;
    const parsedDate = parseDbDate(fullDate);

    if (parsedDate) {
      return formatManualDate(parsedDate);
    }

    const month = monthNames[Number(history.period_month) - 1] ?? history.period_month;
    return `${month} ${history.period_year}`;
  }

  function isEvidentState(value?: string | null) {
    return ["Y", "B", "C"].includes(String(value || "").toUpperCase());
  }

  function stateBadgeClass(value?: string | null) {
    const code = String(value || "").toUpperCase();

    if (["Y", "B"].includes(code)) {
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
    const consumption = calculateReadingConsumption(
      current,
      previous,
      row.current.stato,
      isInverseMeter(row.utenza)
    );
    return consumption === null ? "" : String(consumption);
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
    const rowId = grid[index].utenza.id;

    setGrid((currentGrid) =>
      currentGrid.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              current: {
                ...row.current,
                [field]: field === "valore" ? (value === "" ? null : Number(value)) : value,
              },
            }
          : row
      )
    );
    setEditedRowIds((currentIds) => new Set(currentIds).add(rowId));
    setDirty(true);

  }

  function updateState(index: number, value: string) {
    const normalizedState = value.trim().toUpperCase();
    const previousValue = latestHistory(grid[index])?.valore_lettura;

    if (
      normalizedState === "B" &&
      (previousValue === null || previousValue === undefined)
    ) {
      alert("Lo stato B richiede una lettura precedente disponibile.");
      return;
    }

    const rowId = grid[index].utenza.id;
    setGrid((currentGrid) =>
      currentGrid.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              current: {
                ...row.current,
                stato: normalizedState,
                valore:
                  normalizedState === "B"
                    ? Number(previousValue)
                    : row.current.valore,
              },
            }
          : row
      )
    );
    setEditedRowIds((currentIds) => new Set(currentIds).add(rowId));
    setDirty(true);
  }

  function updateConsumption(index: number, value: string) {
    const rowId = grid[index].utenza.id;
    const previous = latestHistory(grid[index])?.valore_lettura;
    const nextValue = readingFromConsumption(
      value,
      previous,
      grid[index].current.stato,
      isInverseMeter(grid[index].utenza)
    );

    setGrid((currentGrid) =>
      currentGrid.map((row, rowIndex) =>
        rowIndex === index
          ? { ...row, current: { ...row.current, valore: nextValue } }
          : row
      )
    );
    setEditedRowIds((currentIds) => new Set(currentIds).add(rowId));
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
      await refreshExistingPeriods().catch(() => undefined);

      const editedRows = grid.filter((row) => editedRowIds.has(row.utenza.id));

      if (editedRows.length > 0) {
        await saveSessionRows(
          session.id,
          editedRows.map((g) => ({
          idUtenza: g.utenza.id,
          valore: g.current.valore,
          stato: g.current.stato
          }))
        );
      }

      setDirty(false);
      setEditedRowIds(new Set());

      const missingReadings = grid.filter(
        (row) => row.current.valore === null || row.current.valore === undefined
      ).length;
      alert(
        missingReadings > 0
          ? `Salvataggio parziale completato: ${editedRows.length} righe aggiornate, ${missingReadings} senza lettura.`
          : "Sessione salvata"
      );

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
    await refreshExistingPeriods().catch(() => undefined);

    alert("Session closed");

  }

  async function handleCancelReading(row: GridRow) {
    if (!session || !row.current.persisted) return;
    const userLabel = [row.utenza.Nome, row.utenza.Cognome]
      .filter(Boolean)
      .join(" ") || `ID ${row.utenza.id_user ?? "-"}`;
    if (
      !window.confirm(
        `Annullare la lettura di ${userLabel}? La riga tornerà compilabile. L'operazione sarà bloccata se il periodo è già usato in fatturazione.`
      )
    ) return;

    try {
      setLoading(true);
      await cancelSessionReading(session.id, row.utenza.id);
      const payload = await getSessionGrid(session.id);
      const pendingRows = new Map(
        grid
          .filter(
            (candidate) =>
              candidate.utenza.id !== row.utenza.id &&
              editedRowIds.has(candidate.utenza.id)
          )
          .map((candidate) => [candidate.utenza.id, candidate.current])
      );
      const refreshedGrid = (payload.grid as GridRow[]).map((candidate) => {
        const pending = pendingRows.get(candidate.utenza.id);
        return pending
          ? { ...candidate, current: { ...candidate.current, ...pending } }
          : candidate;
      });
      setSession(payload.session);
      setStates(payload.states);
      setGrid(refreshedGrid);
      setEditedRowIds((currentIds) => {
        const next = new Set(currentIds);
        next.delete(row.utenza.id);
        setDirty(next.size > 0);
        return next;
      });
      await refreshExistingPeriods();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.response?.data?.message || err?.message || "Impossibile annullare la lettura");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancelPeriod() {
    if (!session || !periodYear || !periodMonth) return;
    const label = `${monthNames[periodMonth - 1]} ${periodYear}`;
    if (
      !window.confirm(
        `Annullare l'intero periodo ${label}? Tutte le letture del periodo saranno eliminate. L'operazione non è consentita se esistono fatture, acconti o lavori mobile collegati.`
      )
    ) return;

    try {
      setLoading(true);
      await cancelReadingSession(session.id);
      setSession(null);
      setGrid([]);
      setStates([]);
      setDataOperatore(null);
      setDataCasa(null);
      setPeriodYear(null);
      setPeriodMonth(null);
      setTriggerDate(null);
      setDirty(false);
      setEditedRowIds(new Set());
      lastLoadKeyRef.current = "";
      await refreshExistingPeriods();
      alert(`Periodo ${label} annullato. Ora puoi inserirlo nuovamente.`);
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.response?.data?.message || err?.message || "Impossibile annullare il periodo");
    } finally {
      setLoading(false);
    }
  }

  /* ---------------- UI ---------------- */

  return (

    <div className="space-y-4">

    <div className="space-y-3">

      <h1 className="text-lg font-semibold">Inserimento Letture</h1>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
          </span>

          {latestRegisteredPeriod ? (
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase text-slate-500">
                Ultimo periodo con letture registrate
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-semibold text-slate-900">
                  {monthNames[Number(latestRegisteredPeriod.period_month) - 1]} {latestRegisteredPeriod.period_year}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                    latestRegisteredPeriod.stato === "CHIUSA"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}
                >
                  {latestRegisteredPeriod.stato === "CHIUSA" ? "Chiuso" : "Bozza"}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                <span>
                  Lettura operatore: {formatManualDate(parseDbDate(latestRegisteredPeriod.data_lettura_operatore)) || "non indicata"}
                </span>
                <span>
                  {Number(latestRegisteredPeriod.registered_values || 0)} letture con valore
                </span>
                {Number(latestRegisteredPeriod.registered_rows || 0) !==
                  Number(latestRegisteredPeriod.registered_values || 0) && (
                  <span>
                    {Number(latestRegisteredPeriod.registered_rows || 0)} righe salvate
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[11px] font-semibold uppercase text-slate-500">
                Ultimo periodo con letture registrate
              </div>
              <div className="text-sm text-slate-700">
                Nessuna lettura ancora registrata per questo condominio.
              </div>
            </div>
          )}
        </div>

        {latestRegisteredPeriod && (
          <button
            type="button"
            onClick={() => openRegisteredPeriod(latestRegisteredPeriod)}
            disabled={loading || isLatestPeriodOpen}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            {isLatestPeriodOpen ? "Periodo aperto" : "Apri periodo"}
          </button>
        )}
      </div>

    </div>

    <div className="workspace-sticky z-30 space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:sticky">
      <CondominioIdentity name={condominioName} />
      {/* TOP ROW */}

      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-[180px_140px_180px_180px_minmax(0,1fr)]">

        {/* LOCATOR */}

        <div className="space-y-1">
          <label className="text-xs text-slate-600">
            Apri periodo
          </label>

          <ManualDatePicker
            selected={triggerDate}
            onChange={(date: Date | null) => setTriggerDate(date)}
            disabled={loading}
            periodMarkers={periodCalendarMarkers}
          />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> Bozza
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Chiuso
            </span>
          </div>
        </div>

        {/* PERIOD INFO */}

        <div className="space-y-1">
          <div className="text-xs text-slate-600">Periodo aperto</div>
          <div className="flex min-h-10 flex-wrap items-center gap-x-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium">
            <span>{periodMonth ? monthNames[periodMonth - 1] : "-"}</span>
            <span>{periodYear ?? ""}</span>
          </div>
        </div>

      {/* SECOND ROW */}

      {session && (

        <>

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

          <div className="flex flex-wrap items-center gap-2 lg:pt-5">

            <button
              disabled={!dirty || loading || session?.stato === "CHIUSA"}
              onClick={handleSave}
              className="px-4 py-2 bg-green-600 text-white rounded-xl disabled:opacity-40"
            >
              Salva
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={handleCancelPeriod}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-40"
              title="Elimina in sicurezza tutte le letture di questo periodo"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Annulla periodo
            </button>

            {loading && (
              <div className="text-xs text-slate-500">
                Caricamento...
              </div>
            )}

          </div>

        </>

      )}

      </div>

    </div>

      {session && (
        <MobileAssignmentControls
          sessionId={session.id}
          disabled={loading || session.stato === "CHIUSA"}
        />
      )}

      {/* GRID */}

      {session && (

        <div className="workspace-table-shell overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:p-3">

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="compact-data-table w-full min-w-[1490px] table-fixed border-separate border-spacing-0 text-sm">
            <colgroup>
              <col style={{ width: 48 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 64 }} />
              <col style={{ width: 128 }} />
              <col style={{ width: 112 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 128 }} />
              <col style={{ width: 92 }} />
              <col span={4} />
            </colgroup>
            <thead className="sticky top-0 z-20 bg-slate-100">
              <tr className="text-slate-700">
                <th className="sticky left-0 top-0 z-30 border-b border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold">
                  Id
                </th>
                <th className="sticky left-12 top-0 z-30 border-b border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold shadow-[2px_0_0_0_rgb(226_232_240)]">
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
                <th className="px-3 py-2 text-left font-semibold border-b border-slate-200 bg-slate-100 sticky top-0">
                  Azioni
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
                        ? "bg-amber-50"
                        : "odd:bg-white even:bg-slate-50"
                    }`}
                  >
                    <td className="sticky left-0 z-10 whitespace-nowrap border-b border-slate-100 bg-inherit px-3 py-2 align-middle font-medium text-slate-700">
                      {row.utenza.id_user}
                    </td>

                    <td className="sticky left-12 z-10 break-words border-b border-slate-100 bg-inherit px-3 py-2 align-middle shadow-[2px_0_0_0_rgb(226_232_240)]">
                      <div className="font-semibold text-slate-800 leading-tight">
                        {row.utenza.Nome} {row.utenza.Cognome}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span>Scala {row.utenza.Scala || "-"}</span>
                        <span>Mat. {row.utenza.Matricola_Contatore || "-"}</span>
                        {isInverseMeter(row.utenza) && (
                          <span
                            className="rounded-full border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-bold uppercase text-cyan-700"
                            title="Contatore inverso: le letture restano nel proprio periodo e il consumo viene calcolato dalla precedente meno l'attuale."
                          >
                            Inverso
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-slate-100 text-slate-700 whitespace-nowrap">
                      {row.utenza.Interno || "-"}
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-slate-100">
                      <input
                        type="number"
                        className="h-9 w-full max-w-28 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
                        disabled={session.stato === "CHIUSA" || row.current.stato === "B"}
                        value={row.current.valore ?? ""}
                        onChange={(e) => updateRow(i, "valore", e.target.value)}
                        placeholder="Lettura"
                      />
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-slate-100">
                      <input
                        type="number"
                        className="h-9 w-full max-w-24 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
                        disabled={session.stato === "CHIUSA" || !previous || row.current.stato === "B"}
                        value={getPossibleConsumption(row)}
                        onChange={(e) => updateConsumption(i, e.target.value)}
                        placeholder="mc"
                      />
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-slate-100">
                      <select
                        className={`h-9 w-full max-w-36 rounded-lg border bg-white px-2 text-sm text-slate-800 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400 ${
                          currentStateEvident ? "border-amber-300 bg-amber-50 font-bold text-amber-800" : "border-slate-300"
                        }`}
                        disabled={session.stato === "CHIUSA"}
                        value={row.current.stato}
                        onChange={(e) => updateState(i, e.target.value)}
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

                    <td className="px-3 py-2 align-middle border-b border-slate-100">
                      {row.current.persisted ? (
                        <button
                          type="button"
                          onClick={() => handleCancelReading(row)}
                          disabled={loading}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 transition hover:bg-red-50 disabled:opacity-40"
                          title="Annulla questa lettura"
                          aria-label={`Annulla lettura utente ${row.utenza.id_user ?? ""}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Non salvata</span>
                      )}
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
