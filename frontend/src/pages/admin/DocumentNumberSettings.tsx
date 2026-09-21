import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Hash, Loader2, RefreshCw, Save } from "lucide-react";
import api from "../../api/client";

type DocumentCounter = {
  documentType: "PROFORMA" | "FATTURA" | "PAYMENT";
  label: string;
  prefix: string;
  anno: number;
  currentValue: number;
  issuedMax: number;
  nextValue: number;
  synchronized: boolean;
  duplicateCounterRows?: number;
  nextConflict?: {
    numero: string;
    progressivo: number;
    dataDocumento?: string | null;
    stato?: string | null;
  } | null;
  updatedAt?: string | null;
};

const currentYear = new Date().getFullYear();

export default function DocumentNumberSettings() {
  const [year, setYear] = useState(currentYear);
  const [counters, setCounters] = useState<DocumentCounter[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadCounters = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/financial-summary/document-counters", {
        params: { anno: year },
      });
      const rows = Array.isArray(response.data?.counters)
        ? response.data.counters
        : [];
      setCounters(rows);
      setDrafts(
        Object.fromEntries(
          rows.map((row: DocumentCounter) => [
            row.documentType,
            String(row.currentValue),
          ])
        )
      );
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.error ||
          "Impossibile caricare le numerazioni dei documenti."
      );
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void loadCounters();
  }, [loadCounters]);

  async function saveCounter(counter: DocumentCounter) {
    const value = Number(drafts[counter.documentType]);
    setError("");
    setMessage("");

    if (!Number.isInteger(value) || value < 0) {
      setError("Inserisci un numero intero maggiore o uguale a zero.");
      return;
    }

    try {
      setSavingType(counter.documentType);
      const response = await api.put(
        `/financial-summary/document-counters/${counter.documentType}/${year}`,
        { currentValue: value }
      );
      const savedCounter = response.data?.counter;
      setMessage(
        `${counter.label}: contatore aggiornato. Il prossimo numero sarà ${
          savedCounter?.nextValue ?? value + 1
        }.`
      );
      await loadCounters();
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.error ||
          "Impossibile aggiornare la numerazione."
      );
    } finally {
      setSavingType(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-blue-700">
            <Hash className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-bold uppercase tracking-[0.16em]">
              Impostazioni
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            Numerazione documenti
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Gestisci l'ultimo numero assegnato per ogni tipo di documento. Le modifiche
            valgono solo per i documenti emessi successivamente.
          </p>
        </div>

        <div className="flex items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">
              Anno
            </span>
            <input
              type="number"
              min="2000"
              max="9999"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="h-10 w-28 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void loadCounters()}
            disabled={loading}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            title="Aggiorna numerazioni"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {message && (
        <div className="border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[minmax(180px,1.4fr)_minmax(150px,1fr)_minmax(130px,0.8fr)_minmax(130px,0.8fr)_52px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-[11px] font-bold uppercase text-slate-500 max-md:hidden">
          <div>Tipo documento</div>
          <div>Ultimo assegnato</div>
          <div>Massimo attivo</div>
          <div>Prossimo numero</div>
          <div />
        </div>

        {loading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Caricamento numerazioni...
          </div>
        ) : (
          counters.map((counter) => {
            const draftValue = Number(drafts[counter.documentType]);
            const nextPreview = Number.isInteger(draftValue)
              ? draftValue + 1
              : counter.nextValue;
            const sequenceRewind =
              Number.isInteger(draftValue) && draftValue < counter.issuedMax;

            return (
              <div
                key={counter.documentType}
                className="grid gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0 md:grid-cols-[minmax(180px,1.4fr)_minmax(150px,1fr)_minmax(130px,0.8fr)_minmax(130px,0.8fr)_52px] md:items-center"
              >
                <div>
                  <div className="font-semibold text-slate-900">{counter.label}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    Prefisso {counter.prefix}, anno {counter.anno}
                  </div>
                </div>

                <label>
                  <span className="mb-1 block text-[10px] font-bold uppercase text-slate-500 md:hidden">
                    Ultimo assegnato
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={drafts[counter.documentType] ?? ""}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [counter.documentType]: event.target.value,
                      }))
                    }
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500 md:hidden">
                    Massimo attivo
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold text-slate-700 md:mt-0">
                    {counter.issuedMax}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500 md:hidden">
                    Prossimo numero
                  </div>
                  <div className="mt-1 font-mono text-sm font-bold text-blue-700 md:mt-0">
                    {counter.prefix}-{String(nextPreview).padStart(6, "0")}
                  </div>
                  {sequenceRewind && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Sequenza arretrata: il prossimo numero verrà controllato
                    </div>
                  )}
                  {counter.nextConflict && draftValue === counter.currentValue && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-red-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Numero già presente: {counter.nextConflict.progressivo}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void saveCounter(counter)}
                  disabled={savingType === counter.documentType}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  title={`Salva contatore ${counter.label}`}
                >
                  {savingType === counter.documentType ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                </button>
              </div>
            );
          })
        )}
      </section>

      <p className="text-xs leading-5 text-slate-500">
        Il valore indica l'ultimo progressivo assegnato ed è la fonte della prossima
        numerazione. Il massimo attivo è mostrato solo come riferimento; i documenti annullati
        non bloccano il riutilizzo del numero. Prima del salvataggio e dell'emissione viene
        verificato che il numero successivo non appartenga a un documento attivo.
      </p>
    </div>
  );
}
