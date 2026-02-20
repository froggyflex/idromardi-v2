const express = require("express");
const router = express.Router();
const utenzeController = require("./utenze.controller");

router.get("/condomini/:id/utenze", utenzeController.getByCondominio);
router.post("/condomini/:id/utenze", utenzeController.create);
router.put("/condomini/:id/utenze/batch", utenzeController.batchUpdate);
router.delete("/utenze/:id", utenzeController.remove);
router.get("/condomini/:id/utenze/next-id-user",utenzeController.getNextIdUser);

module.exports = router;

 