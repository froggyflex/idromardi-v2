import { useEffect, useRef, useState } from "react";
import { Cloud, Download, Eye, LoaderCircle, CheckCircle2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import api from "../../api/client";

type DocumentResult = { kind: string; bytes: number; verified: boolean; uploadMs: number; previewMs: number; downloadMs: number };
type Session = { id: string; status: "waiting" | "testing" | "complete" | "failed"; error?: string;
  report?: { capacity: { totalBytes: number; usedBytes: number; freeBytes: number }; documents: DocumentResult[] } };
const bytes = (value: number) => `${(value / 1000 ** 4).toLocaleString("it-IT", { maximumFractionDigits: 2 })} TB`;

export default function PcloudStorageTest() {
  const [params, setParams] = useSearchParams();
  const sessionId = params.get("session");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState("");
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    api.get("/pcloud-test/settings").then(({ data }) => { if (active) setConfigured(data.configured); })
      .catch(() => { if (active) { setConfigured(false); setError("Impossibile verificare il collegamento pCloud."); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setSession(null);
    if (!sessionId) return;
    const poll = async () => {
      try {
        const { data } = await api.get<Session>(`/pcloud-test/sessions/${encodeURIComponent(sessionId)}`);
        if (!active) return;
        setSession(data);
        setError("");
        if (["waiting", "testing"].includes(data.status)) timer = setTimeout(poll, 2000);
      } catch {
        if (active) setError("Sessione scaduta o non disponibile. Avvia un nuovo test.");
      }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [sessionId]);
  useEffect(() => {
    if (!preview) return;
    if (previewDialog.current && !previewDialog.current.open) previewDialog.current.showModal();
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post("/pcloud-test/sessions");
      setParams({ session: data.id });
      window.location.assign(data.authorizeUrl);
    } catch (error: unknown) {
      const response = error as { response?: { data?: { error?: string } } };
      setError(response.response?.data?.error || "Impossibile avviare il test pCloud.");
      setBusy(false);
    }
  }
  async function openPdf(kind: string, download: boolean) {
    if (!sessionId) return;
    setOpening(kind);
    try {
      const { data } = await api.get(`/pcloud-test/sessions/${encodeURIComponent(sessionId)}/documents/${kind}`, {
        params: download ? { download: "1" } : {}, responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      if (download) {
        const link = document.createElement("a");
        link.href = url; link.download = `${kind}-test.pdf`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else setPreview({ title: kind === "bolletta" ? "Bolletta di prova" : "Prospetto di prova", url });
    } catch { setError("PDF di prova non disponibile. La sessione potrebbe essere scaduta."); }
    finally { setOpening(""); }
  }

  const running = busy || (session && ["waiting", "testing"].includes(session.status));
  return <section aria-label="Test archivio pCloud" className="mx-auto max-w-4xl space-y-5">
    <div className="flex items-center gap-3"><div className="rounded-xl bg-blue-50 p-3 text-blue-600"><Cloud /></div><div>
      <h1 className="text-2xl font-bold text-slate-900">Test archivio pCloud</h1>
      <p className="text-sm text-slate-500">Verifica il salvataggio e la consultazione dei PDF nell'account europeo.</p>
    </div></div>
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-900">Collega l'account e prova l'archivio</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Accedi direttamente su pCloud per autorizzare il test. Verranno salvati una bolletta e un prospetto di esempio nella cartella <strong>Idromardi-test</strong>, poi riscaricati e verificati.</p>
      <p className="mt-2 text-sm text-slate-500">I documenti esistenti continuano a essere salvati nell'archivio attuale. Questo test non attiva una migrazione.</p>
      {configured === false && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Collegamento non ancora configurato. Completa l'approvazione dell'app pCloud e la configurazione del server.</p>}
      <button type="button" onClick={start} disabled={!configured || Boolean(running)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {running && <LoaderCircle className="h-4 w-4 animate-spin" />} {running ? "Test in corso" : "Collega pCloud e avvia test"}
      </button>
      <p className="mt-3 text-xs text-slate-500">L'autorizzazione riguarda l'account pCloud. Il test usa solo lo spazio disponibile e i propri PDF di esempio. I risultati sono disponibili per 15 minuti dall'avvio.</p>
    </div>
    {(error || session?.error) && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error || session?.error}</div>}
    {session?.status === "testing" && <p role="status" className="flex items-center gap-2 text-sm text-blue-700"><LoaderCircle className="h-4 w-4 animate-spin" />Caricamento e verifica dei PDF in corso…</p>}
    {session?.status === "complete" && session.report && <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold text-emerald-700"><CheckCircle2 className="h-5 w-5" />Test completato</h2>
      <p className="mt-2 text-sm text-slate-600">Entrambi i PDF sono stati caricati e riscaricati senza modifiche. Puoi visualizzare le copie verificate qui sotto.</p>
      <dl className="my-5 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
        {[["Spazio totale", session.report.capacity.totalBytes], ["Spazio utilizzato", session.report.capacity.usedBytes], ["Spazio disponibile", session.report.capacity.freeBytes]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-900">{bytes(Number(value))}</dd></div>)}
      </dl>
      <div className="divide-y divide-slate-100">{session.report.documents.map(document => <div key={document.kind} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div><h3 className="font-semibold text-slate-900">{document.kind === "bolletta" ? "Bolletta di prova" : "Prospetto di prova"}</h3><p className="mt-1 text-xs text-slate-500">Caricamento: {document.uploadMs} ms · Apertura: {document.previewMs} ms · Download: {document.downloadMs} ms</p></div>
        <div className="flex gap-2"><button disabled={Boolean(opening)} onClick={() => openPdf(document.kind, false)} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-700 disabled:opacity-50"><Eye className="h-4 w-4" />Visualizza</button><button disabled={Boolean(opening)} onClick={() => openPdf(document.kind, true)} aria-label={`Scarica ${document.kind} di prova`} className="rounded-lg border border-slate-200 p-2 text-slate-600 disabled:opacity-50"><Download className="h-4 w-4" /></button></div>
      </div>)}</div>
      <p className="mt-3 text-xs text-slate-500">I PDF di esempio restano anche nella cartella Idromardi-test su pCloud.</p>
    </div>}
    {preview && <dialog ref={previewDialog} aria-label={preview.title} onCancel={() => setPreview(null)} className="fixed inset-0 m-auto flex h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-none flex-col overflow-hidden rounded-xl bg-white p-0 backdrop:bg-slate-900/80 sm:h-[calc(100dvh-48px)] sm:w-[calc(100%-48px)]">
      <div className="flex items-center justify-between rounded-t-xl bg-white p-3"><h2 className="font-semibold">{preview.title}</h2><button autoFocus onClick={() => setPreview(null)} className="rounded-lg border px-3 py-2 text-sm">Chiudi</button></div>
      <iframe title={preview.title} src={preview.url} className="min-h-0 flex-1 rounded-b-xl bg-white" />
    </dialog>}
  </section>;
}
