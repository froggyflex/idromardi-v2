import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/client";

type MissingCondominio = {
  id: string;
  codice?: number | string;
  nome?: string;
  indirizzo?: string;
  indirizzo_ricerca?: string;
  cap?: string;
  citta?: string;
  latitude?: number | null;
  longitude?: number | null;
};

type GeocodeResult = {
  totalMissing: number;
  updated: number;
  failed: number;
  failures?: Array<{
    codice?: number | string;
    nome?: string;
    indirizzo?: string;
    citta?: string;
    reason?: string;
  }>;
};

const BUILDING_META_RE =
  /\b(is|isolato|sc|scala|lotto|palazzo|palazzina|fabbricato|interno|int)\.?\b/i;

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function suggestedLookupAddress(value: unknown) {
  const raw = String(value || "").trim();
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  let base = raw;

  if (parts.length > 1) {
    const kept: string[] = [];

    for (const part of parts) {
      if (BUILDING_META_RE.test(part)) break;
      kept.push(part);
    }

    base = kept.length ? kept.join(", ") : parts[0];
  }

  return base
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bp\.?\s*co\b/gi, "Parco")
    .replace(/\b(is|isolato|sc|scala|lotto|palazzo|palazzina|fabbricato|interno|int)\.?\s+[a-z0-9/.-]+\b/gi, " ")
    .replace(/\b(gas|utenze condominiali)\b/gi, " ")
    .replace(/[-,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function weakReason(row: MissingCondominio) {
  const address = String(row.indirizzo || "").trim();
  const city = String(row.citta || "").trim();
  const cap = String(row.cap || "").trim();

  if (!address) return "Indirizzo mancante";
  if (!city) return "Citta mancante";
  if (!/^\d{5}$/.test(cap)) return "CAP mancante o non valido";
  if (address.split(/\s+/).length < 2) return "Indirizzo troppo generico";
  if (/^(prova|aluzzi|palazzina|utenze condominiali)/i.test(address)) {
    return "Descrizione non geocodificabile";
  }

  return "Da correggere o verificare";
}

function hasMissingCoordinates(row: MissingCondominio) {
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);

  return (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat === 0 ||
    lng === 0
  );
}

export default function AdminTools() {
  const [loading, setLoading] = useState(false);
  const [loadingMissing, setLoadingMissing] = useState(true);
  const [result, setResult] = useState<GeocodeResult | null>(null);
  const [missingRows, setMissingRows] = useState<MissingCondominio[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  async function loadMissing() {
    try {
      setLoadingMissing(true);
      try {
        const res = await api.get("/admin/geocode-condomini/missing");
        setMissingRows(res.data?.rows || []);
        return;
      } catch (err: any) {
        if (err?.response?.status !== 404) {
          throw err;
        }
      }

      const listRes = await api.get("/condomini", {
        params: { page: 1, limit: 500, search: "" },
      });
      const listRows: MissingCondominio[] = listRes.data?.data || [];

      const detailedRows = await Promise.all(
        listRows.map(async (row) => {
          if ("latitude" in row && "longitude" in row && "cap" in row) {
            return row;
          }

          try {
            const detailRes = await api.get(`/condomini/${row.id}`);
            return detailRes.data;
          } catch {
            return row;
          }
        })
      );

      setMissingRows(
        detailedRows
          .filter((row: any) => (row.stato || "ATTIVO") === "ATTIVO")
          .filter(hasMissingCoordinates)
          .map((row: any) => ({
            ...row,
            indirizzo_ricerca: row.indirizzo_ricerca || suggestedLookupAddress(row.indirizzo),
          }))
          .sort((a: any, b: any) => Number(a.codice || 0) - Number(b.codice || 0))
      );
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          "Errore durante il caricamento dei condomini da correggere."
      );
    } finally {
      setLoadingMissing(false);
    }
  }

  useEffect(() => {
    loadMissing();
  }, []);

  const filteredRows = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return missingRows;

    return missingRows.filter((row) =>
      normalize([row.codice, row.nome, row.indirizzo, row.cap, row.citta].join(" ")).includes(
        needle
      )
    );
  }, [missingRows, query]);

  const handleGeocode = async () => {
    setLoading(true);
    setResult(null);
    setError("");

    try {
      const res = await api.post("/admin/geocode-condomini");

      setResult(res.data);
      await loadMissing();
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          "Errore durante la geolocalizzazione."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-lg font-semibold text-slate-900">Geolocalizzazione</h2>
          <p className="mt-1 text-sm text-slate-500">
            Aggiorna automaticamente le coordinate e controlla gli indirizzi rimasti da correggere.
          </p>
        </div>

        <div className="space-y-5 p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <button
              onClick={handleGeocode}
              disabled={loading}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
            >
              {loading ? "Geolocalizzazione in corso..." : "Geolocalizza condomini mancanti"}
            </button>

            <button
              type="button"
              onClick={loadMissing}
              disabled={loadingMissing}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            >
              Aggiorna lista
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SummaryCard
              label="Da correggere"
              value={loadingMissing ? "-" : String(missingRows.length)}
              tone="slate"
            />
            <SummaryCard
              label="Aggiornati ultimo tentativo"
              value={result ? String(result.updated) : "-"}
              tone="emerald"
            />
            <SummaryCard
              label="Non trovati ultimo tentativo"
              value={result ? String(result.failed) : "-"}
              tone="amber"
            />
          </div>

          {result?.failures?.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Dopo l'ultimo tentativo sono rimasti indirizzi da correggere manualmente. La lista sotto e gia aggiornata.
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Correzioni manuali richieste
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Apri il condominio, correggi indirizzo, CAP o citta, poi rilancia la geolocalizzazione.
            </p>
          </div>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca codice, nome, indirizzo..."
            className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 lg:w-80"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>Codice</Th>
                <Th>Condominio</Th>
                <Th>Indirizzo attuale</Th>
                <Th>Ricerca usata</Th>
                <Th>CAP</Th>
                <Th>Citta</Th>
                <Th>Motivo</Th>
                <Th>Azione</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loadingMissing ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    Caricamento lista...
                  </td>
                </tr>
              ) : filteredRows.length ? (
                filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <Td className="font-semibold text-slate-900">{row.codice || "-"}</Td>
                    <Td>
                      <div className="max-w-[260px] truncate font-semibold text-slate-900">
                        {row.nome || "-"}
                      </div>
                    </Td>
                    <Td>
                      <div className="max-w-[360px] truncate text-slate-700">
                        {row.indirizzo || "-"}
                      </div>
                    </Td>
                    <Td>
                      <div className="max-w-[280px] truncate font-semibold text-blue-700">
                        {row.indirizzo_ricerca || suggestedLookupAddress(row.indirizzo) || "-"}
                      </div>
                    </Td>
                    <Td>{row.cap || "-"}</Td>
                    <Td>{row.citta || "-"}</Td>
                    <Td>
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                        {weakReason(row)}
                      </span>
                    </Td>
                    <Td>
                      <Link
                        to={`/condomini/${row.id}/edit`}
                        className="inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Correggi
                      </Link>
                    </Td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-emerald-700">
                    Nessun condominio richiede correzione manuale.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "slate" | "emerald" | "amber";
}) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
  };

  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 text-slate-600 ${className}`}>{children}</td>;
}
