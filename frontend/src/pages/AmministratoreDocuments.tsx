import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Building2, CalendarDays, Check, ChevronRight, Eye, FileText, Files, FolderOpen, LoaderCircle, MapPin, Search, X } from "lucide-react";
import api from "../api/client";
import "./amministratore-documents.css";

type Condominio = { id: string; codice: number; nome: string; indirizzo: string; citta: string };
type SavedDocument = {
  id: string; source: string; document_type: string; filename: string; created_at: string;
  period_label?: string | null; period_key?: string | null; period_year?: number | null; period_month?: number | null;
};
type Period = { key: string; label: string; year: string; order: number; documents: SavedDocument[] };
type Action = "preview" | "download";
const documentKey = (doc: SavedDocument) => `${doc.source}:${doc.id}`;
const timestamp = (value: string) => new Date(String(value || "").replace(" ", "T")).getTime() || 0;
const dateLabel = (value: string) => timestamp(value) ? new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp(value))) : "Data non disponibile";

function documentPeriod(doc: SavedDocument): Omit<Period, "documents"> {
  const keyMatch = String(doc.period_key || "").match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  const labelMatch = String(doc.period_label || "").trim().match(/^(\d{1,2})(?:\^|\/)(\d{2}|\d{4})$/);
  const year = Number(doc.period_year || keyMatch?.[1] || (labelMatch ? (labelMatch[2].length === 2 ? `20${labelMatch[2]}` : labelMatch[2]) : 0));
  const month = Number(doc.period_month || keyMatch?.[2] || labelMatch?.[1] || 0);
  if (year >= 1900 && month >= 1 && month <= 12) {
    const label = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
    return { key: `${year}-${String(month).padStart(2, "0")}`, label: label[0].toUpperCase() + label.slice(1), year: String(year), order: year * 100 + month };
  }
  const label = String(doc.period_label || "").trim();
  const labelYear = label.match(/\b(20\d{2})\b/)?.[1] || "";
  return label
    ? { key: `label:${label.toLocaleLowerCase().replace(/\s+/g, " ")}`, label, year: labelYear, order: labelYear ? Number(labelYear) * 100 : 0 }
    : { key: "unclassified", label: "Altri documenti", year: "", order: -1 };
}

function DocumentCard({ kind, documents, onAction, busy }: {
  kind: "prospetto" | "bollette"; documents: SavedDocument[];
  onAction: (doc: SavedDocument, action: Action) => void; busy: string;
}) {
  const [variant, setVariant] = useState("prospetto");
  const doc = kind === "prospetto"
    ? documents.find(item => item.document_type === variant) || documents[0]
    : documents[0];
  const hasVariants = documents.some(item => item.document_type === "prospetto") && documents.some(item => item.document_type === "prospetto_bw");
  const title = kind === "prospetto" ? "Prospetto di ripartizione" : "Bollette del condominio";
  const Icon = kind === "prospetto" ? FileText : Files;
  return <article className={`ammd-document-card ${kind === "bollette" ? "ammd-document-card--teal" : ""}`}>
    <div className="ammd-card-top"><div className="ammd-document-symbol"><Icon size={28} strokeWidth={1.5} /></div><span className={`ammd-availability ${doc ? "" : "ammd-availability--empty"}`}>{doc ? <><Check size={13} />Disponibile</> : "In attesa"}</span></div>
    <h3>{title}</h3>
    <p className="ammd-card-description">{kind === "prospetto" ? "Il riepilogo dei consumi e della ripartizione delle spese." : "Il fascicolo completo delle bollette per questo periodo."}</p>
    <div className="ammd-card-meta">{doc ? <><span className="ammd-pdf-tag">PDF</span><span>Aggiornato il {dateLabel(doc.created_at)}</span></> : <span>Il documento sarà consultabile quando disponibile.</span>}</div>
    {doc && <div className="ammd-card-file" title={doc.filename}>{doc.filename}</div>}
    {hasVariants && <div className="ammd-variants" aria-label="Versione del prospetto">{[{ type: "prospetto", label: "A colori" }, { type: "prospetto_bw", label: "Bianco e nero" }].map(item => <button key={item.type} aria-pressed={variant === item.type} onClick={() => setVariant(item.type)}>{item.label}</button>)}</div>}
    <div className="ammd-card-actions"><button className="ammd-button ammd-button--primary" disabled={!doc || Boolean(busy)} onClick={() => onAction(doc, "preview")}>
      {doc && busy === `${documentKey(doc)}:preview` ? <LoaderCircle size={17} className="ammd-spin" /> : <Eye size={17} />}
      {kind === "prospetto" ? "Visualizza prospetto" : "Visualizza bollette"}
    </button><button className="ammd-button ammd-button--icon" disabled={!doc || Boolean(busy)} aria-label={`Scarica ${kind === "prospetto" ? "prospetto" : "bollette"}`} title="Scarica PDF" onClick={() => onAction(doc, "download")}>
      {doc && busy === `${documentKey(doc)}:download` ? <LoaderCircle size={18} className="ammd-spin" /> : <ArrowDownToLine size={18} />}
    </button></div>
  </article>;
}

