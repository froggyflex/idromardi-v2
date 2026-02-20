const express = require("express");
const router = express.Router();
const controller = require("./fatture.controller");

router.post("/sessioni", controller.createOrLoadSession);
router.get( "/condomini/:condominioId/fatture/:id", controller.getSessionDetail);
router.put("/sessioni/:id/parametri", controller.updateSessionParams);
router.post("/sessioni/:id/calcola", controller.calculateSession);
router.get("/condominio/:id", controller.getByCondominio);
router.get("/periodi/:condominioId", controller.getAvailablePeriods);
router.get("/providers", controller.getProviders);
router.put("/sessioni/:id/contatore-generale",controller.updateContatoreGenerale);
router.delete("/sessioni/:id", controller.deleteSession);
 

module.exports = router;
