const express = require("express");
const router = express.Router();
const controller = require("./tariffe.controller");

 

/* Providers */
router.get("/providers", controller.listProviders);
router.post("/providers", controller.createProvider);
router.get("/providers/:providerId", controller.getProvider);

/* Tariff versions */
router.get("/providers/:providerId/versions", controller.listVersionsByProvider);
router.post("/providers/:providerId/versions", controller.createVersion);
router.put("/versions/:versionId", controller.updateVersion);
router.get("/versions/:versionId", controller.getVersionFull);

/* Categories */
router.post("/versions/:versionId/categories", controller.upsertCategory);

/* Scaglioni */
router.post("/categories/:categoryId/scaglioni", controller.createScaglione);
router.put("/scaglioni/:scaglioneId", controller.updateScaglione);
router.delete("/scaglioni/:scaglioneId", controller.deleteScaglione);
router.post("/categories/:categoryId/componenti-mc", controller.createComponenteMC);
router.put("/componenti-mc/:componenteId", controller.updateComponenteMC);
router.delete("/componenti-mc/:componenteId", controller.deleteComponenteMC);

/* Quote fisse */
router.post("/categories/:categoryId/quote-fisse", controller.createQuotaFissa);
router.put("/quote-fisse/:quotaId", controller.updateQuotaFissa);
router.delete("/quote-fisse/:quotaId", controller.deleteQuotaFissa);

module.exports = router;
