import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, GripVertical, Loader2, RefreshCw, RotateCcw, Save, Search, Undo2, Redo2, ZoomIn, ZoomOut } from "lucide-react";
import api from "../../api/client";
import "./bolletta-template.css";

type Section = { column: "main" | "side" | "full"; order: number; fontSize: number; padding: number };
type Template = { labels: Record<string, string>; page: Record<string, number>; sections: Record<string, Section> };
type Document = { scope: string; condominio?: { nome: string }; base: Template; factory: Template; effective: Template; revision: number; defaultRevision: number; sectionNames: Record<string, string> };
type Condo = { id: string; nome: string; codice: string; template_revision?: number };
const columns = [{ id: "full", name: "Larghezza intera" }, { id: "main", name: "Colonna sinistra" }, { id: "side", name: "Colonna destra" }] as const;
const labelGroups: Record<string, string[]> = {
  "Testata e riepilogo": ["kicker", "title", "subtitle", "customer", "condominium", "userId", "location", "total"],
  "Letture": ["readings", "period", "readingDate", "readingStatus", "previous", "current", "consumption"],
  "Importi": ["costs", "item", "amount", "water", "sewer", "treatment", "fixed", "adjustment", "charges", "equalization", "vat", "advanceWater", "advanceSewer", "advanceOther", "reversalTxt", "reversalLegacy", "reversalCredit", "reversal", "remainingCredit", "creditNote", "rounding"],
  "Altre sezioni": ["tiers", "notes", "references", "footer"],
};
function errorText(error: unknown) { return (error as { response?: { data?: { error?: string } } })?.response?.data?.error || "Operazione non completata. Riprova."; }
function previewDocument(html: string) {
  return html.replace("</head>", `<style>html,body{width:198mm;min-height:285mm;background:white}*{cursor:default} [data-section]{cursor:pointer} [data-selected]{outline:2px solid #2563eb;outline-offset:1px}</style></head>`)
    .replace("</body>", `<script>
      function report(){const probe=document.createElement('div');probe.style.cssText='position:absolute;visibility:hidden;height:285mm';document.body.appendChild(probe);const height=probe.getBoundingClientRect().height;probe.remove();const sheet=document.querySelector('.invoice-sheet');const wide=[...sheet.querySelectorAll('*')].some(e=>e.scrollWidth>e.clientWidth+2&&getComputedStyle(e).display!=='inline');parent.postMessage({kind:'bolletta-fit',fits:sheet.getBoundingClientRect().height<=height+1&&!wide},'*');}
      document.querySelectorAll('[data-section]').forEach(e=>{e.tabIndex=0;e.addEventListener('click',()=>parent.postMessage({kind:'bolletta-select',id:e.dataset.section},'*'));e.addEventListener('keydown',ev=>{if(ev.key==='Enter')e.click()});});
      window.addEventListener('message',e=>{if(e.source!==parent||e.data?.kind!=='bolletta-highlight')return;document.querySelectorAll('[data-section]').forEach(el=>el.toggleAttribute('data-selected',el.dataset.section===e.data.id));});
      window.addEventListener('load',report);document.fonts.ready.then(report);
    </script></body>`);
}
function NumberControl({ label, value, min, max, step = .5, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(String(value)); }, [value]);
  return <label className="bt-number"><span>{label}</span><div><input type="number" min={min} max={max} step={step} value={text} onFocus={() => { editing.current = true; }} onChange={event => {
    setText(event.target.value);
    const number = Number(event.target.value);
    if (event.target.value && Number.isFinite(number) && number >= min && number <= max) onChange(number);
  }} onBlur={() => {
    editing.current = false;
    const number = text && Number.isFinite(Number(text)) ? Math.min(max, Math.max(min, Number(text))) : value;
    setText(String(number));
    if (number !== value) onChange(number);
  }} /><span>{unit}</span></div></label>;
}

