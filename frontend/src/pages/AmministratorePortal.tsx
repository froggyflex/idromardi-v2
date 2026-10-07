import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Building2, LogOut, KeyRound } from "lucide-react";
import api from "../api/client";
import { clearAuthSession, getAuthUser, setAuthSession } from "../auth";
import PasswordSettings from "./admin/PasswordSettings";
import AmministratoreDocuments from "./AmministratoreDocuments";

type Condominio = { id: string; codice: number; nome: string; indirizzo: string; citta: string };
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
      <Route path="/amministratore/condomini/:id" element={<AmministratoreDocuments />} />
      <Route path="/amministratore/password" element={user?.impersonation ? <Navigate to="/amministratore" replace /> : <PasswordSettings />} />
      <Route path="*" element={<Navigate to="/amministratore" replace />} />
    </Routes></main>
  </div>;
}
