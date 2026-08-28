import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
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
  Trash2,
  Users,
} from "lucide-react";
import api from "../../api/client";
import { getAuthUser } from "../../auth";
import { requestMetaUnreadRefresh } from "../../metaNotifications";
import {
  MetaActivity,
  MetaAttachment,
  MetaComposer,
  MetaLeads,
  MetaNewWhatsApp,
} from "./MetaWorkspaceTools";

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
  leads_enabled?: number;
  last_token_refresh_at?: string | null;
  refresh_error?: string | null;
  id: string;
  integration_id: string;
  channel_type: string;
  external_account_id: string;
  display_name?: string | null;
  status: string;
  has_access_token?: number;
  token_expires_at?: string | null;
  credential_mode?: "FACEBOOK_LOGIN" | "INSTAGRAM_LOGIN" | null;
  api_sender_id?: string | null;
  last_verified_at?: string | null;
  last_error?: string | null;
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
    queued_messages?: number;
    failed_messages?: number;
    lead_errors?: number;
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
  outboxWorkerEnabled: boolean;
  instagramLogin?: {
    appId: string | null;
    appSecretConfigured: boolean;
    verifyTokenConfigured: boolean;
  };
};

type Conversation = {
  channel_id: string;
  channel_status?: string;
  contact_id: string;
  consent_status?: string;
  consent_note?: string | null;
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
  archived_at?: string | null;
  last_message_deleted_at?: string | null;
};

type Message = {
  attachments?: { index: number; type: string; name: string }[];
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  sender_kind: string;
  body_text?: string | null;
  status: string;
  occurred_at: string;
  delivery_state?: string | null;
  error_message?: string | null;
  created_at?: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
};

type Tab = "INBOX" | "LEADS" | "SETTINGS" | "ACTIVITY";
type ConversationView = "ACTIVE" | "ARCHIVED";
type ChannelType = "WHATSAPP" | "MESSENGER" | "INSTAGRAM";
type ChannelFilter = "ALL" | ChannelType;

type ChannelDraft = {
  leadsEnabled?: boolean;
  id?: string;
  externalAccountId: string;
  displayName: string;
  accessToken: string;
  tokenExpiresAt: string;
  credentialMode: "INSTAGRAM_LOGIN" | "FACEBOOK_LOGIN";
};

const CHANNEL_TYPES: ChannelType[] = ["WHATSAPP", "MESSENGER", "INSTAGRAM"];
const CHANNEL_DETAILS: Record<
  ChannelType,
  {
    title: string;
    idLabel: string;
    idPlaceholder: string;
    tokenLabel: string;
    permissions: string;
  }
> = {
  WHATSAPP: {
    title: "WhatsApp Business",
    idLabel: "Phone Number ID",
    idPlaceholder: "ID del nuovo numero di produzione",
    tokenLabel: "System user access token",
    permissions:
      "business_management, whatsapp_business_management, whatsapp_business_messaging",
  },
  MESSENGER: {
    title: "Facebook Messenger",
    idLabel: "Facebook Page ID",
    idPlaceholder: "ID della Pagina Facebook",
    tokenLabel: "Page access token",
    permissions:
      "business_management, pages_show_list, pages_manage_metadata, pages_messaging, pages_read_engagement, leads_retrieval",
  },
  INSTAGRAM: {
    title: "Instagram Direct",
    idLabel: "Instagram Professional Account ID",
    idPlaceholder: "ID dell'account Instagram professionale collegato",
    tokenLabel: "Page access token o Instagram user token",
    permissions:
      "Pagina collegata: instagram_basic, instagram_manage_messages, pages_manage_metadata. Instagram Login: instagram_business_basic, instagram_business_manage_messages",
  },
};

const EMPTY_OVERVIEW: Overview = {
  counts: {},
  integrations: [],
  channels: [],
  webhookDiagnostics: { recentEvents: [] },
  webhookConfigured: false,
  encryptionConfigured: false,
  outboxWorkerEnabled: false,
};

function formFromOverview(overview: Overview, integrationId = "") {
  const integration = integrationId
    ? overview.integrations.find((item) => item.id === integrationId)
    : overview.integrations[0];
  return {
    name: integration?.name || "Meta Business",
    businessAccountId: integration?.business_account_id || "",
    appId: integration?.app_id || "",
    graphApiVersion: integration?.graph_api_version || "",
  };
}

function dateTimeLocalValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(
    /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z",
  );
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function channelDraftsFromOverview(
  overview: Overview,
  integrationId = "",
): Record<ChannelType, ChannelDraft> {
  const integration = integrationId
    ? overview.integrations.find((item) => item.id === integrationId)
    : overview.integrations[0];
  return Object.fromEntries(
    CHANNEL_TYPES.map((type) => {
      const channel = integration
        ? overview.channels.find(
            (item) =>
              item.integration_id === integration.id &&
              item.channel_type === type,
          )
        : undefined;
      return [
        type,
        {
          id: channel?.id,
          externalAccountId: channel?.external_account_id || "",
          displayName: channel?.display_name || "",
          accessToken: "",
          tokenExpiresAt: dateTimeLocalValue(channel?.token_expires_at),
          leadsEnabled: Boolean(channel?.leads_enabled),
          credentialMode: channel?.credential_mode || "INSTAGRAM_LOGIN",
        },
      ];
    }),
  ) as Record<ChannelType, ChannelDraft>;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(
    /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z",
  );
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
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${theme}`}
    >
      {type}
    </span>
  );
}

const CHANNEL_SURFACES = {
  WHATSAPP: {
    conversation: "bg-emerald-50/45",
    selected: "bg-emerald-50",
    outbound: "bg-emerald-600 text-white",
    outboundMeta: "text-emerald-100",
    focus: "focus:border-emerald-500 focus:ring-emerald-100",
    action: "bg-emerald-600 hover:bg-emerald-700",
    webhook: "border-l-emerald-400 bg-emerald-50/40",
  },
  INSTAGRAM: {
    conversation: "bg-fuchsia-50/40",
    selected: "bg-fuchsia-50",
    outbound: "bg-fuchsia-600 text-white",
    outboundMeta: "text-fuchsia-100",
    focus: "focus:border-fuchsia-500 focus:ring-fuchsia-100",
    action: "bg-fuchsia-600 hover:bg-fuchsia-700",
    webhook: "border-l-fuchsia-400 bg-fuchsia-50/40",
  },
  MESSENGER: {
    conversation: "bg-blue-50/45",
    selected: "bg-blue-50",
    outbound: "bg-blue-600 text-white",
    outboundMeta: "text-blue-100",
    focus: "focus:border-blue-500 focus:ring-blue-100",
    action: "bg-blue-600 hover:bg-blue-700",
    webhook: "border-l-blue-400 bg-blue-50/40",
  },
} as const;

function channelSurface(type?: string | null) {
  return (
    CHANNEL_SURFACES[
      String(type || "MESSENGER").toUpperCase() as keyof typeof CHANNEL_SURFACES
    ] || CHANNEL_SURFACES.MESSENGER
  );
}

function webhookSurface(objectType?: string | null) {
  if (objectType === "instagram") return CHANNEL_SURFACES.INSTAGRAM.webhook;
  if (objectType === "whatsapp_business_account")
    return CHANNEL_SURFACES.WHATSAPP.webhook;
  return CHANNEL_SURFACES.MESSENGER.webhook;
}

export default function MetaBusinessPage() {
  const user = getAuthUser();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const [tab, setTab] = useState<Tab>("INBOX");
  const integrationSelection = useRef("");
  const [integrationId, setIntegrationId] = useState("");
  const [conversationView, setConversationView] =
    useState<ConversationView>("ACTIVE");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("ALL");
  const [conversationSearch, setConversationSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [conversationOffset, setConversationOffset] = useState(0);
  const [moreConversations, setMoreConversations] = useState(false);
  const [moreMessages, setMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncWarning, setSyncWarning] = useState(false);
  const [newWhatsApp, setNewWhatsApp] = useState<{
    phone: string;
    name: string;
  } | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const liveRefreshInFlight = useRef(false);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledConversationRef = useRef<string | null>(null);
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const [verifyingChannelId, setVerifyingChannelId] = useState<string | null>(
    null,
  );
  const [savingChannelType, setSavingChannelType] =
    useState<ChannelType | null>(null);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "Meta Business",
    businessAccountId: "",
    appId: "",
    graphApiVersion: "",
  });
  const [channelDrafts, setChannelDrafts] = useState<
    Record<ChannelType, ChannelDraft>
  >(() => channelDraftsFromOverview(EMPTY_OVERVIEW));

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) || null,
    [conversations, selectedId],
  );
  const savedIntegration =
    (integrationId
      ? overview.integrations.find((item) => item.id === integrationId)
      : overview.integrations[0]) || null;
  const connected = overview.integrations.some(
    (item) => item.status === "CONNECTED",
  );
  const integrationChannels = savedIntegration
    ? overview.channels.filter(
        (item) => item.integration_id === savedIntegration.id,
      )
    : [];
  const activeChannelCount = integrationChannels.filter(
    (item) => item.status === "ACTIVE",
  ).length;
  const selectedSurface = channelSurface(selected?.channel_type);
  selectedIdRef.current = selectedId;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setConversationSearch(searchInput);
      setConversationOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const conversationUrl = `/meta/conversations?status=${conversationView}&channel=${channelFilter}&offset=${conversationOffset}&search=${encodeURIComponent(conversationSearch)}`;
  const conversationUrlRef = useRef(conversationUrl);
  conversationUrlRef.current = conversationUrl;

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewResponse, conversationsResponse] = await Promise.all([
        api.get<Overview>("/meta/overview"),
        api.get<{ conversations: Conversation[]; hasMore: boolean }>(
          conversationUrl,
        ),
      ]);
      if (conversationUrlRef.current !== conversationUrl) return;
      setOverview(overviewResponse.data);
      setForm(
        formFromOverview(overviewResponse.data, integrationSelection.current),
      );
      setChannelDrafts(
        channelDraftsFromOverview(
          overviewResponse.data,
          integrationSelection.current,
        ),
      );
      setConversations(conversationsResponse.data.conversations || []);
      setMoreConversations(conversationsResponse.data.hasMore);
      setLastSync(new Date());
      setSyncWarning(false);
      setSelectedId((current) =>
        current &&
        conversationsResponse.data.conversations.some(
          (item) => item.id === current,
        )
          ? current
          : conversationsResponse.data.conversations[0]?.id || null,
      );
    } catch (requestError: unknown) {
      setError(
        requestErrorMessage(
          requestError,
          "Impossibile caricare Meta Business.",
        ),
      );
    } finally {
      if (conversationUrlRef.current === conversationUrl) setLoading(false);
    }
  }, [conversationUrl]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId || tab !== "INBOX") {
      setMessages([]);
      return;
    }
    setMessages([]);
    setMoreMessages(false);
    api
      .post<{ messages: Message[]; hasMore: boolean }>(
        `/meta/conversations/${selectedId}/read`,
        { limit: 50 },
      )
      .then((response) => {
        if (cancelled) return;
        setMoreMessages(response.data.hasMore);
        setMessages(response.data.messages || []);
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === selectedId
              ? { ...conversation, unread_count: 0 }
              : conversation,
          ),
        );
        requestMetaUnreadRefresh();
      })
      .catch(
        (requestError) =>
          !cancelled &&
          setError(
            requestError?.response?.data?.error ||
              "Impossibile caricare i messaggi.",
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [selectedId, tab]);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport || !selectedId) return;
    const conversationChanged =
      lastScrolledConversationRef.current !== selectedId;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (conversationChanged || distanceFromBottom < 140) {
      window.requestAnimationFrame(() => {
        viewport.scrollTop = viewport.scrollHeight;
      });
    }
    lastScrolledConversationRef.current = selectedId;
  }, [messages, selectedId]);

  const refreshLiveData = useCallback(async () => {
    if (document.visibilityState !== "visible" || liveRefreshInFlight.current)
      return;
    liveRefreshInFlight.current = true;
    try {
      const viewport = messageViewportRef.current;
      const selectedConversationVisible =
        tab === "INBOX" && Boolean(selectedId);
      const shouldMarkRead =
        selectedConversationVisible &&
        viewport !== null &&
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
          140;
      const conversationAtRequest = selectedId;
      const [overviewResponse, conversationsResponse, messagesResponse] =
        await Promise.all([
          api.get<Overview>("/meta/overview"),
          api.get<{ conversations: Conversation[]; hasMore: boolean }>(
            conversationUrl,
          ),
          selectedConversationVisible
            ? shouldMarkRead
              ? api.post<{ messages: Message[] }>(
                  `/meta/conversations/${selectedId}/read`,
                  { limit: 200 },
                )
              : api.get<{ messages: Message[] }>(
                  `/meta/conversations/${selectedId}/messages`,
                )
            : Promise.resolve(null),
        ]);
      const nextConversations = conversationsResponse.data.conversations || [];
      if (conversationUrlRef.current !== conversationUrl) return;
      setOverview(overviewResponse.data);
      setConversations(nextConversations);
      setMoreConversations(conversationsResponse.data.hasMore);
      if (messagesResponse && selectedIdRef.current === conversationAtRequest)
        setMessages((current) => {
          const merged = new Map(current.map((m) => [m.id, m]));
          for (const message of messagesResponse.data.messages || [])
            merged.set(message.id, message);
          return [...merged.values()].sort(
            (a, b) =>
              a.occurred_at.localeCompare(b.occurred_at) ||
              (a.created_at || "").localeCompare(b.created_at || "") ||
              a.id.localeCompare(b.id),
          );
        });
      if (messagesResponse && shouldMarkRead) requestMetaUnreadRefresh();
      setLastSync(new Date());
      setSyncWarning(false);
      setSelectedId((current) =>
        current && nextConversations.some((item) => item.id === current)
          ? current
          : nextConversations[0]?.id || null,
      );
    } catch {
      setSyncWarning(true);
    } finally {
      liveRefreshInFlight.current = false;
    }
  }, [conversationUrl, selectedId, tab]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        await refreshLiveData();
        if (!cancelled) schedule();
      }, 4000);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshLiveData();
    };
    schedule();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [refreshLiveData]);

  async function loadOlderMessages() {
    if (!selectedId || !messages.length || loadingOlder) return;
    const id = selectedId;
    const viewport = messageViewportRef.current;
    const height = viewport?.scrollHeight || 0;
    setLoadingOlder(true);
    try {
      const { data } = await api.get<{ messages: Message[]; hasMore: boolean }>(
        `/meta/conversations/${id}/messages`,
        { params: { limit: 50, before: messages[0].id } },
      );
      if (selectedIdRef.current !== id) return;
      setMessages((current) => [
        ...data.messages.filter(
          (item) => !current.some((m) => m.id === item.id),
        ),
        ...current,
      ]);
      setMoreMessages(data.hasMore);
      requestAnimationFrame(() => {
        if (viewport) viewport.scrollTop += viewport.scrollHeight - height;
      });
    } catch (e) {
      setError(requestErrorMessage(e, "Impossibile caricare lo storico."));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function refreshInstagramToken(channel: MetaChannel) {
    setVerifyingChannelId(channel.id);
    setError(null);
    try {
      await api.post(`/meta/channels/${channel.id}/refresh-token`);
      setNotice("Token Instagram rinnovato e salvato.");
      await loadAll();
    } catch (e) {
      setError(
        requestErrorMessage(
          e,
          "Rinnovo non riuscito. Controlla la scadenza e usa un token di lunga durata.",
        ),
      );
    } finally {
      setVerifyingChannelId(null);
    }
  }

  async function eraseSelectedContact() {
    if (
      !selected ||
      window.prompt(
        "Cancella definitivamente dati, lead, messaggi e allegati di questo contatto su questo canale dal database attivo. Non cancella i dati in Meta, nei backup o negli altri canali. Scrivi ELIMINA per confermare.",
      ) !== "ELIMINA"
    )
      return;
    try {
      await api.post(`/meta/contacts/${selected.contact_id}/erase`, {
        confirmation: "ELIMINA",
      });
      setSelectedId(null);
      setNotice("Dati del contatto cancellati dal database attivo.");
      await loadAll();
    } catch (e) {
      setError(requestErrorMessage(e, "Cancellazione non riuscita."));
    }
  }

  async function processPendingQueue() {
    setProcessingQueue(true);
    setError(null);
    setNotice(null);
    try {
      const initialCount = Math.min(
        20,
        Number(overview.counts.queued_messages || 1),
      );
      let sent = 0;
      let lastError: string | null = null;
      let lastDetail: string | null = null;
      for (let index = 0; index < initialCount; index += 1) {
        const response = await api.post<{
          processed: boolean;
          sent?: boolean;
          error?: string;
          detail?: string;
        }>("/meta/outbox/process", { force: true });
        if (!response.data.processed) {
          lastDetail = response.data.detail || null;
          break;
        }
        if (response.data.sent) sent += 1;
        if (response.data.error) lastError = response.data.error;
      }
      const [overviewResponse, messagesResponse] = await Promise.all([
        api.get<Overview>("/meta/overview"),
        selectedId
          ? api.get<{ messages: Message[] }>(
              `/meta/conversations/${selectedId}/messages`,
            )
          : Promise.resolve(null),
      ]);
      setOverview(overviewResponse.data);
      if (messagesResponse) setMessages(messagesResponse.data.messages || []);
      if (lastError) setError(`Coda elaborata parzialmente: ${lastError}`);
      else if (sent > 0) setNotice(`Messaggi inviati dalla coda: ${sent}.`);
      else if (lastDetail) setError(`Coda non elaborata: ${lastDetail}`);
      else if (!Number(overviewResponse.data.counts.queued_messages || 0)) {
        setNotice("La coda è già stata elaborata dal worker automatico.");
      } else {
        setError(
          "Nessun messaggio inviato: controlla lo stato della connessione e del canale.",
        );
      }
    } catch (requestError: unknown) {
      setError(
        requestErrorMessage(
          requestError,
          "Elaborazione della coda non riuscita.",
        ),
      );
    } finally {
      setProcessingQueue(false);
    }
  }

  async function saveIntegration(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const payload = {
        id: savedIntegration?.id,
        name: form.name,
        businessAccountId: form.businessAccountId || null,
        appId: form.appId || null,
        graphApiVersion: form.graphApiVersion || null,
        channels: [],
      };
      const response = await api.post<Overview>("/meta/integrations", payload);
      if (integrationSelection.current === "NEW") {
        const created = response.data.integrations.find(
          (item) =>
            !overview.integrations.some((previous) => previous.id === item.id),
        );
        integrationSelection.current = created?.id || "";
        setIntegrationId(integrationSelection.current);
      }
      setOverview(response.data);
      setForm(formFromOverview(response.data, integrationSelection.current));
      setChannelDrafts(
        channelDraftsFromOverview(response.data, integrationSelection.current),
      );
      setNotice(
        "Configurazione generale salvata. Ora collega e verifica i tre canali.",
      );
    } catch (requestError: unknown) {
      setError(
        requestErrorMessage(requestError, "Configurazione non salvata."),
      );
    }
  }

  async function replayWebhooks() {
    setReplaying(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.post<{
        replay: {
          examined: number;
          processed: number;
          stillUnmatched: number;
          failed: number;
        };
        overview: Overview;
      }>("/meta/webhooks/replay", { limit: 100 });
      setOverview(response.data.overview);
      setForm(
        formFromOverview(response.data.overview, integrationSelection.current),
      );
      setChannelDrafts(
        channelDraftsFromOverview(
          response.data.overview,
          integrationSelection.current,
        ),
      );
      const result = response.data.replay;
      setNotice(
        `Webhook controllati: ${result.examined}. Recuperati: ${result.processed}. ` +
          `Non abbinati: ${result.stillUnmatched}. Errori: ${result.failed}.`,
      );
      const conversationsResponse = await api.get<{
        conversations: Conversation[];
      }>(
        `/meta/conversations?status=${conversationView}&channel=${channelFilter}`,
      );
      setConversations(conversationsResponse.data.conversations || []);
      setSelectedId((current) =>
        current &&
        conversationsResponse.data.conversations.some(
          (item) => item.id === current,
        )
          ? current
          : conversationsResponse.data.conversations[0]?.id || null,
      );
    } catch (requestError: unknown) {
      setError(
        requestErrorMessage(
          requestError,
          "Riprocessamento webhook non riuscito.",
        ),
      );
    } finally {
      setReplaying(false);
    }
  }

  async function saveChannel(channelType: ChannelType) {
    if (!savedIntegration) {
      setError("Salva prima la configurazione generale Meta.");
      return;
    }
    const draft = channelDrafts[channelType];
    if (!draft.externalAccountId.trim()) {
      setError(`${CHANNEL_DETAILS[channelType].idLabel} obbligatorio.`);
      return;
    }
    setSavingChannelType(channelType);
    setError(null);
    setNotice(null);
    try {
      const response = await api.post<{
        channelId: string;
        overview: Overview;
      }>(`/meta/integrations/${savedIntegration.id}/channels`, {
        id: draft.id,
        channelType,
        externalAccountId: draft.externalAccountId.trim(),
        displayName: draft.displayName.trim() || null,
        accessToken: draft.accessToken || null,
        tokenExpiresAt: draft.tokenExpiresAt || null,
        leadsEnabled: draft.leadsEnabled || false,
        ...(channelType === "INSTAGRAM"
          ? { credentialMode: draft.credentialMode }
          : {}),
      });
      setOverview(response.data.overview);
      setForm(
        formFromOverview(response.data.overview, integrationSelection.current),
      );
      setChannelDrafts(
        channelDraftsFromOverview(
          response.data.overview,
          integrationSelection.current,
        ),
      );
      setNotice(
        `${CHANNEL_DETAILS[channelType].title} salvato. Ora esegui la verifica.`,
      );
    } catch (requestError: unknown) {
      setError(
        requestErrorMessage(
          requestError,
          `Salvataggio ${channelType} non riuscito.`,
        ),
      );
    } finally {
      setSavingChannelType(null);
    }
  }

  async function verifyMetaChannel(channel: MetaChannel) {
    setVerifyingChannelId(channel.id);
    setError(null);
    setNotice(null);
    try {
      const response = await api.post<{
        fullyConnected: boolean;
        channelType: ChannelType;
        overview: Overview;
      }>(`/meta/channels/${channel.id}/verify`);
      setOverview(response.data.overview);
      setForm(
        formFromOverview(response.data.overview, integrationSelection.current),
      );
      setChannelDrafts(
        channelDraftsFromOverview(
          response.data.overview,
          integrationSelection.current,
        ),
      );
      setNotice(
        response.data.channelType === "INSTAGRAM"
          ? "Instagram: account e iscrizione webhook verificati. Per l'uso reale conferma la pubblicazione in Meta e prova ricezione e risposta dall'inbox."
          : `${CHANNEL_DETAILS[response.data.channelType].title} verificato e operativo.`,
      );
    } catch (requestError: unknown) {
      setError(
        requestErrorMessage(
          requestError,
          `Verifica ${channel.channel_type} non riuscita.`,
        ),
      );
      const overviewResponse = await api
        .get<Overview>("/meta/overview")
        .catch(() => null);
      if (overviewResponse) {
        setOverview(overviewResponse.data);
        setChannelDrafts(
          channelDraftsFromOverview(
            overviewResponse.data,
            integrationSelection.current,
          ),
        );
      }
    } finally {
      setVerifyingChannelId(null);
    }
  }

  async function toggleChannel(channel: MetaChannel) {
    const status = channel.status === "PAUSED" ? "PENDING" : "PAUSED";
    setError(null);
    try {
      const response = await api.patch<{ overview: Overview }>(
        `/meta/channels/${channel.id}/status`,
        {
          status,
        },
      );
      setOverview(response.data.overview);
      setChannelDrafts(
        channelDraftsFromOverview(
          response.data.overview,
          integrationSelection.current,
        ),
      );
      setNotice(
        status === "PAUSED"
          ? "Canale sospeso."
          : "Canale riattivato: esegui la verifica.",
      );
    } catch (requestError: unknown) {
      setError(
        requestErrorMessage(requestError, "Stato del canale non aggiornato."),
      );
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
          conversation.id === selected.id
            ? { ...conversation, status }
            : conversation,
        ),
      );
    } catch (requestError: unknown) {
      setError(
        requestErrorMessage(requestError, "Conversazione non aggiornata."),
      );
    }
  }

  async function toggleConversationArchive() {
    if (!selected) return;
    const restoring = selected.status === "ARCHIVED";
    setError(null);
    try {
      await api.patch(`/meta/conversations/${selected.id}`, {
        status: restoring ? "OPEN" : "ARCHIVED",
      });
      setConversations((current) =>
        current.filter((item) => item.id !== selected.id),
      );
      setSelectedId(null);
      setMessages([]);
      setNotice(
        restoring
          ? "Conversazione ripristinata nell’inbox."
          : "Conversazione archiviata.",
      );
    } catch (requestError: unknown) {
      setError(
        requestErrorMessage(
          requestError,
          "Archivio conversazione non aggiornato.",
        ),
      );
    }
  }

  async function deleteMessage(message: Message) {
    if (!selected || message.deleted_at) return;
    const confirmed = window.confirm(
      "Eliminare il contenuto di questo messaggio dalla piattaforma? L’operazione viene registrata nell’audit e non elimina eventuali copie già consegnate su WhatsApp.",
    );
    if (!confirmed) return;
    setError(null);
    try {
      await api.delete(
        `/meta/conversations/${selected.id}/messages/${message.id}`,
      );
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? { ...item, body_text: null, deleted_at: new Date().toISOString() }
            : item,
        ),
      );
      setNotice("Contenuto del messaggio eliminato dalla piattaforma.");
      const overviewResponse = await api.get<Overview>("/meta/overview");
      setOverview(overviewResponse.data);
    } catch (requestError: unknown) {
      setError(
        requestErrorMessage(
          requestError,
          "Eliminazione del messaggio non riuscita.",
        ),
      );
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
            Lead e messaggi WhatsApp, Messenger e Instagram in un unico flusso
            operativo.
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
              <div className="font-semibold text-amber-950">
                In attesa dell’accesso Meta Business
              </div>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                L’area è pronta. Quando l’invito sarà accettato, serviranno App
                ID, access token, versione Graph API e gli identificativi della
                Pagina, del numero WhatsApp o dell’account Instagram. Fino ad
                allora nessun messaggio può partire.
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

      {!!Number(overview.counts.queued_messages || 0) && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <div className="font-semibold text-amber-950">
                {overview.counts.queued_messages} messaggi in attesa di invio
              </div>
              <p className="mt-1 text-xs text-amber-800">
                Worker automatico{" "}
                {overview.outboxWorkerEnabled ? "attivo" : "disattivato"}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void processPendingQueue()}
            disabled={processingQueue}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-700 px-4 py-2 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${processingQueue ? "animate-spin" : ""}`}
            />
            {processingQueue ? "Invio in corso…" : "Processa ora"}
          </button>
        </div>
      )}

      <div
        className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"
        role="status"
      >
        <span>
          {syncWarning
            ? "Connessione in attesa: il server potrebbe essere in avvio. Le bozze restano salvate in questa scheda."
            : `Ultimo aggiornamento: ${lastSync?.toLocaleTimeString("it-IT") || "in corso…"}`}
        </span>
        {(!!overview.counts.failed_messages ||
          !!overview.counts.lead_errors) && (
          <button
            className="font-semibold text-amber-800 underline"
            onClick={() => setTab("ACTIVITY")}
          >
            {overview.counts.failed_messages || 0} invii da gestire ·{" "}
            {overview.counts.lead_errors || 0} lead da recuperare
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Lead attivi", overview.counts.active_leads || 0, Users],
          [
            "Conversazioni aperte",
            overview.counts.open_conversations || 0,
            MessageCircle,
          ],
          ["Messaggi non letti", overview.counts.unread_messages || 0, Inbox],
          ["Messaggi in coda", overview.counts.queued_messages || 0, Send],
        ].map(([label, value, Icon]) => (
          <div
            key={String(label)}
            className={`rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${tab === "INBOX" ? "flex items-center justify-between gap-2" : ""}`}
          >
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-500">
                {String(label)}
              </div>
              {/* @ts-expect-error tuple component */}
              <Icon
                className={`h-4 w-4 text-slate-400 ${tab === "INBOX" ? "hidden" : ""}`}
              />
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {String(value)}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
        {[
          ["INBOX", "Conversazioni", MessageCircle],
          ["LEADS", "Lead", Users],
          ["ACTIVITY", "Attività", Send],
          ["SETTINGS", "Configurazione", Settings2],
        ].map(([value, label, Icon]) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => setTab(value as Tab)}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === value
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Icon className="h-4 w-4" />
            {String(label)}
          </button>
        ))}
      </div>

      {tab === "INBOX" && (
        <div className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100dvh-19rem)] lg:min-h-[440px] lg:max-h-[900px] lg:grid-cols-[320px_1fr]">
          <div className="flex min-h-0 flex-col border-b border-slate-200 lg:border-b-0 lg:border-r">
            <div className="space-y-2 border-b border-slate-200 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-slate-900">
                  {conversationView === "ACTIVE"
                    ? "Inbox unificata"
                    : "Archivio"}
                </div>
                <div className="flex rounded-lg bg-slate-100 p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setConversationView("ACTIVE");
                      setConversationOffset(0);
                    }}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-bold ${
                      conversationView === "ACTIVE"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500"
                    }`}
                  >
                    Inbox
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConversationView("ARCHIVED");
                      setConversationOffset(0);
                    }}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-bold ${
                      conversationView === "ARCHIVED"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500"
                    }`}
                  >
                    Archivio
                  </button>
                </div>
              </div>
              <select
                value={channelFilter}
                aria-label="Filtra conversazioni per canale"
                onChange={(event) => {
                  setChannelFilter(event.target.value as ChannelFilter);
                  setConversationOffset(0);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
              >
                <option value="ALL">Tutti i canali</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="MESSENGER">Messenger</option>
                <option value="INSTAGRAM">Instagram</option>
              </select>
              <input
                aria-label="Cerca conversazioni"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cerca nome, telefono o email…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
              <button
                onClick={() => setNewWhatsApp({ phone: "", name: "" })}
                className="text-xs font-semibold text-emerald-700"
              >
                + Nuovo contatto WhatsApp
              </button>
            </div>
            <div className="max-h-[300px] min-h-0 overflow-y-auto overscroll-contain lg:max-h-none lg:flex-1">
              {!conversations.length && (
                <div className="p-8 text-center text-sm text-slate-500">
                  {conversationView === "ARCHIVED"
                    ? "Nessuna conversazione archiviata."
                    : "Le conversazioni compariranno dopo il collegamento e il primo webhook."}
                </div>
              )}
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={`w-full border-b border-slate-100 px-4 py-4 text-left hover:bg-slate-50 ${
                    selectedId === conversation.id
                      ? channelSurface(conversation.channel_type).selected
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-semibold text-slate-900">
                      {conversation.display_name ||
                        conversation.external_contact_id}
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
                    {conversation.last_message_deleted_at
                      ? "Messaggio eliminato"
                      : conversation.last_message_text || "Nessuna anteprima"}
                  </p>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
              <button
                disabled={!conversationOffset}
                onClick={() =>
                  setConversationOffset((n) => Math.max(0, n - 100))
                }
                className="disabled:opacity-30"
              >
                Precedenti
              </button>
              <span>Pagina {conversationOffset / 100 + 1}</span>
              <button
                disabled={!moreConversations}
                onClick={() => setConversationOffset((n) => n + 100)}
                className="disabled:opacity-30"
              >
                Successive
              </button>
            </div>
          </div>

          <div className="flex h-[600px] min-h-0 flex-col lg:h-full">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
                Seleziona una conversazione per visualizzare i messaggi.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900">
                      {selected.display_name || selected.external_contact_id}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <ChannelBadge type={selected.channel_type} />
                      <span className="text-xs text-slate-500">
                        risposta entro{" "}
                        {formatDate(selected.reply_window_expires_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {selected.status !== "ARCHIVED" && (
                      <button
                        type="button"
                        onClick={() => void toggleConversationStatus()}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        {selected.status === "CLOSED" ? "Riapri" : "Chiudi"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void toggleConversationArchive()}
                      title={
                        selected.status === "ARCHIVED"
                          ? "Ripristina conversazione"
                          : "Archivia conversazione"
                      }
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      {selected.status === "ARCHIVED" ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                      {selected.status === "ARCHIVED"
                        ? "Ripristina"
                        : "Archivia"}
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => void eraseSelectedContact()}
                        className="rounded-lg px-2 py-1.5 text-xs text-rose-700"
                      >
                        Cancella dati contatto
                      </button>
                    )}
                  </div>
                </div>
                <div
                  ref={messageViewportRef}
                  className={`min-h-32 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 ${selectedSurface.conversation}`}
                >
                  {moreMessages && (
                    <div className="text-center">
                      <button
                        disabled={loadingOlder}
                        onClick={() => void loadOlderMessages()}
                        className="rounded-lg border bg-white px-3 py-2 text-xs text-slate-700"
                      >
                        {loadingOlder
                          ? "Caricamento…"
                          : "Carica messaggi precedenti"}
                      </button>
                    </div>
                  )}
                  {!messages.length && (
                    <p className="py-8 text-center text-sm text-slate-500">
                      Nessun messaggio da visualizzare.
                    </p>
                  )}
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[90%] space-y-2 rounded-2xl px-4 py-3 sm:max-w-[80%] ${message.direction === "OUTBOUND" ? selectedSurface.outbound : "border border-slate-200 bg-white text-slate-800"}`}
                      >
                        <p className="whitespace-pre-wrap break-words text-sm">
                          {message.deleted_at
                            ? "Messaggio eliminato dalla piattaforma"
                            : message.body_text || "Contenuto non testuale"}
                        </p>
                        {!message.deleted_at &&
                          message.attachments?.map((attachment) => (
                            <MetaAttachment
                              key={attachment.index}
                              messageId={message.id}
                              attachment={attachment}
                            />
                          ))}
                        <div className="flex items-center justify-between gap-3 text-[10px] opacity-80">
                          <span>
                            {formatDate(message.occurred_at)} ·{" "}
                            {message.delivery_state === "UNCERTAIN"
                              ? "Esito da verificare"
                              : (
                                  {
                                    RECEIVED: "Ricevuto",
                                    SENT: "Inviato",
                                    DELIVERED: "Consegnato",
                                    READ: "Letto",
                                    QUEUED: "In coda",
                                    FAILED: "Invio non riuscito",
                                    DRAFT: "Da approvare",
                                  } as Record<string, string>
                                )[message.status] || message.status}
                          </span>
                          {!message.deleted_at && (
                            <button
                              type="button"
                              aria-label="Elimina messaggio dalla piattaforma"
                              onClick={() => void deleteMessage(message)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="max-h-[45vh] shrink-0 overflow-y-auto">
                  <MetaComposer
                    key={selected.id}
                    conversation={selected}
                    onSent={() => void refreshLiveData()}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "LEADS" && (
        <MetaLeads
          onWhatsApp={(phone, name) => setNewWhatsApp({ phone, name })}
        />
      )}
      {tab === "ACTIVITY" && <MetaActivity />}
      {newWhatsApp && (
        <MetaNewWhatsApp
          initial={newWhatsApp}
          channels={overview.channels.filter(
            (ch) => ch.channel_type === "WHATSAPP" && ch.status === "ACTIVE",
          )}
          onClose={() => setNewWhatsApp(null)}
          onCreated={async (id) => {
            const { data } = await api.get<{ conversations: Conversation[] }>(
              "/meta/conversations",
              { params: { id, status: "ALL" } },
            );
            const opened = data.conversations[0];
            if (!opened)
              throw new Error("Conversation not found after creation");
            setNewWhatsApp(null);
            setSearchInput(opened.external_contact_id);
            setConversationSearch(opened.external_contact_id);
            setConversationOffset(0);
            setChannelFilter("WHATSAPP");
            setConversationView(
              opened.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
            );
            setTab("INBOX");
            setConversations(data.conversations);
            setSelectedId(id);
          }}
        />
      )}

      {tab === "SETTINGS" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <label className="flex flex-1 items-center gap-3 text-sm font-semibold">
              Configurazione
              <select
                aria-label="Integrazione da configurare"
                className="min-w-0 flex-1 rounded-lg border p-2"
                value={integrationId || savedIntegration?.id || "NEW"}
                onChange={(event) => {
                  const id = event.target.value;
                  integrationSelection.current = id;
                  setIntegrationId(id);
                  setForm(formFromOverview(overview, id));
                  setChannelDrafts(channelDraftsFromOverview(overview, id));
                }}
              >
                {overview.integrations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.status}
                  </option>
                ))}
                {isAdmin && <option value="NEW">+ Nuova integrazione</option>}
              </select>
            </label>
            <p className="w-full text-xs text-slate-500">
              Per il numero WhatsApp ufficiale crea una nuova integrazione e
              configura soltanto il nuovo numero; poi sospendi quello di prova.
              Messenger e Instagram già collegati restano nella loro
              integrazione. Lo storico rimane nell’inbox.
            </p>
          </div>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <div
                  className={`rounded-xl p-2.5 ${connected ? "bg-emerald-100" : "bg-amber-100"}`}
                >
                  {connected ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                  ) : (
                    <CircleAlert className="h-5 w-5 text-amber-700" />
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-slate-900">
                      Connessione Meta
                    </h2>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                        connected
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {savedIntegration?.status || "NON CONFIGURATA"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Un’unica inbox per WhatsApp, Messenger e Instagram, con
                    credenziali separate e cifrate.
                  </p>
                </div>
              </div>
              <div className="rounded-xl bg-slate-900 px-4 py-3 text-right text-white">
                <div className="text-2xl font-black">
                  {activeChannelCount}/{integrationChannels.length || 0}
                </div>
                <div className="text-[10px] font-bold text-slate-300">
                  canali verificati
                </div>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                [
                  "Firma webhook",
                  overview.webhookConfigured,
                  "App Secret e verify token",
                ],
                [
                  "Credenziali protette",
                  overview.encryptionConfigured,
                  "Token cifrato AES-256-GCM",
                ],
                [
                  "Canali verificati",
                  activeChannelCount > 0 &&
                    activeChannelCount === integrationChannels.length,
                  `${activeChannelCount} di ${integrationChannels.length} verificati`,
                ],
                [
                  "Invio automatico",
                  overview.outboxWorkerEnabled,
                  "Worker per invii e tentativi",
                ],
              ].map(([label, ready, detail]) => (
                <div
                  key={String(label)}
                  className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-3"
                >
                  {ready ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <CircleAlert className="h-4 w-4 shrink-0 text-amber-600" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800">
                      {String(label)}
                    </div>
                    <div className="truncate text-[10px] text-slate-500">
                      {String(detail)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {savedIntegration?.last_error && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {savedIntegration.last_error}
              </div>
            )}
          </section>

          <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
            <form
              onSubmit={saveIntegration}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">
                  1
                </span>
                <div>
                  <h2 className="font-bold text-slate-900">Configurazione</h2>
                  <p className="text-xs text-slate-500">
                    Modifica i dati di collegamento e salva.
                  </p>
                </div>
              </div>
              <fieldset
                disabled={!isAdmin}
                className="mt-5 space-y-5 disabled:opacity-60"
              >
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wide text-slate-400">
                    Account Meta
                  </h3>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    {[
                      ["Nome connessione", "name", "Meta Business"],
                      [
                        "WABA ID",
                        "businessAccountId",
                        "WhatsApp Business Account ID",
                      ],
                      ["Meta App ID", "appId", "App ID"],
                      ["Versione Graph API", "graphApiVersion", "v26.0"],
                    ].map(([label, key, placeholder]) => (
                      <label key={key} className="block">
                        <span className="text-xs font-semibold text-slate-600">
                          {label}
                        </span>
                        <input
                          value={form[key as keyof typeof form]}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                          placeholder={placeholder}
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">
                  Il WABA ID serve a WhatsApp. Messenger e Instagram vengono
                  collegati sotto con il proprio account ID e il proprio token,
                  senza condividere credenziali tra canali.
                </div>
              </fieldset>
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
                <p className="font-bold text-slate-800">
                  Pubblicazione Meta · Informativa sulla privacy
                </p>
                <p className="mt-1">
                  Pagina pubblica, senza accesso ai messaggi. Verifica il testo
                  prima di inserirne l’URL in Meta.
                </p>
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block break-all font-semibold text-blue-700 underline underline-offset-2"
                >
                  {new URL("/privacy", window.location.origin).href}
                </a>
                <a
                  href="/privacy#cancellazione"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-blue-700 underline underline-offset-2"
                >
                  Istruzioni per la cancellazione dei dati
                </a>
              </div>
              <button
                type="submit"
                disabled={!isAdmin}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" />
                Salva configurazione generale
              </button>
            </form>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">
                  2
                </span>
                <div>
                  <h2 className="font-bold text-slate-900">
                    Account applicazione
                  </h2>
                  <p className="text-xs text-slate-500">
                    Configurazione comune ai tre canali.
                  </p>
                </div>
              </div>
              {!savedIntegration ? (
                <div className="mt-5 rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                  Nessuna configurazione salvata.
                </div>
              ) : (
                <dl className="mt-5 divide-y divide-slate-100">
                  {[
                    ["Connessione", savedIntegration.name],
                    ["WABA ID", savedIntegration.business_account_id || "—"],
                    ["Meta App ID", savedIntegration.app_id || "—"],
                    ["Graph API", savedIntegration.graph_api_version || "—"],
                    ["Canali configurati", String(integrationChannels.length)],
                    [
                      "Canali verificati",
                      `${activeChannelCount} / ${integrationChannels.length}`,
                    ],
                    [
                      "Ultimo salvataggio",
                      formatDate(savedIntegration.updated_at),
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="grid grid-cols-[140px_1fr] gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <dt className="text-xs font-semibold text-slate-500">
                        {label}
                      </dt>
                      <dd className="break-all text-right text-sm font-bold text-slate-800">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-black text-white">
                3
              </span>
              <div>
                <h2 className="font-bold text-slate-900">
                  Canali di produzione
                </h2>
                <p className="text-xs text-slate-500">
                  Ogni canale conserva il proprio token cifrato. Salva, verifica
                  e poi prova un messaggio reale.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 xl:grid-cols-3">
              {CHANNEL_TYPES.map((channelType) => {
                const details = CHANNEL_DETAILS[channelType];
                const draft = channelDrafts[channelType];
                const channel = integrationChannels.find(
                  (item) => item.channel_type === channelType,
                );
                const verificationBusy = verifyingChannelId === channel?.id;
                const saveBusy = savingChannelType === channelType;
                const operational = channel?.status === "ACTIVE";
                const instagramUnsaved =
                  channelType === "INSTAGRAM" &&
                  (Boolean(draft.accessToken) ||
                    draft.credentialMode !== channel?.credential_mode ||
                    draft.externalAccountId.trim() !==
                      channel?.external_account_id);
                return (
                  <div
                    key={channelType}
                    className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <ChannelBadge type={channelType} />
                        <h3 className="mt-2 font-bold text-slate-900">
                          {details.title}
                        </h3>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[9px] font-black ${
                          operational
                            ? "bg-emerald-100 text-emerald-800"
                            : channel?.status === "ERROR"
                              ? "bg-rose-100 text-rose-800"
                              : channel?.status === "PAUSED"
                                ? "bg-slate-200 text-slate-700"
                                : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {channel?.status || "NON CONFIGURATO"}
                      </span>
                    </div>
                    <fieldset
                      disabled={!isAdmin || !savedIntegration}
                      className="mt-4 space-y-3 disabled:opacity-60"
                    >
                      {channelType === "INSTAGRAM" && (
                        <label className="block">
                          <span className="text-xs font-semibold text-slate-600">
                            Tipo di collegamento
                          </span>
                          <select
                            aria-label="Tipo di collegamento"
                            value={draft.credentialMode}
                            onChange={(event) =>
                              setChannelDrafts((current) => ({
                                ...current,
                                INSTAGRAM: {
                                  ...current.INSTAGRAM,
                                  credentialMode: event.target
                                    .value as ChannelDraft["credentialMode"],
                                },
                              }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                          >
                            <option value="INSTAGRAM_LOGIN">
                              Instagram Login — token da API Instagram
                            </option>
                            <option value="FACEBOOK_LOGIN">
                              Facebook Login — token della Pagina
                            </option>
                          </select>
                          <span className="mt-1 block text-[11px] text-slate-500">
                            Salva il tipo scelto prima di verificare. I due
                            token non sono intercambiabili.
                          </span>
                        </label>
                      )}
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">
                          {details.idLabel}
                        </span>
                        <input
                          value={draft.externalAccountId}
                          onChange={(event) =>
                            setChannelDrafts((current) => ({
                              ...current,
                              [channelType]: {
                                ...current[channelType],
                                externalAccountId: event.target.value,
                              },
                            }))
                          }
                          placeholder={details.idPlaceholder}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">
                          Nome visualizzato
                        </span>
                        <input
                          value={draft.displayName}
                          onChange={(event) =>
                            setChannelDrafts((current) => ({
                              ...current,
                              [channelType]: {
                                ...current[channelType],
                                displayName: event.target.value,
                              },
                            }))
                          }
                          placeholder="Assistenza Idromardi"
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">
                          {channelType === "INSTAGRAM"
                            ? draft.credentialMode === "INSTAGRAM_LOGIN"
                              ? "Instagram user access token"
                              : "Page access token"
                            : details.tokenLabel}
                        </span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={draft.accessToken}
                          onChange={(event) =>
                            setChannelDrafts((current) => ({
                              ...current,
                              [channelType]: {
                                ...current[channelType],
                                accessToken: event.target.value,
                              },
                            }))
                          }
                          placeholder={
                            channel?.has_access_token
                              ? "Token salvato — compila solo per sostituirlo"
                              : "Incolla il token del canale"
                          }
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">
                          Scadenza token (se applicabile)
                        </span>
                        <input
                          type="datetime-local"
                          value={draft.tokenExpiresAt}
                          onChange={(event) =>
                            setChannelDrafts((current) => ({
                              ...current,
                              [channelType]: {
                                ...current[channelType],
                                tokenExpiresAt: event.target.value,
                              },
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                        />
                      </label>
                    </fieldset>
                    {channelType === "MESSENGER" && (
                      <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          disabled={!isAdmin || !savedIntegration}
                          checked={!!draft.leadsEnabled}
                          onChange={(e) =>
                            setChannelDrafts((current) => ({
                              ...current,
                              MESSENGER: {
                                ...current.MESSENGER,
                                leadsEnabled: e.target.checked,
                              },
                            }))
                          }
                        />
                        Acquisisci i moduli Lead Ads. Salva e verifica
                        nuovamente; richiede permessi lead e accesso CRM alla
                        Pagina.
                      </label>
                    )}
                    {channel?.token_expires_at &&
                      new Date(
                        channel.token_expires_at.replace(" ", "T") +
                          (channel.token_expires_at.includes("T") ? "" : "Z"),
                      ).getTime() <
                        Date.now() + 7 * 86400000 && (
                        <p className="mt-2 text-xs text-amber-800">
                          Token scaduto o in scadenza entro 7 giorni: controlla
                          le credenziali prima degli invii.
                        </p>
                      )}
                    {channel?.credential_mode === "INSTAGRAM_LOGIN" && (
                      <div className="mt-3 space-y-2 text-xs">
                        <p className="text-slate-500">
                          Rinnovo automatico negli ultimi 7 giorni, con worker
                          attivo e scadenza registrata. Il token deve essere di
                          lunga durata, non scaduto e avere almeno 24 ore.
                        </p>
                        <button
                          disabled={!isAdmin || verificationBusy}
                          onClick={() => void refreshInstagramToken(channel)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                        >
                          Rinnova token Instagram
                        </button>
                        {channel.refresh_error && (
                          <p className="text-rose-700">
                            {channel.refresh_error}
                          </p>
                        )}
                      </div>
                    )}
                    {channelType === "INSTAGRAM" &&
                      draft.credentialMode === "INSTAGRAM_LOGIN" && (
                        <div className="mt-3 space-y-1 rounded-xl border border-fuchsia-100 bg-fuchsia-50 px-3 py-2 text-[11px] text-fuchsia-950">
                          <p>
                            App Instagram configurata:{" "}
                            <strong>
                              {overview.instagramLogin?.appId ||
                                "non configurata"}
                            </strong>
                          </p>
                          <p>
                            Secret Instagram:{" "}
                            {overview.instagramLogin?.appSecretConfigured
                              ? "configurato sul server"
                              : "mancante sul server"}
                          </p>
                          {(!overview.instagramLogin?.appId ||
                            !overview.instagramLogin?.appSecretConfigured) && (
                            <p className="break-words">
                              Su Render configura META_INSTAGRAM_APP_ID e
                              META_INSTAGRAM_APP_SECRET. Non sostituire l'App ID
                              generale o META_APP_SECRET.
                            </p>
                          )}
                          <details>
                            <summary className="cursor-pointer font-semibold">
                              Cosa viene verificato?
                            </summary>
                            <p className="mt-1">
                              L'App ID è la configurazione del server. La
                              verifica controlla account e iscrizione, non lo
                              stato di pubblicazione in Meta.
                            </p>
                          </details>
                        </div>
                      )}
                    <div className="mt-3 rounded-xl bg-white px-3 py-2 text-[10px] leading-4 text-slate-500">
                      Permessi:{" "}
                      {channelType === "INSTAGRAM"
                        ? draft.credentialMode === "INSTAGRAM_LOGIN"
                          ? "instagram_business_basic, instagram_business_manage_messages"
                          : "instagram_basic, instagram_manage_messages, pages_manage_metadata, pages_read_engagement, pages_show_list"
                        : details.permissions}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span>
                        {channel?.has_access_token
                          ? "Token cifrato salvato"
                          : "Token non presente"}
                      </span>
                      <span>
                        Scadenza: {formatDate(channel?.token_expires_at)}
                      </span>
                    </div>
                    {channelType === "INSTAGRAM" &&
                      channel?.credential_mode &&
                      operational && (
                        <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] text-blue-800">
                          Collegamento verificato:{" "}
                          {channel.credential_mode === "FACEBOOK_LOGIN"
                            ? "Pagina Facebook collegata"
                            : "Instagram Login"}
                        </div>
                      )}
                    {channelType === "INSTAGRAM" && (
                      <div className="mt-3 space-y-1 text-[11px] leading-4 text-slate-600">
                        {draft.credentialMode === "INSTAGRAM_LOGIN" &&
                          !draft.tokenExpiresAt && (
                            <p className="text-amber-800">
                              Scadenza token non registrata. Rinnovo automatico
                              non attivo.
                            </p>
                          )}
                        <details>
                          <summary className="cursor-pointer font-semibold">
                            Prima dell'uso reale
                          </summary>
                          <p className="mt-1">
                            Pubblica l'app e completa gli accessi richiesti da
                            Meta, poi prova un messaggio in entrata e una
                            risposta. Il badge ACTIVE indica la verifica
                            tecnica, non l'approvazione Meta. Registra la
                            scadenza effettiva del token e rinnovalo prima del
                            termine.
                          </p>
                        </details>
                      </div>
                    )}
                    {channel?.last_error && (
                      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] text-rose-800">
                        {channel.last_error}
                      </div>
                    )}
                    <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
                      <button
                        type="button"
                        onClick={() => void saveChannel(channelType)}
                        disabled={!isAdmin || !savedIntegration || saveBusy}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {saveBusy && (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        )}
                        Salva
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          channel && void verifyMetaChannel(channel)
                        }
                        disabled={
                          !isAdmin ||
                          !channel ||
                          verificationBusy ||
                          channel.status === "PAUSED" ||
                          instagramUnsaved
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${verificationBusy ? "animate-spin" : ""}`}
                        />
                        Verifica
                      </button>
                    </div>
                    {channel && (
                      <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 text-[10px] text-slate-500">
                        <span>
                          Ultima verifica:{" "}
                          {formatDate(channel.last_verified_at)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void toggleChannel(channel)}
                          disabled={!isAdmin}
                          className="font-bold text-slate-700 hover:text-slate-950 disabled:opacity-50"
                        >
                          {channel.status === "PAUSED"
                            ? "Riattiva"
                            : "Sospendi"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-xs font-black text-white">
                  4
                </span>
                <div>
                  <h2 className="font-bold text-slate-900">
                    Monitoraggio webhook
                  </h2>
                  <p className="text-xs text-slate-500">
                    Eventi consegnati da Meta e relativo esito.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void replayWebhooks()}
                disabled={!isAdmin || replaying}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${replaying ? "animate-spin" : ""}`}
                />
                Recupera eventi in attesa / errore
              </button>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[300px_1fr]">
              <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
                {[
                  [
                    "Elaborati",
                    overview.webhookDiagnostics.processed || 0,
                    "bg-emerald-50 text-emerald-700",
                  ],
                  [
                    "Non abbinati",
                    overview.webhookDiagnostics.unmatched || 0,
                    "bg-amber-50 text-amber-700",
                  ],
                  [
                    "Errori",
                    overview.webhookDiagnostics.failed || 0,
                    "bg-rose-50 text-rose-700",
                  ],
                ].map(([label, value, theme]) => (
                  <div
                    key={String(label)}
                    className={`rounded-xl p-3 ${theme}`}
                  >
                    <div className="text-2xl font-black">{String(value)}</div>
                    <div className="text-[10px] font-bold">{label}</div>
                  </div>
                ))}
              </div>
              <div className="max-h-[300px] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-slate-50/50">
                {overview.webhookDiagnostics.recentEvents.length === 0 ? (
                  <div className="p-5 text-sm text-slate-500">
                    Nessun webhook ricevuto. Verifica un canale, quindi invia un
                    nuovo messaggio reale.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {overview.webhookDiagnostics.recentEvents.map((event) => (
                      <div
                        key={event.id}
                        className={`flex items-center justify-between gap-3 border-l-4 px-4 py-3 ${webhookSurface(event.object_type)}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-slate-800">
                            {event.object_type || "Evento Meta"}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-500">
                            {formatDate(event.received_at)}
                          </div>
                          {event.error_message && (
                            <div className="mt-1 truncate text-[10px] text-rose-700">
                              {event.error_message}
                            </div>
                          )}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black ${
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
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="flex gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <Bot className="h-5 w-5 shrink-0 text-blue-700" />
            <div>
              <div className="text-sm font-bold text-blue-950">
                Assistente AI predisposto, non attivo
              </div>
              <p className="mt-1 text-xs leading-5 text-blue-900">
                La futura automazione userà la stessa inbox, coda di
                approvazione e audit. La modalità resta OFF.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
