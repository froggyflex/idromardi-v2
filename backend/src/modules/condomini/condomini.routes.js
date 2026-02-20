const express = require("express");
const router = express.Router();
const controller = require("./condomini.controller");
const upload = require("../../config/multer");

router.post(
  "/:id/upload-image",
  upload.single("image"),
  controller.uploadImage
);

router.get("/next-codice", controller.getNextCodice);
router.get("/", controller.getAll);
router.get("/:id", controller.getById);
router.put("/:id", controller.update);
router.get("/:id/contatti", controller.getContatti);
router.post("/:id/contatti", controller.createContatto);
router.put("/:id/contatti/:contattoId", controller.updateContatto);
router.delete("/:id/contatti/:contattoId", controller.deleteContatto);
router.post("/", controller.create);


router.get("/check-codice/:codice", controller.checkCodice);


module.exports = router;
