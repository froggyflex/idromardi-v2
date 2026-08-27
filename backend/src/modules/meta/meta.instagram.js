const INSTAGRAM_CREDENTIAL_MODES = Object.freeze({
  FACEBOOK_LOGIN: "FACEBOOK_LOGIN",
  INSTAGRAM_LOGIN: "INSTAGRAM_LOGIN",
});

const INSTAGRAM_SCOPE_REQUIREMENTS = Object.freeze({
  [INSTAGRAM_CREDENTIAL_MODES.FACEBOOK_LOGIN]: Object.freeze([
    "instagram_basic",
    "instagram_manage_messages",
    "pages_manage_metadata",
  ]),
  [INSTAGRAM_CREDENTIAL_MODES.INSTAGRAM_LOGIN]: Object.freeze([
    "instagram_business_basic",
    "instagram_business_manage_messages",
  ]),
});

function missingScopes(scopes, requiredScopes) {
  const available = new Set((scopes || []).map(String));
  return requiredScopes.filter((scope) => !available.has(scope));
}

function detectInstagramCredentialMode(scopes) {
  for (const mode of [
    INSTAGRAM_CREDENTIAL_MODES.INSTAGRAM_LOGIN,
    INSTAGRAM_CREDENTIAL_MODES.FACEBOOK_LOGIN,
  ]) {
    if (!missingScopes(scopes, INSTAGRAM_SCOPE_REQUIREMENTS[mode]).length) return mode;
  }
  return null;
}

function instagramApiTarget(channel) {
  const mode = String(channel?.credential_mode || "").toUpperCase();
  if (mode === INSTAGRAM_CREDENTIAL_MODES.FACEBOOK_LOGIN) {
    const senderId = String(channel?.api_sender_id || "").trim();
    if (!senderId) return null;
    return { host: "https://graph.facebook.com", senderId };
  }
  if (mode === INSTAGRAM_CREDENTIAL_MODES.INSTAGRAM_LOGIN) {
    const senderId = String(channel?.api_sender_id || channel?.external_account_id || "").trim();
    if (!senderId) return null;
    return { host: "https://graph.instagram.com", senderId };
  }
  return null;
}

function resolveInstagramMode(requested, existing = null) {
  const mode = requested === undefined ? existing : requested;
  if (mode === null || mode === undefined || mode === "") return null;
  if (Object.values(INSTAGRAM_CREDENTIAL_MODES).includes(mode)) return mode;
  const error = new Error("Tipo di collegamento Instagram non valido");
  error.statusCode = 400;
  error.code = "META_INSTAGRAM_MODE_INVALID";
  throw error;
}

function configurationError(message, code = "META_INSTAGRAM_CONFIGURATION") {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

// Only used for idempotent verification calls, never for sending messages.
async function verificationStep(stage, operation, { secrets = [], sleep } = {}) {
  const pause = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const meta = error?.response?.data?.error;
      const permanent = [10, 100, 190].includes(Number(meta?.code)) || Number(meta?.code) >= 200;
      const retryable = !permanent && (Number(meta?.code) === 2 || meta?.is_transient === true ||
        Number(error?.response?.status) >= 500 || ["ECONNABORTED", "ETIMEDOUT"].includes(error?.code));
      if (retryable && attempt < 2) {
        await pause(700);
        continue;
      }
      let message = String(meta?.error_user_msg || meta?.message ||
        (error?.statusCode ? error.message : "Richiesta a Meta non riuscita"));
      for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
        message = message.split(secret).join("[redacted]");
        message = message.split(encodeURIComponent(secret)).join("[redacted]");
      }
      message = message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/((?:access_token|input_token|client_secret|appsecret_proof)=)[^&\s]+/gi, "$1[redacted]");
      const traceId = /^[\w-]{1,160}$/.test(String(meta?.fbtrace_id || "")) ? meta.fbtrace_id : null;
      const code = Number.isFinite(Number(meta?.code)) ? Number(meta.code) : null;
      const subcode = Number.isFinite(Number(meta?.error_subcode)) ? Number(meta.error_subcode) : null;
      const detail = [code === null ? null : `code ${code}`, subcode === null ? null : `subcode ${subcode}`,
        traceId ? `trace ${traceId}` : null].filter(Boolean).join(", ");
      const hint = retryable ? " Servizio Meta temporaneamente indisponibile: riprova tra qualche minuto." :
        code === 190 ? " Token scaduto o non valido: sostituiscilo nel canale Instagram." :
          code === 10 || (code >= 200 && code < 300) ? " Controlla permessi e accesso dell'account in Meta." : "";
      throw Object.assign(new Error(`${stage}: ${message.slice(0, 550)}${detail ? ` (${detail})` : ""}.${hint}`), {
        code: error?.statusCode ? error.code : "META_INSTAGRAM_API_ERROR",
        statusCode: error?.statusCode || 502,
        verification: { stage, metaCode: code, metaSubcode: subcode, traceId, retryable, attempts: attempt },
      });
    }
  }
}

