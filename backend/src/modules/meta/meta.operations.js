const crypto = require("crypto");
const { encryptSecret } = require("./meta.crypto");
const {
  problem,
  assertCanSend,
  safeError,
  boundedInt,
  utcDate,
  redactChannelPayload,
} = require("./meta.policy");

module.exports = function createOperations({
  db,
  client,
  assets,
  audit,
  messageContext,
  mysqlDateTime,
  parseJson,
}) {
  async function outbox({ offset = 0, state = "ATTENTION" } = {}) {
    const start = boundedInt(offset, 0, 1000000);
    const allowed = [
      "READY",
      "PROCESSING",
      "RETRY",
      "FAILED",
      "UNCERTAIN",
      "WAITING_APPROVAL",
      "SENT",
      "CANCELLED",
    ];
    if (state !== "ALL" && state !== "ATTENTION" && !allowed.includes(state))
      throw problem("Filtro non valido.", "META_FILTER_INVALID", 400);
    const [rows] = await db.query(
      `SELECT j.id,j.state,j.attempt_count,j.next_attempt_at,j.last_error,j.created_at,m.conversation_id,m.body_text,
       m.deleted_at,ch.channel_type,ch.display_name AS channel_name,c.display_name,c.external_contact_id
       FROM meta_outbound_jobs j JOIN meta_messages m ON m.id=j.message_id
       JOIN meta_conversations cv ON cv.id=m.conversation_id JOIN meta_contacts c ON c.id=cv.contact_id
       JOIN meta_channels ch ON ch.id=m.channel_id
       ${state === "ATTENTION" ? "WHERE j.state NOT IN ('SENT','CANCELLED')" : state === "ALL" ? "" : "WHERE j.state = ?"}
       ORDER BY j.created_at DESC,j.id DESC LIMIT 51 OFFSET ?`,
      [...(allowed.includes(state) ? [state] : []), start],
    );
    return { jobs: rows.slice(0, 50), hasMore: rows.length > 50 };
  }

  async function controlJob(id, input, actor) {
    if (!["retry", "cancel"].includes(input.action))
      throw problem("Azione non valida.", "META_ACTION_INVALID", 400);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[job]] = await conn.query(
        "SELECT j.*,m.conversation_id,m.request_json,m.deleted_at FROM meta_outbound_jobs j JOIN meta_messages m ON m.id=j.message_id WHERE j.id=? FOR UPDATE",
        [id],
      );
      if (!job) throw problem("Invio non trovato.", "META_JOB_NOT_FOUND", 404);
      if (["SENT", "PROCESSING"].includes(job.state))
        throw problem(
          "Invio già eseguito o in corso: non modificabile.",
          "META_JOB_IN_FLIGHT",
        );
      if (input.action === "retry") {
        if (!["FAILED", "UNCERTAIN", "RETRY"].includes(job.state))
          throw problem(
            "Questo invio non può essere riprovato.",
            "META_JOB_STATE",
          );
        if (
          job.state === "UNCERTAIN" &&
          input.acknowledgeDuplicateRisk !== true
        )
          throw problem(
            "Verifica prima che il destinatario non abbia già ricevuto il messaggio.",
            "META_DUPLICATE_RISK",
          );
        assertCanSend(
          { ...(await messageContext(job.conversation_id, conn)), ...job },
          parseJson(job.request_json) || { type: "text" },
        );
      }
      await conn.query(
        "UPDATE meta_outbound_jobs SET state=?, attempt_count=0, next_attempt_at=NULL,locked_at=NULL,last_error=NULL WHERE id=?",
        [input.action === "retry" ? "READY" : "CANCELLED", id],
      );
      await conn.query(
        "UPDATE meta_messages SET status=?,error_message=? WHERE id=?",
        [
          input.action === "retry" ? "QUEUED" : "FAILED",
          input.action === "retry" ? null : "Invio annullato dall'operatore",
          job.message_id,
        ],
      );
      await audit(conn, {
        integrationId: job.integration_id,
        actorId: actor.sub,
        actorKind: "HUMAN",
        action:
          input.action === "retry"
            ? "OUTBOX_RETRY_REQUESTED"
            : "OUTBOX_CANCELLED",
        entityType: "MESSAGE",
        entityId: job.message_id,
        details: {
          duplicateRiskAcknowledged: input.acknowledgeDuplicateRisk === true,
        },
      });
      await conn.commit();
      return { ok: true };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async function consent(contactId, input, actor) {
    if (!["UNKNOWN", "OPTED_IN", "OPTED_OUT"].includes(input.status))
      throw problem("Stato consenso non valido.", "META_CONSENT_INVALID", 400);
    const note = String(input.note || "").trim();
    if (input.status === "OPTED_IN" && note.length < 5)
      throw problem(
        "Indica fonte e data del consenso ricevuto.",
        "META_CONSENT_EVIDENCE",
        400,
      );
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[contact]] = await conn.query(
        "SELECT integration_id FROM meta_contacts WHERE id=? FOR UPDATE",
        [contactId],
      );
      if (!contact)
        throw problem("Contatto non trovato.", "META_CONTACT_NOT_FOUND", 404);
      await conn.query(
        "UPDATE meta_contacts SET consent_status=?,consent_note=?,consent_updated_at=CURRENT_TIMESTAMP(3) WHERE id=?",
        [input.status, note.slice(0, 1000) || null, contactId],
      );
      if (input.status === "OPTED_OUT") {
        await conn.query(
          `UPDATE meta_outbound_jobs j JOIN meta_messages m ON m.id=j.message_id JOIN meta_conversations cv ON cv.id=m.conversation_id
          SET j.state='CANCELLED',j.last_error='Consenso revocato',m.status='FAILED',m.error_message='Consenso revocato'
          WHERE cv.contact_id=? AND j.state IN ('READY','RETRY','WAITING_APPROVAL')`,
          [contactId],
        );
      }
      await audit(conn, {
        integrationId: contact.integration_id,
        actorId: actor.sub,
        actorKind: "HUMAN",
        action: "CONTACT_CONSENT_UPDATED",
        entityType: "CONTACT",
        entityId: contactId,
        details: { status: input.status },
      });
      await conn.commit();
      return { ok: true };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async function updateLead(id, input, actor) {
    const allowed = [
      "NEW",
      "CONTACTED",
      "QUALIFIED",
      "WON",
      "LOST",
      "ARCHIVED",
    ];
    const updates = [],
      values = [];
    if (input.status !== undefined) {
      if (!allowed.includes(input.status))
        throw problem(
          "Stato lead non valido.",
          "META_LEAD_STATUS_INVALID",
          400,
        );
      updates.push("status=?");
      values.push(input.status);
    }
    if (input.notes !== undefined) {
      updates.push("notes=?");
      values.push(String(input.notes).slice(0, 10000));
    }
    if (input.followUpAt !== undefined) {
      updates.push("follow_up_at=?");
      values.push(input.followUpAt ? mysqlDateTime(input.followUpAt) : null);
    }
    if (input.assignToMe !== undefined) {
      updates.push("assigned_to=?");
      values.push(input.assignToMe ? actor.sub : null);
    }
    if (input.retry === true) {
      updates.push(
        "hydration_status='PENDING'",
        "hydration_attempt_count=0",
        "hydration_next_attempt_at=NULL",
        "hydration_last_error=NULL",
        "hydration_locked_at=NULL",
      );
    }
    if (!updates.length)
      throw problem("Nessuna modifica.", "META_UPDATE_EMPTY", 400);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[lead]] = await conn.query(
        "SELECT integration_id,hydration_status FROM meta_leads WHERE id=? FOR UPDATE",
        [id],
      );
      if (!lead) throw problem("Lead non trovato.", "META_LEAD_NOT_FOUND", 404);
      if (
        input.retry &&
        ["PROCESSING", "COMPLETE"].includes(lead.hydration_status)
      )
        throw problem("Recupero in corso o già completato.", "META_LEAD_STATE");
      await conn.query(
        `UPDATE meta_leads SET ${updates.join(",")} WHERE id=?`,
        [...values, id],
      );
      await audit(conn, {
        integrationId: lead.integration_id,
        actorId: actor.sub,
        actorKind: "HUMAN",
        action: "LEAD_UPDATED",
        entityType: "LEAD",
        entityId: id,
      });
      await conn.commit();
      return { ok: true };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async function startWhatsApp(input, actor) {
    const phone = String(input.phone || "").replace(/[\s()-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      throw problem(
        "Inserisci il numero con prefisso internazionale, es. +39…",
        "META_PHONE_INVALID",
        400,
      );
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[ch]] = await conn.query(
        "SELECT * FROM meta_channels WHERE id=? AND channel_type='WHATSAPP' AND status='ACTIVE' FOR UPDATE",
        [input.channelId],
      );
      if (!ch)
        throw problem(
          "Seleziona un canale WhatsApp attivo.",
          "META_CHANNEL_NOT_CONNECTED",
        );
      const external = phone.slice(1);
      await conn.query(
        `INSERT INTO meta_contacts (id,integration_id,channel_type,external_contact_id,display_name,phone)
        VALUES (?,?,'WHATSAPP',?,?,?) ON DUPLICATE KEY UPDATE phone=VALUES(phone)`,
        [
          crypto.randomUUID(),
          ch.integration_id,
          external,
          String(input.name || "")
            .trim()
            .slice(0, 191) || null,
          phone,
        ],
      );
      const [[contact]] = await conn.query(
        "SELECT id,consent_status FROM meta_contacts WHERE integration_id=? AND channel_type='WHATSAPP' AND external_contact_id=?",
        [ch.integration_id, external],
      );
      await conn.query(
        "INSERT INTO meta_conversations (id,integration_id,channel_id,contact_id,last_message_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=id",
        [crypto.randomUUID(), ch.integration_id, ch.id, contact.id],
      );
      const [[conversation]] = await conn.query(
        "SELECT id FROM meta_conversations WHERE channel_id=? AND contact_id=?",
        [ch.id, contact.id],
      );
      await audit(conn, {
        integrationId: ch.integration_id,
        actorId: actor.sub,
        actorKind: "HUMAN",
        action: "WHATSAPP_CONVERSATION_OPENED",
        entityType: "CONVERSATION",
        entityId: conversation.id,
      });
      await conn.commit();
      return { conversationId: conversation.id, contactId: contact.id };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async function refreshInstagram(id, actor) {
    const ch = await assets.channel(id);
    if (
      ch.credential_mode !== "INSTAGRAM_LOGIN" ||
      ch.channel_type !== "INSTAGRAM" ||
      ch.status !== "ACTIVE"
    )
      throw problem(
        "Rinnovo disponibile per Instagram Login attivo.",
        "META_REFRESH_MODE",
      );
    if (ch.token_expires_at && utcDate(ch.token_expires_at) <= new Date())
      throw problem(
        "Token già scaduto: generane uno nuovo in Meta.",
        "META_TOKEN_EXPIRED",
      );
    if (
      ch.last_token_refresh_at &&
      Date.now() - utcDate(ch.last_token_refresh_at).getTime() < 86400000
    )
      throw problem(
        "Token rinnovato da meno di 24 ore.",
        "META_REFRESH_TOO_EARLY",
      );
    try {
      const response = await client.get(
        "https://graph.instagram.com/refresh_access_token",
        {
          params: { grant_type: "ig_refresh_token", access_token: ch.token },
          timeout: 15000,
          maxRedirects: 0,
        },
      );
      if (
        !response.data?.access_token ||
        !(Number(response.data.expires_in) > 0)
      )
        throw problem(
          "Meta non ha confermato il rinnovo.",
          "META_REFRESH_FAILED",
          502,
        );
      const secret = encryptSecret(response.data.access_token);
      const [result] = await db.query(
        `UPDATE meta_channels SET encrypted_access_token=?,token_iv=?,token_auth_tag=?,token_expires_at=?,
        last_token_refresh_at=CURRENT_TIMESTAMP(3),refresh_error=NULL WHERE id=? AND encrypted_access_token=? AND credential_mode='INSTAGRAM_LOGIN' AND status='ACTIVE'`,
        [
          secret.encrypted,
          secret.iv,
          secret.authTag,
          mysqlDateTime(
            new Date(Date.now() + Number(response.data.expires_in) * 1000),
          ),
          id,
          ch.encrypted_access_token,
        ],
      );
      if (!result.affectedRows)
        throw problem(
          "Credenziali modificate durante il rinnovo: verifica il canale.",
          "META_CHANNEL_CHANGED",
        );
      await audit(db, {
        integrationId: ch.integration_id,
        actorId: actor?.sub,
        actorKind: actor ? "HUMAN" : "SYSTEM",
        action: "INSTAGRAM_TOKEN_REFRESHED",
        entityType: "CHANNEL",
        entityId: id,
      });
      return { ok: true };
    } catch (error) {
      const message = safeError(error).replaceAll(ch.token, "[redacted]");
      await db.query(
        "UPDATE meta_channels SET refresh_error=?,last_token_refresh_at=CURRENT_TIMESTAMP(3) WHERE id=? AND encrypted_access_token=?",
        [message, id, ch.encrypted_access_token],
      );
      throw problem(message, "META_REFRESH_FAILED", 502);
    }
  }

  async function maintenance() {
    await db.query(`UPDATE meta_leads SET hydration_status='RETRY',hydration_locked_at=NULL,hydration_next_attempt_at=NULL,
      hydration_last_error='Recupero interrotto: ripresa automatica'
      WHERE hydration_status='PROCESSING' AND (hydration_locked_at IS NULL OR hydration_locked_at<DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 5 MINUTE))`);
    // Only abandoned, unsent uploads expire automatically. Message retention is
    // a business decision and is never silently imposed by this worker.
    await db.query(
      "DELETE FROM meta_attachments WHERE message_id IS NULL AND created_at<DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 1 DAY)",
    );
    const [channels] =
      await db.query(`SELECT id FROM meta_channels WHERE credential_mode='INSTAGRAM_LOGIN' AND status='ACTIVE'
      AND token_expires_at>CURRENT_TIMESTAMP(3) AND token_expires_at<DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL 7 DAY)
      AND (last_token_refresh_at IS NULL OR last_token_refresh_at<DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 1 DAY)) LIMIT 1`);
    if (channels[0])
      try {
        await refreshInstagram(channels[0].id);
      } catch {
        /* Saved diagnostics shown in the operator UI. */
      }
  }

  async function eraseContact(id, input, actor) {
    if (input.confirmation !== "ELIMINA")
      throw problem(
        "Conferma digitando ELIMINA.",
        "META_ERASURE_CONFIRMATION",
        400,
      );
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[contact]] = await conn.query(
        "SELECT * FROM meta_contacts WHERE id=? FOR UPDATE",
        [id],
      );
      if (!contact)
        throw problem("Contatto non trovato.", "META_CONTACT_NOT_FOUND", 404);
      const [messages] = await conn.query(
        "SELECT m.id,m.external_message_id FROM meta_messages m JOIN meta_conversations cv ON cv.id=m.conversation_id WHERE cv.contact_id=?",
        [id],
      );
      const [leads] = await conn.query(
        "SELECT id,external_lead_id FROM meta_leads WHERE contact_id=?",
        [id],
      );
      const [[busy]] = await conn.query(
        "SELECT COUNT(*) AS n FROM meta_outbound_jobs j JOIN meta_messages m ON m.id=j.message_id JOIN meta_conversations cv ON cv.id=m.conversation_id WHERE cv.contact_id=? AND j.state='PROCESSING'",
        [id],
      );
      if (Number(busy.n))
        throw problem(
          "Attendi la conclusione degli invii in corso.",
          "META_ERASURE_IN_FLIGHT",
        );
      const identifiers = new Set(
        [
          contact.external_contact_id,
          ...messages.map((m) => m.external_message_id),
          ...leads.map((l) => l.external_lead_id),
        ]
          .filter(Boolean)
          .map(String),
      );
      const [channels] = await conn.query(
        "SELECT external_account_id FROM meta_channels WHERE integration_id=? AND channel_type=?",
        [contact.integration_id, contact.channel_type],
      );
      const accounts = new Set(
        channels.map((channel) => String(channel.external_account_id)),
      );
      // Scrub matching objects, not entire batched envelopes containing other people's messages.
      const [events] = await conn.query(
        "SELECT id,payload_json FROM meta_webhook_events FOR UPDATE",
      );
      for (const event of events) {
        const original = parseJson(event.payload_json);
        const redacted =
          redactChannelPayload(
            original,
            contact.channel_type,
            accounts,
            identifiers,
          ) || {};
        if (JSON.stringify(original) !== JSON.stringify(redacted))
          await conn.query(
            "UPDATE meta_webhook_events SET payload_json=? WHERE id=?",
            [JSON.stringify(redacted), event.id],
          );
      }
      await conn.query("DELETE FROM meta_leads WHERE contact_id=?", [id]);
      await conn.query("DELETE FROM meta_contacts WHERE id=?", [id]); // cascades conversations/messages/outbox/attachments
      const entityIds = [
        id,
        ...messages.map((m) => m.id),
        ...leads.map((l) => l.id),
      ];
      await conn.query(
        "UPDATE meta_audit_log SET details_json=NULL WHERE entity_id IN (?)",
        [entityIds],
      );
      await audit(conn, {
        integrationId: contact.integration_id,
        actorId: actor.sub,
        actorKind: "HUMAN",
        action: "CONTACT_DATA_ERASED",
        entityType: "CONTACT",
        entityId: id,
        details: { messages: messages.length, leads: leads.length },
      });
      await conn.commit();
      return {
        ok: true,
        messages: messages.length,
        leads: leads.length,
        notice:
          "Dati eliminati dal database attivo. Backup, copie Meta e altri canali richiedono una verifica separata.",
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
  return {
    outbox,
    controlJob,
    consent,
    updateLead,
    startWhatsApp,
    refreshInstagram,
    maintenance,
    eraseContact,
  };
};
