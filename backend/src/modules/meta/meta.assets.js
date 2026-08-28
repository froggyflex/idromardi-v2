const crypto = require("crypto");
const FormData = require("form-data");
const { decryptSecret } = require("./meta.crypto");
const { instagramApiTarget } = require("./meta.instagram");
const { problem } = require("./meta.policy");
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const json = (value) =>
  typeof value === "string" ? JSON.parse(value) : value || {};

function identifyFile(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    !buffer.length ||
    buffer.length > MAX_MEDIA_BYTES
  )
    throw problem("Allegato vuoto o superiore a 8 MB.", "META_MEDIA_SIZE", 400);
  const head = buffer.subarray(0, 16);
  if (head.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    return { mime: "image/jpeg", type: "image", ext: "jpg" };
  if (
    head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mime: "image/png", type: "image", ext: "png" };
  if (
    head.toString("ascii", 0, 4) === "RIFF" &&
    head.toString("ascii", 8, 12) === "WEBP"
  )
    return { mime: "image/webp", type: "image", ext: "webp" };
  if (head.toString("ascii", 0, 5) === "%PDF-")
    return { mime: "application/pdf", type: "document", ext: "pdf" };
  if (head.toString("ascii", 0, 4) === "OggS")
    return { mime: "audio/ogg", type: "audio", ext: "ogg" };
  if (
    head.toString("ascii", 0, 3) === "ID3" ||
    (head[0] === 255 && (head[1] & 224) === 224)
  )
    return { mime: "audio/mpeg", type: "audio", ext: "mp3" };
  if (head.toString("ascii", 4, 8) === "ftyp")
    return { mime: "video/mp4", type: "video", ext: "mp4" };
  throw problem(
    "Formato non supportato. Usa JPG, PNG, WebP, PDF, MP3, OGG o MP4.",
    "META_MEDIA_TYPE",
    400,
  );
}

function mediaUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw problem("Indirizzo allegato non valido.", "META_MEDIA_URL", 400);
  }
  const domains = [
    "fbcdn.net",
    "cdninstagram.com",
    "fbsbx.com",
    "facebook.com",
  ];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !domains.some(
      (domain) =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    )
  ) {
    throw problem(
      "Il file non proviene da un server multimediale Meta autorizzato.",
      "META_MEDIA_HOST",
      400,
    );
  }
  return url.href;
}

function attachmentDescriptors(row) {
  if (row.deleted_at) return [];
  const request = json(row.request_json);
  if (request.type === "media")
    return [{ index: 0, type: request.mediaType, name: request.filename }];
  const data = json(row.payload_json);
  if (
    data.type &&
    data[data.type]?.id &&
    ["image", "document", "audio", "video", "sticker"].includes(data.type)
  ) {
    return [
      {
        index: 0,
        type: data.type === "sticker" ? "image" : data.type,
        name: data[data.type]?.filename || "Allegato",
      },
    ];
  }
  return (data.message?.attachments || [])
    .slice(0, 10)
    .map((item, index) => ({
      index,
      type: item.type,
      name: item.name || "Allegato",
    }));
}

