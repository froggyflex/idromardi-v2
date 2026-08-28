const service = require("./meta.service");
const webhook = require("./meta.webhook");
const { safeError } = require("./meta.policy");

function sendError(res, error) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : safeError(error),
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

exports.getUnreadSummary = async (req, res) => {
  try {
    res.json(await service.getUnreadSummary());
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

exports.readConversation = async (req, res) => {
  try {
    res.json(await service.readConversation(req.params.id, req.body || {}));
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
    res.json(await service.operations.updateLead(req.params.id, req.body || {}, req.user));
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

const action = fn => async (req,res) => { try { res.json(await fn(req)); } catch(error) {sendError(res,error);} };
exports.processLead = action(() => service.processNextLead());
exports.listOutbox = action(req => service.operations.outbox(req.query));
exports.controlJob = action(req => service.operations.controlJob(req.params.id,req.body || {},req.user));
exports.consent = action(req => service.operations.consent(req.params.id,req.body || {},req.user));
exports.eraseContact = action(req => service.operations.eraseContact(req.params.id,req.body || {},req.user));
exports.startWhatsApp = action(req => service.operations.startWhatsApp(req.body || {},req.user));
exports.refreshInstagram = action(req => service.operations.refreshInstagram(req.params.id,req.user));
exports.templates = action(req => service.assets.templates(req.params.id,req.query.after));
exports.upload = action(req => service.assets.upload(req.params.id,req.file,req.user));

function sendFile(res,file) {
  res.set({"Content-Type":file.mime_type,"Content-Length":String(file.content.length),"Cache-Control":"private, no-store",
    "X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox",
    "Content-Disposition":`attachment; filename="${String(file.filename).replace(/[^a-zA-Z0-9._ -]/g,"_")}"`});
  res.send(file.content);
}
exports.download = async(req,res) => {try{sendFile(res,await service.assets.download(req.params.id,Number(req.params.index)));}catch(error){sendError(res,error);} };
exports.publicMedia = async(req,res) => {try{sendFile(res,await service.assets.publicMedia(req.params.id,req.query.expires,req.query.signature));}catch(error){sendError(res,error);} };