export default function BollettaTemplateEditor() {
  const [scope, setScope] = useState("default");
  const [query, setQuery] = useState("");
  const [condomini, setCondomini] = useState<Condo[]>([]);
  const [document, setDocument] = useState<Document | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [selected, setSelected] = useState("readings");
  const [tab, setTab] = useState<"layout" | "labels">("layout");
  const [html, setHtml] = useState("");
  const [fits, setFits] = useState<boolean | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [zoom, setZoom] = useState(.7);
  const [dragging, setDragging] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [history, setHistory] = useState<{ past: Template[]; future: Template[] }>({ past: [], future: [] });
  const frame = useRef<HTMLIFrameElement>(null);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(document?.effective);
  const resetBase = scope === "default" ? document?.factory : document?.base;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { api.get("/bolletta-templates/condomini", { params: { search: query }, signal: controller.signal }).then(response => setCondomini(response.data.items)).catch(err => { if (!controller.signal.aborted) setError(errorText(err)); }); }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setDraft(null); setDocument(null); setHtml(""); setFits(null); setError(""); setMessage(""); setHistory({ past: [], future: [] });
    api.get(`/bolletta-templates/${scope}`, { signal: controller.signal }).then(response => { setDocument(response.data); setDraft(response.data.effective); }).catch(err => { if (!controller.signal.aborted) setError(errorText(err)); });
    return () => controller.abort();
  }, [scope, reload]);
  useEffect(() => {
    if (!draft) return;
    const controller = new AbortController();
    setFits(null); setPreviewing(true);
    const timer = setTimeout(() => {
      api.post(`/bolletta-templates/${scope}/preview`, { template: draft }, { signal: controller.signal }).then(response => { setFits(null); setHtml(previewDocument(response.data.html)); }).catch(err => { if (!controller.signal.aborted) setError(errorText(err)); }).finally(() => { if (!controller.signal.aborted) setPreviewing(false); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [draft, scope]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.kind === "bolletta-fit") setFits(event.data.fits === true);
      if (event.data?.kind === "bolletta-select" && document?.sectionNames[event.data.id]) { setSelected(event.data.id); setTab("layout"); }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [document]);
  useEffect(() => { frame.current?.contentWindow?.postMessage({ kind: "bolletta-highlight", id: selected }, "*"); }, [selected, fits]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function changeScope(value: string) {
    if (dirty && !window.confirm("Ci sono modifiche non salvate. Vuoi abbandonarle?")) return;
    setScope(value);
  }
  function patchSection(id: string, value: Partial<Section>) {
    if (draft) edit({ ...draft, sections: { ...draft.sections, [id]: { ...draft.sections[id], ...value } } });
  }
  function edit(value: Template) {
    if (draft) setHistory(current => ({ past: [...current.past, draft].slice(-50), future: [] }));
    setDraft(value); setMessage("");
  }
  function undo() {
    if (!draft || !history.past.length) return;
    setDraft(history.past[history.past.length - 1]);
    setHistory({ past: history.past.slice(0, -1), future: [draft, ...history.future] });
  }
  function redo() {
    if (!draft || !history.future.length) return;
    setDraft(history.future[0]);
    setHistory({ past: [...history.past, draft], future: history.future.slice(1) });
  }
  function move(id: string, column: Section["column"], before?: string) {
    if (!draft) return;
    const ids = Object.keys(draft.sections).filter(key => key !== id && draft.sections[key].column === column).sort((a, b) => draft.sections[a].order - draft.sections[b].order);
    const index = before ? ids.indexOf(before) : ids.length;
    ids.splice(index < 0 ? ids.length : index, 0, id);
    edit({ ...draft, sections: { ...draft.sections, ...Object.fromEntries(ids.map((key, order) => [key, { ...draft.sections[key], column, order }])) } });
    setSelected(id); setDragging(null); setMessage("");
  }
  function reorder(delta: number) {
    if (!draft) return;
    const section = draft.sections[selected];
    const ids = Object.keys(draft.sections).filter(id => draft.sections[id].column === section.column).sort((a, b) => draft.sections[a].order - draft.sections[b].order);
    const index = ids.indexOf(selected), target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    edit({ ...draft, sections: { ...draft.sections, ...Object.fromEntries(ids.map((id, order) => [id, { ...draft.sections[id], order }])) } });
  }
  async function save() {
    if (!draft || !document) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await api.put(`/bolletta-templates/${scope}`, { template: draft, revision: document.revision, defaultRevision: document.defaultRevision });
      setDocument(response.data); setDraft(response.data.effective);
      setHistory({ past: [], future: [] });
      setMessage(scope === "default" ? "Modello predefinito aggiornato." : "Modello salvato e associato al condominio.");
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  }
  const selectedSection = draft?.sections[selected];
  const scopeName = scope === "default" ? "Modello predefinito" : document?.condominio?.nome || condomini.find(c => c.id === scope)?.nome || "Condominio selezionato";
  return <div className="bt-editor">
    <header className="bt-header">
      <div><h1>Modelli bollette</h1><span>{scopeName}{dirty ? " · Modifiche non salvate" : ""}</span></div>
      <div className="bt-actions">
        <button title="Annulla modifica" aria-label="Annulla modifica" disabled={!history.past.length || saving} onClick={undo}><Undo2 size={16} /></button>
        <button title="Ripeti modifica" aria-label="Ripeti modifica" disabled={!history.future.length || saving} onClick={redo}><Redo2 size={16} /></button>
        <button title="Ricarica modello" aria-label="Ricarica modello" disabled={saving} onClick={() => { if (!dirty || window.confirm("Ricaricare e abbandonare le modifiche non salvate?")) setReload(value => value + 1); }}><RefreshCw size={16} /></button>
        <button title={scope === "default" ? "Ripristina modello iniziale" : "Ripristina modello predefinito"} disabled={!draft || saving} onClick={() => resetBase && edit(structuredClone(resetBase))}><RotateCcw size={16} />Ripristina</button>
        <button className="bt-primary" disabled={!dirty || saving || fits !== true || previewing} onClick={() => void save()}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Salva modello</button>
      </div>
    </header>
    {(error || message) && <div className={`bt-notice ${error ? "bt-error" : "bt-success"}`} role={error ? "alert" : "status"}>{error || message}<button onClick={() => { setError(""); setMessage(""); }} aria-label="Chiudi avviso">×</button></div>}
    <div className="bt-target">
      <label><span>Condominio / modello</span><select value={scope} disabled={saving} onChange={e => changeScope(e.target.value)}><option value="default">Predefinito · tutti i condomini</option>{scope !== "default" && !condomini.some(c => c.id === scope) && <option value={scope}>{scopeName}</option>}{condomini.map(c => <option key={c.id} value={c.id}>{c.codice} · {c.nome}{c.template_revision ? " · personalizzato" : ""}</option>)}</select></label>
      <label className="bt-search"><Search size={16} /><input aria-label="Cerca condominio" value={query} onChange={e => setQuery(e.target.value)} placeholder="Cerca condominio..." /></label>
      <span className="bt-version">Versione {document?.revision ?? "—"}{scope !== "default" ? ` · Base ${document?.defaultRevision ?? "—"}` : ""}</span>
    </div>
    <div className="bt-workspace">
      <aside className="bt-controls" inert={saving}>
        <div className="bt-tabs" role="tablist" aria-label="Personalizzazione modello"><button role="tab" aria-selected={tab === "layout"} onClick={() => setTab("layout")}>Impaginazione</button><button role="tab" aria-selected={tab === "labels"} onClick={() => setTab("labels")}>Etichette</button></div>
        {!draft ? <div className="bt-loading"><Loader2 className="animate-spin" />Caricamento modello</div> : tab === "layout" ? <>
          <fieldset><legend>Disposizione sezioni</legend>
            {columns.map(column => <div key={column.id} className={`bt-lane ${dragging ? "bt-droppable" : ""}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragging) move(dragging, column.id); }}>
              <span className="bt-lane-title">{column.name}</span>
              {Object.keys(draft.sections).filter(id => draft.sections[id].column === column.id).sort((a, b) => draft.sections[a].order - draft.sections[b].order).map(id => <button key={id} className={`bt-section ${selected === id ? "bt-selected" : ""}`} draggable onDragStart={() => setDragging(id)} onDragEnd={() => setDragging(null)} onClick={() => setSelected(id)} onDrop={event => { event.preventDefault(); event.stopPropagation(); if (dragging && dragging !== id) move(dragging, column.id, id); }}><GripVertical size={15} /><span>{document?.sectionNames[id]}</span></button>)}
            </div>)}
          </fieldset>
          {selectedSection && <fieldset><legend>{document?.sectionNames[selected]}</legend>
            <div className="bt-section-toolbar"><select aria-label="Colonna sezione" value={selectedSection.column} onChange={e => move(selected, e.target.value as Section["column"])}>{columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button title="Sposta sopra" aria-label="Sposta sopra" onClick={() => reorder(-1)}><ArrowUp size={16} /></button><button title="Sposta sotto" aria-label="Sposta sotto" onClick={() => reorder(1)}><ArrowDown size={16} /></button><button title="Ripristina sezione" aria-label="Ripristina sezione" onClick={() => resetBase && patchSection(selected, resetBase.sections[selected])}><RotateCcw size={16} /></button></div>
            <div className="bt-number-grid"><NumberControl label="Carattere" value={selectedSection.fontSize} min={7} max={12} unit="pt" onChange={fontSize => patchSection(selected, { fontSize })} /><NumberControl label="Spazio interno" value={selectedSection.padding} min={1} max={6} unit="mm" onChange={padding => patchSection(selected, { padding })} /></div>
          </fieldset>}
          <fieldset><legend>Pagina A4</legend><div className="bt-number-grid">{[
            ["gap", "Distanza sezioni", 0, 6, "mm"], ["padding", "Spazio inferiore", 1, 6, "mm"], ["mainWidth", "Colonna sinistra", 50, 75, "%"], ["titleSize", "Titolo", 12, 24, "pt"], ["customerSize", "Intestatario", 9, 18, "pt"], ["totalSize", "Totale", 12, 26, "pt"],
          ].map(([key, label, min, max, unit]) => <NumberControl key={key} label={String(label)} value={draft.page[String(key)]} min={Number(min)} max={Number(max)} unit={String(unit)} onChange={value => edit({ ...draft, page: { ...draft.page, [String(key)]: value } })} />)}</div></fieldset>
        </> : Object.entries(labelGroups).map(([group, keys]) => <fieldset key={group}><legend>{group}</legend>{keys.map(key => <label className="bt-label" key={key}><span>{document?.factory.labels[key]}{scope !== "default" && draft.labels[key] !== document?.base.labels[key] && <small>Personalizzata</small>}</span><div><input value={draft.labels[key]} maxLength={key === "footer" || key === "creditNote" ? 220 : 100} onChange={e => edit({ ...draft, labels: { ...draft.labels, [key]: e.target.value } })} /><button title="Ripristina etichetta" aria-label={`Ripristina ${document?.factory.labels[key]}`} onClick={() => resetBase && edit({ ...draft, labels: { ...draft.labels, [key]: resetBase.labels[key] } })}><RotateCcw size={14} /></button></div></label>)}</fieldset>)}
      </aside>
      <section className="bt-preview" aria-label="Anteprima bolletta">
        <div className="bt-preview-toolbar"><strong>Anteprima A4</strong><span className={fits === false ? "bt-fit-error" : "bt-fit-ok"}>{previewing || fits === null ? "Aggiornamento..." : fits ? <><Check size={14} />Formato verificato</> : "Contenuto fuori pagina"}</span><div><button title="Riduci anteprima" aria-label="Riduci anteprima" onClick={() => setZoom(z => Math.max(.35, z - .1))}><ZoomOut size={16} /></button><span>{Math.round(zoom * 100)}%</span><button title="Ingrandisci anteprima" aria-label="Ingrandisci anteprima" onClick={() => setZoom(z => Math.min(1.2, z + .1))}><ZoomIn size={16} /></button></div></div>
        <div className="bt-preview-scroll"><div className="bt-paper-size" style={{ width: `${198 * zoom}mm`, height: `${285 * zoom}mm` }}><iframe ref={frame} title="Bolletta di esempio" sandbox="allow-scripts" srcDoc={html} style={{ width: "198mm", height: "285mm", transform: `scale(${zoom})` }} /></div></div>
        {fits === false && <div className="bt-overflow" role="alert">Il contenuto non rientra in A4. Riduci caratteri o spaziatura, oppure cambia la disposizione delle sezioni.</div>}
      </section>
    </div>
  </div>;
}
