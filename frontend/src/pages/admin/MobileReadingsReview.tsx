import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../api/client";

type ReviewStatus = "TO_BE_ACCEPTED" | "CONTEXT_CONFLICT" | "UPLOAD_INCOMPLETE" | "ACCEPTED" | "REJECTED";
const statuses: Array<[ReviewStatus, string]> = [
  ["TO_BE_ACCEPTED", "Da verificare"], ["CONTEXT_CONFLICT", "Conflitti"],
  ["UPLOAD_INCOMPLETE", "Upload incompleti"], ["ACCEPTED", "Accettate"], ["REJECTED", "Rifiutate"],
];

function AuthenticatedPhoto({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    api.get(`/mobile-readings/review/${id}/photo`, { responseType: "blob" }).then(({ data }) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(data);
      setUrl(objectUrl);
    }).catch(() => setUrl(null));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  return url
    ? <img src={url} alt="Foto contatore" className="h-44 w-full rounded-xl bg-slate-100 object-contain" />
    : <div className="flex h-24 items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500">Foto non disponibile</div>;
}

export default function MobileReadingsReview() {
  const [status, setStatus] = useState<ReviewStatus>("TO_BE_ACCEPTED");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [replaceCandidate, setReplaceCandidate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data } = await api.get("/mobile-readings/review", { params: { status } });
      setRows(data.submissions || []);
    } catch (e: any) { setError(e?.response?.data?.error || "Errore caricamento."); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  const condominiumGroups = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; address: string; period: string; rows: any[] }>();
    for (const row of rows) {
      const key = `${row.condominio_id}:${row.session_id}`;
      const group: { key: string; name: string; address: string; period: string; rows: any[] } = groups.get(key) || {
        key,
        name: row.condominio_nome || "Condominio senza nome",
        address: row.condominio_indirizzo || "",
        period: `${row.period_month}/${row.period_year}`,
        rows: [],
      };
      group.rows.push(row);
      groups.set(key, group);
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        rows: group.rows.sort((a, b) => Number(a.id_user || 0) - Number(b.id_user || 0)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "it", { numeric: true }));
  }, [rows]);

  async function accept(id: string, replaceExisting = false) {
    setError("");
    try {
      await api.post(`/mobile-readings/review/${id}/accept`, { replaceExisting });
      setReplaceCandidate(null); await load();
    } catch (e: any) {
      if (e?.response?.data?.code === "READING_ALREADY_EXISTS") setReplaceCandidate(id);
      setError(e?.response?.data?.error || "Lettura non accettata.");
    }
  }
  async function reject(id: string) {
    const reviewNote = window.prompt("Motivo del rifiuto:");
    if (!reviewNote?.trim()) return;
    try { await api.post(`/mobile-readings/review/${id}/reject`, { reviewNote }); await load(); }
    catch (e: any) { setError(e?.response?.data?.error || "Lettura non rifiutata."); }
  }

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold text-slate-900">Verifica letture mobili</h1>
        <p className="mt-1 text-sm text-slate-600">Nessun valore entra nelle letture definitive prima della conferma manuale.</p></div>
      <div className="flex flex-wrap gap-2">
        {statuses.map(([value, label]) => <button key={value} type="button" onClick={() => setStatus(value)}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${status === value ? "bg-slate-900 text-white" : "border bg-white text-slate-700"}`}>{label}</button>)}
        <button type="button" onClick={load} className="rounded-full border bg-white px-4 py-2 text-sm font-semibold">Aggiorna</button>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {loading && <div className="text-sm text-slate-500">Caricamento...</div>}
      {!loading && rows.length === 0 && <div className="rounded-2xl border border-dashed bg-white p-10 text-center text-slate-500">Nessuna lettura in questo stato.</div>}
      <div className="space-y-5">
        {condominiumGroups.map((group) => (
          <section key={group.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{group.name}</h2>
                <p className="text-sm text-slate-600">{group.address || "Indirizzo non disponibile"}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">Periodo {group.period}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{group.rows.length} letture</span>
              </div>
            </div>
            <div className="grid gap-4 p-4 xl:grid-cols-2">
              {group.rows.map((row) => {
                const difference = row.previous_value == null ? null : Number(row.reading_value) - Number(row.previous_value);
                return <article key={row.id} className="rounded-2xl border bg-white p-5 shadow-sm">
                  <div className="flex justify-between gap-3"><div>
                    <div className="font-bold">#{row.id_user} · Scala {row.Scala || "-"} · Interno {row.Interno || "-"}</div>
                    <div className="text-sm text-slate-600">{row.Nome} {row.Cognome}</div></div>
                    <span className="h-fit rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold">{row.workflow_status}</span></div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Precedente</div><b>{row.previous_value ?? "-"}</b></div>
                    <div className="rounded-xl bg-blue-50 p-3"><div className="text-xs text-blue-600">Proposta</div><b>{row.reading_value}</b></div>
                    <div className={`rounded-xl p-3 ${difference != null && difference < 0 ? "bg-red-50" : "bg-emerald-50"}`}><div className="text-xs text-slate-500">Differenza</div><b>{difference ?? "-"}</b></div>
                  </div>
                  <div className="mt-3 text-xs text-slate-600">Matricola: {row.meter_serial_snapshot || "-"} · Operatore: {row.operator_username} · {row.captured_at}</div>
                  {row.conflict_reason && <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">{row.conflict_reason}</div>}
                  {row.source === "PHOTO" && <div className="mt-4"><AuthenticatedPhoto id={row.id} /></div>}
                  {status === "TO_BE_ACCEPTED" && <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={() => reject(row.id)} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-bold text-red-700">Rifiuta</button>
                    {replaceCandidate === row.id
                      ? <button type="button" onClick={() => accept(row.id, true)} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white">Conferma sostituzione</button>
                      : <button type="button" onClick={() => accept(row.id)} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Accetta</button>}
                  </div>}
                </article>;
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
