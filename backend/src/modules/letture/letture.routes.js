const express = require("express");
const router = express.Router();
const lettureController = require("./letture.controller");
 
// Existing periods for calendar markers
router.get("/condomini/:condominioId/sessioni", lettureController.listSessionsByCondominio);

// Create or load session
router.post("/sessioni", lettureController.createOrLoadSession);

// Get session grid
router.get("/sessioni/:id", lettureController.getSessionGrid);

// Bulk save readings
router.put("/sessioni/:id/righe", lettureController.upsertSessionRowsBulk);

// Safe cancellation: rejected while billing/mobile dependencies exist.
router.delete("/sessioni/:id/righe/:idUtenza", lettureController.cancelReading);
router.delete("/sessioni/:id", lettureController.cancelSession);

// Close session
router.post("/sessioni/:id/chiudi", lettureController.closeSession);

module.exports = router;
