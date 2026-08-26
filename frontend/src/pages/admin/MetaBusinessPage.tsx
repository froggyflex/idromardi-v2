import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Inbox,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import api from "../../api/client";
import { getAuthUser } from "../../auth";

type Integration = {
  id: string;
  name: string;
  status: "PENDING" | "CONNECTED" | "PAUSED" | "ERROR";
  ai_mode: "OFF" | "DRAFT" | "APPROVAL" | "AUTO";
  business_account_id?: string | null;
  app_id?: string | null;
  graph_api_version?: string | null;
  has_access_token: number;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type MetaChannel = {
  id: string;
  integration_id: string;
  channel_type: string;
  external_account_id: string;
  display_name?: string | null;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
};

type WebhookEventSummary = {
  id: string;
  object_type?: string | null;
  processing_status: "RECEIVED" | "PROCESSED" | "UNMATCHED" | "FAILED";
  attempt_count: number;
  error_message?: string | null;
  received_at: string;
  processed_at?: string | null;
};

type Overview = {
  counts: {
    active_leads?: number;
    open_conversations?: number;
    unread_messages?: number;
    awaiting_approval?: number;
  };
  integrations: Integration[];
  channels: MetaChannel[];
  webhookDiagnostics: {
    total?: number;
    processed?: number;
    unmatched?: number;
    failed?: number;
    last_received_at?: string | null;
    last_processed_at?: string | null;
    recentEvents: WebhookEventSummary[];
  };
  webhookConfigured: boolean;
  encryptionConfigured: boolean;
};

type Conversation = {
  id: string;
  status: string;
  display_name?: string | null;
  external_contact_id: string;
  channel_type: string;
  channel_name?: string | null;
  unread_count: number;
  last_message_at?: string | null;
  last_message_text?: string | null;
  reply_window_expires_at?: string | null;
};

type Message = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  sender_kind: string;
  body_text?: string | null;
  status: string;
  occurred_at: string;
};

type Lead = {
  id: string;
  status: string;
  display_name?: string | null;
  phone?: string | null;
  email?: string | null;
  external_lead_id: string;
  form_id?: string | null;
  ad_id?: string | null;
  received_at: string;
};

type Tab = "INBOX" | "LEADS" | "SETTINGS";

const EMPTY_OVERVIEW: Overview = {
  counts: {},
  integrations: [],
  channels: [],
  webhookDiagnostics: { recentEvents: [] },
  webhookConfigured: false,
  encryptionConfigured: false,
};

function formFromOverview(overview: Overview) {
  const integration = overview.integrations[0];
  const channel = integration
    ? overview.channels.find((item) => item.integration_id === integration.id)
    : undefined;
  return {
    name: integration?.name || "Meta Business",
    businessAccountId: integration?.business_account_id || "",
    appId: integration?.app_id || "",
    graphApiVersion: integration?.graph_api_version || "",
    accessToken: "",
    channelType: channel?.channel_type || "WHATSAPP",
    externalAccountId: channel?.external_account_id || "",
    displayName: channel?.display_name || "",
  };
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function requestErrorMessage(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { error?: unknown } } };
  return typeof candidate?.response?.data?.error === "string"
    ? candidate.response.data.error
    : fallback;
}

