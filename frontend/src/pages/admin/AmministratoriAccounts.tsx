import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { ArrowRight, Building2, Check, ChevronLeft, ChevronRight, Eye, EyeOff, LoaderCircle, Plus, RefreshCw, Search, Settings2, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";
import api from "../../api/client";
import { setAuthSession } from "../../auth";
import "./amministratori-accounts.css";

type Condominio = { id: string; nome: string; codice: number; indirizzo: string };
type Account = { id: string; username: string; role: string; mustChangePassword: boolean; condominioIds: string[] };
type Editor = { type: "create" } | { type: "assign"; account: Account };
const PAGE_SIZE = 8;
const messageFrom = (error: any) => error?.response?.data?.error || "Operazione non riuscita. Riprova.";

function AccountStatus({ account }: { account: Account }) {
  return <span className={`amma-status ${account.mustChangePassword ? "amma-status--pending" : ""}`}><span />{account.mustChangePassword ? "Primo accesso da completare" : "Password personale impostata"}</span>;
}

function Dialog({ title, subtitle, busy, onClose, children }: { title: string; subtitle: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]");
      if (!controls?.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return <div className="amma-overlay" onClick={event => { if (!busy && event.currentTarget === event.target) onClose(); }}><div ref={dialog} className="amma-dialog" role="dialog" aria-modal="true" aria-labelledby="amma-dialog-title" aria-describedby="amma-dialog-subtitle">
    <header className="amma-dialog-header"><div><h2 id="amma-dialog-title">{title}</h2><p id="amma-dialog-subtitle">{subtitle}</p></div><button type="button" className="amma-button amma-button--icon" aria-label="Chiudi" disabled={busy} onClick={onClose}><X size={18} /></button></header>{children}
  </div></div>;
}

function AssignmentPicker({ condomini, selected, onChange, disabled }: { condomini: Condominio[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const names = useMemo(() => new Map(condomini.map(item => [item.id, item])), [condomini]);
  const filtered = condomini.filter(item => `${item.nome} ${item.indirizzo} ${item.codice}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()) && (filter === "all" || (filter === "selected" ? selected.includes(item.id) : !selected.includes(item.id))));
  const allVisibleSelected = filtered.length > 0 && filtered.every(item => selected.includes(item.id));
  function selectVisible() {
    const visible = new Set(filtered.map(item => item.id));
    onChange(allVisibleSelected ? selected.filter(id => !visible.has(id)) : [...new Set([...selected, ...visible])]);
  }
  return <section className="amma-picker" aria-label="Assegnazione condomini"><div className="amma-section-title"><h3>Condomini assegnati</h3><span>{selected.length} {selected.length === 1 ? "selezionato" : "selezionati"}</span></div><div className="amma-picker-grid" style={{ "--amma-picker-height": `${Math.min(5, Math.max(2, filtered.length)) * 50}px` } as CSSProperties}>
    <div className="amma-available"><div className="amma-picker-toolbar"><div className="amma-search"><Search size={15} /><input type="search" aria-label="Cerca condomini da assegnare" placeholder="Nome, indirizzo o codice" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} /></div><select aria-label="Filtra condomini" value={filter} disabled={disabled} onChange={event => setFilter(event.target.value)}><option value="all">Tutti</option><option value="selected">Selezionati</option><option value="available">Non selezionati</option></select></div>
      <div className="amma-visible"><span>{filtered.length} {filtered.length === 1 ? "risultato" : "risultati"}</span><button type="button" disabled={disabled || !filtered.length} onClick={selectVisible}>{allVisibleSelected ? "Deseleziona risultati" : "Seleziona risultati"}</button></div>
      <div className="amma-building-list">{filtered.map(item => <label key={item.id} data-condominio-id={item.id} className={`amma-building ${selected.includes(item.id) ? "amma-building--selected" : ""}`}><input type="checkbox" disabled={disabled} checked={selected.includes(item.id)} onChange={event => onChange(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} /><span className="amma-building-code">{item.codice ?? "—"}</span><span className="amma-building-name"><strong>{item.nome}</strong>{item.indirizzo !== item.nome && <small>{item.indirizzo}</small>}</span></label>)}{!filtered.length && <div className="amma-picker-empty"><Search size={20} /><span>Nessun condominio trovato</span><button type="button" disabled={disabled} onClick={() => { setQuery(""); setFilter("all"); }}>Rimuovi filtri</button></div>}</div>
    </div>
    <aside className="amma-selection" aria-label="Condomini selezionati"><div className="amma-selection-title"><Check size={14} /><strong>La selezione</strong><span>{selected.length}</span></div><div className="amma-selected-list">{selected.map(id => <div className="amma-selected-building" key={id}><Building2 size={15} /><div><strong>{names.get(id)?.nome || "Condominio non disponibile"}</strong>{names.get(id)?.codice != null && <small>Cod. {names.get(id)?.codice}</small>}</div><button type="button" disabled={disabled} aria-label={`Rimuovi ${names.get(id)?.nome || "condominio"}`} onClick={() => onChange(selected.filter(value => value !== id))}><X size={14} /></button></div>)}{!selected.length && <div className="amma-selection-empty"><Building2 size={24} /><p>Seleziona i condomini dall’elenco.</p><small>Puoi assegnarli anche in seguito.</small></div>}</div></aside>
  </div></section>;
}

function AccountEditor({ editor, condomini, onClose, onSaved }: { editor: Editor; condomini: Condominio[]; onClose: () => void; onSaved: (account: Account, message: string) => void }) {
  const originalIds = editor.type === "assign" ? editor.account.condominioIds : [];
  const [selected, setSelected] = useState<string[]>([...originalIds]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const added = selected.filter(id => !originalIds.includes(id)).length;
  const removed = originalIds.filter(id => !selected.includes(id)).length;
  const changed = editor.type === "create" || added > 0 || removed > 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !changed) return;
    setSaving(true); setError("");
    try {
      if (editor.type === "create") {
        const { data } = await api.post("/auth/users", { username: username.trim(), password, role: "AMMINISTRATORE", condominioIds: selected });
        setPassword(""); onSaved(data.user, "Account creato. Consegna le credenziali temporanee all’amministratore: dovrà cambiare la password al primo accesso.");
      } else {
        await api.put(`/auth/users/${editor.account.id}/condomini`, { condominioIds: selected });
        onSaved({ ...editor.account, condominioIds: selected }, "Assegnazioni aggiornate.");
      }
    } catch (error) { setError(messageFrom(error)); setSaving(false); }
  }
  return <Dialog title={editor.type === "create" ? "Nuovo amministratore" : "Gestisci condomini"} subtitle={editor.type === "create" ? "Imposta le credenziali e scegli i condomini da assegnare." : "Aggiorna i condomini consultabili da questo account."} busy={saving} onClose={onClose}><form onSubmit={submit} className="amma-editor-form"><div className="amma-dialog-body">
    {editor.type === "create" ? <><div className="amma-credentials"><label htmlFor="amma-username"><span>Username</span><input id="amma-username" required minLength={3} maxLength={80} autoComplete="off" placeholder="es. studio-rossi" value={username} onChange={event => setUsername(event.target.value)} disabled={saving} /></label><label htmlFor="amma-password"><span>Password temporanea</span><div className="amma-password-field"><input id="amma-password" required minLength={8} type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Almeno 8 caratteri" value={password} onChange={event => setPassword(event.target.value)} disabled={saving} /><button type="button" disabled={saving} aria-label={showPassword ? "Nascondi password" : "Mostra password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label></div><p className="amma-credential-note"><ShieldCheck size={15} />L’amministratore sceglierà la propria password al primo accesso.</p></> : <div className="amma-edit-identity"><span className="amma-avatar"><UserRound size={19} /></span><div><strong>{editor.account.username}</strong><span>Account amministratore</span></div><AccountStatus account={editor.account} /></div>}
    {error && <div className="amma-notice amma-notice--error" role="alert">{error}</div>}
    <AssignmentPicker condomini={condomini} selected={selected} onChange={setSelected} disabled={saving} />
  </div><footer className="amma-dialog-footer"><p>{selected.length} {selected.length === 1 ? "condominio assegnato" : "condomini assegnati"}{editor.type === "assign" && changed && <span> · +{added} / −{removed}</span>}</p><div><button type="button" className="amma-button" disabled={saving} onClick={onClose}>Annulla</button><button type="submit" className="amma-button amma-button--primary" disabled={saving || !changed}>{saving ? <LoaderCircle size={15} className="amma-spin" /> : <Check size={15} />}{saving ? "Salvataggio…" : editor.type === "create" ? "Crea account" : "Salva assegnazioni"}</button></div></footer></form></Dialog>;
}

export default function AmministratoriAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [condomini, setCondomini] = useState<Condominio[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [supporting, setSupporting] = useState("");
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  async function load() {
    const sequence = ++requestSequence.current;
    setLoading(true); setError("");
    try {
      const [users, buildings] = await Promise.all([api.get("/auth/users"), api.get("/auth/condomini")]);
      if (!mounted.current || sequence !== requestSequence.current) return;
      setAccounts(users.data.users.filter((user: Account) => user.role === "AMMINISTRATORE")); setCondomini(buildings.data.condomini);
    } catch (error) { if (mounted.current && sequence === requestSequence.current) setError(messageFrom(error)); }
    finally { if (mounted.current && sequence === requestSequence.current) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  const names = useMemo(() => new Map(condomini.map(item => [item.id, item.nome])), [condomini]);
  const filtered = accounts.filter(account => `${account.username} ${account.condominioIds.map(id => names.get(id) || "").join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()) && (!status || account.mustChangePassword === (status === "pending"))).sort((a, b) => a.username.localeCompare(b.username, "it"));
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const pending = accounts.filter(account => account.mustChangePassword).length;
  function saved(account: Account, notice: string) {
    if (editor?.type === "create") { setQuery(""); setStatus(""); setPage(0); }
    setAccounts(previous => [...previous.filter(item => item.id !== account.id), account]); setEditor(null); setMessage(notice); setError("");
  }
  async function support(account: Account) {
    if (supporting) return;
    setSupporting(account.id); setError(""); setMessage("");
    try { const { data } = await api.post(`/auth/users/${account.id}/impersonate`); setAuthSession(data.token, data.user); window.location.href = "/amministratore"; }
    catch (error) { setError(messageFrom(error)); setSupporting(""); }
  }
  return <div className="amma-workspace"><header className="amma-header"><div><p className="amma-eyebrow">GESTIONE ACCESSI</p><h1>Account amministratori</h1><p>Credenziali e condomini assegnati, in un unico spazio.</p></div><button className="amma-button amma-button--primary" disabled={loading || Boolean(supporting)} onClick={() => setEditor({ type: "create" })}><Plus size={16} />Nuovo amministratore</button></header>
    {error && <div className="amma-notice amma-notice--error" role="alert">{error}</div>}
    {message && <div className="amma-notice amma-notice--success" role="status"><Check size={16} /><span>{message}</span><button className="amma-button amma-button--icon" aria-label="Chiudi conferma" onClick={() => setMessage("")}><X size={15} /></button></div>}
    <section className="amma-accounts" aria-label="Amministratori registrati"><div className="amma-toolbar"><div className="amma-search"><Search size={16} /><input type="search" aria-label="Cerca account amministratori" placeholder="Cerca account o condominio" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></div><select aria-label="Filtra stato account" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="">Tutti gli account</option><option value="ready">Password personale</option><option value="pending">Primo accesso da completare</option></select><span className="amma-summary">{accounts.length} account <span>· {pending} al primo accesso</span></span><button className="amma-button amma-button--icon" aria-label="Aggiorna account" title="Aggiorna account" disabled={loading || Boolean(supporting)} onClick={() => void load()}><RefreshCw size={15} className={loading ? "amma-spin" : ""} /></button></div>
    {loading ? <div className="amma-empty" role="status"><LoaderCircle size={23} className="amma-spin" /><p>Caricamento account…</p></div> : !visible.length ? <div className="amma-empty"><UsersRound size={28} /><h2>{accounts.length ? "Nessun account trovato" : "Nessun amministratore registrato"}</h2><p>{accounts.length ? "Modifica la ricerca o il filtro dello stato." : "Crea un account e assegna i condomini consultabili."}</p>{accounts.length > 0 && <button className="amma-button" onClick={() => { setQuery(""); setStatus(""); setPage(0); }}>Rimuovi filtri</button>}</div> : <div className="amma-table-wrap"><table className="amma-table"><thead><tr><th>Amministratore</th><th>Accesso</th><th>Condomini</th><th><span className="sr-only">Azioni</span></th></tr></thead><tbody>{visible.map(account => {
      const assignedNames = account.condominioIds.map(id => names.get(id) || "Condominio non disponibile");
      return <tr key={account.id} data-account-id={account.id}><td><div className="amma-account-name"><span className="amma-avatar">{account.username.slice(0, 2).toUpperCase()}</span><strong>{account.username}</strong></div></td><td><AccountStatus account={account} /></td><td><div className="amma-account-buildings"><strong><Building2 size={14} />{account.condominioIds.length} {account.condominioIds.length === 1 ? "condominio" : "condomini"}</strong><span title={assignedNames.join(" · ")}>{assignedNames.length ? assignedNames.slice(0, 2).join(" · ") + (assignedNames.length > 2 ? ` +${assignedNames.length - 2}` : "") : "Nessuna assegnazione"}</span></div></td><td><div className="amma-row-actions"><button className="amma-button" aria-label={`Gestisci condomini di ${account.username}`} disabled={Boolean(supporting)} onClick={() => setEditor({ type: "assign", account })}><Settings2 size={14} /><span>Gestisci condomini</span></button><button className="amma-button amma-support-button" disabled={Boolean(supporting)} onClick={() => void support(account)} aria-label={`Accedi come ${account.username}`} title="Accedi come amministratore · assistenza in sola lettura">{supporting === account.id ? <LoaderCircle size={14} className="amma-spin" /> : <ArrowRight size={15} />}<span>Accedi come amministratore</span></button></div></td></tr>;
    })}</tbody></table></div>}
    {!loading && filtered.length > 0 && <footer className="amma-pagination"><span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} di {filtered.length} account</span><div><button className="amma-button amma-button--icon" aria-label="Pagina precedente" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {lastPage + 1}</span><button className="amma-button amma-button--icon" aria-label="Pagina successiva" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div></footer>}
    </section><p className="amma-support-note"><ShieldCheck size={15} />Gli account amministratore hanno accesso in sola lettura. L’assistenza è registrata e dura al massimo un’ora.</p>
    {editor && <AccountEditor editor={editor} condomini={condomini} onClose={() => setEditor(null)} onSaved={saved} />}
  </div>;
}