async function verifyInstagramConnection({ channel, token, version, config, client, inspectToken, sleep }) {
  const options = { secrets: [token, config.instagramAppSecret, config.mainAppSecret], sleep };
  const step = (name, operation) => verificationStep(name, operation, options);
  const mode = await step("Configurazione Instagram", async () => {
    const selected = resolveInstagramMode(channel.credential_mode);
    if (!selected) throw configurationError("Seleziona il tipo di collegamento nel canale Instagram e premi Salva.");
    if (!/^v\d+\.\d+$/.test(version)) throw configurationError("Versione Graph API non valida.");
    if (!config.verifyToken) throw configurationError("META_WEBHOOK_VERIFY_TOKEN non configurato su Render.");
    if (selected === INSTAGRAM_CREDENTIAL_MODES.INSTAGRAM_LOGIN &&
        (!/^\d+$/.test(config.instagramAppId || "") || !config.instagramAppSecret)) {
      throw configurationError("Configura META_INSTAGRAM_APP_ID e META_INSTAGRAM_APP_SECRET su Render, senza modificare META_APP_SECRET.");
    }
    return selected;
  });
  const requestConfig = {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    timeout: config.timeout || 15000,
    maxRedirects: 0,
  };
  if (mode === INSTAGRAM_CREDENTIAL_MODES.INSTAGRAM_LOGIN) {
    // Native Instagram Login does not require Facebook /debug_token. Validate the
    // token against /me and let the messages subscription enforce its permissions.
    // The configured app ID is operator-supplied metadata, NOT token introspection.
    const baseUrl = `https://graph.instagram.com/${version}`;
    const profile = await step("Account e token Instagram", async () => {
      const response = await client.get(`${baseUrl}/me`, {
        ...requestConfig, params: { fields: "user_id,username,account_type" },
      });
      const value = Array.isArray(response.data?.data) ? response.data.data[0] : response.data;
      if (!value?.user_id || String(value.user_id) !== String(channel.external_account_id)) {
        throw configurationError("Il token non corrisponde all'Instagram Professional Account ID salvato.", "META_INSTAGRAM_MISMATCH");
      }
      return value;
    });
    const subscribedFields = ["messages", "messaging_postbacks", "messaging_seen"];
    await step("Iscrizione webhook Instagram", async () => {
      const response = await client.post(`${baseUrl}/${encodeURIComponent(profile.user_id)}/subscribed_apps`, null, {
        ...requestConfig, params: { subscribed_fields: subscribedFields.join(",") },
      });
      if (response.data?.success !== true) {
        throw configurationError("Meta non ha confermato l'iscrizione ai webhook. Controlla le autorizzazioni ai messaggi.", "META_INSTAGRAM_SUBSCRIPTION_FAILED");
      }
    });
    return {
      credentialMode: mode, instagramId: String(profile.user_id), username: profile.username || null,
      accountType: profile.account_type || null, configuredAppId: config.instagramAppId,
      subscribedFields, validationMethod: "INSTAGRAM_PROFILE_AND_SUBSCRIPTION",
    };
  }

  const baseUrl = `https://graph.facebook.com/${version}`;
  const inspection = await step("Token della Pagina Facebook", async () => {
    if (!channel.app_id) throw configurationError("Meta App ID generale obbligatorio.");
    const result = await inspectToken({ token, appId: channel.app_id, version,
      requiredScopes: INSTAGRAM_SCOPE_REQUIREMENTS[INSTAGRAM_CREDENTIAL_MODES.FACEBOOK_LOGIN] });
    if (!result.isValid || result.missingScopes.length) {
      throw configurationError(result.missingScopes.length ? `Permessi mancanti: ${result.missingScopes.join(", ")}` :
        "Page access token non valido.", "META_INSTAGRAM_TOKEN_INVALID");
    }
    if (result.appId !== String(channel.app_id)) {
      throw configurationError("Il Page token appartiene a una Meta App diversa.", "META_TOKEN_APP_MISMATCH");
    }
    return result;
  });
  const page = await step("Pagina e account Instagram collegato", async () => {
    const response = await client.get(`${baseUrl}/me`, {
      ...requestConfig, params: { fields: "id,name,instagram_business_account{id,username}" },
    });
    const value = response.data;
    if (!value?.id || !value.instagram_business_account?.id) {
      throw configurationError("La Pagina del token non ha un account Instagram professionale collegato.", "META_INSTAGRAM_PAGE_NOT_LINKED");
    }
    if (String(value.instagram_business_account.id) !== String(channel.external_account_id)) {
      throw configurationError("Il Page token appartiene a un account Instagram diverso.", "META_INSTAGRAM_MISMATCH");
    }
    return value;
  });
  await step("Iscrizione webhook della Pagina", async () => {
    // Preserve Messenger/Lead Ads subscriptions when Instagram shares this Page.
    const existing = await client.get(`${baseUrl}/${encodeURIComponent(page.id)}/subscribed_apps`, requestConfig);
    const app = (existing.data?.data || []).find((item) => String(item.id) === String(channel.app_id));
    const fields = [...new Set([...(app?.subscribed_fields || []), "messages"])];
    const response = await client.post(`${baseUrl}/${encodeURIComponent(page.id)}/subscribed_apps`, null, {
      ...requestConfig, params: { subscribed_fields: fields.join(",") },
    });
    if (response.data?.success !== true) throw configurationError("Meta non ha confermato l'iscrizione ai webhook.", "META_INSTAGRAM_SUBSCRIPTION_FAILED");
  });
  return {
    credentialMode: mode, instagramId: String(page.instagram_business_account.id),
    username: page.instagram_business_account.username || null, pageId: String(page.id), pageName: page.name || null,
    subscribedFields: ["messages"], scopes: inspection.scopes,
  };
}

module.exports = {
  INSTAGRAM_CREDENTIAL_MODES,
  INSTAGRAM_SCOPE_REQUIREMENTS,
  detectInstagramCredentialMode,
  instagramApiTarget,
  missingScopes,
  resolveInstagramMode,
  verificationStep,
  verifyInstagramConnection,
};
