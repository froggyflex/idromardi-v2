const express = require("express");
const controller = require("./meta.controller");
const { requireRole } = require("../auth/auth.middleware");

const publicRouter = express.Router();
publicRouter.get("/webhook", controller.verifyWebhook);
publicRouter.post("/webhook", controller.receiveWebhook);

const protectedRouter = express.Router();
protectedRouter.get(
  "/overview",
  requireRole("ADMIN", "REVIEWER"),
  controller.getOverview
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
