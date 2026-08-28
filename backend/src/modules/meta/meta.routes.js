const express = require("express");
const controller = require("./meta.controller");
const { requireRole } = require("../auth/auth.middleware");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8*1024*1024, files: 1, fields: 0 } });

const publicRouter = express.Router();
publicRouter.get("/webhook", controller.verifyWebhook);
publicRouter.post("/webhook", controller.receiveWebhook);
// Short-lived, per-file capability URLs generated only when an operator sends
// media. This does NOT expose arbitrary uploads or CRM routes anonymously.
publicRouter.get("/media-delivery/:id", controller.publicMedia);

const protectedRouter = express.Router();
protectedRouter.post("/leads/process",requireRole("ADMIN","REVIEWER"),controller.processLead);
protectedRouter.get("/outbox",requireRole("ADMIN","REVIEWER"),controller.listOutbox);
protectedRouter.patch("/outbox/:id",requireRole("ADMIN","REVIEWER"),controller.controlJob);
protectedRouter.patch("/contacts/:id/consent",requireRole("ADMIN","REVIEWER"),controller.consent);
protectedRouter.post("/contacts/:id/erase",requireRole("ADMIN"),controller.eraseContact);
protectedRouter.post("/conversations/whatsapp",requireRole("ADMIN","REVIEWER"),controller.startWhatsApp);
protectedRouter.post("/channels/:id/refresh-token",requireRole("ADMIN"),controller.refreshInstagram);
protectedRouter.get("/channels/:id/templates",requireRole("ADMIN","REVIEWER"),controller.templates);
protectedRouter.post("/channels/:id/attachments",requireRole("ADMIN","REVIEWER"), (req,res,next) => upload.single("file")(req,res,error => {
  if(error)return res.status(400).json({error:"Carica un solo file, massimo 8 MB.",code:"META_UPLOAD_INVALID"});
  next();
}),controller.upload);
protectedRouter.get("/messages/:id/attachments/:index",requireRole("ADMIN","REVIEWER"),controller.download);
protectedRouter.get(
  "/overview",
  requireRole("ADMIN", "REVIEWER"),
  controller.getOverview
);
protectedRouter.get(
  "/unread",
  requireRole("ADMIN", "REVIEWER"),
  controller.getUnreadSummary
);
protectedRouter.patch(
  "/conversations/:id",
  requireRole("ADMIN", "REVIEWER"),
  controller.updateConversation
);
protectedRouter.post(
  "/integrations",
  requireRole("ADMIN"),
  controller.saveIntegration
);
protectedRouter.post(
  "/integrations/:id/channels",
  requireRole("ADMIN"),
  controller.saveChannel
);
protectedRouter.post(
  "/channels/:id/verify",
  requireRole("ADMIN"),
  controller.verifyChannel
);
protectedRouter.patch(
  "/channels/:id/status",
  requireRole("ADMIN"),
  controller.setChannelStatus
);
protectedRouter.post(
  "/webhooks/replay",
  requireRole("ADMIN"),
  controller.replayUnmatchedEvents
);
protectedRouter.post(
  "/integrations/:id/verify-whatsapp",
  requireRole("ADMIN"),
  controller.verifyWhatsAppIntegration
);
protectedRouter.patch(
  "/integrations/:id/ai-mode",
  requireRole("ADMIN"),
  controller.setAiMode
);
protectedRouter.get(
  "/conversations",
  requireRole("ADMIN", "REVIEWER"),
  controller.listConversations
);
protectedRouter.patch(
  "/leads/:id",
  requireRole("ADMIN", "REVIEWER"),
  controller.updateLead
);
protectedRouter.get(
  "/conversations/:id/messages",
  requireRole("ADMIN", "REVIEWER"),
  controller.listMessages
);
protectedRouter.post(
  "/conversations/:id/read",
  requireRole("ADMIN", "REVIEWER"),
  controller.readConversation
);
protectedRouter.delete(
  "/conversations/:id/messages/:messageId",
  requireRole("ADMIN", "REVIEWER"),
  controller.deleteMessage
);
protectedRouter.post(
  "/conversations/:id/messages",
  requireRole("ADMIN", "REVIEWER"),
  controller.queueMessage
);
protectedRouter.get(
  "/leads",
  requireRole("ADMIN", "REVIEWER"),
  controller.listLeads
);
protectedRouter.post(
  "/outbox/:id/review",
  requireRole("ADMIN", "REVIEWER"),
  controller.reviewJob
);
protectedRouter.post(
  "/outbox/process",
  requireRole("ADMIN", "REVIEWER"),
  controller.processOutbox
);

module.exports = { protectedRouter, publicRouter };
