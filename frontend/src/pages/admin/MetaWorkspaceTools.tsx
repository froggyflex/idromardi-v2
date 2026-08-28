import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Download,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import api from "../../api/client";
import { getAuthUser } from "../../auth";

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800";
const button =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const errorText = (error: unknown) => {
  const value = error as {
    response?: { data?: { error?: string } };
    message?: string;
  };
  return (
    value.response?.data?.error ||
    "Operazione non riuscita. Il server potrebbe essere in avvio: riprova tra poco."
  );
};
const utc = (value: string) =>
  new Date(
    /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z",
  );
const date = (value?: string | null) =>
  value ? utc(value).toLocaleString("it-IT") : "—";
const localInput = (value?: string) => {
  if (!value) return "";
  const parsed = utc(value);
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const labels: Record<string, string> = {
  READY: "Pronto",
  RETRY: "Nuovo tentativo programmato",
  PROCESSING: "Invio in corso",
  SENT: "Inviato",
  FAILED: "Da correggere",
  UNCERTAIN: "Esito da verificare",
  CANCELLED: "Annullato",
  WAITING_APPROVAL: "Da approvare",
  NEW: "Nuovo",
  CONTACTED: "Contattato",
  QUALIFIED: "Qualificato",
  WON: "Acquisito",
  LOST: "Perso",
  ARCHIVED: "Archiviato",
  PENDING: "Da recuperare",
  COMPLETE: "Completo",
};

export type ToolConversation = {
  id: string;
  channel_id: string;
  channel_type: string;
  channel_status?: string;
  contact_id: string;
  consent_status?: string;
  consent_note?: string | null;
  reply_window_expires_at?: string | null;
  status: string;
};
type Attachment = { index: number; type: string; name: string };

export function MetaAttachment({
  messageId,
  attachment,
}: {
  messageId: string;
  attachment: Attachment;
}) {
  const [url, setUrl] = useState<string | null>(null),
    [mime, setMime] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await api.get(
        `/meta/messages/${messageId}/attachments/${attachment.index}`,
        { responseType: "blob", timeout: 60000 },
      );
      setMime(response.data.type);
      setUrl(URL.createObjectURL(response.data));
    } catch {
      setError(
        "File non disponibile o scaduto. Riprova; per contenuti vecchi potrebbe servire un nuovo invio.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="my-2 max-w-full space-y-2">
      {!url && (
        <button className={button} disabled={busy} onClick={() => void load()}>
          {busy ? (
            <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 inline h-4 w-4" />
          )}
          {attachment.name || "Apri allegato"}
        </button>
      )}
      {url && (
        <>
          {mime.startsWith("image/") ? (
            <img
              src={url}
              alt={attachment.name}
              className="max-h-72 max-w-full rounded-lg"
            />
          ) : mime.startsWith("audio/") ? (
            <audio src={url} controls className="max-w-full" />
          ) : mime.startsWith("video/") ? (
            <video
              src={url}
              controls
              className="max-h-72 max-w-full rounded-lg"
            />
          ) : null}
          <a
            href={url}
            download={attachment.name || "allegato"}
            className="block text-xs underline"
          >
            Scarica allegato
          </a>
        </>
      )}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}

type Template = {
  id: string;
  name: string;
  language: string;
  status: string;
  supported: boolean;
  preview: string;
  parameters: { key: string; label: string; component: string }[];
};
type Draft = { text: string; key: string };
export function MetaComposer({
  conversation,
  onSent,
}: {
  conversation: ToolConversation;
  onSent: () => void;
}) {
  const storageKey = `meta-draft:${getAuthUser()?.id || getAuthUser()?.username}:${conversation.id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      return typeof saved?.text === "string" && typeof saved?.key === "string"
        ? saved
        : { text: "", key: crypto.randomUUID() };
    } catch {
      return { text: "", key: crypto.randomUUID() };
    }
  });
  const [mode, setMode] = useState("text"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [templates, setTemplates] = useState<Template[]>([]),
    [templateId, setTemplateId] = useState(""),
    [values, setValues] = useState<Record<string, string>>({});
  const [templateLoading, setTemplateLoading] = useState(false),
    [nextTemplates, setNextTemplates] = useState<string | null>(null);
  const [consentNote, setConsentNote] = useState(
    conversation.consent_note || "",
  );
  const requestKey = useRef(crypto.randomUUID());
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* Private browsing may disable storage. */
    }
  }, [draft, storageKey]);
  const expired =
    !conversation.reply_window_expires_at ||
    utc(conversation.reply_window_expires_at).getTime() <= Date.now();
  const blocked =
    conversation.consent_status === "OPTED_OUT" ||
    conversation.channel_status !== "ACTIVE" ||
    ["ARCHIVED", "CLOSED", "SPAM"].includes(conversation.status);
  const selected = templates.find((t) => t.id === templateId);
  const changeMode = (next: string) => {
    setMode(next);
    setError("");
    requestKey.current = crypto.randomUUID();
  };
  const loadTemplates = useCallback(
    async (after?: string) => {
      setTemplateLoading(true);
      setError("");
      try {
        const { data } = await api.get<{
          templates: Template[];
          next: string | null;
        }>(`/meta/channels/${conversation.channel_id}/templates`, {
          params: { after },
          timeout: 60000,
        });
        setTemplates((current) =>
          after ? [...current, ...data.templates] : data.templates,
        );
        setNextTemplates(data.next);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setTemplateLoading(false);
      }
    },
    [conversation.channel_id],
  );
  useEffect(() => {
    if (mode === "template") void loadTemplates();
  }, [mode, loadTemplates]);
  async function saveConsent(status: string) {
    if (
      status === "OPTED_OUT" &&
      !window.confirm(
        "Bloccare gli invii a questo contatto e annullare quelli in attesa?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api.patch(`/meta/contacts/${conversation.contact_id}/consent`, {
        status,
        note: consentNote,
      });
      onSent();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body: Record<string, unknown> = {
        senderKind: "HUMAN",
        idempotencyKey: mode === "text" ? draft.key : requestKey.current,
      };
      if (mode === "text") body.text = draft.text.trim();
      if (mode === "template") {
        if (!selected) throw new Error();
        body.template = { id: selected.id, name: selected.name, values };
      }
      if (mode === "media") {
        if (!file) throw new Error();
        const form = new FormData();
        form.append("file", file);
        const upload = await api.post(
          `/meta/channels/${conversation.channel_id}/attachments`,
          form,
          { timeout: 60000 },
        );
        body.attachmentId = upload.data.id;
      }
      const { data } = await api.post(
        `/meta/conversations/${conversation.id}/messages`,
        body,
        { timeout: 60000 },
      );
      if (mode === "text") setDraft({ text: "", key: crypto.randomUUID() });
      setFile(null);
      setValues({});
      requestKey.current = crypto.randomUUID();
      setNotice("Messaggio salvato. Invio in corso…");
      onSent();
      try {
        const result = await api.post(
          "/meta/outbox/process",
          { jobId: data.jobId },
          { timeout: 60000 },
        );
        setNotice(
          result.data.sent
            ? "Inviato correttamente."
            : result.data.state === "UNCERTAIN"
              ? "Esito da verificare nel centro attività."
              : "Salvato. Controlla stato e dettagli nel centro attività.",
        );
      } catch {
        setNotice(
          "Messaggio salvato; l'esito dell'invio verrà aggiornato al ritorno della connessione. Non riscriverlo: controlla Attività.",
        );
      }
      onSent();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 border-t border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full px-2 py-1 ${expired ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}
        >
          {expired
            ? "Finestra di risposta scaduta"
            : `Risposta libera fino a ${date(conversation.reply_window_expires_at)}`}
        </span>
        <span className="text-slate-500">
          {conversation.channel_status !== "ACTIVE"
            ? "Canale da verificare"
            : "Bozze di testo salvate in questa scheda"}
        </span>
      </div>
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer">
          Consenso:{" "}
          {conversation.consent_status === "OPTED_IN"
            ? "registrato"
            : conversation.consent_status === "OPTED_OUT"
              ? "revocato — invii bloccati"
              : "non registrato"}
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label="Fonte e data del consenso"
            className={field}
            value={consentNote}
            onChange={(e) => setConsentNote(e.target.value)}
            placeholder="Fonte e data del consenso, es. modulo del…"
          />
          <button
            disabled={busy}
            className={button}
            onClick={() => void saveConsent("OPTED_IN")}
          >
            Registra consenso
          </button>
          <button
            disabled={busy}
            className={button}
            onClick={() => void saveConsent("OPTED_OUT")}
          >
            Blocca invii
          </button>
        </div>
      </details>
      <div className="flex gap-2">
        <button
          disabled={busy}
          aria-pressed={mode === "text"}
          className={button}
          onClick={() => changeMode("text")}
        >
          Testo
        </button>
        <button
          disabled={busy}
          aria-pressed={mode === "media"}
          className={button}
          onClick={() => changeMode("media")}
        >
          <Paperclip className="mr-1 inline h-3 w-3" />
          Allegato
        </button>
        {conversation.channel_type === "WHATSAPP" && (
          <button
            disabled={busy}
            aria-pressed={mode === "template"}
            className={button}
            onClick={() => changeMode("template")}
          >
            Template approvato
          </button>
        )}
      </div>
      {mode === "text" && (
        <textarea
          aria-label="Risposta"
          disabled={busy}
          className={field}
          rows={3}
          placeholder="Scrivi una risposta…"
          value={draft.text}
          onChange={(e) =>
            setDraft({ text: e.target.value, key: crypto.randomUUID() })
          }
        />
      )}
      {mode === "media" && (
        <div className="space-y-2">
          <input
            aria-label="Allegato da inviare"
            disabled={busy}
            type="file"
            accept={
              conversation.channel_type === "INSTAGRAM"
                ? "image/jpeg,image/png,application/pdf,video/mp4"
                : "image/jpeg,image/png,application/pdf,audio/mpeg,audio/ogg,video/mp4"
            }
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              requestKey.current = crypto.randomUUID();
            }}
          />
          <p className="text-xs text-slate-500">
            Massimo 8 MB (immagini WhatsApp: 5 MB). Instagram: JPG, PNG, PDF o
            MP4. Il file è privato; per Messenger/Instagram Meta riceve un link
            valido 10 minuti.
          </p>
        </div>
      )}
      {mode === "template" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              aria-label="Template WhatsApp"
              className={field}
              disabled={busy || templateLoading}
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setValues({});
                requestKey.current = crypto.randomUUID();
              }}
            >
              <option value="">Seleziona un template…</option>
              {templates.map((t) => (
                <option
                  key={t.id}
                  value={t.id}
                  disabled={t.status !== "APPROVED" || !t.supported}
                >
                  {t.name} · {t.language}
                  {t.status !== "APPROVED"
                    ? ` · ${t.status}`
                    : !t.supported
                      ? " · formato avanzato non supportato"
                      : ""}
                </option>
              ))}
            </select>
            <button
              aria-label="Aggiorna template"
              className={button}
              disabled={templateLoading || busy}
              onClick={() => void loadTemplates()}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          {nextTemplates && (
            <button
              className={button}
              onClick={() => void loadTemplates(nextTemplates)}
            >
              Altri template
            </button>
          )}
          {selected && (
            <>
              <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">
                {selected.preview.replace(
                  /{{([^}]+)}}/g,
                  (_match, key) => values[key] || `[${key}]`,
                )}
              </p>
              {selected.parameters.map((p) => (
                <label key={p.key} className="block text-xs">
                  {p.component === "body" ? "Testo" : "Intestazione"} ·{" "}
                  {p.label}
                  <input
                    required
                    maxLength={1000}
                    disabled={busy}
                    className={field}
                    value={values[p.key] || ""}
                    onChange={(e) => {
                      setValues((current) => ({
                        ...current,
                        [p.key]: e.target.value,
                      }));
                      requestKey.current = crypto.randomUUID();
                    }}
                  />
                </label>
              ))}
            </>
          )}
          <p className="text-xs text-slate-500">
            La disponibilità è ricontrollata prima dell’invio. Sono supportati
            template testuali e pulsanti statici. Crea/approva i modelli in
            WhatsApp Manager.
          </p>
        </div>
      )}
      {blocked && (
        <p className="text-xs text-amber-800">
          Invio bloccato: controlla canale, stato della conversazione e
          consenso.
        </p>
      )}
      {expired && mode !== "template" && (
        <p className="text-xs text-amber-800">
          {conversation.channel_type === "WHATSAPP"
            ? "Usa un template approvato con consenso registrato."
            : "Attendi un nuovo messaggio del cliente."}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-slate-600">
          {notice}
        </p>
      )}
      <button
        disabled={
          busy ||
          blocked ||
          (expired && mode !== "template") ||
          (mode === "text" && !draft.text.trim()) ||
          (mode === "media" && (!file || file.size > 8 * 1024 * 1024)) ||
          (mode === "template" &&
            (!selected ||
              !selected.supported ||
              selected.status !== "APPROVED" ||
              selected.parameters.some((p) => !values[p.key]?.trim()) ||
              conversation.consent_status !== "OPTED_IN"))
        }
        onClick={() => void send()}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        Invia {mode === "template" ? "template" : "messaggio"}
      </button>
    </div>
  );
}

type Job = {
  id: string;
  state: string;
  display_name?: string;
  external_contact_id: string;
  channel_type: string;
  channel_name?: string;
  body_text?: string;
  last_error?: string;
  attempt_count: number;
  next_attempt_at?: string;
  created_at: string;
};
export function MetaActivity() {
  const [jobs, setJobs] = useState<Job[]>([]),
    [offset, setOffset] = useState(0),
    [filter, setFilter] = useState("ATTENTION"),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const { data } = await api.get("/meta/outbox", {
        params: { offset, state: filter },
        timeout: 60000,
      });
      setJobs(data.jobs);
      setMore(data.hasMore);
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      inFlight.current = false;
    }
  }, [offset, filter]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busy) void load();
    }, 10000);
    return () => clearInterval(timer);
  }, [load, busy]);
  async function act(job: Job, action: string) {
    if (
      action === "retry" &&
      job.state === "UNCERTAIN" &&
      !window.confirm(
        "Meta potrebbe aver già consegnato questo messaggio. Hai verificato con il destinatario che NON è arrivato? Un nuovo tentativo può duplicarlo.",
      )
    )
      return;
    if (action === "cancel" && !window.confirm("Annullare questo invio?"))
      return;
    setBusy(job.id);
    try {
      await api.patch(`/meta/outbox/${job.id}`, {
        action,
        acknowledgeDuplicateRisk: job.state === "UNCERTAIN",
      });
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function review(job: Job, approved: boolean) {
    setBusy(job.id);
    try {
      await api.post(`/meta/outbox/${job.id}/review`, { approved });
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold">Centro attività</h2>
          <p className="text-xs text-slate-500">
            Gli invii riprendono quando il server è attivo. Gli esiti incerti
            non vengono reinviati automaticamente.
          </p>
        </div>
        <select
          aria-label="Filtro coda"
          className={`${field} sm:w-auto`}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setOffset(0);
          }}
        >
          <option value="ATTENTION">Da gestire</option>
          <option value="ALL">Tutto lo storico</option>
          {Object.entries(labels)
            .filter(([k]) =>
              ["READY", "RETRY", "FAILED", "UNCERTAIN", "SENT"].includes(k),
            )
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {!jobs.length && (
        <p className="py-8 text-center text-sm text-slate-500">
          Nessun invio in questa vista.
        </p>
      )}
      <div className="divide-y divide-slate-100">
        {jobs.map((job) => (
          <article key={job.id} className="space-y-2 py-4">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="text-sm font-semibold">
                {job.display_name || job.external_contact_id} ·{" "}
                {job.channel_name || job.channel_type}
              </p>
              <span
                className={`rounded-full px-2 py-1 text-xs ${["FAILED", "UNCERTAIN"].includes(job.state) ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-700"}`}
              >
                {labels[job.state]}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">
              {job.body_text || "Contenuto eliminato"}
            </p>
            <p className="text-xs text-slate-500">
              {date(job.created_at)} · Tentativi: {job.attempt_count}
              {job.next_attempt_at
                ? ` · Prossimo: ${date(job.next_attempt_at)}`
                : ""}
            </p>
            {job.last_error && (
              <p className="text-xs text-rose-700">{job.last_error}</p>
            )}
            <div className="flex gap-2">
              {["FAILED", "RETRY", "UNCERTAIN"].includes(job.state) && (
                <button
                  disabled={!!busy}
                  className={button}
                  onClick={() => void act(job, "retry")}
                >
                  Riprova
                </button>
              )}
              {!["SENT", "PROCESSING", "CANCELLED"].includes(job.state) && (
                <button
                  disabled={!!busy}
                  className={button}
                  onClick={() => void act(job, "cancel")}
                >
                  Annulla invio
                </button>
              )}
              {job.state === "WAITING_APPROVAL" && (
                <>
                  <button
                    className={button}
                    disabled={!!busy}
                    onClick={() => void review(job, true)}
                  >
                    Approva proposta
                  </button>
                  <button
                    className={button}
                    disabled={!!busy}
                    onClick={() => void review(job, false)}
                  >
                    Rifiuta
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      <Pager offset={offset} size={50} more={more} change={setOffset} />
    </section>
  );
}

function Pager({
  offset,
  size,
  more,
  change,
}: {
  offset: number;
  size: number;
  more: boolean;
  change: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
      <button
        className={button}
        disabled={!offset}
        onClick={() => change(Math.max(0, offset - size))}
      >
        Precedenti
      </button>
      <span className="text-xs text-slate-500">
        Pagina {Math.floor(offset / size) + 1}
      </span>
      <button
        className={button}
        disabled={!more}
        onClick={() => change(offset + size)}
      >
        Successivi
      </button>
    </div>
  );
}

type Lead = {
  id: string;
  contact_id?: string;
  status: string;
  display_name?: string;
  phone?: string;
  email?: string;
  external_lead_id: string;
  received_at: string;
  notes?: string;
  follow_up_at?: string;
  assigned_name?: string;
  hydration_status: string;
  hydration_last_error?: string;
  field_data_json?: { name: string; values: string[] }[];
  raw_payload_json?: { custom_disclaimer_responses?: unknown };
};
export function MetaLeads({
  onWhatsApp,
}: {
  onWhatsApp: (phone: string, name: string) => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("ALL"),
    [more, setMore] = useState(false),
    [selected, setSelected] = useState<Lead | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const { data } = await api.get("/meta/leads", {
        params: { offset, limit: 50, search, status },
        timeout: 60000,
      });
      setLeads(data.leads);
      setMore(data.hasMore);
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      inFlight.current = false;
    }
  }, [offset, search, status]);
  useEffect(() => {
    const delay = window.setTimeout(() => void load(), 250);
    const timer = window.setInterval(() => {
      if (!selected && document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      clearTimeout(delay);
      clearInterval(timer);
    };
  }, [load, selected]);
  async function recover() {
    setBusy(true);
    try {
      const { data } = await api.post("/meta/leads/process");
      await load();
      if (data.error) setError(data.error);
      else if (!data.processed)
        setError(
          "Nessun lead pronto al recupero: controlla canale, accessi Lead Ads e prossimi tentativi.",
        );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function erase(lead: Lead) {
    if (
      !lead.contact_id ||
      window.prompt(
        "Cancella dal database attivo questo contatto e i lead collegati. Backup e copie Meta sono separati. Scrivi ELIMINA.",
      ) !== "ELIMINA"
    )
      return;
    setBusy(true);
    try {
      await api.post(`/meta/contacts/${lead.contact_id}/erase`, {
        confirmation: "ELIMINA",
      });
      setSelected(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(lead: Lead, changes: Record<string, unknown>) {
    setBusy(true);
    try {
      await api.patch(`/meta/leads/${lead.id}`, changes);
      await load();
      setSelected(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Lead e follow-up</h2>
        <button
          disabled={busy}
          className={button}
          onClick={() => void recover()}
        >
          Recupera prossimo lead
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className={`${field} sm:flex-1`}
          placeholder="Cerca nome, telefono, email o note…"
          aria-label="Cerca lead"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <select
          className={`${field} sm:w-auto`}
          aria-label="Stato lead"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="ALL">Tutti gli stati</option>
          {["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST", "ARCHIVED"].map(
            (s) => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ),
          )}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {leads.map((lead) => (
          <button
            key={lead.id}
            className="space-y-2 rounded-xl border border-slate-200 p-4 text-left hover:border-blue-400"
            onClick={() =>
              setSelected({
                ...lead,
                follow_up_at: localInput(lead.follow_up_at),
              })
            }
          >
            <div className="flex justify-between gap-2">
              <strong className="break-all text-sm">
                {lead.display_name || lead.external_lead_id}
              </strong>
              <span className="text-xs text-blue-700">
                {labels[lead.status]}
              </span>
            </div>
            <p className="break-all text-xs text-slate-600">
              {lead.phone || lead.email || "Dati contatto in recupero"}
            </p>
            <p className="text-xs text-slate-500">
              {date(lead.received_at)}
              {lead.assigned_name ? ` · ${lead.assigned_name}` : ""}
            </p>
            {lead.follow_up_at && (
              <p className="text-xs text-amber-800">
                Follow-up: {date(lead.follow_up_at)}
              </p>
            )}
            {lead.hydration_status !== "COMPLETE" && (
              <p className="text-xs text-rose-700">
                Recupero:{" "}
                {labels[lead.hydration_status] || lead.hydration_status}
              </p>
            )}
          </button>
        ))}
      </div>
      {!leads.length && (
        <p className="py-8 text-center text-sm text-slate-500">
          Nessun lead trovato.
        </p>
      )}
      <Pager offset={offset} size={50} more={more} change={setOffset} />
      {selected && (
        <Dialog
          label="Dettaglio lead"
          onClose={() => !busy && setSelected(null)}
        >
          <div className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">
                {selected.display_name || "Dettaglio lead"}
              </h3>
              <button
                className={button}
                onClick={() => setSelected(null)}
                aria-label="Chiudi dettaglio lead"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm">
              {selected.phone} {selected.email}
            </p>
            <div className="rounded-lg bg-slate-50 p-3 text-xs">
              {selected.field_data_json?.map((item, index) => (
                <p key={`${item.name}-${index}`} className="break-words">
                  <strong>{item.name}:</strong> {item.values?.join(", ")}
                </p>
              ))}
            </div>
            {selected.raw_payload_json?.custom_disclaimer_responses != null && (
              <details className="text-xs">
                <summary>Risposte alle informative del modulo</summary>
                <pre className="overflow-x-auto">
                  {JSON.stringify(
                    selected.raw_payload_json.custom_disclaimer_responses,
                    null,
                    2,
                  )}
                </pre>
              </details>
            )}
            <label className="block text-xs">
              Stato
              <select
                className={field}
                value={selected.status}
                onChange={(e) =>
                  setSelected({ ...selected, status: e.target.value })
                }
              >
                {[
                  "NEW",
                  "CONTACTED",
                  "QUALIFIED",
                  "WON",
                  "LOST",
                  "ARCHIVED",
                ].map((s) => (
                  <option key={s} value={s}>
                    {labels[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              Note
              <textarea
                className={field}
                rows={4}
                value={selected.notes || ""}
                onChange={(e) =>
                  setSelected({ ...selected, notes: e.target.value })
                }
              />
            </label>
            <label className="block text-xs">
              Prossimo follow-up
              <input
                className={field}
                type="datetime-local"
                value={
                  selected.follow_up_at?.slice(0, 16).replace(" ", "T") || ""
                }
                onChange={(e) =>
                  setSelected({ ...selected, follow_up_at: e.target.value })
                }
              />
            </label>
            {selected.hydration_last_error && (
              <p className="text-xs text-rose-700">
                {selected.hydration_last_error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy}
                className={button}
                onClick={() =>
                  void save(selected, {
                    status: selected.status,
                    notes: selected.notes || "",
                    followUpAt: selected.follow_up_at
                      ? new Date(selected.follow_up_at).toISOString()
                      : null,
                  })
                }
              >
                Salva modifiche
              </button>
              <button
                disabled={busy}
                className={button}
                onClick={() =>
                  void save(selected, {
                    assignToMe: true,
                    status: selected.status,
                    notes: selected.notes || "",
                    followUpAt: selected.follow_up_at
                      ? new Date(selected.follow_up_at).toISOString()
                      : null,
                  })
                }
              >
                Assegna a me
              </button>
              {["FAILED", "RETRY", "PENDING"].includes(
                selected.hydration_status,
              ) && (
                <button
                  disabled={busy}
                  className={button}
                  onClick={() =>
                    void save(selected, {
                      retry: true,
                      status: selected.status,
                      notes: selected.notes || "",
                      followUpAt: selected.follow_up_at
                        ? new Date(selected.follow_up_at).toISOString()
                        : null,
                    })
                  }
                >
                  Riprova recupero dati
                </button>
              )}
              {selected.phone && (
                <button
                  className={button}
                  onClick={() => {
                    onWhatsApp(selected.phone!, selected.display_name || "");
                    setSelected(null);
                  }}
                >
                  Apri contatto WhatsApp
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Aprire WhatsApp non invia nulla e non registra automaticamente il
              consenso. Verificalo prima di contattare il lead.
            </p>
            {error && (
              <p role="alert" className="text-sm text-rose-700">
                {error}
              </p>
            )}
            {getAuthUser()?.role === "ADMIN" && selected.contact_id && (
              <button
                disabled={busy}
                className="text-xs text-rose-700 underline"
                onClick={() => void erase(selected)}
              >
                Cancella dati del contatto e lead
              </button>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}

export function MetaNewWhatsApp({
  channels,
  onClose,
  onCreated,
  initial,
}: {
  channels: { id: string; display_name?: string | null }[];
  onClose: () => void;
  onCreated: (id: string) => void | Promise<void>;
  initial: { phone: string; name: string };
}) {
  const [phone, setPhone] = useState(initial.phone),
    [name, setName] = useState(initial.name),
    [channelId, setChannelId] = useState(channels[0]?.id || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const { data } = await api.post("/meta/conversations/whatsapp", {
        phone,
        name,
        channelId,
      });
      await onCreated(data.conversationId);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label="Nuovo contatto WhatsApp" onClose={() => !busy && onClose()}>
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5">
        <h2 className="font-bold">Nuovo contatto WhatsApp</h2>
        <label className="block text-xs">
          Canale
          <select
            className={field}
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          >
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.display_name || "WhatsApp"}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          Nome
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-xs">
          Numero con prefisso internazionale
          <input
            className={field}
            placeholder="+39…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <p className="text-xs text-slate-500">
          Non viene inviato alcun messaggio. Per il primo contatto serviranno
          consenso documentato e un template approvato.
        </p>
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            className={button}
            disabled={busy || !channelId}
            onClick={() => void create()}
          >
            Apri conversazione
          </button>
          <button className={button} disabled={busy} onClick={onClose}>
            Annulla
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function Dialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = container.current;
    const focusable = () =>
      Array.from(
        element?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ) || [],
      );
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    element?.addEventListener("keydown", key);
    return () => {
      element?.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      ref={container}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
    >
      {children}
    </div>
  );
}
