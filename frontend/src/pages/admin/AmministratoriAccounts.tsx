import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import api from "../../api/client";
import { setAuthSession } from "../../auth";

type Condominio = { id: string; nome: string; codice: number; indirizzo: string };
type Account = { id: string; username: string; role: string; mustChangePassword: boolean; condominioIds: string[] };
const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const buttonClass = "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

function AssignmentPicker({ condomini, selected, onChange, disabled }: { condomini: Condominio[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [search, setSearch] = useState("");
  const filtered = condomini.filter(item => `${item.nome} ${item.indirizzo} ${item.codice}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="space-y-3">
    <input aria-label="Cerca condomini da assegnare" placeholder="Cerca nome, indirizzo o codice" className={inputClass} value={search} onChange={event => setSearch(event.target.value)} />
    <p className="text-xs text-slate-500">{selected.length} condomini selezionati</p>
    <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">{filtered.map(item => <label key={item.id} className="flex cursor-pointer items-start gap-3 border-b border-slate-100 p-3 text-sm last:border-0">
      <input type="checkbox" className="mt-1" disabled={disabled} checked={selected.includes(item.id)} onChange={event => onChange(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />
      <span><strong>{item.nome}</strong><span className="block text-xs text-slate-500">Cod. {item.codice} · {item.indirizzo}</span></span>
    </label>)}{!filtered.length && <p className="p-3 text-sm text-slate-500">Nessun condominio trovato.</p>}</div>
  </div>;
}

export default function AmministratoriAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [condomini, setCondomini] = useState<Condominio[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState("");
  const [assigned, setAssigned] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function load() {
    const [users, buildings] = await Promise.all([api.get("/auth/users"), api.get("/auth/condomini")]);
    setAccounts(users.data.users.filter((user: Account) => user.role === "AMMINISTRATORE")); setCondomini(buildings.data.condomini);
  }
  useEffect(() => { load().catch(error => setError(error?.response?.data?.error || "Impossibile caricare gli account.")).finally(() => setLoading(false)); }, []);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (error: any) { setError(error?.response?.data?.error || "Operazione non riuscita. Riprova."); }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    await action(async () => {
      await api.post("/auth/users", { username, password, role: "AMMINISTRATORE", condominioIds: selected });
      setUsername(""); setPassword(""); setSelected([]); setMessage("Account creato. Consegna le credenziali temporanee all’amministratore: dovrà cambiare la password al primo accesso."); await load();
    });
  }
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold text-slate-900">Account amministratori</h1><p className="mt-2 text-sm text-slate-600">Gli amministratori possono consultare soltanto i condomini assegnati e i relativi prospetti e bollette.</p></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{message}</p>}
    <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="mb-4 text-lg font-bold">Nuovo amministratore</h2><form onSubmit={create} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm font-semibold"><span>Username</span><input required minLength={3} maxLength={80} autoComplete="off" className={inputClass} value={username} onChange={event => setUsername(event.target.value)} disabled={busy || loading} /></label>
      <label className="space-y-2 text-sm font-semibold"><span>Password temporanea</span><input required minLength={8} type="password" autoComplete="new-password" className={inputClass} value={password} onChange={event => setPassword(event.target.value)} disabled={busy || loading} /></label></div>
      <p className="text-xs text-slate-500">Consegna username e password all’amministratore. Al primo accesso dovrà scegliere una password personale diversa.</p>
      <AssignmentPicker condomini={condomini} selected={selected} onChange={setSelected} disabled={busy || loading} />
      <button className={buttonClass} disabled={busy || loading}>Crea account</button>
    </form></section>
    <section className="space-y-4"><h2 className="text-lg font-bold">Amministratori registrati</h2>{loading && <p>Caricamento…</p>}{!loading && !accounts.length && <p className="text-sm text-slate-500">Nessun account amministratore.</p>}
      {accounts.map(account => <div key={account.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-bold text-slate-900">{account.username}</h3><p className="mt-1 text-sm text-slate-500">{account.condominioIds.length} condomini assegnati · {account.mustChangePassword ? "Password temporanea da cambiare" : "Password personale impostata"}</p></div>
        <div className="flex flex-wrap gap-2"><button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy} onClick={() => { setEditing(account.id); setAssigned(account.condominioIds); }}>Gestisci condomini</button>
        <button className={buttonClass} disabled={busy} onClick={() => void action(async () => { const { data } = await api.post(`/auth/users/${account.id}/impersonate`); setAuthSession(data.token, data.user); window.location.href = "/amministratore"; })}>Accedi come amministratore</button></div></div>
        {editing === account.id && <div className="mt-5 space-y-4 border-t pt-4"><AssignmentPicker condomini={condomini} selected={assigned} onChange={setAssigned} disabled={busy} /><div className="flex gap-3"><button className={buttonClass} disabled={busy} onClick={() => void action(async () => { await api.put(`/auth/users/${account.id}/condomini`, { condominioIds: assigned }); setEditing(""); setMessage("Assegnazioni aggiornate."); await load(); })}>Salva assegnazioni</button><button disabled={busy} className="text-sm text-slate-600" onClick={() => setEditing("")}>Annulla</button></div></div>}
      </div>)}
    </section>
    <p className="text-xs text-slate-500">L’accesso di assistenza dura al massimo un’ora, è registrato e mantiene i permessi di sola lettura dell’amministratore.</p>
  </div>;
}