function Preview({ preview, onClose }: { preview: { doc: SavedDocument; url: string }; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { document.body.style.overflow = previousOverflow; focused?.focus(); };
  }, []);
  function download() { const link = document.createElement("a"); link.href = preview.url; link.download = preview.doc.filename; link.click(); }
  return <div className="ammd-preview-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ammd-preview-title" className="ammd-preview" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button, a, iframe");
        if (!controls?.length) return;
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
      }
    }}>
      <div className="ammd-preview-header"><div className="ammd-preview-heading"><FileText size={22} /><div><h2 id="ammd-preview-title">{preview.doc.document_type.startsWith("prospetto") ? "Prospetto di ripartizione" : "Bollette del condominio"}</h2><p>{preview.doc.filename}</p></div></div>
        <div className="ammd-preview-actions"><button className="ammd-button" onClick={download}><ArrowDownToLine size={16} />Scarica PDF</button><a className="ammd-button" href={preview.url} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={16} />Nuova scheda</a><button aria-label="Chiudi anteprima" className="ammd-button ammd-button--icon" onClick={onClose}><X size={20} /></button></div>
      </div>
      <iframe src={preview.url} title={`Anteprima: ${preview.doc.filename}`} />
      <p className="ammd-preview-help">Se il PDF non viene mostrato, usa “Scarica PDF” o “Nuova scheda”.</p>
    </div>
  </div>;
}

