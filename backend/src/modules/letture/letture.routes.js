const express = require("express");
const router = express.Router();
const lettureController = require("./letture.controller");
 

// Create or load session
router.post("/sessioni", lettureController.createOrLoadSession);

// Get session grid
router.get("/sessioni/:id", lettureController.getSessionGrid);

// Bulk save readings
router.put("/sessioni/:id/righe", lettureController.upsertSessionRowsBulk);

// Close session
router.post("/sessioni/:id/chiudi", lettureController.closeSession);

module.exports = router;
