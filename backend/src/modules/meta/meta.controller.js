const service = require("./meta.service");
const webhook = require("./meta.webhook");

function sendError(res, error) {
  return res.status(error.statusCode || 500).json({
    error: error.message || "Errore integrazione Meta",
    code: error.code || "META_ERROR",
    ...(error.verification ? { verification: error.verification } : {}),
  });
}

exports.verifyWebhook = (req, res) => {
  const challenge = webhook.verifyChallenge(req.query);
  if (challenge === null) return res.status(403).send("Webhook verification failed");
  return res.status(200).send(challenge);
};

exports.receiveWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    if (!webhook.verifySignature(req.rawBody, signature)) {
      return res.status(401).json({ error: "Firma webhook Meta non valida" });
    }
    await service.ingestWebhook(req.rawBody, req.body || {});
    return res.status(200).json({ received: true });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getOverview = async (req, res) => {
  try {
    res.json(await service.getOverview());
  } catch (error) {
    sendError(res, error);
  }
};

exports.saveIntegration = async (req, res) => {
  try {
    res.status(201).json(await service.saveIntegration(req.body || {}, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.saveChannel = async (req, res) => {
  try {
    res.status(201).json(await service.saveChannel(req.params.id, req.body || {}, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.verifyChannel = async (req, res) => {
  try {
    res.json(await service.verifyChannel(req.params.id, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.setChannelStatus = async (req, res) => {
  try {
    res.json(await service.setChannelStatus(req.params.id, req.body?.status, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.replayUnmatchedEvents = async (req, res) => {
  try {
    const replay = await service.replayUnmatchedEvents({ limit: req.body?.limit });
    res.json({ replay, overview: await service.getOverview() });
  } catch (error) {
    sendError(res, error);
  }
};

exports.verifyWhatsAppIntegration = async (req, res) => {
  try {
    res.json(await service.verifyWhatsAppIntegration(req.params.id, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.setAiMode = async (req, res) => {
  try {
    res.json(await service.setAiMode(req.params.id, req.body?.mode, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.listConversations = async (req, res) => {
  try {
    res.json(await service.listConversations(req.query || {}));
  } catch (error) {
    sendError(res, error);
  }
};

exports.listMessages = async (req, res) => {
  try {
    res.json(await service.listMessages(req.params.id, req.query || {}));
  } catch (error) {
    sendError(res, error);
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    res.json(await service.deleteMessage(req.params.id, req.params.messageId, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.listLeads = async (req, res) => {
  try {
    res.json(await service.listLeads(req.query || {}));
  } catch (error) {
    sendError(res, error);
  }
};

exports.updateLead = async (req, res) => {
  try {
    res.json(await service.updateLead(req.params.id, req.body || {}, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.updateConversation = async (req, res) => {
  try {
    res.json(await service.updateConversation(req.params.id, req.body || {}, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.queueMessage = async (req, res) => {
  try {
    res.status(202).json(await service.queueMessage(req.params.id, req.body || {}, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.reviewJob = async (req, res) => {
  try {
    res.json(await service.approveJob(req.params.id, req.body?.approved === true, req.user));
  } catch (error) {
    sendError(res, error);
  }
};

exports.processOutbox = async (req, res) => {
  try {
    res.json(
      await service.processNextOutbound({
        jobId: req.body?.jobId,
        force: req.body?.force === true,
      })
    );
  } catch (error) {
    sendError(res, error);
  }
};