function templateDefinition(template) {
  const parameters = [];
  let supported = true;
  for (const component of template.components || []) {
    if (component.type === "HEADER" && component.format !== "TEXT")
      supported = false;
    if (!["BODY", "HEADER", "FOOTER", "BUTTONS"].includes(component.type))
      supported = false;
    if (
      component.type === "BUTTONS" &&
      (component.buttons || []).some(
        (button) =>
          !["URL", "PHONE_NUMBER", "QUICK_REPLY"].includes(button.type) ||
          /{{/.test(button.url || ""),
      )
    )
      supported = false;
    if (["HEADER", "BODY"].includes(component.type)) {
      const keys = [
        ...new Set(
          [...String(component.text || "").matchAll(/{{\s*([\w]+)\s*}}/g)].map(
            (match) => match[1],
          ),
        ),
      ];
      keys.sort((a, b) =>
        /^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : 0,
      );
      keys.forEach((key) =>
        parameters.push({
          key: `${component.type.toLowerCase()}:${key}`,
          label: key,
          component: component.type.toLowerCase(),
          named: !/^\d+$/.test(key),
        }),
      );
    }
  }
  return {
    id: template.id,
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    supported,
    parameters,
    preview: (template.components || [])
      .filter((c) => c.text)
      .map((c) =>
        String(c.text).replace(
          /{{\s*(\w+)\s*}}/g,
          (_, key) => `{{${c.type.toLowerCase()}:${key}}}`,
        ),
      )
      .join("\n"),
  };
}

module.exports = function createAssets({ db, client, audit }) {
  async function channel(id) {
    const [[row]] = await db.query(
      `SELECT ch.*, i.business_account_id, i.graph_api_version FROM meta_channels ch
       JOIN meta_integrations i ON i.id = ch.integration_id WHERE ch.id = ?`,
      [id],
    );
    if (!row)
      throw problem("Canale non trovato.", "META_CHANNEL_NOT_FOUND", 404);
    const token = decryptSecret({
      encrypted: row.encrypted_access_token,
      iv: row.token_iv,
      authTag: row.token_auth_tag,
    });
    if (!token)
      throw problem("Token del canale mancante.", "META_TOKEN_MISSING");
    const version = row.graph_api_version || process.env.META_GRAPH_API_VERSION;
    if (!/^v\d+\.\d+$/.test(version || ""))
      throw problem("Versione Graph API non valida.", "META_VERSION_INVALID");
    return { ...row, token, version };
  }

  async function templates(channelId, after) {
    const ch = await channel(channelId);
    if (ch.channel_type !== "WHATSAPP" || !ch.business_account_id)
      throw problem(
        "Seleziona un canale WhatsApp con WABA configurato.",
        "META_TEMPLATE_CHANNEL",
      );
    const response = await client.get(
      `https://graph.facebook.com/${ch.version}/${encodeURIComponent(ch.business_account_id)}/message_templates`,
      {
        headers: { Authorization: `Bearer ${ch.token}` },
        timeout: 15000,
        maxRedirects: 0,
        params: {
          fields: "id,name,language,status,category,components",
          limit: 100,
          ...(after ? { after: String(after).slice(0, 1000) } : {}),
        },
      },
    );
    return {
      templates: (response.data?.data || []).map(templateDefinition),
      next: response.data?.paging?.next
        ? response.data.paging.cursors?.after
        : null,
    };
  }

  async function prepareTemplate(channelId, input) {
    const ch = await channel(channelId);
    if (ch.channel_type !== "WHATSAPP")
      throw problem("Template solo per WhatsApp.", "META_TEMPLATE_CHANNEL");
    if (
      !ch.business_account_id ||
      !/^\d+$/.test(String(input.id)) ||
      !/^[a-z0-9_]{1,512}$/.test(String(input.name || ""))
    )
      throw problem(
        "Template o WABA non valido.",
        "META_TEMPLATE_INVALID",
        400,
      );
    // Fetch through the configured WABA, not an arbitrary template owned elsewhere.
    const response = await client.get(
      `https://graph.facebook.com/${ch.version}/${encodeURIComponent(ch.business_account_id)}/message_templates`,
      {
        headers: { Authorization: `Bearer ${ch.token}` },
        timeout: 15000,
        maxRedirects: 0,
        params: {
          name: String(input.name || "").slice(0, 512),
          fields: "id,name,language,status,category,components",
          limit: 100,
        },
      },
    );
    const found = (response.data?.data || []).find(
      (t) => String(t.id) === String(input.id),
    );
    if (!found)
      throw problem(
        "Template non presente in questo WABA.",
        "META_TEMPLATE_NOT_FOUND",
      );
    const definition = templateDefinition(found);
    if (definition.status !== "APPROVED" || !definition.supported)
      throw problem(
        "Template non approvato o formato non supportato dal compositore.",
        "META_TEMPLATE_UNAVAILABLE",
      );
    const values = input.values || {};
    const components = [];
    let preview = definition.preview;
    for (const type of ["header", "body"]) {
      const fields = definition.parameters.filter((p) => p.component === type);
      if (!fields.length) continue;
      const parameters = fields.map((field) => {
        const text = String(values[field.key] || "").trim();
        if (!text || text.length > 1000)
          throw problem(
            `Compila il parametro ${field.label} (massimo 1000 caratteri).`,
            "META_TEMPLATE_PARAMETER",
            400,
          );
        preview = preview.replaceAll(`{{${field.key}}}`, text);
        return {
          type: "text",
          text,
          ...(field.named ? { parameter_name: field.label } : {}),
        };
      });
      components.push({ type, parameters });
    }
    return {
      type: "template",
      definition: { id: definition.id, name: definition.name, values },
      template: {
        name: definition.name,
        language: { code: definition.language },
        ...(components.length ? { components } : {}),
      },
      preview,
    };
  }

  async function upload(channelId, file, actor) {
    if (!file?.buffer)
      throw problem("Seleziona un file.", "META_MEDIA_MISSING", 400);
    const [[ch]] = await db.query(
      "SELECT id, channel_type FROM meta_channels WHERE id = ?",
      [channelId],
    );
    if (!ch)
      throw problem("Canale non trovato.", "META_CHANNEL_NOT_FOUND", 404);
    const kind = identifyFile(file.buffer);
    if (
      ch.channel_type === "INSTAGRAM" &&
      !["image/jpeg", "image/png", "application/pdf", "video/mp4"].includes(
        kind.mime,
      )
    )
      throw problem(
        "Per Instagram usa JPG, PNG, PDF o MP4.",
        "META_MEDIA_CHANNEL",
        400,
      );
    if (
      ch.channel_type === "WHATSAPP" &&
      kind.type === "image" &&
      (kind.mime === "image/webp" || file.buffer.length > 5 * 1024 * 1024)
    )
      throw problem(
        "Per le immagini WhatsApp usa JPG o PNG, massimo 5 MB.",
        "META_MEDIA_CHANNEL",
        400,
      );
    const filename = String(file.originalname || `allegato.${kind.ext}`)
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .slice(0, 180);
    const [[capacity]] = await db.query("SELECT @@max_allowed_packet AS bytes");
    if (file.buffer.length + 65536 > Number(capacity.bytes))
      throw problem(
        "Il file supera il limite del database. Usa un allegato più piccolo o chiedi all’amministratore di aumentare max_allowed_packet.",
        "META_MEDIA_DATABASE_LIMIT",
        400,
      );
    const id = crypto.randomUUID();
    await db.query(
      "INSERT INTO meta_attachments (id,channel_id,created_by,filename,mime_type,media_type,content,byte_length) VALUES (?,?,?,?,?,?,?,?)",
      [
        id,
        channelId,
        actor.sub,
        filename,
        kind.mime,
        kind.type,
        file.buffer,
        file.buffer.length,
      ],
    );
    return { id, filename, type: kind.type, size: file.buffer.length };
  }

  async function prepareMedia(channelId, attachmentId, actor) {
    const [[file]] = await db.query(
      "SELECT id, filename, media_type FROM meta_attachments WHERE id = ? AND channel_id = ? AND created_by = ? AND message_id IS NULL",
      [attachmentId, channelId, actor.sub],
    );
    if (!file)
      throw problem(
        "Allegato non disponibile: caricalo nuovamente.",
        "META_MEDIA_NOT_FOUND",
        404,
      );
    return {
      type: "media",
      attachmentId: file.id,
      filename: file.filename,
      mediaType: file.media_type,
    };
  }

  function signedMediaUrl(id) {
    const configured =
      process.env.META_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
    let base;
    try {
      base = new URL(configured);
    } catch {
      throw problem(
        "Configura META_PUBLIC_BASE_URL sul backend per inviare allegati Messenger/Instagram.",
        "META_PUBLIC_URL_MISSING",
      );
    }
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      !process.env.META_CREDENTIALS_ENCRYPTION_KEY
    )
      throw problem(
        "URL pubblico o chiave multimediale non validi.",
        "META_PUBLIC_URL_INVALID",
      );
    const expires = Math.floor(Date.now() / 1000) + 600;
    const signature = crypto
      .createHmac("sha256", process.env.META_CREDENTIALS_ENCRYPTION_KEY)
      .update(`meta-media:${id}:${expires}`)
      .digest("hex");
    return `${base.origin}/api/meta/media-delivery/${id}?expires=${expires}&signature=${signature}`;
  }

  async function publicMedia(id, expires, signature) {
    if (
      !process.env.META_CREDENTIALS_ENCRYPTION_KEY ||
      !/^\d{10}$/.test(String(expires)) ||
      Number(expires) < Date.now() / 1000 ||
      Number(expires) > Date.now() / 1000 + 601 ||
      !/^[a-f0-9]{64}$/.test(String(signature))
    )
      throw problem("Collegamento scaduto.", "META_MEDIA_EXPIRED", 403);
    const expected = crypto
      .createHmac("sha256", process.env.META_CREDENTIALS_ENCRYPTION_KEY)
      .update(`meta-media:${id}:${expires}`)
      .digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature, "hex")))
      throw problem("Collegamento non valido.", "META_MEDIA_INVALID", 403);
    const [[file]] = await db.query(
      "SELECT a.* FROM meta_attachments a JOIN meta_messages m ON m.id = a.message_id WHERE a.id = ? AND m.deleted_at IS NULL",
      [id],
    );
    if (!file)
      throw problem("Allegato non disponibile.", "META_MEDIA_NOT_FOUND", 404);
    return file;
  }

  async function buildSendBody(job, request, token, version) {
    const target =
      job.channel_type === "INSTAGRAM" ? instagramApiTarget(job) : null;
    if (job.channel_type === "INSTAGRAM" && !target)
      throw problem(
        "Verifica nuovamente Instagram.",
        "META_INSTAGRAM_UNVERIFIED",
      );
    const url = `${target?.host || "https://graph.facebook.com"}/${version}/${encodeURIComponent(target?.senderId || job.external_account_id)}/messages`;
    if (request.type === "template") {
      const checked = await prepareTemplate(job.channel_id, request.definition);
      return {
        url,
        body: {
          messaging_product: "whatsapp",
          to: job.external_contact_id,
          type: "template",
          template: checked.template,
        },
      };
    }
    if (request.type === "media") {
      const [[file]] = await db.query(
        "SELECT * FROM meta_attachments WHERE id = ? AND message_id = ?",
        [request.attachmentId, job.message_id],
      );
      if (!file)
        throw problem("Allegato non disponibile.", "META_MEDIA_NOT_FOUND", 404);
      if (job.channel_type === "WHATSAPP") {
        const form = new FormData();
        form.append("messaging_product", "whatsapp");
        form.append("type", file.mime_type);
        form.append("file", file.content, {
          filename: file.filename,
          contentType: file.mime_type,
        });
        const upload = await client.post(
          `https://graph.facebook.com/${version}/${encodeURIComponent(job.external_account_id)}/media`,
          form,
          {
            headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
            maxBodyLength: MAX_MEDIA_BYTES + 100000,
            timeout: 30000,
            maxRedirects: 0,
          },
        );
        if (!upload.data?.id)
          throw problem(
            "Caricamento Meta non confermato.",
            "META_UPLOAD_FAILED",
            502,
          );
        return {
          url,
          body: {
            messaging_product: "whatsapp",
            to: job.external_contact_id,
            type: file.media_type,
            [file.media_type]: {
              id: upload.data.id,
              ...(file.media_type === "document"
                ? { filename: file.filename }
                : {}),
            },
          },
        };
      }
      return {
        url,
        body: {
          recipient: { id: job.external_contact_id },
          ...(job.channel_type === "MESSENGER"
            ? { messaging_type: "RESPONSE" }
            : {}),
          message: {
            attachment: {
              type: file.media_type === "document" ? "file" : file.media_type,
              payload: { url: signedMediaUrl(file.id) },
            },
          },
        },
      };
    }
    return {
      url,
      body:
        job.channel_type === "WHATSAPP"
          ? {
              messaging_product: "whatsapp",
              to: job.external_contact_id,
              type: "text",
              text: { body: job.body_text },
            }
          : {
              recipient: { id: job.external_contact_id },
              ...(job.channel_type === "MESSENGER"
                ? { messaging_type: "RESPONSE" }
                : {}),
              message: { text: job.body_text },
            },
    };
  }

  async function download(messageId, index) {
    const [[message]] = await db.query(
      "SELECT * FROM meta_messages WHERE id = ? AND deleted_at IS NULL",
      [messageId],
    );
    if (!message)
      throw problem(
        "Messaggio non disponibile.",
        "META_MESSAGE_NOT_FOUND",
        404,
      );
    const descriptors = attachmentDescriptors(message);
    if (!Number.isInteger(index) || index < 0 || !descriptors[index])
      throw problem("Allegato non disponibile.", "META_MEDIA_NOT_FOUND", 404);
    const request = json(message.request_json);
    if (request.type === "media") {
      const [[file]] = await db.query(
        "SELECT * FROM meta_attachments WHERE id = ? AND message_id = ?",
        [request.attachmentId, messageId],
      );
      if (!file)
        throw problem("Allegato eliminato.", "META_MEDIA_NOT_FOUND", 404);
      return file;
    }
    const ch = await channel(message.channel_id);
    const data = json(message.payload_json);
    let url;
    let headers = {};
    if (ch.channel_type === "WHATSAPP") {
      const id = data[data.type]?.id;
      const response = await client.get(
        `https://graph.facebook.com/${ch.version}/${encodeURIComponent(id)}`,
        {
          headers: { Authorization: `Bearer ${ch.token}` },
          params: { phone_number_id: ch.external_account_id },
          timeout: 15000,
          maxRedirects: 0,
        },
      );
      url = response.data?.url;
      headers.Authorization = `Bearer ${ch.token}`;
    } else url = data.message?.attachments?.[index]?.payload?.url;
    if (!url)
      throw problem(
        "Questo contenuto non espone un file scaricabile (es. condivisione/storia scaduta).",
        "META_MEDIA_UNAVAILABLE",
        410,
      );
    let response;
    for (let hop = 0; hop < 4; hop++) {
      const validated = mediaUrl(url);
      // Bearer credentials are only sent to WhatsApp's authenticated media host.
      const allowedHeaders =
        new URL(validated).hostname === "lookaside.fbsbx.com" ? headers : {};
      response = await client.get(validated, {
        headers: allowedHeaders,
        responseType: "arraybuffer",
        timeout: 20000,
        maxContentLength: MAX_MEDIA_BYTES,
        maxRedirects: 0,
        validateStatus: (status) =>
          (status >= 200 && status < 300) || (status >= 300 && status < 400),
      });
      if (response.status < 300) break;
      url = new URL(response.headers.location, validated).href;
      if (hop === 3)
        throw problem(
          "Troppi reindirizzamenti del file.",
          "META_MEDIA_REDIRECT",
          502,
        );
    }
    const content = Buffer.from(response.data);
    const kind = identifyFile(content);
    return {
      content,
      mime_type: kind.mime,
      filename: `allegato.${kind.ext}`,
      byte_length: content.length,
    };
  }
  return {
    channel,
    templates,
    prepareTemplate,
    upload,
    prepareMedia,
    buildSendBody,
    download,
    publicMedia,
  };
};
module.exports.identifyFile = identifyFile;
module.exports.mediaUrl = mediaUrl;
module.exports.attachmentDescriptors = attachmentDescriptors;
module.exports.templateDefinition = templateDefinition;
module.exports.MAX_MEDIA_BYTES = MAX_MEDIA_BYTES;
