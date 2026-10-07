import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Building2, FileText, LogOut, KeyRound } from "lucide-react";
import api from "../api/client";
import { clearAuthSession, getAuthUser, setAuthSession } from "../auth";
import PasswordSettings from "./admin/PasswordSettings";

type Condominio = { id: string; codice: number; nome: string; indirizzo: string; citta: string };
type Document = { id: string; source: string; document_type: string; filename: string; created_at: string; period_label?: string };
const errorMessage = (error: any) => error?.response?.data?.error || "Impossibile caricare i dati. Riprova.";

function Condomini() {
  const [items, setItems] = useState<Condominio[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api.get("/amministratore/condomini").then(({ data }) => { if (active) setItems(data.condomini); })
      .catch(error => { if (active) setError(errorMessage(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <div>
    <h1 className="text-2xl font-bold text-slate-900">I tuoi condomini</h1>
    <p className="mt-2 text-slate-600">Consulta i prospetti e le bollette dei condomini assegnati al tuo account.</p>
    {error && <p role="alert" className="mt-6 text-red-700">{error}</p>}
    {loading ? <p className="mt-6">Caricamento…</p> : !error && !items.length ? <p className="mt-6 rounded-xl border bg-white p-6">Non hai ancora condomini assegnati. Contatta Idromardi.</p> : null}
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map(item => <Link key={item.id} to={`/amministratore/condomini/${item.id}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-blue-400">
      <Building2 className="mb-4 text-blue-600" /><h2 className="font-bold text-slate-900">{item.nome}</h2>
      <p className="mt-2 text-sm text-slate-600">{item.indirizzo} · {item.citta}</p><p className="mt-4 text-sm font-semibold text-blue-700">Consulta documenti →</p>
    </Link>)}</div>
  </div>;
}

function Documents() {
  const { id } = useParams();
  const [condominio, setCondominio] = useState<Condominio | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState("");
  useEffect(() => {
    let active = true;
    setCondominio(null); setDocuments([]); setError("");
    api.get(`/amministratore/condomini/${id}/documents`).then(({ data }) => { if (active) { setCondominio(data.condominio); setDocuments(data.documents); } })
      .catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [id]);
  async function openDocument(doc: Document) {
    const key = `${doc.source}:${doc.id}`;
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setOpening(key); setError("");
    try {
      const { data } = await api.get(`/amministratore/condomini/${id}/documents/${doc.source}/${doc.id}/view`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      if (tab) tab.location.href = url;
      else { const link = document.createElement("a"); link.href = url; link.download = doc.filename; link.click(); }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { tab?.close(); setError("Impossibile aprire il documento. Riprova o contatta Idromardi."); }
    finally { setOpening(""); }
  }
  return <div>
    <Link to="/amministratore" className="text-sm font-semibold text-blue-700">← I tuoi condomini</Link>
    <h1 className="mt-4 text-2xl font-bold text-slate-900">{condominio?.nome || "Documenti del condominio"}</h1>
    {condominio && <p className="mt-2 text-slate-600">{condominio.indirizzo} · {condominio.citta}</p>}
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    {!condominio && !error && <p className="mt-6">Caricamento…</p>}
    {condominio && ["prospetto", "bolletta"].map(group => {
      const items = documents.filter(doc => group === "prospetto" ? doc.document_type.startsWith("prospetto") : !doc.document_type.startsWith("prospetto"));
      return <section key={group} className="mt-8"><h2 className="text-lg font-bold text-slate-900">{group === "prospetto" ? "Prospetti generati" : "Bollette"}</h2>
        {!items.length && <p className="mt-3 text-sm text-slate-500">Nessun documento disponibile.</p>}
        <div className="mt-3 space-y-3">{items.map(doc => <div key={`${doc.source}:${doc.id}`} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex min-w-0 items-center gap-3"><FileText className="shrink-0 text-blue-600" /><div className="min-w-0"><p className="break-all font-semibold text-slate-800">{doc.filename}</p><p className="mt-1 text-xs text-slate-500">{doc.period_label || ""} {doc.created_at ? `· ${new Date(doc.created_at).toLocaleDateString("it-IT")}` : ""}</p></div></div>
          <button disabled={Boolean(opening)} onClick={() => void openDocument(doc)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{opening === `${doc.source}:${doc.id}` ? "Apertura…" : "Apri PDF"}</button>
        </div>)}</div>
      </section>;
    })}
  </div>;
}

export default function AmministratorePortal() {
  const user = getAuthUser();
  const [error, setError] = useState("");
  const [returning, setReturning] = useState(false);
  async function returnToAdmin() {
    setReturning(true); setError("");
    try { const { data } = await api.post("/auth/impersonation/end"); setAuthSession(data.token, data.user); window.location.href = "/admin/amministratori"; }
    catch (error) { setError(errorMessage(error)); setReturning(false); }
  }
  return <div className="min-h-screen bg-slate-50">
    {user?.impersonation && <div role="status" className="flex flex-wrap items-center justify-between gap-3 bg-amber-100 px-6 py-3 text-sm text-amber-900"><span>Assistenza: stai visualizzando l’account di <strong>{user.username}</strong>. Accesso in sola lettura · durata massima 1 ora.</span><button disabled={returning} className="rounded-lg border border-amber-400 px-3 py-2 font-semibold disabled:opacity-50" onClick={() => void returnToAdmin()}>{returning ? "Rientro…" : "Torna all’account operatore"}</button></div>}
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5"><Link to="/amministratore" className="text-xl font-bold text-blue-700">Idromardi <span className="ml-2 text-sm font-normal text-slate-500">Area amministratore</span></Link><div className="flex flex-wrap items-center gap-4 text-sm"><span className="font-semibold text-slate-700">{user?.username}</span>{!user?.impersonation && <Link to="/amministratore/password" className="flex items-center gap-2 text-slate-600"><KeyRound size={16} />Password</Link>}<button className="flex items-center gap-2 text-slate-600" onClick={() => { clearAuthSession(); window.location.href = "/login"; }}><LogOut size={16} />Esci</button></div></div></header>
    <main className="mx-auto max-w-6xl px-6 py-8">{error && <p role="alert" className="mb-4 text-red-700">{error}</p>}<Routes>
      <Route path="/amministratore" element={<Condomini />} />
      <Route path="/amministratore/condomini/:id" element={<Documents />} />
      <Route path="/amministratore/password" element={user?.impersonation ? <Navigate to="/amministratore" replace /> : <PasswordSettings />} />
      <Route path="*" element={<Navigate to="/amministratore" replace />} />
    </Routes></main>
  </div>;
}