export default function AmministratoreDocuments() {
  const { id } = useParams();
  const [condominio, setCondominio] = useState<Condominio | null>(null);
  const [documents, setDocuments] = useState<SavedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<{ doc: SavedDocument; url: string } | null>(null);
  const requestSequence = useRef(0);
  const previewUrl = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); };
  }, []);
  useEffect(() => {
    const sequence = ++requestSequence.current;
    setCondominio(null); setDocuments([]); setError(""); setActionError(""); setLoading(true); setSelected(""); setQuery(""); setYear(""); setPreview(null); setBusy("");
    if (previewUrl.current) { URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; }
    api.get(`/amministratore/condomini/${id}/documents`).then(({ data }) => { if (mounted.current && sequence === requestSequence.current) { setCondominio(data.condominio); setDocuments(data.documents); } })
      .catch(error => { if (mounted.current && sequence === requestSequence.current) setError(error?.response?.data?.error || "Impossibile caricare i documenti. Riprova tra poco."); })
      .finally(() => { if (mounted.current && sequence === requestSequence.current) setLoading(false); });
  }, [id]);
  const periods = useMemo(() => {
    const groups = new Map<string, Period>();
    for (const doc of documents) {
      const period = documentPeriod(doc);
      if (!groups.has(period.key)) groups.set(period.key, { ...period, documents: [] });
      groups.get(period.key)!.documents.push(doc);
    }
    return [...groups.values()].map(period => ({ ...period, documents: period.documents.sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at)) }))
      .sort((a, b) => b.order - a.order || timestamp(b.documents[0]?.created_at) - timestamp(a.documents[0]?.created_at));
  }, [documents]);
  const years = [...new Set(periods.map(period => period.year).filter(Boolean))].sort().reverse();
  const filtered = periods.filter(period => (!year || period.year === year) && `${period.label} ${period.documents.map(doc => doc.period_label || "").join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  const current = filtered.find(period => period.key === selected) || filtered[0];
  const prospetti = current?.documents.filter(doc => doc.document_type.startsWith("prospetto")) || [];
  const bollette = current?.documents.filter(doc => doc.document_type === "bollette_complete") || [];
  const individual = current?.documents.filter(doc => doc.document_type === "bolletta") || [];
  const previous = [...prospetti.filter((doc, index, all) => all.findIndex(item => item.document_type === doc.document_type) !== index), ...bollette.slice(1)];
  async function handleAction(doc: SavedDocument, action: Action) {
    if (busy) return;
    const sequence = requestSequence.current;
    setBusy(`${documentKey(doc)}:${action}`); setActionError("");
    try {
      const { data } = await api.get(`/amministratore/condomini/${id}/documents/${doc.source}/${doc.id}/view`, { responseType: "blob" });
      if (!mounted.current || sequence !== requestSequence.current) return;
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      if (action === "preview") {
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = url; setPreview({ doc, url });
      } else {
        const link = document.createElement("a"); link.href = url; link.download = doc.filename; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch { if (mounted.current && sequence === requestSequence.current) setActionError("Impossibile aprire il PDF. Riprova o contatta Idromardi."); }
    finally { if (mounted.current && sequence === requestSequence.current) setBusy(""); }
  }
  function closePreview() { setPreview(null); if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; }
  function documentRows(items: SavedDocument[]) {
    return items.map(doc => <div className="ammd-file-row" key={documentKey(doc)}><FileText size={19} /><div><p>{doc.filename}</p><span>{dateLabel(doc.created_at)}{doc.document_type === "prospetto_bw" ? " · Bianco e nero" : ""}</span></div><button className="ammd-button" disabled={Boolean(busy)} onClick={() => void handleAction(doc, "preview")} aria-label={`Visualizza ${doc.filename}`}><Eye size={16} /><span>Visualizza</span></button><button className="ammd-button ammd-button--icon" disabled={Boolean(busy)} onClick={() => void handleAction(doc, "download")} aria-label={`Scarica ${doc.filename}`}><ArrowDownToLine size={16} /></button></div>);
  }
  return <div className="ammd-workspace">
    <Link to="/amministratore" className="ammd-back"><ArrowLeft size={16} />I tuoi condomini</Link>
    <section className="ammd-identity"><div className="ammd-building-symbol"><Building2 size={27} strokeWidth={1.7} /></div><div className="ammd-identity-copy"><p className="ammd-eyebrow">AREA DOCUMENTALE</p><h1>{condominio?.nome || "Documenti del condominio"}</h1>{condominio && <p className="ammd-address"><MapPin size={14} />{[condominio.indirizzo, condominio.citta].filter(Boolean).join(" · ")}</p>}</div>{condominio && <span className="ammd-building-code">Condominio {condominio.codice}</span>}</section>
    {error && <div role="alert" className="ammd-error">{error}</div>}
    {loading && <div className="ammd-loading" role="status"><LoaderCircle className="ammd-spin" />Caricamento dell’archivio documenti…</div>}
    {!loading && condominio && !periods.length && <div className="ammd-empty"><FolderOpen size={36} /><h2>Il tuo archivio è pronto</h2><p>I prospetti e le bollette compariranno qui quando saranno disponibili.</p><Link to="/amministratore" className="ammd-button">Torna ai condomini</Link></div>}
    {!loading && condominio && periods.length > 0 && <div className="ammd-layout">
      <aside className="ammd-archive" aria-label="Archivio per periodo"><div className="ammd-archive-heading"><CalendarDays size={18} /><h2>Periodi disponibili</h2><span>{periods.length}</span></div>
        <div className="ammd-search"><Search size={16} /><input type="search" aria-label="Cerca un periodo" placeholder="Cerca un periodo" value={query} onChange={event => setQuery(event.target.value)} /></div>
        {years.length > 1 && <label className="ammd-year"><span>Anno</span><select aria-label="Filtra per anno" value={year} onChange={event => setYear(event.target.value)}><option value="">Tutti gli anni</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
        <div className="ammd-period-list">{filtered.map(period => <button key={period.key} className={`ammd-period ${current?.key === period.key ? "ammd-period--active" : ""}`} aria-pressed={current?.key === period.key} onClick={() => { setSelected(period.key); setActionError(""); }}><span><strong>{period.label}</strong><small>{period.documents.length} {period.documents.length === 1 ? "documento" : "documenti"}{period === periods[0] && period.key !== "unclassified" ? " · Più recente" : ""}</small></span><ChevronRight size={16} /></button>)}</div>
        <p className="ammd-archive-help">Tutti i documenti del condominio, organizzati per periodo.</p>
      </aside>
      <section className="ammd-period-content" aria-label="Documenti del periodo">
        {!current ? <div className="ammd-empty"><Search size={30} /><h2>Nessun periodo trovato</h2><p>Prova un’altra ricerca o rimuovi il filtro dell’anno.</p><button className="ammd-button" onClick={() => { setQuery(""); setYear(""); }}>Mostra tutti i periodi</button></div> : <>
          <div className="ammd-period-header"><div><p className="ammd-eyebrow">{current.key === "unclassified" ? "ARCHIVIO" : "PERIODO DI FATTURAZIONE"}</p><h2>{current.label}</h2><p>{current.key === "unclassified" ? "Documenti archiviati senza un periodo indicato." : "Consulta il prospetto e le bollette di questo periodo."}</p></div><span className="ammd-count"><FolderOpen size={15} />{current.documents.length} PDF</span></div>
          {actionError && <div role="alert" className="ammd-error">{actionError}</div>}
          <div className="ammd-document-grid"><DocumentCard key={`${current.key}:prospetto`} kind="prospetto" documents={prospetti} onAction={(doc, action) => void handleAction(doc, action)} busy={busy} /><DocumentCard key={`${current.key}:bollette`} kind="bollette" documents={bollette} onAction={(doc, action) => void handleAction(doc, action)} busy={busy} /></div>
          {individual.length > 0 && <details key={`${current.key}:individual`} className="ammd-details" open={!bollette.length}><summary><div><Files size={19} /><span>Bollette individuali <small>{individual.length}</small></span></div><ChevronRight size={18} /></summary><div className="ammd-details-content"><p>Consulta o scarica la singola bolletta.</p>{documentRows(individual)}</div></details>}
          {previous.length > 0 && <details key={`${current.key}:previous`} className="ammd-details"><summary><div><FolderOpen size={19} /><span>Versioni precedenti <small>{previous.length}</small></span></div><ChevronRight size={18} /></summary><div className="ammd-details-content">{documentRows(previous)}</div></details>}
          <p className="ammd-reading-note"><Eye size={15} />Documenti in consultazione. Puoi visualizzare e scaricare ogni PDF.</p>
        </>}
      </section>
    </div>}
    {preview && <Preview preview={preview} onClose={closePreview} />}
  </div>;
}