function ChannelBadge({ type }: { type: string }) {
  const theme =
    type === "WHATSAPP"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : type === "INSTAGRAM"
        ? "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200"
        : "bg-blue-50 text-blue-700 border-blue-200";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${theme}`}>
      {type}
    </span>
  );
}

export default function MetaBusinessPage() {
  const user = getAuthUser();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const [tab, setTab] = useState<Tab>("INBOX");
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "Meta Business",
    businessAccountId: "",
    appId: "",
    graphApiVersion: "",
    accessToken: "",
    channelType: "WHATSAPP",
    externalAccountId: "",
    displayName: "",
  });

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) || null,
    [conversations, selectedId]
  );
  const savedIntegration = overview.integrations[0] || null;
  const savedChannel = savedIntegration
    ? overview.channels.find((item) => item.integration_id === savedIntegration.id) || null
    : null;
  const connected = overview.integrations.some((item) => item.status === "CONNECTED");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewResponse, conversationsResponse, leadsResponse] = await Promise.all([
        api.get<Overview>("/meta/overview"),
        api.get<{ conversations: Conversation[] }>("/meta/conversations?status=ALL"),
        api.get<{ leads: Lead[] }>("/meta/leads?status=ALL"),
      ]);
      setOverview(overviewResponse.data);
      setForm(formFromOverview(overviewResponse.data));
      setConversations(conversationsResponse.data.conversations || []);
      setLeads(leadsResponse.data.leads || []);
      setSelectedId((current) =>
        current && conversationsResponse.data.conversations.some((item) => item.id === current)
          ? current
          : conversationsResponse.data.conversations[0]?.id || null
      );
    } catch (requestError: unknown) {
      setError(requestErrorMessage(requestError, "Impossibile caricare Meta Business."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    api
      .get<{ messages: Message[] }>(`/meta/conversations/${selectedId}/messages`)
      .then((response) => setMessages(response.data.messages || []))
      .catch((requestError) =>
        setError(requestError?.response?.data?.error || "Impossibile caricare i messaggi.")
      );
  }, [selectedId]);

  async function sendMessage() {
    if (!selected || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/meta/conversations/${selected.id}/messages`, {
        text: draft.trim(),
        senderKind: "HUMAN",
      });
      setDraft("");
      setNotice("Messaggio inserito nella coda di invio sicura.");
      const response = await api.get<{ messages: Message[] }>(
        `/meta/conversations/${selected.id}/messages`
      );
      setMessages(response.data.messages || []);
    } catch (requestError: unknown) {
      setError(requestErrorMessage(requestError, "Invio non riuscito."));
    } finally {
      setSending(false);
    }
  }

  async function saveIntegration(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const payload = {
        id: overview.integrations[0]?.id,
        name: form.name,
        businessAccountId: form.businessAccountId || null,
        appId: form.appId || null,
        graphApiVersion: form.graphApiVersion || null,
        accessToken: form.accessToken || null,
        channels: form.externalAccountId
          ? [
              {
                channelType: form.channelType,
                externalAccountId: form.externalAccountId,
                displayName: form.displayName || null,
              },
            ]
          : [],
      };
      const response = await api.post<Overview>("/meta/integrations", payload);
      setOverview(response.data);
      setForm(formFromOverview(response.data));
      setNotice("Configurazione salvata. Il token non verrà mai mostrato nuovamente.");
    } catch (requestError: unknown) {
      setError(requestErrorMessage(requestError, "Configurazione non salvata."));
    }
  }

  async function replayWebhooks() {
    setReplaying(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.post<{
        replay: { examined: number; processed: number; stillUnmatched: number; failed: number };
        overview: Overview;
      }>("/meta/webhooks/replay", { limit: 100 });
      setOverview(response.data.overview);
      setForm(formFromOverview(response.data.overview));
      const result = response.data.replay;
      setNotice(
        `Webhook controllati: ${result.examined}. Recuperati: ${result.processed}. ` +
          `Non abbinati: ${result.stillUnmatched}. Errori: ${result.failed}.`
      );
      const conversationsResponse = await api.get<{ conversations: Conversation[] }>(
        "/meta/conversations?status=ALL"
      );
      setConversations(conversationsResponse.data.conversations || []);
      setSelectedId((current) =>
        current && conversationsResponse.data.conversations.some((item) => item.id === current)
          ? current
          : conversationsResponse.data.conversations[0]?.id || null
      );
    } catch (requestError: unknown) {
      setError(requestErrorMessage(requestError, "Riprocessamento webhook non riuscito."));
    } finally {
      setReplaying(false);
    }
  }

  async function updateLeadStatus(leadId: string, status: string) {
    setError(null);
    try {
      await api.patch(`/meta/leads/${leadId}`, { status });
      setLeads((current) =>
        current.map((lead) => (lead.id === leadId ? { ...lead, status } : lead))
      );
    } catch (requestError: unknown) {
      setError(requestErrorMessage(requestError, "Stato lead non aggiornato."));
    }
  }

  async function toggleConversationStatus() {
    if (!selected) return;
    const status = selected.status === "CLOSED" ? "OPEN" : "CLOSED";
    setError(null);
    try {
      await api.patch(`/meta/conversations/${selected.id}`, { status });
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === selected.id ? { ...conversation, status } : conversation
        )
      );
    } catch (requestError: unknown) {
      setError(requestErrorMessage(requestError, "Conversazione non aggiornata."));
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-6 w-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-900">Meta Business</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Lead e messaggi WhatsApp, Messenger e Instagram in un unico flusso operativo.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Aggiorna
        </button>
      </div>

      {!connected && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <div className="font-semibold text-amber-950">In attesa dell’accesso Meta Business</div>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                L’area è pronta. Quando l’invito sarà accettato, serviranno App ID, access token,
                versione Graph API e gli identificativi della Pagina, del numero WhatsApp o
                dell’account Instagram. Fino ad allora nessun messaggio può partire.
              </p>
            </div>
          </div>
        </div>
      )}

      {(error || notice) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            error
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error || notice}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Lead attivi", overview.counts.active_leads || 0, Users],
          ["Conversazioni aperte", overview.counts.open_conversations || 0, MessageCircle],
          ["Messaggi non letti", overview.counts.unread_messages || 0, Inbox],
          ["Approvazioni AI", overview.counts.awaiting_approval || 0, Bot],
        ].map(([label, value, Icon]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-500">{String(label)}</div>
              {/* @ts-expect-error tuple component */}
              <Icon className="h-5 w-5 text-slate-400" />
            </div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{String(value)}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
        {[
          ["INBOX", "Conversazioni", MessageCircle],
          ["LEADS", "Lead", Users],
          ["SETTINGS", "Configurazione", Settings2],
        ].map(([value, label, Icon]) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => setTab(value as Tab)}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Icon className="h-4 w-4" />
            {String(label)}
          </button>
        ))}
      </div>

      {tab === "INBOX" && (
        <div className="grid min-h-[560px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[360px_1fr]">
          <div className="border-b border-slate-200 lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-900">
              Inbox unificata
            </div>
            <div className="max-h-[560px] overflow-auto">
              {!conversations.length && (
                <div className="p-8 text-center text-sm text-slate-500">
                  Le conversazioni compariranno dopo il collegamento e il primo webhook.
                </div>
              )}
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={`w-full border-b border-slate-100 px-4 py-4 text-left hover:bg-slate-50 ${
                    selectedId === conversation.id ? "bg-blue-50/70" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-semibold text-slate-900">
                      {conversation.display_name || conversation.external_contact_id}
                    </div>
                    {!!conversation.unread_count && (
                      <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">
                        {conversation.unread_count}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <ChannelBadge type={conversation.channel_type} />
                    <span className="text-[11px] text-slate-400">
                      {formatDate(conversation.last_message_at)}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm text-slate-500">
                    {conversation.last_message_text || "Nessuna anteprima"}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-[560px] flex-col">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
                Seleziona una conversazione per visualizzare i messaggi.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                  <div>
                    <div className="font-bold text-slate-900">
                      {selected.display_name || selected.external_contact_id}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <ChannelBadge type={selected.channel_type} />
                      <span className="text-xs text-slate-500">
                        risposta entro {formatDate(selected.reply_window_expires_at)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleConversationStatus()}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    {selected.status === "CLOSED" ? "Riapri" : "Chiudi"}
                  </button>
                </div>
                <div className="flex-1 space-y-3 overflow-auto bg-slate-50 p-5">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                          message.direction === "OUTBOUND"
                            ? "bg-blue-600 text-white"
                            : "border border-slate-200 bg-white text-slate-800"
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{message.body_text || "Contenuto multimediale"}</div>
                        <div className={`mt-1 text-[10px] ${message.direction === "OUTBOUND" ? "text-blue-100" : "text-slate-400"}`}>
                          {message.sender_kind} · {message.status} · {formatDate(message.occurred_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-slate-200 p-4">
                  <div className="flex gap-2">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Scrivi una risposta..."
                      rows={2}
                      className="min-w-0 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={() => void sendMessage()}
                      disabled={sending || !draft.trim() || !connected}
                      className="inline-flex w-12 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sending ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "LEADS" && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 font-bold text-slate-900">Lead acquisiti</div>
          {!leads.length ? (
            <div className="p-10 text-center text-sm text-slate-500">
              I lead dei moduli Meta compariranno qui dopo il collegamento.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Lead</th>
                    <th className="px-5 py-3">Contatto</th>
                    <th className="px-5 py-3">Modulo / Annuncio</th>
                    <th className="px-5 py-3">Stato</th>
                    <th className="px-5 py-3">Ricevuto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leads.map((lead) => (
                    <tr key={lead.id}>
                      <td className="px-5 py-4 font-semibold text-slate-900">
                        {lead.display_name || lead.external_lead_id}
                      </td>
                      <td className="px-5 py-4 text-slate-600">{lead.phone || lead.email || "—"}</td>
                      <td className="px-5 py-4 text-slate-600">{lead.form_id || lead.ad_id || "—"}</td>
                      <td className="px-5 py-4">
                        <select
                          value={lead.status}
                          onChange={(event) => void updateLeadStatus(lead.id, event.target.value)}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-blue-700"
                        >
                          <option value="NEW">Nuovo</option>
                          <option value="CONTACTED">Contattato</option>
                          <option value="QUALIFIED">Qualificato</option>
                          <option value="WON">Acquisito</option>
                          <option value="LOST">Perso</option>
                          <option value="ARCHIVED">Archiviato</option>
                        </select>
                      </td>
                      <td className="px-5 py-4 text-slate-500">{formatDate(lead.received_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "SETTINGS" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_1.15fr]">
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-slate-900">Configurazione salvata</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Questi sono i valori effettivamente letti dal database.
                  </p>
                </div>
                {savedIntegration && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                      savedIntegration.status === "CONNECTED"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {savedIntegration.status}
                  </span>
                )}
              </div>
              {!savedIntegration ? (
                <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                  Nessuna connessione salvata.
                </p>
              ) : (
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    ["Nome", savedIntegration.name],
                    ["Business / WABA ID", savedIntegration.business_account_id || "—"],
                    ["Meta App ID", savedIntegration.app_id || "—"],
                    ["Graph API", savedIntegration.graph_api_version || "—"],
                    ["Tipo canale", savedChannel?.channel_type || "—"],
                    ["Phone Number / Page ID", savedChannel?.external_account_id || "—"],
                    ["Nome canale", savedChannel?.display_name || "—"],
                    ["Stato canale", savedChannel?.status || "—"],
                    [
                      "Access token",
                      savedIntegration.has_access_token ? "Salvato e cifrato" : "Non presente",
                    ],
                    ["Ultimo salvataggio", formatDate(savedIntegration.updated_at)],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl bg-slate-50 px-3 py-2.5">
                      <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        {label}
                      </dt>
                      <dd className="mt-1 break-all text-sm font-semibold text-slate-800">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-900">Stato sicurezza</h2>
              <div className="mt-4 space-y-3">
                {[
                  ["Firma webhook", overview.webhookConfigured, "META_APP_SECRET + verify token"],
                  ["Cifratura credenziali", overview.encryptionConfigured, "AES-256-GCM"],
                  ["Connessione operativa", connected, "Access token e almeno un canale"],
                ].map(([label, ready, detail]) => (
                  <div key={String(label)} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                    {ready ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <CircleAlert className="h-5 w-5 text-amber-600" />}
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{String(label)}</div>
                      <div className="text-xs text-slate-500">{String(detail)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-slate-900">Attività webhook</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Conferma se Meta sta realmente consegnando gli eventi alla piattaforma.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void replayWebhooks()}
                  disabled={!isAdmin || replaying || !Number(overview.webhookDiagnostics.unmatched || 0)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${replaying ? "animate-spin" : ""}`} />
                  Riprocessa
                </button>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ["Elaborati", overview.webhookDiagnostics.processed || 0, "text-emerald-700"],
                  ["Non abbinati", overview.webhookDiagnostics.unmatched || 0, "text-amber-700"],
                  ["Errori", overview.webhookDiagnostics.failed || 0, "text-rose-700"],
                ].map(([label, value, color]) => (
                  <div key={String(label)} className="rounded-xl bg-slate-50 p-3 text-center">
                    <div className={`text-xl font-black ${color}`}>{String(value)}</div>
                    <div className="mt-1 text-[10px] font-semibold text-slate-500">{label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {overview.webhookDiagnostics.recentEvents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">
                    Nessun webhook ricevuto. Se hai appena risposto su WhatsApp, controlla App Secret e sottoscrizione messages.
                  </div>
                ) : (
                  overview.webhookDiagnostics.recentEvents.slice(0, 5).map((event) => (
                    <div key={event.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-slate-700">
                          {event.object_type || "Evento Meta"}
                        </div>
                        <div className="text-[10px] text-slate-500">{formatDate(event.received_at)}</div>
                        {event.error_message && (
                          <div className="mt-1 truncate text-[10px] text-rose-700">{event.error_message}</div>
                        )}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${
                          event.processing_status === "PROCESSED"
                            ? "bg-emerald-100 text-emerald-800"
                            : event.processing_status === "UNMATCHED"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {event.processing_status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
              <div className="flex gap-3">
                <Bot className="h-5 w-5 shrink-0 text-blue-700" />
                <div>
                  <div className="font-bold text-blue-950">Assistente AI predisposto, non attivo</div>
                  <p className="mt-1 text-sm leading-6 text-blue-900">
                    I messaggi AI sono identificati separatamente e passano dalla stessa coda e dallo stesso audit.
                    La modalità iniziale resta OFF; in modalità approvazione, un operatore deve autorizzare ogni invio.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={saveIntegration} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">Collega un canale Meta</h2>
            <p className="mt-1 text-sm text-slate-500">
              I campi mostrano la configurazione salvata. Modificali e salva per aggiornarla.
            </p>
            <fieldset disabled={!isAdmin} className="mt-5 grid gap-4 sm:grid-cols-2 disabled:opacity-60">
              {[
                ["Nome connessione", "name", "Meta Business"],
                ["Business Account ID", "businessAccountId", "123456789"],
                ["Meta App ID", "appId", "123456789"],
                ["Versione Graph API", "graphApiVersion", "vXX.X"],
              ].map(([label, key, placeholder]) => (
                <label key={key} className="block">
                  <span className="text-xs font-semibold text-slate-600">{label}</span>
                  <input
                    value={form[key as keyof typeof form]}
                    onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                    placeholder={placeholder}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              ))}
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Access token</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.accessToken}
                  onChange={(event) => setForm((current) => ({ ...current, accessToken: event.target.value }))}
                  placeholder={
                    savedIntegration?.has_access_token
                      ? "Token già salvato — compila solo per sostituirlo"
                      : "Token di sistema o Page access token"
                  }
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <span className="mt-1 block text-[10px] text-slate-500">
                  Per sicurezza il valore non viene mai restituito dal server.
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Canale</span>
                <select
                  value={form.channelType}
                  onChange={(event) => setForm((current) => ({ ...current, channelType: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="MESSENGER">Messenger</option>
                  <option value="INSTAGRAM">Instagram</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">ID canale</span>
                <input
                  value={form.externalAccountId}
                  onChange={(event) => setForm((current) => ({ ...current, externalAccountId: event.target.value }))}
                  placeholder="Phone Number ID o Page ID"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Nome visualizzato</span>
                <input
                  value={form.displayName}
                  onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="Assistenza clienti"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </fieldset>
            <button
              type="submit"
              disabled={!isAdmin}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              Salva connessione cifrata
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
