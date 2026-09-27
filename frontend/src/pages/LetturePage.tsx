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
import "./letture-workspace.css";
import {
  calculateReadingConsumption,
  isInverseMeter,
  readingFromConsumption,
} from "../utils/readingConsumption";

import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

import { registerLocale } from "react-datepicker";
import { it } from "date-fns/locale/it";
import { CalendarClock, FolderOpen, RotateCcw, Trash2, Save, Loader2, AlertTriangle, MoreHorizontal } from "lucide-react";

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
  id?: string;
  selected: Date | null;
  onChange: (date: Date | null) => void | boolean;
  disabled?: boolean;
  placeholder?: string;
  periodMarkers?: Array<{
    date: Date;
    status: "BOZZA" | "CHIUSA";
  }>;
};

function ManualDatePicker({
  id,
  selected,
  onChange,
  disabled = false,
  placeholder = "gg/mm/aaaa",
  periodMarkers = [],
}: ManualDatePickerProps) {
  const [text, setText] = useState(formatManualDate(selected));
  const [hasError, setHasError] = useState(false);
  const pickerRef = useRef<DatePicker>(null);

  useEffect(() => {
    setText(formatManualDate(selected));
    setHasError(false);
  }, [selected]);

  function commitManualValue(value: string) {
    const nextText = normalizeDateText(value);

    if (!nextText) {
      setText("");
      setHasError(false);
      if (onChange(null) === false) setText(formatManualDate(selected));
      return;
    }

    const parsed = parseManualDate(nextText);

    if (!parsed) {
      setHasError(true);
      return;
    }

    setText(formatManualDate(parsed));
    setHasError(false);
    if (onChange(parsed) === false) setText(formatManualDate(selected));
  }

  const periodMarkerByDate = new Map(
    periodMarkers.map((marker) => [formatManualDate(marker.date), marker.status])
  );

  return (
    <div onKeyDownCapture={(event) => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        event.stopPropagation();
        commitManualValue(text);
        pickerRef.current?.setOpen(false);
      }
    }}>
      <DatePicker
        ref={pickerRef}
        id={id}
        selected={selected}
        onChange={(date: Date | null) => {
          setText(formatManualDate(date));
          setHasError(false);
          if (onChange(date) === false) setText(formatManualDate(selected));
        }}
        onChangeRaw={(event) => {
          if (!(event?.target instanceof HTMLInputElement)) return;
          // Commit typed dates only on Enter/blur, never while the year is incomplete.
          event.preventDefault();
          setText(event.target.value);
          setHasError(false);
        }}
        onBlur={() => commitManualValue(text)}
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
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [initialLoadAttempt, setInitialLoadAttempt] = useState(0);
  const locatorScopeRef = useRef<string | null>(null);

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

  const latestRegisteredPeriod = [...existingPeriods].sort(
    (a, b) => Number(b.period_year) - Number(a.period_year) || Number(b.period_month) - Number(a.period_month)
  ).find(
    (period) => Number(period.registered_rows || 0) > 0
  ) ?? null;

  const isLatestPeriodOpen =
    latestRegisteredPeriod !== null &&
    periodYear === Number(latestRegisteredPeriod.period_year) &&
    periodMonth === Number(latestRegisteredPeriod.period_month);

  function getPeriodLocatorDate(period: ReadingSessionSummary): Date {
    const date = parseDbDate(period.data_lettura_operatore || period.data_lettura_casa_idrica);
    return (
      date && date.getFullYear() === Number(period.period_year) && date.getMonth() + 1 === Number(period.period_month) ? date :
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
    selectPeriodDate(getPeriodLocatorDate(period));
  }

  function selectPeriodDate(date: Date | null) {
    if (date?.getTime() === triggerDate?.getTime()) return false;
    const samePeriod = date && triggerDate && date.getFullYear() === triggerDate.getFullYear() && date.getMonth() === triggerDate.getMonth();
    if (!samePeriod && dirty && !window.confirm("Sono presenti modifiche non salvate. Aprire un altro periodo?")) {
      return false;
    }
    locatorScopeRef.current = condominioId;
    setTriggerDate(date);
    return true;
  }

  async function refreshExistingPeriods() {
    const periods = await listReadingSessions(condominioId);
    setExistingPeriods(periods);
  }

  /* Load existing periods once per condominium; opening one must not create a session. */
  useEffect(() => {
    let alive = true;
    locatorScopeRef.current = null;
    lastLoadKeyRef.current = "";
    setCondominioName("");
    setExistingPeriods([]);
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
    setLoading(false);
    setLoadingPeriods(true);
    setLoadError("");

    async function initialize() {
      const [condominioResult, periodsResult] = await Promise.allSettled([
        getCondominio(condominioId),
        listReadingSessions(condominioId),
      ]);
      if (!alive) return;
      const data = condominioResult.status === "fulfilled" ? condominioResult.value : null;
      setCondominioName(data?.nome || data?.indirizzo || `ID ${condominioId}`);
      if (periodsResult.status === "fulfilled") {
        const periods = [...periodsResult.value].sort(
          (a, b) => Number(b.period_year) - Number(a.period_year) || Number(b.period_month) - Number(a.period_month)
        );
        setExistingPeriods(periods);
        locatorScopeRef.current = condominioId;
        const latest = periods.find((period) => Number(period.registered_rows || 0) > 0);
        if (latest) setTriggerDate(getPeriodLocatorDate(latest));
      } else {
        setLoadError("Impossibile caricare i periodi di lettura. Riprova prima di aprire un periodo.");
      }
      setLoadingPeriods(false);
    }
    initialize();
    return () => { alive = false; };
  }, [condominioId, initialLoadAttempt]);

  /* Ignore responses from a previously selected period or condominium. */
  useEffect(() => {
    if (locatorScopeRef.current !== condominioId) return;
    if (!triggerDate) {
      setSession(null);
      setGrid([]);
      setStates([]);
      setDataOperatore(null);
      setDataCasa(null);
      setPeriodYear(null);
      setPeriodMonth(null);
      setDirty(false);
      setEditedRowIds(new Set());
      lastLoadKeyRef.current = "";
      return;
    }
    const year = triggerDate.getFullYear();
    const month = triggerDate.getMonth() + 1;
    const key = `${condominioId}::${year}::${month}`;
    if (lastLoadKeyRef.current === key) return;
    let alive = true;
    setLoading(true);
    setLoadError("");
    setSession(null);
    setGrid([]);
    setStates([]);
    setPeriodYear(year);
    setPeriodMonth(month);

    async function loadPeriod() {
      try {
        const existing = existingPeriods.find(
          (period) => Number(period.period_year) === year && Number(period.period_month) === month
        );
        const sessionId = existing?.id || (await createOrLoadSession({
          idCondominio: condominioId, periodYear: year, periodMonth: month,
        })).session.id;
        if (!alive) return;
        const payload = await getSessionGrid(sessionId);
        if (!alive) return;
        const loaded = payload.session;
        setSession(loaded);
        setDataOperatore(parseDbDate(loaded.data_lettura_operatore) || triggerDate);
        setDataCasa(parseDbDate(loaded.data_lettura_casa_idrica));
        setStates(payload.states);
        setGrid(payload.grid);
        setDirty(false);
        setEditedRowIds(new Set());
        lastLoadKeyRef.current = key;
      } catch (err: any) {
        if (!alive) return;
        lastLoadKeyRef.current = "";
        setLoadError(err?.response?.data?.message || err?.message || "Errore caricamento periodo");
      } finally {
        if (alive) setLoading(false);
      }
    }
    loadPeriod();
    return () => { alive = false; };
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
      await refreshExistingPeriods().catch(() => undefined);

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

    <div className="readings-workspace space-y-3">
      <div className="readings-header workspace-sticky lg:sticky z-30">
        <div className="readings-heading">
          <div className="min-w-0">
            <h1>Gestione letture</h1>
            <CondominioIdentity name={condominioName} />
          </div>
          {session && (
            <div className="readings-period-state">
              <strong>{monthNames[Number(session.period_month) - 1]} {session.period_year}</strong>
              <span className={session.stato === "CHIUSA" ? "readings-status is-closed" : "readings-status"}>
                {session.stato === "CHIUSA" ? "Chiuso" : "Bozza"}
              </span>
              <details className="readings-actions">
                <summary aria-label="Azioni periodo" title="Azioni periodo"><MoreHorizontal size={20} /></summary>
                <div>
                  <button type="button" disabled={loading} onClick={handleCancelPeriod}>
                    <RotateCcw size={15} aria-hidden="true" /> Annulla periodo
                  </button>
                </div>
              </details>
            </div>
          )}
        </div>

        <div className="readings-fields">
          <div className="readings-field">
            <label htmlFor="reading-period">Apri periodo</label>
            <ManualDatePicker id="reading-period" selected={triggerDate} onChange={selectPeriodDate}
              disabled={loading || loadingPeriods || locatorScopeRef.current !== condominioId} periodMarkers={periodCalendarMarkers} />
          </div>
          <div className="readings-field">
            <label htmlFor="reading-operator-date">Lettura operatore</label>
            <ManualDatePicker id="reading-operator-date" selected={dataOperatore}
              onChange={(date) => { setDataOperatore(date); setDirty(true); }}
              disabled={!session || loading || session.stato === "CHIUSA"} />
          </div>
          <div className="readings-field">
            <label htmlFor="reading-provider-date">Casa idrica</label>
            <ManualDatePicker id="reading-provider-date" selected={dataCasa}
              onChange={(date) => { setDataCasa(date); setDirty(true); }}
              disabled={!session || loading || session.stato === "CHIUSA"} />
          </div>
          <div className="readings-save">
            <span aria-live="polite">{loading || loadingPeriods ? "Caricamento..." : dirty ? "Modifiche non salvate" : session ? "Nessuna modifica da salvare" : ""}</span>
            <button type="button" onClick={handleSave} disabled={!session || !dirty || loading || session.stato === "CHIUSA"}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Salva letture
            </button>
          </div>
        </div>

        <div className="readings-period-context">
          <div className="readings-legend" aria-label="Legenda calendario">
            <CalendarClock size={14} aria-hidden="true" />
            <span><i className="is-draft" />Bozza</span><span><i className="is-closed" />Chiuso</span>
          </div>
          {latestRegisteredPeriod ? (
            <div className="readings-latest">
              <span>Ultimo registrato: <strong>{monthNames[Number(latestRegisteredPeriod.period_month) - 1]} {latestRegisteredPeriod.period_year}</strong></span>
              <span>{Number(latestRegisteredPeriod.registered_values || 0)} {Number(latestRegisteredPeriod.registered_values || 0) === 1 ? "lettura con valore" : "letture con valore"}</span>
              {!isLatestPeriodOpen && <button type="button" disabled={loading || loadingPeriods} onClick={() => openRegisteredPeriod(latestRegisteredPeriod)}>
                <FolderOpen size={14} aria-hidden="true" /> Apri ultimo
              </button>}
            </div>
          ) : !loadingPeriods && !loadError && <span>Nessuna lettura ancora registrata</span>}
        </div>
      </div>

      {loadError && <div className="readings-load-error" role="alert">
        <AlertTriangle size={18} aria-hidden="true" /><span>{loadError}</span>
        <button type="button" onClick={() => triggerDate ? setTriggerDate(new Date(triggerDate)) : setInitialLoadAttempt((value) => value + 1)}>Riprova</button>
      </div>}
      {(loading || loadingPeriods) && <div className="readings-loading" role="status"><Loader2 size={18} className="animate-spin" /> Caricamento letture...</div>}

      {session && (
        <MobileAssignmentControls sessionId={session.id} disabled={loading || session.stato === "CHIUSA"} />
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
